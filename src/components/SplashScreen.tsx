import { useEffect, useRef, useState } from "react";
import { useSetAtom } from "jotai";
import { screenAtom } from "../atoms/editorAtoms";
import "./SplashScreen.css";

/* ── Wireframe sphere helpers ──────────────────────────── */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function rotateY(v: Vec3, a: number): Vec3 {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x * cos + v.z * sin, y: v.y, z: -v.x * sin + v.z * cos };
}

function rotateX(v: Vec3, a: number): Vec3 {
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: v.x, y: v.y * cos - v.z * sin, z: v.y * sin + v.z * cos };
}

function project(v: Vec3, cx: number, cy: number, fov: number) {
  const z = v.z + 4;
  const scale = fov / z;
  return { x: cx + v.x * scale, y: cy + v.y * scale, depth: z };
}

function buildSphere(rings: number, segs: number, r: number) {
  const verts: Vec3[] = [];
  const edges: [number, number][] = [];

  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    for (let j = 0; j < segs; j++) {
      const theta = (2 * Math.PI * j) / segs;
      verts.push({
        x: r * Math.sin(phi) * Math.cos(theta),
        y: r * Math.cos(phi),
        z: r * Math.sin(phi) * Math.sin(theta),
      });
    }
  }

  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j < segs; j++) {
      const cur = i * segs + j;
      const next = i * segs + ((j + 1) % segs);
      edges.push([cur, next]);
      if (i < rings) edges.push([cur, cur + segs]);
    }
  }

  return { verts, edges };
}

/* ── Component ──────────────────────────────────────────── */

const SPLASH_DURATION = 3500;

export default function SplashScreen() {
  const setScreen = useSetAtom(screenAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;

    const sphere = buildSphere(12, 18, 1.4);
    let raf = 0;
    let start = 0;

    let lastW = 0;
    let lastH = 0;

    function draw(time: number) {
      if (!start) start = time;
      const elapsed = time - start;

      const cw = canvas!.clientWidth;
      const ch = canvas!.clientHeight;
      if (cw === 0 || ch === 0) {
        raf = requestAnimationFrame(draw);
        return;
      }

      if (cw !== lastW || ch !== lastH) {
        lastW = cw;
        lastH = ch;
        canvas!.width = cw * devicePixelRatio;
        canvas!.height = ch * devicePixelRatio;
      }
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

      const cx = cw / 2;
      const cy = ch / 2;
      const fov = Math.min(cw, ch) * 0.7;

      ctx.clearRect(0, 0, cw, ch);

      const angleY = elapsed * 0.0008;
      const angleX = 0.35;

      const projected = sphere.verts.map((v) =>
        project(rotateX(rotateY(v, angleY), angleX), cx, cy, fov)
      );

      ctx.lineWidth = 1;
      for (const [a, b] of sphere.edges) {
        const pa = projected[a];
        const pb = projected[b];
        const alpha = Math.max(0.05, Math.min(0.6, 1 - (pa.depth + pb.depth - 5) / 4));
        ctx.strokeStyle = `rgba(233,69,96,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    }

    raf = requestAnimationFrame(draw);

    const fadeTimer = setTimeout(() => setFading(true), SPLASH_DURATION - 600);
    const closeTimer = setTimeout(() => setScreen("editor"), SPLASH_DURATION);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(fadeTimer);
      clearTimeout(closeTimer);
    };
  }, [setScreen]);

  return (
    <div className={`splash-backdrop${fading ? " fade-out" : ""}`} onClick={() => setScreen("editor")}>
      <canvas ref={canvasRef} className="splash-canvas" />
      <div className="splash-overlay">
        <h1 className="splash-title">
          JS&nbsp;<span className="highlight">Edit</span>
        </h1>
        <p className="splash-subtitle">StarCraft&nbsp;/ Brood&nbsp;War Map&nbsp;Editor</p>
      </div>
    </div>
  );
}
