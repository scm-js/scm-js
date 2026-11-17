import type { RefObject } from "react";
import type { Gesture } from "./gestures";

/**
 * A drag that reaches the edge of the window scrolls the view under it: `EDGE_BAND` px
 * inside the scroller is the band where the pan starts, the speed ramps to `PAN_MAX` px/s
 * as the pointer pushes past it (a capture keeps the events coming well outside the
 * window, where it just runs at full speed). Screen pixels, not tiles, so the view moves
 * at the same rate however far out the map is zoomed.
 */
const EDGE_BAND = 28;
const PAN_MIN = 120;
const PAN_MAX = 1200;

/**
 * What the move path needs of a pointer event. A React `PointerEvent` satisfies it, and so
 * does the snapshot the auto-pan keeps, which is how a tick replays the last move against
 * a scroll position the pointer itself never moved through.
 */
export interface MoveEvent {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  buttons: number;
  currentTarget: HTMLDivElement;
}

/** An auto-pan in progress: its frame, its speed in px/s, the sub-pixel remainder each axis carries and its last frame's time. */
export type PanState = { raf: number; vx: number; vy: number; dx: number; dy: number; last: number };

interface AutoPanArgs {
  scrollerRef: RefObject<HTMLDivElement | null>;
  gestureRef: RefObject<Gesture | null>;
  /** The glide in progress (`useViewMotion`), which a pan cancels. */
  glideRef: RefObject<{ cancel(): void } | null>;
  /** The auto-pan in progress (held by `useViewMotion`, which stops it when the viewport goes). */
  panRef: RefObject<PanState | null>;
  /** The last pointer move, which each frame replays. */
  lastMoveRef: RefObject<MoveEvent | null>;
  /** The move handler a frame replays the last move through. */
  onMove: (e: MoveEvent) => void;
}

/* ── the view follows a drag that reaches the edge ───── */

/**
 * The auto-pan's functions for one render's handlers: `autoPanFrom` books (or drops) the pan
 * for where a move left the pointer, `stopAutoPan` ends it.
 */
export function autoPanner(args: AutoPanArgs) {
  const { scrollerRef, gestureRef, glideRef, panRef, lastMoveRef, onMove } = args;

  /** Whether a drag the view should follow is in progress. */
  const gestureLive = () => gestureRef.current !== null;

  const stopAutoPan = () => {
    if (!panRef.current) return;
    cancelAnimationFrame(panRef.current.raf);
    panRef.current = null;
  };

  /**
   * One auto-pan frame: scroll by what the last move asked for, then run that move again at
   * the new scroll position. The pointer is standing still, so nothing else would tell the
   * gesture that the ground under it had moved — the stroke would paint one edge tile for
   * as long as the view slid past. The speed carries a sub-pixel remainder between frames,
   * or the slowest push would never round up to a whole pixel and nothing would move.
   */
  const panFrame = (now: number) => {
    const pan = panRef.current;
    const el = scrollerRef.current;
    if (!pan || !el) return;
    if (!gestureLive()) { stopAutoPan(); return; }
    const dt = Math.min(0.05, (now - pan.last) / 1000);
    pan.last = now;
    pan.dx += pan.vx * dt;
    pan.dy += pan.vy * dt;
    const stepX = Math.trunc(pan.dx), stepY = Math.trunc(pan.dy);
    pan.dx -= stepX;
    pan.dy -= stepY;
    const wasLeft = el.scrollLeft, wasTop = el.scrollTop;
    if (stepX) el.scrollLeft = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, el.scrollLeft + stepX));
    if (stepY) el.scrollTop = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, el.scrollTop + stepY));
    pan.raf = requestAnimationFrame(panFrame);
    // At the map's edge the scroll stops moving; the gesture has already seen this position.
    if (el.scrollLeft === wasLeft && el.scrollTop === wasTop) return;
    if (lastMoveRef.current) onMove(lastMoveRef.current);
  };

  /** How fast one axis pans: nothing inside the band, ramping to `PAN_MAX` as the pointer pushes past it. */
  const panSpeed = (pos: number, min: number, max: number) => {
    const over = pos < min + EDGE_BAND ? pos - (min + EDGE_BAND) : pos > max - EDGE_BAND ? pos - (max - EDGE_BAND) : 0;
    if (over === 0) return 0;
    const f = Math.min(1, Math.abs(over) / EDGE_BAND);
    return Math.sign(over) * (PAN_MIN + (PAN_MAX - PAN_MIN) * f * f);
  };

  /** Book (or drop) the auto-pan for where this move left the pointer. */
  const autoPanFrom = (e: MoveEvent) => {
    const el = scrollerRef.current;
    if (!el || !gestureLive()) { stopAutoPan(); return; }
    const r = el.getBoundingClientRect();
    // On a view too small to hold three bands the two sides would overlap and fight.
    const vx = r.width > EDGE_BAND * 3 ? panSpeed(e.clientX, r.left, r.right) : 0;
    const vy = r.height > EDGE_BAND * 3 ? panSpeed(e.clientY, r.top, r.bottom) : 0;
    if (vx === 0 && vy === 0) { stopAutoPan(); return; }
    const pan = panRef.current;
    if (pan) { pan.vx = vx; pan.vy = vy; return; }
    // The view belongs to the gesture now: a glide from the minimap or a plugin gives way.
    glideRef.current?.cancel();
    const started = { raf: 0, vx, vy, dx: 0, dy: 0, last: performance.now() };
    panRef.current = started;
    started.raf = requestAnimationFrame(panFrame);
  };

  return { autoPanFrom, stopAutoPan };
}
