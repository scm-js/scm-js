import type { ComponentType, ReactNode } from "react";
import { useAtom, useSetAtom } from "jotai";
import {
  ClipboardPaste,
  Copy,
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
import { activeLayerAtom, brushSizeAtom, viewFlagsAtom, zoomAtom, zoomToFitAtom, type EditorLayer } from "../../atoms/editorAtoms";
import { redoAtom, undoAtom } from "../../atoms/documentAtoms";
import { openDialogAtom, statusMessageAtom, type DialogId } from "../../atoms/uiAtoms";
import { useMapFileActions } from "../../hooks/useMapFileActions";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { Tip } from "../ui";
import { LAYERS, ZOOM_LEVELS } from "./MenuBar";

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
  const open = useSetAtom(openDialogAtom);
  const zoomToFit = useSetAtom(zoomToFitAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const { save } = useMapFileActions();
  const [undoLabel, undo] = useAtom(undoAtom);
  const [redoLabel, redo] = useAtom(redoAtom);
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [brush, setBrush] = useAtom(brushSizeAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);

  const dlg = (id: DialogId) => () => open(id);
  const clipTools = useClipboardTools();
  const zoomIn = () => setZoom(ZOOM_LEVELS.find((z) => z > zoom) ?? zoom);
  const zoomOut = () => setZoom([...ZOOM_LEVELS].reverse().find((z) => z < zoom) ?? zoom);

  return (
    <div className="toolbar" role="toolbar">
      <TB icon={FilePlus2} label="New Map" shortcut="Ctrl+N" onClick={dlg("newMap")} />
      <TB icon={FolderOpen} label="Open Map" shortcut="Ctrl+O" onClick={dlg("openMap")} />
      <TB icon={Save} label="Save Map" shortcut="Ctrl+S" onClick={() => { void save(); }} />
      <Sep />
      <TB icon={Undo2} label={undoLabel ? `Undo ${undoLabel}` : "Undo"} shortcut="Ctrl+Z" disabled={!undoLabel} onClick={() => { const l = undo(); if (l) setStatus(`Undid: ${l}`); }} />
      <TB icon={Redo2} label={redoLabel ? `Redo ${redoLabel}` : "Redo"} shortcut="Ctrl+Y" disabled={!redoLabel} onClick={() => { const l = redo(); if (l) setStatus(`Redid: ${l}`); }} />
      <Sep />
      <TB icon={Scissors} label="Cut" shortcut="Ctrl+X" onClick={() => { clipTools.cut(); }} />
      <TB icon={Copy} label="Copy" shortcut="Ctrl+C" onClick={() => { clipTools.copy(); }} />
      <TB icon={ClipboardPaste} label="Paste" shortcut="Ctrl+V" onClick={() => { clipTools.paste(); }} />
      <Sep />
      <div className="tb-group">
        <span className="lbl">Layer</span>
        <select className="select" value={layer} onChange={(e) => setLayer(e.target.value as EditorLayer)} aria-label="Active layer">
          {LAYERS.map((l) => (
            <option key={l.id} value={l.id}>{l.label}</option>
          ))}
        </select>
      </div>
      {(layer === "terrain" || layer === "fog") && (
        <div className="tb-group">
          <span className="lbl">Brush</span>
          <select className="select narrow" value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label="Brush size">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>{n}×{n}</option>
            ))}
          </select>
        </div>
      )}
      <Sep />
      <TB icon={Grid3x3} label="Toggle Grid" shortcut="Ctrl+G" active={flags.grid} onClick={() => setFlags({ ...flags, grid: !flags.grid })} />
      <TB icon={SquareDashed} label="Toggle Locations" active={flags.locations} onClick={() => setFlags({ ...flags, locations: !flags.locations })} />
      <TB icon={CloudFog} label="Toggle Fog of War" active={flags.fog} onClick={() => setFlags({ ...flags, fog: !flags.fog })} />
      <Sep />
      <TB icon={FlipHorizontal2} label="Symmetry…" onClick={dlg("symmetry")} />
      <TB icon={Search} label="Find…" shortcut="Ctrl+F" onClick={dlg("find")} />
      <Sep />
      <TB icon={ZoomOut} label="Zoom Out" shortcut="Ctrl+−" onClick={zoomOut} disabled={zoom <= ZOOM_LEVELS[0]} />
      <span className="zoom-readout">{Math.round(zoom * 100)}%</span>
      <TB icon={ZoomIn} label="Zoom In" shortcut="Ctrl++" onClick={zoomIn} disabled={zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} />
      <TB icon={Maximize} label="Zoom to Fit" shortcut="Ctrl+Shift+0" onClick={() => { zoomToFit(); }} />
      <span className="tb-spacer" />
      <TB icon={Users} label="Player Settings…" onClick={dlg("playerSettings")} text="Players" />
      <TB icon={Zap} label="Trigger Editor…" shortcut="Ctrl+T" onClick={dlg("triggerEditor")} text="Triggers" accent />
      <Sep />
      <TB icon={Play} label="Test Map — write the map where StarCraft lists it" shortcut="Ctrl+F5" onClick={() => open("testMap", { run: true })} text="Test" />
    </div>
  );
}
