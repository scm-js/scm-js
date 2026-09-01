import { atom, type Getter, type Setter } from "jotai";
import {
  markDirty, scenarioDescription, scenarioName, tilesetIndex, type Scenario,
} from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed } from "../formats/chk/sections/objects";
import { getString } from "../formats/chk/sections/strings";
import { TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import { TILESETS, type TilesetId } from "../data/tilesets";
import {
  doodadPlacingAtom, mapDescriptionAtom, mapFilePathAtom, mapHeightAtom, mapModifiedAtom,
  mapNameAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom, selectedDoodadsAtom, selectedUnitsAtom,
} from "./editorAtoms";
import { applyChanges, type TileChange } from "../editor/terrain";
import { applyIsomChanges } from "../editor/isom";
import { applyUnitChanges, removeUnits, type UnitChange } from "../editor/units";
import { applyFogChanges } from "../editor/fog";
import { applyDoodadChanges, applySpriteChanges, removeDoodads, type DoodadChange, type SpriteChange } from "../editor/doodads";
import { peekTileset } from "../formats/tileset/load";
import { NO_DOODADS } from "../formats/tileset/doodads";

/** The open scenario, or null when nothing real is loaded (the skeleton's blank state). */
export const scenarioAtom = atom<Scenario | null>(null);

/** Non-scenario archive members, carried across on save so custom assets survive. */
export const archiveExtrasAtom = atom<Map<string, Uint8Array>>(new Map());

/** Problems the parser noticed — surfaced rather than swallowed. */
export const scenarioWarningsAtom = atom<string[]>((get) => get(scenarioAtom)?.warnings ?? []);

/** File names opened this session, most recent first. */
export const recentFilesAtom = atom<string[]>([]);

/** Bumped whenever terrain changes, so the viewport knows to repaint. */
export const terrainRevisionAtom = atom(0);

/** Bumped whenever `scenario.units` changes (place, move, delete, undo), for the same reason. */
export const unitsRevisionAtom = atom(0);

/** Bumped whenever `scenario.doodads` or `scenario.sprites` changes (the lists are mutated in place). */
export const doodadsRevisionAtom = atom(0);

/** Bumped when the ISOM section is replaced wholesale (Rebuild ISOM), so its health is re-read. */
export const isomRevisionAtom = atom(0);

export const tilesetFileNameAtom = atom<TilesetFileName>((get) => {
  const scn = get(scenarioAtom);
  if (scn) return TILESET_FILENAMES[tilesetIndex(scn)];
  const id = get(mapTilesetAtom);
  const index = TILESETS.findIndex((t) => t.id === id);
  return TILESET_FILENAMES[index < 0 ? 0 : index];
});

function versionLabel(fileVersion: number): "original" | "hybrid" | "broodwar" | "remastered" {
  if (fileVersion >= 206) return "remastered";
  if (fileVersion >= 205) return "broodwar";
  if (fileVersion >= 63) return "hybrid";
  return "original";
}

export interface LoadedDocument {
  scenario: Scenario;
  extras: Map<string, Uint8Array>;
  fileName: string | null;
}

/**
 * Install a freshly parsed scenario, mirroring the fields the existing UI atoms read.
 * Those atoms stay the editor's source of truth for display; `scenarioAtom` is the
 * source of truth for what gets written back out.
 */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDocument) => {
  const { scenario } = doc;
  set(scenarioAtom, scenario);
  set(archiveExtrasAtom, doc.extras);
  set(mapFilePathAtom, doc.fileName);

  set(mapNameAtom, scenarioName(scenario) ?? doc.fileName ?? "Untitled Scenario");
  set(mapDescriptionAtom, scenarioDescription(scenario) ?? "");
  set(mapWidthAtom, scenario.width);
  set(mapHeightAtom, scenario.height);
  set(mapTilesetAtom, (TILESETS[tilesetIndex(scenario)]?.id ?? "jungle") as TilesetId);
  set(mapVersionAtom, versionLabel(scenario.fileVersion));
  set(mapModifiedAtom, false);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  set(selectedUnitsAtom, []);
  set(selectedDoodadsAtom, []);
  set(doodadPlacingAtom, false);
  set(undoStackAtom, []);
  set(redoStackAtom, []);

  if (doc.fileName) {
    set(recentFilesAtom, [doc.fileName, ...get(recentFilesAtom).filter((f) => f !== doc.fileName)].slice(0, 10));
  }
});

export const closeDocumentAtom = atom(null, (get, set) => {
  set(scenarioAtom, null);
  set(archiveExtrasAtom, new Map());
  set(mapFilePathAtom, null);
  set(mapModifiedAtom, false);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  set(selectedUnitsAtom, []);
  set(selectedDoodadsAtom, []);
  set(doodadPlacingAtom, false);
  set(undoStackAtom, []);
  set(redoStackAtom, []);
});

/* ── Undo history ────────────────────────────────────────── */

export interface HistoryEntry {
  label: string;
  changes: TileChange[];
  /** The isometric brush's changes to `scenario.isom`, undone together with the tiles. */
  isom?: TileChange[];
  /**
   * Set when the edit gave a map an ISOM section it did not have (Rebuild ISOM). Undo
   * removes the section again rather than leaving an all-zero one behind.
   */
  createdIsom?: Uint16Array;
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
  /** THG2 record changes — a doodad's overlay sprite comes and goes with it. */
  sprites?: SpriteChange[];
  /** Fog of war edits to `scenario.mask` (see editor/fog.ts); `at` indexes the MASK byte. */
  fog?: TileChange[];
  /**
   * Set when the edit gave a map a MASK section it did not have (the first fog stroke
   * on such a map). Undo removes the section again.
   */
  createdMask?: Uint8Array;
}

/**
 * Apply an entry in either direction. The parts are applied in a fixed order going
 * forward and in reverse coming back, so a step that both paints terrain and lifts the
 * doodads it painted over undoes cleanly (doodad cells first, then the terrain).
 */
function applyEntry(scn: Scenario, entry: HistoryEntry, direction: "do" | "undo") {
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
    () => { if (entry.fog) applyFogChanges(scn, entry.fog, direction); },
  ];
  if (direction === "undo") steps.reverse();
  for (const step of steps) step();
}

const touchesDoodads = (entry: HistoryEntry) =>
  (entry.doodadTiles?.length ?? 0) > 0 || (entry.doodads?.length ?? 0) > 0 || (entry.sprites?.length ?? 0) > 0;

const hasEdits = (entry: HistoryEntry) =>
  entry.changes.length > 0 || (entry.isom?.length ?? 0) > 0 || entry.createdIsom !== undefined || (entry.units?.length ?? 0) > 0
  || (entry.fog?.length ?? 0) > 0 || entry.createdMask !== undefined || touchesDoodads(entry);

/** SCMDraft's default depth; a 7x7 stroke across a whole map is still only a few hundred KB. */
const UNDO_LEVELS = 200;

export const undoStackAtom = atom<HistoryEntry[]>([]);
export const redoStackAtom = atom<HistoryEntry[]>([]);

/**
 * Record an edit that has already been applied to the scenario, so the viewport can
 * paint live during a stroke and the whole stroke still undoes as one step.
 */
export const commitEditAtom = atom(null, (get, set, entry: HistoryEntry) => {
  if (!hasEdits(entry)) return;
  set(undoStackAtom, [...get(undoStackAtom), entry].slice(-UNDO_LEVELS));
  set(redoStackAtom, []);
  set(mapModifiedAtom, true);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  if (entry.units) set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  if (touchesDoodads(entry)) set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
});

/** Unit and doodad indices shift under an edit or undo, so a selection never survives one. */
function afterUnitEdit(get: Getter, set: Setter, entry: HistoryEntry) {
  if (entry.units) {
    set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
    set(selectedUnitsAtom, []);
  }
  if (touchesDoodads(entry)) {
    set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
    set(selectedDoodadsAtom, []);
  }
}

export const undoAtom = atom(
  (get) => get(undoStackAtom).at(-1)?.label ?? null,
  (get, set) => {
    const scn = get(scenarioAtom);
    const stack = get(undoStackAtom);
    const entry = stack.at(-1);
    if (!scn || !entry) return null;
    applyEntry(scn, entry, "undo");
    if (entry.createdIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
    afterUnitEdit(get, set, entry);
    set(undoStackAtom, stack.slice(0, -1));
    set(redoStackAtom, [...get(redoStackAtom), entry]);
    set(mapModifiedAtom, true);
    set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
    return entry.label;
  },
);

export const redoAtom = atom(
  (get) => get(redoStackAtom).at(-1)?.label ?? null,
  (get, set) => {
    const scn = get(scenarioAtom);
    const stack = get(redoStackAtom);
    const entry = stack.at(-1);
    if (!scn || !entry) return null;
    applyEntry(scn, entry, "do");
    if (entry.createdIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
    afterUnitEdit(get, set, entry);
    set(redoStackAtom, stack.slice(0, -1));
    set(undoStackAtom, [...get(undoStackAtom), entry]);
    set(mapModifiedAtom, true);
    set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
    return entry.label;
  },
);

/* ── Derived overlays ────────────────────────────────────── */

/** The Start Location unit id, which the editor draws as a player marker. */
export const START_LOCATION_UNIT = 214;

export interface ViewLocation {
  index: number;
  name: string;
  /** Tile coordinates; MRGN stores pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const locationsAtom = atom<ViewLocation[]>((get) => {
  const scn = get(scenarioAtom);
  if (!scn) return [];
  const out: ViewLocation[] = [];
  scn.locations.forEach((l, index) => {
    if (!isLocationUsed(l)) return;
    // "Anywhere" spans the whole map: drawing it would wash every map in location tint.
    if (index === ANYWHERE_INDEX) return;
    const left = Math.min(l.left, l.right);
    const top = Math.min(l.top, l.bottom);
    out.push({
      index,
      name: getString(scn.strings, l.nameIndex) ?? `Location ${index + 1}`,
      x: left / 32,
      y: top / 32,
      w: Math.abs(l.right - l.left) / 32,
      h: Math.abs(l.bottom - l.top) / 32,
    });
  });
  return out;
});

export interface ViewStartLocation {
  player: number;
  /** Tile coordinates; UNIT stores pixel centres. */
  x: number;
  y: number;
}

export const startLocationsAtom = atom<ViewStartLocation[]>((get) => {
  const scn = get(scenarioAtom);
  get(unitsRevisionAtom); // the list is mutated in place
  if (!scn) return [];
  return scn.units
    .filter((u) => u.unitId === START_LOCATION_UNIT)
    .map((u) => ({ player: u.owner, x: u.x / 32, y: u.y / 32 }));
});

/* ── Doodad selection edits ──────────────────────────────── */

/** Remove the selected doodads (tiles, DD2 records and overlay sprites) as one undo step. Returns how many went. */
export const deleteSelectedDoodadsAtom = atom(null, (get, set) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedDoodadsAtom);
  if (!scn || selected.length === 0) return 0;
  const loaded = peekTileset(get(tilesetFileNameAtom));
  const edit = removeDoodads(scn, loaded?.tileset ?? null, loaded?.doodads ?? NO_DOODADS, selected);
  applyChanges(scn, edit.tiles, "do", "mtxm");
  applyDoodadChanges(scn, edit.doodads);
  applySpriteChanges(scn, edit.sprites);
  set(selectedDoodadsAtom, []);
  const n = edit.doodads.length;
  set(commitEditAtom, { label: `Delete ${n} doodad${n === 1 ? "" : "s"}`, changes: [], doodadTiles: edit.tiles, doodads: edit.doodads, sprites: edit.sprites });
  return n;
});

/* ── Unit selection edits ────────────────────────────────── */

/** Remove the selected units as one undo step. Returns how many went. */
export const deleteSelectedUnitsAtom = atom(null, (get, set) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedUnitsAtom);
  if (!scn || selected.length === 0) return 0;
  const units = removeUnits(scn, selected);
  applyUnitChanges(scn, units);
  set(selectedUnitsAtom, []);
  set(commitEditAtom, { label: `Delete ${units.length} unit${units.length === 1 ? "" : "s"}`, changes: [], units });
  return units.length;
});
