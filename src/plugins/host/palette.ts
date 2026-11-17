/**
 * `api.selection` and `api.palette`: what is selected and what the palettes would place.
 */
import { activeDoodadAtom, activeLayerAtom, activeSpriteAtom, activeSpriteKindAtom, activeUnitAtom, activeUnitSpriteAtom, clipSelectionAtom, doodadPlacementAtom, fogModeAtom, fogPlayersAtom, fogViewPlayerAtom, locationSnapAtom, lockedLayersAtom, placementOptionsAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, spritePlaceOptionsAtom, unitOwnerAtom, type EditorLayer } from "../../atoms/editorAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { peekTileset, type LoadedTileset } from "../../formats/tileset/load";
import { doodadLabel, type DoodadDef } from "../../formats/tileset/doodads";
import { peekUnitAssets } from "../../formats/units/load";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { currentAssetSource } from "../../gamedata/source";
import { displayColorHex } from "../../data/players";
import { dataSetUnitGroups, starEditUnitGroups, unitName } from "../../data/units";
import { spriteCatalogue, spriteName } from "../../data/sprites";
import { unitGeometry } from "../../editor/units";
import type { DoodadInfo, PaletteApi, SelectionApi } from "../api";
import { soundAxes } from "../../editor/stretch";
import { doodadTwin } from "../../editor/doodadTwin";
import type { Store } from "./shared";

function doodadInfoOf(def: DoodadDef): DoodadInfo {
  return { id: def.id, name: doodadLabel(def), category: def.category, width: def.width, height: def.height, ramp: def.ramp, required: [...def.required] };
}

/** `api.selection`: what is selected on each layer, and the marked area. */
export function selectionApi(store: Store): SelectionApi {
  return {
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
  };
}

/** `api.palette`: the object palettes' picks and the options beside them. */
export function paletteApi(store: Store): PaletteApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  return {
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
    // The types a data set has past the game's 228 follow, their groups named for the data set.
    unitGroups: () => [
      ...starEditUnitGroups().map((g) => ({ ...g, units: [...g.units] })),
      ...dataSetUnitGroups().map((g) => ({ ...g, label: `${(store.get(gameDataSourceAtom) ?? currentAssetSource())?.profile.name ?? ""} · ${g.label}`, units: [...g.units] })),
    ],
    unitName,
    unitSize: (unitId) => {
      const g = unitGeometry(peekUnitAssets()?.units ?? null, unitId);
      return { width: g.placeW, height: g.placeH, building: g.building, flyer: g.flyer };
    },
    spriteGroups: () => { const a = peekUnitAssets(); return a ? spriteCatalogue(a).groups.map((g) => ({ ...g, ids: [...g.ids] })) : []; },
    spriteName: (kind, id) => spriteName(peekUnitAssets(), kind, id),
    doodadCategories: () => (loaded()?.doodads.categories ?? []).map((c) => ({ name: c.name, doodads: c.doodads.map(doodadInfoOf) })),
    doodadInfo: (id) => { const def = loaded()?.doodads.byId.get(id); return def ? doodadInfoOf(def) : null; },
    stretchAxes: (id) => { const l = loaded(), def = l?.doodads.byId.get(id); return l && def ? soundAxes(l.tileset, def) : []; },
    doodadTwin: (id) => { const l = loaded(), def = l?.doodads.byId.get(id); return l && def ? doodadTwin(l.tileset, l.doodads, def)?.id ?? null : null; },
  };
}
