import { useAtomValue } from "jotai";
import { activeLayerAtom, cursorPixelAtom, cursorTileAtom, mapHeightAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom, symmetryAtom, zoomAtom } from "../../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { statusMessageAtom } from "../../atoms/uiAtoms";
import { pluginStatusItemsAtom } from "../../atoms/pluginAtoms";
import { PluginIconView } from "../ui/PluginIconView";
import { TILESET_BY_ID } from "../../data/tilesets";
import { hexTile } from "../../formats/tileset/palette";
import { tileGroup, tileSubIndex } from "../../formats/chk/sections/terrain";
import { symmetryAvailable, symmetryLabel } from "../../editor/symmetry";
import { LAYERS } from "./MenuBar";

const VERSION_LABEL = { original: "StarCraft 1.00", hybrid: "Hybrid 1.04", broodwar: "Brood War", remastered: "Remastered" } as const;

export default function StatusBar() {
  const cursor = useAtomValue(cursorTileAtom);
  const pixel = useAtomValue(cursorPixelAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const layer = useAtomValue(activeLayerAtom);
  const zoom = useAtomValue(zoomAtom);
  const msg = useAtomValue(statusMessageAtom);
  const version = useAtomValue(mapVersionAtom);
  const scenario = useAtomValue(scenarioAtom);
  const symmetry = useAtomValue(symmetryAtom);
  const pluginItems = useAtomValue(pluginStatusItemsAtom);
  useAtomValue(terrainRevisionAtom);
  const tileId = scenario && cursor.x < scenario.width && cursor.y < scenario.height ? scenario.tiles[cursor.y * scenario.width + cursor.x] : null;

  return (
    <footer className="statusbar">
      <span className="status-cell" title="Cursor tile">
        <span className="k">Tile</span>
        <span className="v">{cursor.x}, {cursor.y}</span>
      </span>
      <span className="status-cell" title="Cursor position in map pixels">
        <span className="k">Px</span>
        <span className="v">{pixel.x}, {pixel.y}</span>
      </span>
      <span className="status-cell" title="MTXM tile id under the cursor (group · slot)">
        <span className="k">Id</span>
        <span className="v">{tileId === null ? "—" : `${hexTile(tileId)} · ${tileGroup(tileId)}:${tileSubIndex(tileId)}`}</span>
      </span>
      <span className="status-cell" title="Map dimensions">
        <span className="k">Map</span>
        <span className="v">{w} × {h}</span>
      </span>
      <span className="status-cell" title="Tileset">
        <span className="swatch" style={{ background: tileset.color }} />
        <span>{tileset.name}</span>
      </span>
      <span className="status-cell" title="Active layer">
        <span className="k">Layer</span>
        <span>{LAYERS.find((l) => l.id === layer)?.label}</span>
      </span>
      <span className="status-cell" title="Zoom">
        <span className="v">{Math.round(zoom * 100)}%</span>
      </span>
      {symmetry !== "none" && (
        <span className="status-cell" title={symmetryAvailable(symmetry, w, h) ? "Symmetry mode: Rect, Tile and Fog brushes paint mirrored (Tools ▸ Symmetry…)" : "This symmetry mode needs a square map — brushes paint normally"}>
          <span className="k">Sym</span>
          <span className={`badge ${symmetryAvailable(symmetry, w, h) ? "teal" : "warn"}`}>{symmetryLabel(symmetry)}</span>
        </span>
      )}
      <span className="status-cell grow msg">{msg}</span>
      {pluginItems.map((item) => (
        <span
          key={item.key}
          className={`status-cell plugin-status${item.spec.warn ? " warn" : ""}${item.spec.onClick ? " clickable" : ""}`}
          title={item.spec.title ?? item.plugin.name}
          role={item.spec.onClick ? "button" : undefined}
          tabIndex={item.spec.onClick ? 0 : undefined}
          onClick={item.spec.onClick}
          onKeyDown={item.spec.onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); item.spec.onClick?.(); } } : undefined}
        >
          {item.spec.busy ? <span className="status-spinner" aria-label="working" /> : <PluginIconView icon={item.plugin.icon} size={11} />}
          <span>{item.spec.text}</span>
        </span>
      ))}
      <span className="status-cell" title="Map revision">
        <span className="badge gold">{VERSION_LABEL[version]}</span>
      </span>
    </footer>
  );
}
