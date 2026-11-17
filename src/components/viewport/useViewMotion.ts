import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { useSetAtom, type ExtractAtomValue, type useStore } from "jotai";
import { centerViewOnAtom, zoomAtom, ZOOM_STEPS } from "../../atoms/editorAtoms";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import { wheelStep } from "../../plugins/mapViews";
import type { PanState } from "./autoPan";

interface ViewMotionArgs {
  scrollerRef: RefObject<HTMLDivElement | null>;
  /** The scale as the frame loops read it (`useRepaints`). */
  tilePxRef: RefObject<number>;
  centerOn: ExtractAtomValue<typeof centerViewOnAtom>;
  draw: () => void;
  scheduleDraw: () => void;
  zoom: number;
  store: ReturnType<typeof useStore>;
}

/**
 * The view moving by itself: a glide to a point (the minimap, `view.center`, `view.reveal`),
 * the scroll that keeps a point in place across a zoom, and the wheel that zooms. Holds the
 * glide in progress and the auto-pan's state, which the pointer handlers drive; both are
 * stopped when the viewport goes.
 */
export function useViewMotion(args: ViewMotionArgs) {
  const { scrollerRef, tilePxRef, centerOn, draw, scheduleDraw, zoom, store } = args;
  const clearCenterOn = useSetAtom(centerViewOnAtom);
  /** The auto-pan in progress: its speed in px/s and the sub-pixel remainder each axis carries. */
  const panRef = useRef<PanState | null>(null);
  /* recentring, from the minimap, `view.center` and `view.reveal` */
  /** The glide in progress, if any; a newer request or a scroll from elsewhere cancels it. */
  const glideRef = useRef<{ cancel(): void } | null>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !centerOn) return;
    const request = centerOn;
    clearCenterOn(null);
    glideRef.current?.cancel();
    glideRef.current = null;
    const targetLeft = () => request.x * tilePxRef.current - el.clientWidth / 2;
    const targetTop = () => request.y * tilePxRef.current - el.clientHeight / 2;
    // `done` is answered a frame after the paint that moved `viewportRectAtom`, so a plugin
    // hearing the "view" event knows every change before the answer was this request's own.
    const arrived = () => requestAnimationFrame(() => requestAnimationFrame(() => request.done?.(true)));
    if (!request.animate) {
      el.scrollLeft = targetLeft();
      el.scrollTop = targetTop();
      scheduleDraw();
      arrived();
      return;
    }
    // A glide of the viewport's own: eased over a duration that grows with the distance, and
    // given up the moment the scroll position is not where the last frame left it — the
    // user's wheel, a scrollbar drag, the keyboard — so the view never fights its owner.
    const fromLeft = el.scrollLeft, fromTop = el.scrollTop;
    const maxLeft = Math.max(0, el.scrollWidth - el.clientWidth), maxTop = Math.max(0, el.scrollHeight - el.clientHeight);
    const toLeft = Math.max(0, Math.min(maxLeft, targetLeft())), toTop = Math.max(0, Math.min(maxTop, targetTop()));
    const distance = Math.hypot(toLeft - fromLeft, toTop - fromTop);
    if (distance < 1) { arrived(); return; }
    const duration = Math.min(600, 220 + distance / 6);
    const start = performance.now();
    let lastLeft = fromLeft, lastTop = fromTop;
    let raf = 0;
    const glide = { cancel() { cancelAnimationFrame(raf); if (glideRef.current === glide) glideRef.current = null; request.done?.(false); } };
    glideRef.current = glide;
    const frame = (now: number) => {
      if (Math.abs(el.scrollLeft - lastLeft) > 1 || Math.abs(el.scrollTop - lastTop) > 1) { glide.cancel(); return; }
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - (1 - t) ** 3;
      lastLeft = Math.round(fromLeft + (toLeft - fromLeft) * e);
      lastTop = Math.round(fromTop + (toTop - fromTop) * e);
      el.scrollLeft = lastLeft;
      el.scrollTop = lastTop;
      // The scroller's own scroll event books the repaint; setting the same position fires none.
      lastLeft = el.scrollLeft; lastTop = el.scrollTop;
      if (t < 1) { raf = requestAnimationFrame(frame); return; }
      if (glideRef.current === glide) glideRef.current = null;
      scheduleDraw();
      arrived();
    };
    raf = requestAnimationFrame(frame);
  }, [centerOn, clearCenterOn, draw, scheduleDraw, tilePxRef, scrollerRef]);
  useEffect(() => () => { glideRef.current?.cancel(); if (panRef.current) cancelAnimationFrame(panRef.current.raf); }, []);

  /*
   * Keep a point of the view in place when zooming: the pointer, when the wheel zoomed
   * with `Preferences.view.zoomToCursor` on (the wheel handler leaves it in `zoomAnchorRef`
   * just before setting the zoom), else the centre — the menu, the keyboard and the toolbar.
   */
  const prevZoom = useRef(zoom);
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || prevZoom.current === zoom) return;
    const ratio = zoom / prevZoom.current;
    const anchor = zoomAnchorRef.current;
    zoomAnchorRef.current = null;
    const ax = anchor?.x ?? el.clientWidth / 2;
    const ay = anchor?.y ?? el.clientHeight / 2;
    el.scrollLeft = (el.scrollLeft + ax) * ratio - ax;
    el.scrollTop = (el.scrollTop + ay) * ratio - ay;
    prevZoom.current = zoom;
    scheduleDraw();
  }, [zoom, draw, scheduleDraw, scrollerRef]);

  /*
   * The wheel: Ctrl (Cmd) + wheel always zooms — and is taken from the browser, whose own
   * page zoom it would otherwise be; with `Preferences.view.wheel` on "zoom" a plain wheel
   * zooms too, and Shift+wheel is left to the scroller as sideways scrolling. A step per
   * notch: a trackpad's stream of small deltas is summed to the same threshold. Not a React
   * handler, because React's wheel listeners are passive and cannot preventDefault.
   */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let acc = 0;
    const onWheel = (e: WheelEvent) => {
      const view = store.get(preferencesAtom).view;
      const step = wheelStep(acc, e, view.wheel);
      acc = step.acc;
      if (!step.zooms) return;
      e.preventDefault();
      if (!step.dir) return;
      const dir = step.dir;
      const zoom = store.get(zoomAtom);
      const next = dir > 0 ? ZOOM_STEPS.find((z) => z > zoom) : [...ZOOM_STEPS].reverse().find((z) => z < zoom);
      if (next === undefined || next === zoom) return;
      const r = el.getBoundingClientRect();
      zoomAnchorRef.current = view.zoomToCursor ? { x: e.clientX - r.left, y: e.clientY - r.top } : null;
      store.set(zoomAtom, next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [store, scrollerRef]);

  return { glideRef, panRef };
}
