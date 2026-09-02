import { useMemo, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Brush,
  ChevronDown,
  ChevronRight,
  CloudFog,
  Clipboard,
  Lock,
  Mountain,
  Pencil,
  Plus,
  Search,
  Sparkles,
  SquareDashed,
  Trash2,
  TreePine,
  Users,
  X,
} from "lucide-react";
import {
  activeDoodadAtom,
  activeLayerAtom,
  clipboardAtom,
  clipPartsAtom,
  clipPasteModeAtom,
  clipPastingAtom,
  clipSelectionAtom,
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
  LOCATION_SNAPS,
  locationSnapAtom,
  mapTilesetAtom,
  placementOptionsAtom,
  selectedLocationsAtom,
  spritePlaceOptionsAtom,
  spritePlacingAtom,
  unitOwnerAtom,
  unitPlacingAtom,
  viewFlagsAtom,
  type EditorLayer,
} from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { locationsAtom, scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { isAnywhereIntact, locationCapacity, locationName } from "../../editor/locations";
import { useLocationTools } from "../../hooks/useLocationTools";
import { ANYWHERE_INDEX, isLocationUsed } from "../../formats/chk/sections/objects";
import { ALL_FOG_PLAYERS, FOG_PLAYERS, fogCount, playerBit } from "../../editor/fog";
import { useFogTools } from "../../hooks/useFogTools";
import { TILESET_BY_ID } from "../../data/tilesets";
import { displayColorHex } from "../../data/players";
import { RACE_LABEL, UNIT_GROUPS, unitName, type RaceKey } from "../../data/units";
import { SPRITE_COUNT, spriteCatalogue, spriteLabel } from "../../data/sprites";
import { SpriteFlag } from "../../formats/chk/sections/objects";
import type { SpriteKind } from "../../editor/sprites";
import { spriteName } from "../../hooks/useSpriteTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import type { UnitAssets } from "../../formats/units/load";
import { Button, Check, Tabs, Tip } from "../ui";
import TerrainPalette, { BrushSelect } from "./TerrainPalette";
import { DoodadThumb } from "./DoodadThumb";
import type { DoodadCategory, DoodadDef } from "../../formats/tileset/doodads";
import { useDoodadTools } from "../../hooks/useDoodadTools";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { CLIP_PARTS, clipSummary, type ClipPart } from "../../editor/clipboard";

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

/** What a doodad's overlay draws — the unit's name, or the sprite's label (unit / GRP file name). */
function doodadOverlayLabel(assets: UnitAssets | null, d: DoodadDef): string | null {
  if (!d.overlay) return null;
  return d.overlay.kind === "unit" ? unitName(d.overlay.id) : spriteLabel(assets, d.overlay.id);
}

/**
 * The tileset's doodads by StarEdit category, drawn from the tileset graphics. Picking one
 * arms placement; the two options are StarEdit's own defaults — ground checks on, left
 * column snapped to the two-tile isometric grid.
 *
 * Doodads have no names of their own — only a category ("Bridges", "Coastal Cliff"), an id
 * and a size — so the search matches those, the word "ramp" for anything the VF4 tags as
 * one (StarEdit files ramps under the cliff categories) and, where a doodad carries an
 * overlay, the sprite / unit name it draws. A query looks across *every* category (the
 * drop-down only scopes the browse view) and lists the hits under their category headings.
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
  const { loaded: assets } = useUnitAssets();
  const [query, setQuery] = useState("");
  const colors = scenario?.playerColors;
  const categories = catalogue.categories;
  const current = categories.find((c) => c.name === category) ?? categories[0] ?? null;
  const pick = (id: number) => { setActive(id); setPlacing(true); };
  const activeDef = catalogue.byId.get(active);
  const overlayLabel = (d: DoodadDef) => doodadOverlayLabel(assets, d);

  const q = query.trim().toLowerCase();
  /** The categories to show, each narrowed to its matches — every category when searching, else the chosen one. */
  const shown = useMemo<DoodadCategory[]>(() => {
    if (!q) return current ? [current] : [];
    const words = q.split(/\s+/);
    const matches = (d: DoodadDef) => {
      const hay = `${d.category} #${d.id} ${d.width}x${d.height} ${d.width}×${d.height} ${d.ramp ? "ramp" : ""} ${doodadOverlayLabel(assets, d) ?? ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    return categories.map((c) => ({ ...c, doodads: c.doodads.filter(matches) })).filter((c) => c.doodads.length > 0);
  }, [q, current, categories, assets]);
  const matchCount = shown.reduce((n, c) => n + c.doodads.length, 0);
  const option = (key: keyof typeof options, label: string, title: string) => (
    <Check label={label} title={title} checked={options[key]} onChange={(e) => setOptions({ ...options, [key]: e.target.checked })} />
  );

  return (
    <>
      <div className="owner-strip" title="Owner of the doodads you place (matters for Installation doors and traps)">
        {Array.from({ length: 12 }, (_, i) => (
          <Tip key={i} label={`Player ${i + 1}`} side="right">
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: displayColorHex(colors, scenario?.playerRgb, i) }} onClick={() => setOwner(i)}>
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="palette-toolbar">
        <div className="search">
          <Search size={12} />
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setQuery(""); }}
            placeholder="Search doodads… (ramp, bridge, #12)"
            aria-label="Search doodads"
            disabled={categories.length === 0}
          />
          {query !== "" && <button className="clear" onClick={() => setQuery("")} aria-label="Clear search"><X size={11} /></button>}
        </div>
        <select
          className="select grow"
          value={current?.name ?? ""}
          onChange={(e) => { setCategory(e.target.value); setQuery(""); }}
          aria-label="Doodad category"
          disabled={categories.length === 0}
          title={q ? "Searching every category — pick one to browse it instead" : undefined}
        >
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
            Doodads come from the tileset graphics. Help ▸ Game Data… installs them from a StarCraft installation.
          </div>
        )}
        {loaded && !catalogue.hasPlacementData && (
          <div className="hint" style={{ padding: "8px 8px 0" }}>
            No <code>{loaded.name}.dddata.bin</code> — install the game data again (Help ▸ Game Data…) to get StarEdit's placement rules; until then nothing is refused for its ground.
          </div>
        )}
        {loaded && q && shown.length === 0 && (
          <div className="hint" style={{ padding: 8 }}>
            No doodads match <b>{query.trim()}</b> in {tileset.name}. Try a category word (ramp, bridge, cliff, rock), a size like 4×2, or an id like #12.
          </div>
        )}
        {shown.map((c) => (
          <div key={c.name} className="doodad-section">
            {q && (
              <div className="doodad-section-head">
                <span>{c.name}</span>
                <span className="faint">{c.doodads.length}</span>
              </div>
            )}
            <div className="doodad-grid">
              {c.doodads.map((d) => {
                const overlay = overlayLabel(d);
                return (
                  <button
                    key={d.id}
                    className={`doodad ${active === d.id ? "selected" : ""}`}
                    onClick={() => pick(d.id)}
                    title={`${d.category} #${d.id} — ${d.width}×${d.height} tiles${d.ramp ? ", ramp" : ""}${overlay ? `, ${d.overlay!.kind} overlay: ${overlay}` : ""}${d.required.some((r) => r !== 0) ? "" : ", any ground"} — click to place`}
                  >
                    <span className="thumb"><DoodadThumb loaded={loaded} def={d} width={56} height={40} /></span>
                    <span className="lbl">#{d.id} · {d.width}×{d.height}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="palette-footer">
        <span>
          {activeDef
            ? placing ? <>Placing {activeDef.category} #{activeDef.id} <span className="faint">· Esc stops</span></> : <>{activeDef.category} #{activeDef.id} <span className="faint">· select mode</span></>
            : <>{catalogue.doodads.length} doodads</>}
        </span>
        <span>{q ? <>{matchCount} of {catalogue.doodads.length} match · </> : null}{tileset.name}</span>
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
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: displayColorHex(colors, scenario?.playerRgb, i) }} onClick={() => setOwner(i)}>
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
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: displayColorHex(colors, scenario?.playerRgb, owner), width: 10, height: 10 }} />P{owner + 1}</span>
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
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: displayColorHex(colors, scenario?.playerRgb, i) }} onClick={() => setOwner(i)}>
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
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: displayColorHex(colors, scenario?.playerRgb, owner), width: 10, height: 10 }} />P{owner + 1}</span>
      </div>
    </>
  );
}

/* ── Locations ──────────────────────────────────────────── */

const fmtTile = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/**
 * The MRGN slots in use, Anywhere pinned first with a lock. A row selects (Shift adds)
 * and scrolls the map to the location when it is off screen; double-click opens its
 * properties. Locations are made on the map — drag on empty ground — or with New, which
 * drops a 4×4-tile one in the middle of the view.
 */
function LocationPalette() {
  const scenario = useAtomValue(scenarioAtom);
  const locations = useAtomValue(locationsAtom);
  const selected = useAtomValue(selectedLocationsAtom);
  const [snap, setSnap] = useAtom(locationSnapAtom);
  const open = useSetAtom(openDialogAtom);
  const tools = useLocationTools();
  const anywhere = scenario?.locations[ANYWHERE_INDEX];
  const anywhereUsed = !!scenario && !!anywhere && isLocationUsed(anywhere);
  const intact = !!scenario && isAnywhereIntact(scenario);
  const capacity = scenario ? locationCapacity(scenario) - 1 : 0;
  const first = selected[0];
  const pick = (index: number, e: React.MouseEvent) => {
    tools.select([index], e.shiftKey);
    if (!e.shiftKey && index !== ANYWHERE_INDEX && !tools.inView(index)) tools.centerOn(index);
  };

  return (
    <>
      <div className="palette-toolbar">
        <Tip label="New location — 4×4 tiles in the middle of the view (or drag on the map)"><Button size="sm" icon disabled={!scenario} onClick={() => tools.createInView()}><Plus size={12} /></Button></Tip>
        <Tip label="Location properties"><Button size="sm" icon disabled={first === undefined} onClick={() => open("locationProperties", { index: first })}><Pencil size={12} /></Button></Tip>
        <Tip label="Delete"><Button size="sm" icon disabled={!selected.some((i) => i !== ANYWHERE_INDEX)} onClick={() => tools.deleteSelected()}><Trash2 size={12} /></Button></Tip>
        <span className="grow" />
        <label className="row" style={{ gap: 4 }} title="The grid a create, move or resize snaps to">
          <span className="faint" style={{ fontSize: 11 }}>Snap</span>
          <select className="select" aria-label="Location snap" value={snap} onChange={(e) => setSnap(Number(e.target.value))} style={{ width: 66 }}>
            {LOCATION_SNAPS.map((s) => <option key={s} value={s}>{s === 0 ? "off" : s === 32 ? "tile" : `${s} px`}</option>)}
          </select>
        </label>
      </div>
      <div className="palette-scroll">
        {anywhereUsed && (
          <div
            className={`loc-row anywhere ${selected.includes(ANYWHERE_INDEX) ? "selected" : ""}`}
            onClick={(e) => pick(ANYWHERE_INDEX, e)}
            onDoubleClick={() => open("locationProperties", { index: ANYWHERE_INDEX })}
            title="Slot 63 — the 64th location, every trigger's “Anywhere”. Fixed to the map; it cannot be moved, resized or deleted."
          >
            <span className="n">63</span>
            <span className="name"><Lock size={10} />{locationName(scenario!, ANYWHERE_INDEX)}{!intact && <span className="badge warn">off map</span>}</span>
            <span className="coords">{scenario!.width}×{scenario!.height}</span>
          </div>
        )}
        {locations.map((l) => (
          <div
            key={l.index}
            className={`loc-row ${selected.includes(l.index) ? "selected" : ""}`}
            onClick={(e) => pick(l.index, e)}
            onDoubleClick={() => open("locationProperties", { index: l.index })}
            title={`${l.name} — slot ${l.index}${l.elevationFlags ? " · some elevations excluded" : ""}${l.inverted ? " · stored inverted" : ""}`}
          >
            <span className="n">{l.index}</span>
            <span className="name">{l.name}{l.elevationFlags !== 0 && <span className="elev">▲</span>}</span>
            <span className="coords">{fmtTile(l.x)},{fmtTile(l.y)} {fmtTile(l.w)}×{fmtTile(l.h)}</span>
          </div>
        ))}
        {scenario && locations.length === 0 && <div className="hint" style={{ padding: "10px 8px" }}>No locations yet — drag on empty ground to create one.</div>}
      </div>
      <div className="palette-footer"><span>{locations.length} / {capacity} locations</span><span>slot 63 is Anywhere</span></div>
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
              style={{ ["--c" as string]: displayColorHex(colors, scenario?.playerRgb, i) }}
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

const CLIP_PART_LABELS: Record<ClipPart, string> = { terrain: "Terrain", doodads: "Doodads", units: "Units", sprites: "Sprites", locations: "Locations", fog: "Fog of War" };

/**
 * The Cut / Copy / Paste layer (editor/clipboard.ts): the marked area, what a copy takes
 * and a paste writes, and whether a paste clears the target area's objects first.
 */
function ClipboardPalette() {
  const [parts, setParts] = useAtom(clipPartsAtom);
  const [mode, setMode] = useAtom(clipPasteModeAtom);
  const clip = useAtomValue(clipboardAtom);
  const selection = useAtomValue(clipSelectionAtom);
  const pasting = useAtomValue(clipPastingAtom);
  const hasMap = useAtomValue(scenarioAtom) !== null;
  const tools = useClipboardTools();
  const w = selection ? selection.x1 - selection.x0 : 0, h = selection ? selection.y1 - selection.y0 : 0;
  return (
    <>
      <div className="palette-toolbar">
        <span className="lbl">Area</span>
        <span className="mono dim" style={{ fontSize: 11 }}>{selection ? `${w} × ${h} at ${selection.x0}, ${selection.y0}` : "— × —"}</span>
      </div>
      <div className="palette-toolbar">
        <Button size="sm" onClick={() => { tools.cut(); }} disabled={!selection} title="Copy the marked area and remove its objects (Ctrl+X)">Cut</Button>
        <Button size="sm" onClick={() => { tools.copy(); }} disabled={!selection} title="Copy the marked area (Ctrl+C)">Copy</Button>
        <Button size="sm" active={pasting} onClick={() => { if (pasting) tools.stopPasting(); else tools.paste(); }} disabled={!clip || !hasMap} title="Stamp the clip where you click (Ctrl+V)">Paste</Button>
        <span className="grow" />
        <Button size="sm" onClick={tools.selectAll} disabled={!hasMap} title="Mark the whole map (Ctrl+A)">All</Button>
        <Button size="sm" onClick={tools.clearSelection} disabled={!selection} title="Unmark (Esc)">None</Button>
      </div>
      <div className="palette-scroll" style={{ padding: 8 }}>
        <fieldset className="group">
          <legend>Include</legend>
          <div className="col" style={{ gap: 2 }}>
            {CLIP_PARTS.map((p) => (
              <Check key={p} label={CLIP_PART_LABELS[p]} checked={parts[p]} onChange={(e) => setParts({ ...parts, [p]: e.target.checked })} />
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>What a copy takes and a paste lays down. Terrain carries the ground under its doodads, so a paste without them shows plain ground.</div>
        </fieldset>
        <fieldset className="group" style={{ marginTop: 10 }}>
          <legend>Paste</legend>
          <div className="col" style={{ gap: 2 }}>
            <Check radio name="paste" label="Merge with what is there" checked={mode === "merge"} onChange={() => setMode("merge")} />
            <Check radio name="paste" label="Replace objects in the area" checked={mode === "replace"} onChange={() => setMode("replace")} />
          </div>
          <div className="hint" style={{ marginTop: 6 }}>Replace clears the units, sprites and doodads under the clip first; locations are always kept. Either way, a doodad the new ground cuts through is removed.</div>
        </fieldset>
        <fieldset className="group" style={{ marginTop: 10 }}>
          <legend>Clipboard</legend>
          <div className={clip ? "mono" : "hint"} style={{ fontSize: 11 }}>{clip ? clipSummary(clip) : "Empty — mark an area and press Ctrl+C, or select objects on their own layer and copy them."}</div>
        </fieldset>
      </div>
      <div className="palette-footer"><span>{pasting ? "Click on the map to stamp the clip · Esc stops" : "Drag on the map to mark an area · Ctrl+X / Ctrl+C / Ctrl+V"}</span></div>
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
