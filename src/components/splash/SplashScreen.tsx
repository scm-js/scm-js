import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { screenAtom } from "../../atoms/editorAtoms";
import { preloadLogAtom, preloadStepAtom } from "../../atoms/preloadAtoms";

/* ── Wireframe sphere ───────────────────────────────────── */

interface Vec3 { x: number; y: number; z: number }

const rotY = (v: Vec3, a: number): Vec3 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) });
const rotX = (v: Vec3, a: number): Vec3 => ({ x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) });

function buildSphere(rings: number, segs: number, r: number) {
  const verts: Vec3[] = [];
  const edges: [number, number][] = [];
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < segs; j++) {
      const th = (2 * Math.PI * j) / segs;
      verts.push({ x: r * Math.sin(phi) * Math.cos(th), y: r * Math.cos(phi), z: r * Math.sin(phi) * Math.sin(th) });
    }
  }
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const cur = i * segs + j;
      edges.push([cur, i * segs + ((j + 1) % segs)]);
      if (i < rings) edges.push([cur, cur + segs]);
    }
  }
  return { verts, edges };
}

/* ── Stars ──────────────────────────────────────────────── */

interface Star { x: number; y: number; r: number; phase: number; speed: number; bright: number }

function generateStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random(),
      y: Math.random(),
      r: 0.3 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
      speed: 0.0008 + Math.random() * 0.003,
      bright: 0.3 + Math.random() * 0.7,
    });
  }
  return stars;
}

/* ── Palette ────────────────────────────────────────────── */

const CYAN = "80,210,255";
const CYAN_HI = "160,235,255";
const TEAL = "60,180,200";
const VIOLET = "130,90,220";
const BLUE = "40,60,140";

/* ── Timing ─────────────────────────────────────────────── */

/** Held open at least this long even on a warm cache, so the splash never just flickers. */
const MIN_MS = 1400;
/** …and never longer than this, in case a task wedges on a slow or missing asset. */
const MAX_MS = 15000;
const FADE = 550;

export default function SplashScreen() {
  const setScreen = useSetAtom(screenAtom);
  const step = useAtomValue(preloadStepAtom);
  const log = useAtomValue(preloadLogAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);

  const progress = step.progress;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const dismiss = () => setFading(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const sphere = buildSphere(16, 24, 1.15);
    const stars = generateStars(120);
    let raf = 0;
    let lastW = 0, lastH = 0;
    let start = 0;
    let shown = 0;

    const frame = (t: number) => {
      if (!start) start = t;
      const el = t - start;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (cw && ch && (cw !== lastW || ch !== lastH)) {
        lastW = cw; lastH = ch;
        canvas.width = cw * devicePixelRatio;
        canvas.height = ch * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      shown += (progressRef.current - shown) * 0.08;

      /* ── Nebula background ── */
      const nebGrad1 = ctx.createRadialGradient(cw * 0.3, ch * 0.25, 0, cw * 0.3, ch * 0.25, cw * 0.6);
      nebGrad1.addColorStop(0, `rgba(${VIOLET},0.18)`);
      nebGrad1.addColorStop(0.5, `rgba(${BLUE},0.08)`);
      nebGrad1.addColorStop(1, "transparent");
      ctx.fillStyle = nebGrad1;
      ctx.fillRect(0, 0, cw, ch);

      const nebGrad2 = ctx.createRadialGradient(cw * 0.75, ch * 0.7, 0, cw * 0.75, ch * 0.7, cw * 0.5);
      nebGrad2.addColorStop(0, "rgba(30,80,160,0.12)");
      nebGrad2.addColorStop(0.4, `rgba(${VIOLET},0.06)`);
      nebGrad2.addColorStop(1, "transparent");
      ctx.fillStyle = nebGrad2;
      ctx.fillRect(0, 0, cw, ch);

      /* ── Stars ── */
      for (const s of stars) {
        const flicker = 0.5 + 0.5 * Math.sin(el * s.speed + s.phase);
        const a = s.bright * (0.4 + 0.6 * flicker);
        ctx.fillStyle = `rgba(${CYAN_HI},${a})`;
        ctx.beginPath();
        ctx.arc(s.x * cw, s.y * ch, s.r, 0, Math.PI * 2);
        ctx.fill();
        // Cross-shaped glint on brighter stars
        if (s.r > 1.0 && a > 0.5) {
          ctx.strokeStyle = `rgba(${CYAN_HI},${a * 0.3})`;
          ctx.lineWidth = 0.5;
          const sx = s.x * cw, sy = s.y * ch, gl = s.r * 3;
          ctx.beginPath();
          ctx.moveTo(sx - gl, sy); ctx.lineTo(sx + gl, sy);
          ctx.moveTo(sx, sy - gl); ctx.lineTo(sx, sy + gl);
          ctx.stroke();
        }
      }

      /* ── Wireframe sphere ── */
      const cx = cw / 2, cy = ch * 0.40, fov = Math.min(cw, ch) * 0.55;
      const ay = el * 0.0004, ax = 0.35;
      const project = (v: Vec3) => {
        const p = rotX(rotY(v, ay), ax);
        const z = p.z + 4;
        return { x: cx + (p.x * fov) / z, y: cy + (p.y * fov) / z, d: z };
      };

      // Glow behind sphere
      const glowR = fov * 0.35;
      const glowGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glowGrad.addColorStop(0, `rgba(${CYAN},0.12)`);
      glowGrad.addColorStop(0.5, `rgba(${TEAL},0.04)`);
      glowGrad.addColorStop(1, "transparent");
      ctx.fillStyle = glowGrad;
      ctx.fillRect(cx - glowR, cy - glowR, glowR * 2, glowR * 2);

      const pts = sphere.verts.map(project);
      ctx.lineWidth = 0.8;
      for (const [a, b] of sphere.edges) {
        const pa = pts[a], pb = pts[b];
        const depth = (pa.d + pb.d) / 2;
        const alpha = Math.max(0.02, Math.min(0.45, 0.95 - (depth - 2.75) / 2.2));
        ctx.strokeStyle = `rgba(${CYAN},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Bright equator line
      ctx.strokeStyle = `rgba(${CYAN_HI},0.35)`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let j = 0; j <= 24; j++) {
        const p = pts[8 * 24 + (j % 24)];
        if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      /* ── Progress ring around sphere ── */
      const pr = Math.min(cw, ch) * 0.30;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${CYAN},0.07)`;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
      if (shown > 0.002) {
        const head = -Math.PI / 2 + shown * Math.PI * 2;
        ctx.lineCap = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${CYAN},0.55)`;
        ctx.shadowColor = `rgba(${CYAN},0.6)`;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, -Math.PI / 2, head);
        ctx.stroke();
        ctx.fillStyle = `rgba(${CYAN_HI},0.95)`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(head) * pr, cy + Math.sin(head) * pr, 2.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineCap = "butt";
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); };
  }, []);

  // Leave when the assets are actually ready — but not before MIN_MS, and never after
  // MAX_MS, so a stalled fetch cannot lock the editor behind the splash.
  useEffect(() => {
    const mounted = performance.now();
    const cap = setTimeout(() => setFading(true), MAX_MS);
    let hold = 0;
    if (step.done) hold = setTimeout(() => setFading(true), Math.max(0, MIN_MS - (performance.now() - mounted)));
    return () => { clearTimeout(cap); clearTimeout(hold); };
  }, [step.done]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setScreen("editor"), FADE);
    return () => clearTimeout(t);
  }, [fading, setScreen]);

  const lines = log.slice(-3);

  return (
    <div className={`splash-veil ${fading ? "fade-out" : ""}`} onClick={dismiss} role="presentation">
      <div className="splash-card" onClick={(e) => { e.stopPropagation(); dismiss(); }}>
        <canvas ref={canvasRef} className="splash-canvas" />
        <div className="splash-center">
          <h1 className="splash-title">JS<span>EDIT</span></h1>
          <div className="splash-sub">StarCraft · Brood War</div>
        </div>
        <div className="splash-bottom">
          <div className="splash-log">
            {lines.map((line, i) => (
              <div key={`${line.label}${i}`} className={line.failed ? "failed" : undefined}>
                {line.label}{line.failed ? " — unavailable" : ""}
              </div>
            ))}
            {!step.done && <div className="current">{step.label}</div>}
            {step.done && <div className="current">Ready</div>}
          </div>
          <div className="splash-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="splash-foot">
            <span className="splash-version">v0.1 alpha</span>
            <span className="splash-author">by Jeany</span>
          </div>
          <div className="splash-skip">
            {step.done ? "click anywhere to continue" : "click to skip"}
          </div>
        </div>
      </div>
    </div>
  );
}
