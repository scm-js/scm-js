import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { screenAtom } from "../../atoms/editorAtoms";

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

/* ── Timeline ───────────────────────────────────────────── */

const LOG: [number, string][] = [
  [0, "Initializing renderer"],
  [350, "Loading tileset: Badlands (badlands.cv5, .vx4, .vr4)"],
  [800, "Reading units.dat · weapons.dat · upgrades.dat"],
  [1250, "Building doodad palette"],
  [1700, "Indexing trigger conditions and actions"],
  [2150, "Restoring workspace layout"],
  [2600, "Ready."],
];
const DURATION = 3300;
const FADE = 550;

export default function SplashScreen() {
  const setScreen = useSetAtom(screenAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logCount, setLogCount] = useState(1);
  const startRef = useRef<number>(0);

  const dismiss = () => setFading(true);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const sphere = buildSphere(14, 22, 1.25);
    let raf = 0;
    let lastW = 0, lastH = 0;

    const frame = (t: number) => {
      if (!startRef.current) startRef.current = t;
      const el = t - startRef.current;
      const cw = canvas.clientWidth, ch = canvas.clientHeight;
      if (cw && ch && (cw !== lastW || ch !== lastH)) {
        lastW = cw; lastH = ch;
        canvas.width = cw * devicePixelRatio;
        canvas.height = ch * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      ctx.clearRect(0, 0, cw, ch);

      const cx = cw / 2, cy = ch * 0.44, fov = Math.min(cw, ch) * 0.62;
      const ay = el * 0.00055, ax = 0.42;
      const pts = sphere.verts.map((v) => {
        const p = rotX(rotY(v, ay), ax);
        const z = p.z + 4;
        return { x: cx + (p.x * fov) / z, y: cy + (p.y * fov) / z, d: z };
      });
      ctx.lineWidth = 1;
      for (const [a, b] of sphere.edges) {
        const pa = pts[a], pb = pts[b];
        const depth = (pa.d + pb.d) / 2; // ~2.75 (front) .. ~5.25 (back)
        const alpha = Math.max(0.04, Math.min(0.55, 1.15 - (depth - 2.75) / 2.4));
        ctx.strokeStyle = `rgba(230,185,92,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      // teal equator ring
      ctx.strokeStyle = "rgba(79,209,197,0.55)";
      ctx.beginPath();
      const ring = 7 * 22;
      for (let j = 0; j <= 22; j++) {
        const p = pts[ring + (j % 22)];
        if (j === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();

      setProgress(Math.min(1, el / (DURATION - 300)));
      setLogCount(LOG.filter(([at]) => at <= el).length);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    const t1 = setTimeout(() => setFading(true), DURATION);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); };
  }, []);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setScreen("editor"), FADE);
    return () => clearTimeout(t);
  }, [fading, setScreen]);

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
            {LOG.slice(0, logCount).map(([, line]) => <div key={line}>{line}</div>)}
          </div>
          <div className="splash-bar"><i style={{ width: `${progress * 100}%` }} /></div>
          <div className="splash-foot">
            <span>click to skip</span>
            <span>not affiliated with Blizzard</span>
          </div>
        </div>
      </div>
    </div>
  );
}
