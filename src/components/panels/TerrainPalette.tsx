import { useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { Shuffle } from "lucide-react";
import {
  activeTerrainAtom, activeTileAtom, brushSizeAtom, mapTilesetAtom, rectVariationAtom, terrainModeAtom,
  type TerrainMode,
} from "../../atoms/editorAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { useTileset } from "../../hooks/useTileset";
import { variationsOf } from "../../formats/tileset/terrain";
import { heightLabel, hexTile, terrainTypes, tileGroups, tileInfo, type GroupKind } from "../../formats/tileset/palette";
import { Check, NumberInput, Tabs, Tip } from "../ui";
import { TileBrowser, TileThumb } from "./TileBrowser";

const BRUSH_SIZES = [1, 2, 3, 4, 5, 6, 7];

function BrushSelect({ bare }: { bare?: boolean } = {}) {
  const [brush, setBrush] = useAtom(brushSizeAtom);
  return (
    <>
      {!bare && <span className="lbl">Brush</span>}
      <select className="select" style={{ width: 64 }} value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label="Brush size">
        {BRUSH_SIZES.map((n) => <option key={n} value={n}>{n}×{n}</option>)}
      </select>
    </>
  );
}

/** Parse "0x1A2B", "1a2b" (if prefixed) or plain decimal; anything else is null. */
function parseTileId(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const n = /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 0xffff ? n : null;
}

/* ── Isometric (brush not implemented; the list mirrors StarEdit's) ── */

function IsomTab() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded } = useTileset();
  const [active, setActive] = useAtom(activeTerrainAtom);
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);
  const list = types.length > 0 ? types : info.terrain.map((t) => ({ ...t, group: -1, height: 0 as const, buildable: true }));

  return (
    <>
      <div className="palette-toolbar">
        <BrushSelect />
        <span className="grow" />
        <Check label="Auto-cliff" defaultChecked disabled />
      </div>
      <div className="palette-scroll">
        <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
          {list.map((t) => (
            <div key={t.id} className={`item ${active === t.id ? "selected" : ""}`} onClick={() => setActive(t.id)}>
              <TileThumb loaded={loaded} id={t.group >= 0 ? t.group << 4 : 0} size={18} className="swatch" />
              <span>{t.name}</span>
              <span className="elev">{heightLabel(t.height)}</span>
            </div>
          ))}
        </div>
        <div className="hint" style={{ padding: "8px 10px" }}>
          The isometric brush is not implemented yet. Use <strong>Rect</strong> to lay flat ground, or <strong>Subtile</strong> to place cliff pieces by hand.
        </div>
      </div>
      <div className="palette-footer"><span>{list.length} terrain types</span><span>{info.name}</span></div>
    </>
  );
}

/* ── Rect: flat terrain in left/right pairs ─────────────── */

function RectTab() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded, error } = useTileset();
  const [active, setActive] = useAtom(activeTerrainAtom);
  const [variation, setVariation] = useAtom(rectVariationAtom);
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);
  const current = types.find((t) => t.id === active) ?? types[0] ?? null;
  const variations = useMemo(() => (loaded && current ? variationsOf(loaded.tileset, current.group) : { common: [], rare: [] }), [loaded, current]);
  const slots = [...variations.common, ...variations.rare];
  const chosen = variation >= 0 && slots.includes(variation) ? variation : -1;

  return (
    <>
      <div className="palette-toolbar">
        <BrushSelect />
        <span className="grow" />
        <span className="lbl">{current ? `${current.buildable ? "Buildable" : "Unbuildable"} · ${heightLabel(current.height)}` : ""}</span>
      </div>
      {current && loaded && (
        <div className="variation-strip" role="radiogroup" aria-label="Variation">
          <Tip label="Random variation (StarEdit's mix)">
            <button className={`variation ${chosen < 0 ? "is-active" : ""}`} onClick={() => setVariation(-1)} aria-label="Random variation">
              <Shuffle size={13} />
            </button>
          </Tip>
          {slots.map((slot) => (
            <button key={slot} className={`variation ${chosen === slot ? "is-active" : ""} ${variations.rare.includes(slot) ? "rare" : ""}`} onClick={() => setVariation(slot)} title={`Variation ${slot}${variations.rare.includes(slot) ? " (rare)" : ""}`}>
              <TileThumb loaded={loaded} id={(current.group << 4) | slot} size={22} />
            </button>
          ))}
        </div>
      )}
      <div className="palette-scroll">
        {types.length === 0 && (
          <div className="hint" style={{ padding: 12 }}>
            {error ? "No tileset graphics installed — the Rect brush needs them to know which tiles make up each terrain." : "Loading tileset…"}
          </div>
        )}
        <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
          {types.map((t) => (
            <div key={t.id} className={`item ${current?.id === t.id ? "selected" : ""}`} onClick={() => { setActive(t.id); setVariation(-1); }}>
              <TileThumb loaded={loaded} id={t.group << 4} size={18} className="swatch" />
              <span>{t.name}</span>
              <span className="elev">{heightLabel(t.height)}{t.buildable ? "" : " · ✕"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="palette-footer">
        <span>{current ? `${current.name} · groups ${current.group}/${current.group + 1}` : "—"}</span>
        <span>{chosen < 0 ? "random variation" : `variation ${chosen}`}</span>
      </div>
    </>
  );
}

/* ── Subtile: any megatile from any group ───────────────── */

const KIND_FILTERS: { value: GroupKind | "all"; label: string }[] = [
  { value: "all", label: "All groups" },
  { value: "terrain", label: "Flat terrain" },
  { value: "edge", label: "Cliffs & edges" },
  { value: "doodad", label: "Doodad tiles" },
  { value: "other", label: "Unlisted" },
];

function useGroups(kind: GroupKind | "all") {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded, error } = useTileset();
  const all = useMemo(() => (loaded ? tileGroups(loaded.tileset, info.terrain) : []), [loaded, info]);
  const groups = useMemo(() => (kind === "all" ? all : all.filter((g) => g.kind === kind)), [all, kind]);
  return { info, loaded, error, all, groups };
}

function SelectedTileFooter({ id }: { id: number }) {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded } = useTileset();
  const ti = loaded ? tileInfo(loaded.tileset, info.terrain, id) : null;
  return (
    <div className="palette-footer">
      <span className="mono">{id} · {hexTile(id)}</span>
      <span>{ti ? `${ti.label} · g${ti.group} s${ti.slot}` : `group ${id >> 4} · slot ${id & 15}`}</span>
    </div>
  );
}

function SubtileTab() {
  const [kind, setKind] = useState<GroupKind | "all">("all");
  const { loaded, error, all, groups } = useGroups(kind);
  const [active, setActive] = useAtom(activeTileAtom);

  return (
    <>
      <div className="palette-toolbar">
        <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value as GroupKind | "all")} aria-label="Group filter">
          {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <BrushSelect />
      </div>
      {loaded ? (
        <TileBrowser loaded={loaded} groups={groups} selected={active} onSelect={setActive} />
      ) : (
        <div className="palette-scroll">
          <div className="hint" style={{ padding: 12 }}>{error ? "No tileset graphics installed — nothing to browse. Tile ids can still be typed under Index." : "Loading tileset…"}</div>
        </div>
      )}
      <SelectedTileFooter id={active} />
      {loaded && <div className="palette-footer sub"><span>{groups.length} / {all.length} groups</span><span>Alt+click map picks</span></div>}
    </>
  );
}

/* ── Index: raw MTXM id ─────────────────────────────────── */

function IndexTab() {
  const { info, loaded, error, all } = useGroups("all");
  const [active, setActive] = useAtom(activeTileAtom);
  const [text, setText] = useState<string | null>(null);
  const ti = loaded ? tileInfo(loaded.tileset, info.terrain, active) : null;

  const commitText = () => {
    if (text === null) return;
    const id = parseTileId(text);
    if (id !== null) setActive(id);
    setText(null);
  };

  return (
    <>
      <div className="palette-toolbar">
        <span className="lbl">Tile #</span>
        <input
          className="input mono"
          style={{ width: 72 }}
          value={text ?? String(active)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setText(null); }}
          aria-label="Tile id (decimal or 0x hex)"
        />
        <span className="mono dim" style={{ fontSize: 11 }}>{hexTile(active)}</span>
        <span className="grow" />
        <span className="dim" style={{ fontSize: 11 }}>{ti?.label ?? ""}</span>
      </div>
      <div className="tile-info">
        <TileThumb loaded={loaded} id={active} size={64} className="preview" />
        <div className="props" style={{ gridTemplateColumns: "56px 1fr" }}>
          <span className="k">Group</span><span><NumberInput value={active >> 4} onChange={(g) => setActive((g << 4) | (active & 15))} min={0} max={4095} width={84} /></span>
          <span className="k">Slot</span><span><NumberInput value={active & 15} onChange={(s) => setActive((active & ~15) | s)} min={0} max={15} width={84} /></span>
          <span className="k">Brush</span><span><BrushSelect bare /></span>
          <span className="k">MegaTile</span><span className="mono">{ti ? (ti.megatile >= 0 ? ti.megatile : "none") : "—"}</span>
          <span className="k">Ground</span><span>{ti ? `${heightLabel(ti.height)} · ${ti.buildable ? "buildable" : "unbuildable"}` : "—"}</span>
          <span className="k">Walkable</span><span>{ti ? `${ti.walkable} / 16` : "—"}</span>
        </div>
      </div>
      {loaded ? (
        <TileBrowser loaded={loaded} groups={all} selected={active} onSelect={setActive} />
      ) : (
        <div className="palette-scroll">
          <div className="hint" style={{ padding: 12 }}>{error ? "No tileset graphics installed. Ids still paint; the map shows flat colour until the files are extracted." : "Loading tileset…"}</div>
        </div>
      )}
      <SelectedTileFooter id={active} />
    </>
  );
}

/* ── Panel ──────────────────────────────────────────────── */

export default function TerrainPalette() {
  const [mode, setMode] = useAtom(terrainModeAtom);
  return (
    <Tabs
      compact
      value={mode}
      onValueChange={(v) => setMode(v as TerrainMode)}
      tabs={[
        { value: "isom", label: "Isometric", content: <IsomTab /> },
        { value: "rect", label: "Rect", content: <RectTab /> },
        { value: "subtile", label: "Subtile", content: <SubtileTab /> },
        { value: "index", label: "Index", content: <IndexTab /> },
      ]}
    />
  );
}
