import { useMemo, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { LayoutGrid, Rows3, Search, Shuffle, X } from "lucide-react";
import {
  activeTerrainAtom, activeTileAtom, brushSizeAtom, mapTilesetAtom, rectVariationAtom, terrainModeAtom,
  type TerrainMode,
} from "../../atoms/editorAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { useTileset } from "../../hooks/useTileset";
import { useIsomRebuild, useIsomStatus } from "../../hooks/useIsom";
import { variationsOf } from "../../formats/tileset/terrain";
import { heightLabel, hexTile, terrainTypes, tileGroups, tileInfo, type GroupKind, type TileGroupInfo } from "../../formats/tileset/palette";
import { Button, NumberInput, Tabs, Tip } from "../ui";
import { TileBrowser, TileGrid, TileThumb } from "./TileBrowser";

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

/* ── Isometric: StarEdit's diamond brush ─────────────────── */

function IsomTab() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded } = useTileset();
  const [active, setActive] = useAtom(activeTerrainAtom);
  const status = useIsomStatus();
  const rebuild = useIsomRebuild();
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);
  const list = types.length > 0 ? types : info.terrain.map((t) => ({ ...t, group: -1, height: 0 as const, buildable: true }));
  const ready = status.kind === "ready";
  const stalePct = ready ? Math.round((100 * status.check.mismatched) / Math.max(1, status.check.rects)) : 0;

  return (
    <>
      <div className="palette-toolbar">
        <BrushSelect />
        <span className="grow" />
        <span className="lbl">
          {status.kind === "missing" ? "no ISOM" : ready ? (status.stale ? `ISOM stale (${stalePct}%)` : "ISOM ok") : ""}
        </span>
      </div>
      <div className="palette-scroll">
        <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0, opacity: status.kind === "ready" ? 1 : 0.55 }}>
          {list.map((t) => (
            <div key={t.id} className={`item ${active === t.id ? "selected" : ""}`} onClick={() => setActive(t.id)}>
              <TileThumb loaded={loaded} id={t.group >= 0 ? t.group << 4 : 0} size={18} className="swatch" />
              <span>{t.name}</span>
              <span className="elev">{heightLabel(t.height)}</span>
            </div>
          ))}
        </div>
        {status.kind === "loading" && <div className="hint" style={{ padding: "8px 10px" }}>Loading tileset…</div>}
        {status.kind === "no-tileset" && (
          <div className="hint" style={{ padding: "8px 10px" }}>
            The isometric brush needs the tileset graphics — run <span className="mono">scripts/extract-tilesets.mjs</span>.
          </div>
        )}
        {status.kind === "missing" && (
          <div className="hint" style={{ padding: "8px 10px", display: "grid", gap: 8 }}>
            <span>
              This map has no <strong>ISOM</strong> section, so the isometric brush is off. StarCraft never reads ISOM — it is
              the editor's own record of the diamond lattice — but the brush cannot work without one.
            </span>
            <span>
              You can rebuild it from the tiles: exact for terrain that was laid down isometrically, a best guess under
              doodads and for hand-placed tiles.
            </span>
            <span><Button size="sm" onClick={rebuild}>Rebuild ISOM from tiles</Button></span>
          </div>
        )}
        {ready && status.stale && (
          <div className="hint" style={{ padding: "8px 10px", display: "grid", gap: 8 }}>
            <span>
              The ISOM disagrees with the tiles under about {stalePct}% of the map — terrain edited with the Rect or Tile brush,
              or another tool. Isometric strokes near those areas will not join up until it is rebuilt.
            </span>
            <span><Button size="sm" onClick={rebuild}>Rebuild ISOM from tiles</Button></span>
          </div>
        )}
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

/* ── Tile: any single megatile, browsed or typed ────────── */

const KIND_FILTERS: { value: GroupKind | "all"; label: string }[] = [
  { value: "all", label: "All groups" },
  { value: "terrain", label: "Flat terrain" },
  { value: "edge", label: "Cliffs & edges" },
  { value: "doodad", label: "Doodad tiles" },
  { value: "other", label: "Unlisted" },
];

/**
 * Search over the group list: `0x1234` homes in on that tile's group, a bare number
 * matches a group or CV5 index, anything else is a substring of the group label
 * ("dirt", "edge set 12", "doodad").
 */
function searchGroups(groups: TileGroupInfo[], query: string): TileGroupInfo[] {
  const q = query.trim().toLowerCase();
  if (q === "") return groups;
  if (/^0x[0-9a-f]+$/.test(q)) {
    const id = parseTileId(q);
    return id === null ? [] : groups.filter((g) => g.group === id >> 4);
  }
  if (/^\d+$/.test(q)) {
    const n = Number(q);
    return groups.filter((g) => g.group === n || g.index === n || g.label.toLowerCase().includes(q));
  }
  return groups.filter((g) => g.label.toLowerCase().includes(q));
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

/** Grouped rows (label per CV5 group) or one dense wall of tiles. */
type TileView = "groups" | "grid";

function TileTab() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded, error } = useTileset();
  const [active, setActive] = useAtom(activeTileAtom);
  const [kind, setKind] = useState<GroupKind | "all">("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<TileView>("groups");
  const [text, setText] = useState<string | null>(null);

  const all = useMemo(() => (loaded ? tileGroups(loaded.tileset, info.terrain) : []), [loaded, info]);
  const groups = useMemo(
    () => searchGroups(kind === "all" ? all : all.filter((g) => g.kind === kind), query),
    [all, kind, query],
  );
  const tiles = useMemo(() => groups.flatMap((g) => g.slots.map((s) => (g.group << 4) | s)), [groups]);
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
      <div className="palette-toolbar">
        <div className="search">
          <Search size={12} />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search groups…"
            aria-label="Search tile groups"
          />
          {query !== "" && <button className="clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={11} /></button>}
        </div>
        <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value as GroupKind | "all")} aria-label="Group filter">
          {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <Tip label="Grouped rows">
          <Button icon size="sm" active={view === "groups"} onClick={() => setView("groups")} aria-label="Grouped rows"><Rows3 size={13} /></Button>
        </Tip>
        <Tip label="All tiles in one grid">
          <Button icon size="sm" active={view === "grid"} onClick={() => setView("grid")} aria-label="All tiles in one grid"><LayoutGrid size={13} /></Button>
        </Tip>
      </div>
      {loaded ? (
        view === "grid"
          ? <TileGrid loaded={loaded} tiles={tiles} selected={active} onSelect={setActive} />
          : <TileBrowser loaded={loaded} groups={groups} selected={active} onSelect={setActive} />
      ) : (
        <div className="palette-scroll">
          <div className="hint" style={{ padding: 12 }}>
            {error ? "No tileset graphics installed — nothing to browse. Ids still paint; the map shows flat colour until the files are extracted." : "Loading tileset…"}
          </div>
        </div>
      )}
      <SelectedTileFooter id={active} />
      {loaded && (
        <div className="palette-footer sub">
          <span>{view === "grid" ? `${tiles.length} tiles` : `${groups.length} / ${all.length} groups`}</span>
          <span>Alt+click map picks</span>
        </div>
      )}
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
        { value: "tile", label: "Tile", content: <TileTab /> },
      ]}
    />
  );
}
