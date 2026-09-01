/**
 * The tileset's doodad catalogue: what the Doodads palette lists and what placement
 * stamps onto the map.
 *
 * A doodad is a rectangle of CV5 doodad groups (see `Cv5Doodad`): one group per row,
 * one megatile slot per column, every group repeating the doodad's `ddData` index,
 * width and height. Two more files describe it:
 *
 *   - `tileset\<name>\dddata.bin` — 512 entries of 256 u16, indexed by `ddData`: for
 *     each cell (row-major, stride `width`) the CV5 group that must already be under it
 *     for StarEdit to allow the placement, or 0 for "anything". This is how a ramp only
 *     fits on the cliff edge it was drawn for. Cells can be required yet carry no
 *     megatile (the ramp's approach), or carry a megatile with no requirement.
 *   - `rez\stat_txt.tbl` — the category name each group's `nameIndex` points at.
 *
 * DD2 records store the `ddData` index, so it is the doodad's id here too.
 */
import { DOODAD_GROUP_INDEX, megatileForTile, TileFlag, type Tileset } from "./decode";

export interface DoodadDef {
  /** The `dddata.bin` index, which DD2 records store. */
  id: number;
  /** First CV5 group; row `r` is group `group + r`, column `c` is slot `c`. */
  group: number;
  width: number;
  height: number;
  /** Palette category, from stat_txt.tbl; "Unlisted" for groups without a name. */
  category: string;
  /** The first group's CV5 flag word — copied onto the overlay's THG2 record, as StarEdit does. */
  flags: number;
  /** The sprite (or unit) drawn over the tiles, or null. */
  overlay: DoodadOverlay | null;
  /** MTXM id per cell, row-major; 0 where the doodad leaves the ground alone. */
  tiles: Uint16Array;
  /** CV5 group required under each cell, row-major; 0 = no requirement. */
  required: Uint16Array;
  /**
   * Whether any of its minitiles carries the VF4 ramp bit. StarEdit files ramps under the
   * cliff categories with no name of their own; this is the only way to tell them apart.
   */
  ramp: boolean;
}

export interface DoodadOverlay {
  kind: "sprite" | "unit";
  /** sprites.dat or units.dat id. */
  id: number;
  flipped: boolean;
}

export interface DoodadCategory {
  name: string;
  doodads: DoodadDef[];
}

export interface DoodadCatalogue {
  doodads: DoodadDef[];
  byId: Map<number, DoodadDef>;
  /** In first-appearance order, the way StarEdit's category drop-down lists them; "Unlisted" last. */
  categories: DoodadCategory[];
  /** Whether dddata.bin was available; without it nothing is ever refused for its ground. */
  hasPlacementData: boolean;
}

function isRampMegatile(tileset: Tileset, megatile: number): boolean {
  const base = megatile * 16;
  for (let i = 0; i < 16; i++) if (tileset.megatileFlags[base + i] & TileFlag.Ramp) return true;
  return false;
}

export const DDDATA_ENTRY_CELLS = 256;
export const DDDATA_ENTRIES = 512;
export const DDDATA_SIZE = DDDATA_ENTRIES * DDDATA_ENTRY_CELLS * 2;
const UNLISTED = "Unlisted";

const SPRITE_OVERLAY = 0x1000;
const UNIT_OVERLAY = 0x2000;
const OVERLAY_FLIPPED = 0x4000;

/**
 * Read the doodads out of the CV5. `dddata` may be null (no requirements) and `names`
 * the decoded stat_txt.tbl or null (one anonymous category).
 */
export function buildDoodadCatalogue(tileset: Tileset, dddata: Uint8Array | null, names: readonly string[] | null): DoodadCatalogue {
  const { groups } = tileset;
  const data = dddata && dddata.length >= DDDATA_SIZE ? new DataView(dddata.buffer, dddata.byteOffset, dddata.byteLength) : null;
  const doodads: DoodadDef[] = [];
  const byId = new Map<number, DoodadDef>();

  for (let g = 0; g < groups.length; g++) {
    const cv5 = groups[g];
    const d = cv5.doodad;
    if (!d || cv5.index !== DOODAD_GROUP_INDEX) continue;
    if (byId.has(d.ddData)) continue; // a later row of a doodad already read
    if (d.width === 0 || d.height === 0 || d.width > 16) continue;
    const cells = d.width * d.height;
    const tiles = new Uint16Array(cells);
    const required = new Uint16Array(cells);
    let any = false;
    for (let row = 0; row < d.height; row++) {
      const rowGroup = groups[g + row];
      // A doodad's rows are consecutive groups sharing its ddData; anything else is a
      // truncated table, in which case the missing rows stay empty.
      if (!rowGroup || rowGroup.doodad?.ddData !== d.ddData) continue;
      for (let col = 0; col < d.width; col++) {
        const id = ((g + row) << 4) | col;
        if (megatileForTile(tileset, id) > 0) { tiles[row * d.width + col] = id; any = true; }
      }
    }
    if (!any) continue;
    if (data && d.ddData < DDDATA_ENTRIES) {
      const base = d.ddData * DDDATA_ENTRY_CELLS * 2;
      for (let i = 0; i < cells && i < DDDATA_ENTRY_CELLS; i++) required[i] = data.getUint16(base + i * 2, true);
    }
    const name = names && d.nameIndex > 0 ? names[d.nameIndex - 1] : undefined;
    let overlay: DoodadOverlay | null = null;
    if (cv5.flags & SPRITE_OVERLAY) overlay = { kind: "sprite", id: d.overlay, flipped: (cv5.flags & OVERLAY_FLIPPED) !== 0 };
    else if (cv5.flags & UNIT_OVERLAY) overlay = { kind: "unit", id: d.overlay, flipped: (cv5.flags & OVERLAY_FLIPPED) !== 0 };
    const def: DoodadDef = {
      id: d.ddData, group: g, width: d.width, height: d.height,
      category: name?.trim() || UNLISTED, flags: cv5.flags, overlay, tiles, required,
      ramp: tiles.some((t) => t !== 0 && isRampMegatile(tileset, megatileForTile(tileset, t))),
    };
    doodads.push(def);
    byId.set(def.id, def);
  }

  const categories: DoodadCategory[] = [];
  const byName = new Map<string, DoodadCategory>();
  for (const def of doodads) {
    let cat = byName.get(def.category);
    if (!cat) {
      cat = { name: def.category, doodads: [] };
      byName.set(def.category, cat);
      categories.push(cat);
    }
    cat.doodads.push(def);
  }
  const unlisted = categories.findIndex((c) => c.name === UNLISTED);
  if (unlisted >= 0) categories.push(...categories.splice(unlisted, 1));

  return { doodads, byId, categories, hasPlacementData: data !== null };
}

/** An empty catalogue, for when the tileset graphics are missing. */
export const NO_DOODADS: DoodadCatalogue = { doodads: [], byId: new Map(), categories: [], hasPlacementData: false };

/** The doodad a CV5 group belongs to, or null for terrain groups. */
export function doodadOfGroup(catalogue: DoodadCatalogue, group: number): DoodadDef | null {
  for (const def of catalogue.doodads) if (group >= def.group && group < def.group + def.height) return def;
  return null;
}

/** Row-major cell index of tile column `col`, row `row`. */
export const doodadCell = (def: DoodadDef, col: number, row: number) => row * def.width + col;

/**
 * Top-left tile of a doodad whose DD2 record puts its centre at pixel (x, y). Odd sizes
 * put the centre mid-tile, which is why the division rounds.
 */
export function doodadOrigin(def: DoodadDef, x: number, y: number): { x: number; y: number } {
  return { x: Math.round(x / 32 - def.width / 2), y: Math.round(y / 32 - def.height / 2) };
}

/** The DD2 (and overlay THG2) pixel position of a doodad placed with its top-left tile at (tx, ty). */
export function doodadCenter(def: DoodadDef, tx: number, ty: number): { x: number; y: number } {
  return { x: tx * 32 + def.width * 16, y: ty * 32 + def.height * 16 };
}
