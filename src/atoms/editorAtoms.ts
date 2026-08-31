import { atom } from "jotai";

/* ── Editor view state ──────────────────────────────────── */

export type EditorScreen = "splash" | "editor";

/** Which screen is currently active */
export const screenAtom = atom<EditorScreen>("splash");

/** Currently selected tool in the editor toolbar */
export type EditorTool =
  | "select"
  | "terrain"
  | "doodads"
  | "units"
  | "locations"
  | "sprites"
  | "fog";

export const activeToolAtom = atom<EditorTool>("terrain");

/** Currently selected tileset / terrain brush index */
export const activeBrushAtom = atom<number>(0);

/** Zoom level for the map viewport (1 = 100%) */
export const zoomAtom = atom<number>(1);

/** Map dimensions (in tiles) */
export const mapWidthAtom = atom<number>(128);
export const mapHeightAtom = atom<number>(128);

/** Map name */
export const mapNameAtom = atom<string>("Untitled Map");

/** Cursor tile position */
export const cursorTileAtom = atom<{ x: number; y: number }>({ x: 0, y: 0 });
