import type { MapFileHandle } from "../services/mapIo";
import type { MemberInfo, StoredMembers } from "../formats/mpq/scm";
import { atom, type Getter, type Setter } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { blankFillAtom } from "./gameDataAtoms";
import { browserStorage } from "./storage";
import { storeHandle } from "../services/handleStore";
import {
  mapVersionOf, scenarioDescription, scenarioName, tilesetIndex, type Scenario,
} from "../formats/chk/scenario";
import { ANYWHERE_INDEX, isLocationUsed, type LocationRecord } from "../formats/chk/sections/objects";
import { TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import { TILESETS, type TilesetId } from "../data/tilesets";
import {
  centerViewOnAtom, clipPastingAtom, clipSelectionAtom, doodadPlacingAtom, mapDescriptionAtom, mapFileHandleAtom, mapFilePathAtom, mapHeightAtom, mapModifiedAtom, mapOriginAtom, saveOptionsAtom,
  mapNameAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom, placementOptionsAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
  spritePlacingAtom, viewportRectAtom, zoomAtom, type EditorLayer,
} from "./editorAtoms";
import type { SaveOptions } from "../editor/save";
import type { Rect } from "../editor/terrain";
import type { OpenDocumentInfo } from "../plugins/api";
import { START_LOCATION } from "../data/units";
import { statusMessageAtom } from "./uiAtoms";
import { baseName, isVerbose, logInfo } from "../editor/log";
import { applyChanges } from "../editor/terrain";
import { applyUnitChanges, removeUnits } from "../editor/units";
import { applyDoodadChanges, convertDoodads, removeDoodads, strandedDoodads } from "../editor/doodads";
import { strandedUnits } from "../editor/placement";
import { peekUnitAssets } from "../formats/units/load";
import { applySpriteChanges, removeSprites } from "../editor/sprites";
import { applyEntry, hasEdits, touchesDoodads, type HistoryEntry } from "../editor/history";
import { applyLocationChanges, boundsOf, isInverted, locationName, moveLocations, removeLocations, usedLocations } from "../editor/locations";
import { peekTileset } from "../formats/tileset/load";
import { NO_DOODADS } from "../formats/tileset/doodads";
import { resizeScenario, type ResizeResult } from "../editor/resize";
import { changeTileset, type ChangeTilesetResult } from "../editor/tileset";
import { baseTerrain } from "../formats/tileset/terrain";
import { t } from "../i18n";

/** The open scenario, or null when nothing real is loaded (the skeleton's blank state). */
export const scenarioAtom = atom<Scenario | null>(null);

/** Non-scenario archive members, carried across on save so custom assets survive. */
export const archiveExtrasAtom = atom<Map<string, Uint8Array>>(new Map());
/**
 * The opened archive's members that have no name the editor knows (or could not be
 * decoded), carried across a save exactly as stored. Null when there are none; not
 * editable, since nothing about them can be read.
 */
export const archiveStoredAtom = atom<StoredMembers | null>(null);


/**
 * File ▸ Open Recent. Names survive a reload (`scmjs.recents`); the file handle behind a
 * name — what lets the entry reopen from disk — lives in IndexedDB under `handleKey`
 * (`services/handleStore.ts`), where Chromium browsers and the desktop build keep one and
 * Firefox and Safari have none, so an entry without a handle is listed but reopens through
 * the file picker.
 */
export interface RecentEntry {
  name: string;
  /** When it was last opened or saved, ms since the epoch. */
  at: number;
  /** IndexedDB key of the file handle, when one could be kept. */
  handleKey?: string;
}

export const MAX_RECENTS = 10;

export const recentFilesAtom = atomWithStorage<RecentEntry[]>("scmjs.recents", [], createJSONStorage(browserStorage), { getOnInit: true });

/** Put `name` at the top of the recents, keeping (or replacing) its handle key; the handle itself goes to IndexedDB. */
export const pushRecentAtom = atom(null, (get, set, req: { name: string; handle: MapFileHandle | null }) => {
  const { name, handle } = req;
  const key = handle ? `recent:${name}` : get(recentFilesAtom).find((r) => r.name === name)?.handleKey;
  const entry: RecentEntry = { name, at: Date.now(), ...(key ? { handleKey: key } : {}) };
  set(recentFilesAtom, [entry, ...get(recentFilesAtom).filter((r) => r.name !== name)].slice(0, MAX_RECENTS));
  if (handle) void storeHandle(`recent:${name}`, handle);
});

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
  afterWholeDocumentChange(get, set);
  return result;
});

export interface ChangeTilesetRequest {
  tileset: TilesetId;
  /** ISOM id of the terrain the map is refilled with (the tileset's default when omitted). */
  terrainId?: number;
  /** Keep the tile numbers and change only ERA. */
  keepTiles?: boolean;
}

/**
 * Scenario ▸ Map Properties ▸ Tileset: change ERA and refill the terrain (editor/tileset.ts).
 * A transaction like Resize — history dropped, every revision bumped. The new tileset's
 * graphics should be loaded first (`ensureTileset`) so the fill uses real tile ids; the
 * caller does that, since an atom cannot await. Null when there is no map.
 */
export const changeTilesetAtom = atom(null, (get, set, req: ChangeTilesetRequest): ChangeTilesetResult | null => {
  const scn = get(scenarioAtom);
  if (!scn) return null;
  const era = Math.max(0, TILESETS.findIndex((t) => t.id === req.tileset));
  const previous = peekTileset(get(tilesetFileNameAtom));
  const next = peekTileset(TILESET_FILENAMES[era]);
  const tileset = next?.tileset ?? null;
  const result = changeTileset(scn, {
    era, tileset, keepTiles: req.keepTiles,
    fill: baseTerrain(tileset, req.terrainId ?? TILESETS[era].defaultIsom),
    doodads: previous?.doodads ?? null,
  });
  set(mapTilesetAtom, req.tileset);
  afterWholeDocumentChange(get, set);
  return result;
});

/** What every transaction that moves the whole document does afterwards: drop the history, clear the selections, repaint everything. */
function afterWholeDocumentChange(get: Getter, set: Setter) {
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
}

export const tilesetFileNameAtom = atom<TilesetFileName>((get) => {
  const scn = get(scenarioAtom);
  // The scenario is mutated in place; a tileset change bumps the settings revision so this re-reads ERA.
  get(settingsRevisionAtom);
  if (scn) return TILESET_FILENAMES[tilesetIndex(scn)];
  const id = get(mapTilesetAtom);
  const index = TILESETS.findIndex((t) => t.id === id);
  return TILESET_FILENAMES[index < 0 ? 0 : index];
});

export interface LoadedDocument {
  scenario: Scenario;
  extras: Map<string, Uint8Array>;
  /** Members carried as stored (`readMembers`); none when omitted. */
  stored?: StoredMembers | null;
  fileName: string | null;
  /** A handle Save can write straight back to, when the browser gave one. */
  handle?: MapFileHandle | null;
  /** How the scenario was stored in the archive it came from. */
  origin?: MemberInfo | null;
  /** How the document came to be installed; File ▸ Open when omitted. */
  reason?: DocumentChangeReason;
  /**
   * Where the document goes: `"tab"` keeps the open map beside it (parked, to come back
   * to), `"replace"` — the default, and what a `"replace"` reason always does — takes the
   * open map's place. `openTarget` in `useMapFileActions` decides between them from the
   * preference; the atom itself has no opinion.
   */
  into?: "tab" | "replace";
}

/**
 * Why `scenarioAtom` last changed: a file opened, a new map, the map closed, the open one
 * re-parsed (a raw section edit), or another open map brought to the front.
 */
export type DocumentChangeReason = "open" | "new" | "close" | "replace" | "switch";

/**
 * The reason behind the latest `scenarioAtom` change, with the object it applies to so a
 * reader can tell a stale entry (a test setting `scenarioAtom` directly) from a current one.
 * The plugin host turns it into the `"document"` event's payload.
 */
export const documentChangeAtom = atom<{ reason: DocumentChangeReason; scenario: Scenario | null }>({ reason: "close", scenario: null });

/* ── Several maps open at once ───────────────────────────── */

/**
 * Everything the document registers hold for one map — the atoms above and in
 * `editorAtoms.ts` that describe *the open document* rather than the editor's tools —
 * kept while another map is in front. The registers stay the one place every hook and
 * panel reads; a map that is not in front does no work and holds no subscriptions, it is
 * this record and nothing else. Bringing it back is `activateDocumentAtom`: the front
 * map is parked the same way and this one is put into the registers.
 */
export interface ParkedDocument {
  scenario: Scenario;
  extras: Map<string, Uint8Array>;
  stored: StoredMembers | null;
  fileName: string | null;
  handle: MapFileHandle | null;
  origin: MemberInfo | null;
  saveOptions: SaveOptions | null;
  modified: boolean;
  blankFill: { terrainId: number } | null;
  undo: HistoryEntry[];
  redo: HistoryEntry[];
  selected: { units: number[]; doodads: number[]; sprites: number[]; locations: number[] };
  clipSelection: Rect | null;
  zoom: number;
  /** The tile at the middle of the view, so the map comes back where it was left; null for a map never shown. */
  center: { x: number; y: number } | null;
}

/** One open map: the one in front (`parked` null — the registers hold it) or one waiting behind it. */
export interface DocumentSlot {
  id: number;
  parked: ParkedDocument | null;
}

/**
 * The open maps in the order the tab strip and the Window menu show them. Exactly one has
 * `parked` null while a map is open: that is the one in the registers. Empty when nothing
 * is open — or when a scenario was put into `scenarioAtom` behind the writers' backs (a
 * test), in which case there is a map and no slot for it, and `activeDocumentIdAtom` is null.
 */
export const documentsAtom = atom<DocumentSlot[]>([]);

let nextDocumentId = 1;

/** The id of the map in front, or null with no map (or no slot for it). Ids are never reused in a session. */
export const activeDocumentIdAtom = atom<number | null>((get) => get(documentsAtom).find((d) => d.parked === null)?.id ?? null);

/** Whether any open map — in front or parked — has unsaved changes; what leaving the editor asks about. */
export const anyModifiedAtom = atom<boolean>((get) => get(mapModifiedAtom) || get(documentsAtom).some((d) => d.parked?.modified === true));

/** The tilesets the parked maps draw with, so `useTileset` keeps them decoded across a switch. */
export const parkedTilesetsAtom = atom<Set<TilesetFileName>>((get) => {
  const held = new Set<TilesetFileName>();
  for (const d of get(documentsAtom)) if (d.parked) held.add(TILESET_FILENAMES[tilesetIndex(d.parked.scenario)]);
  return held;
});

/**
 * The open maps as the chrome and the plugin API list them. The one in front is read from
 * the registers (its record in `documentsAtom` is empty by design); a parked one from its record.
 */
export const documentTabsAtom = atom<OpenDocumentInfo[]>((get) =>
  get(documentsAtom).map(({ id, parked: p }): OpenDocumentInfo =>
    p
      ? {
        id, name: scenarioName(p.scenario) ?? p.fileName ?? "Untitled Scenario", fileName: p.fileName,
        tileset: (TILESETS[tilesetIndex(p.scenario)]?.id ?? "jungle") as TilesetId, width: p.scenario.width, height: p.scenario.height, modified: p.modified, active: false,
      }
      : { id, name: get(mapNameAtom), fileName: get(mapFilePathAtom), tileset: get(mapTilesetAtom), width: get(mapWidthAtom), height: get(mapHeightAtom), modified: get(mapModifiedAtom), active: true }));

/** The registers as a record: what parking the front map keeps. Null with no map. */
function parkRegisters(get: Getter): ParkedDocument | null {
  const scenario = get(scenarioAtom);
  if (!scenario) return null;
  const v = get(viewportRectAtom);
  return {
    scenario, extras: get(archiveExtrasAtom), stored: get(archiveStoredAtom), fileName: get(mapFilePathAtom), handle: get(mapFileHandleAtom), origin: get(mapOriginAtom),
    saveOptions: get(saveOptionsAtom), modified: get(mapModifiedAtom), blankFill: get(blankFillAtom), undo: get(undoStackAtom), redo: get(redoStackAtom),
    selected: { units: get(selectedUnitsAtom), doodads: get(selectedDoodadsAtom), sprites: get(selectedSpritesAtom), locations: get(selectedLocationsAtom) },
    clipSelection: get(clipSelectionAtom), zoom: get(zoomAtom),
    // The viewport has not measured itself before the first paint (w = h = 1): nothing to come back to.
    center: v.w > 1 || v.h > 1 ? { x: v.x + v.w / 2, y: v.y + v.h / 2 } : null,
  };
}

/**
 * Put a record into the registers — the one write behind opening, switching and closing
 * onto a neighbour — mirroring the scenario's fields into the atoms the chrome displays and
 * bumping every revision, since everything drawn is now another object. Selections, the
 * history and the view come from the record: empty for a map just opened, as left for one
 * coming back. The placing modes are always off — a click on the map that arrives should select.
 */
/** The document lifecycle in a reader's words; the reasons themselves are the event's vocabulary. */
const DOCUMENT_LINES: Partial<Record<DocumentChangeReason, string>> = {
  open: "Map opened",
  new: "New map",
  switch: "Switched to another open map",
  replace: "Map parsed again from edited bytes",
};

function installRegisters(get: Getter, set: Setter, p: ParkedDocument, reason: DocumentChangeReason) {
  const { scenario } = p;
  logInfo("document", DOCUMENT_LINES[reason] ?? `Map ${reason}`, {
    file: baseName(p.fileName), width: scenario.width, height: scenario.height,
    tileset: TILESETS[tilesetIndex(scenario)]?.id, version: scenario.fileVersion, open: get(documentsAtom).length,
  });
  set(documentChangeAtom, { reason, scenario });
  set(scenarioAtom, scenario);
  set(archiveExtrasAtom, p.extras);
  set(archiveStoredAtom, p.stored);
  set(mapFilePathAtom, p.fileName);
  set(mapFileHandleAtom, p.handle);
  set(mapOriginAtom, p.origin);
  set(saveOptionsAtom, p.saveOptions);

  set(mapNameAtom, scenarioName(scenario) ?? p.fileName ?? "Untitled Scenario");
  set(mapDescriptionAtom, scenarioDescription(scenario) ?? "");
  set(mapWidthAtom, scenario.width);
  set(mapHeightAtom, scenario.height);
  set(mapTilesetAtom, (TILESETS[tilesetIndex(scenario)]?.id ?? "jungle") as TilesetId);
  set(mapVersionAtom, mapVersionOf(scenario.fileVersion));
  set(mapModifiedAtom, p.modified);
  set(blankFillAtom, p.blankFill);
  set(undoStackAtom, p.undo);
  set(redoStackAtom, p.redo);
  set(selectedUnitsAtom, p.selected.units);
  set(selectedDoodadsAtom, p.selected.doodads);
  set(selectedSpritesAtom, p.selected.sprites);
  set(selectedLocationsAtom, p.selected.locations);
  set(doodadPlacingAtom, false);
  set(spritePlacingAtom, false);
  // The clip itself is kept — copying between maps is the point — but the marked area belongs to a map.
  set(clipSelectionAtom, p.clipSelection);
  set(clipPastingAtom, false);
  set(zoomAtom, p.zoom);
  if (p.center) set(centerViewOnAtom, p.center);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  set(isomRevisionAtom, get(isomRevisionAtom) + 1);
  set(settingsRevisionAtom, get(settingsRevisionAtom) + 1);
  set(triggersRevisionAtom, get(triggersRevisionAtom) + 1);
}

/**
 * Install a freshly parsed scenario, mirroring the fields the existing UI atoms read.
 * Those atoms stay the editor's source of truth for display; `scenarioAtom` is the
 * source of truth for what gets written back out.
 *
 * With `into: "tab"` the map in front is parked and the new one takes a slot after the
 * last; otherwise it takes the front map's slot (a new id — it is another document), or
 * the first slot when nothing was open. A `"replace"` reason is the same document parsed
 * again and keeps its slot, its id and the save options the user confirmed for it.
 */
export const loadDocumentAtom = atom(null, (get, set, doc: LoadedDocument) => {
  const reason = doc.reason ?? "open";
  const docs = get(documentsAtom);
  const front = docs.findIndex((d) => d.parked === null);
  if (reason === "replace" && front >= 0) {
    // Same slot, same id.
  } else if (doc.into === "tab" && front >= 0) {
    const parked = parkRegisters(get);
    set(documentsAtom, [...docs.map((d, i) => (i === front ? { id: d.id, parked } : d)), { id: nextDocumentId++, parked: null }]);
  } else if (front >= 0) {
    set(documentsAtom, docs.map((d, i) => (i === front ? { id: nextDocumentId++, parked: null } : d)));
  } else {
    set(documentsAtom, [...docs, { id: nextDocumentId++, parked: null }]);
  }

  installRegisters(get, set, {
    scenario: doc.scenario, extras: doc.extras, stored: doc.stored ?? null, fileName: doc.fileName, handle: doc.handle ?? null, origin: doc.origin ?? null,
    // A re-parse keeps the options the user confirmed; a new document starts from the defaults.
    saveOptions: reason === "replace" ? get(saveOptionsAtom) : null,
    modified: false,
    // A fill laid without the graphics belongs to the map that is going away; `newMapInto`
    // sets it again for the one arriving when it had none either.
    blankFill: null,
    undo: [], redo: [], selected: { units: [], doodads: [], sprites: [], locations: [] }, clipSelection: null,
    zoom: get(zoomAtom), center: null,
  }, reason);

  if (doc.fileName) {
    set(pushRecentAtom, { name: doc.fileName, handle: doc.handle ?? null });
  }
});

/**
 * Install a scenario parsed again from edited bytes — a plugin's raw section edit — in
 * place of the open one: the same file name and archive extras, the map marked modified,
 * and, as with Resize, the history dropped and every selection cleared, since any part
 * of the document may have changed. The mirror atoms are refilled from the new object.
 */
export const replaceScenarioAtom = atom(null, (get, set, scenario: Scenario) => {
  set(loadDocumentAtom, {
    scenario, extras: get(archiveExtrasAtom), stored: get(archiveStoredAtom), fileName: get(mapFilePathAtom), handle: get(mapFileHandleAtom), origin: get(mapOriginAtom), reason: "replace",
  });
  set(mapModifiedAtom, true);
});

/**
 * Bring a parked map to the front: the front map is parked as it stands — its history,
 * selections, marked area and view included — and `id`'s record goes into the registers,
 * so every hook and panel shows the other map. Nothing is parsed or re-laid; the cost is
 * the atom writes and one repaint. False for an id that is not open; true (and nothing
 * done) for the one already in front. Fires `"switch"`.
 */
export const activateDocumentAtom = atom(null, (get, set, id: number): boolean => {
  const docs = get(documentsAtom);
  const target = docs.find((d) => d.id === id);
  if (!target) return false;
  if (!target.parked) return true;
  const parked = parkRegisters(get);
  set(documentsAtom, docs.map((d) => (d === target ? { id, parked: null } : d.parked === null && parked ? { id: d.id, parked } : d)));
  installRegisters(get, set, target.parked, "switch");
  return true;
});

/**
 * Close the map in front. The one to its right comes to the front (the one to its left
 * when it was last), with reason `"switch"` — a map is still open, and the listeners
 * learn which from its id; with no other map the registers are cleared, reason `"close"`.
 */
export const closeDocumentAtom = atom(null, (get, set) => {
  const docs = get(documentsAtom);
  const front = docs.findIndex((d) => d.parked === null);
  const rest = front >= 0 ? docs.filter((_, i) => i !== front) : docs;
  const next = front >= 0 ? rest[front] ?? rest[front - 1] ?? null : null;
  if (next?.parked) {
    set(documentsAtom, rest.map((d) => (d === next ? { id: d.id, parked: null } : d)));
    installRegisters(get, set, next.parked, "switch");
    return;
  }
  set(documentsAtom, rest);
  logInfo("document", "Map closed; none open");
  set(documentChangeAtom, { reason: "close", scenario: null });
  set(scenarioAtom, null);
  set(archiveExtrasAtom, new Map());
  set(archiveStoredAtom, null);
  set(mapFilePathAtom, null);
  set(mapFileHandleAtom, null);
  set(mapOriginAtom, null);
  set(saveOptionsAtom, null);
  set(mapModifiedAtom, false);
  set(blankFillAtom, null);
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
  // Verbose only: a painting session commits a stroke every time the mouse comes up, and
  // at the always-on tier that would push everything worth reading out of the ring.
  if (isVerbose()) {
    logInfo("edit", entry.label, {
      tiles: entry.changes.length || undefined, units: entry.units?.length, doodads: entry.doodads?.length,
      sprites: entry.sprites?.length, locations: entry.locations?.length,
    });
  }
  set(undoStackAtom, [...get(undoStackAtom), entry].slice(-UNDO_LEVELS));
  set(redoStackAtom, []);
  set(mapModifiedAtom, true);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
  if (entry.units) set(unitsRevisionAtom, get(unitsRevisionAtom) + 1);
  if (touchesDoodads(entry)) set(doodadsRevisionAtom, get(doodadsRevisionAtom) + 1);
  if (entry.locations) set(locationsRevisionAtom, get(locationsRevisionAtom) + 1);
  // A rebuilt lattice is the one edit the ISOM status is re-measured after.
  if (entry.createdIsom || entry.rebuiltIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
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
      note += t(", removed {n, plural, one {# stranded unit} other {# stranded units}}", { n: stranded.length });
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
    if (entry.createdIsom || entry.rebuiltIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
    afterUnitEdit(get, set, entry);
    set(undoStackAtom, stack.slice(0, -1));
    set(redoStackAtom, [...get(redoStackAtom), entry]);
    set(mapModifiedAtom, true);
    set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
    return entry.label;
  },
);

/**
 * Take back an entry that was applied live but never committed — a plugin transaction whose
 * builder threw. The change lists are the rollback material (that is what invertible changes
 * are for): apply them backwards and repaint, and leave the history and the modified flag
 * alone, since nothing that was recorded has changed.
 */
export const rollbackEntryAtom = atom(null, (get, set, entry: HistoryEntry) => {
  const scn = get(scenarioAtom);
  if (!scn) return;
  applyEntry(scn, entry, "undo");
  if (entry.createdIsom || entry.rebuiltIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
  afterUnitEdit(get, set, entry);
  set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
});

export const redoAtom = atom(
  (get) => get(redoStackAtom).at(-1)?.label ?? null,
  (get, set) => {
    const scn = get(scenarioAtom);
    const stack = get(redoStackAtom);
    const entry = stack.at(-1);
    if (!scn || !entry) return null;
    applyEntry(scn, entry, "do");
    if (entry.createdIsom || entry.rebuiltIsom) set(isomRevisionAtom, get(isomRevisionAtom) + 1);
    afterUnitEdit(get, set, entry);
    set(redoStackAtom, stack.slice(0, -1));
    set(undoStackAtom, [...get(undoStackAtom), entry]);
    set(mapModifiedAtom, true);
    set(terrainRevisionAtom, get(terrainRevisionAtom) + 1);
    return entry.label;
  },
);

/* ── Derived overlays ────────────────────────────────────── */

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
    .filter((u) => u.unitId === START_LOCATION)
    .map((u) => ({ player: u.owner, x: u.x / 32, y: u.y / 32 }));
});

/* ── Doodad selection edits ──────────────────────────────── */

/**
 * Edit ▸ Select All (Ctrl+A) on an object layer: every doodad, sprite, used location (never
 * Anywhere) or unit; the clipboard layer marks the whole map through its own hook. Returns
 * how many were selected.
 */
export const selectAllAtom = atom(null, (get, set, layer: EditorLayer): number => {
  const scn = get(scenarioAtom);
  if (!scn) return 0;
  const all = (n: number) => Array.from({ length: n }, (_, i) => i);
  switch (layer) {
    case "doodads": set(selectedDoodadsAtom, all(scn.doodads.length)); return scn.doodads.length;
    case "sprites": set(selectedSpritesAtom, all(scn.sprites.length)); return scn.sprites.length;
    case "locations": { const used = usedLocations(scn).filter((i) => i !== ANYWHERE_INDEX); set(selectedLocationsAtom, used); return used.length; }
    default: set(selectedUnitsAtom, all(scn.units.length)); return scn.units.length;
  }
});

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
  set(commitEditAtom, { label: t("Delete {n, plural, one {# doodad} other {# doodads}}", { n }), changes: [], doodadTiles: edit.tiles, doodads: edit.doodads, sprites: edit.sprites });
  return n;
});

/**
 * Turn the selected doodads into plain terrain as one undo step: the records go, the
 * tiles stay and are written into TILE too, the overlay sprites remain as ordinary
 * sprites. Returns how many were converted.
 */
export const convertSelectedDoodadsAtom = atom(null, (get, set) => {
  const scn = get(scenarioAtom);
  const selected = get(selectedDoodadsAtom);
  if (!scn || selected.length === 0) return 0;
  const loaded = peekTileset(get(tilesetFileNameAtom));
  const edit = convertDoodads(scn, loaded?.doodads ?? NO_DOODADS, selected);
  applyChanges(scn, edit.tiles);
  applyDoodadChanges(scn, edit.doodads);
  set(selectedDoodadsAtom, []);
  const n = edit.doodads.length;
  set(commitEditAtom, { label: t("Convert {n, plural, one {# doodad} other {# doodads}} to terrain", { n }), changes: edit.tiles, doodads: edit.doodads });
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
  set(commitEditAtom, { label: t("Delete {length, plural, one {# sprite} other {# sprites}}", { length: sprites.length }), changes: [], sprites });
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
  set(commitEditAtom, { label: t("Delete {length, plural, one {# unit} other {# units}}", { length: units.length }), changes: [], units });
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
  const label = locations.length === 1 ? t("Delete location {name}", { name: locationName(scn, locations[0].index) }) : t("Delete {n} locations", { n: locations.length });
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
  set(commitEditAtom, { label: locations.length === 1 ? t("Move location {locationName}", { locationName: locationName(scn, locations[0].index) }) : t("Move {length} locations", { length: locations.length }), changes: [], locations });
  return locations.length;
});
