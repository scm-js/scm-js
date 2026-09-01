import { useEffect, useRef } from "react";
import { buildSphere, drawSphereGlow, drawSphereWire, projectSphere } from "../splash/starfield";

/**
 * The app logo as the splash screen draws it: a pink wireframe globe turning idly on its own
 * rAF loop. `AppLogo` stays the flat SVG for the menu bar — this one is for places big enough
 * to see it move.
 */
export default function WireSphere({ size = 96, className }: { size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      // Still draw it, just frozen at a pleasant angle.
      paint(ctx, canvas, 0);
      return;
    }
    let raf = 0;
    let start = 0;
    const frame = (t: number) => {
      if (!start) start = t;
      paint(ctx, canvas, t - start);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ width: size, height: size }} aria-hidden />;
}

const SPHERE = buildSphere(16, 24, 1.15);

function paint(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, el: number) {
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const w = Math.round(cw * devicePixelRatio), h = Math.round(ch * devicePixelRatio);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // A tighter fov than the splash's, so the globe fills its box rather than floating in it.
  const cx = cw / 2, cy = ch / 2, fov = Math.min(cw, ch) * 1.55;
  drawSphereGlow(ctx, cx, cy, Math.min(cw, ch) * 0.5);
  // Slow tumble: mostly spin, with a gentle nod so it never looks like a flat disc.
  drawSphereWire(ctx, SPHERE, projectSphere(SPHERE, cx, cy, fov, el * 0.00035, 0.32 + 0.14 * Math.sin(el * 0.00017)), 0.7);
}
