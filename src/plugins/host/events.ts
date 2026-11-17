/**
 * `api.events`: which atoms each event follows, and the payloads of `"document"` and `"commit"`.
 */
import { activeDoodadAtom, activeLayerAtom, activeSpriteAtom, activeSpriteKindAtom, activeTerrainAtom, activeTileAtom, activeUnitAtom, activeUnitSpriteAtom, brushSizeAtom, clipboardAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, clipSelectionAtom, doodadPlacementAtom, fogModeAtom, fogPlayersAtom, fogViewPlayerAtom, gridSizeAtom, locationSnapAtom, lockedLayersAtom, mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, placementOptionsAtom, rectVariationAtom, saveOptionsAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, spritePlaceOptionsAtom, symmetryAtom, terrainModeAtom, unitOwnerAtom, viewFlagsAtom, viewportRectAtom, zoomAtom } from "../../atoms/editorAtoms";
import { activeDocumentIdAtom, archiveExtrasAtom, commitNoticeAtom, documentChangeAtom, doodadsRevisionAtom, locationsRevisionAtom, objectEditRevisionAtom, recentFilesAtom, scenarioAtom, settingsRevisionAtom, terrainRevisionAtom, triggersRevisionAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { dialogStackAtom } from "../../atoms/uiAtoms";
import { tileBlockAtom } from "../../atoms/tileBlockAtoms";
import { learnedPiecesAtom, providedPiecesAtom } from "../../atoms/pieceAtoms";
import { gridLookAtom, preferencesAtom, localeAtom } from "../../atoms/preferencesAtoms";
import { mapPickAtom, mapToolAtom, pluginCommandsAtom, pluginServicesAtom, pluginOverlaysAtom } from "../../atoms/pluginAtoms";
import { logError } from "../../editor/log";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import type { DocumentEvent, PluginEvent, CommitEvent, PluginInfo, EventsApi } from "../api";
import type { Store, Contributions } from "./shared";

const EVENT_ATOMS = {
  document: [scenarioAtom],
  commit: [commitNoticeAtom],
  language: [localeAtom],
  // Every committed edit, as documented: one of the two moves per commit, never both.
  terrain: [terrainRevisionAtom, objectEditRevisionAtom],
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
    activeUnitSpriteAtom, spritePlaceOptionsAtom, activeDoodadAtom, fogPlayersAtom, fogModeAtom, tileBlockAtom,
  ],
  options: [symmetryAtom, placementOptionsAtom, doodadPlacementAtom, locationSnapAtom, fogViewPlayerAtom, clipPartsAtom, clipPasteModeAtom, clipPastingAtom, lockedLayersAtom, gridLookAtom, preferencesAtom],
  file: [mapFilePathAtom, mapFileHandleAtom, saveOptionsAtom, archiveExtrasAtom, recentFilesAtom],
  commands: [pluginCommandsAtom],
  services: [pluginServicesAtom],
  dialogs: [dialogStackAtom],
  gameData: [gameDataSourceAtom, gameDataRevisionAtom],
  pieces: [learnedPiecesAtom, providedPiecesAtom],
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
  return { reason, fileName: scenario ? store.get(mapFilePathAtom) : null, id: scenario ? store.get(activeDocumentIdAtom) : null };
}

/** The `"commit"` event's payload: the last notice, with the map it happened to. */
export function commitEvent(store: Store): CommitEvent | null {
  const notice = store.get(commitNoticeAtom);
  if (!notice) return null;
  return {
    id: store.get(activeDocumentIdAtom), reason: notice.reason, label: notice.label,
    area: notice.area ? { ...notice.area } : null, parts: { ...notice.parts },
  };
}

/** `api.events`: notifications, in activation order. */
export function eventsApi(store: Store, info: PluginInfo, bag: Contributions): EventsApi {
  return {
    on: (event: PluginEvent, listener: ((payload: DocumentEvent) => void) | ((payload: CommitEvent) => void)) => {
      const atoms = EVENT_ATOMS[event];
      if (!atoms) throw new Error(`Unknown plugin event "${event}"`);
      // "document" and "commit" carry a payload; the other listeners are declared with none and ignore it.
      const payload = event === "commit" ? () => commitEvent(store) : () => documentEvent(store);
      const safe = () => {
        const value = payload();
        if (value === null) return;
        try { (listener as (payload: unknown) => void)(value); } catch (err) { logError(info.name, "An event listener failed", err); }
      };
      const unsubs = atoms.map((a) => store.sub(a, safe));
      return bag.add(() => { for (const u of unsubs) u(); }, "events");
    },
  };
}
