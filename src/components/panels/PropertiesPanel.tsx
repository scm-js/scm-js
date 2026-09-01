import { useAtomValue, useSetAtom } from "jotai";
import { MousePointer2 } from "lucide-react";
import {
  activeLayerAtom, activeTerrainAtom, activeTileAtom, activeUnitAtom, brushSizeAtom, cursorTileAtom, mapTilesetAtom,
  rectVariationAtom, terrainModeAtom, unitOwnerAtom,
} from "../../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { PLAYER_COLORS } from "../../data/players";
import { SAMPLE_LOCATIONS } from "../../data/samples";
import { terrainName, TILESET_BY_ID } from "../../data/tilesets";
import { useTileset } from "../../hooks/useTileset";
import { heightLabel, hexTile, tileInfo } from "../../formats/tileset/palette";
import { Button, Check } from "../ui";
import { TileThumb } from "./TileBrowser";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span className="k">{k}</span>
      <span>{children}</span>
    </>
  );
}

const MODE_LABEL = { isom: "Isometric", rect: "Rectangular", tile: "Tile" } as const;

function TerrainProps() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const terrain = useAtomValue(activeTerrainAtom);
  const tile = useAtomValue(activeTileAtom);
  const variation = useAtomValue(rectVariationAtom);
  const mode = useAtomValue(terrainModeAtom);
  const brush = useAtomValue(brushSizeAtom);
  const cursor = useAtomValue(cursorTileAtom);
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(terrainRevisionAtom); // the tile under the cursor changes as strokes land
  const { loaded } = useTileset();

  const underId = scenario && cursor.x < scenario.width && cursor.y < scenario.height ? scenario.tiles[cursor.y * scenario.width + cursor.x] : null;
  const under = loaded && underId !== null ? tileInfo(loaded.tileset, info.terrain, underId) : null;
  const dash = <span className="faint">—</span>;

  return (
    <div className="props">
      <Row k="Brush">
        {mode === "isom" || mode === "rect"
          ? <>{terrainName(info, terrain)}{mode === "rect" && variation >= 0 ? <span className="faint"> · var {variation}</span> : null}</>
          : <span className="row" style={{ gap: 6 }}><TileThumb loaded={loaded} id={tile} size={16} /><span className="mono">{hexTile(tile)}</span></span>}
      </Row>
      <Row k="Mode">{MODE_LABEL[mode]}</Row>
      <Row k="Size">{brush} × {brush}</Row>
      <div className="props-section">Under cursor</div>
      <Row k="Tile">{underId !== null ? <span className="mono">{underId} · {hexTile(underId)}</span> : dash}</Row>
      <Row k="Group">{under ? <>{under.label} <span className="faint mono">g{under.group} s{under.slot}</span></> : dash}</Row>
      <Row k="MegaTile">{under ? <span className="mono">{under.megatile >= 0 ? under.megatile : "none"}</span> : dash}</Row>
      <Row k="Elevation">{under ? heightLabel(under.height) : dash}</Row>
      <Row k="Walkable">{under ? `${under.walkable} / 16 minitiles` : dash}</Row>
      <Row k="Buildable">{under ? (under.buildable ? "Yes" : "No") : dash}</Row>
    </div>
  );
}

export default function PropertiesPanel() {
  const layer = useAtomValue(activeLayerAtom);
  const brush = useAtomValue(brushSizeAtom);
  const unit = useAtomValue(activeUnitAtom);
  const owner = useAtomValue(unitOwnerAtom);
  const open = useSetAtom(openDialogAtom);

  if (layer === "terrain") return <TerrainProps />;

  if (layer === "units") {
    return (
      <div className="props">
        <div className="span row between">
          <strong>{unit}</strong>
          <span className="badge">sample</span>
        </div>
        <Row k="Owner">
          <select className="select" defaultValue={owner}>
            {PLAYER_COLORS.slice(0, 12).map((c, i) => <option key={i} value={i}>Player {i + 1} ({c.name})</option>)}
          </select>
        </Row>
        <Row k="Hit points"><input className="input mono" defaultValue="100" /></Row>
        <Row k="Shields"><input className="input mono" defaultValue="100" /></Row>
        <Row k="Energy"><input className="input mono" defaultValue="100" /></Row>
        <Row k="Resources"><input className="input mono" defaultValue="0" /></Row>
        <Row k="Hangar"><input className="input mono" defaultValue="0" /></Row>
        <div className="props-section">State</div>
        <div className="span col" style={{ gap: 0 }}>
          <Check label="Invincible" />
          <Check label="Cloaked" />
          <Check label="Burrowed" />
          <Check label="Hallucinated" />
          <Check label="In transit / lifted" />
        </div>
        <div className="span" style={{ marginTop: 6 }}>
          <Button size="sm" onClick={() => open("unitProperties", { unit, owner })}>Unit Properties…</Button>
        </div>
      </div>
    );
  }

  if (layer === "locations") {
    const l = SAMPLE_LOCATIONS[1];
    return (
      <div className="props">
        <div className="span row between"><strong>{l.name}</strong><span className="badge">sample</span></div>
        <Row k="ID"><span className="mono">{l.id}</span></Row>
        <Row k="Left / Top"><span className="mono">{l.x * 32}, {l.y * 32}</span></Row>
        <Row k="Right / Bottom"><span className="mono">{(l.x + l.w) * 32}, {(l.y + l.h) * 32}</span></Row>
        <Row k="Size"><span className="mono">{l.w} × {l.h} tiles</span></Row>
        <div className="props-section">Elevation</div>
        <div className="span col" style={{ gap: 0 }}>
          <Check label="Low ground" defaultChecked />
          <Check label="Medium ground" defaultChecked />
          <Check label="High ground" defaultChecked />
          <Check label="Low air" defaultChecked />
          <Check label="Medium air" defaultChecked />
          <Check label="High air" defaultChecked />
        </div>
        <div className="span" style={{ marginTop: 6 }}>
          <Button size="sm" onClick={() => open("locationProperties", { location: l })}>Location Properties…</Button>
        </div>
      </div>
    );
  }

  if (layer === "sprites") {
    return (
      <div className="props">
        <div className="span row between"><strong>Cursor Marker</strong><span className="badge">sample</span></div>
        <Row k="Sprite ID"><span className="mono">318</span></Row>
        <Row k="Owner"><select className="select" defaultValue={0}>{PLAYER_COLORS.slice(0, 12).map((_, i) => <option key={i} value={i}>Player {i + 1}</option>)}</select></Row>
        <div className="span col" style={{ gap: 0 }}>
          <Check label="Pure sprite (no unit)" defaultChecked />
          <Check label="Disabled" />
        </div>
        <div className="span" style={{ marginTop: 6 }}>
          <Button size="sm" onClick={() => open("spriteProperties")}>Sprite Properties…</Button>
        </div>
      </div>
    );
  }

  if (layer === "doodads") {
    return (
      <div className="props">
        <div className="span row between"><strong>Rocks 1</strong><span className="badge">sample</span></div>
        <Row k="Doodad ID"><span className="mono">0x0000</span></Row>
        <Row k="Footprint"><span className="mono">3 × 2</span></Row>
        <Row k="Owner"><select className="select" defaultValue={11}>{PLAYER_COLORS.slice(0, 12).map((_, i) => <option key={i} value={i}>Player {i + 1}</option>)}</select></Row>
        <div className="span col" style={{ gap: 0 }}>
          <Check label="Enabled (on state)" defaultChecked />
          <Check label="Overlaps sprites" />
        </div>
      </div>
    );
  }

  if (layer === "fog") {
    return (
      <div className="props">
        <Row k="Brush">{brush} × {brush}</Row>
        <Row k="Players">P1, P2</Row>
        <div className="props-section">Under cursor</div>
        <Row k="Fogged for"><span className="faint">—</span></Row>
      </div>
    );
  }

  return (
    <div className="props-empty">
      <MousePointer2 size={20} />
      Drag a rectangle on the map to select.
    </div>
  );
}
