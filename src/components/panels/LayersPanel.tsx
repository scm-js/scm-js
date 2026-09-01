import { useState } from "react";
import { useAtom } from "jotai";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { activeLayerAtom, viewFlagsAtom, type EditorLayer, type ViewFlags } from "../../atoms/editorAtoms";
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
    </div>
  );
}
