/**
 * The undo model's unit of work, and how one is applied in either direction.
 *
 * Every layer's edit is an invertible change list (`TileChange`, `UnitChange`, …); an
 * entry bundles the lists one user action touched so a stroke that paints terrain, lifts
 * the doodads it painted over and removes the units it stranded undoes as one step. The
 * lists are applied in a fixed order going forward and in reverse coming back, so each
 * list only has to be consistent with the state the ones before it leave behind.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { applyChanges, type Rect, type TileChange } from "./terrain";
import { applyIsomChanges } from "./isom";
import { applyUnitChanges, type UnitChange } from "./units";
import { applyFogChanges } from "./fog";
import { applyDoodadChanges, type DoodadChange } from "./doodads";
import { applySpriteChanges, type SpriteChange } from "./sprites";
import { applyLocationChanges, type LocationChange } from "./locations";

/** The change lists of one edit; `HistoryEntry` adds the label. */
export interface HistoryEdit {
  changes: TileChange[];
  /** The isometric brush's changes to `scenario.isom`, undone together with the tiles. */
  isom?: TileChange[];
  /**
   * Set when the edit gave a map an ISOM section it did not have (Rebuild ISOM). Undo
   * removes the section again rather than leaving an all-zero one behind.
   */
  createdIsom?: Uint16Array;
  /**
   * Set when the edit rebuilt an existing lattice from the tiles, which is the one edit
   * to `isom` the ISOM health is re-measured after: a brush stroke keeps the two in step
   * by construction and is deliberately not measured (`useIsomStatus`), and measuring
   * costs a second rebuild.
   */
  rebuiltIsom?: boolean;
  /** Unit placements, moves and deletions (see editor/units.ts). */
  units?: UnitChange[];
  /**
   * Doodad tiles stamped into or lifted off MTXM alone — TILE keeps the ground beneath
   * (see editor/doodads.ts). Applied after `changes`, so a terrain stroke that removes
   * the doodads it painted over restores their remaining cells on top of its own edit.
   */
  doodadTiles?: TileChange[];
  /** DD2 record insertions, removals and replacements. */
  doodads?: DoodadChange[];
  /** THG2 record changes: the Sprites layer's edits, and a doodad's overlay sprite coming and going with it. */
  sprites?: SpriteChange[];
  /** MRGN slot replacements — create, move, resize, rename, delete (see editor/locations.ts); a rename may carry a string. */
  locations?: LocationChange[];
  /** Fog of war edits to `scenario.mask` (see editor/fog.ts); `at` indexes the MASK byte. */
  fog?: TileChange[];
  /**
   * Set when the edit gave a map a MASK section it did not have (the first fog stroke
   * on such a map). Undo removes the section again.
   */
  createdMask?: Uint8Array;
}

export interface HistoryEntry extends HistoryEdit {
  label: string;
}

/**
 * Apply an entry in either direction. The parts are applied in a fixed order going
 * forward and in reverse coming back, so a step that both paints terrain and lifts the
 * doodads it painted over undoes cleanly (doodad cells first, then the terrain).
 */
export function applyEntry(scn: Scenario, entry: HistoryEdit, direction: "do" | "undo") {
  const steps: (() => void)[] = [
    () => {
      if (entry.createdIsom) {
        scn.isom = direction === "do" ? entry.createdIsom : null;
        markDirty(scn, "ISOM");
      }
      if (entry.createdMask) {
        scn.mask = direction === "do" ? entry.createdMask : null;
        markDirty(scn, "MASK");
      }
    },
    () => applyChanges(scn, entry.changes, direction),
    () => { if (entry.isom) applyIsomChanges(scn, entry.isom, direction); },
    () => { if (entry.doodadTiles) applyChanges(scn, entry.doodadTiles, direction, "mtxm"); },
    () => { if (entry.doodads) applyDoodadChanges(scn, entry.doodads, direction); },
    () => { if (entry.sprites) applySpriteChanges(scn, entry.sprites, direction); },
    () => { if (entry.units) applyUnitChanges(scn, entry.units, direction); },
    () => { if (entry.locations) applyLocationChanges(scn, entry.locations, direction); },
    () => { if (entry.fog) applyFogChanges(scn, entry.fog, direction); },
  ];
  if (direction === "undo") steps.reverse();
  for (const step of steps) step();
}

export const touchesDoodads = (entry: HistoryEdit) =>
  (entry.doodadTiles?.length ?? 0) > 0 || (entry.doodads?.length ?? 0) > 0 || (entry.sprites?.length ?? 0) > 0;

export const hasEdits = (entry: HistoryEdit) =>
  entry.changes.length > 0 || (entry.isom?.length ?? 0) > 0 || entry.createdIsom !== undefined || (entry.units?.length ?? 0) > 0
  || (entry.fog?.length ?? 0) > 0 || entry.createdMask !== undefined || touchesDoodads(entry) || (entry.locations?.length ?? 0) > 0;

/* ── What a commit changed, for the listeners ────────────── */

/**
 * Why the map changed: an edit recorded in the history, an undo or redo of one, a dialog
 * writing its tables (settings, triggers, strings — outside the history), a change to the
 * whole document (resize, tileset change, raw section edit), or other people's edits on a
 * shared map.
 */
export type CommitReason = "edit" | "undo" | "redo" | "tables" | "whole" | "remote";

/** Which parts of the map one commit touched. */
export interface CommitParts {
  terrain: boolean;
  isom: boolean;
  units: boolean;
  doodads: boolean;
  sprites: boolean;
  locations: boolean;
  fog: boolean;
  settings: boolean;
  triggers: boolean;
}

export interface CommitNotice {
  reason: CommitReason;
  /** The history label (the Edit menu's words), or "" for a change with none. */
  label: string;
  /**
   * The tiles the change fell on, far edges exclusive: every changed tile, and the tile
   * under each object's position before and after (an object's picture reaches past its
   * position — widen the rect by the largest picture you draw). Null when the change
   * has no place on the map (a dialog's tables) or the whole map may have changed.
   */
  area: Rect | null;
  parts: CommitParts;
}

export const NO_PARTS: CommitParts = {
  terrain: false, isom: false, units: false, doodads: false, sprites: false, locations: false, fog: false, settings: false, triggers: false,
};
export const ALL_PARTS: CommitParts = {
  terrain: true, isom: true, units: true, doodads: true, sprites: true, locations: true, fog: true, settings: true, triggers: true,
};

/** Which parts an entry's lists touch. */
export function entryParts(entry: HistoryEdit): CommitParts {
  return {
    ...NO_PARTS,
    terrain: entry.changes.length > 0 || (entry.doodadTiles?.length ?? 0) > 0,
    isom: (entry.isom?.length ?? 0) > 0 || entry.createdIsom !== undefined || entry.rebuiltIsom === true,
    units: (entry.units?.length ?? 0) > 0,
    doodads: (entry.doodads?.length ?? 0) > 0,
    sprites: (entry.sprites?.length ?? 0) > 0,
    locations: (entry.locations?.length ?? 0) > 0,
    fog: (entry.fog?.length ?? 0) > 0 || entry.createdMask !== undefined,
  };
}

/**
 * The tile rectangle an entry's lists fall on (see `CommitNotice.area`), clamped to the
 * map; null when nothing in it has a place. A created or rebuilt ISOM lattice counts as
 * the whole map, since it is not listed cell by cell.
 */
export function entryArea(entry: HistoryEdit, width: number, height: number): Rect | null {
  if (entry.createdIsom !== undefined || entry.rebuiltIsom || entry.createdMask !== undefined) return { x0: 0, y0: 0, x1: width, y1: height };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const tile = (x: number, y: number) => {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 1 > x1) x1 = x + 1;
    if (y + 1 > y1) y1 = y + 1;
  };
  const cells = (list: readonly TileChange[] | undefined) => {
    if (list) for (const c of list) tile(c.at % width, Math.floor(c.at / width));
  };
  const at = (r: { x: number; y: number } | null) => { if (r) tile(Math.floor(r.x / 32), Math.floor(r.y / 32)); };
  cells(entry.changes);
  cells(entry.doodadTiles);
  cells(entry.fog);
  for (const list of [entry.units, entry.doodads, entry.sprites]) if (list) for (const c of list) { at(c.before); at(c.after); }
  if (entry.locations) {
    for (const c of entry.locations) {
      for (const l of [c.before, c.after]) {
        // An unused slot is all zeroes; it has no place.
        if (l.left === 0 && l.top === 0 && l.right === 0 && l.bottom === 0) continue;
        at({ x: Math.min(l.left, l.right), y: Math.min(l.top, l.bottom) });
        at({ x: Math.max(l.left, l.right) - 1, y: Math.max(l.top, l.bottom) - 1 });
      }
    }
  }
  if (x1 < 0) return null;
  const r = { x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(width, x1), y1: Math.min(height, y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}
