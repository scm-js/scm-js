/**
 * Resize / crop the map in place.
 *
 * Not an undoable edit — like the settings dialogs it is a transaction, and the caller
 * (`resizeDocumentAtom`) drops the history. Existing content keeps its position relative
 * to the chosen anchor: the offset `dx` is kept *even* so StarEdit's left/right tile
 * pairs stay on their columns. Terrain outside the new bounds is cropped; units, sprites
 * and doodads whose position falls outside are dropped (a doodad's tiles are already part
 * of MTXM, so its record simply goes); locations are shifted and, on request, clamped —
 * never dropped, since triggers name them by slot. Anywhere is reset to the new bounds.
 * ISOM is rebuilt from the tiles when the tileset is loaded (exact for StarEdit terrain),
 * else replaced by the flat fill's lattice — the diamond grid's parity does not survive
 * an arbitrary shift.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed } from "../formats/chk/sections/objects";
import type { Tileset } from "../formats/tileset/decode";
import { flatTerrain, type BaseTerrain } from "../formats/tileset/terrain";
import { rebuildIsomFromTiles } from "./isom";
import { anywhereBounds } from "./locations";
import { TILE_PX } from "./units";

export interface ResizeOptions {
  width: number;
  height: number;
  /** 3×3 grid, row-major: 0 top-left … 4 centre … 8 bottom-right. */
  anchor: number;
  /** Terrain the new area is filled with. */
  fill: BaseTerrain;
  tileset: Tileset | null;
  /** ERA of the map, for the ISOM numbering of the fill. */
  era: number;
  /** Pull locations that hang past the new edge back inside; off leaves them where the shift put them. */
  clampLocations: boolean;
  random?: () => number;
}

export interface ResizeResult {
  dx: number;
  dy: number;
  unitsDropped: number;
  spritesDropped: number;
  doodadsDropped: number;
  locationsClamped: number;
  /** True when ISOM was reconstructed from the tiles; false when it is the flat fill's lattice. */
  isomRebuilt: boolean;
}

/** Tile offset of the old map inside the new one for an anchor; `dx` is even. */
export function resizeOffset(oldW: number, oldH: number, newW: number, newH: number, anchor: number): { dx: number; dy: number } {
  const ax = anchor % 3, ay = Math.floor(anchor / 3);
  const along = (a: number, oldN: number, newN: number) => (a === 0 ? 0 : a === 2 ? newN - oldN : Math.trunc((newN - oldN) / 2));
  let dx = along(ax, oldW, newW);
  const dy = along(ay, oldH, newH);
  // Round toward zero to the next even value: the pair columns stay aligned and nothing lands off the anchor edge.
  if (dx % 2 !== 0) dx -= Math.sign(dx);
  return { dx, dy };
}

/** What a resize would drop or clamp, without doing it — for the dialog's preview line. */
export function resizePreview(scn: Scenario, width: number, height: number, anchor: number): Omit<ResizeResult, "isomRebuilt" | "locationsClamped"> & { locationsClamped: number } {
  const { dx, dy } = resizeOffset(scn.width, scn.height, width, height, anchor);
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width * TILE_PX && y < height * TILE_PX;
  const px = dx * TILE_PX, py = dy * TILE_PX;
  let locationsClamped = 0;
  scn.locations.forEach((l, i) => {
    if (i === ANYWHERE_INDEX || !isLocationUsed(l)) return;
    const xs = [l.left + px, l.right + px], ys = [l.top + py, l.bottom + py];
    if (xs.some((x) => x < 0 || x > width * TILE_PX) || ys.some((y) => y < 0 || y > height * TILE_PX)) locationsClamped++;
  });
  return {
    dx, dy,
    unitsDropped: scn.units.filter((u) => !inside(u.x + px, u.y + py)).length,
    spritesDropped: scn.sprites.filter((s) => !inside(s.x + px, s.y + py)).length,
    doodadsDropped: scn.doodads.filter((d) => !inside(d.x + px, d.y + py)).length,
    locationsClamped,
  };
}

export function resizeScenario(scn: Scenario, options: ResizeOptions): ResizeResult {
  const { width, height, fill, tileset, era, clampLocations, random = Math.random } = options;
  const oldW = scn.width, oldH = scn.height;
  const { dx, dy } = resizeOffset(oldW, oldH, width, height, options.anchor);
  const px = dx * TILE_PX, py = dy * TILE_PX;

  // Terrain: the fill everywhere, then the old map copied over where it overlaps.
  const flat = flatTerrain(width, height, fill, tileset, random, era);
  const tiles = flat.tiles;
  const editorTiles = new Uint16Array(flat.tiles);
  const mask = scn.mask ? new Uint8Array(width * height).fill(0xff) : null;
  const x0 = Math.max(0, -dx), x1 = Math.min(oldW, width - dx);
  const y0 = Math.max(0, -dy), y1 = Math.min(oldH, height - dy);
  for (let y = y0; y < y1; y++) {
    const from = y * oldW, to = (y + dy) * width + dx;
    for (let x = x0; x < x1; x++) {
      tiles[to + x] = scn.tiles[from + x];
      editorTiles[to + x] = scn.editorTiles[from + x];
      if (mask) mask[to + x] = scn.mask![from + x];
    }
  }
  scn.width = width;
  scn.height = height;
  scn.tiles = tiles;
  scn.editorTiles = editorTiles;
  if (mask) scn.mask = mask;

  let isomRebuilt = false;
  if (scn.isom) {
    if (tileset) {
      scn.isom = rebuildIsomFromTiles(scn, tileset).isom;
      isomRebuilt = true;
    } else {
      scn.isom = flat.isom;
    }
  }

  // Objects: shift, and drop what lands outside.
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width * TILE_PX && y < height * TILE_PX;
  const unitsBefore = scn.units.length, spritesBefore = scn.sprites.length, doodadsBefore = scn.doodads.length;
  scn.units = scn.units.map((u) => ({ ...u, x: u.x + px, y: u.y + py })).filter((u) => inside(u.x, u.y));
  scn.sprites = scn.sprites.map((s) => ({ ...s, x: s.x + px, y: s.y + py })).filter((s) => inside(s.x, s.y));
  scn.doodads = scn.doodads.map((d) => ({ ...d, x: d.x + px, y: d.y + py })).filter((d) => inside(d.x, d.y));

  // Locations: shift every slot in use; clamp on request; Anywhere is the map again.
  let locationsClamped = 0;
  const clampX = (v: number) => Math.max(0, Math.min(width * TILE_PX, v));
  const clampY = (v: number) => Math.max(0, Math.min(height * TILE_PX, v));
  scn.locations = scn.locations.map((l, i) => {
    if (i === ANYWHERE_INDEX) return isLocationUsed(l) ? { ...l, ...anywhereBounds(scn) } : l;
    if (!isLocationUsed(l)) return l;
    const moved = { ...l, left: l.left + px, right: l.right + px, top: l.top + py, bottom: l.bottom + py };
    if (!clampLocations) return moved;
    const clamped = { ...moved, left: clampX(moved.left), right: clampX(moved.right), top: clampY(moved.top), bottom: clampY(moved.bottom) };
    if (clamped.left !== moved.left || clamped.right !== moved.right || clamped.top !== moved.top || clamped.bottom !== moved.bottom) locationsClamped++;
    return clamped;
  });

  markDirty(scn, "DIM ", "MTXM", "TILE", "UNIT", "THG2", "DD2 ", "MRGN");
  if (scn.isom) markDirty(scn, "ISOM");
  if (scn.mask) markDirty(scn, "MASK");

  return {
    dx, dy,
    unitsDropped: unitsBefore - scn.units.length,
    spritesDropped: spritesBefore - scn.sprites.length,
    doodadsDropped: doodadsBefore - scn.doodads.length,
    locationsClamped,
    isomRebuilt,
  };
}
