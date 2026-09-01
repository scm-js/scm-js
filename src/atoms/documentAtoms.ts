import { atom } from "jotai";
import {
  scenarioDescription, scenarioName, tilesetIndex, type Scenario,
} from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed } from "../formats/chk/sections/objects";
import { getString } from "../formats/chk/sections/strings";
import { TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import { TILESETS, type TilesetId } from "../data/tilesets";
import {
  mapDescriptionAtom, mapFilePathAtom, mapHeightAtom, mapModifiedAtom,
  mapNameAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom,
} from "./editorAtoms";
import { applyChanges, type TileChange } from "../editor/terrain";

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
  set(undoStackAtom, []);
  set(redoStackAtom, []);
});

/* ── Undo history ────────────────────────────────────────── */

export interface HistoryEntry {
  label: string;
  changes: TileChange[];
}

/** SCMDraft's default depth; a 7x7 stroke across a whole map is still only a few hundred KB. */
const UNDO_LEVELS = 200;

export const undoStackAtom = atom<HistoryEntry[]>([]);
export const redoStackAtom = atom<HistoryEntry[]>([]);

/**
 * Record an edit that has already been applied to the scenario, so the viewport can
 * paint live during a stroke and the whole stroke still undoes as one step.
 */
export const commitEditAtom = atom(null, (get, set, entry: HistoryEntry) => {
  if (entry.changes.length === 0) return;
  set(undoStackAtom, [...get(undoStackAtom), entry].slice(-UNDO_LEVELS));
  set(redoStackAtom, []);
  set(mapModifiedAtom, true);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
});

export const undoAtom = atom(
  (get) => get(undoStackAtom).at(-1)?.label ?? null,
  (get, set) => {
    const scn = get(scenarioAtom);
    const stack = get(undoStackAtom);
    const entry = stack.at(-1);
    if (!scn || !entry) return null;
    applyChanges(scn, entry.changes, "undo");
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
    applyChanges(scn, entry.changes, "do");
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
  if (!scn) return [];
  return scn.units
    .filter((u) => u.unitId === START_LOCATION_UNIT)
    .map((u) => ({ player: u.owner, x: u.x / 32, y: u.y / 32 }));
});
