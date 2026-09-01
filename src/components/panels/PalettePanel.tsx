import { useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Brush,
  ChevronDown,
  ChevronRight,
  CloudFog,
  Clipboard,
  Mountain,
  Pencil,
  Plus,
  Search,
  Sparkles,
  SquareDashed,
  Trash2,
  TreePine,
  Users,
} from "lucide-react";
import {
  activeDoodadAtom,
  activeLayerAtom,
  activeSpriteAtom,
  activeSpriteKindAtom,
  activeUnitAtom,
  activeUnitSpriteAtom,
  doodadCategoryAtom,
  doodadPlacementAtom,
  doodadPlacingAtom,
  fogModeAtom,
  fogPlayersAtom,
  fogViewPlayerAtom,
  mapTilesetAtom,
  placementOptionsAtom,
  spritePlaceOptionsAtom,
  spritePlacingAtom,
  unitOwnerAtom,
  unitPlacingAtom,
  viewFlagsAtom,
  type EditorLayer,
} from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { ALL_FOG_PLAYERS, FOG_PLAYERS, fogCount, playerBit } from "../../editor/fog";
import { useFogTools } from "../../hooks/useFogTools";
import { TILESET_BY_ID } from "../../data/tilesets";
import { playerColorHex } from "../../data/players";
import { RACE_LABEL, UNIT_GROUPS, unitName, type RaceKey } from "../../data/units";
import { SPRITE_COUNT, spriteCatalogue } from "../../data/sprites";
import { SpriteFlag } from "../../formats/chk/sections/objects";
import type { SpriteKind } from "../../editor/sprites";
import { spriteName } from "../../hooks/useSpriteTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { SAMPLE_LOCATIONS } from "../../data/samples";
import { Button, Check, Tabs, Tip } from "../ui";
import TerrainPalette, { BrushSelect } from "./TerrainPalette";
import { DoodadThumb } from "./DoodadThumb";
import { useDoodadTools } from "../../hooks/useDoodadTools";

/* ── Layer rail ─────────────────────────────────────────── */

const RAIL: { id: EditorLayer; label: string; key: string; icon: typeof Mountain }[] = [
  { id: "terrain", label: "Terrain", key: "T", icon: Mountain },
  { id: "doodads", label: "Doodads", key: "D", icon: TreePine },
  { id: "units", label: "Units", key: "U", icon: Users },
  { id: "sprites", label: "Sprites", key: "S", icon: Sparkles },
  { id: "locations", label: "Locations", key: "L", icon: SquareDashed },
  { id: "fog", label: "Fog of War", key: "F", icon: CloudFog },
  { id: "clipboard", label: "Cut / Copy / Paste", key: "C", icon: Clipboard },
];

export const RAIL_ICON = Object.fromEntries(RAIL.map((r) => [r.id, r.icon])) as Record<EditorLayer, typeof Mountain>;

/* ── Terrain ────────────────────────────────────────────── */

/** Tint a base colour toward light/dark by a factor. */
export function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * (1 + amt))));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/* ── Doodads ────────────────────────────────────────────── */

/**
 * The tileset's doodads by StarEdit category, drawn from the tileset graphics. Picking one
 * arms placement; the two options are StarEdit's own defaults — ground checks on, left
 * column snapped to the two-tile isometric grid.
 */
function DoodadPalette() {
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const [category, setCategory] = useAtom(doodadCategoryAtom);
  const [active, setActive] = useAtom(activeDoodadAtom);
  const [placing, setPlacing] = useAtom(doodadPlacingAtom);
  const [options, setOptions] = useAtom(doodadPlacementAtom);
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const scenario = useAtomValue(scenarioAtom);
  const { loaded, catalogue } = useDoodadTools();
  const colors = scenario?.playerColors;
  const categories = catalogue.categories;
  const current = categories.find((c) => c.name === category) ?? categories[0] ?? null;
  const pick = (id: number) => { setActive(id); setPlacing(true); };
  const activeDef = catalogue.byId.get(active);
  const option = (key: keyof typeof options, label: string, title: string) => (
    <Check label={label} title={title} checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} />
  );

  return (
    <>
      <div className="owner-strip" title="Owner of the doodads you place (matters for Installation doors and traps)">
        {Array.from({ length: 12 }, (_, i) => (
          <Tip key={i} label={`Player ${i + 1}`} side="right">
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: playerColorHex(colors, i) }} onClick={() => setOwner(i)}>
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="palette-toolbar">
        <select className="select grow" value={current?.name ?? ""} onChange={(e) => setCategory(e.target.value)} aria-label="Doodad category" disabled={categories.length === 0}>
          {categories.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.doodads.length})</option>)}
        </select>
      </div>
      <div className="placement-options" title="Placement options">
        {option("placeAnywhere", "Place anywhere", "Skip StarEdit's ground check: put any doodad on any terrain, even over another doodad. Off, a doodad only goes where dddata.bin says its tiles fit — ramps on their cliff edge, trees on their ground.")}
        {option("snapToGrid", "Snap to grid", "Keep the doodad's left column on an even tile, the two-tile isometric grid StarEdit places every doodad on and the requirement tables are drawn for.")}
      </div>
      <div className="palette-scroll">
        {!loaded && (
          <div className="hint" style={{ padding: 8 }}>
            Doodads come from the tileset graphics. Run <code>node scripts/extract-tilesets.mjs</code> against a StarCraft install to fill <code>public/tileset/</code>.
          </div>
        )}
        {loaded && !catalogue.hasPlacementData && (
          <div className="hint" style={{ padding: "8px 8px 0" }}>
            No <code>{loaded.name}.dddata.bin</code> — re-run <code>scripts/extract-tilesets.mjs</code> to get StarEdit's placement rules; until then nothing is refused for its ground.
          </div>
        )}
        {current && (
          <div className="doodad-grid">
            {current.doodads.map((d) => (
              <button
                key={d.id}
                className={`doodad ${active === d.id ? "selected" : ""}`}
                onClick={() => pick(d.id)}
                title={`${d.category} #${d.id} — ${d.width}×${d.height} tiles${d.overlay ? `, ${d.overlay.kind} overlay ${d.overlay.id}` : ""}${d.required.some((r) => r !== 0) ? "" : ", any ground"} — click to place`}
              >
                <span className="thumb"><DoodadThumb loaded={loaded} def={d} width={56} height={40} /></span>
                <span className="lbl">#{d.id} · {d.width}×{d.height}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="palette-footer">
        <span>
          {activeDef
            ? placing ? <>Placing {activeDef.category} #{activeDef.id} <span className="faint">· Esc stops</span></> : <>{activeDef.category} #{activeDef.id} <span className="faint">· select mode</span></>
            : <>{catalogue.doodads.length} doodads</>}
        </span>
        <span>{tileset.name}</span>
      </div>
    </>
  );
}

/* ── Units ──────────────────────────────────────────────── */

function UnitPalette() {
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const [active, setActive] = useAtom(activeUnitAtom);
  const [placing, setPlacing] = useAtom(unitPlacingAtom);
  const [placement, setPlacement] = useAtom(placementOptionsAtom);
  const scenario = useAtomValue(scenarioAtom);
  /** Picking a unit arms placement: the next click on the map places it. */
  const pick = (id: number) => { setActive(id); setPlacing(true); };
  const option = (key: keyof typeof placement, label: string, title: string) => (
    <Check label={label} title={title} checked={placement[key]} onChange={(e) => setPlacement({ ...placement, [key]: e.target.checked })} />
  );
  const colors = scenario?.playerColors;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ "Terran Units": true, "Special": true });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UNIT_GROUPS
      .map((g) => ({ ...g, units: q ? g.units.filter((id) => unitName(id).toLowerCase().includes(q) || String(id) === q) : g.units }))
      .filter((g) => g.units.length > 0);
  }, [query]);

  const races: RaceKey[] = ["terran", "zerg", "protoss", "neutral"];

  return (
    <>
      <div className="owner-strip" title="Unit owner">
        {Array.from({ length: 12 }, (_, i) => (
          <Tip key={i} label={`Player ${i + 1}`} side="right">
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: playerColorHex(colors, i) }} onClick={() => setOwner(i)}>
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="palette-toolbar">
        <Search size={12} className="faint" />
        <input className="input grow" placeholder="Search units…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="placement-options" title="Placement checks">
        {option("checkCollision", "No overlap", "Refuse to place or drop a ground unit or building on top of another")}
        {option("checkTerrain", "Check terrain", "Refuse unwalkable ground for units and unbuildable tiles for buildings")}
        {option("snapToGrid", "Snap to grid", "Buildings snap their placement box to the tile grid, as StarEdit always does; off, they land exactly at the pointer")}
      </div>
      <div className="palette-scroll tree">
        {races.map((race) => {
          const rg = groups.filter((g) => g.race === race);
          if (rg.length === 0) return null;
          return (
            <div key={race}>
              <div className="node group">
                <span className="twisty" />
                <span className="swatch" style={{ background: race === "terran" ? "#5b8fd9" : race === "zerg" ? "#b25ad0" : race === "protoss" ? "#e6b95c" : "#8a94a6" }} />
                {RACE_LABEL[race]}
              </div>
              {rg.map((g) => {
                const isOpen = query ? true : (open[g.label] ?? false);
                return (
                  <div key={g.label}>
                    <div className="node" style={{ paddingLeft: 12 }} onClick={() => setOpen({ ...open, [g.label]: !isOpen })}>
                      <span className="twisty">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                      <span className="dim">{g.label}</span>
                      <span className="faint" style={{ marginLeft: "auto", fontSize: 10 }}>{g.units.length}</span>
                    </div>
                    {isOpen && g.units.map((id) => (
                      <div key={id} className={`node ${active === id ? "selected" : ""}`} style={{ paddingLeft: 40 }} onClick={() => pick(id)} title={`Unit #${id} — click to place`}>
                        {unitName(id)}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="palette-footer">
        <span>{placing ? <>Placing {unitName(active)} <span className="faint">· Esc stops</span></> : <>{unitName(active)} <span className="mono">#{active}</span> <span className="faint">· select mode</span></>}</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: playerColorHex(colors, owner), width: 10, height: 10 }} />P{owner + 1}</span>
      </div>
    </>
  );
}

/* ── Sprites ────────────────────────────────────────────── */

interface PickerGroup { label: string; items: { id: number; label: string }[] }

/** A collapsible, searchable tree of ids; the shape both sprite tabs share. */
function GroupedPicker({ groups, active, onPick, query, defaultOpen, title }: { groups: PickerGroup[]; active: number; onPick: (id: number) => void; query: string; defaultOpen: (label: string) => boolean; title: (id: number) => string }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const q = query.trim().toLowerCase();
  const shown = groups
    .map((g) => ({ ...g, items: q ? g.items.filter((it) => it.label.toLowerCase().includes(q) || String(it.id) === q) : g.items }))
    .filter((g) => g.items.length > 0);
  return (
    <div className="palette-scroll tree">
      {shown.length === 0 && <div className="hint" style={{ padding: 8 }}>Nothing matches "{query}".</div>}
      {shown.map((g) => {
        const isOpen = q ? true : (open[g.label] ?? defaultOpen(g.label));
        return (
          <div key={g.label}>
            <div className="node" onClick={() => setOpen({ ...open, [g.label]: !isOpen })}>
              <span className="twisty">{isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
              <span className="dim">{g.label}</span>
              <span className="faint" style={{ marginLeft: "auto", fontSize: 10 }}>{g.items.length}</span>
            </div>
            {isOpen && g.items.map((it) => (
              <div key={it.id} className={`node ${active === it.id ? "selected" : ""}`} style={{ paddingLeft: 28 }} onClick={() => onPick(it.id)} title={title(it.id)}>
                <span className="mono faint" style={{ width: 30, flex: "none" }}>{it.id}</span>
                {it.label}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * THG2 sprites: pure sprites (a sprites.dat graphic, drawn as-is) and unit sprites (a
 * unit the game creates on load — Installation doors and traps). Picking one arms
 * placement, like the Units palette. Names come from the loaded unit tables.
 */
function SpritePalette() {
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const [kind, setKind] = useAtom(activeSpriteKindAtom);
  const [active, setActive] = useAtom(activeSpriteAtom);
  const [activeUnit, setActiveUnit] = useAtom(activeUnitSpriteAtom);
  const [placing, setPlacing] = useAtom(spritePlacingAtom);
  const [options, setOptions] = useAtom(spritePlaceOptionsAtom);
  const scenario = useAtomValue(scenarioAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const { loaded: assets, error } = useUnitAssets();
  const [query, setQuery] = useState("");
  const colors = scenario?.playerColors;

  const pureGroups = useMemo<PickerGroup[]>(() => {
    if (!assets) return [{ label: "Sprites", items: Array.from({ length: SPRITE_COUNT }, (_, id) => ({ id, label: `Sprite #${id}` })) }];
    const cat = spriteCatalogue(assets);
    return cat.groups.map((g) => ({ label: g.label, items: g.ids.map((id) => ({ id, label: cat.entries[id].label })) }));
  }, [assets]);
  const unitGroups = useMemo<PickerGroup[]>(() => UNIT_GROUPS.map((g) => ({ label: g.label, items: g.units.map((id) => ({ id, label: unitName(id) })) })), []);

  const pick = (k: SpriteKind, id: number) => { setKind(k); (k === "pure" ? setActive : setActiveUnit)(id); setPlacing(true); };
  const activeId = kind === "pure" ? active : activeUnit;
  const activeLabel = spriteName(assets, kind, activeId);
  const count = scenario ? scenario.sprites.filter((r) => (r.flags & SpriteFlag.PureSprite) !== 0).length : 0;

  return (
    <>
      <div className="owner-strip" title="Sprite owner">
        {Array.from({ length: 12 }, (_, i) => (
          <Tip key={i} label={`Player ${i + 1}`} side="right">
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: playerColorHex(colors, i) }} onClick={() => setOwner(i)}>
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="palette-toolbar">
        <Search size={12} className="faint" />
        <input className="input grow" placeholder="Search sprites…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="placement-options" title="Flags on newly placed sprites">
        <Check label="Flipped" title="Mirror the graphic left-to-right (THG2 flag 0x2000)" checked={options.flipped} onChange={(e) => setOptions({ ...options, flipped: e.target.checked })} />
        <Check label="Disabled" title="Unit sprites only: the unit starts inactive — a closed door, an unarmed trap (THG2 flag 0x8000)" checked={options.disabled} disabled={kind !== "unit"} onChange={(e) => setOptions({ ...options, disabled: e.target.checked })} />
      </div>
      <Tabs
        compact
        value={kind}
        onValueChange={(v) => setKind(v as SpriteKind)}
        tabs={[
          {
            value: "pure",
            label: "Pure Sprites",
            content: (
              <>
                {error && <div className="hint" style={{ padding: "4px 8px" }}>Unit data not installed — sprites are listed by id and drawn as markers.</div>}
                <GroupedPicker groups={pureGroups} active={active} onPick={(id) => pick("pure", id)} query={query} defaultOpen={(l) => l === "Units" || l === `Doodads · ${tileset.name}`} title={(id) => `Sprite #${id} — click to place`} />
                <div className="palette-footer"><span>{count} pure sprite{count === 1 ? "" : "s"} on the map</span><span>THG2</span></div>
              </>
            ),
          },
          {
            value: "unit",
            label: "Unit Sprites",
            content: (
              <>
                <GroupedPicker groups={unitGroups} active={activeUnit} onPick={(id) => pick("unit", id)} query={query} defaultOpen={(l) => l === "Special"} title={(id) => `Unit #${id} as a sprite — click to place`} />
                <div className="palette-footer"><span>{scenario ? scenario.sprites.length - count : 0} unit sprite{scenario && scenario.sprites.length - count === 1 ? "" : "s"} on the map</span><span>becomes a unit on load</span></div>
              </>
            ),
          },
        ]}
      />
      <div className="palette-footer">
        <span>{placing ? <>Placing {activeLabel} <span className="faint">· Esc stops</span></> : <>{activeLabel} <span className="mono">#{activeId}</span> <span className="faint">· select mode</span></>}</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: playerColorHex(colors, owner), width: 10, height: 10 }} />P{owner + 1}</span>
      </div>
    </>
  );
}

/* ── Locations ──────────────────────────────────────────── */

function LocationPalette() {
  const open = useSetAtom(openDialogAtom);
  const [sel, setSel] = useState(1);
  return (
    <>
      <div className="palette-toolbar">
        <Tip label="New location"><Button size="sm" icon><Plus size={12} /></Button></Tip>
        <Tip label="Rename / properties"><Button size="sm" icon onClick={() => open("locationProperties", { location: SAMPLE_LOCATIONS[sel] })}><Pencil size={12} /></Button></Tip>
        <Tip label="Delete"><Button size="sm" icon disabled={sel === 0}><Trash2 size={12} /></Button></Tip>
        <span className="grow" />
        <Check label="Snap to grid" defaultChecked />
      </div>
      <div className="palette-scroll">
        {SAMPLE_LOCATIONS.map((l, i) => (
          <div key={l.id} className={`loc-row ${sel === i ? "selected" : ""}`} onClick={() => setSel(i)} onDoubleClick={() => open("locationProperties", { location: l })}>
            <span className="n">{l.id}</span>
            <span>{l.name}</span>
            <span className="coords">{l.x},{l.y} {l.w}×{l.h}</span>
          </div>
        ))}
      </div>
      <div className="palette-footer"><span>{SAMPLE_LOCATIONS.length} / 255 locations</span><span>Double-click to edit</span></div>
    </>
  );
}

/* ── Fog of war ─────────────────────────────────────────── */

/**
 * The MASK section's editor: tick the players to paint for, choose whether the brush
 * lays fog (unexplored) or clears it, and view any one player's fog. Whole-map
 * operations and player-to-player copies act on the selected players.
 */
function FogPalette() {
  const [players, setPlayers] = useAtom(fogPlayersAtom);
  const [mode, setMode] = useAtom(fogModeAtom);
  const [view, setView] = useAtom(fogViewPlayerAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const scenario = useAtomValue(scenarioAtom);
  const revision = useAtomValue(terrainRevisionAtom);
  const tools = useFogTools();
  const [copySource, setCopySource] = useState(0);
  const colors = scenario?.playerColors;
  const hasMap = scenario !== null;

  const fogged = useMemo(() => (scenario ? fogCount(scenario, view) : 0), [scenario, view, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = scenario ? scenario.width * scenario.height : 0;
  const pct = total > 0 ? Math.round((100 * fogged) / total) : 0;

  /** Toggle a player; the view follows the first selected player when it would otherwise show a deselected one. */
  const toggle = (p: number) => {
    const next = players ^ playerBit(p);
    setPlayers(next);
    if (next !== 0 && !(next & playerBit(view))) {
      for (let i = 0; i < FOG_PLAYERS; i++) if (next & playerBit(i)) { setView(i); break; }
    }
  };
  const selected = Array.from({ length: FOG_PLAYERS }, (_, i) => (players & playerBit(i)) !== 0);
  const selectedCount = selected.filter(Boolean).length;
  const copyTargets = players & ~playerBit(copySource);

  return (
    <>
      <div className="fog-head">
        <span className="lbl">Players</span>
        <span className="faint">{selectedCount === 0 ? "none selected" : selectedCount === FOG_PLAYERS ? "all selected" : `${selectedCount} selected`}</span>
        <span className="grow" />
        <Button size="sm" onClick={() => setPlayers(ALL_FOG_PLAYERS)} disabled={players === ALL_FOG_PLAYERS} title="Select all eight players">All</Button>
        <Button size="sm" onClick={() => setPlayers(0)} disabled={players === 0} title="Deselect every player">None</Button>
      </div>
      <div className="owner-strip fog-players" role="group" aria-label="Selected players" title="Click a player to select or deselect them">
        {selected.map((on, i) => (
          <Tip key={i} label={`Player ${i + 1} — ${on ? "selected" : "not selected"}`} side="right">
            <button
              className={`owner-chip ${on ? "is-active" : ""}`}
              style={{ ["--c" as string]: playerColorHex(colors, i) }}
              onClick={() => toggle(i)}
              aria-pressed={on}
            >
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="hint fog-note">Each player has their own fog. The brush, area fills and the buttons below edit it for the selected players.</div>
      <div className="palette-toolbar">
        <BrushSelect />
        <span className="grow" />
        <span className="seg" role="radiogroup" aria-label="Brush mode">
          <Button size="sm" active={mode === "fog"} onClick={() => setMode("fog")} title="Left-drag lays fog (tiles start unexplored); Shift-drag clears">Fog</Button>
          <Button size="sm" active={mode === "clear"} onClick={() => setMode("clear")} title="Left-drag clears fog (tiles start explored); Shift-drag lays it">Clear</Button>
        </span>
      </div>
      <div className="palette-toolbar">
        <span className="lbl">View</span>
        <select className="select" style={{ width: 84 }} value={view} onChange={(e) => setView(Number(e.target.value))} aria-label="Player whose fog is shown">
          {Array.from({ length: FOG_PLAYERS }, (_, i) => <option key={i} value={i}>Player {i + 1}</option>)}
        </select>
        <span className="grow" />
        <Check label="Show" title="Draw the fog overlay (View ▸ Fog of War)" checked={flags.fog} onChange={(e) => setFlags({ ...flags, fog: e.target.checked })} />
      </div>
      <div className="palette-scroll">
        <div className="fog-actions">
          <fieldset className="group">
            <legend>Whole map</legend>
            <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              <Button size="sm" disabled={!hasMap || players === 0} onClick={() => tools.setAll("fog")} title="Every tile starts unexplored for the selected players">Fog all</Button>
              <Button size="sm" disabled={!hasMap || players === 0} onClick={() => tools.setAll("clear")} title="Every tile starts explored for the selected players">Clear all</Button>
              <Button size="sm" disabled={!hasMap || players === 0} onClick={tools.invert} title="Swap fogged and explored tiles for the selected players">Invert</Button>
            </div>
          </fieldset>
          <fieldset className="group">
            <legend>Copy fog</legend>
            <div className="row" style={{ gap: 6 }}>
              <span className="lbl">From</span>
              <select className="select" style={{ width: 84 }} value={copySource} onChange={(e) => setCopySource(Number(e.target.value))} aria-label="Player to copy fog from">
                {Array.from({ length: FOG_PLAYERS }, (_, i) => <option key={i} value={i}>Player {i + 1}</option>)}
              </select>
            </div>
            <div className="row" style={{ marginTop: 6 }}>
              <Button size="sm" disabled={!hasMap || copyTargets === 0} onClick={() => tools.copyFrom(copySource)} title="Give every selected player exactly this player's fog">
                Copy to selected players
              </Button>
            </div>
          </fieldset>
        </div>
        <div style={{ padding: "0 8px 8px" }} className="hint">
          Drag to paint; <b>Shift</b> paints the opposite of the mode, <b>Alt</b>-click selects the players that have
          fog on a tile. Fogged tiles start the game unexplored and are drawn under the game's own fog darkening;
          the rest start explored. Right-click for area fills.
        </div>
        {hasMap && !scenario.mask && (
          <div style={{ padding: "0 8px 8px" }} className="hint">
            This map has no <strong>MASK</strong> section, which the game reads as fog everywhere; the first stroke adds one.
          </div>
        )}
      </div>
      <div className="palette-footer">
        <span>{hasMap ? <>P{view + 1} · {fogged.toLocaleString()} / {total.toLocaleString()} fogged ({pct}%)</> : "No map open"}</span>
        <span>{mode === "fog" ? "Fog" : "Clear"}</span>
      </div>
    </>
  );
}

/* ── Clipboard ──────────────────────────────────────────── */

function ClipboardPalette() {
  return (
    <>
      <div className="palette-toolbar">
        <span className="lbl">Selection</span>
        <span className="mono dim" style={{ fontSize: 11 }}>— × —</span>
      </div>
      <div className="palette-scroll" style={{ padding: 8 }}>
        <fieldset className="group">
          <legend>Include</legend>
          <div className="col" style={{ gap: 2 }}>
            <Check label="Terrain" defaultChecked />
            <Check label="Doodads" defaultChecked />
            <Check label="Units" defaultChecked />
            <Check label="Sprites" />
            <Check label="Locations" />
            <Check label="Fog of War" />
          </div>
        </fieldset>
        <fieldset className="group" style={{ marginTop: 10 }}>
          <legend>Paste</legend>
          <div className="col" style={{ gap: 2 }}>
            <Check radio name="paste" label="Replace" defaultChecked />
            <Check radio name="paste" label="Merge units & sprites" />
            <Check radio name="paste" label="Terrain only" />
          </div>
        </fieldset>
      </div>
      <div className="palette-footer"><span>Drag on the map to select</span></div>
    </>
  );
}

/* ── Panel ──────────────────────────────────────────────── */

export default function PalettePanel() {
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const body = {
    terrain: <TerrainPalette />,
    doodads: <DoodadPalette />,
    units: <UnitPalette />,
    sprites: <SpritePalette />,
    locations: <LocationPalette />,
    fog: <FogPalette />,
    clipboard: <ClipboardPalette />,
  }[layer];

  return (
    <div className="palette">
      <div className="layer-rail" role="tablist" aria-label="Layers">
        {RAIL.map((r, i) => (
          <span key={r.id} style={{ display: "contents" }}>
            {i === 6 && <span className="rail-sep" />}
            <Tip label={r.label} shortcut={r.key} side="right">
              <button className={`rail-btn ${layer === r.id ? "is-active" : ""}`} onClick={() => setLayer(r.id)} role="tab" aria-selected={layer === r.id}>
                <r.icon size={16} />
              </button>
            </Tip>
          </span>
        ))}
        <span className="rail-sep" />
        <Tip label="Brush settings" side="right">
          <button className="rail-btn"><Brush size={16} /></button>
        </Tip>
      </div>
      <div className="palette-main">{body}</div>
    </div>
  );
}
