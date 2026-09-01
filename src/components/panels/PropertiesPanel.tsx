import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Crosshair, MousePointer2, SquareDashed, Trash2 } from "lucide-react";
import {
  activeDoodadAtom, activeLayerAtom, activeSpriteAtom, activeSpriteKindAtom, activeTerrainAtom, activeTileAtom, activeUnitAtom, activeUnitSpriteAtom,
  brushSizeAtom, cursorTileAtom, doodadPlacementAtom,
  doodadPlacingAtom, fogModeAtom, fogPlayersAtom,
  fogViewPlayerAtom, locationSnapAtom, mapTilesetAtom,
  rectVariationAtom, selectedDoodadsAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, spritePlaceOptionsAtom, spritePlacingAtom, terrainModeAtom,
  unitOwnerAtom, unitPlacingAtom,
} from "../../atoms/editorAtoms";
import { doodadsRevisionAtom, locationsRevisionAtom, scenarioAtom, terrainRevisionAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { boundsOf, isAnywhereIntact, isInverted, locationName } from "../../editor/locations";
import { useLocationTools } from "../../hooks/useLocationTools";
import { ANYWHERE_INDEX, ELEVATIONS, isLocationUsed } from "../../formats/chk/sections/objects";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { displayColorHex, PLAYER_COLORS, playerColorIndex } from "../../data/players";
import { FOG_PLAYERS, fogCount, fogPlayersAt, playerBit } from "../../editor/fog";
import { fogPlayersLabel } from "../../hooks/useFogTools";
import { terrainName, TILESET_BY_ID } from "../../data/tilesets";
import { unitName } from "../../data/units";
import { useTileset } from "../../hooks/useTileset";
import { useUnitTools } from "../../hooks/useUnitTools";
import { doodadLabel, useDoodadTools } from "../../hooks/useDoodadTools";
import { spriteName, useSpriteTools } from "../../hooks/useSpriteTools";
import { spriteKind } from "../../editor/sprites";
import { SpriteFlag } from "../../formats/chk/sections/objects";
import { doodadOrigin } from "../../formats/tileset/doodads";
import { DoodadThumb } from "./DoodadThumb";
import { heightLabel, hexTile, tileInfo } from "../../formats/tileset/palette";
import { UnitUsed } from "../../editor/units";
import type { UnitRecord } from "../../formats/chk/sections/objects";
import { Button, Check, NumberInput } from "../ui";
import { TileThumb } from "./TileBrowser";
import { SpritePreview, UnitPreview } from "./UnitPreview";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <span className="k">{k}</span>
      <span>{children}</span>
    </>
  );
}

const MODE_LABEL = { isom: "Isometric", rect: "Rectangular", tile: "Tile", blend: "Blend" } as const;

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
      <Row k="Size">{mode === "blend" ? "1 × 1" : `${brush} × ${brush}`}</Row>
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

const OWNER_OPTIONS = (colors: readonly number[] | null | undefined) =>
  Array.from({ length: 12 }, (_, i) => <option key={i} value={i}>Player {i + 1} ({PLAYER_COLORS[playerColorIndex(colors, i)].name})</option>);

/** Selected units when there are any, otherwise the unit about to be placed. */
function UnitProps() {
  const scenario = useAtomValue(scenarioAtom);
  const selected = useAtomValue(selectedUnitsAtom);
  useAtomValue(unitsRevisionAtom); // records are replaced in place on move / re-own
  const activeUnit = useAtomValue(activeUnitAtom);
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const placing = useAtomValue(unitPlacingAtom);
  const open = useSetAtom(openDialogAtom);
  const tools = useUnitTools();
  const colors = scenario?.playerColors;
  const first = scenario && selected.length > 0 ? scenario.units[selected[0]] : null;
  const dash = <span className="faint">—</span>;

  if (first) {
    const g = tools.geometryOf(first.unitId);
    const used = first.validStates;
    const many = selected.length > 1;
    /** An inline editor for one of the "used" vitals; unused ones show a dash and are set in the dialog. */
    const vital = (flag: number, key: keyof UnitRecord, label: string, max: number, unit?: string) =>
      used & flag
        ? <NumberInput value={Number(first[key])} onChange={(v) => tools.updateSelected(`Set ${label.toLowerCase()}`, () => ({ [key]: v }))} min={0} max={max} unit={unit} width={unit ? 96 : 110} />
        : dash;
    return (
      <div className="props">
        <div className="span unit-head">
          <UnitPreview unitId={first.unitId} owner={first.owner} colors={colors} rgb={scenario?.playerRgb} size={48} />
          <div style={{ minWidth: 0 }}>
            <div className="name" title={unitName(first.unitId)}>{unitName(first.unitId)}</div>
            <div className="sub">#{first.unitId} · serial {first.serial}{many ? ` · +${selected.length - 1} more` : ""}</div>
          </div>
        </div>
        <Row k="Owner">
          <select className="select" value={first.owner} onChange={(e) => tools.setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
        </Row>
        <Row k="Position"><span className="mono">{first.x}, {first.y}</span> <span className="faint">px · tile {Math.floor(first.x / 32)}, {Math.floor(first.y / 32)}</span></Row>
        <Row k="Type">{g.building ? "Building" : g.flyer ? "Flyer" : "Ground unit"}</Row>
        <div className="props-section">Properties{many ? <span className="faint"> · edits apply to all {selected.length}</span> : null}</div>
        <Row k="Hit points">{vital(UnitUsed.HitPoints, "hitPointsPercent", "Hit points", 255, "%")}</Row>
        <Row k="Shields">{vital(UnitUsed.Shields, "shieldPercent", "Shields", 255, "%")}</Row>
        <Row k="Energy">{vital(UnitUsed.Energy, "energyPercent", "Energy", 255, "%")}</Row>
        <Row k="Resources">{vital(UnitUsed.Resources, "resourceAmount", "Resources", 0xffffffff)}</Row>
        <Row k="Hangar">{vital(UnitUsed.Hangar, "hangarUnits", "Hangar count", 0xffff)}</Row>
        <div className="span row" style={{ marginTop: 6, gap: 6 }}>
          <Button size="sm" onClick={() => open("unitProperties", { indices: selected })}>Unit Properties…</Button>
          <Button size="sm" onClick={() => tools.deleteSelected()} title="Delete"><Trash2 size={12} /></Button>
          <Button size="sm" onClick={() => tools.startPlacing(first.unitId)} title="Place more of this unit type">Place more</Button>
        </div>
        <div className="span hint" style={{ marginTop: 4 }}>Double-click a unit for every field the map format stores.</div>
      </div>
    );
  }

  const g = tools.geometryOf(activeUnit);
  return (
    <div className="props">
      <div className="span unit-head">
        <UnitPreview unitId={activeUnit} owner={owner} colors={colors} rgb={scenario?.playerRgb} size={48} />
        <div style={{ minWidth: 0 }}>
          <div className="name" title={unitName(activeUnit)}>{unitName(activeUnit)}</div>
          <div className="sub">#{activeUnit} · {placing ? "placing" : "select mode"}</div>
        </div>
      </div>
      <Row k="Owner">
        <select className="select" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
      </Row>
      <Row k="Type">{g.building ? "Building" : g.flyer ? "Flyer" : "Ground unit"}</Row>
      <Row k="Footprint">{tools.tables ? <span className="mono">{g.building ? `${g.placeW / 32} × ${g.placeH / 32} tiles` : `${g.left + g.right + 1} × ${g.up + g.down + 1} px`}</span> : dash}</Row>
      <Row k="Placed">{scenario ? scenario.units.filter((u) => u.unitId === activeUnit).length : dash}</Row>
      <div className="span row" style={{ marginTop: 6, gap: 6 }}>
        {placing
          ? <Button size="sm" onClick={() => tools.stopPlacing()}>Stop placing</Button>
          : <Button size="sm" onClick={() => tools.startPlacing()}>Place {unitName(activeUnit)}</Button>}
      </div>
      <div className="span hint" style={{ marginTop: 6 }}>
        {placing
          ? "Click the map to place; a red box means the placement checks refuse the spot. Esc or right-click stops placing."
          : "Click a unit to select it, drag to move, drag on empty ground to box-select; Delete removes the selection. Pick a unit in the palette to place it."}
      </div>
    </div>
  );
}

/** Selected doodads when there are any, otherwise the doodad about to be placed. */
function DoodadProps() {
  const scenario = useAtomValue(scenarioAtom);
  const selected = useAtomValue(selectedDoodadsAtom);
  useAtomValue(doodadsRevisionAtom); // records are replaced in place on re-own / enable
  useAtomValue(terrainRevisionAtom); // the doodad under the cursor changes as edits land
  const active = useAtomValue(activeDoodadAtom);
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const placing = useAtomValue(doodadPlacingAtom);
  const options = useAtomValue(doodadPlacementAtom);
  const cursor = useAtomValue(cursorTileAtom);
  const tools = useDoodadTools();
  const { loaded, catalogue } = tools;
  const colors = scenario?.playerColors;
  const dash = <span className="faint">—</span>;
  const first = scenario && selected.length > 0 ? scenario.doodads[selected[0]] : null;
  const firstDef = first ? catalogue.byId.get(first.doodadId) ?? null : null;
  const underIndex = scenario ? tools.pickAt(cursor.x, cursor.y) : -1;
  const under = underIndex >= 0 ? scenario!.doodads[underIndex] : null;
  const underDef = under ? catalogue.byId.get(under.doodadId) ?? null : null;
  const overlayLabel = (kind: "sprite" | "unit", id: number) => (kind === "unit" ? `${unitName(id)} (unit #${id})` : `sprite #${id}`);

  if (first) {
    const many = selected.length > 1;
    const o = firstDef ? doodadOrigin(firstDef, first.x, first.y) : null;
    return (
      <div className="props">
        <div className="span unit-head">
          {firstDef ? <DoodadThumb loaded={loaded} def={firstDef} width={56} height={40} /> : <span className="swatch" style={{ width: 48, height: 48 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="name">{firstDef ? doodadLabel(firstDef) : `Doodad #${first.doodadId}`}</div>
            <div className="sub">{firstDef ? `${firstDef.width} × ${firstDef.height} tiles` : "unknown to this tileset"}{many ? ` · +${selected.length - 1} more` : ""}</div>
          </div>
        </div>
        <Row k="Position">{o ? <><span className="mono">tile {o.x}, {o.y}</span> <span className="faint">· centre {first.x}, {first.y} px</span></> : <span className="mono">{first.x}, {first.y} px</span>}</Row>
        <Row k="Overlay">{firstDef?.overlay ? <>{overlayLabel(firstDef.overlay.kind, firstDef.overlay.id)}{firstDef.overlay.flipped ? " · flipped" : ""}</> : <span className="faint">none</span>}</Row>
        <Row k="Owner">
          <select className="select" value={first.owner} onChange={(e) => tools.setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
        </Row>
        <div className="span">
          <Check label="Enabled" title="DD2 enabled byte; for Installation doors and traps this also sets the overlay unit's disabled flag" checked={first.disabled === 0} onChange={(e) => tools.setDisabled(!e.target.checked)} />
        </div>
        <div className="span row" style={{ marginTop: 6, gap: 6 }}>
          <Button size="sm" onClick={() => tools.deleteSelected()} title="Delete (restores the ground beneath)"><Trash2 size={12} /></Button>
          {firstDef && <Button size="sm" onClick={() => tools.startPlacing(firstDef.id)} title="Place more of this doodad">Place more</Button>}
        </div>
        <div className="span hint" style={{ marginTop: 4 }}>Drag to move; a red ghost means the ground there does not fit. Delete puts the terrain the doodad sat on back.</div>
      </div>
    );
  }

  const def = catalogue.byId.get(active) ?? catalogue.doodads[0] ?? null;
  return (
    <div className="props">
      <div className="span unit-head">
        {def ? <DoodadThumb loaded={loaded} def={def} width={56} height={40} /> : <span className="swatch" style={{ width: 48, height: 48 }} />}
        <div style={{ minWidth: 0 }}>
          <div className="name">{def ? doodadLabel(def) : "No doodads"}</div>
          <div className="sub">{def ? `${def.width} × ${def.height} tiles · ${placing ? "placing" : "select mode"}` : loaded ? "this tileset lists none" : "tileset graphics not loaded"}</div>
        </div>
      </div>
      <Row k="Owner">
        <select className="select" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
      </Row>
      <Row k="Overlay">{def?.overlay ? <>{overlayLabel(def.overlay.kind, def.overlay.id)}{def.overlay.flipped ? " · flipped" : ""}</> : <span className="faint">none</span>}</Row>
      <Row k="Ground">{def ? def.required.some((r) => r !== 0) ? `${def.required.filter((r) => r !== 0).length} of ${def.width * def.height} cells checked` : "any" : dash}</Row>
      <Row k="Options">{options.placeAnywhere ? "place anywhere" : "checked"} · {options.snapToGrid ? "snapped" : "free"}</Row>
      <Row k="Placed">{scenario && def ? scenario.doodads.filter((d) => d.doodadId === def.id).length : dash}</Row>
      <div className="span row" style={{ marginTop: 6, gap: 6 }}>
        {def && (placing
          ? <Button size="sm" onClick={() => tools.stopPlacing()}>Stop placing</Button>
          : <Button size="sm" onClick={() => tools.startPlacing()}>Place {doodadLabel(def)}</Button>)}
      </div>
      <div className="props-section">Under cursor · {cursor.x}, {cursor.y}</div>
      <Row k="Doodad">{under ? <>{underDef ? doodadLabel(underDef) : `#${under.doodadId}`} <span className="faint mono">DD2 {underIndex}</span></> : <span className="faint">none</span>}</Row>
      <div className="span hint" style={{ marginTop: 6 }}>
        {placing
          ? "Click the map to place; red cells show where the ground does not match what this doodad was drawn for. Esc or right-click stops placing."
          : "Click a doodad to select it, drag to move, drag on empty ground to box-select; Delete removes the selection. Pick a doodad in the palette to place it."}
      </div>
    </div>
  );
}

/** Selected sprites when there are any, otherwise the sprite about to be placed. */
function SpriteProps() {
  const scenario = useAtomValue(scenarioAtom);
  const selected = useAtomValue(selectedSpritesAtom);
  useAtomValue(doodadsRevisionAtom); // records are replaced in place on move / re-own / re-flag
  const kind = useAtomValue(activeSpriteKindAtom);
  const activePure = useAtomValue(activeSpriteAtom);
  const activeUnit = useAtomValue(activeUnitSpriteAtom);
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const placing = useAtomValue(spritePlacingAtom);
  const options = useAtomValue(spritePlaceOptionsAtom);
  const open = useSetAtom(openDialogAtom);
  const tools = useSpriteTools();
  const { catalogue } = useDoodadTools();
  const colors = scenario?.playerColors;
  const dash = <span className="faint">—</span>;
  const first = scenario && selected.length > 0 ? scenario.sprites[selected[0]] : null;

  if (first && scenario) {
    const many = selected.length > 1;
    const k = spriteKind(first);
    const flipped = (first.flags & SpriteFlag.Flipped) !== 0;
    const disabled = (first.flags & SpriteFlag.Disabled) !== 0;
    // A doodad's overlay: the DD2 record at the same centre whose definition names this sprite.
    const ownerDoodad = scenario.doodads.findIndex((d) => {
      const def = catalogue.byId.get(d.doodadId);
      return def?.overlay && def.overlay.id === first.spriteId && d.x === first.x && d.y === first.y && (def.overlay.kind === "sprite") === (k === "pure");
    });
    const size = tools.sizeOf(first);
    return (
      <div className="props">
        <div className="span unit-head">
          <SpritePreview kind={k} id={first.spriteId} owner={first.owner} colors={colors} rgb={scenario?.playerRgb} size={48} flipped={flipped} />
          <div style={{ minWidth: 0 }}>
            <div className="name" title={spriteName(tools.assets, k, first.spriteId)}>{spriteName(tools.assets, k, first.spriteId)}</div>
            <div className="sub">{k === "pure" ? "pure sprite" : "unit sprite"} #{first.spriteId} · THG2 {selected[0]}{many ? ` · +${selected.length - 1} more` : ""}</div>
          </div>
        </div>
        <Row k="Owner">
          <select className="select" value={first.owner} onChange={(e) => tools.setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
        </Row>
        <Row k="Position"><span className="mono">{first.x}, {first.y}</span> <span className="faint">px · tile {Math.floor(first.x / 32)}, {Math.floor(first.y / 32)}</span></Row>
        <Row k="Graphic"><span className="mono">{size.width} × {size.height} px</span></Row>
        {ownerDoodad >= 0 && <Row k="Overlay of">{doodadLabel(catalogue.byId.get(scenario.doodads[ownerDoodad].doodadId)!)} <span className="faint mono">DD2 {ownerDoodad}</span></Row>}
        <div className="props-section">Flags{many ? <span className="faint"> · edits apply to all {selected.length}</span> : null} <span className="faint mono">{`0x${first.flags.toString(16).toUpperCase().padStart(4, "0")}`}</span></div>
        <div className="span col" style={{ gap: 0 }}>
          <Check label="Pure sprite" title="Drawn as a graphic only; unticked, the game creates a unit of this id on load (0x1000)" checked={k === "pure"} onChange={(e) => tools.setFlag(SpriteFlag.PureSprite, e.target.checked, e.target.checked ? "Make pure sprite" : "Make unit sprite")} />
          <Check label="Flipped" title="Mirror the graphic left-to-right (0x2000)" checked={flipped} onChange={(e) => tools.setFlag(SpriteFlag.Flipped, e.target.checked, e.target.checked ? "Flip sprite" : "Unflip sprite")} />
          <Check label="Disabled" title="Unit sprites only: the unit starts inactive — a closed door, an unarmed trap (0x8000)" checked={disabled} disabled={k === "pure"} onChange={(e) => tools.setFlag(SpriteFlag.Disabled, e.target.checked, e.target.checked ? "Disable sprite" : "Enable sprite")} />
        </div>
        <div className="span row" style={{ marginTop: 6, gap: 6 }}>
          <Button size="sm" onClick={() => open("spriteProperties", { indices: selected })}>Sprite Properties…</Button>
          <Button size="sm" onClick={() => tools.deleteSelected()} title="Delete"><Trash2 size={12} /></Button>
          <Button size="sm" onClick={() => tools.startPlacing(k, first.spriteId)} title="Place more of this sprite">Place more</Button>
        </div>
        <div className="span hint" style={{ marginTop: 4 }}>
          {ownerDoodad >= 0 ? "This is a doodad's overlay: moving or deleting it leaves the doodad's tiles behind; edit it on the Doodads layer to keep them together." : "Double-click a sprite for every field the THG2 record stores."}
        </div>
      </div>
    );
  }

  const id = kind === "pure" ? activePure : activeUnit;
  const label = spriteName(tools.assets, kind, id);
  const size = tools.sizeOf({ spriteId: id, x: 0, y: 0, owner: 0, unused: 0, flags: kind === "pure" ? SpriteFlag.PureSprite : 0 });
  return (
    <div className="props">
      <div className="span unit-head">
        <SpritePreview kind={kind} id={id} owner={owner} colors={colors} rgb={scenario?.playerRgb} size={48} flipped={options.flipped} />
        <div style={{ minWidth: 0 }}>
          <div className="name" title={label}>{label}</div>
          <div className="sub">{kind === "pure" ? "pure sprite" : "unit sprite"} #{id} · {placing ? "placing" : "select mode"}</div>
        </div>
      </div>
      <Row k="Owner">
        <select className="select" value={owner} onChange={(e) => setOwner(Number(e.target.value))}>{OWNER_OPTIONS(colors)}</select>
      </Row>
      <Row k="Kind">{kind === "pure" ? "Pure sprite — a graphic, no unit behind it" : "Unit sprite — becomes a unit when the map loads"}</Row>
      <Row k="Flags">{[options.flipped && "flipped", kind === "unit" && options.disabled && "disabled"].filter(Boolean).join(" · ") || <span className="faint">none</span>}</Row>
      <Row k="Graphic">{tools.assets ? <span className="mono">{size.width} × {size.height} px</span> : dash}</Row>
      <Row k="Placed">{scenario ? scenario.sprites.filter((r) => r.spriteId === id && spriteKind(r) === kind).length : dash}</Row>
      <div className="span row" style={{ marginTop: 6, gap: 6 }}>
        {placing
          ? <Button size="sm" onClick={() => tools.stopPlacing()}>Stop placing</Button>
          : <Button size="sm" onClick={() => tools.startPlacing()}>Place {label}</Button>}
      </div>
      <div className="span hint" style={{ marginTop: 6 }}>
        {placing
          ? "Click the map to place; sprites go anywhere, at any pixel. Esc or right-click stops placing."
          : "Click a sprite to select it, drag to move, drag on empty ground to box-select; Delete removes the selection. Pick a sprite in the palette to place it."}
      </div>
    </div>
  );
}

/** A text field that commits on Enter / blur rather than every keystroke, so a rename is one undo step. */
function CommitText({ value, disabled, onCommit, ...rest }: { value: string; disabled?: boolean; onCommit: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur" | "onKeyDown">) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      {...rest}
      className="input"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(value); e.currentTarget.blur(); } }}
    />
  );
}

/** The same for a number: the arrow keys / spinner step by `step`, and a value lands on blur or Enter. */
function CommitNumber({ value, step, max, disabled, onCommit, label }: { value: number; step: number; max: number; disabled?: boolean; onCommit: (v: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(value));
  const commit = () => {
    const v = Math.round(Number(draft));
    if (Number.isFinite(v) && v !== value) onCommit(Math.min(max, Math.max(0, v)));
    else setDraft(String(value));
  };
  return (
    <input
      className="input mono"
      type="number"
      aria-label={label}
      value={draft}
      min={0}
      max={max}
      step={step}
      disabled={disabled}
      style={{ width: 68 }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setDraft(String(value)); e.currentTarget.blur(); } }}
    />
  );
}

/**
 * The selected location: name and bounds edited in place, the elevation ticks, and the
 * Anywhere slot's lock. Bounds are pixels, like the dialog; the size reads in tiles.
 */
function LocationProps() {
  const scenario = useAtomValue(scenarioAtom);
  const selected = useAtomValue(selectedLocationsAtom);
  useAtomValue(locationsRevisionAtom); // slots are replaced in place on move / resize / edit
  const snap = useAtomValue(locationSnapAtom);
  const open = useSetAtom(openDialogAtom);
  const tools = useLocationTools();
  const index = selected[0];
  const rec = scenario && index !== undefined ? scenario.locations[index] : undefined;

  if (!scenario || !rec || !isLocationUsed(rec)) {
    return (
      <div className="props-empty">
        <SquareDashed size={20} />
        Drag on empty ground to create a location. Click one to select it (Shift adds), drag it to move, drag its handles to resize; double-click for every field.
      </div>
    );
  }

  const anywhere = index === ANYWHERE_INDEX;
  const many = selected.length > 1;
  const name = locationName(scenario, index);
  const b = boundsOf(rec);
  const intact = isAnywhereIntact(scenario);
  const step = snap || 1;
  const maxX = scenario.width * 32, maxY = scenario.height * 32;
  const edge = (key: "left" | "top" | "right" | "bottom", max: number) => (
    <CommitNumber key={`${index}:${key}:${rec[key]}`} label={`${key} edge`} value={rec[key]} step={step} max={max} disabled={anywhere} onCommit={(v) => tools.edit(index, { [key]: v })} />
  );

  return (
    <div className="props">
      <div className="span unit-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <CommitText key={`${index}:${name}`} value={name} disabled={anywhere} onCommit={(v) => tools.rename(index, v)} aria-label="Location name" style={{ width: "100%", fontWeight: 600 }} />
          <div className="sub">slot {index}{anywhere ? " · Anywhere" : ""}{many ? ` · +${selected.length - 1} more` : ""} · string #{rec.nameIndex}</div>
        </div>
      </div>
      <Row k="Left · Top"><div className="row" style={{ gap: 4 }}>{edge("left", maxX)}{edge("top", maxY)}</div></Row>
      <Row k="Right · Btm"><div className="row" style={{ gap: 4 }}>{edge("right", maxX)}{edge("bottom", maxY)}</div></Row>
      <Row k="Size"><span className="mono">{fmtTiles(b.right - b.left)} × {fmtTiles(b.bottom - b.top)}</span> tiles <span className="faint mono">{b.right - b.left}×{b.bottom - b.top}px</span></Row>
      {isInverted(rec) && <div className="span hint">Stored inverted (right &lt; left or bottom &lt; top): the game reads the normalised box; dragging a handle normalises it.</div>}
      <div className="props-section">Elevations{many ? <span className="faint"> · edits apply to all {selected.length}</span> : null} <span className="faint mono">0x{rec.elevationFlags.toString(16).toUpperCase().padStart(2, "0")}</span></div>
      <div className="span" style={{ display: "grid", gridAutoFlow: "column", gridTemplateRows: "repeat(3, auto)", gap: "0 8px" }}>
        {ELEVATIONS.map((e) => (
          <Check key={e.bit} label={e.label} title="Ticked: the location applies on this elevation (its bit is clear in the file)" checked={(rec.elevationFlags & e.bit) === 0} disabled={anywhere} onChange={(ev) => tools.setElevation(e.bit, ev.target.checked)} />
        ))}
      </div>
      {anywhere && (
        <div className="span hint" style={{ marginTop: 6 }}>
          {intact
            ? "The 64th location — every trigger's “Anywhere”. It stays the whole map and cannot be moved, resized, renamed or deleted."
            : <>Anywhere should cover the whole map but does not. <Button size="sm" onClick={() => tools.fixAnywhere()}>Reset to map bounds</Button></>}
        </div>
      )}
      <div className="span row" style={{ marginTop: 6, gap: 6 }}>
        <Button size="sm" onClick={() => open("locationProperties", { index })}>Location Properties…</Button>
        <Button size="sm" onClick={() => tools.centerOn(index)} title="Scroll the map to this location"><Crosshair size={12} /></Button>
        <Button size="sm" onClick={() => tools.deleteSelected()} title="Delete" disabled={!selected.some((i) => i !== ANYWHERE_INDEX)}><Trash2 size={12} /></Button>
      </div>
    </div>
  );
}

const fmtTiles = (px: number) => (Number.isInteger(px / 32) ? String(px / 32) : (px / 32).toFixed(2));

/** The fog layer: what the brush does, whose fog is shown, and the tile under the pointer. */
function FogProps() {
  const brush = useAtomValue(brushSizeAtom);
  const cursor = useAtomValue(cursorTileAtom);
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(terrainRevisionAtom); // fog strokes mutate the mask in place
  const fogPlayers = useAtomValue(fogPlayersAtom);
  const fogMode = useAtomValue(fogModeAtom);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
    const under = scenario ? fogPlayersAt(scenario, cursor.x, cursor.y) : 0;
    const swatches = (players: number) => (
      <span className="row" style={{ gap: 3 }}>
        {Array.from({ length: FOG_PLAYERS }, (_, i) => (players & playerBit(i)) !== 0 && (
          <span key={i} className="swatch" title={`Player ${i + 1}`} style={{ background: displayColorHex(scenario?.playerColors, scenario?.playerRgb, i), width: 10, height: 10 }} />
        ))}
      </span>
    );
    return (
      <div className="props">
        <Row k="Brush">{brush} × {brush} · {fogMode === "fog" ? "lay fog" : "clear fog"}</Row>
        <Row k="Players">{fogPlayers === 0 ? <span className="faint">none selected</span> : <>{swatches(fogPlayers)}<span className="mono" style={{ marginLeft: 6 }}>{fogPlayersLabel(fogPlayers)}</span></>}</Row>
        <Row k="Viewing">Player {fogViewPlayer + 1} · {scenario ? `${fogCount(scenario, fogViewPlayer).toLocaleString()} fogged` : "—"}</Row>
        <div className="props-section">Under cursor · {cursor.x}, {cursor.y}</div>
        <Row k="Fogged for">{!scenario ? <span className="faint">—</span> : under === 0 ? <span className="faint">nobody (explored for all)</span> : <>{swatches(under)}<span className="mono" style={{ marginLeft: 6 }}>{fogPlayersLabel(under)}</span></>}</Row>
        {scenario && !scenario.mask && <div className="span hint">No MASK section: the game treats every tile as fogged for everyone.</div>}
      </div>
    );
}

export default function PropertiesPanel() {
  const layer = useAtomValue(activeLayerAtom);

  if (layer === "terrain") return <TerrainProps />;
  if (layer === "units") return <UnitProps />;
  if (layer === "doodads") return <DoodadProps />;
  if (layer === "sprites") return <SpriteProps />;
  if (layer === "fog") return <FogProps />;

  if (layer === "locations") return <LocationProps />;

  return (
    <div className="props-empty">
      <MousePointer2 size={20} />
      Drag a rectangle on the map to select.
    </div>
  );
}
