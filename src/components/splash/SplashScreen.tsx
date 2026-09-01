import { useEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { screenAtom } from "../../atoms/editorAtoms";
import { preloadLogAtom, preloadStepAtom } from "../../atoms/preloadAtoms";

/* ── Wireframe sphere ───────────────────────────────────── */

interface Vec3 { x: number; y: number; z: number }

const rotY = (v: Vec3, a: number): Vec3 => ({ x: v.x * Math.cos(a) + v.z * Math.sin(a), y: v.y, z: -v.x * Math.sin(a) + v.z * Math.cos(a) });
const rotX = (v: Vec3, a: number): Vec3 => ({ x: v.x, y: v.y * Math.cos(a) - v.z * Math.sin(a), z: v.y * Math.sin(a) + v.z * Math.cos(a) });
const rotZ = (v: Vec3, a: number): Vec3 => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a), z: v.z });

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

/* ── Orbiting rings ─────────────────────────────────────── */

/**
 * A ring is a circle in its own plane, tilted and spun, then projected through the same
 * camera as the sphere — so it genuinely passes behind and in front of the wireframe
 * instead of sitting on top of it like a CSS overlay would.
 */
interface Ring {
  radius: number;
  /** Radians per ms about its own axis. */
  speed: number;
  /** Tilt of the ring's plane: X then Z. */
  tiltX: number;
  tiltZ: number;
  /** `[on, off]` in segments; null draws a solid ring. */
  dash: [number, number] | null;
  /** Draw a short outward tick at the head of every Nth dash. 0 for none. */
  ticks: number;
  width: number;
  alpha: number;
}

const RINGS: Ring[] = [
  { radius: 1.72, speed: 0.00085, tiltX: 1.14, tiltZ: 0.34, dash: [7, 3], ticks: 2, width: 1.5, alpha: 0.9 },
  { radius: 2.04, speed: -0.00047, tiltX: 1.36, tiltZ: -0.52, dash: null, ticks: 0, width: 1, alpha: 0.28 },
];

const RING_SEGS = 96;

/* ── Palette ────────────────────────────────────────────── */

const PINK = "255,95,162";
const PINK_HI = "255,190,220";
const VIOLET = "199,125,255";

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
    const sphere = buildSphere(14, 22, 1.25);
    let raf = 0;
    let lastW = 0, lastH = 0;
    let start = 0;
    /** Eased follower, so the bar and the ring sweep glide between tasks. */
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

      const cx = cw / 2, cy = ch * 0.44, fov = Math.min(cw, ch) * 0.62;
      const ay = el * 0.00055, ax = 0.42;
      const project = (v: Vec3) => {
        const p = rotX(rotY(v, ay), ax);
        const z = p.z + 4;
        return { x: cx + (p.x * fov) / z, y: cy + (p.y * fov) / z, d: z };
      };

      // Sphere, depth-faded front to back.
      const pts = sphere.verts.map(project);
      ctx.lineWidth = 1;
      for (const [a, b] of sphere.edges) {
        const pa = pts[a], pb = pts[b];
        const depth = (pa.d + pb.d) / 2; // ~2.75 (front) .. ~5.25 (back)
        const alpha = Math.max(0.03, Math.min(0.36, 0.85 - (depth - 2.75) / 2.4));
        ctx.strokeStyle = `rgba(${PINK},${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      // Violet equator, to keep some depth cueing on the sphere itself.
      ctx.strokeStyle = `rgba(${VIOLET},0.42)`;
      ctx.beginPath();
      for (let j = 0; j <= 22; j++) {
        const p = pts[7 * 22 + (j % 22)];
        if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      // Orbiting rings. Each segment is drawn on its own so depth can fade it — a single
      // path would have to pick one alpha for the whole loop.
      for (const ring of RINGS) {
        const spin = el * ring.speed;
        const at = (i: number) => {
          const th = (2 * Math.PI * i) / RING_SEGS + spin;
          return rotZ(rotX({ x: ring.radius * Math.cos(th), y: ring.radius * Math.sin(th), z: 0 }, ring.tiltX), ring.tiltZ);
        };
        const rp = Array.from({ length: RING_SEGS + 1 }, (_, i) => project(at(i % RING_SEGS)));
        ctx.lineWidth = ring.width;
        for (let i = 0; i < RING_SEGS; i++) {
          if (ring.dash && i % (ring.dash[0] + ring.dash[1]) >= ring.dash[0]) continue;
          const a = rp[i], b = rp[i + 1];
          const depth = (a.d + b.d) / 2;
          // In front of the sphere reads bright; behind it dims to a suggestion.
          const near = Math.max(0, Math.min(1, (5.4 - depth) / 2.6));
          ctx.strokeStyle = `rgba(${PINK},${(0.1 + 0.9 * near * near) * ring.alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
        // Ticks sit on dash heads rather than on a rhythm of their own, so they read as
        // graduations on the ring instead of stray marks floating beside it.
        if (ring.ticks > 0 && ring.dash) {
          const period = (ring.dash[0] + ring.dash[1]) * ring.ticks;
          ctx.lineWidth = 1;
          for (let i = 0; i < RING_SEGS; i += period) {
            const inner = rp[i];
            const v = at(i);
            const outer = project({ x: v.x * 1.11, y: v.y * 1.11, z: v.z * 1.11 });
            const near = Math.max(0, Math.min(1, (5.4 - inner.d) / 2.6));
            ctx.strokeStyle = `rgba(${PINK_HI},${0.15 + 0.65 * near})`;
            ctx.beginPath();
            ctx.moveTo(inner.x, inner.y);
            ctx.lineTo(outer.x, outer.y);
            ctx.stroke();
          }
        }
      }

      // Progress sweep: a flat screen-space arc just outside the orbits, so "how far
      // along" is readable at a glance without decoding the 3D. Kept thin and dim — the
      // bar at the foot of the card is the thing you are meant to read, this only echoes it.
      const pr = Math.min(cw, ch) * 0.34;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${PINK},0.1)`;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
      if (shown > 0.002) {
        const head = -Math.PI / 2 + shown * Math.PI * 2;
        ctx.lineCap = "round";
        ctx.strokeStyle = `rgba(${PINK},0.6)`;
        ctx.shadowColor = `rgba(${PINK},0.7)`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, -Math.PI / 2, head);
        ctx.stroke();
        // A node riding the head, so the sweep still reads as motion when it is stalled
        // on one long task.
        ctx.fillStyle = `rgba(${PINK_HI},0.95)`;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(head) * pr, cy + Math.sin(head) * pr, 2.4, 0, Math.PI * 2);
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

  const lines = log.slice(-4);

  return (
    <div className={`splash-veil ${fading ? "fade-out" : ""}`} onClick={dismiss} role="presentation">
      <div className="splash-card" onClick={(e) => { e.stopPropagation(); dismiss(); }}>
        <canvas ref={canvasRef} className="splash-canvas" />
        <span className="splash-corner tl" /><span className="splash-corner tr" /><span className="splash-corner bl" /><span className="splash-corner br" />
        <div className="splash-top">
          <span>Scenario Editor</span>
          <span>v0.1 · alpha</span>
        </div>
        <div className="splash-center">
          <h1 className="splash-title">JS <span>EDIT</span></h1>
          <div className="splash-sub">StarCraft · Brood War</div>
          <div className="splash-rule" />
          <div className="splash-homage">in homage to StarEdit · SCMDraft 2 · StarForge</div>
        </div>
        <div className="splash-bottom">
          <div className="splash-log">
            {lines.map((line, i) => (
              <div key={`${line.label}${i}`} className={line.failed ? "failed" : undefined}>
                {line.label}{line.failed ? " — unavailable" : ""}
              </div>
            ))}
            {!step.done && <div className="current">{step.label}</div>}
            {step.done && <div className="current">Ready.</div>}
          </div>
          <div className="splash-bar" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <i style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="splash-foot">
            <span>{step.done ? "click to continue" : "click to skip"}</span>
            <span>not affiliated with Blizzard</span>
          </div>
        </div>
      </div>
    </div>
  );
}
