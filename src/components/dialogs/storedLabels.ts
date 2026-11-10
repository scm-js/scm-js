/**
 * What Preferences ▸ Storage calls each key the editor keeps (shown through `translate`), in
 * a module of its own so `tests/storage.test.ts` can check that every key an atom owns
 * (`ownedStoredKeys`) has one: a key without a label is listed by its raw name.
 */
import { msg } from "../../i18n";

export const STORED_LABELS: Record<string, string> = {
  "scmjs.prefs": msg("Preferences"),
  "scmjs.grid": msg("Grid look"),
  "scmjs.gridSize": msg("Grid spacing"),
  "scmjs.locationSnap": msg("Location snap"),
  "scmjs.placement": msg("Unit placement options"),
  "scmjs.doodadPlacement": msg("Doodad placement options"),
  "scmjs.doodadThumbSize": msg("Doodad preview size"),
  "scmjs.symmetry": msg("Symmetry options"),
  "scmjs.panels": msg("Panels shown"),
  "scmjs.docks": msg("Panel widths"),
  "scmjs.console": msg("Debug console shown"),
  "scmjs.consoleHeight": msg("Debug console height"),
  "scmjs.recents": msg("Recent files"),
  "scmjs.plugins": msg("Installed plugins"),
  "scmjs.plugin-code": msg("Plugin code copies"),
  "scmjs.plugin-manifests": msg("Plugin manifests"),
  "scmjs.plugin-registries": msg("Plugin sources"),
  "scmjs.plugin-registry": msg("Browse Plugins cache"),
  "scmjs.plugin-updates": msg("Last plugin update check"),
  "scmjs.whatsNew": msg("What's New last seen"),
  "scmjs.gameData": msg("Data set in use"),
  "scmjs.dataSetRaces": msg("Races named for data sets"),
  // Written by the hosted site's visit count (the front-door worker's script), not the editor.
  "scmjs.visits": msg("Visit count dates"),
  // Preferences ▸ General ▸ Privacy turned off, for the site's script to read.
  "scmjs.counting": msg("Counting turned off"),
};
