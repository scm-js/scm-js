/**
 * Doodad edits: placing, removing and moving the tile-based doodads StarEdit records in
 * `DD2 `, as invertible change lists in the spirit of `TileChange` / `UnitChange`.
 *
 * A placed doodad is three things in the file, and an edit touches all of them:
 *
 *   - its megatiles stamped into MTXM (`scenario.tiles`) — but *not* into TILE
 *     (`scenario.editorTiles`), which keeps the ground beneath so removal can restore it;
 *   - a `DD2 ` record with the dddata index and the footprint's pixel centre;
 *   - for doodads with an overlay (tree canopies, Installation doors), a `THG2` sprite at
 *     the same centre carrying the doodad's CV5 flag word, exactly as StarEdit writes it.
 *
 * Placement follows StarEdit's rules unless "place anywhere" is on: every cell with a
 * requirement in dddata.bin must sit on exactly that CV5 group, no cell may land on
 * another doodad's tile, and the footprint must be inside the map (that last one always
 * holds — tiles cannot be written off the edge). "Snap to grid" keeps the left column
 * even, which is where StarEdit puts every doodad (the isometric lattice is two tiles
 * wide) and what the requirement tables are drawn for.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { SpriteFlag, type DoodadRecord, type SpriteRecord } from "../formats/chk/sections/objects";
import { DOODAD_GROUP_INDEX, megatileForTile, type Tileset } from "../formats/tileset/decode";
import { doodadCenter, doodadOrigin, type DoodadCatalogue, type DoodadDef } from "../formats/tileset/doodads";
import { pickVariation, variationsOf } from "../formats/tileset/terrain";
import { Stroke, type TileChange } from "./terrain";

export interface DoodadChange {
  index: number;
  before: DoodadRecord | null;
  after: DoodadRecord | null;
}

export interface SpriteChange {
  index: number;
  before: SpriteRecord | null;
  after: SpriteRecord | null;
}

/** Everything one doodad edit changes; each list undoes in reverse. */
export interface DoodadEdit {
  /** MTXM-only tile changes (apply with `applyChanges(…, "mtxm")`). */
  tiles: TileChange[];
  doodads: DoodadChange[];
  sprites: SpriteChange[];
}

export function applyDoodadChanges(scn: Scenario, changes: readonly DoodadChange[], direction: "do" | "undo" = "do") {
  applyList(scn.doodads, changes, direction);
  if (changes.length > 0) markDirty(scn, "DD2 ");
}

export function applySpriteChanges(scn: Scenario, changes: readonly SpriteChange[], direction: "do" | "undo" = "do") {
  applyList(scn.sprites, changes, direction);
  if (changes.length > 0) markDirty(scn, "THG2");
}

/** Insert / remove / replace on an in-place list; removals are listed highest index first. */
function applyList<T>(list: T[], changes: readonly { index: number; before: T | null; after: T | null }[], direction: "do" | "undo") {
  const ordered = direction === "do" ? changes : [...changes].reverse();
  for (const c of ordered) {
    const before = direction === "do" ? c.before : c.after;
    const after = direction === "do" ? c.after : c.before;
    if (before && after) list[c.index] = after;
    else if (after) list.splice(c.index, 0, after);
    else if (before) list.splice(c.index, 1);
  }
}

/* ── Options and geometry ────────────────────────────────── */

export interface DoodadPlacementOptions {
  /** Skip StarEdit's ground check: any doodad goes on any terrain, even over another doodad. */
  placeAnywhere: boolean;
  /** Keep the left column on an even tile, as StarEdit always does. */
  snapToGrid: boolean;
}

export const DEFAULT_DOODAD_PLACEMENT: DoodadPlacementOptions = { placeAnywhere: false, snapToGrid: true };

export interface TileRect {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** The tiles a placed doodad covers. */
export function doodadFootprint(def: DoodadDef, rec: DoodadRecord): TileRect {
  const o = doodadOrigin(def, rec.x, rec.y);
  return { x0: o.x, y0: o.y, x1: o.x + def.width, y1: o.y + def.height };
}

/**
 * Top-left tile for a doodad dropped with the pointer at map pixel (px, py): the
 * footprint is centred on the pointer, the left column made even when snapping, and the
 * whole thing kept inside the map (a snapped doodad that cannot fit evenly stays even
 * and one tile short of the right edge).
 */
export function snapDoodad(def: DoodadDef, px: number, py: number, mapW: number, mapH: number, snap = true): { x: number; y: number } {
  // Nearest multiple of `step`, a tie going to the lower one, so an even-width doodad
  // under a pointer mid-tile does not jump right.
  const nearest = (v: number, step: number) => Math.ceil(v / step - 0.5) * step;
  let x = nearest(px / 32 - def.width / 2, snap ? 2 : 1);
  let y = nearest(py / 32 - def.height / 2, 1);
  const maxX = mapW - def.width;
  const maxY = mapH - def.height;
  x = Math.min(maxX, Math.max(0, x));
  if (snap && x % 2 !== 0) x = Math.max(0, x - 1);
  y = Math.min(maxY, Math.max(0, y));
  return { x, y };
}

/* ── Placement checks ────────────────────────────────────── */

export interface DoodadVerdict {
  ok: boolean;
  /** The footprint leaves the map (never allowed). */
  outOfBounds: boolean;
  /** Cell indices (row-major) whose ground fails the check, for the ghost to mark red. */
  bad: number[];
}

/**
 * May `def` go with its top-left tile at (tx, ty)? `tileAt` overrides what a cell
 * currently holds — a move passes the map as it would be with the moving doodads gone.
 */
export function checkDoodadPlacement(
  scn: Scenario, tileset: Tileset | null, def: DoodadDef, tx: number, ty: number, opts: DoodadPlacementOptions,
  tileAt: (at: number) => number = (at) => scn.tiles[at],
): DoodadVerdict {
  if (tx < 0 || ty < 0 || tx + def.width > scn.width || ty + def.height > scn.height) return { ok: false, outOfBounds: true, bad: [] };
  const bad: number[] = [];
  if (!opts.placeAnywhere) {
    for (let row = 0; row < def.height; row++) {
      for (let col = 0; col < def.width; col++) {
        const cell = row * def.width + col;
        const required = def.required[cell];
        if (required === 0 && def.tiles[cell] === 0) continue;
        const id = tileAt((ty + row) * scn.width + tx + col);
        const group = id >> 4;
        if (required !== 0 && group !== required) { bad.push(cell); continue; }
        // No requirement, but the cell gets a tile: it must not bury another doodad.
        if (def.tiles[cell] !== 0 && tileset?.groups[group]?.index === DOODAD_GROUP_INDEX) bad.push(cell);
      }
    }
  }
  return { ok: bad.length === 0, outOfBounds: false, bad };
}

/* ── Building edits ──────────────────────────────────────── */

export function makeDoodad(def: DoodadDef, tx: number, ty: number, owner: number): DoodadRecord {
  const c = doodadCenter(def, tx, ty);
  return { doodadId: def.id, x: c.x, y: c.y, owner, disabled: 0 };
}

/** The THG2 record StarEdit adds for a doodad's overlay, or null when it has none. */
export function makeOverlaySprite(def: DoodadDef, rec: DoodadRecord): SpriteRecord | null {
  if (!def.overlay) return null;
  return { spriteId: def.overlay.id, x: rec.x, y: rec.y, owner: rec.owner, unused: 0, flags: def.flags };
}

/** Index of the THG2 record that is this doodad's overlay, or -1. */
export function overlaySpriteIndex(scn: Scenario, def: DoodadDef, rec: DoodadRecord, taken?: ReadonlySet<number>): number {
  if (!def.overlay) return -1;
  const pure = def.overlay.kind === "sprite";
  return scn.sprites.findIndex((s, i) =>
    !taken?.has(i) && s.spriteId === def.overlay!.id && s.x === rec.x && s.y === rec.y && ((s.flags & SpriteFlag.PureSprite) !== 0) === pure);
}

/**
 * Stamp `def` at (tx, ty): its tiles into MTXM, a DD2 record and, if it has one, the
 * overlay sprite. `tileAt` is what the cells hold right now (a move passes the state
 * with the old copy removed). Nothing is applied.
 */
export function placeDoodad(scn: Scenario, def: DoodadDef, tx: number, ty: number, owner: number, tileAt: (at: number) => number = (at) => scn.tiles[at]): DoodadEdit {
  const tiles: TileChange[] = [];
  for (let row = 0; row < def.height; row++) {
    for (let col = 0; col < def.width; col++) {
      const id = def.tiles[row * def.width + col];
      if (id === 0) continue;
      const at = (ty + row) * scn.width + tx + col;
      const before = tileAt(at);
      if (before !== id) tiles.push({ at, before, after: id });
    }
  }
  const rec = makeDoodad(def, tx, ty, owner);
  const sprite = makeOverlaySprite(def, rec);
  return {
    tiles,
    doodads: [{ index: scn.doodads.length, before: null, after: rec }],
    sprites: sprite ? [{ index: scn.sprites.length, before: null, after: sprite }] : [],
  };
}

/**
 * What a doodad cell goes back to when the doodad leaves: the ground TILE kept under it,
 * or — when TILE holds a doodad tile too (a map from an editor that writes doodads into
 * both sections) — a fresh tile of the group dddata says belongs there. With nothing
 * better to go on the cell keeps its tile.
 */
export function groundUnder(scn: Scenario, tileset: Tileset | null, def: DoodadDef, cell: number, at: number, random: () => number = Math.random): number {
  const under = scn.editorTiles[at];
  const underGroup = tileset?.groups[under >> 4];
  if (!tileset || (underGroup && underGroup.index !== DOODAD_GROUP_INDEX && megatileForTile(tileset, under) > 0)) return under;
  const required = def.required[cell];
  if (required !== 0 && tileset.groups[required]) return (required << 4) | pickVariation(variationsOf(tileset, required), random);
  return scn.tiles[at];
}

/**
 * Take the doodads at `indices` off the map: their cells go back to the ground beneath
 * (only where the cell still shows that doodad's tile), their records go, and so do
 * their overlay sprites. Removals are ordered highest index first.
 */
export function removeDoodads(scn: Scenario, tileset: Tileset | null, catalogue: DoodadCatalogue, indices: Iterable<number>, random: () => number = Math.random): DoodadEdit {
  const stroke = new Stroke();
  const doodads: DoodadChange[] = [];
  const spriteIndices = new Set<number>();
  for (const i of [...new Set(indices)].sort((a, b) => b - a)) {
    const rec = scn.doodads[i];
    if (!rec) continue;
    doodads.push({ index: i, before: rec, after: null });
    const def = catalogue.byId.get(rec.doodadId);
    if (!def) continue;
    const o = doodadOrigin(def, rec.x, rec.y);
    for (let row = 0; row < def.height; row++) {
      for (let col = 0; col < def.width; col++) {
        const cell = row * def.width + col;
        const id = def.tiles[cell];
        const x = o.x + col, y = o.y + row;
        if (id === 0 || x < 0 || y < 0 || x >= scn.width || y >= scn.height) continue;
        const at = y * scn.width + x;
        if (scn.tiles[at] !== id) continue; // something else was laid over it since
        const after = groundUnder(scn, tileset, def, cell, at, random);
        if (after !== id) stroke.add([{ at, before: id, after }]);
      }
    }
    const s = overlaySpriteIndex(scn, def, rec, spriteIndices);
    if (s >= 0) spriteIndices.add(s);
  }
  const sprites = [...spriteIndices].sort((a, b) => b - a).map((index) => ({ index, before: scn.sprites[index], after: null }));
  return { tiles: stroke.finish(), doodads, sprites };
}

/** Replace fields on the doodads at `indices` (and mirror owner / disabled onto their overlay sprites). */
export function updateDoodads(scn: Scenario, catalogue: DoodadCatalogue, indices: number[], patch: Partial<Pick<DoodadRecord, "owner" | "disabled">>): DoodadEdit {
  const doodads: DoodadChange[] = [];
  const sprites: SpriteChange[] = [];
  for (const i of new Set(indices)) {
    const before = scn.doodads[i];
    if (!before) continue;
    const after = { ...before, ...patch };
    if (after.owner === before.owner && after.disabled === before.disabled) continue;
    doodads.push({ index: i, before, after });
    const def = catalogue.byId.get(before.doodadId);
    const s = def ? overlaySpriteIndex(scn, def, before) : -1;
    if (s >= 0) {
      const sb = scn.sprites[s];
      const flags = after.disabled ? sb.flags | SpriteFlag.Disabled : sb.flags & ~SpriteFlag.Disabled;
      const sa = { ...sb, owner: after.owner, flags };
      if (sa.owner !== sb.owner || sa.flags !== sb.flags) sprites.push({ index: s, before: sb, after: sa });
    }
  }
  return { tiles: [], doodads, sprites };
}

/* ── Picking ─────────────────────────────────────────────── */

/** Index of the topmost (last placed) doodad with a tile on (tx, ty), or -1. */
export function doodadAt(scn: Scenario, catalogue: DoodadCatalogue, tx: number, ty: number): number {
  for (let i = scn.doodads.length - 1; i >= 0; i--) {
    const rec = scn.doodads[i];
    const def = catalogue.byId.get(rec.doodadId);
    if (!def) continue;
    const o = doodadOrigin(def, rec.x, rec.y);
    const col = tx - o.x, row = ty - o.y;
    if (col < 0 || row < 0 || col >= def.width || row >= def.height) continue;
    if (def.tiles[row * def.width + col] !== 0) return i;
  }
  return -1;
}

/** Indices of doodads whose footprint intersects the tile rectangle (inclusive corners). */
export function doodadsInBox(scn: Scenario, catalogue: DoodadCatalogue, box: TileRect): number[] {
  const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1);
  const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
  const out: number[] = [];
  scn.doodads.forEach((rec, i) => {
    const def = catalogue.byId.get(rec.doodadId);
    if (!def) return;
    const f = doodadFootprint(def, rec);
    if (f.x1 - 1 >= x0 && f.x0 <= x1 && f.y1 - 1 >= y0 && f.y0 <= y1) out.push(i);
  });
  return out;
}

/**
 * Doodads that lost a tile to a terrain edit at `changedTiles` (flat indices): any whose
 * cell no longer shows its own tile. The Terrain palette removes these in the same undo
 * step, so half a tree is never left behind with a record claiming it is whole.
 */
export function strandedDoodads(scn: Scenario, catalogue: DoodadCatalogue, changedTiles: Iterable<number>): number[] {
  const changed = changedTiles instanceof Set ? changedTiles : new Set(changedTiles);
  if (changed.size === 0) return [];
  const out: number[] = [];
  scn.doodads.forEach((rec, i) => {
    const def = catalogue.byId.get(rec.doodadId);
    if (!def) return;
    const o = doodadOrigin(def, rec.x, rec.y);
    for (let row = 0; row < def.height; row++) {
      for (let col = 0; col < def.width; col++) {
        const id = def.tiles[row * def.width + col];
        const x = o.x + col, y = o.y + row;
        if (id === 0 || x < 0 || y < 0 || x >= scn.width || y >= scn.height) continue;
        const at = y * scn.width + x;
        if (changed.has(at) && scn.tiles[at] !== id) { out.push(i); return; }
      }
    }
  });
  return out;
}
