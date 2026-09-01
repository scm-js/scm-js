import { useCallback, useState, type PointerEvent } from "react";

/**
 * Pointer-drag resizing for a dock. `side` is where the dock sits, so dragging
 * the handle away from that side grows it.
 */
export function useDockResize(side: "left" | "right", width: number, setWidth: (w: number) => void, min = 180, max = 520) {
  const [dragging, setDragging] = useState(false);

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      setDragging(true);
      const move = (ev: globalThis.PointerEvent) => {
        const dx = ev.clientX - startX;
        const next = side === "left" ? startW + dx : startW - dx;
        setWidth(Math.round(Math.min(max, Math.max(min, next))));
      };
      const up = () => {
        setDragging(false);
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [side, width, setWidth, min, max],
  );

  return { dragging, onPointerDown };
}
