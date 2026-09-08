import { useMemo, useState } from "react";
import { ContextMenu } from "radix-ui";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { LayoutGrid, Rows3, Search, Shuffle, X } from "lucide-react";
import {
  activeTerrainAtom, activeTileAtom, blendAnchorAtom, blendFollowAtom, brushSizeAtom, mapTilesetAtom, placementOptionsAtom,
  rectVariationAtom, symmetryAtom, terrainModeAtom, type TerrainMode,
} from "../../atoms/editorAtoms";
import { activeLayerAtom, clipSelectionAtom } from "../../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { pluginContextItemsAtom } from "../../atoms/pluginAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { pluginContextRows } from "../../plugins/contextMenu";
import { TILESET_BY_ID } from "../../data/tilesets";
import { useTileset } from "../../hooks/useTileset";
import { useIsomStatus } from "../../hooks/useIsom";
import { useTerrainTools } from "../../hooks/useTerrainTools";
import { variationsOf } from "../../formats/tileset/terrain";
import { heightLabel, hexTile, terrainTypes, tileGroups, tileInfo, type GroupKind, type TileGroupInfo } from "../../formats/tileset/palette";
import { blendSides, DEFAULT_BLEND_OPTIONS, inMap, SIDES, type BlendCandidate, type Side } from "../../editor/blend";
import { symmetryAvailable, symmetryLabel } from "../../editor/symmetry";
import { Button, Check, NumberInput, Tabs, Tip } from "../ui";
import { TileBrowser, TileGrid, TileThumb } from "./TileBrowser";
import { msg, t, translate } from "../../i18n";

const BRUSH_SIZES = [1, 2, 3, 4, 5, 6, 7];

/**
 * What a palette shows when the tileset files are not there: the graphics are installed from
 * Help ▸ Game Data… (files, a folder, the desktop app's search, or an address), so the message
 * offers that dialog rather than naming an extraction script.
 */
function NoTileset({ what, loading }: { what: string; loading: boolean }) {
  const open = useSetAtom(openDialogAtom);
  if (loading) return <div className="hint" style={{ padding: 12 }}>{t("Loading tileset…")}</div>;
  return (
    <div className="hint" style={{ padding: 12, display: "grid", gap: 8, justifyItems: "start" }}>
      <span>{t("No tileset graphics installed — {what}", { what })}</span>
      <Button size="sm" onClick={() => open("gameData")}>{t("Set up game data…")}</Button>
    </div>
  );
}

/**
 * One line about the active symmetry mode (Tools ▸ Symmetry…): the Rect and Tile brushes
 * paint mirrored under it, the isometric and Blend brushes do not.
 */
function SymmetryNote({ applies }: { applies: boolean }) {
  const mode = useAtomValue(symmetryAtom);
  const scenario = useAtomValue(scenarioAtom);
  if (mode === "none") return null;
  const ok = scenario ? symmetryAvailable(mode, scenario.width, scenario.height) : true;
  const text = !ok
    ? t("Symmetry \"{mode}\" needs a square map — strokes paint normally.", { mode: symmetryLabel(mode) })
    : applies
      ? t("Symmetry: {mode} — every stroke is mirrored.", { mode: symmetryLabel(mode) })
      : t("Symmetry ({mode}) does not apply to this brush — only Rect, Tile and Fog strokes are mirrored.", { mode: symmetryLabel(mode) });
  return <div className={`palette-footer sub ${ok && applies ? "" : "warn"}`} title={t("Tools ▸ Symmetry…")}><span>{text}</span></div>;
}

export function BrushSelect({ bare }: { bare?: boolean } = {}) {
  const [brush, setBrush] = useAtom(brushSizeAtom);
  return (
    <>
      {!bare && <span className="lbl">{t("Brush")}</span>}
      <select className="select" style={{ width: 64 }} value={brush} onChange={(e) => setBrush(Number(e.target.value))} aria-label={t("Brush size")}>
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
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);
  const list = types.length > 0 ? types : info.terrain.map((t) => ({ ...t, group: -1, height: 0 as const, buildable: true }));
  const report = status.kind === "ready" ? status.report : null;
  const share = (n: number) => Math.round((100 * n) / Math.max(1, report?.rects ?? 1));
  // What a rebuild would recover, and what it would leave behind whatever anyone does.
  const stalePct = report ? share(report.mismatched - report.inherent) : 0;
  const inherentPct = report ? share(report.inherent) : 0;

  return (
    <>
      <div className="palette-toolbar">
        <BrushSelect />
        <span className="grow" />
        <span className="lbl">
          {status.kind === "missing" ? t("no ISOM") : report ? report.stale ? t("ISOM stale ({stalePct}%)", { stalePct }) : inherentPct > 0 ? t("ISOM ok ({inherentPct}% hand-laid)", { inherentPct }) : t("ISOM ok") : ""}
        </span>
      </div>
      <div className="palette-scroll">
        <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0, opacity: report ? 1 : 0.55 }}>
          {list.map((t) => (
            <div key={t.id} className={`item ${active === t.id ? "selected" : ""}`} onClick={() => setActive(t.id)}>
              <TileThumb loaded={loaded} id={t.group >= 0 ? t.group << 4 : 0} size={18} className="swatch" />
              <span>{translate(t.name)}</span>
              <span className="elev">{heightLabel(t.height)}</span>
            </div>
          ))}
        </div>
        {status.kind === "loading" && <div className="hint" style={{ padding: "8px 10px" }}>{t("Loading tileset…")}</div>}
        {status.kind === "no-tileset" && (
          <div className="hint" style={{ padding: "8px 10px" }}>
            {t("The isometric brush needs the tileset graphics — Help ▸ Game Data…")}
          </div>
        )}
        {status.kind === "missing" && (
          <div className="hint" style={{ padding: "8px 10px", display: "grid", gap: 8 }}>
            <span>
              {t("This map has no")}{" "}<strong>ISOM</strong> {" "}{t("section, so the isometric brush is off. StarCraft never reads ISOM — it is the editor's own record of the diamond lattice — but the brush cannot work without one.")}
            </span>
            <span>
              {t("The Repair plugin rebuilds it from the tiles (Tools ▸ Repair Map…): exact for terrain that was laid down isometrically, a best guess under doodads and for hand-placed tiles.")}
            </span>
          </div>
        )}
        {report?.stale && (
          <div className="hint" style={{ padding: "8px 10px", display: "grid", gap: 8 }}>
            <span>
              {t("The ISOM is behind the tiles on about {stalePct}% of the map — terrain edited with the Rect or Tile brush, or another tool. Isometric strokes near those areas will not join up until it is rebuilt (Tools ▸ Repair Map…, from the Repair plugin).", { stalePct })}
            </span>
            {inherentPct > 0 && (
              <span>
                {t("A rebuild leaves about {inherentPct}% that no diamond lattice describes; that part cannot be brought back in step by any tool.", { inherentPct })}
              </span>
            )}
          </div>
        )}
        {report && !report.stale && inherentPct > 0 && (
          <div className="hint" style={{ padding: "8px 10px", display: "grid", gap: 8 }}>
            <span>
              {t("About {inherentPct}% of the map is terrain no diamond lattice describes — hand-placed tiles, blends, or ground another editor laid. Isometric strokes there will not join up, and rebuilding the lattice will not change that. The Rect, Tile and Blend brushes work as usual.", { inherentPct })}
            </span>
          </div>
        )}
      </div>
      <div className="palette-footer"><span>{t("{length} terrain types", { length: list.length })}</span><span>{info.name}</span></div>
      <SymmetryNote applies={false} />
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
        <span className="lbl">{current ? `${current.buildable ? t("Buildable") : t("Unbuildable")} · ${heightLabel(current.height)}` : ""}</span>
      </div>
      {current && loaded && (
        <div className="variation-strip" role="radiogroup" aria-label={t("Variation")}>
          <Tip label={t("Random variation (StarEdit's mix)")}>
            <button className={`variation ${chosen < 0 ? "is-active" : ""}`} onClick={() => setVariation(-1)} aria-label={t("Random variation")}>
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
          <NoTileset loading={!error} what={t("the Rect brush needs them to know which tiles make up each terrain.")} />
        )}
        <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
          {types.map((t) => (
            <div key={t.id} className={`item ${current?.id === t.id ? "selected" : ""}`} onClick={() => { setActive(t.id); setVariation(-1); }}>
              <TileThumb loaded={loaded} id={t.group << 4} size={18} className="swatch" />
              <span>{translate(t.name)}</span>
              <span className="elev">{heightLabel(t.height)}{t.buildable ? "" : " · ✕"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="palette-footer">
        <span>{current ? t("{name} · groups {group}/{v}", { name: current.name, group: current.group, v: current.group + 1 }) : "—"}</span>
        <span>{chosen < 0 ? t("random variation") : t("variation {chosen}", { chosen })}</span>
      </div>
      <SymmetryNote applies />
    </>
  );
}

/* ── Tile: any single megatile, browsed or typed ────────── */

const KIND_FILTERS: { value: GroupKind | "all"; label: string }[] = [
  { value: "all", label: msg("All groups") },
  { value: "terrain", label: msg("Flat terrain") },
  { value: "edge", label: msg("Cliffs & edges") },
  { value: "doodad", label: msg("Doodad tiles") },
  { value: "other", label: msg("Unlisted") },
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
      <span>{ti ? t("{label} · g{group} s{slot}", { label: ti.label, group: ti.group, slot: ti.slot }) : `group ${id >> 4} · slot ${id & 15}`}</span>
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
        <span className="lbl">{t("Tile #")}</span>
        <input
          className="input mono"
          style={{ width: 72 }}
          value={text ?? String(active)}
          onChange={(e) => setText(e.target.value)}
          onBlur={commitText}
          onKeyDown={(e) => { if (e.key === "Enter") commitText(); if (e.key === "Escape") setText(null); }}
          aria-label={t("Tile id (decimal or 0x hex)")}
        />
        <span className="mono dim" style={{ fontSize: 11 }}>{hexTile(active)}</span>
      </div>
      <div className="tile-info">
        <TileThumb loaded={loaded} id={active} size={64} className="preview" />
        <div className="props" style={{ gridTemplateColumns: "56px 1fr" }}>
          <span className="k">{t("Group")}</span><span><NumberInput value={active >> 4} onChange={(g) => setActive((g << 4) | (active & 15))} min={0} max={4095} width={84} /></span>
          <span className="k">{t("Slot")}</span><span><NumberInput value={active & 15} onChange={(s) => setActive((active & ~15) | s)} min={0} max={15} width={84} /></span>
          <span className="k">{t("Brush")}</span><span><BrushSelect bare /></span>
          <span className="k">{t("MegaTile")}</span><span className="mono">{ti ? (ti.megatile >= 0 ? ti.megatile : "none") : "—"}</span>
          <span className="k">{t("Ground")}</span><span>{ti ? `${heightLabel(ti.height)} · ${ti.buildable ? "buildable" : "unbuildable"}` : "—"}</span>
          <span className="k">{t("Walkable")}</span><span>{ti ? `${ti.walkable} / 16` : "—"}</span>
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
            placeholder={t("Search groups…")}
            aria-label={t("Search tile groups")}
          />
          {query !== "" && <button className="clear" onClick={() => setQuery("")} aria-label={t("Clear search")}><X size={11} /></button>}
        </div>
        <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value as GroupKind | "all")} aria-label={t("Group filter")}>
          {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{translate(f.label)}</option>)}
        </select>
        <Tip label={t("Grouped rows")}>
          <Button icon size="sm" active={view === "groups"} onClick={() => setView("groups")} aria-label={t("Grouped rows")}><Rows3 size={13} /></Button>
        </Tip>
        <Tip label={t("All tiles in one grid")}>
          <Button icon size="sm" active={view === "grid"} onClick={() => setView("grid")} aria-label={t("All tiles in one grid")}><LayoutGrid size={13} /></Button>
        </Tip>
      </div>
      {loaded ? (
        view === "grid"
          ? <TileGrid loaded={loaded} tiles={tiles} selected={active} onSelect={setActive} />
          : <TileBrowser loaded={loaded} groups={groups} selected={active} onSelect={setActive} />
      ) : (
        <div className="palette-scroll">
          <NoTileset loading={!error} what={t("nothing to browse. Ids still paint; the map shows flat colour until they are installed.")} />
        </div>
      )}
      <SelectedTileFooter id={active} />
      {loaded && (
        <div className="palette-footer sub">
          <span>{view === "grid" ? t("{length} tiles", { length: tiles.length }) : t("{length} / {length2} groups", { length: groups.length, length2: all.length })}</span>
          <span>{t("Alt+click map picks")}</span>
        </div>
      )}
      <SymmetryNote applies />
    </>
  );
}

/* ── Blend: tiles whose edges continue the one you picked ── */

const SIDE_LABEL: Record<Side, string> = { left: msg("Left"), top: msg("Top"), right: msg("Right"), bottom: msg("Bottom") };

/** One side's matches as a wrapping strip of thumbnails, best seam first. */
function BlendSide({ side, list, loaded, onPick }: { side: Side; list: BlendCandidate[]; loaded: NonNullable<ReturnType<typeof useTileset>["loaded"]>; onPick: (side: Side, id: number) => void }) {
  return (
    <section className="blend-side">
      <header>
        <span>{SIDE_LABEL[side]}</span>
        <span className="dim">{list.length === 0 ? t("no match") : t("{length, plural, one {# match} other {# matches}}", { length: list.length })}</span>
      </header>
      {list.length > 0 && (
        <div className="blend-grid">
          {list.map((c) => (
            <button
              key={c.id}
              className={`blend-tile ${c.distance < 2 ? "exact" : ""}`}
              onClick={() => onPick(side, c.id)}
              title={t("{tile} · group {group} slot {slot} · Δ {distance} — place {side} of the anchor", { tile: hexTile(c.id), group: c.id >> 4, slot: c.id & 15, distance: c.distance.toFixed(1), side: translate(SIDE_LABEL[side]).toLowerCase() })}
            >
              <TileThumb loaded={loaded} id={c.id} size={28} />
              <span className="d mono">{c.distance < 9.95 ? c.distance.toFixed(1) : Math.round(c.distance)}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function BlendTab() {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded, error } = useTileset();
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(terrainRevisionAtom); // the anchor's tile changes under undo and other brushes
  const [anchor, setAnchor] = useAtom(blendAnchorAtom);
  const [follow, setFollow] = useAtom(blendFollowAtom);
  const [tolerance, setTolerance] = useState(DEFAULT_BLEND_OPTIONS.maxDistance);
  const [kind, setKind] = useState<GroupKind | "all">("all");
  const tools = useTerrainTools();

  const at = scenario && anchor && inMap(scenario, anchor) ? anchor : null;
  const anchorId = scenario && at ? scenario.tiles[at.y * scenario.width + at.x] : null;
  const ti = loaded && anchorId !== null ? tileInfo(loaded.tileset, info.terrain, anchorId) : null;
  const kindOf = useMemo(() => (loaded ? new Map(tileGroups(loaded.tileset, info.terrain).map((g) => [g.group, g.kind])) : null), [loaded, info]);
  const sides = useMemo(() => {
    if (!loaded || anchorId === null) return null;
    const include = kind === "all" || !kindOf ? undefined : (id: number) => kindOf.get(id >> 4) === kind;
    return blendSides(loaded.tileset, anchorId, { ...DEFAULT_BLEND_OPTIONS, maxDistance: tolerance, include });
  }, [loaded, anchorId, tolerance, kind, kindOf]);
  const total = sides ? SIDES.reduce((n, s) => n + sides[s].length, 0) : 0;

  return (
    <>
      <div className="palette-toolbar">
        <span className="lbl">{t("Tolerance")}</span>
        <Tip label={t("Largest edge difference still listed (0 = pixel-identical seams only)")}>
          <span><NumberInput value={tolerance} onChange={setTolerance} min={0} max={128} width={64} /></span>
        </Tip>
        <Check label={t("Follow")} title={t("After placing a match, move the anchor onto it so the next pick continues the seam")} checked={follow} onChange={(e) => setFollow(e.target.checked)} />
        <select className="select grow" value={kind} onChange={(e) => setKind(e.target.value as GroupKind | "all")} aria-label={t("Match filter")}>
          {KIND_FILTERS.map((f) => <option key={f.value} value={f.value}>{translate(f.label)}</option>)}
        </select>
      </div>
      <div className="tile-info blend-anchor">
        <TileThumb loaded={loaded} id={anchorId ?? 0} size={64} className="preview" style={{ opacity: anchorId === null ? 0.3 : 1 }} />
        <div className="props" style={{ gridTemplateColumns: "56px 1fr" }}>
          <span className="k">{t("Anchor")}</span>
          <span>{at && anchorId !== null ? <span className="mono">{hexTile(anchorId)} <span className="dim">at {at.x}, {at.y}</span></span> : <span className="dim">{t("click a tile on the map")}</span>}</span>
          <span className="k">{t("Group")}</span><span>{ti ? t("{label} · g{group} s{slot}", { label: ti.label, group: ti.group, slot: ti.slot }) : "—"}</span>
          <span className="k">{t("Ground")}</span><span>{ti ? `${heightLabel(ti.height)} · ${ti.buildable ? "buildable" : "unbuildable"}` : "—"}</span>
          <span className="k" />
          <span>{at && <Button size="sm" onClick={() => setAnchor(null)}>{t("Clear")}</Button>}</span>
        </div>
      </div>
      <div className="palette-scroll">
        {!loaded && (
          <NoTileset loading={!error} what={t("the Blend brush compares tile pixels, so it needs them.")} />
        )}
        {loaded && !sides && (
          <div className="hint" style={{ padding: 12, display: "grid", gap: 8 }}>
            <span>{t("Click a tile on the map to blend from it. Each side then lists the tiles whose facing edge continues that tile's pixels — the joins the cliff sets never had.")}</span>
            <span>{t("Clicking a match places it next to the anchor on that side; with")}{" "}<strong>{t("Follow")}</strong> {" "}{t("on, the anchor moves onto it so you can walk a seam one tile at a time.")}</span>
          </div>
        )}
        {loaded && sides && SIDES.map((s) => <BlendSide key={s} side={s} list={sides[s]} loaded={loaded} onPick={tools.blendAt} />)}
      </div>
      <div className="palette-footer">
        <span>{sides ? t("{total} matches ≤ Δ{tolerance}", { total, tolerance }) : "—"}</span>
        <span>{t("Δ = mean edge colour difference")}</span>
      </div>
      <SymmetryNote applies={false} />
    </>
  );
}

/* ── Panel ──────────────────────────────────────────────── */

export default function TerrainPalette() {
  const [mode, setMode] = useAtom(terrainModeAtom);
  const [placement, setPlacement] = useAtom(placementOptionsAtom);
  const scenario = useAtomValue(scenarioAtom);
  const activeTerrain = useAtomValue(activeTerrainAtom);
  const layer = useAtomValue(activeLayerAtom);
  const markedArea = useAtomValue(clipSelectionAtom);
  const pluginItems = useAtomValue(pluginContextItemsAtom);
  const tools = useTerrainTools();

  // The palette's own menu, then whatever plugins registered for the "terrainPalette" surface.
  const rows: { label: string; disabled?: boolean; onSelect?: () => void; sep?: boolean }[] = [
    { label: mode === "tile" ? t("Fill Map with This Tile") : t("Fill Map with This Terrain"), disabled: !scenario || mode === "blend", onSelect: tools.fillMap },
  ];
  const pluginRows = pluginContextRows(pluginItems, "terrainPalette", { surface: "terrainPalette", tile: null, point: null, layer, terrainMode: mode, terrain: activeTerrain, markedArea });
  if (pluginRows.length > 0) rows.push({ label: "", sep: true }, ...pluginRows);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className="terrain-palette" style={{ display: "contents" }}>
      <div className="placement-options" title={t("What a terrain edit does to the units on it")}>
        <Check
          label={t("Remove stranded units")}
          title={t("When the new terrain can no longer hold a unit standing on it (e.g. water under a base, unbuildable ground under a building), delete it as part of the same edit")}
          checked={placement.removeStranded}
          onChange={(e) => setPlacement({ ...placement, removeStranded: e.target.checked })}
        />
      </div>
      <Tabs
        compact
        value={mode}
        onValueChange={(v) => setMode(v as TerrainMode)}
        tabs={[
          { value: "isom", label: t("Isometric"), content: <IsomTab /> },
          { value: "rect", label: t("Rect"), content: <RectTab /> },
          { value: "tile", label: t("Tile"), content: <TileTab /> },
          { value: "blend", label: t("Blend"), content: <BlendTab /> },
        ]}
      />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="menu-content">
          {rows.map((it, i) =>
            it.sep ? (
              <ContextMenu.Separator key={i} className="menu-separator" />
            ) : (
              <ContextMenu.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect}>
                {it.label}
              </ContextMenu.Item>
            ),
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
