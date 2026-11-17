import { useAtom, useAtomValue } from "jotai";
import { PanelLeftClose, PanelRightClose } from "lucide-react";
import { activeLayerAtom, viewOnlyAtom } from "../../atoms/editorAtoms";
import { leftDockWidthAtom, panelsAtom, rightDockWidthAtom } from "../../atoms/uiAtoms";
import { useDockResize } from "../../hooks/useDockResize";
import { Button, Tip } from "../ui";
import { Guarded } from "../ui/ErrorBoundary";
import { LAYERS } from "../chrome/MenuBar";
import { t, translate } from "../../i18n";
import PalettePanel from "./PalettePanel";
import MinimapPanel from "./MinimapPanel";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";
import { DockedPluginPanels } from "./PluginPanels";

function PanelHead({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <span className="title">{title}</span>
      {right}
    </div>
  );
}

/** The right dock may take up to this share of the window: a plugin's panel there (a replay's) wants room. In the dock's own pixels. */
const rightDockMax = (zoom: number) => Math.max(420, Math.round((window.innerWidth * 0.45) / zoom));

export function LeftDock() {
  const [width, setWidth] = useAtom(leftDockWidthAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const layer = useAtomValue(activeLayerAtom);
  const { dragging, ...resize } = useDockResize("left", width, setWidth, 220, 480);
  return (
    // (`--dock-w`: at a larger interface size, styles/size.css rounds the width to a whole pixel of the page from it.)
    <aside className="dock left" style={{ width, "--dock-w": `${width}px` } as React.CSSProperties}>
      <div className="panel grow">
        <PanelHead
          title={<>{t("Palette")}{" "}<span className="faint">·</span> <span className="gold">{translate(LAYERS.find((l) => l.id === layer)?.label ?? "")}</span></>}
          right={<Tip label={t("Hide palette")}><Button icon onClick={() => setPanels({ ...panels, palette: false })}><PanelLeftClose size={13} /></Button></Tip>}
        />
        <Guarded surface="palette"><PalettePanel /></Guarded>
      </div>
      <div className={`dock-resizer ${dragging ? "dragging" : ""}`} {...resize} />
    </aside>
  );
}

export function RightDock() {
  const [width, setWidth] = useAtom(rightDockWidthAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const { dragging, ...resize } = useDockResize("right", width, setWidth, 200, rightDockMax);
  const viewOnly = useAtomValue(viewOnlyAtom) !== null;
  return (
    <aside className="dock right" style={{ width }}>
      <div className={`dock-resizer ${dragging ? "dragging" : ""}`} {...resize} />
      {/* The column of panels on its own, so that it can scroll at a larger interface size while the edge above stays whole (styles/size.css). */}
      <div className="dock-panels">
      {panels.minimap && (
        <div className="panel">
          <PanelHead title={t("Minimap")} right={<Tip label={t("Hide minimap")}><Button icon onClick={() => setPanels({ ...panels, minimap: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <Guarded surface="minimap"><MinimapPanel /></Guarded>
        </div>
      )}
      {/* View-only: every layer and overlay switch is in the View menu too, and the locks mean nothing. */}
      {panels.layers && !viewOnly && (
        <div className="panel">
          <PanelHead title={t("Layers")} right={<Tip label={t("Hide layers")}><Button icon onClick={() => setPanels({ ...panels, layers: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <Guarded surface="layers panel"><LayersPanel /></Guarded>
        </div>
      )}
      {/* A view-only map's fields take no input; the column is left to the panels that read it (a replay's). */}
      {panels.properties && !viewOnly && (
        <div className="panel grow">
          <PanelHead title={t("Properties")} right={<Tip label={t("Hide properties")}><Button icon onClick={() => setPanels({ ...panels, properties: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <div className="panel-body">
            <Guarded surface="properties panel"><PropertiesPanel /></Guarded>
          </div>
        </div>
      )}
      <Guarded surface="plugin panels"><DockedPluginPanels /></Guarded>
      </div>
    </aside>
  );
}
