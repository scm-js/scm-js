import type { ComponentType } from "react";
import { useAtomValue } from "jotai";
import { dialogStackAtom, type DialogEntry, type DialogId } from "../../atoms/uiAtoms";
import { ConfirmCloseDialog, ExportImageDialog, NewMapDialog, OpenMapDialog, SaveMapDialog } from "./FileDialogs";
import { GridSettingsDialog, MapPropertiesDialog, MapRevisionDialog, ResizeMapDialog, SymmetryDialog } from "./MapDialogs";
import { ForceSettingsDialog, PlayerColorsDialog, PlayerSettingsDialog } from "./PlayerDialogs";
import { TechSettingsDialog, UnitSettingsDialog, UpgradeSettingsDialog } from "./DataDialogs";
import { LocationListDialog, SoundEditorDialog, StringEditorDialog, SwitchesDialog } from "./AssetDialogs";
import { LocationPropertiesDialog, SpritePropertiesDialog, UnitPropertiesDialog } from "./ObjectDialogs";
import { MissionBriefingDialog, TextTriggerEditorDialog, TriggerEditorDialog } from "./TriggerDialogs";
import { ScriptEditorDialog } from "./ScriptEditorDialog";
import { CuwpDialog } from "./CuwpDialog";
import { AutoStartsDialog, ReplaceTerrainDialog } from "./TerrainDialogs";
import { TestMapDialog } from "./TestMapDialog";
import { ExportStringsDialog, ExportTriggersDialog, ImportStringsDialog, ImportTriggersDialog } from "./ExchangeDialogs";
import { StatisticsDialog } from "./StatisticsDialog";
import { AboutDialog, FindDialog, PreferencesDialog, ShortcutsDialog, ValidateMapDialog } from "./MiscDialogs";
import { ConfirmPluginDialog, PluginDialog, PluginsDialog } from "./PluginDialogs";
import { GameDataDialog } from "./GameDataDialog";

export interface DialogProps {
  entry: DialogEntry;
}

const REGISTRY: Record<DialogId, ComponentType<DialogProps>> = {
  newMap: NewMapDialog,
  openMap: OpenMapDialog,
  saveAs: SaveMapDialog,
  exportImage: ExportImageDialog,
  confirmClose: ConfirmCloseDialog,
  mapProperties: MapPropertiesDialog,
  resizeMap: ResizeMapDialog,
  mapRevision: MapRevisionDialog,
  gridSettings: GridSettingsDialog,
  symmetry: SymmetryDialog,
  playerSettings: PlayerSettingsDialog,
  forceSettings: ForceSettingsDialog,
  playerColors: PlayerColorsDialog,
  unitSettings: UnitSettingsDialog,
  upgradeSettings: UpgradeSettingsDialog,
  techSettings: TechSettingsDialog,
  stringEditor: StringEditorDialog,
  soundEditor: SoundEditorDialog,
  switches: SwitchesDialog,
  locationList: LocationListDialog,
  unitProperties: UnitPropertiesDialog,
  locationProperties: LocationPropertiesDialog,
  spriteProperties: SpritePropertiesDialog,
  triggerEditor: TriggerEditorDialog,
  textTriggerEditor: TextTriggerEditorDialog,
  scriptEditor: ScriptEditorDialog,
  missionBriefing: MissionBriefingDialog,
  cuwpEditor: CuwpDialog,
  replaceTerrain: ReplaceTerrainDialog,
  autoStarts: AutoStartsDialog,
  testMap: TestMapDialog,
  preferences: PreferencesDialog,
  shortcuts: ShortcutsDialog,
  validateMap: ValidateMapDialog,
  statistics: StatisticsDialog,
  importTriggers: ImportTriggersDialog,
  exportTriggers: ExportTriggersDialog,
  importStrings: ImportStringsDialog,
  exportStrings: ExportStringsDialog,
  find: FindDialog,
  about: AboutDialog,
  plugins: PluginsDialog,
  confirmPlugin: ConfirmPluginDialog,
  pluginDialog: PluginDialog,
  gameData: GameDataDialog,
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
        return <Cmp key={entry.key} entry={entry} />;
      })}
    </>
  );
}
