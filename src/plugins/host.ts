/**
 * The plugin host: builds a `PluginApi` for one plugin over the editor's Jotai store,
 * runs `activate`, and takes every contribution back on deactivation.
 *
 * Nothing here is React. Reads go through `store.get`, writes through the same atoms
 * the hooks use, and an edit becomes one `HistoryEntry` handed to `commitTerrainAtom`
 * — the path a brush stroke takes — so a plugin edit undoes, marks sections dirty,
 * lifts stranded doodads and units, and repaints exactly like the built-in tools.
 */
export { Contributions, DEACTIVATED_NOTE, assertWritable, type Store } from "./host/shared";
export { runTransaction } from "./host/transaction";
export { runUpdate } from "./host/update";
export { sectionsApi } from "./host/sections";
export { addBuildStep, addBeforeBuild } from "./host/document";
export { triggersApi } from "./host/triggers";
export { queryApi } from "./host/query";
export { viewApi, FLASH_MS, flashOnMap, sweepFlashes } from "./host/view";
export { pickOnMap, startMapTool, registerOverlay, addStatusItem, addMapButton } from "./host/surfaces";
export { addMapView } from "./host/mapView";
export { dataApi, gameDataApi } from "./host/data";
export { qualifyCommand, runCommand } from "./host/commands";
export { documentEvent, commitEvent } from "./host/events";
export { settingsApi } from "./host/settings";
export { pickFolder } from "./host/ui";
export { createPluginApi } from "./host/pluginApi";
export { builtinSpec, effectiveInstalls } from "./host/installList";
export { resolveActivate, browserLoaderDeps, forgetSnapshot, activatePlugin, checkApiVersion, describePlugin, rememberManifest, forgetDescription, deactivatePlugin, reloadPlugin, isPluginActive, activePluginSpecs } from "./host/lifecycle";
export { checkForUpdate, inspectPlugin, installPlugin, manifestLookup, enableWithRequirements, orderedInstalls, setInstalled, type UpdateCheck, type RequirementPreview } from "./host/installs";
