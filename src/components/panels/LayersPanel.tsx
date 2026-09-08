import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Eye, EyeOff, Lock, LockOpen } from "lucide-react";
import { activeLayerAtom, lockedLayersAtom, viewFlagsAtom, type EditorLayer, type ViewFlags } from "../../atoms/editorAtoms";
import { pluginOverlaysAtom, setOverlayVisibleAtom } from "../../atoms/pluginAtoms";
import { PluginIconView } from "../ui/PluginIconView";
import { RAIL_ICON } from "./PalettePanel";
import { translate } from "../../i18n";
import { useT } from "../../i18n/react";
import { LAYERS } from "../chrome/MenuBar";

/** The editor's layers (named as `LAYERS` names them), each with the View flag its eye toggles; Terrain and the clipboard are always drawn. */
const ROWS: { id: EditorLayer; flag?: keyof ViewFlags; lockable?: boolean }[] = [
  { id: "terrain", lockable: true },
  { id: "doodads", flag: "doodads", lockable: true },
  { id: "units", flag: "units", lockable: true },
  { id: "sprites", flag: "sprites", lockable: true },
  { id: "locations", flag: "locations", lockable: true },
  { id: "fog", flag: "fog", lockable: true },
  { id: "clipboard" },
];

export default function LayersPanel() {
  const t = useT();
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const [locked, setLocked] = useAtom(lockedLayersAtom);
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
            {r.flag
              ? (
                <button
                  className={`eye ${visible ? "" : "off"}`}
                  title={visible ? t("Hide layer") : t("Show layer")}
                  onClick={(e) => { e.stopPropagation(); setFlags({ ...flags, [r.flag!]: !visible }); }}
                >
                  {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                </button>
              )
              : <span className="eye placeholder" aria-hidden />}
            <span className="ico"><Icon size={13} /></span>
            <span>{translate(LAYERS.find((l) => l.id === r.id)?.label ?? r.id)}</span>
            {r.lockable && (
              <button className={`lock ${isLocked ? "" : "off"}`} title={isLocked ? t("Unlock layer — its tools change the map again") : t("Lock layer — its tools stop changing the map")} onClick={(e) => { e.stopPropagation(); setLocked({ ...locked, [r.id]: !isLocked }); }}>
                {isLocked ? <Lock size={12} /> : <LockOpen size={12} />}
              </button>
            )}
          </div>
        );
      })}
      {overlays.length > 0 && <div className="layer-group">{t("Overlays")}</div>}
      {overlays.map((o) => (
        <div key={o.key} className="layer-row is-overlay" title={`${o.spec.name} — ${o.plugin.name}`} onClick={() => setOverlayVisible(o.key, !o.visible)}>
          <button className={`eye ${o.visible ? "" : "off"}`} title={o.visible ? t("Hide overlay") : t("Show overlay")} onClick={(e) => { e.stopPropagation(); setOverlayVisible(o.key, !o.visible); }}>
            {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
          </button>
          <span className="ico"><PluginIconView icon={o.plugin.icon} size={13} /></span>
          <span>{o.spec.name}</span>
        </div>
      ))}
    </div>
  );
}
