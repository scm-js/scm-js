import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from "react";
import { useAtomValue } from "jotai";
import { dialogStackAtom, type DialogEntry, type DialogId } from "../../atoms/uiAtoms";

export interface DialogProps {
  entry: DialogEntry;
}

type Dialog = ComponentType<DialogProps>;

/**
 * Every dialog is code-split: the forty-odd dialog modules (Radix, Monaco's host, the
 * settings tables, the plugin browser) used to be parsed in the main chunk before the first
 * paint, and most sessions open two or three of them. One `import()` per module — dialogs
 * that share a file share a chunk — and the first open of each fetches it (local on the
 * desktop, one small request in a browser); `Suspense` below shows nothing in the meantime.
 */
function from<M>(load: () => Promise<M>, pick: (m: M) => Dialog): LazyExoticComponent<Dialog> {
  return lazy(() => load().then((m) => ({ default: pick(m) })));
}

const file = () => import("./FileDialogs");
const map = () => import("./MapDialogs");
const player = () => import("./PlayerDialogs");
const data = () => import("./DataDialogs");
const asset = () => import("./AssetDialogs");
const object = () => import("./ObjectDialogs");
const trigger = () => import("./TriggerDialogs");
const terrain = () => import("./TerrainDialogs");
const exchange = () => import("./ExchangeDialogs");
const misc = () => import("./MiscDialogs");
const plugin = () => import("./PluginDialogs");

const REGISTRY: Record<DialogId, LazyExoticComponent<Dialog>> = {
  newMap: from(file, (m) => m.NewMapDialog),
  openMap: from(file, (m) => m.OpenMapDialog),
  saveAs: from(file, (m) => m.SaveMapDialog),
  exportImage: from(file, (m) => m.ExportImageDialog),
  confirmClose: from(file, (m) => m.ConfirmCloseDialog),
  mapProperties: from(map, (m) => m.MapPropertiesDialog),
  resizeMap: from(map, (m) => m.ResizeMapDialog),
  mapRevision: from(map, (m) => m.MapRevisionDialog),
  gridSettings: from(map, (m) => m.GridSettingsDialog),
  symmetry: from(map, (m) => m.SymmetryDialog),
  playerSettings: from(player, (m) => m.PlayerSettingsDialog),
  forceSettings: from(player, (m) => m.ForceSettingsDialog),
  playerColors: from(player, (m) => m.PlayerColorsDialog),
  unitSettings: from(data, (m) => m.UnitSettingsDialog),
  upgradeSettings: from(data, (m) => m.UpgradeSettingsDialog),
  techSettings: from(data, (m) => m.TechSettingsDialog),
  stringEditor: from(asset, (m) => m.StringEditorDialog),
  soundEditor: from(asset, (m) => m.SoundEditorDialog),
  switches: from(asset, (m) => m.SwitchesDialog),
  locationList: from(asset, (m) => m.LocationListDialog),
  unitProperties: from(object, (m) => m.UnitPropertiesDialog),
  locationProperties: from(object, (m) => m.LocationPropertiesDialog),
  spriteProperties: from(object, (m) => m.SpritePropertiesDialog),
  triggerEditor: from(trigger, (m) => m.TriggerEditorDialog),
  textTriggerEditor: from(trigger, (m) => m.TextTriggerEditorDialog),
  missionBriefing: from(trigger, (m) => m.MissionBriefingDialog),
  cuwpEditor: from(() => import("./CuwpDialog"), (m) => m.CuwpDialog),
  replaceTerrain: from(terrain, (m) => m.ReplaceTerrainDialog),
  autoStarts: from(terrain, (m) => m.AutoStartsDialog),
  testMap: from(() => import("./TestMapDialog"), (m) => m.TestMapDialog),
  preferences: from(misc, (m) => m.PreferencesDialog),
  shortcuts: from(misc, (m) => m.ShortcutsDialog),
  validateMap: from(misc, (m) => m.ValidateMapDialog),
  statistics: from(() => import("./StatisticsDialog"), (m) => m.StatisticsDialog),
  importTriggers: from(exchange, (m) => m.ImportTriggersDialog),
  exportTriggers: from(exchange, (m) => m.ExportTriggersDialog),
  importStrings: from(exchange, (m) => m.ImportStringsDialog),
  exportStrings: from(exchange, (m) => m.ExportStringsDialog),
  find: from(misc, (m) => m.FindDialog),
  about: from(misc, (m) => m.AboutDialog),
  plugins: from(plugin, (m) => m.PluginsDialog),
  confirmPlugin: from(plugin, (m) => m.ConfirmPluginDialog),
  pluginDialog: from(plugin, (m) => m.PluginDialog),
  gameData: from(() => import("./GameDataDialog"), (m) => m.GameDataDialog),
};

/** Every dialog id the host can show — what a `?dialog=` deep link is checked against. */
export const DIALOG_IDS: ReadonlySet<string> = new Set(Object.keys(REGISTRY));

/** Renders every open dialog (stacked in order). */
export default function DialogHost() {
  const stack = useAtomValue(dialogStackAtom);
  return (
    <>
      {stack.map((entry) => {
        const Cmp = REGISTRY[entry.id];
        // One boundary per dialog, so a chunk still loading never hides the dialogs under it.
        return (
          <Suspense key={entry.key} fallback={null}>
            <Cmp entry={entry} />
          </Suspense>
        );
      })}
    </>
  );
}
