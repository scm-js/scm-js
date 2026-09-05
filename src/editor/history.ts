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
import { applyChanges, type TileChange } from "./terrain";
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
