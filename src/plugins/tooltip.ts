/**
 * `api.ui.tooltip`: the editor's tooltip over a plugin's own element, in place of the
 * browser's `title` — the same look as the chrome's (`.tooltip` in ui.css), placed beside
 * the pointer and kept on screen. Plain DOM, as the rest of the plugin surface is: the
 * chrome's tooltips are Radix's, which a plugin's element is not part of.
 *
 * Content given as a function is asked again on every pointer move, which is what makes
 * it a read-out for a chart; text is asked once and shows after the editor's usual rest.
 */
import type { TooltipHandle, TooltipOptions, TooltipPointer } from "./api";

/** The gap between the pointer and the tip, and the margin it keeps from the window's edges. */
const GAP_X = 14;
const GAP_Y = 18;
const MARGIN = 8;

export type TooltipContent = string | ((at: TooltipPointer) => HTMLElement | string | null);

/**
 * Attach a tip to `target`. Returns the handle; `dispose` takes the listeners off and the
 * tip away. The caller ties `dispose` to the plugin's lifetime.
 */
export function attachTooltip(target: HTMLElement, content: TooltipContent, options: TooltipOptions = {}): TooltipHandle {
  const live = typeof content === "function";
  const delay = Math.max(0, options.delay ?? (live ? 0 : 500));
  let tip: HTMLDivElement | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let watch: ReturnType<typeof setInterval> | null = null;
  let last: { x: number; y: number; pressed: boolean } | null = null;
  let disposed = false;

  const clearTimer = () => { if (timer !== null) { clearTimeout(timer); timer = null; } };

  const hide = () => {
    clearTimer();
    if (watch !== null) { clearInterval(watch); watch = null; }
    tip?.remove();
    tip = null;
  };

  const place = () => {
    if (!tip || !last) return;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = last.x + GAP_X, y = last.y + GAP_Y;
    if (x + w > vw - MARGIN) x = last.x - GAP_X - w;
    if (y + h > vh - MARGIN) y = last.y - GAP_Y / 2 - h;
    tip.style.left = `${Math.max(MARGIN, Math.min(x, vw - MARGIN - w))}px`;
    tip.style.top = `${Math.max(MARGIN, Math.min(y, vh - MARGIN - h))}px`;
  };

  /** Ask for the content where the pointer is and show it; hide when there is none. */
  const show = () => {
    if (disposed || !last) return;
    if (!target.isConnected) { hide(); return; }
    let body: HTMLElement | string | null;
    if (typeof content === "string") body = content;
    else {
      const r = target.getBoundingClientRect();
      try {
        body = content({ x: last.x, y: last.y, offsetX: last.x - r.left, offsetY: last.y - r.top, pressed: last.pressed });
      } catch (err) {
        console.error("A plugin tooltip failed to draw", err);
        body = null;
      }
    }
    if (body === null || body === "") { hide(); return; }
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "tooltip plugin-tooltip";
      tip.setAttribute("role", "tooltip");
      tip.style.maxWidth = `${options.maxWidth ?? 320}px`;
      document.body.append(tip);
      // An element taken off the page sends no pointerleave; a tip over nothing would stay.
      watch = setInterval(() => { if (!target.isConnected) hide(); }, 250);
    }
    tip.replaceChildren(body);
    place();
  };

  const onMove = (e: PointerEvent) => {
    last = { x: e.clientX, y: e.clientY, pressed: e.buttons !== 0 };
    if (tip) { if (live) show(); else place(); return; }
    clearTimer();
    if (delay === 0) show();
    else timer = setTimeout(() => { timer = null; show(); }, delay);
  };
  // A press on text closes it, as the browser's own does; a read-out stays through a drag.
  const onDown = () => { if (!live) hide(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hide(); };

  target.addEventListener("pointerenter", onMove);
  target.addEventListener("pointermove", onMove);
  target.addEventListener("pointerleave", hide);
  target.addEventListener("pointercancel", hide);
  target.addEventListener("pointerdown", onDown);
  window.addEventListener("keydown", onKey);
  window.addEventListener("wheel", hide, { passive: true });
  window.addEventListener("blur", hide);

  return {
    refresh: () => { if (tip) show(); },
    hide,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      hide();
      target.removeEventListener("pointerenter", onMove);
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerleave", hide);
      target.removeEventListener("pointercancel", hide);
      target.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("wheel", hide);
      window.removeEventListener("blur", hide);
    },
  };
}
