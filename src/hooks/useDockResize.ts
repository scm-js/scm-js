import { useCallback, useRef, useState, type PointerEvent } from "react";
import { zoomOf } from "../components/ui/interfaceSize";

/**
 * Pointer-drag resizing for a dock. `side` is where the dock sits, so dragging
 * the handle away from that side grows it. `max` may be a function, read when a
 * drag starts (a share of the window, say).
 *
 * The handle captures the pointer: a drag that crosses an iframe (a plugin's map
 * view) still reaches it, and its release always ends the drag. The width is set
 * at most once a frame, since each change lays out the map again.
 *
 * The width is the dock's own pixels, which at a larger interface size are larger than the
 * page's: the pointer's travel is divided by the dock's zoom, so the edge stays under the
 * pointer, and `max` as a function is handed that zoom to work in the same pixels.
 */
export function useDockResize(side: "left" | "right", width: number, setWidth: (w: number) => void, min = 180, max: number | ((zoom: number) => number) = 520) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; w: number; zoom: number; max: number; next: number | null; raf: number } | null>(null);

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
      const zoom = zoomOf(e.currentTarget);
      drag.current = { x: e.clientX, w: width, zoom, max: typeof max === "function" ? max(zoom) : max, next: null, raf: 0 };
      setDragging(true);
      document.body.classList.add("dock-resizing");
    },
    [width, max],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = (e.clientX - d.x) / d.zoom;
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
