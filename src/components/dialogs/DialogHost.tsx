import type { ComponentType } from "react";
import { useAtomValue } from "jotai";
import { dialogStackAtom, type DialogEntry, type DialogId } from "../../atoms/uiAtoms";
import { ConfirmCloseDialog, ExportImageDialog, NewMapDialog, NotImplementedDialog, OpenMapDialog, SaveAsDialog } from "./FileDialogs";
import { GridSettingsDialog, MapPropertiesDialog, MapRevisionDialog, ResizeMapDialog, SymmetryDialog } from "./MapDialogs";
import { ForceSettingsDialog, PlayerColorsDialog, PlayerSettingsDialog } from "./PlayerDialogs";
import { TechSettingsDialog, UnitSettingsDialog, UpgradeSettingsDialog } from "./DataDialogs";
import { LocationListDialog, SoundEditorDialog, StringEditorDialog, SwitchesDialog } from "./AssetDialogs";
import { LocationPropertiesDialog, SpritePropertiesDialog, UnitPropertiesDialog } from "./ObjectDialogs";
import { MissionBriefingDialog, TextTriggerEditorDialog, TriggerEditorDialog } from "./TriggerDialogs";
import { ScriptEditorDialog } from "./ScriptEditorDialog";
import { ExportStringsDialog, ExportTriggersDialog, ImportStringsDialog, ImportTriggersDialog } from "./ExchangeDialogs";
import { StatisticsDialog } from "./StatisticsDialog";
import { AboutDialog, FindDialog, PreferencesDialog, ShortcutsDialog, ValidateMapDialog } from "./MiscDialogs";

export interface DialogProps {
  entry: DialogEntry;
}

const REGISTRY: Record<DialogId, ComponentType<DialogProps>> = {
  newMap: NewMapDialog,
  openMap: OpenMapDialog,
  saveAs: SaveAsDialog,
  exportImage: ExportImageDialog,
  confirmClose: ConfirmCloseDialog,
  notImplemented: NotImplementedDialog,
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
};

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
