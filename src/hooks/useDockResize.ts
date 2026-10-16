import { useCallback, useRef, useState, type PointerEvent } from "react";

/**
 * Pointer-drag resizing for a dock. `side` is where the dock sits, so dragging
 * the handle away from that side grows it. `max` may be a function, read when a
 * drag starts (a share of the window, say).
 *
 * The handle captures the pointer: a drag that crosses an iframe (a plugin's map
 * view) still reaches it, and its release always ends the drag. The width is set
 * at most once a frame, since each change lays out the map again.
 */
export function useDockResize(side: "left" | "right", width: number, setWidth: (w: number) => void, min = 180, max: number | (() => number) = 520) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; max: number; next: number | null; raf: number } | null>(null);

  const end = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    cancelAnimationFrame(d.raf);
    if (d.next !== null) setWidth(d.next);
    drag.current = null;
    setDragging(false);
    document.body.classList.remove("dock-resizing");
  }, [setWidth]);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { x: e.clientX, w: width, max: typeof max === "function" ? max() : max, next: null, raf: 0 };
      setDragging(true);
      document.body.classList.add("dock-resizing");
    },
    [width, max],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      d.next = Math.round(Math.min(d.max, Math.max(min, side === "left" ? d.w + dx : d.w - dx)));
      if (d.raf) return;
      d.raf = requestAnimationFrame(() => {
        d.raf = 0;
        if (drag.current === d && d.next !== null) setWidth(d.next);
      });
    },
    [side, min, setWidth],
  );

  // (Losing the capture ends the drag too: a pointer cancelled, or the handle gone.)
  const handlers = { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end };
  return { dragging, ...handlers };
}
