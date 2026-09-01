/**
 * Cut / Copy / Paste: a rectangle of the map lifted into a `Clip` and stamped back down
 * anywhere, as one undo step each way.
 *
 * A clip is self-contained — tiles, ground, doodad / unit / sprite records and locations
 * with their positions made relative to the rectangle's top-left, plus the fog bytes —
 * so it survives the map it came from being closed. Which parts a copy captures and a
 * paste writes is the palette's *Include* set (`ClipParts`); a part that was never
 * captured is simply not there to paste.
 *
 * Terrain is carried as two layers, MTXM (`tiles`, the picture) and TILE (`ground`, the
 * terrain under the doodads), so a paste with doodads reproduces both sections as they
 * were, and a paste *without* them lays down the ground the doodads stood on rather than
 * half a tree. Doodads travel as records and are re-stamped from the catalogue at the
 * destination (overlay sprites regenerated, as `placeDoodad` does), units get fresh
 * serials with their add-on / nydus links remapped, and locations take free slots — the
 * only part that can run out of room. Objects belong to the rectangle by their anchor:
 * a unit or sprite by its centre, a doodad or location when its whole box is inside.
 *
 * `pasteClip` and `removeObjects` *apply* what they build, list by list, in the order
 * `editor/history.ts#applyEntry` replays them (terrain, doodad tiles, doodads, sprites,
 * units, locations, fog): every list is computed against the state the ones before it
 * leave behind, which is what makes the whole entry undo and redo cleanly. Nothing here
 * touches ISOM — like the Rect and Tile brushes, a paste is a non-isometric edit.
 */
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import {
  ANYWHERE_INDEX, isLocationUsed, type DoodadRecord, type LocationRecord, type SpriteRecord, type UnitRecord,
} from "../formats/chk/sections/objects";
import type { Tileset } from "../formats/tileset/decode";
import { doodadOrigin, type DoodadCatalogue } from "../formats/tileset/doodads";
import { applyChanges, type Rect, type TileChange } from "./terrain";
import { applyUnitChanges, nextSerial, removeUnits, TILE_PX, type UnitChange } from "./units";
import { applySpriteChanges, removeSprites, type SpriteChange } from "./sprites";
import {
  applyDoodadChanges, doodadFootprint, makeOverlaySprite, overlaySpriteIndex, removeDoodads, type DoodadChange,
} from "./doodads";
import { addLocation, applyLocationChanges, boundsOf, ensureLocationSlots, locationName, removeLocations, type LocationChange } from "./locations";
import { applyFogChanges, ensureMask } from "./fog";
import type { HistoryEdit } from "./history";

/* ── Model ───────────────────────────────────────────────── */

export type ClipPart = "terrain" | "doodads" | "units" | "sprites" | "locations" | "fog";
export const CLIP_PARTS: readonly ClipPart[] = ["terrain", "doodads", "units", "sprites", "locations", "fog"];
export type ClipParts = Record<ClipPart, boolean>;
/** What a copy takes by default: the picture and everything standing on it; locations and fog on request. */
export const DEFAULT_CLIP_PARTS: ClipParts = { terrain: true, doodads: true, units: true, sprites: true, locations: false, fog: false };
export const ALL_CLIP_PARTS: ClipParts = { terrain: true, doodads: true, units: true, sprites: true, locations: true, fog: true };

/** Whether a paste adds to what is in the target area or clears its objects first. */
export type PasteMode = "merge" | "replace";

export interface ClipLocation {
  /** Bounds in map pixels relative to the clip's origin (an inverted box keeps its inversion). */
  left: number;
  top: number;
  right: number;
  bottom: number;
  elevationFlags: number;
  name: string;
}

export interface Clip {
  /** Size in tiles. */
  width: number;
  height: number;
  /** ERA of the source map: tile ids mean nothing on another tileset. */
  era: number;
  /** MTXM ids, row-major, or null when terrain was not included. */
  tiles: Uint16Array | null;
  /** TILE ids (the ground under the doodads), alongside `tiles`. */
  ground: Uint16Array | null;
  /** Records with positions relative to the origin in map pixels. */
  doodads: DoodadRecord[];
  units: UnitRecord[];
  sprites: SpriteRecord[];
  locations: ClipLocation[];
  /** MASK bytes, row-major, or null when fog was not included. */
  fog: Uint8Array | null;
}

/** Indices of the objects a region (or a selection) holds. */
export interface ObjectSelection {
  units: number[];
  sprites: number[];
  doodads: number[];
  locations: number[];
}

export const EMPTY_SELECTION: ObjectSelection = { units: [], sprites: [], doodads: [], locations: [] };

export function selectionSize(sel: ObjectSelection): number {
  return sel.units.length + sel.sprites.length + sel.doodads.length + sel.locations.length;
}

/* ── Rectangles ──────────────────────────────────────────── */

/** A rectangle from two tile corners (inclusive), the way a marquee reports them. */
export function tileRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x) + 1, y1: Math.max(a.y, b.y) + 1 };
}

/** The part of `rect` inside the map (possibly empty: x1 <= x0). */
export function clampRect(rect: Rect, scn: { width: number; height: number }): Rect {
  return {
    x0: Math.max(0, rect.x0), y0: Math.max(0, rect.y0),
    x1: Math.min(scn.width, rect.x1), y1: Math.min(scn.height, rect.y1),
  };
}

export const rectEmpty = (r: Rect) => r.x1 <= r.x0 || r.y1 <= r.y0;

const inPixels = (r: Rect) => ({ left: r.x0 * TILE_PX, top: r.y0 * TILE_PX, right: r.x1 * TILE_PX, bottom: r.y1 * TILE_PX });

/**
 * The objects a tile rectangle holds: units and sprites by their centre, doodads and
 * locations when their whole box is inside. A doodad's overlay sprite is the doodad's,
 * not a sprite of its own, so it is left out of `sprites`.
 */
export function regionObjects(scn: Scenario, rect: Rect, catalogue: DoodadCatalogue): ObjectSelection {
  const px = inPixels(rect);
  const inside = (x: number, y: number) => x >= px.left && x < px.right && y >= px.top && y < px.bottom;
  const units: number[] = [];
  scn.units.forEach((u, i) => { if (inside(u.x, u.y)) units.push(i); });
  const doodads: number[] = [];
  const overlays = new Set<number>();
  scn.doodads.forEach((d, i) => {
    const def = catalogue.byId.get(d.doodadId);
    if (!def) return;
    const f = doodadFootprint(def, d);
    if (f.x0 < rect.x0 || f.y0 < rect.y0 || f.x1 > rect.x1 || f.y1 > rect.y1) return;
    doodads.push(i);
    const s = overlaySpriteIndex(scn, def, d, overlays);
    if (s >= 0) overlays.add(s);
  });
  const sprites: number[] = [];
  scn.sprites.forEach((s, i) => { if (!overlays.has(i) && inside(s.x, s.y)) sprites.push(i); });
  const locations: number[] = [];
  scn.locations.forEach((l, i) => {
    if (i === ANYWHERE_INDEX || !isLocationUsed(l)) return;
    const b = boundsOf(l);
    if (b.left >= px.left && b.top >= px.top && b.right <= px.right && b.bottom <= px.bottom) locations.push(i);
  });
  return { units, sprites, doodads, locations };
}

/** The smallest tile rectangle holding every object of a selection, or null for an empty one. */
export function selectionRect(scn: Scenario, sel: ObjectSelection, catalogue: DoodadCatalogue): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (r: Rect) => { x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1); };
  const point = (x: number, y: number) => grow({ x0: Math.floor(x / TILE_PX), y0: Math.floor(y / TILE_PX), x1: Math.floor(x / TILE_PX) + 1, y1: Math.floor(y / TILE_PX) + 1 });
  for (const i of sel.units) { const u = scn.units[i]; if (u) point(u.x, u.y); }
  for (const i of sel.sprites) { const s = scn.sprites[i]; if (s) point(s.x, s.y); }
  for (const i of sel.doodads) {
    const d = scn.doodads[i];
    const def = d && catalogue.byId.get(d.doodadId);
    if (def) grow(doodadFootprint(def, d));
  }
  for (const i of sel.locations) {
    const l = scn.locations[i];
    if (!l || !isLocationUsed(l)) continue;
    const b = boundsOf(l);
    grow({ x0: Math.floor(b.left / TILE_PX), y0: Math.floor(b.top / TILE_PX), x1: Math.ceil(b.right / TILE_PX), y1: Math.ceil(b.bottom / TILE_PX) });
  }
  if (x0 === Infinity) return null;
  return clampRect({ x0, y0, x1: Math.max(x1, x0 + 1), y1: Math.max(y1, y0 + 1) }, scn);
}

/* ── Copying ─────────────────────────────────────────────── */

function buildClip(scn: Scenario, rect: Rect, sel: ObjectSelection, parts: ClipParts, catalogue: DoodadCatalogue, withTerrain: boolean): Clip {
  const width = rect.x1 - rect.x0, height = rect.y1 - rect.y0;
  const ox = rect.x0 * TILE_PX, oy = rect.y0 * TILE_PX;
  const clip: Clip = { width, height, era: tilesetIndex(scn), tiles: null, ground: null, doodads: [], units: [], sprites: [], locations: [], fog: null };
  if (withTerrain && (parts.terrain || parts.fog)) {
    const tiles = parts.terrain ? new Uint16Array(width * height) : null;
    const ground = parts.terrain ? new Uint16Array(width * height) : null;
    const fog = parts.fog ? new Uint8Array(width * height) : null;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (rect.y0 + y) * scn.width + rect.x0 + x, cell = y * width + x;
        if (tiles && ground) { tiles[cell] = scn.tiles[at]; ground[cell] = scn.editorTiles[at]; }
        if (fog) fog[cell] = scn.mask ? scn.mask[at] : 0xff;
      }
    }
    clip.tiles = tiles; clip.ground = ground; clip.fog = fog;
  }
  if (parts.doodads) {
    for (const i of sel.doodads) {
      const d = scn.doodads[i];
      if (d && catalogue.byId.has(d.doodadId)) clip.doodads.push({ ...d, x: d.x - ox, y: d.y - oy });
    }
  }
  if (parts.units) for (const i of sel.units) { const u = scn.units[i]; if (u) clip.units.push({ ...u, x: u.x - ox, y: u.y - oy }); }
  if (parts.sprites) for (const i of sel.sprites) { const s = scn.sprites[i]; if (s) clip.sprites.push({ ...s, x: s.x - ox, y: s.y - oy }); }
  if (parts.locations) {
    for (const i of sel.locations) {
      const l = scn.locations[i];
      if (!l || !isLocationUsed(l)) continue;
      clip.locations.push({ left: l.left - ox, top: l.top - oy, right: l.right - ox, bottom: l.bottom - oy, elevationFlags: l.elevationFlags, name: locationName(scn, i) });
    }
  }
  return clip;
}

/** Copy a tile rectangle (clamped to the map) with the parts asked for; null when nothing of the rectangle is on the map. */
export function copyRegion(scn: Scenario, rect: Rect, parts: ClipParts, catalogue: DoodadCatalogue): Clip | null {
  const r = clampRect(rect, scn);
  if (rectEmpty(r)) return null;
  return buildClip(scn, r, regionObjects(scn, r, catalogue), parts, catalogue, true);
}

/**
 * Copy a selection of objects (an object layer's Ctrl+C): the clip's rectangle is their
 * bounding box and it carries just those objects — never terrain or fog, which are not
 * something one selects. Null for an empty selection.
 */
export function copyObjects(scn: Scenario, sel: ObjectSelection, parts: ClipParts, catalogue: DoodadCatalogue): Clip | null {
  const rect = selectionRect(scn, sel, catalogue);
  if (!rect) return null;
  return buildClip(scn, rect, sel, parts, catalogue, false);
}

/** What a clip holds, for the palette and the status bar: "12×8 tiles · 5 units · 2 doodads". */
export function clipSummary(clip: Clip): string {
  const n = (count: number, noun: string) => (count === 0 ? null : `${count} ${noun}${count === 1 ? "" : "s"}`);
  const parts = [
    clip.tiles ? `${clip.width}×${clip.height} tiles` : `${clip.width}×${clip.height} area`,
    n(clip.doodads.length, "doodad"),
    n(clip.units.length, "unit"),
    n(clip.sprites.length, "sprite"),
    n(clip.locations.length, "location"),
    clip.fog ? "fog" : null,
  ];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

/* ── Removing (Cut, Delete, Replace) ─────────────────────── */

const push = <T>(list: T[] | undefined, more: T[]): T[] => (list ? list.concat(more) : more);

/**
 * Take a selection of objects off the map, applied: doodads with their tiles and overlay
 * sprites (`removeDoodads`), then the remaining sprites, units and locations. Sprite
 * indices shift when an overlay goes, so the sprites to remove are followed by identity.
 */
export function removeObjects(scn: Scenario, sel: ObjectSelection, catalogue: DoodadCatalogue, tileset: Tileset | null, random: () => number = Math.random): HistoryEdit {
  const edit: HistoryEdit = { changes: [] };
  const spriteRecords = sel.sprites.map((i) => scn.sprites[i]).filter((s): s is SpriteRecord => s !== undefined);
  if (sel.doodads.length > 0) {
    const d = removeDoodads(scn, tileset, catalogue, sel.doodads, random);
    applyChanges(scn, d.tiles, "do", "mtxm");
    applyDoodadChanges(scn, d.doodads);
    applySpriteChanges(scn, d.sprites);
    if (d.tiles.length > 0) edit.doodadTiles = d.tiles;
    if (d.doodads.length > 0) edit.doodads = d.doodads;
    if (d.sprites.length > 0) edit.sprites = d.sprites;
  }
  if (spriteRecords.length > 0) {
    const sprites = removeSprites(scn, spriteRecords.map((r) => scn.sprites.indexOf(r)).filter((i) => i >= 0));
    applySpriteChanges(scn, sprites);
    if (sprites.length > 0) edit.sprites = push(edit.sprites, sprites);
  }
  if (sel.units.length > 0) {
    const units = removeUnits(scn, sel.units);
    applyUnitChanges(scn, units);
    if (units.length > 0) edit.units = units;
  }
  if (sel.locations.length > 0) {
    const locations = removeLocations(scn, sel.locations);
    applyLocationChanges(scn, locations);
    if (locations.length > 0) edit.locations = locations;
  }
  return edit;
}

/* ── Pasting ─────────────────────────────────────────────── */

export interface PasteOptions {
  parts: ClipParts;
  mode: PasteMode;
  catalogue: DoodadCatalogue;
  tileset: Tileset | null;
  random?: () => number;
}

export interface PasteCounts {
  tiles: number;
  doodads: number;
  units: number;
  sprites: number;
  locations: number;
  fog: number;
  /** Objects the paste cleared out of the way (replace mode) or that a new tile stranded. */
  removed: number;
}

export interface PasteResult {
  edit: HistoryEdit;
  counts: PasteCounts;
  /** Things that could not be pasted, in words. */
  notes: string[];
}

/**
 * Stamp `clip` with its top-left tile at (tx, ty), applied. Anything that would land
 * off the map is skipped — tiles cell by cell, objects whole — and the result says so.
 */
export function pasteClip(scn: Scenario, clip: Clip, tx: number, ty: number, opts: PasteOptions): PasteResult {
  const { parts, catalogue, tileset } = opts;
  const random = opts.random ?? Math.random;
  const edit: HistoryEdit = { changes: [] };
  const counts: PasteCounts = { tiles: 0, doodads: 0, units: 0, sprites: 0, locations: 0, fog: 0, removed: 0 };
  const notes: string[] = [];
  const target = clampRect({ x0: tx, y0: ty, x1: tx + clip.width, y1: ty + clip.height }, scn);
  if (rectEmpty(target)) return { edit, counts, notes: ["The clip lies entirely off the map"] };
  const ox = tx * TILE_PX, oy = ty * TILE_PX;
  const mapW = scn.width * TILE_PX, mapH = scn.height * TILE_PX;
  const onMap = (x: number, y: number) => x >= 0 && y >= 0 && x < mapW && y < mapH;

  const sameTileset = clip.era === tilesetIndex(scn);
  if (!sameTileset && ((parts.terrain && clip.tiles) || (parts.doodads && clip.doodads.length > 0))) {
    notes.push("terrain and doodads come from a different tileset and were not pasted");
  }
  const wantTerrain = sameTileset && parts.terrain && clip.tiles !== null && clip.ground !== null;
  const wantDoodads = sameTileset && parts.doodads && clip.doodads.length > 0;
  const wantUnits = parts.units && clip.units.length > 0;
  const wantSprites = parts.sprites && clip.sprites.length > 0;
  const wantLocations = parts.locations && clip.locations.length > 0;
  const wantFog = parts.fog && clip.fog !== null;

  /** Visit every clip cell that lands on the map. */
  const cells = (fn: (cell: number, at: number) => void) => {
    for (let y = target.y0; y < target.y1; y++) {
      for (let x = target.x0; x < target.x1; x++) fn((y - ty) * clip.width + (x - tx), y * scn.width + x);
    }
  };
  // What MTXM will show where the paste changes it: the picture with the doodads, or the ground without.
  const final = new Map<number, number>();
  if (wantTerrain) {
    const picture = wantDoodads ? clip.tiles! : clip.ground!;
    cells((cell, at) => { if (scn.tiles[at] !== picture[cell]) final.set(at, picture[cell]); });
  }

  // 1. Terrain: the ground into both sections; the doodad picture comes below, MTXM only.
  if (wantTerrain) {
    const ground = clip.ground!;
    const changes: TileChange[] = [];
    cells((cell, at) => {
      const after = ground[cell];
      // A cell the clip's doodad covers only needs the ground in TILE; MTXM gets its picture in step 3.
      const doodadCell = wantDoodads && clip.tiles![cell] !== after;
      if (doodadCell ? scn.editorTiles[at] !== after : scn.tiles[at] !== after || scn.editorTiles[at] !== after) changes.push({ at, before: scn.tiles[at], after });
    });
    applyChanges(scn, changes);
    if (changes.length > 0) edit.changes = changes;
    counts.tiles = (target.x1 - target.x0) * (target.y1 - target.y0);
  }

  // 2. Out of the way: the area's objects in replace mode, and whatever the new picture cuts through.
  const clear: ObjectSelection = { units: [], sprites: [], doodads: [], locations: [] };
  if (opts.mode === "replace") {
    const area = regionObjects(scn, target, catalogue);
    if (wantUnits) clear.units = area.units;
    if (wantSprites) clear.sprites = area.sprites;
    if (wantDoodads || wantTerrain) clear.doodads = area.doodads;
  }
  if (final.size > 0) clear.doodads = [...new Set([...clear.doodads, ...strandedByPaste(scn, catalogue, final)])];
  if (selectionSize(clear) > 0) {
    const removed = removeObjects(scn, clear, catalogue, tileset, random);
    edit.doodadTiles = removed.doodadTiles;
    edit.doodads = removed.doodads;
    edit.sprites = removed.sprites;
    edit.units = removed.units;
    counts.removed = selectionSize(clear);
  }

  // 3. Doodads: the picture (from the clip when terrain came along, else from the catalogue) and the records.
  if (wantDoodads || wantTerrain) {
    const stamps: TileChange[] = [];
    // Stamps are applied together below; a later doodad must still see the earlier ones' tiles.
    const pending = new Map<number, number>();
    const stamp = (at: number, id: number) => {
      const before = pending.get(at) ?? scn.tiles[at];
      if (before === id) return;
      stamps.push({ at, before, after: id });
      pending.set(at, id);
    };
    if (wantTerrain && wantDoodads) {
      const tiles = clip.tiles!, ground = clip.ground!;
      cells((cell, at) => { if (tiles[cell] !== ground[cell]) stamp(at, tiles[cell]); });
    }
    const doodads: DoodadChange[] = [];
    const sprites: SpriteChange[] = [];
    let skipped = 0;
    if (wantDoodads) {
      for (const d of clip.doodads) {
        const def = catalogue.byId.get(d.doodadId);
        if (!def) { skipped++; continue; }
        const rec: DoodadRecord = { ...d, x: d.x + ox, y: d.y + oy };
        const o = doodadOrigin(def, rec.x, rec.y);
        if (o.x < 0 || o.y < 0 || o.x + def.width > scn.width || o.y + def.height > scn.height) { skipped++; continue; }
        if (!wantTerrain) {
          for (let row = 0; row < def.height; row++) {
            for (let col = 0; col < def.width; col++) {
              const id = def.tiles[row * def.width + col];
              if (id !== 0) stamp((o.y + row) * scn.width + o.x + col, id);
            }
          }
        }
        doodads.push({ index: scn.doodads.length + doodads.length, before: null, after: rec });
        const overlay = makeOverlaySprite(def, rec);
        if (overlay) sprites.push({ index: scn.sprites.length + sprites.length, before: null, after: overlay });
      }
    }
    applyChanges(scn, stamps, "do", "mtxm");
    applyDoodadChanges(scn, doodads);
    applySpriteChanges(scn, sprites);
    if (stamps.length > 0) edit.doodadTiles = push(edit.doodadTiles, stamps);
    if (doodads.length > 0) edit.doodads = push(edit.doodads, doodads);
    if (sprites.length > 0) edit.sprites = push(edit.sprites, sprites);
    counts.doodads = doodads.length;
    if (skipped > 0) notes.push(`${skipped} doodad${skipped === 1 ? "" : "s"} ${skipped === 1 ? "was" : "were"} not pasted (off the map or unknown to this tileset)`);
  }

  // 4. Sprites and units, each where it lands on the map.
  if (wantSprites) {
    const sprites: SpriteChange[] = [];
    let skipped = 0;
    for (const s of clip.sprites) {
      const x = s.x + ox, y = s.y + oy;
      if (!onMap(x, y)) { skipped++; continue; }
      sprites.push({ index: scn.sprites.length + sprites.length, before: null, after: { ...s, x, y } });
    }
    applySpriteChanges(scn, sprites);
    if (sprites.length > 0) edit.sprites = push(edit.sprites, sprites);
    counts.sprites = sprites.length;
    if (skipped > 0) notes.push(`${skipped} sprite${skipped === 1 ? "" : "s"} off the map`);
  }
  if (wantUnits) {
    const units: UnitChange[] = [];
    let serial = nextSerial(scn);
    const serials = new Map<number, number>();
    const kept: UnitRecord[] = [];
    let skipped = 0;
    for (const u of clip.units) {
      const x = u.x + ox, y = u.y + oy;
      if (!onMap(x, y)) { skipped++; continue; }
      serials.set(u.serial, serial);
      kept.push({ ...u, x, y, serial: serial++ });
    }
    for (const u of kept) {
      // An add-on or nydus link only means something when its partner came along.
      const related = u.relatedSerial !== 0 ? serials.get(u.relatedSerial) : undefined;
      const rec: UnitRecord = related !== undefined ? { ...u, relatedSerial: related } : { ...u, relatedSerial: 0, relationType: 0 };
      units.push({ index: scn.units.length + units.length, before: null, after: rec });
    }
    applyUnitChanges(scn, units);
    if (units.length > 0) edit.units = push(edit.units, units);
    counts.units = units.length;
    if (skipped > 0) notes.push(`${skipped} unit${skipped === 1 ? "" : "s"} off the map`);
  }

  // 5. Locations take free slots; the table is the one thing a paste can fill up.
  if (wantLocations) {
    ensureLocationSlots(scn);
    const locations: LocationChange[] = [];
    let full = 0;
    for (const l of clip.locations) {
      const bounds = { left: l.left + ox, top: l.top + oy, right: l.right + ox, bottom: l.bottom + oy };
      const { index, changes } = addLocation(scn, bounds, l.name, l.elevationFlags);
      if (index < 0) { full++; continue; }
      applyLocationChanges(scn, changes);
      locations.push(...changes);
      counts.locations++;
    }
    if (locations.length > 0) edit.locations = locations;
    if (full > 0) notes.push(`${full} location${full === 1 ? "" : "s"} not pasted — every slot is in use`);
  }

  // 6. Fog bytes, creating the section when the map had none.
  if (wantFog) {
    const created = ensureMask(scn);
    const fog: TileChange[] = [];
    const bytes = clip.fog!;
    cells((cell, at) => { if (scn.mask![at] !== bytes[cell]) fog.push({ at, before: scn.mask![at], after: bytes[cell] }); });
    applyFogChanges(scn, fog);
    if (fog.length > 0) edit.fog = fog;
    if (created) edit.createdMask = created;
    counts.fog = fog.length;
  }

  return { edit, counts, notes };
}

/** Doodads that lose one of their own tiles to the paste (`final`: flat index → the MTXM id it will hold). */
function strandedByPaste(scn: Scenario, catalogue: DoodadCatalogue, final: Map<number, number>): number[] {
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
        const to = final.get(y * scn.width + x);
        if (to !== undefined && to !== id) { out.push(i); return; }
      }
    }
  });
  return out;
}

/** A location record placed from a clip entry, for previews. */
export function clipLocationBounds(l: ClipLocation, tx: number, ty: number): LocationRecord {
  return { left: l.left + tx * TILE_PX, top: l.top + ty * TILE_PX, right: l.right + tx * TILE_PX, bottom: l.bottom + ty * TILE_PX, nameIndex: 0, elevationFlags: l.elevationFlags };
}
