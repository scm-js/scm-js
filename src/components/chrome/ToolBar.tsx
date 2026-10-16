import { Fragment, type ComponentType, type ReactNode } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import {
  ClipboardPaste,
  Copy,
  FilePen,
  FilePlus2,
  FlipHorizontal2,
  FolderOpen,
  Grid3x3,
  Maximize,
  Play,
  Redo2,
  Save,
  Scissors,
  Search,
  SquareDashed,
  Undo2,
  Users,
  Zap,
  ZoomIn,
  ZoomOut,
  CloudFog,
} from "lucide-react";
import { activeLayerAtom, brushSizeAtom, viewFlagsAtom, type EditorLayer } from "../../atoms/editorAtoms";
import { chromeModeAtom, flagOffered, flagShown, mapInFront, toggleFlagAtom } from "../../atoms/viewModeAtoms";
import { shownZoomAtom, zoomToAtom } from "../../atoms/zoomAtoms";
import { redoAtom, undoAtom } from "../../atoms/documentAtoms";
import { openDialogAtom, statusMessageAtom, type DialogId } from "../../atoms/uiAtoms";
import { editCopyIn, useMapFileActions } from "../../hooks/useMapFileActions";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { Tip } from "../ui";
import { hotkeysAtom } from "../../atoms/preferencesAtoms";
import { shortcutOf } from "../../editor/commands";
import { LAYERS, ZOOM_LEVELS } from "./MenuBar";
import { translate } from "../../i18n";
import { useT } from "../../i18n/react";

function TB({ icon: Icon, label, shortcut, onClick, active, disabled, accent, text }: { icon: ComponentType<{ size?: number }>; label: string; shortcut?: string; onClick?: () => void; active?: boolean; disabled?: boolean; accent?: boolean; text?: ReactNode }) {
  return (
    <Tip label={label} shortcut={shortcut}>
      <button className={`tb-btn ${active ? "is-active" : ""} ${accent ? "accent" : ""}`} onClick={onClick} disabled={disabled} aria-label={label}>
        <Icon size={16} />
        {text && <span className="lbl">{text}</span>}
      </button>
    </Tip>
  );
}

const Sep = () => <span className="tb-sep" />;

export default function ToolBar() {
  const t = useT();
  const open = useSetAtom(openDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const { save } = useMapFileActions();
  const [undoLabel, undo] = useAtom(undoAtom);
  const [redoLabel, redo] = useAtom(redoAtom);
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [brush, setBrush] = useAtom(brushSizeAtom);
  const flags = useAtomValue(viewFlagsAtom);
  const toggle = useSetAtom(toggleFlagAtom);
  const zoom = useAtomValue(shownZoomAtom);
  const zoomTo = useSetAtom(zoomToAtom);
  const hotkeys = useAtomValue(hotkeysAtom);
  const key = (command: string) => shortcutOf(hotkeys, command);
  const store = useStore();

  const dlg = (id: DialogId) => () => open(id);
  // A map open to look at only has nothing to save, undo or edit: those buttons are left out, and
  // Edit a Copy is the way to. A plugin's view in the map's place (a replay's game) leaves out the
  // map's own layers, clipboard, find and brush too, and keeps the toggles it shows (`viewModeAtoms`).
  const mode = useAtomValue(chromeModeAtom);
  const { viewOnly } = mode;
  const onMap = mapInFront(mode);
  const clipTools = useClipboardTools();
  const flagButton = (k: "grid" | "locations" | "fog", icon: ComponentType<{ size?: number }>, label: string, shortcut?: string) =>
    flagOffered(mode, k) ? <TB key={k} icon={icon} label={label} shortcut={shortcut} active={flagShown(mode, flags, k)} onClick={() => toggle(k)} /> : null;

  // Groups between separators; a group left empty takes its separator with it.
  const groups: ReactNode[][] = [
    [
      <TB key="new" icon={FilePlus2} label={t("New Map")} shortcut={key("file.new")} onClick={dlg("newMap")} />,
      <TB key="open" icon={FolderOpen} label={t("Open Map")} shortcut={key("file.open")} onClick={dlg("openMap")} />,
      viewOnly
        ? <TB key="copy" icon={FilePen} label={t("Edit a Copy: open this map as a new one you can change and save")} onClick={() => { editCopyIn(store); }} text={t("Edit a Copy")} />
        : <TB key="save" icon={Save} label={t("Save Map")} shortcut={key("file.save")} onClick={() => { void save(); }} />,
    ],
    viewOnly ? [] : [
      <TB key="undo" icon={Undo2} label={undoLabel ? t("Undo {what}", { what: undoLabel }) : t("Undo")} shortcut={key("edit.undo")} disabled={!undoLabel} onClick={() => { const l = undo(); if (l) setStatus(t("Undid: {what}", { what: l })); }} />,
      <TB key="redo" icon={Redo2} label={redoLabel ? t("Redo {what}", { what: redoLabel }) : t("Redo")} shortcut={key("edit.redo")} disabled={!redoLabel} onClick={() => { const l = redo(); if (l) setStatus(t("Redid: {what}", { what: l })); }} />,
    ],
    !onMap ? [] : [
      viewOnly ? null : <TB key="cut" icon={Scissors} label={t("Cut")} shortcut={key("edit.cut")} onClick={() => { clipTools.cut(); }} />,
      <TB key="copy" icon={Copy} label={t("Copy")} shortcut={key("edit.copy")} onClick={() => { clipTools.copy(); }} />,
      viewOnly ? null : <TB key="paste" icon={ClipboardPaste} label={t("Paste")} shortcut={key("edit.paste")} onClick={() => { clipTools.paste(); }} />,
    ],
    !onMap ? [] : [
      <div key="layer" className="tb-group">
        <span className="lbl">{t("Layer")}</span>
        <select className="select" value={layer} onChange={(e) => setLayer(e.target.value as EditorLayer)} aria-label={t("Active layer")}>
          {LAYERS.map((l) => (
            <option key={l.id} value={l.id}>{translate(l.label)}</option>
          ))}
        </select>
      </div>,
      !viewOnly && (layer === "terrain" || layer === "fog") ? (
        <div key="brush" className="tb-group">
          <span className="lbl">{t("Brush")}</span>
          <select className="select narrow" value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label={t("Brush size")}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>{n}×{n}</option>
            ))}
          </select>
        </div>
      ) : null,
    ],
    [
      flagButton("grid", Grid3x3, t("Toggle Grid"), key("view.grid")),
      flagButton("locations", SquareDashed, t("Toggle Locations")),
      flagButton("fog", CloudFog, t("Toggle Fog of War")),
    ],
    !onMap ? [] : [
      viewOnly ? null : <TB key="symmetry" icon={FlipHorizontal2} label={t("Symmetry…")} onClick={dlg("symmetry")} />,
      <TB key="find" icon={Search} label={t("Find…")} shortcut={key("edit.find")} onClick={dlg("find")} />,
    ],
    [
      <TB key="out" icon={ZoomOut} label={t("Zoom Out")} shortcut={key("view.zoomOut")} onClick={() => zoomTo("out")} disabled={zoom <= ZOOM_LEVELS[0]} />,
      <span key="readout" className="zoom-readout">{Math.round(zoom * 100)}%</span>,
      <TB key="in" icon={ZoomIn} label={t("Zoom In")} shortcut={key("view.zoomIn")} onClick={() => zoomTo("in")} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} />,
      <TB key="fit" icon={Maximize} label={t("Zoom to Fit")} shortcut={key("view.zoomFit")} onClick={() => zoomTo("fit")} />,
    ],
  ];
  const shown = groups.map((g) => g.filter(Boolean)).filter((g) => g.length > 0);

  return (
    <div className="toolbar" role="toolbar">
      {shown.map((g, i) => (
        <Fragment key={i}>
          {i > 0 && <Sep />}
          {g}
        </Fragment>
      ))}
      <span className="tb-spacer" />
      {!viewOnly && (
        <>
          <TB icon={Users} label={t("Player Settings…")} onClick={dlg("playerSettings")} text={t("Players")} />
          <TB icon={Zap} label={t("Trigger Editor…")} shortcut={key("tools.triggers")} onClick={dlg("triggerEditor")} text={t("Triggers")} accent />
          <Sep />
        </>
      )}
      <TB icon={Play} label={t("Test Map — write the map where StarCraft lists it")} shortcut={key("tools.testMap")} onClick={() => open("testMap", { run: true })} text={t("Test")} />
    </div>
  );
}
