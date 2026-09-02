import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { activeLayerAtom, viewFlagsAtom, type EditorLayer, type ViewFlags } from "../../atoms/editorAtoms";
import { pluginOverlaysAtom, setOverlayVisibleAtom } from "../../atoms/pluginAtoms";
import { PluginIconView } from "../dialogs/PluginDialogs";
import { RAIL_ICON } from "./PalettePanel";

const ROWS: { id: EditorLayer; label: string; flag?: keyof ViewFlags }[] = [
  { id: "terrain", label: "Terrain" },
  { id: "doodads", label: "Doodads", flag: "doodads" },
  { id: "units", label: "Units", flag: "units" },
  { id: "sprites", label: "Sprites", flag: "sprites" },
  { id: "locations", label: "Locations", flag: "locations" },
  { id: "fog", label: "Fog of War", flag: "fog" },
];

export default function LayersPanel() {
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  // Plugin overlays (`api.ui.overlay`): a picture over the map with an eye of its own, not a layer to edit on.
  const overlays = useAtomValue(pluginOverlaysAtom);
  const setOverlayVisible = useSetAtom(setOverlayVisibleAtom);

  return (
    <div style={{ padding: 4 }}>
      {ROWS.map((r) => {
        const Icon = RAIL_ICON[r.id];
        const visible = r.flag ? flags[r.flag] : true;
        const isLocked = locked[r.id] ?? false;
        return (
          <div key={r.id} className={`layer-row ${layer === r.id ? "is-active" : ""}`} onClick={() => setLayer(r.id)}>
            <button
              className={`eye ${visible ? "" : "off"}`}
              title={visible ? "Hide layer" : "Show layer"}
              disabled={!r.flag}
              onClick={(e) => { e.stopPropagation(); if (r.flag) setFlags({ ...flags, [r.flag]: !visible }); }}
            >
              {visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </button>
            <span className="ico"><Icon size={13} /></span>
            <span>{r.label}</span>
            <button className={`lock ${isLocked ? "" : "off"}`} title={isLocked ? "Unlock layer" : "Lock layer"} onClick={(e) => { e.stopPropagation(); setLocked({ ...locked, [r.id]: !isLocked }); }}>
              {isLocked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
          </div>
        );
      })}
      {overlays.length > 0 && <div className="layer-group">Overlays</div>}
      {overlays.map((o) => (
        <div key={o.key} className="layer-row is-overlay" title={`${o.spec.name} — ${o.plugin.name}`} onClick={() => setOverlayVisible(o.key, !o.visible)}>
          <button className={`eye ${o.visible ? "" : "off"}`} title={o.visible ? "Hide overlay" : "Show overlay"} onClick={(e) => { e.stopPropagation(); setOverlayVisible(o.key, !o.visible); }}>
            {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <span className="ico"><PluginIconView icon={o.plugin.icon} size={13} /></span>
          <span>{o.spec.name}</span>
        </div>
      ))}
    </div>
  );
}
