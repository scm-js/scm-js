import { useAtom, useAtomValue } from "jotai";
import { PanelLeftClose, PanelRightClose } from "lucide-react";
import { activeLayerAtom } from "../../atoms/editorAtoms";
import { leftDockWidthAtom, panelsAtom, rightDockWidthAtom } from "../../atoms/uiAtoms";
import { useDockResize } from "../../hooks/useDockResize";
import { Button, Tip } from "../ui";
import { LAYERS } from "../chrome/MenuBar";
import PalettePanel from "./PalettePanel";
import MinimapPanel from "./MinimapPanel";
import LayersPanel from "./LayersPanel";
import PropertiesPanel from "./PropertiesPanel";

function PanelHead({ title, right }: { title: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="panel-head">
      <span className="title">{title}</span>
      {right}
    </div>
  );
}

export function LeftDock() {
  const [width, setWidth] = useAtom(leftDockWidthAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const layer = useAtomValue(activeLayerAtom);
  const { dragging, onPointerDown } = useDockResize("left", width, setWidth, 220, 480);
  return (
    <aside className="dock left" style={{ width }}>
      <div className="panel grow">
        <PanelHead
          title={<>Palette <span className="faint">·</span> <span className="gold">{LAYERS.find((l) => l.id === layer)?.label}</span></>}
          right={<Tip label="Hide palette"><Button icon onClick={() => setPanels({ ...panels, palette: false })}><PanelLeftClose size={13} /></Button></Tip>}
        />
        <PalettePanel />
      </div>
      <div className={`dock-resizer ${dragging ? "dragging" : ""}`} onPointerDown={onPointerDown} />
    </aside>
  );
}

export function RightDock() {
  const [width, setWidth] = useAtom(rightDockWidthAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const { dragging, onPointerDown } = useDockResize("right", width, setWidth, 200, 420);
  return (
    <aside className="dock right" style={{ width }}>
      <div className={`dock-resizer ${dragging ? "dragging" : ""}`} onPointerDown={onPointerDown} />
      {panels.minimap && (
        <div className="panel">
          <PanelHead title="Minimap" right={<Tip label="Hide minimap"><Button icon onClick={() => setPanels({ ...panels, minimap: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <MinimapPanel />
        </div>
      )}
      {panels.layers && (
        <div className="panel">
          <PanelHead title="Layers" right={<Tip label="Hide layers"><Button icon onClick={() => setPanels({ ...panels, layers: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <LayersPanel />
        </div>
      )}
      {panels.properties && (
        <div className="panel grow">
          <PanelHead title="Properties" right={<Tip label="Hide properties"><Button icon onClick={() => setPanels({ ...panels, properties: false })}><PanelRightClose size={13} /></Button></Tip>} />
          <div className="panel-body">
            <PropertiesPanel />
          </div>
        </div>
      )}
    </aside>
  );
}
