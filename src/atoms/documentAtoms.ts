import { atom, type Getter, type Setter } from "jotai";
import {
  mapVersionOf, scenarioDescription, scenarioName, tilesetIndex, type Scenario,
} from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed, type LocationRecord } from "../formats/chk/sections/objects";
import { TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import { TILESETS, type TilesetId } from "../data/tilesets";
import {
  clipPastingAtom, clipSelectionAtom, doodadPlacingAtom, mapDescriptionAtom, mapFilePathAtom, mapHeightAtom, mapModifiedAtom,
  mapNameAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom, placementOptionsAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
  spritePlacingAtom,
} from "./editorAtoms";
import { statusMessageAtom } from "./uiAtoms";
import { applyChanges } from "../editor/terrain";
import { applyUnitChanges, removeUnits } from "../editor/units";
import { applyDoodadChanges, removeDoodads, strandedDoodads } from "../editor/doodads";
import { strandedUnits } from "../editor/placement";
import { peekUnitAssets } from "../formats/units/load";
import { applySpriteChanges, removeSprites } from "../editor/sprites";
import { applyEntry, hasEdits, touchesDoodads, type HistoryEntry } from "../editor/history";
import { applyLocationChanges, boundsOf, isInverted, locationName, moveLocations, removeLocations } from "../editor/locations";
import { peekTileset } from "../formats/tileset/load";
import { NO_DOODADS } from "../formats/tileset/doodads";
import { relocateScriptBlock, scriptState, type ScriptState } from "../editor/script";
import { resizeScenario, type ResizeResult } from "../editor/resize";
import { baseTerrain } from "../formats/tileset/terrain";

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

/** Bumped whenever `scenario.doodads` or `scenario.sprites` changes (the lists are mutated in place); the Sprites layer's repaint trigger too. */
export const doodadsRevisionAtom = atom(0);

/** Bumped whenever `scenario.locations` changes (the slots are replaced in place); `locationsAtom` re-derives from it. */
export const locationsRevisionAtom = atom(0);

/** Bumped when the ISOM section is replaced wholesale (Rebuild ISOM), so its health is re-read. */
export const isomRevisionAtom = atom(0);

/**
 * Bumped after a settings dialog writes to the scenario — players, forces, colours,
 * revision, unit settings (see editor/settings.ts). Those edits are outside the undo
 * model, and the scenario is mutated in place, so this is how the chrome learns of them.
 */
export const settingsRevisionAtom = atom(0);

/**
 * Bumped after a trigger dialog replaces `scenario.triggers` / `scenario.briefing`
 * (editor/triggers.ts) — like settings, a dialog transaction outside the undo model.
 */
export const triggersRevisionAtom = atom(0);

export const commitTriggersAtom = atom(null, (get, set) => {
  set(mapModifiedAtom, true);
  set(triggersRevisionAtom, get(triggersRevisionAtom) + 1);
  // A hand trigger inserted before the script's block moved it: keep the manifest pointing at it.
  const scn = get(scenarioAtom);
  const moved = scn ? relocateScriptBlock(scn, get(archiveExtrasAtom)) : null;
  if (moved) set(archiveExtrasAtom, moved);
});

/**
 * The trigger script's source, manifest and generated block (editor/script.ts), re-read
 * whenever the triggers or the archive extras change.
 */
export const scriptStateAtom = atom<ScriptState>((get) => {
  get(triggersRevisionAtom);
  return scriptState(get(scenarioAtom), get(archiveExtrasAtom));
});

/**
 * Record that a settings dialog changed the scenario. Player colours reach every drawn
 * unit and sprite, so the object layers repaint too.
 */
export const commitSettingsAtom = atom(null, (get, set) => {
  set(mapModifiedAtom, true);
  set(settingsRevisionAtom, get(settingsRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  const scn = get(scenarioAtom);
  if (scn) set(mapVersionAtom, mapVersionOf(scn.fileVersion));
});

export interface ResizeRequest {
  width: number;
  height: number;
  /** 3×3 anchor grid, 4 = centre. */
  anchor: number;
  /** ISOM terrain id to fill the new area with (the tileset's default when omitted). */
  terrainId?: number;
  clampLocations: boolean;
}

/**
 * Scenario ▸ Resize / Crop Map. Not an undoable edit: the history is dropped, every
 * selection cleared and every revision bumped, since the whole document moved. Null
 * when there is no map.
 */
export const resizeDocumentAtom = atom(null, (get, set, req: ResizeRequest): ResizeResult | null => {
  const scn = get(scenarioAtom);
  if (!scn) return null;
  const loaded = peekTileset(get(tilesetFileNameAtom));
  const tileset = loaded?.tileset ?? null;
  const result = resizeScenario(scn, {
    width: req.width, height: req.height, anchor: req.anchor,
    fill: baseTerrain(tileset, req.terrainId), tileset, era: tilesetIndex(scn), clampLocations: req.clampLocations,
  });
  set(mapWidthAtom, scn.width);
  set(mapHeightAtom, scn.height);
  set(mapModifiedAtom, true);
  set(undoStackAtom, []);
  set(redoStackAtom, []);
  set(selectedUnitsAtom, []);
  set(selectedDoodadsAtom, []);
  set(selectedSpritesAtom, []);
  set(selectedLocationsAtom, []);
  set(clipSelectionAtom, null);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  set(isomRevisionAtom, get(isomRevisionAtom) + 1);
  set(settingsRevisionAtom, get(settingsRevisionAtom) + 1);
  return result;
});

export const tilesetFileNameAtom = atom<TilesetFileName>((get) => {
  const scn = get(scenarioAtom);
  if (scn) return TILESET_FILENAMES[tilesetIndex(scn)];
  const id = get(mapTilesetAtom);
  const index = TILESETS.findIndex((t) => t.id === id);
  return TILESET_FILENAMES[index < 0 ? 0 : index];
});

export interface LoadedDocument {
  scenario: Scenario;
  extras: Map<string, Uint8Array>;
  fileName: string | null;
  /** How the document came to be installed; File ▸ Open when omitted. */
  reason?: DocumentChangeReason;
}

/** Why `scenarioAtom` last changed: a file opened, a new map, the map closed, or the open one re-parsed (a raw section edit). */
export type DocumentChangeReason = "open" | "new" | "close" | "replace";

/**
 * The reason behind the latest `scenarioAtom` change, with the object it applies to so a
 * reader can tell a stale entry (a test setting `scenarioAtom` directly) from a current one.
 * The plugin host turns it into the `"document"` event's payload.
 */
export const documentChangeAtom = atom<{ reason: DocumentChangeReason; scenario: Scenario | null }>({ reason: "close", scenario: null });

/**
 * Install a freshly parsed scenario, mirroring the fields the existing UI atoms read.
 * Those atoms stay the editor's source of truth for display; `scenarioAtom` is the
 * source of truth for what gets written back out.
 */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDocument) => {
  const { scenario } = doc;
  set(documentChangeAtom, { reason: doc.reason ?? "open", scenario });
  set(scenarioAtom, scenario);
  set(archiveExtrasAtom, doc.extras);
  set(mapFilePathAtom, doc.fileName);

  set(mapNameAtom, scenarioName(scenario) ?? doc.fileName ?? "Untitled Scenario");
  set(mapDescriptionAtom, scenarioDescription(scenario) ?? "");
  set(mapWidthAtom, scenario.width);
  set(mapHeightAtom, scenario.height);
  set(mapTilesetAtom, (TILESETS[tilesetIndex(scenario)]?.id ?? "jungle") as TilesetId);
  set(mapVersionAtom, mapVersionOf(scenario.fileVersion));
  set(mapModifiedAtom, false);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  set(selectedUnitsAtom, []);
  set(selectedDoodadsAtom, []);
  set(doodadPlacingAtom, false);
  set(selectedSpritesAtom, []);
  set(spritePlacingAtom, false);
  set(selectedLocationsAtom, []);
  // The clip itself is kept — copying between maps is the point — but the marked area was on the old one.
  set(clipSelectionAtom, null);
  set(clipPastingAtom, false);
  set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  set(settingsRevisionAtom, get(settingsRevisionAtom) + 1);
  set(undoStackAtom, []);
  set(redoStackAtom, []);

  if (doc.fileName) {
    set(recentFilesAtom, [doc.fileName, ...get(recentFilesAtom).filter((f) => f !== doc.fileName)].slice(0, 10));
  }
});

/**
 * Install a scenario parsed again from edited bytes — a plugin's raw section edit — in
 * place of the open one: the same file name and archive extras, the map marked modified,
 * and, as with Resize, the history dropped and every selection cleared, since any part
 * of the document may have changed. The mirror atoms are refilled from the new object.
 */
export const replaceScenarioAtom = atom(null, (get, set, scenario: Scenario) => {
  set(loadDocumentAtom, { scenario, extras: get(archiveExtrasAtom), fileName: get(mapFilePathAtom), reason: "replace" });
  set(mapModifiedAtom, true);
});

export const closeDocumentAtom = atom(null, (get, set) => {
  set(documentChangeAtom, { reason: "close", scenario: null });
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
  set(selectedSpritesAtom, []);
  set(spritePlacingAtom, false);
  set(selectedLocationsAtom, []);
  set(clipSelectionAtom, null);
  set(clipPastingAtom, false);
  set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  set(undoStackAtom, []);
  set(redoStackAtom, []);
});

/* ── Undo history ────────────────────────────────────────── */

// The entry model and its applier live in editor/history.ts (pure, testable); the type is
// re-exported here because every hook imports it from the atoms.
export type { HistoryEntry };

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
  if (entry.locations) set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  // A rebuilt lattice is the one edit the ISOM status is re-measured after.
  if (entry.createdIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
});

/**
 * Record a finished terrain edit the way a brush stroke is recorded. Doodads the edit
 * painted over come off the map in the same undo step (their remaining cells go back to
 * the ground, their records and overlay sprites go), and with "remove stranded units"
 * on so do units the new terrain can no longer hold; the status line says how many of
 * each. The entry's own lists must already be applied to the scenario. Shared by
 * `useTerrainTools` and the plugin host so a plugin's edit behaves exactly like a stroke.
 */
export const commitTerrainAtom = atom(null, (get, set, req: { entry: HistoryEntry; summary: string }) => {
  const scn = get(scenarioAtom);
  if (!scn) return;
  const { entry } = req;
  const loaded = peekTileset(get(tilesetFileNameAtom));
  let note = "";
  if (loaded && entry.changes.length > 0) {
    const stranded = strandedDoodads(scn, loaded.doodads, entry.changes.map((c) => c.at));
    if (stranded.length > 0) {
      const edit = removeDoodads(scn, loaded.tileset, loaded.doodads, stranded);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      entry.doodadTiles = [...(entry.doodadTiles ?? []), ...edit.tiles];
      entry.doodads = [...(entry.doodads ?? []), ...edit.doodads];
      entry.sprites = [...(entry.sprites ?? []), ...edit.sprites];
      set(selectedDoodadsAtom, []);
      note += `, removed ${stranded.length} doodad${stranded.length === 1 ? "" : "s"}`;
    }
  }
  if (get(placementOptionsAtom).removeStranded && loaded && (entry.changes.length > 0 || (entry.doodadTiles?.length ?? 0) > 0)) {
    const stranded = strandedUnits(scn, loaded.tileset, peekUnitAssets()?.units ?? null, [...entry.changes, ...(entry.doodadTiles ?? [])].map((c) => c.at));
    if (stranded.length > 0) {
      const removed = removeUnits(scn, stranded);
      applyUnitChanges(scn, removed);
      entry.units = [...(entry.units ?? []), ...removed];
      set(selectedUnitsAtom, []);
      note += `, removed ${stranded.length} stranded unit${stranded.length === 1 ? "" : "s"}`;
    }
  }
  set(commitEditAtom, entry);
  set(statusMessageAtom, req.summary + note);
});

/**
 * Unit and doodad indices shift under an edit or undo, so a selection never survives one.
 * Location slots do not shift, so that selection only loses slots that stopped being in use.
 */
function afterUnitEdit(get: Getter, set: Setter, entry: HistoryEntry) {
  if (entry.units) {
    set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
    set(selectedUnitsAtom, []);
  }
  if (touchesDoodads(entry)) {
    set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
    set(selectedDoodadsAtom, []);
  }
  if (entry.sprites) set(selectedSpritesAtom, []);
  if (entry.locations) {
    set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
    const scn = get(scenarioAtom);
    set(selectedLocationsAtom, get(selectedLocationsAtom).filter((i) => scn?.locations[i] && isLocationUsed(scn.locations[i])));
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
  /** Tile coordinates (fractional when the box is not tile-aligned); MRGN stores pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** The normalised box in map pixels. */
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Non-zero when some elevations are excluded (see `Elevation`). */
  elevationFlags: number;
  /** The file stores right < left or bottom < top — a deliberate trick in some maps. */
  inverted: boolean;
}

/** The locations to draw: every slot in use except Anywhere, in slot order. */
export const locationsAtom = atom<ViewLocation[]>((get) => {
  const scn = get(scenarioAtom);
  get(locationsRevisionAtom); // the slots are replaced in place
  if (!scn) return [];
  const out: ViewLocation[] = [];
  scn.locations.forEach((l: LocationRecord, index) => {
    if (!isLocationUsed(l)) return;
    // "Anywhere" spans the whole map: drawing it would wash every map in location tint.
    if (index === ANYWHERE_INDEX) return;
    const b = boundsOf(l);
    out.push({
      index,
      name: locationName(scn, index),
      x: b.left / 32,
      y: b.top / 32,
      w: (b.right - b.left) / 32,
      h: (b.bottom - b.top) / 32,
      ...b,
      elevationFlags: l.elevationFlags,
      inverted: isInverted(l),
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

/* ── Sprite selection edits ──────────────────────────────── */

/** Remove the selected sprites as one undo step. Returns how many went. */
export const deleteSelectedSpritesAtom = atom(null, (get, set) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedSpritesAtom);
  if (!scn || selected.length === 0) return 0;
  const sprites = removeSprites(scn, selected);
  applySpriteChanges(scn, sprites);
  set(selectedSpritesAtom, []);
  set(commitEditAtom, { label: `Delete ${sprites.length} sprite${sprites.length === 1 ? "" : "s"}`, changes: [], sprites });
  return sprites.length;
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

/* ── Location selection edits ────────────────────────────── */

/** Blank the selected slots (Anywhere is skipped) as one undo step. Returns how many went. */
export const deleteSelectedLocationsAtom = atom(null, (get, set) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedLocationsAtom);
  if (!scn || selected.length === 0) return 0;
  const locations = removeLocations(scn, selected);
  if (locations.length === 0) return 0;
  const label = locations.length === 1 ? `Delete location ${locationName(scn, locations[0].index)}` : `Delete ${locations.length} locations`;
  applyLocationChanges(scn, locations);
  set(selectedLocationsAtom, []);
  set(commitEditAtom, { label, changes: [], locations });
  return locations.length;
});

/** Shift the selected locations by a pixel delta (the arrow keys) as one undo step. Returns how many moved. */
export const nudgeSelectedLocationsAtom = atom(null, (get, set, d: { dx: number; dy: number }) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedLocationsAtom);
  if (!scn || selected.length === 0) return 0;
  const locations = moveLocations(scn, selected, d.dx, d.dy);
  if (locations.length === 0) return 0;
  applyLocationChanges(scn, locations);
  set(commitEditAtom, { label: locations.length === 1 ? `Move location ${locationName(scn, locations[0].index)}` : `Move ${locations.length} locations`, changes: [], locations });
  return locations.length;
});
