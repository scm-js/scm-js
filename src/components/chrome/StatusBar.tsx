import { useAtomValue } from "jotai";
import { activeLayerAtom, cursorTileAtom, mapHeightAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom, symmetryAtom, zoomAtom } from "../../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { statusMessageAtom } from "../../atoms/uiAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { hexTile } from "../../formats/tileset/palette";
import { symmetryAvailable, symmetryLabel } from "../../editor/symmetry";
import { LAYERS } from "./MenuBar";

const VERSION_LABEL = { original: "StarCraft 1.00", hybrid: "Hybrid 1.04", broodwar: "Brood War", remastered: "Remastered" } as const;

export default function StatusBar() {
  const cursor = useAtomValue(cursorTileAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const layer = useAtomValue(activeLayerAtom);
  const zoom = useAtomValue(zoomAtom);
  const msg = useAtomValue(statusMessageAtom);
  const version = useAtomValue(mapVersionAtom);
  const scenario = useAtomValue(scenarioAtom);
  const symmetry = useAtomValue(symmetryAtom);
  useAtomValue(terrainRevisionAtom);
  const tileId = scenario && cursor.x < scenario.width && cursor.y < scenario.height ? scenario.tiles[cursor.y * scenario.width + cursor.x] : null;

  return (
    <footer className="statusbar">
      <span className="status-cell" title="Cursor tile">
        <span className="k">Tile</span>
        <span className="v">{cursor.x}, {cursor.y}</span>
      </span>
      <span className="status-cell" title="Cursor pixel">
        <span className="k">Px</span>
        <span className="v">{cursor.x * 32}, {cursor.y * 32}</span>
      </span>
      <span className="status-cell" title="MTXM tile id under the cursor (group · slot)">
        <span className="k">Id</span>
        <span className="v">{tileId === null ? "—" : `${hexTile(tileId)} · ${tileId >> 4}:${tileId & 15}`}</span>
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
      <span className="status-cell" title="Map revision">
        <span className="badge gold">{VERSION_LABEL[version]}</span>
      </span>
    </footer>
  );
}
