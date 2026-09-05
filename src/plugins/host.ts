/**
 * The plugin host: builds a `PluginApi` for one plugin over the editor's Jotai store,
 * runs `activate`, and takes every contribution back on deactivation.
 *
 * Nothing here is React. Reads go through `store.get`, writes through the same atoms
 * the hooks use, and an edit becomes one `HistoryEntry` handed to `commitTerrainAtom`
 * — the path a brush stroke takes — so a plugin edit undoes, marks sections dirty,
 * lifts stranded doodads and units, and repaints exactly like the built-in tools.
 */
import type { createStore } from "jotai";
import {
  activeDoodadAtom, activeLayerAtom, activeSpriteAtom, activeSpriteKindAtom, activeTerrainAtom, activeTileAtom, activeUnitAtom, activeUnitSpriteAtom, brushSizeAtom,
  centerViewOnAtom, clipboardAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, clipSelectionAtom, cursorTileAtom, doodadPlacementAtom, fogModeAtom, fogPlayersAtom,
  fogViewPlayerAtom, gridSizeAtom, locationSnapAtom, lockedLayersAtom, mapDescriptionAtom, mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom,
  mapNameAtom, mapOriginAtom, mapTilesetAtom, placementOptionsAtom, rectVariationAtom, saveOptionsAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom,
  spritePlaceOptionsAtom, symmetryAtom, terrainModeAtom, unitOwnerAtom, viewFlagsAtom, viewportRectAtom, viewportRepaintAtom, zoomAtom, type EditorLayer,
} from "../atoms/editorAtoms";
import {
  archiveExtrasAtom, changeTilesetAtom, commitEditAtom, commitSettingsAtom, commitTerrainAtom, commitTriggersAtom, documentChangeAtom, doodadsRevisionAtom, locationsRevisionAtom,
  recentFilesAtom, redoAtom, redoStackAtom, replaceScenarioAtom, resizeDocumentAtom, scenarioAtom, settingsRevisionAtom, terrainRevisionAtom, tilesetFileNameAtom, triggersRevisionAtom,
  undoAtom, undoStackAtom, unitsRevisionAtom, type HistoryEntry,
} from "../atoms/documentAtoms";
import { closeDialogAtom, dialogStackAtom, openDialogAtom, pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { gridLookAtom, preferencesAtom } from "../atoms/preferencesAtoms";
import {
  installedPluginsAtom, mapPickAtom, mapToolAtom, mapToolRevisionAtom, nextContributionKey, normalizeCombo, overlayMemoryKey, overlayVisibilityMemory, pluginCodeAtom,
  pluginCommandsAtom, pluginContextItemsAtom, pluginHotkeysAtom, pluginManifestCacheAtom, pluginMenuItemsAtom, pluginOverlayRevisionAtom, pluginOverlaysAtom, pluginPanelsAtom, pluginTriggerClaimsAtom, type PluginTriggerClaim,
  pluginRuntimesAtom, setOverlayVisibleAtom,
  type CachedManifest, type MapPickKind, type PluginInstall, type PluginRuntime, type TitleBox,
} from "../atoms/pluginAtoms";
import { browserStorage, STORAGE_PREFIX } from "../atoms/storage";
import { TILESET_BY_ID, TILESETS } from "../data/tilesets";
import { markDirty, scenarioDescription, scenarioName, setScenarioDescription, setScenarioName, strSectionName, tilesetIndex } from "../formats/chk/scenario";
import { ensureTileset, peekTileset, type LoadedTileset } from "../formats/tileset/load";
import { megatileForTile } from "../formats/tileset/decode";
import { NO_DOODADS } from "../formats/tileset/doodads";
import { flatTerrain, variationsOf } from "../formats/tileset/terrain";
import { terrainTypes, tileInfo } from "../formats/tileset/palette";
import { getUnitAssets, imageGrpPath, peekUnitAssets, requestGrp } from "../formats/units/load";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { DEFAULT_PROFILE } from "../gamedata/profiles";
import { currentAssetSource, type AssetSource } from "../gamedata/source";
import { installDataSetInto, listDataSets, removeDataSet, switchDataSet } from "../services/gameData";
import { displayColorHex, PLAYER_RACES, PLAYER_TYPES, playerRaceLabel, playerTypeLabel } from "../data/players";
import { TECH_NAMES, techName, UNIT_GROUPS, UNIT_NAMES, unitName, UPGRADE_NAMES, upgradeName } from "../data/units";
import { WEAPON_NAMES, weaponName } from "../data/weapons";
import {
  ACTION_DEFS, actionDef, aiScriptName, BRIEFING_ACTION_DEFS, CHOICES, choiceLabel, choiceValue, CONDITION_DEFS, conditionDef, DEATHS_TABLE_ADDRESS, PLAYER_GROUP_CHOICES, UNIT_CLASS_CHOICES,
} from "../data/triggerDefs";
import {
  ActionFlag, ActionType, AllianceStatus, BriefingActionType, Comparison, ConditionFlag, ConditionType,
  Order, PlayerGroup, ResourceType, ScoreType, SetModifier, SwitchAction, SwitchState, TriggerFlag,
  UnitClass, UnitState as TriggerUnitState,
} from "../formats/chk/sections/triggers";
import { getString, setString } from "../formats/chk/sections/strings";
import { boundsOf, locationName } from "../editor/locations";
import { applySwitchNames, readSwitchNames, switchUsage } from "../editor/switches";
import { applyCuwp, cuwpSlotView, cuwpSlotViews, patchCuwp, readCuwp } from "../editor/cuwp";
import { emptyCuwpSlot } from "../formats/chk/sections/cuwp";
import {
  applyBriefing, applyTriggers, insertTrigger, isPreserved, moveTrigger, newAction, newCondition, newTrigger, readBriefing, readTriggers, removeTriggers, sameTriggers,
  setPreserved, triggerNames, triggersFor,
} from "../editor/triggers";
import { formatTrigger, formatTriggers, parseTriggers, summarizeTrigger, triggerComment } from "../formats/triggers/text";
import { applyStrings, readStrings, stringUsages, unusedStrings } from "../editor/strings";
import { bleedingLines, DEFAULT_TEXT_COLOR, escapeCode, fixBleeding, INSERTABLE_CODES, plainText, runsOf, TEXT_CODES, textCode } from "../editor/textColors";
import {
  changeMapVersion, forceViews, internString, mapVersionView, patchForce, patchPlayer, patchTech, patchUnitType, patchUpgrade, playerSlotViews, techView, unitTypeView, upgradeView,
} from "../editor/settings";
import { addSound, applySounds, findMember, readWavs, removeSound, soundList, wavMemberName } from "../editor/sounds";
import { TECHS_BW, UNIT_TYPES, UPGRADES_BW } from "../formats/chk/sections/settings";
import { isUnusedTech, isUnusedUpgrade, UNIT_NAMES as UNIT_NAME_TABLE } from "../data/units";
import { validateScenario } from "../editor/validate";
import { mapStatistics } from "../editor/statistics";
import { findInScenario } from "../editor/find";
import { unitRace } from "../formats/dat/dat";
import { ANYWHERE_INDEX, Elevation, isLocationUsed, SpriteFlag, UnitRelation, UnitState, UnitUsed, UnitValid, type SpriteRecord } from "../formats/chk/sections/objects";
import { START_LOCATION } from "../data/units";
import {
  combinedSection, currentChk, defaultSectionBytes, editRaw, insertSection, knownSections, moveSection, parseRaw, rebuildSections, removeSection, renameSection,
  replaceSectionData, requiredSectionNames, sectionInfos, sectionKnowledge,
} from "../editor/sections";
import { serializeChk, type ChkFile } from "../formats/chk/reader";
import { spriteCatalogue } from "../data/sprites";
import { spriteName } from "../hooks/useSpriteTools";
import { doodadLabel } from "../hooks/useDoodadTools";
import { checkPlacement } from "../editor/placement";
import type { DoodadDef } from "../formats/tileset/doodads";
import { applyChanges, stampTerrain, stampTile, Stroke, type Rect, type TileChange } from "../editor/terrain";
import { createGraphicsApi } from "./graphics";
import { alertDialog, confirmDialog, progressPanel, promptDialog } from "./prompts";
import { createWidgets, el } from "./widgets";
import {
  applyIsomChanges, diamondAt, hasIsom, isDiamond, isomHeight, isomReport, isomTables, isomTerrainAt, isomTerrains, isomWidth, paintIsom, rebuildIsomFromTiles, type Diamond,
} from "../editor/isom";
import { hasEdits } from "../editor/history";
import { addUnits, applyUnitChanges, DEFAULT_GAS, DEFAULT_MINERALS, isResource, makeUnit, MINERAL_FIELD_IDS, nextSerial, removeUnits, snapPlacement, TILE_PX, unitAt, unitBox, unitGeometry, updateUnits, VESPENE_GEYSER, type UnitChange } from "../editor/units";
import {
  addSprites, applySpriteChanges, clampSprite, FALLBACK_SIZE, makeSprite, removeSprites, spriteAt, spriteKind, spritesInBox, type SpriteChange, type SpriteSize,
} from "../editor/sprites";
import { applyDoodadChanges, doodadAt, placeDoodad, removeDoodads, type DoodadChange } from "../editor/doodads";
import { addLocation, applyLocationChanges, editLocation, ensureLocationSlots, locationAt, removeLocations, type LocationChange } from "../editor/locations";
import { applyFogChanges, ensureMask, paintFog } from "../editor/fog";
import {
  pluginIdOf, PLUGIN_API_VERSION,
  type Cells, type CommandInfo, type DataApi, type Deactivate, type GameDataApi, type GameDataSource, type DialogHandle, type DocumentEvent, type DoodadInfo, type EditResult, type EditTransaction, type MapToolHandle,
  type MapToolSpec, type MapToolStopReason, type OverlayHandle, type OverlaySpec, type PanelHandle, type PickOptions, type PluginApi, type PluginEvent,
  type ClipboardApi, type ClipSource,
  type PluginIcon, type PluginInfo, type PluginManifest, type PluginModule, type QueryApi, type RawEditResult, type SectionsApi, type StartLocation,
  type ContextMenuContext, type NewDocumentOptions, type SettingsApi, type TriggerListUpdate, type TriggerRecord, type TriggersApi, type UnitTypeView, type UpdateResult,
  type UpdateTransaction, type ViewApi,
} from "./api";
import { isPinned, loadPlugin, parseSpec, previewPlugin, recordingDeps, resolvePlugin, storedDeps, type LoaderDeps, type PluginPreview } from "./loader";
import { loadImage, readClipboardImage } from "./images";
import { BUILTIN_PLUGINS } from "./builtin";
import { defaultPlugins, pluginKey, type DefaultPlugin } from "./defaults";
import { transpileInBackground } from "./transpileClient";
import { askDialog, closeMapIn, guardedAction, newMapInto, openFileInto, saveDocument } from "../hooks/useMapFileActions";
import { defaultSaveOptions } from "../editor/save";
import { saveBlob } from "../services/mapIo";
import { ensureTileset as loadTilesetFiles, TILESET_FILENAMES } from "../formats/tileset/load";
import { floodRegion, flatGroupOf, replaceTerrain } from "../editor/terrain";
import { blendCandidates, DEFAULT_BLEND_OPTIONS, placeBlend } from "../editor/blend";
import { tilesFromIsom } from "../editor/isom";
import { mirrorIndices, mirrorPixel, symmetryAvailable } from "../editor/symmetry";
import { moveUnits } from "../editor/units";
import { moveSprites, updateSprites } from "../editor/sprites";
import { updateDoodads } from "../editor/doodads";
import { restoreAnywhere } from "../editor/locations";
import { copyFog, floodFog, fogPlayersAt, invertFog } from "../editor/fog";
import { DEFAULT_START_PLACEMENT, placeStartLocations } from "../editor/startLocations";
import { applyStringImport, decodeTrg, encodeTrg, formatStringTable, parseStringTable } from "../editor/exchange";
import { clipSummary, copyObjects, copyRegion, EMPTY_SELECTION, pasteClip, regionObjects as regionObjectsOf, removeObjects, selectionSize, type Clip, type ObjectSelection } from "../editor/clipboard";
import { isUnitAvailable } from "../formats/chk/sections/settings";
import { writeMapBytes } from "../services/mapIo";
import { DEFAULT_IMAGE_OPTIONS, exportMapImage } from "../services/mapImage";

export type Store = ReturnType<typeof createStore>;

/* ── Contributions ──────────────────────────────────────── */

/** Everything one plugin registered, so deactivation can take it all back. */
export class Contributions {
  readonly disposables: (() => void)[] = [];
  readonly counts = { menu: 0, contextMenu: 0, hotkeys: 0, events: 0 };

  add(dispose: () => void, kind?: keyof Contributions["counts"]) {
    this.disposables.push(dispose);
    if (kind) this.counts[kind]++;
    return { dispose: () => { dispose(); const i = this.disposables.indexOf(dispose); if (i >= 0) this.disposables.splice(i, 1); } };
  }

  dispose() {
    for (const d of this.disposables.splice(0)) {
      try { d(); } catch (err) { console.error("[plugins] dispose failed", err); }
    }
  }
}

/* ── Transactions ───────────────────────────────────────── */

const EMPTY_RESULT: EditResult = { changed: false, tiles: 0, isom: 0, units: 0, sprites: 0, doodads: 0, locations: 0, fog: 0, notes: [] };

/**
 * A builder that hands back a promise is an `async` one, and a transaction cannot span
 * an await: it commits the moment the builder returns, so everything after that first
 * await mutates the scenario outside the entry and undo cannot take it back. TypeScript
 * refuses one (`Sync` in `api.ts`); a plugin written in plain JavaScript finds out here,
 * in its result's notes and in the console, rather than through an undo that half works.
 */
function checkSyncBuilder(call: string, returned: unknown, notes: string[]): void {
  if (typeof (returned as PromiseLike<unknown> | null | undefined)?.then !== "function") return;
  const text = `${call}'s builder is async — a transaction commits when the builder returns, so anything after its first await is outside the undo entry. Await before the call, not inside it.`;
  notes.push(text);
  console.error(`[scmJS] ${text}`);
}

/**
 * Run `build` against a transaction over the open scenario and commit what it did as
 * one undo entry. Operations apply as they are called and accumulate change lists in
 * `applyEntry` order; the terrain lists go through `Stroke` so a cell written twice
 * records one change from its original tile to its final one.
 */
export function runTransaction(store: Store, label: string, build: (tx: EditTransaction) => unknown): EditResult {
  const scn = store.get(scenarioAtom);
  if (!scn) return { ...EMPTY_RESULT, notes: ["no map is open"] };
  const loaded = peekTileset(store.get(tilesetFileNameAtom));
  const names = TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  const w = scn.width, h = scn.height;

  const tiles = new Stroke();
  const isom = new Stroke();
  const fog = new Stroke();
  const doodadTiles: TileChange[] = [];
  const doodads: DoodadChange[] = [];
  const sprites: SpriteChange[] = [];
  const units: UnitChange[] = [];
  const locations: LocationChange[] = [];
  const notes: string[] = [];
  let createdMask: Uint8Array | undefined;
  let createdIsom: Uint16Array | undefined;
  let serial = nextSerial(scn);

  const cellsOf = (cells: Cells): number[] => {
    if (typeof (cells as Rect).x0 === "number") {
      const r = cells as Rect;
      const out: number[] = [];
      for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) out.push(y * w + x);
      return out;
    }
    return [...(cells as Iterable<number>)].filter((at) => at >= 0 && at < w * h);
  };
  const flatOf = (terrainId: number) => {
    if (!loaded) { notes.push("terrain painting needs the tileset graphics"); return null; }
    const type = terrainTypes(loaded.tileset, names).find((t) => t.id === terrainId);
    if (!type) { notes.push(`terrain ${terrainId} is not a flat terrain of this tileset`); return null; }
    return type;
  };
  const applyTiles = (changes: TileChange[]) => { applyChanges(scn, changes); tiles.add(changes); return changes.length; };
  const tables = () => peekUnitAssets()?.units ?? null;

  const tx: EditTransaction = {
    scenario: scn,
    width: w,
    height: h,
    tileAt: (x, y) => scn.tiles[y * w + x],
    groundAt: (x, y) => scn.editorTiles[y * w + x],
    setTile: (x, y, id) => { applyTiles(stampTile(scn, [y * w + x], id)); },
    setTiles: (cells, id) => applyTiles(stampTile(scn, cellsOf(cells), id)),
    stampTerrain: (cells, terrainId, variation = -1) => {
      const type = flatOf(terrainId);
      if (!type || !loaded) return 0;
      return applyTiles(stampTerrain(scn, loaded.tileset, { group: type.group, variation }, cellsOf(cells)));
    },
    fillFlat: (rect, terrainId) => {
      const type = flatOf(terrainId);
      if (!type || !loaded) return 0;
      const flat = flatTerrain(w, h, { id: type.id, group: type.group }, loaded.tileset, Math.random, tilesetIndex(scn));
      const changes: TileChange[] = [];
      for (const at of cellsOf(rect)) if (scn.tiles[at] !== flat.tiles[at]) changes.push({ at, before: scn.tiles[at], after: flat.tiles[at] });
      const n = applyTiles(changes);
      if (hasIsom(scn) && scn.isom.length === flat.isom.length) {
        const iw = isomWidth(scn);
        const changesIsom: TileChange[] = [];
        for (let ry = Math.max(0, rect.y0); ry < Math.min(h, rect.y1); ry++) {
          for (let rx = Math.max(0, rect.x0 >> 1); rx <= Math.min(iw - 1, (rect.x1 - 1) >> 1); rx++) {
            for (let side = 0; side < 4; side++) {
              const i = (ry * iw + rx) * 4 + side;
              if (scn.isom[i] !== flat.isom[i]) changesIsom.push({ at: i, before: scn.isom[i], after: flat.isom[i] });
            }
          }
        }
        applyIsomChanges(scn, changesIsom);
        isom.add(changesIsom);
        if (changesIsom.length > 0) markDirty(scn, "ISOM");
      }
      return n;
    },
    paintIsom: (d, terrainId, extent = 1) => {
      if (!hasIsom(scn) || !loaded) return false;
      const edit = paintIsom(scn, loaded.tileset, d, terrainId, extent);
      if (!edit) return false;
      tiles.add(edit.tiles);
      isom.add(edit.isom);
      return true;
    },
    rebuildIsom: () => {
      if (!loaded) { notes.push("rebuilding the ISOM needs the tileset graphics"); return null; }
      const rebuilt = rebuildIsomFromTiles(scn, loaded.tileset);
      const base = { diamonds: rebuilt.diamonds, unresolved: rebuilt.unresolved };
      if (hasIsom(scn) && scn.isom.length === rebuilt.isom.length && !createdIsom) {
        const changes: TileChange[] = [];
        for (let i = 0; i < rebuilt.isom.length; i++) if (scn.isom[i] !== rebuilt.isom[i]) changes.push({ at: i, before: scn.isom[i], after: rebuilt.isom[i] });
        applyIsomChanges(scn, changes);
        isom.add(changes);
        return { ...base, created: false, changed: changes.length };
      }
      // No usable lattice (or one this transaction already created): the whole section is the change.
      scn.isom = rebuilt.isom;
      markDirty(scn, "ISOM");
      createdIsom = rebuilt.isom;
      return { ...base, created: true, changed: rebuilt.isom.length };
    },

    makeUnit: (unitId, owner, x, y) => makeUnit(tables(), unitId, owner, x, y, serial++),
    addUnits: (records) => { const ch = addUnits(scn, records); applyUnitChanges(scn, ch); units.push(...ch); return ch.map((c) => c.index); },
    removeUnits: (indices) => { const ch = removeUnits(scn, indices); applyUnitChanges(scn, ch); units.push(...ch); return ch.length; },
    updateUnits: (indices, patch) => { const ch = updateUnits(scn, indices, patch); applyUnitChanges(scn, ch); units.push(...ch); return ch.length; },
    placeUnit: (unitId, owner, x, y) => {
      const at = snapPlacement(unitGeometry(tables(), unitId), x, y, w, h, store.get(placementOptionsAtom).snapToGrid);
      const ch = addUnits(scn, [makeUnit(tables(), unitId, owner, at.x, at.y, serial++)]);
      applyUnitChanges(scn, ch);
      units.push(...ch);
      return ch[0].index;
    },
    canPlaceUnit: (unitId, x, y) => checkPlacement(scn, loaded?.tileset ?? null, tables(), store.get(placementOptionsAtom), unitId, x, y).problem === null,

    makeSprite: (kind, id, owner, x, y, opts) => makeSprite(kind, id, owner, x, y, opts),
    addSprites: (records) => { const ch = addSprites(scn, records); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.map((c) => c.index); },
    removeSprites: (indices) => { const ch = removeSprites(scn, indices); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    placeSprite: (kind, id, owner, x, y, opts) => {
      const at = clampSprite(x, y, w, h);
      const ch = addSprites(scn, [makeSprite(kind, id, owner, at.x, at.y, opts)]);
      applySpriteChanges(scn, ch);
      sprites.push(...ch);
      return ch[0].index;
    },

    placeDoodad: (doodadId, tx0, ty0, owner = 0) => {
      const def = loaded?.doodads.byId.get(doodadId);
      if (!def) { notes.push(`doodad ${doodadId} is not in this tileset`); return -1; }
      if (tx0 < 0 || ty0 < 0 || tx0 + def.width > w || ty0 + def.height > h) return -1;
      const edit = placeDoodad(scn, def, tx0, ty0, owner);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodadTiles.push(...edit.tiles);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads[0]?.index ?? -1;
    },
    removeDoodads: (indices) => {
      const edit = removeDoodads(scn, loaded?.tileset ?? null, loaded?.doodads ?? NO_DOODADS, indices);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodadTiles.push(...edit.tiles);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads.length;
    },

    addLocation: (bounds, name, elevationFlags) => {
      ensureLocationSlots(scn);
      const { index, changes } = addLocation(scn, bounds, name, elevationFlags);
      applyLocationChanges(scn, changes);
      locations.push(...changes);
      return index;
    },
    editLocation: (index, patch) => {
      const c = editLocation(scn, index, patch);
      if (!c) return false;
      applyLocationChanges(scn, [c]);
      locations.push(c);
      return true;
    },
    removeLocations: (indices) => { const ch = removeLocations(scn, indices); applyLocationChanges(scn, ch); locations.push(...ch); return ch.length; },

    setFog: (cells, players, mode) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = paintFog(scn, cellsOf(cells), players, mode);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    invertFog: (players) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = invertFog(scn, players);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    copyFog: (from, to) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = copyFog(scn, from, to);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    floodFog: (x, y, player, players, mode) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = paintFog(scn, floodFog(scn, x, y, player), players, mode);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },

    replaceTerrain: (from, to, rect) => {
      if ((from.kind === "terrain" || to.kind === "terrain") && !loaded) { notes.push("replacing a terrain type needs the tileset graphics"); return 0; }
      return applyTiles(replaceTerrain(scn, loaded?.tileset ?? null, from, to, rect));
    },
    fillArea: (x, y, fill, match = "terrainId" in fill ? "terrain" : "tile") => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const seed = scn.tiles[y * w + x];
      let region: Set<number>;
      if (match === "terrain") {
        if (!loaded) { notes.push("a terrain fill needs the tileset graphics"); return 0; }
        const groups = loaded.tileset.groups;
        const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
        const seedType = typeOf(seed);
        region = floodRegion(scn, x, y, (id) => typeOf(id) === seedType);
      } else {
        region = floodRegion(scn, x, y, (id) => id === seed);
      }
      const cells = mirrorIndices(store.get(symmetryAtom), region, w, h);
      if ("tileId" in fill) return applyTiles(stampTile(scn, cells, fill.tileId));
      const type = flatOf(fill.terrainId);
      if (!type || !loaded) return 0;
      return applyTiles(stampTerrain(scn, loaded.tileset, { group: type.group, variation: store.get(rectVariationAtom) }, cells));
    },
    placeBlend: (x, y, side, id) => {
      const ch = placeBlend(scn, { x, y }, side, id);
      if (!ch) return false;
      applyTiles(ch);
      return true;
    },
    tilesFromIsom: () => {
      if (!hasIsom(scn) || !loaded) { notes.push("regenerating the tiles needs ISOM and the tileset graphics"); return null; }
      const edit = tilesFromIsom(scn, loaded.tileset);
      applyChanges(scn, edit.tiles);
      tiles.add(edit.tiles);
      applyIsomChanges(scn, edit.isom);
      isom.add(edit.isom);
      return edit.tiles.length;
    },
    mirror: (cells) => [...mirrorIndices(store.get(symmetryAtom), cellsOf(cells), w, h)],
    mirrorPoint: (px, py) => mirrorPixel(store.get(symmetryAtom), px, py, w, h),

    moveUnits: (indices, dx, dy, snap) => {
      const ch = moveUnits(scn, tables(), indices, dx, dy, snap ?? store.get(placementOptionsAtom).snapToGrid);
      applyUnitChanges(scn, ch);
      units.push(...ch);
      return ch.length;
    },
    placeStartLocations: (options) => {
      const r = placeStartLocations(scn, loaded?.tileset ?? null, tables(), {
        ...DEFAULT_START_PLACEMENT, ...options, placement: store.get(placementOptionsAtom),
      });
      units.push(...r.changes);
      const missed = r.placed.filter((p) => p === null).length;
      if (missed > 0) notes.push(`no room for ${missed} start location${missed === 1 ? "" : "s"}`);
      return r;
    },

    updateSprites: (indices, patch) => { const ch = updateSprites(scn, indices, patch); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    moveSprites: (indices, dx, dy) => { const ch = moveSprites(scn, indices, dx, dy); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    updateDoodads: (indices, patch) => {
      const edit = updateDoodads(scn, loaded?.doodads ?? NO_DOODADS, indices, patch);
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads.length;
    },

    restoreAnywhere: () => {
      ensureLocationSlots(scn);
      const c = restoreAnywhere(scn);
      if (!c) return false;
      applyLocationChanges(scn, [c]);
      locations.push(c);
      return true;
    },

    note: (text) => { notes.push(text); },
  };

  checkSyncBuilder("document.edit", build(tx), notes);

  const entry: HistoryEntry = { label, changes: tiles.finish() };
  const isomChanges = isom.finish();
  const fogChanges = fog.finish();
  if (isomChanges.length > 0) entry.isom = isomChanges;
  if (doodadTiles.length > 0) entry.doodadTiles = doodadTiles;
  if (doodads.length > 0) entry.doodads = doodads;
  if (sprites.length > 0) entry.sprites = sprites;
  if (units.length > 0) entry.units = units;
  if (locations.length > 0) entry.locations = locations;
  if (fogChanges.length > 0) entry.fog = fogChanges;
  if (createdMask) entry.createdMask = createdMask;
  if (createdIsom) { entry.createdIsom = createdIsom; delete entry.isom; }

  if (!hasEdits(entry)) return { ...EMPTY_RESULT, notes };
  // The commit's stranded-doodad / stranded-unit pass may append to the entry's lists, so the counts come after it.
  store.set(commitTerrainAtom, { entry, summary: notes.length > 0 ? `${label} — ${notes.join(", ")}` : label });
  const strandedUnits = (entry.units?.length ?? 0) - units.length;
  const strandedDoodads = (entry.doodads?.length ?? 0) - doodads.length;
  if (strandedUnits > 0) notes.push(`removed ${strandedUnits} stranded unit${strandedUnits === 1 ? "" : "s"}`);
  if (strandedDoodads > 0) notes.push(`removed ${strandedDoodads} stranded doodad${strandedDoodads === 1 ? "" : "s"}`);
  return {
    changed: true,
    tiles: entry.changes.length,
    isom: createdIsom ? createdIsom.length : isomChanges.length,
    units: entry.units?.length ?? 0,
    sprites: entry.sprites?.length ?? 0,
    doodads: entry.doodads?.length ?? 0,
    locations: locations.length,
    fog: fogChanges.length,
    notes,
  };
}

/* ── Picking on the map ─────────────────────────────────── */

const PICK_PROMPTS: Record<MapPickKind, string> = { area: "Drag a rectangle on the map", tile: "Click a tile on the map" };

/**
 * Put a `MapPickRequest` in front of the viewport and resolve when it (or Esc, a
 * right-click, a document change, the plugin's deactivation, or a newer pick) finishes it.
 * The request's `finish` clears the atom itself, so the viewport only ever calls it.
 */
export function pickOnMap(store: Store, bag: Contributions, info: PluginInfo, kind: MapPickKind, options: PickOptions = {}): Promise<Rect | { x: number; y: number } | null> {
  return new Promise((resolve) => {
    store.get(mapPickAtom)?.finish(null);
    if (!store.get(scenarioAtom)) { resolve(null); return; }
    const key = nextContributionKey();
    const prompt = options.prompt?.trim() || PICK_PROMPTS[kind];
    let done = false;
    let unsubDoc = () => {};
    let disposable = { dispose: () => {} };
    const finish = (result: Rect | { x: number; y: number } | null) => {
      if (done) return;
      done = true;
      unsubDoc();
      disposable.dispose();
      if (store.get(mapPickAtom)?.key === key) store.set(mapPickAtom, null);
      store.set(statusMessageAtom, result ? `${prompt} — done` : `${prompt} — cancelled`);
      resolve(result);
    };
    unsubDoc = store.sub(scenarioAtom, () => finish(null));
    disposable = bag.add(() => finish(null));
    store.set(mapPickAtom, { key, kind, prompt, pluginId: info.id, finish });
    store.set(statusMessageAtom, `${prompt} — Esc or right-click to cancel`);
  });
}

/* ── Tools on the map ───────────────────────────────────── */

/**
 * Put a `MapToolRequest` in front of the viewport. It runs until its handle's `stop`,
 * Esc / right-click (`cancelMapToolAtom`, unless the spec keeps it), a scenario change,
 * the plugin's deactivation, or a newer tool; `finish` clears the atom itself and
 * tells the spec once. A pick in progress is left alone — the viewport serves it first.
 */
export function startMapTool(store: Store, bag: Contributions, info: PluginInfo, spec: MapToolSpec): MapToolHandle {
  store.get(mapToolAtom)?.finish("replaced");
  const key = nextContributionKey();
  let done = false;
  let unsubDoc = () => {};
  let disposable = { dispose: () => {} };
  const finish = (reason: MapToolStopReason) => {
    if (done) return;
    done = true;
    unsubDoc();
    disposable.dispose();
    if (store.get(mapToolAtom)?.key === key) store.set(mapToolAtom, null);
    store.set(statusMessageAtom, `${spec.name} — ${reason === "stopped" ? "done" : reason === "cancelled" ? "cancelled" : "stopped"}`);
    try { spec.onStop?.(reason); } catch (err) { console.error(`[${info.name}] map tool onStop failed`, err); }
    store.set(mapToolRevisionAtom, store.get(mapToolRevisionAtom) + 1);
  };
  unsubDoc = store.sub(scenarioAtom, () => finish("document"));
  disposable = bag.add(() => finish("disabled"));
  store.set(mapToolAtom, { key, pluginId: info.id, spec, finish });
  store.set(statusMessageAtom, `${spec.name}${spec.hint ? ` — ${spec.hint}` : ""} — Esc or right-click to stop`);
  return {
    stop: () => finish("stopped"),
    isActive: () => !done,
    redraw: () => { if (!done) store.set(mapToolRevisionAtom, store.get(mapToolRevisionAtom) + 1); },
  };
}

/**
 * `api.ui.overlay`: one `PluginOverlayEntry` in `pluginOverlaysAtom`, which `MapViewport`
 * draws at its slot while visible and forwards the pointer to, and which the View menu
 * and the Layers panel list with a tick. Visibility changes all go through
 * `setOverlayVisibleAtom`, so `onToggle` fires the same way for the handle and the
 * chrome. Nothing about a document is held: the overlay stays registered across maps
 * (its `draw` is simply not called while none is open) and leaves with the plugin.
 */
export function registerOverlay(store: Store, bag: Contributions, info: PluginInfo, spec: OverlaySpec): OverlayHandle {
  const key = nextContributionKey();
  const remembered = overlayVisibilityMemory.get(overlayMemoryKey(info.id, spec.name));
  const visible = remembered ?? spec.visible ?? true;
  let removed = false;
  const entry = () => store.get(pluginOverlaysAtom).find((o) => o.key === key);
  const bump = () => store.set(pluginOverlayRevisionAtom, store.get(pluginOverlayRevisionAtom) + 1);
  const remove = () => {
    if (removed) return;
    removed = true;
    disposable.dispose();
    store.set(pluginOverlaysAtom, store.get(pluginOverlaysAtom).filter((o) => o.key !== key));
    bump();
  };
  const disposable = bag.add(remove);
  store.set(pluginOverlaysAtom, [...store.get(pluginOverlaysAtom), { key, plugin: info, spec, visible }]);
  bump();
  const set = (v: boolean) => { if (!removed) store.set(setOverlayVisibleAtom, key, v); };
  return {
    show: () => set(true),
    hide: () => set(false),
    toggle: () => set(!(entry()?.visible ?? false)),
    isVisible: () => entry()?.visible ?? false,
    redraw: () => { if (!removed) bump(); },
    remove,
  };
}

/**
 * `document.open` for a plugin: the bytes become a `File`, and the open goes through the
 * same unsaved-changes gate as File ▸ Open — the Close Scenario dialog when the map is
 * modified and Preferences say to ask. The dialog's `done` callback answers once the file
 * was opened (or failed to read); a dismissal — Cancel, Escape, the × — is seen from the
 * dialog stack: the entry leaves it without `taken` set. (An unmount effect in the dialog
 * would be simpler, but React's development double-mount runs it once at mount.)
 */
function openDocument(store: Store, source: File | Blob | Uint8Array, fileName?: string): Promise<boolean> {
  const name = fileName ?? (source instanceof File ? source.name : "map.scx");
  const file = source instanceof File && !fileName
    ? source
    : new File([source as unknown as BlobPart], name, { type: "application/octet-stream" });
  return guardedAction(store, () => openFileInto(store, file), (done) => ({ action: "open", file, done }));
}

/** `document.create`: File ▸ New through the same gate. */
function createDocument(store: Store, options: NewDocumentOptions): Promise<boolean> {
  const full = { name: "Untitled Scenario", description: "", ...options };
  return guardedAction(store, () => newMapInto(store, full), (done) => ({ action: "new", options: full, done }));
}

/* ── Raw section edits ──────────────────────────────────── */

/**
 * `api.document.sections`: the file Save would write, and edits to its bytes. Every
 * edit parses the result again and installs it through `replaceScenarioAtom`, so the
 * typed model, the mirror atoms and every revision follow — and the history goes, as
 * with Resize. Reads serialise the open scenario each time; that is a few milliseconds
 * for the largest map, and a plugin that lists often can cache on the `"document"` and
 * per-layer events.
 */
export function sectionsApi(store: Store): SectionsApi {
  const open = () => {
    const scn = store.get(scenarioAtom);
    if (!scn) throw new Error("No map is open.");
    return scn;
  };
  const dim = () => { const scn = store.get(scenarioAtom); return { width: scn?.width ?? 0, height: scn?.height ?? 0 }; };
  const edit = (mutate: (file: ChkFile) => void): RawEditResult => {
    const next = editRaw(open(), mutate);
    store.set(replaceScenarioAtom, next);
    return { warnings: [...next.warnings] };
  };
  return {
    list: () => { const scn = store.get(scenarioAtom); return scn ? sectionInfos(scn) : []; },
    bytes: (index) => {
      const file = currentChk(open());
      const s = file.sections[index];
      if (!s) throw new RangeError(`No section at index ${index} (the file has ${file.sections.length}).`);
      return s.data.slice();
    },
    combined: (name) => { const scn = store.get(scenarioAtom); return scn ? combinedSection(scn, name)?.slice() ?? null : null; },
    file: () => serializeChk(currentChk(open())),
    spec: (name) => sectionKnowledge(name, dim()),
    known: () => knownSections(dim()),
    write: (index, bytes) => edit((file) => replaceSectionData(file, index, bytes)),
    rename: (index, name) => edit((file) => renameSection(file, index, name)),
    insert: (index, name, bytes) => edit((file) => insertSection(file, index, name, bytes)),
    remove: (index) => edit((file) => removeSection(file, index)),
    move: (from, to) => edit((file) => moveSection(file, from, to)),
    replaceFile: (bytes) => {
      open();
      const next = parseRaw(bytes);
      store.set(replaceScenarioAtom, next);
      return { warnings: [...next.warnings] };
    },
    trailing: () => { const scn = store.get(scenarioAtom); return scn ? currentChk(scn).trailing?.slice() ?? null : null; },
    required: () => { const scn = store.get(scenarioAtom); return scn ? requiredSectionNames(scn) : []; },
    defaults: (name) => { const scn = store.get(scenarioAtom); return scn ? defaultSectionBytes(scn, name.padEnd(4, " ")) : null; },
    rebuild: (names) => {
      const { scenario, result } = rebuildSections(open(), names);
      store.set(replaceScenarioAtom, scenario);
      return result;
    },
  };
}


/* ── Update transactions: tables and settings ───────────── */

/**
 * Run `build` against an update transaction and commit it. This is the editor's second
 * kind of write — the one every settings and trigger dialog performs: the scenario is
 * mutated in place, the sections touched are marked dirty, and the commit tells the
 * chrome to re-read. There is no history entry, so a plugin that wants one keeps its
 * own copy of what it replaced.
 *
 * Operations apply as they are called, exactly as `runTransaction`'s do — a string
 * interned on one line is in the table for the trigger added on the next — which is why
 * the ordering hazards of a working-copy model (switch names interning while a copy of
 * the string table is held) do not arise here.
 */
export function runUpdate(store: Store, label: string, build: (tx: UpdateTransaction) => unknown): UpdateResult {
  const scn = store.get(scenarioAtom);
  if (!scn) return { changed: false, sections: [], notes: ["no map is open"] };
  const sections = new Set<string>();
  const notes: string[] = [];
  const touch = (name: string) => { sections.add(name); };
  const strSection = () => strSectionName(scn);
  /** Note the string table growing: interning happens deep inside several of these. */
  const withStrings = <T,>(run: () => T): T => {
    const before = scn.strings.strings.length;
    const out = run();
    if (scn.strings.strings.length !== before) touch(strSection());
    return out;
  };

  const listUpdate = (briefing: boolean): TriggerListUpdate => {
    const section = briefing ? "MBRF" : "TRIG";
    const read = () => (briefing ? readBriefing(scn) : readTriggers(scn));
    const write = (next: TriggerRecord[]): boolean => {
      if (sameTriggers(briefing ? scn.briefing : scn.triggers, next)) return false;
      if (briefing) applyBriefing(scn, next);
      else applyTriggers(scn, next);
      touch(section);
      return true;
    };
    return {
      list: read,
      count: () => (briefing ? scn.briefing.length : scn.triggers.length),
      set: (list) => { write(list); },
      add: (trigger, at) => {
        const list = read();
        const index = at === undefined ? list.length : Math.max(0, Math.min(list.length, at));
        write(insertTrigger(list, index, trigger));
        return index;
      },
      replace: (index, trigger) => {
        const list = read();
        if (index < 0 || index >= list.length) return false;
        list[index] = trigger;
        return write(list);
      },
      remove: (indices) => {
        const list = read();
        const next = removeTriggers(list, indices);
        write(next);
        return list.length - next.length;
      },
      move: (from, to) => {
        const list = read();
        if (from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
        return write(moveTrigger(list, from, to));
      },
      fromText: (source, options = {}) => {
        const parsed = withStrings(() => parseTriggers(source, triggerNames(scn), briefing).map((t) => t.trigger));
        write(options.replace ? parsed : [...read(), ...parsed]);
        return parsed.length;
      },
    };
  };

  /** Run a patcher that answers with the sections it changed; record them. */
  const tracked = (run: () => string[]): boolean => {
    const changed = withStrings(run);
    for (const name of changed) touch(name);
    return changed.length > 0;
  };
  const assets = () => peekUnitAssets();

  const tx: UpdateTransaction = {
    scenario: scn,
    triggers: listUpdate(false),
    briefing: listUpdate(true),

    strings: {
      list: () => readStrings(scn),
      intern: (text) => withStrings(() => internString(scn, text)),
      import: (text) => {
        const parsed = parseStringTable(text);
        for (const e of parsed.errors) notes.push(`line ${e.line}: ${e.message}`);
        const before = scn.strings.strings.slice();
        const r = withStrings(() => applyStringImport(scn, parsed.entries));
        if (r.replaced > 0 || r.added > 0 || before.some((v, i) => v !== scn.strings.strings[i])) touch(strSection());
        return r;
      },
      set: (index, text) => {
        if (index <= 0) { notes.push("string 0 is reserved; use intern to add one"); return; }
        if (getString(scn.strings, index) === text) return;
        setString(scn.strings, index, text);
        markDirty(scn, strSection());
        touch(strSection());
      },
      apply: (list) => { if (applyStrings(scn, list)) touch(strSection()); },
    },

    switches: {
      names: () => readSwitchNames(scn),
      setName: (index, name) => {
        const list = readSwitchNames(scn);
        if (index < 0 || index >= list.length) { notes.push(`there is no switch ${index}`); return; }
        list[index] = name;
        withStrings(() => { if (applySwitchNames(scn, list)) touch("SWNM"); });
      },
    },

    properties: (patch) => {
      withStrings(() => {
        if (patch.name !== undefined && patch.name !== (scenarioName(scn) ?? "")) { setScenarioName(scn, patch.name); touch("SPRP"); }
        if (patch.description !== undefined && patch.description !== (scenarioDescription(scn) ?? "")) { setScenarioDescription(scn, patch.description); touch("SPRP"); }
      });
    },

    players: {
      list: () => playerSlotViews(scn),
      set: (slot, patch) => tracked(() => patchPlayer(scn, slot, patch)),
    },
    cuwp: {
      list: () => cuwpSlotViews(scn),
      get: (index) => cuwpSlotView(scn, index),
      set: (index, patch, used) => tracked(() => patchCuwp(scn, index, patch, used)),
      clear: (index) => tracked(() => {
        const table = readCuwp(scn);
        if (index < 0 || index >= table.slots.length) return [];
        table.slots[index] = emptyCuwpSlot();
        table.used[index] = false;
        return applyCuwp(scn, table);
      }),
    },
    forces: {
      list: () => forceViews(scn),
      set: (force, patch) => tracked(() => patchForce(scn, force, patch)),
    },
    unitTypes: {
      get: (unitId) => unitTypeView(scn, unitId, assets()?.units ?? null, assets()?.weapons ?? null),
      set: (unitId, patch) => tracked(() => patchUnitType(scn, unitId, patch, assets()?.units ?? null, assets()?.weapons ?? null)),
    },
    upgrades: {
      get: (id) => upgradeView(scn, id, assets()?.upgrades ?? null),
      set: (id, patch) => tracked(() => patchUpgrade(scn, id, patch, assets()?.upgrades ?? null)),
    },
    techs: {
      get: (id) => techView(scn, id, assets()?.techs ?? null),
      set: (id, patch) => tracked(() => patchTech(scn, id, patch, assets()?.techs ?? null)),
    },
    sounds: {
      list: () => soundList(scn, store.get(archiveExtrasAtom)),
      add: (path, bytes) => {
        const member = path.includes("\\") || path.includes("/") ? path.replace(/\//g, "\\") : wavMemberName(path);
        const wavs = readWavs(scn);
        const slot = withStrings(() => addSound(scn, wavs, member));
        if (slot < 0) { notes.push("all 512 sound slots are taken"); return -1; }
        tracked(() => (applySounds(scn, wavs) ? ["WAV "] : []));
        if (bytes) {
          const extras = new Map(store.get(archiveExtrasAtom));
          extras.set(findMember(extras, member) ?? member, bytes);
          store.set(archiveExtrasAtom, extras);
          touch("WAV ");
        }
        return slot;
      },
      remove: (slot, deleteFile = false) => {
        const wavs = readWavs(scn);
        if (slot < 0 || slot >= wavs.length || wavs[slot] === 0) return false;
        const path = getString(scn.strings, wavs[slot]) ?? "";
        const changed = tracked(() => (applySounds(scn, removeSound(wavs, slot)) ? ["WAV "] : []));
        if (deleteFile && path) {
          const extras = new Map(store.get(archiveExtrasAtom));
          const member = findMember(extras, path);
          if (member) { extras.delete(member); store.set(archiveExtrasAtom, extras); }
        }
        return changed;
      },
    },
    setVersion: (version, extendedStrings) => {
      tracked(() => changeMapVersion(scn, version, extendedStrings));
    },

    note: (text) => { notes.push(text); },
  };

  checkSyncBuilder("document.update", build(tx), notes);

  const touched = [...sections];
  if (touched.length === 0) return { changed: false, sections: [], notes };
  // Both commits: triggers for the trigger lists and the script block's manifest, settings
  // for everything that reads names and colours (a string is shown in half the chrome).
  store.set(commitTriggersAtom);
  store.set(commitSettingsAtom);
  store.set(mapNameAtom, scenarioName(scn) ?? "");
  store.set(mapDescriptionAtom, scenarioDescription(scn) ?? "");
  store.set(statusMessageAtom, notes.length > 0 ? `${label} — ${notes.join(", ")}` : label);
  return { changed: true, sections: touched, notes };
}

/* ── Triggers ───────────────────────────────────────────── */

/** `api.triggers`: reading TRIG and MBRF, and the tables that make a record presentable. */
export function triggersApi(store: Store): Omit<TriggersApi, "claim"> {
  const scenario = () => store.get(scenarioAtom);
  const names = () => {
    const scn = scenario();
    if (!scn) throw new Error("No map is open.");
    return triggerNames(scn);
  };
  return {
    list: () => { const scn = scenario(); return scn ? readTriggers(scn) : []; },
    briefing: () => { const scn = scenario(); return scn ? readBriefing(scn) : []; },
    switchNames: () => { const scn = scenario(); return scn ? readSwitchNames(scn) : []; },
    switchUsage: () => { const scn = scenario(); return scn ? switchUsage(scn) : []; },
    names,
    defs: {
      conditions: () => CONDITION_DEFS.slice(),
      condition: conditionDef,
      actions: (briefing = false) => (briefing ? BRIEFING_ACTION_DEFS : ACTION_DEFS).slice(),
      action: actionDef,
      choices: (kind) => (CHOICES[kind] ?? []).map((c) => ({ ...c })),
      choiceLabel,
      choiceValue,
    },
    text: {
      print: (triggers, options = {}) => formatTriggers(triggers, names(), options.briefing ?? false),
      one: (trigger, options = {}) => formatTrigger(trigger, names(), options.briefing ?? false),
      parse: (source, options = {}) => parseTriggers(source, names(), options.briefing ?? false),
    },
    newTrigger,
    newCondition,
    newAction,
    isPreserved,
    setPreserved,
    triggersFor,
    summarize: (trigger, briefing = false) => summarizeTrigger(trigger, names(), briefing),
    comment: (trigger) => triggerComment(trigger, names()),
  };
}

/* ── Query ──────────────────────────────────────────────── */

/** `api.query`: what is where, and the editor's own analyses. Never writes anything. */
export function queryApi(store: Store): QueryApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const tables = () => peekUnitAssets()?.units ?? null;
  const catalogue = () => loaded()?.doodads ?? NO_DOODADS;
  /**
   * A sprite's box for hit-testing: the loaded GRP's, a unit sprite's collision box
   * while its graphic is still coming, one tile otherwise — the viewport's own rule.
   */
  const sizeOf = (r: SpriteRecord): SpriteSize => {
    const assets = peekUnitAssets();
    if (!assets) return FALLBACK_SIZE;
    if (spriteKind(r) === "unit") {
      const b = unitBox(unitGeometry(assets.units, r.spriteId), 0, 0);
      return { width: b.right - b.left, height: b.bottom - b.top };
    }
    const imageId = assets.sprites.image[r.spriteId];
    const path = imageId === undefined ? null : imageGrpPath(assets, imageId);
    const grp = path ? requestGrp(path) : null;
    return grp && grp.width > 0 && grp.height > 0 ? { width: grp.width, height: grp.height } : FALLBACK_SIZE;
  };
  const pixels = (rect: Rect) => ({ left: rect.x0 * 32, top: rect.y0 * 32, right: rect.x1 * 32, bottom: rect.y1 * 32 });

  return {
    unitAt: (px, py) => { const scn = scenario(); return scn ? unitAt(scn, tables(), px, py) : -1; },
    unitsIn: (rect) => {
      const scn = scenario();
      if (!scn) return [];
      const box = pixels(rect);
      return scn.units.reduce<number[]>((out, u, i) => {
        if (u.x >= box.left && u.x < box.right && u.y >= box.top && u.y < box.bottom) out.push(i);
        return out;
      }, []);
    },
    unitsOf: (owner) => { const scn = scenario(); return scn ? scn.units.reduce<number[]>((out, u, i) => (u.owner === owner ? [...out, i] : out), []) : []; },
    spriteAt: (px, py) => { const scn = scenario(); return scn ? spriteAt(scn, px, py, sizeOf) : -1; },
    spritesIn: (rect) => { const scn = scenario(); return scn ? spritesInBox(scn, pixels(rect), sizeOf) : []; },
    doodadAt: (tx, ty) => { const scn = scenario(); return scn ? doodadAt(scn, catalogue(), tx, ty) : -1; },
    locationAt: (px, py) => { const scn = scenario(); return scn ? locationAt(scn, px, py) : -1; },
    locationsIn: (rect) => {
      const scn = scenario();
      if (!scn) return [];
      const box = pixels(rect);
      const out: number[] = [];
      scn.locations.forEach((l, index) => {
        if (index === ANYWHERE_INDEX || !isLocationUsed(l)) return;
        const b = boundsOf(l);
        if (b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom) out.push(index);
      });
      return out;
    },
    startLocations: () => {
      const scn = scenario();
      if (!scn) return [];
      const out: StartLocation[] = [];
      scn.units.forEach((u, index) => {
        if (u.unitId === START_LOCATION) out.push({ index, owner: u.owner, x: u.x, y: u.y, tx: Math.floor(u.x / 32), ty: Math.floor(u.y / 32) });
      });
      return out.sort((a, b) => a.owner - b.owner);
    },
    fogAt: (tx, ty) => { const scn = scenario(); return scn ? fogPlayersAt(scn, tx, ty) : 0xff; },
    strings: () => scenario()?.strings.strings.slice() ?? [],
    placement: (unitId, x, y) => {
      const scn = scenario();
      if (!scn) return null;
      return checkPlacement(scn, loaded()?.tileset ?? null, tables(), store.get(placementOptionsAtom), unitId, x, y);
    },
    validate: () => {
      const scn = scenario();
      return scn ? validateScenario(scn, { extras: store.get(archiveExtrasAtom) }) : [];
    },
    statistics: () => {
      const scn = scenario();
      if (!scn) return null;
      return mapStatistics(scn, loaded()?.tileset ?? null, TILESET_BY_ID[store.get(mapTilesetAtom)].terrain, tables());
    },
    find: (options) => { const scn = scenario(); return scn ? findInScenario(scn, options) : []; },
    stringUsage: () => { const scn = scenario(); return scn ? stringUsages(scn) : new Map(); },
    unusedStrings: () => { const scn = scenario(); return scn ? unusedStrings(scn) : []; },
  };
}

/* ── The view ───────────────────────────────────────────── */

/** How far the zoom control goes either way; anything between is allowed. */
const ZOOM_RANGE = [0.05, 8] as const;

/** `api.view`: where the viewport is looking and what it draws over the terrain. */
export function viewApi(store: Store): ViewApi {
  const scenario = () => store.get(scenarioAtom);
  const centerOn = (x: number, y: number) => store.set(centerViewOnAtom, { x, y });
  return {
    zoom: () => store.get(zoomAtom),
    setZoom: (zoom) => store.set(zoomAtom, Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], zoom))),
    visible: () => {
      const r = store.get(viewportRectAtom);
      return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
    },
    center: centerOn,
    goTo: (target) => {
      const scn = scenario();
      if (!scn) return;
      switch (target.kind) {
        case "tile":
          centerOn(target.x, target.y);
          return;
        case "unit": {
          const u = scn.units[target.index];
          if (!u) return;
          store.set(selectedUnitsAtom, [target.index]);
          centerOn(u.x / 32, u.y / 32);
          return;
        }
        case "sprite": {
          const s = scn.sprites[target.index];
          if (!s) return;
          store.set(selectedSpritesAtom, [target.index]);
          centerOn(s.x / 32, s.y / 32);
          return;
        }
        case "location": {
          const l = scn.locations[target.index];
          if (!l || target.index === ANYWHERE_INDEX) return;
          const b = boundsOf(l);
          store.set(selectedLocationsAtom, [target.index]);
          centerOn((b.left + b.right) / 64, (b.top + b.bottom) / 64);
        }
      }
    },
    cursorTile: () => store.get(cursorTileAtom),
    flags: () => ({ ...store.get(viewFlagsAtom) }),
    setFlags: (patch) => store.set(viewFlagsAtom, { ...store.get(viewFlagsAtom), ...patch }),
    gridSize: () => store.get(gridSizeAtom),
    setGridSize: (size) => store.set(gridSizeAtom, size),
  };
}

/* ── Game data ──────────────────────────────────────────── */

/** `api.data`: the decoded `.dat` tables, once they are in memory. */
export function dataApi(): DataApi {
  const assets = () => peekUnitAssets();
  return {
    ready: () => assets() !== null,
    load: async () => {
      try { await getUnitAssets(); return true; } catch { return false; }
    },
    units: () => assets()?.units ?? null,
    weapons: () => assets()?.weapons ?? null,
    upgrades: () => assets()?.upgrades ?? null,
    techs: () => assets()?.techs ?? null,
    sprites: () => assets()?.sprites ?? null,
    flingy: () => assets()?.flingy ?? null,
    images: () => assets()?.images ?? null,
    race: (unitId) => { const a = assets(); return a ? unitRace(a.units, unitId) : null; },
    imagePath: (imageId) => { const a = assets(); return a ? imageGrpPath(a, imageId) : null; },
  };
}

/** `api.gameData`: the source and the data sets, over `services/gameData.ts`. */
export function gameDataApi(store: Store): GameDataApi {
  const publish = (s: AssetSource): GameDataSource => ({ kind: s.kind, label: s.label, profile: { ...s.profile }, desktop: s.desktop === true });
  const source = () => store.get(gameDataSourceAtom) ?? currentAssetSource();
  return {
    source: () => { const s = source(); return s ? publish(s) : null; },
    profile: () => ({ ...(source()?.profile ?? DEFAULT_PROFILE) }),
    profiles: listDataSets,
    install: async (profile, files, progress) => publish(await installDataSetInto(store, { id: profile.id, name: profile.name }, files, progress)),
    select: async (id) => publish(await switchDataSet(store, id)),
    remove: (id) => removeDataSet(store, id),
  };
}

/* ── Commands ───────────────────────────────────────────── */

/**
 * A command id is namespaced under the plugin unless it already carries a dot, so
 * `"convert"` from the Terrain from Image plugin is `image-to-terrain.convert` and a
 * plugin offering a shared name (`"triggers.open"`) keeps it.
 */
export function qualifyCommand(pluginId: string, id: string): string {
  const trimmed = id.trim();
  return trimmed.includes(".") ? trimmed : `${pluginId}.${trimmed}`;
}

export function runCommand(store: Store, id: string, args: unknown[] = []): unknown {
  const command = store.get(pluginCommandsAtom).find((c) => c.id === id);
  if (!command) {
    console.warn(`[plugins] no such command: ${id}`);
    return undefined;
  }
  try {
    if (command.enabled && !command.enabled()) return undefined;
    return command.run(...args);
  } catch (err) {
    console.error(`[plugins] command ${id} failed`, err);
    return undefined;
  }
}

/* ── Clipboard ──────────────────────────────────────────── */

/** `api.clipboard`: what the Cut / Copy / Paste layer does, over `editor/clipboard.ts`, with the user's clip. */
function clipboardApi(store: Store): ClipboardApi {
  const scenario = () => store.get(scenarioAtom);
  const graphics = () => { const l = peekTileset(store.get(tilesetFileNameAtom)); return { catalogue: l?.doodads ?? NO_DOODADS, tileset: l?.tileset ?? null }; };
  /** The source as given, else what Ctrl+C would take: the object layer's selection, or the marked area. */
  const resolve = (source?: ClipSource): { rect: Rect } | { sel: ObjectSelection } | null => {
    if (source && "rect" in source) return { rect: source.rect };
    if (source) {
      const sel = { ...EMPTY_SELECTION, units: source.units ?? [], sprites: source.sprites ?? [], doodads: source.doodads ?? [], locations: source.locations ?? [] };
      return selectionSize(sel) > 0 ? { sel } : null;
    }
    const layer = store.get(activeLayerAtom);
    const objects = (part: Partial<ObjectSelection>) => { const sel = { ...EMPTY_SELECTION, ...part }; return selectionSize(sel) > 0 ? { sel } : null; };
    if (layer === "units") return objects({ units: store.get(selectedUnitsAtom) });
    if (layer === "sprites") return objects({ sprites: store.get(selectedSpritesAtom) });
    if (layer === "doodads") return objects({ doodads: store.get(selectedDoodadsAtom) });
    if (layer === "locations") return objects({ locations: store.get(selectedLocationsAtom) });
    const rect = store.get(clipSelectionAtom);
    return rect ? { rect } : null;
  };
  const take = (source?: ClipSource): { clip: Clip; src: { rect: Rect } | { sel: ObjectSelection } } | null => {
    const scn = scenario();
    const src = resolve(source);
    if (!scn || !src) return null;
    const parts = store.get(clipPartsAtom);
    const clip = "rect" in src ? copyRegion(scn, src.rect, parts, graphics().catalogue) : copyObjects(scn, src.sel, parts, graphics().catalogue);
    return clip ? { clip, src } : null;
  };
  return {
    clip: () => store.get(clipboardAtom),
    setClip: (clip) => store.set(clipboardAtom, clip),
    copy: (source) => { const t = take(source); if (t) store.set(clipboardAtom, t.clip); return t?.clip ?? null; },
    cut: (source) => {
      const scn = scenario();
      const t = take(source);
      if (!scn || !t) return null;
      store.set(clipboardAtom, t.clip);
      const { catalogue, tileset } = graphics();
      const parts = store.get(clipPartsAtom);
      const all = "rect" in t.src ? regionObjectsOf(scn, t.src.rect, catalogue) : t.src.sel;
      const sel: ObjectSelection = { units: parts.units ? all.units : [], sprites: parts.sprites ? all.sprites : [], doodads: parts.doodads ? all.doodads : [], locations: parts.locations ? all.locations : [] };
      const n = selectionSize(sel);
      if (n > 0) {
        const edit = removeObjects(scn, sel, catalogue, tileset);
        store.set(selectedUnitsAtom, []); store.set(selectedSpritesAtom, []); store.set(selectedDoodadsAtom, []); store.set(selectedLocationsAtom, []);
        store.set(commitEditAtom, { label: `Cut ${n} object${n === 1 ? "" : "s"}`, ...edit });
      }
      return t.clip;
    },
    paste: (tx, ty, options = {}) => {
      const scn = scenario();
      const clip = store.get(clipboardAtom);
      if (!scn || !clip) return null;
      const { catalogue, tileset } = graphics();
      const result = pasteClip(scn, clip, tx, ty, { parts: { ...store.get(clipPartsAtom), ...options.parts }, mode: options.mode ?? store.get(clipPasteModeAtom), catalogue, tileset });
      const c = result.counts;
      if (c.tiles + c.doodads + c.units + c.sprites + c.locations + c.fog + c.removed > 0) {
        store.set(selectedUnitsAtom, []); store.set(selectedSpritesAtom, []); store.set(selectedDoodadsAtom, []); store.set(selectedLocationsAtom, []);
        store.set(commitEditAtom, { label: `Paste ${clipSummary(clip)}`, ...result.edit });
        store.set(clipSelectionAtom, { x0: Math.max(0, tx), y0: Math.max(0, ty), x1: Math.min(scn.width, tx + clip.width), y1: Math.min(scn.height, ty + clip.height) });
      }
      return result;
    },
    parts: () => ({ ...store.get(clipPartsAtom) }),
    setParts: (patch) => store.set(clipPartsAtom, { ...store.get(clipPartsAtom), ...patch }),
    mode: () => store.get(clipPasteModeAtom),
    setMode: (mode) => store.set(clipPasteModeAtom, mode),
    pasting: () => store.get(clipPastingAtom),
    setPasting: (on) => { if (on && store.get(activeLayerAtom) !== "clipboard") store.set(activeLayerAtom, "clipboard"); store.set(clipPastingAtom, on); },
    summary: clipSummary,
  };
}

/* ── The API ────────────────────────────────────────────── */

const EVENT_ATOMS = {
  document: [scenarioAtom],
  terrain: [terrainRevisionAtom],
  units: [unitsRevisionAtom],
  doodads: [doodadsRevisionAtom],
  locations: [locationsRevisionAtom],
  settings: [settingsRevisionAtom],
  triggers: [triggersRevisionAtom],
  layer: [activeLayerAtom],
  // THG2 records ride on the doodads revision, as they do everywhere else in the editor.
  sprites: [doodadsRevisionAtom],
  selection: [selectedUnitsAtom, selectedSpritesAtom, selectedDoodadsAtom, selectedLocationsAtom, clipSelectionAtom],
  clipboard: [clipboardAtom, clipSelectionAtom],
  view: [viewportRectAtom, zoomAtom, viewFlagsAtom, gridSizeAtom, pluginOverlaysAtom],
  tool: [mapToolAtom, mapPickAtom],
  modified: [mapModifiedAtom],
  palette: [
    terrainModeAtom, activeTerrainAtom, activeTileAtom, rectVariationAtom, brushSizeAtom, activeUnitAtom, unitOwnerAtom, activeSpriteKindAtom, activeSpriteAtom,
    activeUnitSpriteAtom, spritePlaceOptionsAtom, activeDoodadAtom, fogPlayersAtom, fogModeAtom,
  ],
  options: [symmetryAtom, placementOptionsAtom, doodadPlacementAtom, locationSnapAtom, fogViewPlayerAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, lockedLayersAtom, gridLookAtom, preferencesAtom],
  file: [mapFilePathAtom, mapFileHandleAtom, saveOptionsAtom, archiveExtrasAtom, recentFilesAtom],
  commands: [pluginCommandsAtom],
  gameData: [gameDataSourceAtom, gameDataRevisionAtom],
} as const;

/**
 * The `"document"` event's payload: the reason the writers recorded, unless the scenario
 * was installed some other way (a test setting the atom directly), in which case it is an
 * open or a close by what is there.
 */
export function documentEvent(store: Store): DocumentEvent {
  const scenario = store.get(scenarioAtom);
  const change = store.get(documentChangeAtom);
  const reason = change.scenario === scenario ? change.reason : scenario ? "open" : "close";
  return { reason, fileName: scenario ? store.get(mapFilePathAtom) : null };
}

/** `api.settings`: the dialogs' tables without a transaction. */
export function settingsApi(store: Store): SettingsApi {
  const scenario = () => store.get(scenarioAtom);
  const units = () => peekUnitAssets()?.units ?? null;
  const weapons = () => peekUnitAssets()?.weapons ?? null;
  const upgrades = () => peekUnitAssets()?.upgrades ?? null;
  const techs = () => peekUnitAssets()?.techs ?? null;
  return {
    players: () => { const scn = scenario(); return scn ? playerSlotViews(scn) : []; },
    player: (slot) => { const scn = scenario(); return scn ? playerSlotViews(scn)[slot] ?? null : null; },
    forces: () => { const scn = scenario(); return scn ? forceViews(scn) : []; },
    unitType: (id) => { const scn = scenario(); return scn && id >= 0 && id < UNIT_TYPES ? unitTypeView(scn, id, units(), weapons()) : null; },
    unitTypes: () => {
      const scn = scenario();
      if (!scn) return [];
      const out: UnitTypeView[] = [];
      for (let id = 0; id < UNIT_TYPES; id++) if (UNIT_NAME_TABLE[id]) out.push(unitTypeView(scn, id, units(), weapons()));
      return out;
    },
    upgrade: (id) => { const scn = scenario(); return scn && id >= 0 && id < UPGRADES_BW ? upgradeView(scn, id, upgrades()) : null; },
    upgrades: () => { const scn = scenario(); return scn ? Array.from({ length: UPGRADES_BW }, (_, id) => id).filter((id) => !isUnusedUpgrade(id)).map((id) => upgradeView(scn, id, upgrades())) : []; },
    tech: (id) => { const scn = scenario(); return scn && id >= 0 && id < TECHS_BW ? techView(scn, id, techs()) : null; },
    techs: () => { const scn = scenario(); return scn ? Array.from({ length: TECHS_BW }, (_, id) => id).filter((id) => !isUnusedTech(id)).map((id) => techView(scn, id, techs())) : []; },
    sounds: () => { const scn = scenario(); return scn ? soundList(scn, store.get(archiveExtrasAtom)) : []; },
    unitAvailable: (player, id) => { const scn = scenario(); return scn?.unitAvailability ? isUnitAvailable(scn.unitAvailability, player, id) : true; },
    cuwpSlots: () => { const scn = scenario(); return scn ? cuwpSlotViews(scn) : []; },
    cuwpSlot: (index) => { const scn = scenario(); return scn ? cuwpSlotView(scn, index) : null; },
    version: () => { const scn = scenario(); return scn ? mapVersionView(scn) : null; },
  };
}

function doodadInfoOf(def: DoodadDef): DoodadInfo {
  return { id: def.id, name: doodadLabel(def), category: def.category, width: def.width, height: def.height };
}

/** Build one plugin's view of the editor. Everything it registers lands in `bag`. */
export function createPluginApi(store: Store, info: PluginInfo, bag: Contributions): PluginApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const names = () => TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  const rgb = (packed: number) => [packed >> 16 & 0xff, packed >> 8 & 0xff, packed & 0xff];
  const prefix = `${STORAGE_PREFIX}plugin.${info.id}.`;
  const widgets = createWidgets();

  const api: PluginApi = {
    apiVersion: PLUGIN_API_VERSION,
    plugin: info,

    settings: settingsApi(store),

    document: {
      isOpen: () => scenario() !== null,
      info: () => {
        const scn = scenario();
        if (!scn) return null;
        return {
          name: scenarioName(scn) ?? "",
          description: scenarioDescription(scn) ?? "",
          width: scn.width,
          height: scn.height,
          tileset: TILESETS[tilesetIndex(scn)].id,
          era: scn.era,
          version: scn.fileVersion,
          fileName: store.get(mapFilePathAtom),
          modified: store.get(mapModifiedAtom),
        };
      },
      scenario,
      edit: (label, build) => runTransaction(store, label, build),
      update: (label, build) => runUpdate(store, label, build),
      undo: () => store.set(undoAtom),
      redo: () => store.set(redoAtom),
      history: () => {
        const u = store.get(undoStackAtom), r = store.get(redoStackAtom);
        return { undo: u.at(-1)?.label ?? null, redo: r.at(-1)?.label ?? null, undoDepth: u.length, redoDepth: r.length };
      },
      open: (source, fileName) => openDocument(store, source, fileName),
      create: (options) => createDocument(store, options),
      resize: (options) => {
        const scn = scenario();
        if (!scn) return null;
        const width = Math.max(1, Math.min(256, Math.round(options.width)));
        const height = Math.max(1, Math.min(256, Math.round(options.height)));
        const anchor = Math.max(0, Math.min(8, Math.round(options.anchor ?? 4)));
        return store.set(resizeDocumentAtom, { width, height, anchor, terrainId: options.terrainId, clampLocations: options.clampLocations ?? true });
      },
      export: async (options = {}) => {
        const scn = scenario();
        if (!scn) return null;
        const remembered = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), store.get(mapFilePathAtom));
        const format = options.format ?? remembered.format;
        const bytes = await writeMapBytes(scn, { format, extras: store.get(archiveExtrasAtom), options: { ...remembered, ...options.saveOptions } });
        const name = options.fileName ?? store.get(mapFilePathAtom) ?? `${scenarioName(scn) || "Untitled Scenario"}.${format}`;
        return new File([bytes as unknown as BlobPart], name, { type: "application/octet-stream" });
      },
      save: async (options = {}) => {
        const scn = scenario();
        if (!scn) return false;
        const path = store.get(mapFilePathAtom);
        if (!options.copy && path) {
          const saveOptions = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), path);
          return saveDocument(store, { fileName: path, handle: store.get(mapFileHandleAtom), options: saveOptions, copy: false });
        }
        return askDialog(store, "saveAs", { copy: options.copy === true });
      },
      saveAs: (options = {}) => (scenario() ? askDialog(store, "saveAs", { copy: options.copy === true }) : Promise.resolve(false)),
      close: () => {
        if (!scenario()) return Promise.resolve(false);
        return guardedAction(store, async () => { closeMapIn(store); return true; }, (done) => ({ action: "close", done }));
      },
      changeTileset: async (options) => {
        if (!scenario()) return null;
        const era = Math.max(0, TILESETS.findIndex((t) => t.id === options.tileset));
        try { await loadTilesetFiles(TILESET_FILENAMES[era]); } catch { /* the fill uses the base ids without the graphics */ }
        if (!scenario()) return null;
        return store.set(changeTilesetAtom, { tileset: options.tileset, terrainId: options.terrainId, keepTiles: options.keepTiles });
      },
      renderImage: async (options = {}) => {
        const scn = scenario();
        if (!scn || typeof document === "undefined") return null;
        try {
          await ensureTileset(store.get(tilesetFileNameAtom));
        } catch {
          return null;
        }
        return exportMapImage(scn, { ...DEFAULT_IMAGE_OPTIONS, ...options });
      },
      extras: {
        list: () => (scenario() ? [...store.get(archiveExtrasAtom).keys()] : []),
        get: (name) => (scenario() ? store.get(archiveExtrasAtom).get(name) ?? null : null),
        set: (name, bytes) => {
          if (!scenario()) return;
          const next = new Map(store.get(archiveExtrasAtom));
          next.set(name, bytes);
          store.set(archiveExtrasAtom, next);
          store.set(mapModifiedAtom, true);
        },
        remove: (name) => {
          if (!scenario() || !store.get(archiveExtrasAtom).has(name)) return false;
          const next = new Map(store.get(archiveExtrasAtom));
          next.delete(name);
          store.set(archiveExtrasAtom, next);
          store.set(mapModifiedAtom, true);
          return true;
        },
      },
      sections: sectionsApi(store),
    },

    triggers: {
      ...triggersApi(store),
      claim: (spec) => {
        const key = nextContributionKey();
        const entry = (revision: number): PluginTriggerClaim => ({ key, pluginId: info.id, pluginName: info.name, spec, revision });
        store.set(pluginTriggerClaimsAtom, [...store.get(pluginTriggerClaimsAtom), entry(0)]);
        const remove = bag.add(() => store.set(pluginTriggerClaimsAtom, store.get(pluginTriggerClaimsAtom).filter((c) => c.key !== key)));
        return {
          dispose: () => remove.dispose(),
          remove: () => remove.dispose(),
          refresh: () => store.set(pluginTriggerClaimsAtom, store.get(pluginTriggerClaimsAtom).map((c) => (c.key === key ? entry(c.revision + 1) : c))),
        };
      },
    },
    query: queryApi(store),
    view: viewApi(store),
    data: dataApi(),
    gameData: gameDataApi(store),

    // Handed over rather than published in the typings: the package is types only, so a
    // value imported from it is undefined at run time (see `ConstsApi`).
    consts: {
      tile: TILE_PX,
      unit: {
        startLocation: START_LOCATION,
        mineralFields: MINERAL_FIELD_IDS,
        vespeneGeyser: VESPENE_GEYSER,
        defaultMinerals: DEFAULT_MINERALS,
        defaultGas: DEFAULT_GAS,
        valid: UnitValid,
        used: UnitUsed,
        state: UnitState,
        relation: UnitRelation,
      },
      sprite: { flags: SpriteFlag },
      location: { anywhere: ANYWHERE_INDEX, elevation: Elevation },
      // By identity, like the masks above: these are the codec's own tables, so a plugin
      // reading `type === api.consts.triggers.condition.Bring` is comparing against the
      // number `sections/triggers.ts` writes, not a copy that can drift from it.
      triggers: {
        condition: ConditionType,
        action: ActionType,
        briefingAction: BriefingActionType,
        player: PlayerGroup,
        comparison: Comparison,
        switchState: SwitchState,
        switchAction: SwitchAction,
        modifier: SetModifier,
        unitState: TriggerUnitState,
        order: Order,
        alliance: AllianceStatus,
        resource: ResourceType,
        score: ScoreType,
        unitClass: UnitClass,
        conditionFlags: ConditionFlag,
        actionFlags: ActionFlag,
        triggerFlags: TriggerFlag,
        deathsTable: DEATHS_TABLE_ADDRESS,
      },
      isResource,
    },
    graphics: createGraphicsApi(store, bag),

    names: {
      unit: (id) => UNIT_CLASS_CHOICES.find((c) => c.value === id)?.label ?? unitName(id),
      units: () => [...UNIT_NAMES.map((_, id) => ({ value: id, label: unitName(id) })), ...UNIT_CLASS_CHOICES.map((c) => ({ value: c.value, label: c.label }))],
      upgrade: upgradeName,
      upgrades: () => UPGRADE_NAMES.map((_, id) => ({ value: id, label: upgradeName(id) })),
      tech: techName,
      techs: () => TECH_NAMES.map((_, id) => ({ value: id, label: techName(id) })),
      weapon: weaponName,
      weapons: () => WEAPON_NAMES.map((_, id) => ({ value: id, label: weaponName(id) })),
      playerType: playerTypeLabel,
      playerTypes: () => PLAYER_TYPES.map((t) => ({ value: t.value, label: t.label })),
      race: playerRaceLabel,
      races: () => PLAYER_RACES.map((r) => ({ value: r.value, label: r.label })),
      playerGroup: (value) => PLAYER_GROUP_CHOICES.find((c) => c.value === value)?.label ?? `Group ${value}`,
      playerGroups: () => PLAYER_GROUP_CHOICES.map((c) => ({ value: c.value, label: c.label })),
      condition: (type) => (type === 0 ? "None" : conditionDef(type)?.name ?? `Condition ${type}`),
      conditions: () => [{ value: 0, label: "None" }, ...CONDITION_DEFS.map((d) => ({ value: d.type, label: d.name })).sort((a, b) => a.value - b.value)],
      action: (type, briefing = false) => (type === 0 ? "None" : actionDef(type, briefing)?.name ?? `Action ${type}`),
      actions: (briefing = false) => [{ value: 0, label: "None" }, ...(briefing ? BRIEFING_ACTION_DEFS : ACTION_DEFS).map((d) => ({ value: d.type, label: d.name })).sort((a, b) => a.value - b.value)],
      aiScript: aiScriptName,
      string: (index) => { const scn = scenario(); return scn ? getString(scn.strings, index) : null; },
      location: (index) => { const scn = scenario(); return scn ? locationName(scn, index) : `Location ${index}`; },
      switch: (index) => { const scn = scenario(); return (scn && readSwitchNames(scn)[index]) || `Switch ${index + 1}`; },
      player: (slot) => `Player ${slot + 1}`,
      tile: (id) => { const l = loaded(); return l ? tileInfo(l.tileset, names(), id).label : null; },
    },

    // Pure and map-independent: the whole of it is `editor/textColors.ts`, handed over so
    // a plugin that shows or rewrites map text does not carry its own copy of the table.
    text: {
      codes: () => [...TEXT_CODES],
      code: (byte) => textCode(byte) ?? null,
      insertable: () => [...INSERTABLE_CODES],
      defaultColor: () => DEFAULT_TEXT_COLOR,
      runs: (text, options) => runsOf(text, options),
      plain: plainText,
      escape: escapeCode,
      bleedingLines,
      fixBleeding,
    },

    terrain: {
      types: () => terrainTypes(loaded()?.tileset ?? null, names()),
      isomTypes: () => {
        const l = loaded(), scn = scenario();
        return l && scn ? isomTerrains(isomTables(l.tileset, tilesetIndex(scn))) : [];
      },
      hasIsom: () => hasIsom(scenario()),
      checkIsom: async () => {
        const scn = scenario();
        if (!scn) return null;
        const l = loaded() ?? await ensureTileset(store.get(tilesetFileNameAtom));
        const current = scenario();
        return current ? isomReport(current, l.tileset) : null;
      },
      tileInfo: (id) => { const l = loaded(); return l ? tileInfo(l.tileset, names(), id) : null; },
      terrainAt: (tx, ty) => {
        const scn = scenario(), l = loaded();
        if (!scn || !l || tx < 0 || ty < 0 || tx >= scn.width || ty >= scn.height) return null;
        const info = tileInfo(l.tileset, names(), scn.tiles[ty * scn.width + tx]);
        if (info.kind === "terrain") return l.tileset.groups[info.group]?.index ?? null;
        return hasIsom(scn) ? isomTerrainAt(scn, l.tileset, tx, ty) : null;
      },
      color: (tileId) => {
        const l = loaded();
        if (!l) return null;
        const megatile = megatileForTile(l.tileset, tileId);
        return megatile > 0 ? l.atlas.averages[megatile] : null;
      },
      terrainColor: (terrainId) => {
        const l = loaded();
        if (!l) return null;
        const type = terrainTypes(l.tileset, names()).find((t) => t.id === terrainId);
        if (!type) return null;
        let r = 0, g = 0, b = 0, n = 0;
        for (const group of [type.group, type.group + 1]) {
          for (const slot of variationsOf(l.tileset, group).common) {
            const megatile = megatileForTile(l.tileset, (group << 4) | slot);
            if (megatile <= 0) continue;
            const [cr, cg, cb] = rgb(l.atlas.averages[megatile]);
            r += cr; g += cg; b += cb; n++;
          }
        }
        return n === 0 ? null : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
      },
      heightOf: (terrainId) => terrainTypes(loaded()?.tileset ?? null, names()).find((t) => t.id === terrainId)?.height ?? null,
      diamondAt,
      isDiamond,
      diamondsIn: (rect) => {
        const scn = scenario();
        if (!scn) return [];
        const iw = isomWidth(scn), ih = isomHeight(scn);
        const out: Diamond[] = [];
        // A diamond (x, y) is centred on pixel (64x, 32y): tile column 2x, row y. Inclusive of the far edges,
        // so a rect that reaches the map edge covers the last lattice column and row.
        for (let y = Math.max(0, rect.y0); y <= Math.min(ih - 1, rect.y1); y++) {
          for (let x = Math.max(0, Math.ceil(rect.x0 / 2)); x <= Math.min(iw - 1, Math.floor(rect.x1 / 2)); x++) {
            if ((x + y) % 2 === 0) out.push({ x, y });
          }
        }
        return out;
      },
      active: () => ({ mode: store.get(terrainModeAtom), terrain: store.get(activeTerrainAtom), tile: store.get(activeTileAtom), brushSize: store.get(brushSizeAtom), variation: store.get(rectVariationAtom) }),
      setActive: (brush) => {
        if (brush.mode !== undefined) store.set(terrainModeAtom, brush.mode);
        if (brush.terrain !== undefined) store.set(activeTerrainAtom, brush.terrain);
        if (brush.tile !== undefined) store.set(activeTileAtom, brush.tile);
        if (brush.brushSize !== undefined) store.set(brushSizeAtom, brush.brushSize);
        if (brush.variation !== undefined) store.set(rectVariationAtom, brush.variation);
      },
      floodRegion: (x, y, match = "terrain") => {
        const scn = scenario();
        if (!scn || x < 0 || y < 0 || x >= scn.width || y >= scn.height) return [];
        const seed = scn.tiles[y * scn.width + x];
        const l = loaded();
        if (match === "terrain" && l) {
          const groups = l.tileset.groups;
          const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
          const seedType = typeOf(seed);
          return [...floodRegion(scn, x, y, (id) => typeOf(id) === seedType)];
        }
        return [...floodRegion(scn, x, y, (id) => id === seed)];
      },
      blendCandidates: (anchorId, side, options = {}) => { const l = loaded(); return l ? blendCandidates(l.tileset, anchorId, side, { ...DEFAULT_BLEND_OPTIONS, ...options }) : []; },
      flatGroupOf: (terrainId) => { const l = loaded(); return l ? flatGroupOf(l.tileset, terrainId) : -1; },
      symmetry: () => store.get(symmetryAtom),
      setSymmetry: (mode) => store.set(symmetryAtom, mode),
      symmetryAvailable: (mode) => { const scn = scenario(); return scn ? symmetryAvailable(mode, scn.width, scn.height) : mode === "none"; },
      mirror: (cells) => {
        const scn = scenario();
        if (!scn) return [];
        const list = typeof (cells as Rect).x0 === "number"
          ? (() => { const r = cells as Rect; const out: number[] = []; for (let y = Math.max(0, r.y0); y < Math.min(scn.height, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(scn.width, r.x1); x++) out.push(y * scn.width + x); return out; })()
          : [...(cells as Iterable<number>)];
        return [...mirrorIndices(store.get(symmetryAtom), list, scn.width, scn.height)];
      },
      mirrorPoint: (px, py) => { const scn = scenario(); return scn ? mirrorPixel(store.get(symmetryAtom), px, py, scn.width, scn.height) : [{ x: px, y: py }]; },
    },

    tileset: {
      id: () => (scenario() ? TILESETS[tilesetIndex(scenario()!)].id : null),
      name: () => { const scn = scenario(); return scn ? TILESETS[tilesetIndex(scn)].name : TILESET_BY_ID[store.get(mapTilesetAtom)].name; },
      isLoaded: () => loaded() !== null,
      load: async () => {
        try { await ensureTileset(store.get(tilesetFileNameAtom)); return true; } catch { return false; }
      },
      raw: loaded,
    },

    selection: {
      markedArea: () => store.get(clipSelectionAtom),
      markArea: (rect) => store.set(clipSelectionAtom, rect),
      units: () => [...store.get(selectedUnitsAtom)],
      setUnits: (i) => store.set(selectedUnitsAtom, [...i]),
      sprites: () => [...store.get(selectedSpritesAtom)],
      setSprites: (i) => store.set(selectedSpritesAtom, [...i]),
      doodads: () => [...store.get(selectedDoodadsAtom)],
      setDoodads: (i) => store.set(selectedDoodadsAtom, [...i]),
      locations: () => [...store.get(selectedLocationsAtom)],
      setLocations: (i) => store.set(selectedLocationsAtom, [...i]),
      layer: () => store.get(activeLayerAtom),
      setLayer: (layer) => store.set(activeLayerAtom, layer),
      lockedLayers: () => (Object.entries(store.get(lockedLayersAtom)) as [EditorLayer, boolean | undefined][]).filter(([, v]) => v).map(([k]) => k),
      setLayerLocked: (layer, locked) => store.set(lockedLayersAtom, { ...store.get(lockedLayersAtom), [layer]: locked }),
    },

    clipboard: clipboardApi(store),
    exchange: {
      encodeTrg,
      decodeTrg,
      formatStrings: () => { const scn = scenario(); return scn ? formatStringTable(scn.strings) : ""; },
      parseStrings: parseStringTable,
    },

    palette: {
      active: () => {
        const sprite = store.get(spritePlaceOptionsAtom);
        return {
          unit: store.get(activeUnitAtom),
          owner: store.get(unitOwnerAtom),
          spriteKind: store.get(activeSpriteKindAtom),
          sprite: store.get(activeSpriteAtom),
          unitSprite: store.get(activeUnitSpriteAtom),
          spriteFlipped: sprite.flipped,
          spriteDisabled: sprite.disabled,
          doodad: store.get(activeDoodadAtom),
          fogPlayers: store.get(fogPlayersAtom),
          fogMode: store.get(fogModeAtom),
          fogViewPlayer: store.get(fogViewPlayerAtom),
        };
      },
      setActive: (c) => {
        if (c.unit !== undefined) store.set(activeUnitAtom, c.unit);
        if (c.owner !== undefined) store.set(unitOwnerAtom, c.owner);
        if (c.spriteKind !== undefined) store.set(activeSpriteKindAtom, c.spriteKind);
        if (c.sprite !== undefined) store.set(activeSpriteAtom, c.sprite);
        if (c.unitSprite !== undefined) store.set(activeUnitSpriteAtom, c.unitSprite);
        if (c.spriteFlipped !== undefined || c.spriteDisabled !== undefined) {
          const prev = store.get(spritePlaceOptionsAtom);
          store.set(spritePlaceOptionsAtom, { flipped: c.spriteFlipped ?? prev.flipped, disabled: c.spriteDisabled ?? prev.disabled });
        }
        if (c.doodad !== undefined) store.set(activeDoodadAtom, c.doodad);
        if (c.fogPlayers !== undefined) store.set(fogPlayersAtom, c.fogPlayers);
        if (c.fogMode !== undefined) store.set(fogModeAtom, c.fogMode);
        if (c.fogViewPlayer !== undefined) store.set(fogViewPlayerAtom, Math.max(0, Math.min(7, c.fogViewPlayer)));
      },
      playerColor: (owner) => { const scn = scenario(); return displayColorHex(scn?.playerColors, scn?.playerRgb, owner); },
      placementOptions: () => ({ ...store.get(placementOptionsAtom) }),
      setPlacementOptions: (patch) => store.set(placementOptionsAtom, { ...store.get(placementOptionsAtom), ...patch }),
      doodadPlacement: () => ({ ...store.get(doodadPlacementAtom) }),
      setDoodadPlacement: (patch) => store.set(doodadPlacementAtom, { ...store.get(doodadPlacementAtom), ...patch }),
      locationSnap: () => store.get(locationSnapAtom),
      setLocationSnap: (step) => store.set(locationSnapAtom, step),
      unitGroups: () => UNIT_GROUPS.map((g) => ({ ...g, units: [...g.units] })),
      unitName,
      unitSize: (unitId) => {
        const g = unitGeometry(peekUnitAssets()?.units ?? null, unitId);
        return { width: g.placeW, height: g.placeH, building: g.building, flyer: g.flyer };
      },
      spriteGroups: () => { const a = peekUnitAssets(); return a ? spriteCatalogue(a).groups.map((g) => ({ ...g, ids: [...g.ids] })) : []; },
      spriteName: (kind, id) => spriteName(peekUnitAssets(), kind, id),
      doodadCategories: () => (loaded()?.doodads.categories ?? []).map((c) => ({ name: c.name, doodads: c.doodads.map(doodadInfoOf) })),
      doodadInfo: (id) => { const def = loaded()?.doodads.byId.get(id); return def ? doodadInfoOf(def) : null; },
    },

    ui: {
      status: (text) => store.set(statusMessageAtom, text),
      statusText: () => store.get(statusMessageAtom),
      toast: (t) => { store.set(pushToastAtom, { kind: t.kind ?? "info", title: t.title, detail: t.detail, ttl: t.ttl }); },
      saveFile: async (data, fileName) => {
        const blob = data instanceof Blob ? data : new Blob([data as unknown as BlobPart], { type: "application/octet-stream" });
        const out = await saveBlob(blob, fileName, null);
        return out ? { route: out.route === "download" ? "download" : "picker", fileName: out.fileName } : null;
      },
      dialog: (spec) => {
        let key = -1;
        // The frame reads the title through this box, so `setTitle` reaches it without touching the spec.
        const title: TitleBox = { value: spec.title, listeners: new Set<() => void>() };
        const handle: DialogHandle = {
          close: () => { if (key >= 0) store.set(closeDialogAtom, key); },
          isOpen: () => store.get(dialogStackAtom).some((d) => d.key === key),
          setTitle: (t) => { title.value = t; for (const l of title.listeners) l(); },
        };
        key = store.set(openDialogAtom, "pluginDialog", { spec, handle, plugin: info, title });
        // Closed with the plugin — and taken off the list once it closes by itself, so a plugin
        // that opens dialogs in a loop does not grow the bag for the life of the plugin.
        const sweep = bag.add(() => { if (handle.isOpen()) handle.close(); });
        const unsub = store.sub(dialogStackAtom, () => { if (!handle.isOpen()) { unsub(); sweep.dispose(); } });
        return handle;
      },
      panel: (spec) => {
        const key = nextContributionKey();
        const title: TitleBox = { value: spec.title, listeners: new Set<() => void>() };
        let closed = false;
        const handle: PanelHandle = {
          close: () => {
            if (closed) return;
            closed = true;
            store.set(pluginPanelsAtom, store.get(pluginPanelsAtom).filter((p) => p.key !== key));
            try { spec.onClose?.(); } catch (err) { console.error(`[${info.name}] panel onClose failed`, err); }
          },
          isOpen: () => !closed,
          setTitle: (t) => { title.value = t; for (const l of title.listeners) l(); },
        };
        store.set(pluginPanelsAtom, [...store.get(pluginPanelsAtom), { key, plugin: info, spec, handle, title }]);
        const sweep = bag.add(() => handle.close());
        const unsub = store.sub(pluginPanelsAtom, () => { if (closed) { unsub(); sweep.dispose(); } });
        return handle;
      },
      mapTool: (spec) => startMapTool(store, bag, info, spec),
      overlay: (spec) => registerOverlay(store, bag, info, spec),
      pickFiles: (options = {}) => new Promise<File[]>((resolve) => {
        if (typeof document === "undefined") { resolve([]); return; }
        const input = document.createElement("input");
        input.type = "file";
        if (options.accept) input.accept = options.accept;
        input.multiple = options.multiple ?? false;
        input.addEventListener("change", () => resolve(input.files ? [...input.files] : []), { once: true });
        input.addEventListener("cancel", () => resolve([]), { once: true });
        input.click();
      }),
      pickArea: (options) => pickOnMap(store, bag, info, "area", options) as Promise<Rect | null>,
      pickTile: (options) => pickOnMap(store, bag, info, "tile", options) as Promise<{ x: number; y: number } | null>,
      loadImage,
      readClipboardImage,
      confirm: (message, options) => confirmDialog(api.ui.dialog, message, options),
      alert: (message, options) => alertDialog(api.ui.dialog, message, options),
      prompt: (message, options) => promptDialog(api.ui.dialog, message, options),
      progress: (label, options) => progressPanel(api.ui.panel, label, options),
      el,
      widgets,
      open: (dialog, payload) => { store.set(openDialogAtom, dialog, payload); },
      ask: (dialog, payload) => askDialog(store, dialog, payload),
      repaint: () => store.set(viewportRepaintAtom, store.get(viewportRepaintAtom) + 1),
    },

    menu: {
      add: (path, item) => {
        const key = nextContributionKey();
        const { run: own, command, icon: wanted, ...rest } = item;
        const icon = wanted === "plugin" ? info.icon ?? { kind: "text", text: "⌘" } : wanted;
        const run = () => { if (own) own(); else if (command) runCommand(store, qualifyCommand(info.id, command)); };
        store.set(pluginMenuItemsAtom, [...store.get(pluginMenuItemsAtom), { ...rest, run, icon, key, pluginId: info.id, path }]);
        return bag.add(() => store.set(pluginMenuItemsAtom, store.get(pluginMenuItemsAtom).filter((i) => i.key !== key)), "menu");
      },
    },

    contextMenu: {
      add: (surface, item) => {
        const key = nextContributionKey();
        const { run: own, command, ...rest } = item;
        const run = (ctx: ContextMenuContext) => { if (own) own(ctx); else if (command) runCommand(store, qualifyCommand(info.id, command), [ctx]); };
        store.set(pluginContextItemsAtom, [...store.get(pluginContextItemsAtom), { ...rest, run, key, pluginId: info.id, surface }]);
        return bag.add(() => store.set(pluginContextItemsAtom, store.get(pluginContextItemsAtom).filter((i) => i.key !== key)), "contextMenu");
      },
    },

    hotkeys: {
      add: (combo, action) => {
        const key = nextContributionKey();
        const run = typeof action === "function" ? action : () => runCommand(store, qualifyCommand(info.id, action.command));
        store.set(pluginHotkeysAtom, [...store.get(pluginHotkeysAtom), { key, pluginId: info.id, combo: normalizeCombo(combo), run }]);
        return bag.add(() => store.set(pluginHotkeysAtom, store.get(pluginHotkeysAtom).filter((i) => i.key !== key)), "hotkeys");
      },
    },

    commands: {
      register: (spec) => {
        const key = nextContributionKey();
        const id = qualifyCommand(info.id, spec.id);
        if (store.get(pluginCommandsAtom).some((c) => c.id === id)) console.warn(`[plugins] command ${id} is already registered; the newer one wins`);
        store.set(pluginCommandsAtom, [...store.get(pluginCommandsAtom).filter((c) => c.id !== id), { key, pluginId: info.id, id, title: spec.title, enabled: spec.enabled, run: spec.run }]);
        return bag.add(() => store.set(pluginCommandsAtom, store.get(pluginCommandsAtom).filter((c) => c.key !== key)));
      },
      run: (id, ...args) => runCommand(store, qualifyCommand(info.id, id), args),
      has: (id) => store.get(pluginCommandsAtom).some((c) => c.id === qualifyCommand(info.id, id)),
      list: (): CommandInfo[] => store.get(pluginCommandsAtom).map((c) => ({ id: c.id, title: c.title, pluginId: c.pluginId, enabled: c.enabled ? c.enabled() : true })),
    },

    events: {
      on: (event: PluginEvent, listener: (payload: DocumentEvent) => void) => {
        const atoms = EVENT_ATOMS[event];
        if (!atoms) throw new Error(`Unknown plugin event "${event}"`);
        // Only "document" carries a payload; the other listeners are declared with none and ignore it.
        const safe = () => { try { listener(documentEvent(store)); } catch (err) { console.error(`[${info.name}] event listener failed`, err); } };
        const unsubs = atoms.map((a) => store.sub(a, safe));
        return bag.add(() => { for (const u of unsubs) u(); }, "events");
      },
    },

    // Keys live under `scmjs.plugin.<id>.`, so Preferences ▸ storage lists them per plugin and sweeps them
    // with the rest; `browserStorage()` is a memory stand-in when the browser has none.
    storage: {
      get: (key, fallback) => {
        try {
          const raw = browserStorage().getItem(prefix + key);
          return raw === null ? fallback : (JSON.parse(raw) as typeof fallback);
        } catch {
          return fallback;
        }
      },
      set: (key, value) => {
        try { browserStorage().setItem(prefix + key, JSON.stringify(value)); } catch { /* quota */ }
      },
      remove: (key) => {
        try { browserStorage().removeItem(prefix + key); } catch { /* ignore */ }
      },
    },

    log: (...args) => console.log(`[${info.name}]`, ...args),
  };
  return api;
}

/* ── Lifecycle ──────────────────────────────────────────── */

interface Active {
  token: number;
  bag: Contributions;
  deactivate?: Deactivate;
  /** The load in flight, so a second caller awaits the first rather than a resolved promise. */
  promise?: Promise<void>;
}

const actives = new WeakMap<Store, Map<string, Active>>();
let activationSeq = 0;

function activeMap(store: Store): Map<string, Active> {
  let m = actives.get(store);
  if (!m) { m = new Map(); actives.set(store, m); }
  return m;
}

function setRuntime(store: Store, spec: string, patch: Partial<PluginRuntime>) {
  const all = store.get(pluginRuntimesAtom);
  const prev = all[spec] ?? { spec, status: "disabled" as const, manifest: null, icon: null, error: null, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0 } };
  store.set(pluginRuntimesAtom, { ...all, [spec]: { ...prev, ...patch } });
}

function runDeactivate(d: Deactivate | undefined) {
  try {
    if (typeof d === "function") d();
    else if (d && typeof d === "object" && typeof d.dispose === "function") d.dispose();
  } catch (err) {
    console.error("[plugins] deactivate failed", err);
  }
}

/** The entry module's `activate`, whichever way it was exported. */
export function resolveActivate(module: unknown): PluginModule["activate"] {
  const m = module as Record<string, unknown> | null;
  const candidates = [m?.default, (m?.default as Record<string, unknown> | undefined)?.activate, m?.activate];
  for (const c of candidates) if (typeof c === "function") return c as PluginModule["activate"];
  throw new Error("The plugin's entry module exports no activate function (export default function activate(api) {…}).");
}

/** What the browser build uses to fetch, transpile and import plugin code. */
export function browserLoaderDeps(): LoaderDeps {
  return {
    fetchText: async (url) => {
      const res = await fetch(url, { cache: "no-cache" });
      // The callers all name the URL they asked for, so this does not: "Could not fetch
      // <url>: 404 fetching <url>" is the same address twice in one line.
      if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
      return res.text();
    },
    transpile: (source, fileName) => transpileInBackground(source, fileName),
    createModuleUrl: (code) => URL.createObjectURL(new Blob([code], { type: "text/javascript" })),
    importModule: async (url) => {
      try { return await import(/* @vite-ignore */ url); } finally { if (url.startsWith("blob:")) URL.revokeObjectURL(url); }
    },
    builtins: BUILTIN_PLUGINS,
  };
}

/** What the installed list says about one spec (defaults merged in), or nothing. */
function installOf(store: Store, spec: string): PluginInstall | undefined {
  return effectiveInstalls(store.get(installedPluginsAtom)).find((p) => p.spec === spec);
}

/** A snapshot larger than this is not worth a `localStorage` slot; the copy is skipped and the plugin stays remote. */
const MAX_SNAPSHOT = 2 * 1024 * 1024;

/**
 * The deps one activation should use.
 *
 * A plugin the user asked to keep a copy of (`PluginInstall.local`) loads out of
 * `pluginCodeAtom` and touches nothing else; until there *is* a copy it loads normally
 * with every fetch recorded, and the recording is stored on success. Everything else
 * loads straight from `deps`, and `files` stays empty.
 */
function loadDepsFor(store: Store, spec: string, deps: LoaderDeps): { deps: LoaderDeps; files: Record<string, string> | null; from: "network" | "browser" } {
  if (!installOf(store, spec)?.local) return { deps, files: null, from: "network" };
  const snapshot = store.get(pluginCodeAtom)[spec];
  if (snapshot && Object.keys(snapshot.files).length > 0) return { deps: storedDeps(deps, snapshot.files), files: null, from: "browser" };
  const files: Record<string, string> = {};
  return { deps: recordingDeps(deps, files), files, from: "network" };
}

/** Keep what a load fetched, so the next one does not have to. Too big to store is not an error, just no copy. */
function storeSnapshot(store: Store, spec: string, files: Record<string, string>) {
  const size = Object.entries(files).reduce((n, [url, text]) => n + url.length + text.length, 0);
  if (size === 0) return;
  if (size > MAX_SNAPSHOT) {
    console.warn(`[plugins] ${spec}: ${size} characters is too much to keep in browser storage; it will load from its address.`);
    return;
  }
  store.set(pluginCodeAtom, { ...store.get(pluginCodeAtom), [spec]: { files, at: Date.now(), size } });
}

/** Throw away the copy of one plugin's code (Reload, Remove, turning the option off). */
export function forgetSnapshot(store: Store, spec: string) {
  const all = store.get(pluginCodeAtom);
  if (!(spec in all)) return;
  const next = { ...all };
  delete next[spec];
  store.set(pluginCodeAtom, next);
}

/**
 * Load and activate a plugin; a no-op when it is already active or loading.
 *
 * "No-op" still answers with the load that is in flight, not an immediately resolved
 * promise: React mounts this hook's effect twice in development, so the second pass finds
 * every spec already loading, and a caller that awaited *that* would read the runtimes
 * before a single fetch had finished — which is what made the notice for a plugin that
 * failed to load never appear (`hooks/usePlugins.ts`).
 */
export function activatePlugin(store: Store, spec: string, deps: LoaderDeps = browserLoaderDeps()): Promise<void> {
  const map = activeMap(store);
  const already = map.get(spec);
  if (already) return already.promise ?? Promise.resolve();
  const entry: Active = { token: ++activationSeq, bag: new Contributions() };
  map.set(spec, entry);
  entry.promise = loadAndRun(store, spec, deps, entry);
  return entry.promise;
}

/** The activation itself, once the slot in the active map is taken. */
async function loadAndRun(store: Store, spec: string, deps: LoaderDeps, entry: Active): Promise<void> {
  const map = activeMap(store);
  const { bag } = entry;
  setRuntime(store, spec, { status: "loading", error: null });
  const stillWanted = () => map.get(spec) === entry;
  const local = loadDepsFor(store, spec, deps);
  try {
    const { manifest, icon, module } = await loadPlugin(spec, local.deps);
    if (!stillWanted()) return;
    if (local.files) storeSnapshot(store, spec, local.files);
    if (manifest.api !== undefined && manifest.api > PLUGIN_API_VERSION) {
      throw new Error(`The plugin needs plugin API ${manifest.api}; this editor provides ${PLUGIN_API_VERSION}.`);
    }
    const info: PluginInfo = { id: pluginIdOf(manifest), name: manifest.name, source: spec, version: manifest.version, icon };
    setRuntime(store, spec, { manifest, icon: icon ?? null });
    const api = createPluginApi(store, info, bag);
    const result = await resolveActivate(module)(api);
    if (!stillWanted()) { runDeactivate(result); bag.dispose(); return; }
    entry.deactivate = result;
    setRuntime(store, spec, { status: "active", error: null, loadedFrom: local.from, contributions: { ...bag.counts } });
  } catch (err) {
    bag.dispose();
    if (stillWanted()) map.delete(spec);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[plugins] ${spec}:`, err);
    setRuntime(store, spec, { status: "error", error: message });
  }
}

/* ── Describing (manifest only, no code) ────────────────── */

const describing = new WeakMap<Store, Map<string, Promise<void>>>();

/** An icon URL longer than this is not worth a `localStorage` slot (a fat `data:` icon). */
const MAX_CACHED_ICON = 32 * 1024;

function describeMap(store: Store): Map<string, Promise<void>> {
  let m = describing.get(store);
  if (!m) { m = new Map(); describing.set(store, m); }
  return m;
}

/**
 * Read a plugin's manifest — name, version, description, icon — **without running it**.
 *
 * A plugin that is listed but turned off used to be a bare spec in Manage Plugins,
 * because the only thing that ever filled `pluginRuntimesAtom` was `activatePlugin`,
 * i.e. the call that also imports and executes the code. This is the other half:
 * `resolvePlugin(..., { entry: false })` fetches the one `plugin.json` and stops, so a
 * row can be named and described at the cost of a JSON file and no execution at all.
 *
 * It never touches `status` and never reports an error: a description is a nicety, and a
 * plugin the network could not describe is still just *off*, not broken. The manifest is
 * cached in `pluginManifestCacheAtom` so the next visit renders from storage at once and
 * this refreshes behind it. One attempt per spec per store — `forgetDescription` (which
 * `reloadPlugin` calls) is what asks again.
 */
export function describePlugin(store: Store, spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins"> = browserLoaderDeps()): Promise<void> {
  const map = describeMap(store);
  const existing = map.get(spec);
  if (existing) return existing;
  const promise = runDescribe(store, spec, deps);
  map.set(spec, promise);
  return promise;
}

async function runDescribe(store: Store, spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins">): Promise<void> {
  const cached: CachedManifest | undefined = store.get(pluginManifestCacheAtom)[spec];
  if (cached && !store.get(pluginRuntimesAtom)[spec]?.manifest) {
    setRuntime(store, spec, { manifest: cached.manifest, icon: cached.icon });
  }
  setRuntime(store, spec, { describing: true });
  try {
    const source = parseSpec(spec);
    // A plugin the user keeps a copy of is described out of that copy: its address is
    // not touched at all while the option is on and a copy exists.
    const snapshot = installOf(store, spec)?.local ? store.get(pluginCodeAtom)[spec] : undefined;
    const use = snapshot && source.kind === "remote" && source.manifestUrl && snapshot.files[source.manifestUrl] ? storedDeps(deps, snapshot.files) : deps;
    const { manifest, icon } = await resolvePlugin(source, use, { entry: false });
    // An activation that started meanwhile has the last word: it ran the code, this did not.
    rememberManifest(store, spec, manifest, icon ?? null, { runtime: !activeMap(store).has(spec), cache: source.kind !== "builtin" });
  } catch (err) {
    // Not an error state: the row keeps whatever it had (a cached manifest, or the spec).
    console.warn(`[plugins] could not describe ${spec}:`, err);
  } finally {
    setRuntime(store, spec, { describing: false });
  }
}

/**
 * Keep what a `plugin.json` said: on the runtime (so the row is named at once) and in
 * `pluginManifestCacheAtom` (so the next visit renders before the network answers).
 * A built-in is never cached — there is nothing to fetch and its icon URL is build-hashed.
 */
export function rememberManifest(
  store: Store,
  spec: string,
  manifest: PluginManifest,
  icon: PluginIcon | null,
  opts: { runtime?: boolean; cache?: boolean } = {},
) {
  if (opts.runtime !== false) setRuntime(store, spec, { manifest, icon });
  if (opts.cache === false || spec.startsWith("builtin:")) return;
  const keep = icon && (icon.kind === "text" || icon.url.length <= MAX_CACHED_ICON) ? icon : null;
  store.set(pluginManifestCacheAtom, { ...store.get(pluginManifestCacheAtom), [spec]: { manifest, icon: keep, at: Date.now() } });
}

/** Ask for a plugin's manifest again on the next `describePlugin` (Reload, Remove). */
export function forgetDescription(store: Store, spec: string) {
  describeMap(store).delete(spec);
}

/* ── Stopping ───────────────────────────────────────────── */

export function deactivatePlugin(store: Store, spec: string) {
  const map = activeMap(store);
  const entry = map.get(spec);
  if (!entry) {
    if (store.get(pluginRuntimesAtom)[spec]) setRuntime(store, spec, { status: "disabled", error: null });
    return;
  }
  map.delete(spec);
  runDeactivate(entry.deactivate);
  entry.bag.dispose();
  setRuntime(store, spec, { status: "disabled", error: null, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0 } });
}

/** Fetch a plugin again from its address, replacing any copy kept in the browser. */
export async function reloadPlugin(store: Store, spec: string, deps?: LoaderDeps) {
  forgetDescription(store, spec);
  forgetSnapshot(store, spec);
  deactivatePlugin(store, spec);
  await activatePlugin(store, spec, deps);
}

export function isPluginActive(store: Store, spec: string): boolean {
  return activeMap(store).has(spec);
}

export function activePluginSpecs(store: Store): string[] {
  return [...activeMap(store).keys()];
}

/* ── Installed list ─────────────────────────────────────── */

export const builtinSpec = (name: string) => `builtin:${name}`;

/**
 * The plugins to run: every default (on or off as the stored list says, else as the
 * default itself says), then the ones the user added, in the order they were added. A
 * default is a spec like any other — the remote ones are fetched over the network on
 * every start — so the only thing being a default buys it is a place in the list and a
 * Remove button it does not get; see `defaults.ts`.
 *
 * Stored rows are matched to defaults by `pluginKey`, not by the spec, because the spec
 * of a default moves: an editor that fetched `github:scm-js/plugin-repair` last week
 * pins `…@v1.0.0` today and bundles it as `builtin:repair` on the desktop, and all three
 * are one plugin whose *enabled* the user may have answered. Matching on the string
 * would list it twice and run it twice — two Repair dialogs on every open. The default's
 * own spec wins, so a version the project moved forward reaches everyone, unless the
 * stored one is pinned: that is a version the user chose deliberately (the Update button
 * on a pinned row), and taking it away silently is the one thing this must not do.
 */
export function effectiveInstalls(stored: readonly PluginInstall[], defaults: readonly DefaultPlugin[] = defaultPlugins()): PluginInstall[] {
  const claimed = new Set<string>();
  const out: PluginInstall[] = defaults.map((d) => {
    const key = pluginKey(d.spec);
    const said = stored.find((p) => pluginKey(p.spec) === key);
    if (said) claimed.add(key);
    const spec = said && isPinned(said.spec) ? said.spec : d.spec;
    return { spec, enabled: said?.enabled ?? d.enabled, ...(said?.local ? { local: true } : {}) };
  });
  for (const p of stored) if (!claimed.has(pluginKey(p.spec))) out.push(p);
  return out;
}

/**
 * What the Add Plugin confirmation shows before anything of the plugin runs: its
 * manifest and the addresses it will be fetched from, and nothing else (`previewPlugin`
 * reads one `plugin.json`). It throws only when the *spec* is unusable — a manifest that
 * cannot be fetched comes back as `preview.problem`, since the user may still add it.
 */
export function inspectPlugin(spec: string, deps: Pick<LoaderDeps, "fetchText" | "builtins"> = browserLoaderDeps()): Promise<PluginPreview> {
  return previewPlugin(spec, deps);
}

/**
 * Add a plugin the user has just confirmed. The manifest read for the confirmation is
 * kept (`rememberManifest`), so the new row is named and described the instant it
 * appears instead of after another fetch, and only then is the code fetched and run.
 */
export async function installPlugin(
  store: Store,
  preview: PluginPreview,
  opts: { enabled?: boolean; pin?: boolean; local?: boolean; replaces?: string; deps?: LoaderDeps } = {},
) {
  const enabled = opts.enabled !== false;
  // Pinning is what actually gets stored: `github:owner/repo@<sha>` instead of a ref that moves.
  const pinned = opts.pin !== false && preview.pin !== null;
  const spec = pinned ? preview.pin!.spec : preview.spec;
  // Updating a pinned plugin: the old commit's install, copy and running instance all go,
  // since the new spec is a different plugin as far as everything here is concerned.
  if (opts.replaces && opts.replaces !== spec) {
    deactivatePlugin(store, opts.replaces);
    setInstalled(store, opts.replaces, { remove: true });
  }
  if (preview.manifest) rememberManifest(store, spec, preview.manifest, preview.icon);
  setInstalled(store, spec, { enabled, local: opts.local === true });
  if (enabled) await activatePlugin(store, spec, opts.deps ?? browserLoaderDeps());
}

/** Add, remove or toggle a plugin in the persisted list (Remove also drops its copy). */
export function setInstalled(store: Store, spec: string, patch: { enabled?: boolean; local?: boolean; remove?: boolean }) {
  const stored = store.get(installedPluginsAtom);
  const others = stored.filter((p) => p.spec !== spec);
  if (patch.remove) { forgetSnapshot(store, spec); store.set(installedPluginsAtom, others); return; }
  const prev = stored.find((p) => p.spec === spec);
  const local = patch.local ?? prev?.local ?? false;
  // The copy only exists to serve `local`; dropping the option drops it, so turning the
  // option back on fetches the plugin again rather than reviving something months old.
  if (!local) forgetSnapshot(store, spec);
  const next: PluginInstall = { spec, enabled: patch.enabled ?? prev?.enabled ?? true, ...(local ? { local: true } : {}) };
  store.set(installedPluginsAtom, prev ? stored.map((p) => (p.spec === spec ? next : p)) : [...stored, next]);
}
