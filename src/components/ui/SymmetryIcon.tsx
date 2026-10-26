import { symmetryAxes, type SymmetryMode } from "../../editor/symmetry";

/** A mode drawn small: the map's outline, its mirror lines and the centre a rotation turns about. */
export function SymmetryIcon({ mode, size = 14 }: { mode: SymmetryMode; size?: number }) {
  const { lines, centre } = symmetryAxes(mode, 12, 12);
  return (
    <svg width={size} height={size} viewBox="-1 -1 14 14" aria-hidden="true">
      <rect x="0" y="0" width="12" height="12" fill="none" stroke="currentColor" strokeOpacity="0.45" />
      {lines.map((l, i) => <line key={i} x1={l.x0} y1={l.y0} x2={l.x1} y2={l.y1} stroke="currentColor" strokeWidth="1.4" />)}
      {centre && <circle cx="6" cy="6" r="1.8" fill="currentColor" />}
    </svg>
  );
}
