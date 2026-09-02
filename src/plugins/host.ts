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
  clipSelectionAtom, fogModeAtom, fogPlayersAtom, mapFilePathAtom, mapModifiedAtom, mapTilesetAtom, placementOptionsAtom, rectVariationAtom,
  selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, spritePlaceOptionsAtom, terrainModeAtom, unitOwnerAtom,
} from "../atoms/editorAtoms";
import {
  commitTerrainAtom, doodadsRevisionAtom, locationsRevisionAtom, redoAtom, scenarioAtom, settingsRevisionAtom, terrainRevisionAtom,
  tilesetFileNameAtom, triggersRevisionAtom, undoAtom, unitsRevisionAtom, type HistoryEntry,
} from "../atoms/documentAtoms";
import { closeDialogAtom, dialogStackAtom, openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import {
  installedPluginsAtom, mapPickAtom, mapToolAtom, mapToolRevisionAtom, nextContributionKey, normalizeCombo, pluginContextItemsAtom, pluginHotkeysAtom,
  pluginMenuItemsAtom, pluginPanelsAtom, pluginRuntimesAtom,
  type MapPickKind, type PluginInstall, type PluginRuntime, type TitleBox,
} from "../atoms/pluginAtoms";
import { TILESET_BY_ID, TILESETS } from "../data/tilesets";
import { scenarioDescription, scenarioName, tilesetIndex } from "../formats/chk/scenario";
import { ensureTileset, peekTileset, type LoadedTileset } from "../formats/tileset/load";
import { megatileForTile } from "../formats/tileset/decode";
import { NO_DOODADS } from "../formats/tileset/doodads";
import { flatTerrain, variationsOf } from "../formats/tileset/terrain";
import { terrainTypes, tileInfo } from "../formats/tileset/palette";
import { peekUnitAssets } from "../formats/units/load";
import { displayColorHex } from "../data/players";
import { UNIT_GROUPS, unitName } from "../data/units";
import { spriteCatalogue } from "../data/sprites";
import { spriteName } from "../hooks/useSpriteTools";
import { doodadLabel } from "../hooks/useDoodadTools";
import { checkPlacement } from "../editor/placement";
import type { DoodadDef } from "../formats/tileset/doodads";
import { applyChanges, stampTerrain, stampTile, Stroke, type Rect, type TileChange } from "../editor/terrain";
import { applyIsomChanges, diamondAt, hasIsom, isDiamond, isomHeight, isomTables, isomTerrains, isomWidth, paintIsom, type Diamond } from "../editor/isom";
import { hasEdits } from "../editor/history";
import { addUnits, applyUnitChanges, makeUnit, nextSerial, removeUnits, snapPlacement, unitGeometry, updateUnits, type UnitChange } from "../editor/units";
import { addSprites, applySpriteChanges, clampSprite, makeSprite, removeSprites, type SpriteChange } from "../editor/sprites";
import { applyDoodadChanges, placeDoodad, removeDoodads, type DoodadChange } from "../editor/doodads";
import { addLocation, applyLocationChanges, editLocation, ensureLocationSlots, removeLocations, type LocationChange } from "../editor/locations";
import { applyFogChanges, ensureMask, paintFog } from "../editor/fog";
import { markDirty } from "../formats/chk/scenario";
import {
  pluginIdOf, PLUGIN_API_VERSION,
  type Cells, type Deactivate, type DialogHandle, type DoodadInfo, type EditResult, type EditTransaction, type MapToolHandle, type MapToolSpec, type MapToolStopReason,
  type PanelHandle, type PickOptions, type PluginApi, type PluginEvent, type PluginInfo, type PluginModule,
} from "./api";
import { loadPlugin, type LoaderDeps } from "./loader";
import { loadImage, readClipboardImage } from "./images";
import { BUILTIN_PLUGINS } from "./builtin";
import { defaultPluginSpecs } from "./defaults";
import { transpileInBackground } from "../script/compileClient";

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
 * Run `build` against a transaction over the open scenario and commit what it did as
 * one undo entry. Operations apply as they are called and accumulate change lists in
 * `applyEntry` order; the terrain lists go through `Stroke` so a cell written twice
 * records one change from its original tile to its final one.
 */
export function runTransaction(store: Store, label: string, build: (tx: EditTransaction) => void): EditResult {
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
    note: (text) => { notes.push(text); },
  };

  build(tx);

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

  const result: EditResult = {
    changed: hasEdits(entry),
    tiles: entry.changes.length,
    isom: isomChanges.length,
    units: units.length,
    sprites: sprites.length,
    doodads: doodads.length,
    locations: locations.length,
    fog: fogChanges.length,
    notes,
  };
  if (!result.changed) return result;
  store.set(commitTerrainAtom, { entry, summary: notes.length > 0 ? `${label} — ${notes.join(", ")}` : label });
  return result;
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
  selection: [selectedUnitsAtom, selectedSpritesAtom, selectedDoodadsAtom, selectedLocationsAtom, clipSelectionAtom],
  palette: [
    terrainModeAtom, activeTerrainAtom, activeTileAtom, rectVariationAtom, brushSizeAtom, activeUnitAtom, unitOwnerAtom, activeSpriteKindAtom, activeSpriteAtom,
    activeUnitSpriteAtom, spritePlaceOptionsAtom, activeDoodadAtom, fogPlayersAtom, fogModeAtom,
  ],
} as const;

function doodadInfoOf(def: DoodadDef): DoodadInfo {
  return { id: def.id, name: doodadLabel(def), category: def.category, width: def.width, height: def.height };
}

function pluginStorage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Build one plugin's view of the editor. Everything it registers lands in `bag`. */
export function createPluginApi(store: Store, info: PluginInfo, bag: Contributions): PluginApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const names = () => TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  const rgb = (packed: number) => [packed >> 16 & 0xff, packed >> 8 & 0xff, packed & 0xff];
  const memory = new Map<string, string>();
  const prefix = `scmjs.plugin.${info.id}.`;

  const api: PluginApi = {
    apiVersion: PLUGIN_API_VERSION,
    plugin: info,

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
      undo: () => store.set(undoAtom),
      redo: () => store.set(redoAtom),
    },

    terrain: {
      types: () => terrainTypes(loaded()?.tileset ?? null, names()),
      isomTypes: () => {
        const l = loaded(), scn = scenario();
        return l && scn ? isomTerrains(isomTables(l.tileset, tilesetIndex(scn))) : [];
      },
      hasIsom: () => hasIsom(scenario()),
      tileInfo: (id) => { const l = loaded(); return l ? tileInfo(l.tileset, names(), id) : null; },
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
      active: () => ({ mode: store.get(terrainModeAtom), terrain: store.get(activeTerrainAtom), tile: store.get(activeTileAtom), brushSize: store.get(brushSizeAtom) }),
      setActive: (brush) => {
        if (brush.mode !== undefined) store.set(terrainModeAtom, brush.mode);
        if (brush.terrain !== undefined) store.set(activeTerrainAtom, brush.terrain);
        if (brush.tile !== undefined) store.set(activeTileAtom, brush.tile);
        if (brush.brushSize !== undefined) store.set(brushSizeAtom, brush.brushSize);
      },
    },

    tileset: {
      id: () => (scenario() ? TILESETS[tilesetIndex(scenario()!)].id : null),
      name: () => TILESET_BY_ID[store.get(mapTilesetAtom)].name,
      isLoaded: () => loaded() !== null,
      load: async () => {
        try { await ensureTileset(store.get(tilesetFileNameAtom)); return true; } catch { return false; }
      },
      raw: loaded,
    },

    selection: {
      markedArea: () => store.get(clipSelectionAtom),
      markArea: (rect) => store.set(clipSelectionAtom, rect),
      units: () => store.get(selectedUnitsAtom),
      setUnits: (i) => store.set(selectedUnitsAtom, i),
      sprites: () => store.get(selectedSpritesAtom),
      setSprites: (i) => store.set(selectedSpritesAtom, i),
      doodads: () => store.get(selectedDoodadsAtom),
      setDoodads: (i) => store.set(selectedDoodadsAtom, i),
      locations: () => store.get(selectedLocationsAtom),
      setLocations: (i) => store.set(selectedLocationsAtom, i),
      layer: () => store.get(activeLayerAtom),
      setLayer: (layer) => store.set(activeLayerAtom, layer),
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
      },
      playerColor: (owner) => { const scn = scenario(); return displayColorHex(scn?.playerColors, scn?.playerRgb, owner); },
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
        bag.add(() => { if (handle.isOpen()) handle.close(); });
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
        bag.add(() => handle.close());
        return handle;
      },
      mapTool: (spec) => startMapTool(store, bag, info, spec),
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
      open: (dialog, payload) => { store.set(openDialogAtom, dialog, payload); },
      repaint: () => store.set(terrainRevisionAtom, store.get(terrainRevisionAtom) + 1),
    },

    menu: {
      add: (path, item) => {
        const key = nextContributionKey();
        store.set(pluginMenuItemsAtom, [...store.get(pluginMenuItemsAtom), { ...item, key, pluginId: info.id, path }]);
        return bag.add(() => store.set(pluginMenuItemsAtom, store.get(pluginMenuItemsAtom).filter((i) => i.key !== key)), "menu");
      },
    },

    contextMenu: {
      add: (surface, item) => {
        const key = nextContributionKey();
        store.set(pluginContextItemsAtom, [...store.get(pluginContextItemsAtom), { ...item, key, pluginId: info.id, surface }]);
        return bag.add(() => store.set(pluginContextItemsAtom, store.get(pluginContextItemsAtom).filter((i) => i.key !== key)), "contextMenu");
      },
    },

    hotkeys: {
      add: (combo, run) => {
        const key = nextContributionKey();
        store.set(pluginHotkeysAtom, [...store.get(pluginHotkeysAtom), { key, pluginId: info.id, combo: normalizeCombo(combo), run }]);
        return bag.add(() => store.set(pluginHotkeysAtom, store.get(pluginHotkeysAtom).filter((i) => i.key !== key)), "hotkeys");
      },
    },

    events: {
      on: (event: PluginEvent, listener) => {
        const atoms = EVENT_ATOMS[event];
        if (!atoms) throw new Error(`Unknown plugin event "${event}"`);
        const safe = () => { try { listener(); } catch (err) { console.error(`[${info.name}] event listener failed`, err); } };
        const unsubs = atoms.map((a) => store.sub(a, safe));
        return bag.add(() => { for (const u of unsubs) u(); }, "events");
      },
    },

    storage: {
      get: (key, fallback) => {
        try {
          const raw = pluginStorage()?.getItem(prefix + key) ?? memory.get(key) ?? null;
          return raw === null ? fallback : (JSON.parse(raw) as typeof fallback);
        } catch {
          return fallback;
        }
      },
      set: (key, value) => {
        const raw = JSON.stringify(value);
        try { pluginStorage()?.setItem(prefix + key, raw); } catch { /* quota or disabled */ }
        memory.set(key, raw);
      },
      remove: (key) => {
        try { pluginStorage()?.removeItem(prefix + key); } catch { /* disabled */ }
        memory.delete(key);
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
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
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

/** Load and activate a plugin; a no-op when it is already active or loading. */
export async function activatePlugin(store: Store, spec: string, deps: LoaderDeps = browserLoaderDeps()): Promise<void> {
  const map = activeMap(store);
  if (map.has(spec)) return;
  const token = ++activationSeq;
  const bag = new Contributions();
  const entry: Active = { token, bag };
  map.set(spec, entry);
  setRuntime(store, spec, { status: "loading", error: null });
  const stillWanted = () => map.get(spec) === entry;
  try {
    const { manifest, icon, module } = await loadPlugin(spec, deps);
    if (!stillWanted()) return;
    if (manifest.api !== undefined && manifest.api > PLUGIN_API_VERSION) {
      throw new Error(`The plugin needs plugin API ${manifest.api}; this editor provides ${PLUGIN_API_VERSION}.`);
    }
    const info: PluginInfo = { id: pluginIdOf(manifest), name: manifest.name, source: spec, version: manifest.version, icon };
    setRuntime(store, spec, { manifest, icon: icon ?? null });
    const api = createPluginApi(store, info, bag);
    const result = await resolveActivate(module)(api);
    if (!stillWanted()) { runDeactivate(result); bag.dispose(); return; }
    entry.deactivate = result;
    setRuntime(store, spec, { status: "active", error: null, contributions: { ...bag.counts } });
  } catch (err) {
    bag.dispose();
    if (stillWanted()) map.delete(spec);
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[plugins] ${spec}:`, err);
    setRuntime(store, spec, { status: "error", error: message });
  }
}

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

export async function reloadPlugin(store: Store, spec: string, deps?: LoaderDeps) {
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
 * The plugins to run: every default (unless the stored list says it is off), then the
 * ones the user added, in the order they were added. A default is a spec like any
 * other — the remote ones are fetched over the network on every start — so the only
 * thing being a default buys it is a place in the list and a Remove button it does not
 * get; see `defaults.ts`.
 */
export function effectiveInstalls(stored: readonly PluginInstall[], defaults: readonly string[] = defaultPluginSpecs()): PluginInstall[] {
  const out: PluginInstall[] = defaults.map((spec) => ({ spec, enabled: stored.find((p) => p.spec === spec)?.enabled ?? true }));
  for (const p of stored) if (!defaults.includes(p.spec)) out.push(p);
  return out;
}

/** Add, remove or toggle a plugin in the persisted list. */
export function setInstalled(store: Store, spec: string, patch: { enabled?: boolean; remove?: boolean }) {
  const stored = store.get(installedPluginsAtom);
  const others = stored.filter((p) => p.spec !== spec);
  if (patch.remove) { store.set(installedPluginsAtom, others); return; }
  const prev = stored.find((p) => p.spec === spec);
  const next: PluginInstall = { spec, enabled: patch.enabled ?? prev?.enabled ?? true };
  store.set(installedPluginsAtom, prev ? stored.map((p) => (p.spec === spec ? next : p)) : [...stored, next]);
}
