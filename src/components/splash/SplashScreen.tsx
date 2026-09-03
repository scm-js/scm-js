import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { screenAtom } from "../../atoms/editorAtoms";
import { preloadLogAtom, preloadStepAtom } from "../../atoms/preloadAtoms";
import { APP_VERSION_SHORT } from "../../version";
import { removeBootSplash } from "./bootSplash";
import { PINK, PINK_HI, buildSphere, drawNebula, drawSphereGlow, drawSphereWire, drawStars, generateStars, projectSphere } from "./starfield";

/* ── Timing ─────────────────────────────────────────────── */

/** Held open at least this long even on a warm cache, so the splash never just flickers. */
const MIN_MS = 1400;
/** …and never longer than this, in case a task wedges on a slow or missing asset. */
const MAX_MS = 15000;
const FADE = 550;

export default function SplashScreen({ solid = false }: { solid?: boolean }) {
  const setScreen = useSetAtom(screenAtom);
  const step = useAtomValue(preloadStepAtom);
  const log = useAtomValue(preloadLogAtom);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fading, setFading] = useState(false);

  const progress = step.progress;
  const progressRef = useRef(progress);
  progressRef.current = progress;

  const dismiss = () => setFading(true);

  // When the page first became visible (`performance.now()`), or 0 while it is not.
  const [visibleAt, setVisibleAt] = useState(() => (document.visibilityState === "visible" ? performance.now() : 0));
  useEffect(() => {
    if (visibleAt) return;
    const onChange = () => { if (document.visibilityState === "visible") setVisibleAt(performance.now()); };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [visibleAt]);

  // Hand over from the boot splash in `index.html`: this commit draws the same card, so the
  // static one goes before the frame that would show both. A layout effect, not an effect —
  // it has to happen before the paint, and `?nosplash` never gets here (App does it instead).
  useLayoutEffect(removeBootSplash, []);

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

      drawNebula(ctx, cw, ch, el);
      drawStars(ctx, cw, ch, el, stars);

      /* ── Wireframe sphere ── */
      const cx = cw / 2, cy = ch * 0.40, fov = Math.min(cw, ch) * 0.55;
      drawSphereGlow(ctx, cx, cy, fov * 0.35);
      drawSphereWire(ctx, sphere, projectSphere(sphere, cx, cy, fov, el * 0.0004, 0.35));

      /* ── Progress ring around sphere ── */
      const pr = Math.min(cw, ch) * 0.30;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = `rgba(${PINK},0.07)`;
      ctx.beginPath();
      ctx.arc(cx, cy, pr, 0, Math.PI * 2);
      ctx.stroke();
      if (shown > 0.002) {
        const head = -Math.PI / 2 + shown * Math.PI * 2;
        ctx.lineCap = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(${PINK},0.55)`;
        ctx.shadowColor = `rgba(${PINK},0.6)`;
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, -Math.PI / 2, head);
        ctx.stroke();
        ctx.fillStyle = `rgba(${PINK_HI},0.95)`;
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
  //
  // Both are counted from the moment the page is *visible*, not from mount. The desktop
  // window is hidden until the renderer paints, and a hidden page neither animates (the
  // canvas is a rAF loop, and rAF does not run in one) nor is seen: counting from mount
  // meant a launch that took a while to put the window on screen spent the splash's whole
  // life behind nothing, and the user got a hang followed by the bare editor. A browser tab
  // opened in the background is the same situation and gets the same treatment.
  useEffect(() => {
    if (!visibleAt) return;
    const cap = setTimeout(() => setFading(true), Math.max(0, MAX_MS - (performance.now() - visibleAt)));
    let hold = 0;
    if (step.done) hold = setTimeout(() => setFading(true), Math.max(0, MIN_MS - (performance.now() - visibleAt)));
    return () => { clearTimeout(cap); clearTimeout(hold); };
  }, [step.done, visibleAt]);

  useEffect(() => {
    if (!fading) return;
    const t = setTimeout(() => setScreen("editor"), FADE);
    return () => clearTimeout(t);
  }, [fading, setScreen]);

  const lines = log.slice(-3);

  return (
    <div className={`splash-veil${solid ? " solid" : ""}${fading ? " fade-out" : ""}`} onClick={dismiss} role="presentation">
      <div className="splash-card" onClick={(e) => { e.stopPropagation(); dismiss(); }}>
        <canvas ref={canvasRef} className="splash-canvas" />
        <div className="splash-center">
          <h1 className="splash-title">scm<span>JS</span></h1>
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
            <span className="splash-version">v{APP_VERSION_SHORT}</span>
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
