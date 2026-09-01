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
  activeLayerAtom,
  activeUnitAtom,
  brushSizeAtom,
  mapTilesetAtom,
  unitOwnerAtom,
  type EditorLayer,
} from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { DOODAD_CATEGORIES, TILESET_BY_ID } from "../../data/tilesets";
import { PLAYER_COLORS } from "../../data/players";
import { RACE_LABEL, SPRITES, UNIT_GROUPS, type RaceKey } from "../../data/units";
import { SAMPLE_LOCATIONS } from "../../data/samples";
import { Button, Check, Tabs, Tip } from "../ui";
import TerrainPalette from "./TerrainPalette";

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

function DoodadPalette() {
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const [cat, setCat] = useState(DOODAD_CATEGORIES[0]);
  const [sel, setSel] = useState(0);
  return (
    <>
      <div className="palette-toolbar">
        <select className="select grow" value={cat} onChange={(e) => setCat(e.target.value)}>
          {DOODAD_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <Check label="Random variant" />
      </div>
      <div className="palette-scroll">
        <div className="doodad-grid">
          {Array.from({ length: 18 }, (_, i) => (
            <button key={i} className={`doodad ${sel === i ? "selected" : ""}`} onClick={() => setSel(i)}>
              <span className="thumb" style={{ background: `linear-gradient(160deg, ${shade(tileset.color, 0.25)}, ${shade(tileset.color, -0.4)})` }}>
                <TreePine size={16} />
              </span>
              <span className="lbl">{cat.split(" ")[0]} {i + 1}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="palette-footer"><span>{cat} · 18 doodads</span><span>{tileset.name}</span></div>
    </>
  );
}

/* ── Units ──────────────────────────────────────────────── */

function UnitPalette() {
  const [owner, setOwner] = useAtom(unitOwnerAtom);
  const [active, setActive] = useAtom(activeUnitAtom);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ "Terran Units": true, "Neutral Special": true });

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return UNIT_GROUPS.map((g) => ({ ...g, units: q ? g.units.filter((u) => u.toLowerCase().includes(q)) : g.units })).filter((g) => g.units.length > 0);
  }, [query]);

  const races: RaceKey[] = ["terran", "zerg", "protoss", "neutral"];

  return (
    <>
      <div className="owner-strip" title="Unit owner">
        {PLAYER_COLORS.slice(0, 12).map((c, i) => (
          <Tip key={i} label={`Player ${i + 1}`} side="right">
            <button className={`owner-chip ${owner === i ? "is-active" : ""}`} style={{ ["--c" as string]: c.hex }} onClick={() => setOwner(i)}>
              {i + 1}
            </button>
          </Tip>
        ))}
      </div>
      <div className="palette-toolbar">
        <Search size={12} className="faint" />
        <input className="input grow" placeholder="Search units…" value={query} onChange={(e) => setQuery(e.target.value)} />
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
                    {isOpen && g.units.map((u) => (
                      <div key={u} className={`node ${active === u ? "selected" : ""}`} style={{ paddingLeft: 40 }} onClick={() => setActive(u)}>
                        {u}
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
        <span>{active}</span>
        <span className="row" style={{ gap: 4 }}><span className="swatch" style={{ background: PLAYER_COLORS[owner].hex, width: 10, height: 10 }} />P{owner + 1}</span>
      </div>
    </>
  );
}

/* ── Sprites ────────────────────────────────────────────── */

function SpritePalette() {
  const [sel, setSel] = useState(0);
  const list = (items: string[]) => (
    <div className="listbox" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
      {items.map((s, i) => (
        <div key={s} className={`item ${sel === i ? "selected" : ""}`} onClick={() => setSel(i)}>
          <span className="idx">{i}</span>
          {s}
        </div>
      ))}
    </div>
  );
  return (
    <Tabs
      compact
      tabs={[
        { value: "pure", label: "Pure Sprites", content: <><div className="palette-scroll">{list(SPRITES)}</div><div className="palette-footer"><span>{SPRITES.length} sprites</span><span>THG2</span></div></> },
        { value: "unit", label: "Unit Sprites", content: <><div className="palette-scroll">{list(UNIT_GROUPS[0].units.concat(UNIT_GROUPS[3].units))}</div><div className="palette-footer"><span>Unit-sprite (no owner logic)</span></div></> },
      ]}
    />
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

function FogPalette() {
  const [brush, setBrush] = useAtom(brushSizeAtom);
  return (
    <>
      <div className="palette-toolbar">
        <span className="lbl">Brush</span>
        <select className="select" style={{ width: 64 }} value={brush} onChange={(e) => setBrush(Number(e.target.value))}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n}×{n}</option>)}
        </select>
        <span className="grow" />
        <Button size="sm">All</Button>
        <Button size="sm">None</Button>
      </div>
      <div className="palette-scroll">
        <div className="fog-grid">
          {PLAYER_COLORS.slice(0, 8).map((c, i) => (
            <Check key={i} defaultChecked={i < 2} label={<span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: c.hex, width: 10, height: 10 }} />Player {i + 1}</span>} />
          ))}
        </div>
        <div style={{ padding: "0 8px 8px" }} className="hint">
          Paint fog for the checked players. Fogged tiles start unexplored for that player.
        </div>
      </div>
      <div className="palette-footer"><span>Mode: Paint fog</span><span>Right-click erases</span></div>
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
