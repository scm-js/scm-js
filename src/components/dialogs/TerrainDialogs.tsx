import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { Flag, Replace } from "lucide-react";
import { activeLayerAtom, activeTerrainAtom, activeTileAtom, clipSelectionAtom, placementOptionsAtom, selectedUnitsAtom, terrainModeAtom } from "../../atoms/editorAtoms";
import { commitEditAtom, scenarioAtom, terrainRevisionAtom, tilesetFileNameAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { statusMessageAtom } from "../../atoms/uiAtoms";
import { DEFAULT_START_PLACEMENT, placeStartLocations, playableCount, type StartLayout } from "../../editor/startLocations";
import { matchingTiles, type TerrainPick } from "../../editor/terrain";
import { START_LOCATION } from "../../data/units";
import { peekTileset } from "../../formats/tileset/load";
import { hexTile } from "../../formats/tileset/palette";
import { useTerrainTools } from "../../hooks/useTerrainTools";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { Check, Field, Group, NumberInput, Select } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Replace Terrain ────────────────────────────────────── */

type PickKind = TerrainPick["kind"];

/**
 * Tools ▸ Replace Terrain…: every tile of one terrain type (or one exact tile id) becomes
 * another, over the whole map or the area marked on the Cut / Copy / Paste layer. A terrain
 * type is matched the way the Rect fill reads one — a flat pair's CV5 index — and laid the
 * way the Rect brush lays it, so pairs stay pairs. The count updates live; Replace is one
 * undo step. The ISOM lattice is left alone, as by the Rect and Tile brushes.
 */
export function ReplaceTerrainDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(terrainRevisionAtom);
  const marked = useAtomValue(clipSelectionAtom);
  const mode = useAtomValue(terrainModeAtom);
  const activeTerrain = useAtomValue(activeTerrainAtom);
  const activeTile = useAtomValue(activeTileAtom);
  const tools = useTerrainTools();
  const types = tools.types;
  const firstId = types[0]?.id ?? 2;
  const [fromKind, setFromKind] = useState<PickKind>(mode === "tile" ? "tile" : "terrain");
  const [toKind, setToKind] = useState<PickKind>(mode === "tile" ? "tile" : "terrain");
  const [fromTerrain, setFromTerrain] = useState(types.some((t) => t.id === activeTerrain) ? activeTerrain : firstId);
  const [toTerrain, setToTerrain] = useState(firstId);
  const [fromTile, setFromTile] = useState(activeTile);
  const [toTile, setToTile] = useState(activeTile);
  const [inMarked, setInMarked] = useState(marked !== null);

  const from: TerrainPick = fromKind === "tile" ? { kind: "tile", id: fromTile } : { kind: "terrain", id: fromTerrain };
  const to: TerrainPick = toKind === "tile" ? { kind: "tile", id: toTile } : { kind: "terrain", id: toTerrain };
  const rect = inMarked && marked ? marked : undefined;
  const count = useMemo(
    () => (scenario ? matchingTiles(scenario, tools.loaded?.tileset ?? null, from, rect).length : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scenario, tools.loaded, fromKind, fromTerrain, fromTile, rect],
  );
  const same = from.kind === to.kind && from.id === to.id;
  const needsGraphics = (from.kind === "terrain" || to.kind === "terrain") && !tools.loaded;

  if (!scenario) {
    return <DialogFrame dialogKey={entry.key} title="Replace Terrain" icon={<Replace size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const options = types.map((t) => ({ value: String(t.id), label: t.name }));
  const picker = (kind: PickKind, setKind: (k: PickKind) => void, terrain: number, setTerrain: (id: number) => void, tile: number, setTile: (id: number) => void, what: string) => (
    <div className="form">
      <Field label="Match">
        <Select value={kind} onChange={(e) => setKind(e.target.value as PickKind)} options={[{ value: "terrain", label: "Terrain type" }, { value: "tile", label: "Exact tile" }]} />
      </Field>
      {kind === "terrain"
        ? <Field label={what}>{options.length > 0 ? <Select value={String(terrain)} onChange={(e) => setTerrain(Number(e.target.value))} options={options} /> : <span className="hint">Needs the tileset graphics</span>}</Field>
        : <Field label={what} hint={`Tile ${hexTile(tile)} — the Tile brush's number, as the palette shows it`}><NumberInput value={tile} onChange={setTile} min={0} max={65535} width={110} /></Field>}
    </div>
  );

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Replace Terrain"
      icon={<Replace size={14} />}
      size="md"
      okLabel="Replace"
      okDisabled={count === 0 || same || needsGraphics}
      onOk={() => { tools.replace(from, to, rect); }}
      footerLeft={<span className="hint">{needsGraphics ? "Terrain types need the tileset graphics — Help ▸ Game Data…" : same ? "Pick something different to replace with." : `${count} tile${count === 1 ? "" : "s"} match${count === 1 ? "es" : ""}${rect ? " in the marked area" : ""}`}</span>}
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title="Replace">{picker(fromKind, setFromKind, fromTerrain, setFromTerrain, fromTile, setFromTile, "Terrain")}</Group>
        <Group title="With">{picker(toKind, setToKind, toTerrain, setToTerrain, toTile, setToTile, "Terrain")}</Group>
      </div>
      <Group title="Where">
        <Check label={marked ? `Only the marked area (${marked.x1 - marked.x0} × ${marked.y1 - marked.y0} tiles)` : "Only the marked area — mark one on the Cut / Copy / Paste layer first"} checked={inMarked && marked !== null} disabled={marked === null} onChange={(e) => setInMarked(e.target.checked)} />
        <p className="hint" style={{ marginTop: 6 }}>
          A terrain type is every tile of its flat pair; cliff edges and doodads stay. The replacement is laid as the Rect brush lays it, left and right halves in step. The isometric lattice is not touched — use the isometric brush, or the Repair plugin's Rebuild ISOM, when it should follow. One undo step.
        </p>
      </Group>
    </DialogFrame>
  );
}

/* ── Auto-place Start Locations ─────────────────────────── */

/**
 * Tools ▸ Auto-place Start Locations: one start location per player on a ring or in the
 * corners, nudged onto ground the placement checks accept (editor/startLocations.ts). One
 * undo step. The Melee Wizard plugin is the richer tool — symmetry from a picked point,
 * bases and resources — this is the quick version for a fresh melee map.
 */
export function AutoStartsDialog({ entry }: DialogProps) {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(unitsRevisionAtom);
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setSelected = useSetAtom(selectedUnitsAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const { loaded: assets } = useUnitAssets();
  const tilesetName = useAtomValue(tilesetFileNameAtom);
  const [players, setPlayers] = useState(scenario ? playableCount(scenario) : 2);
  const [layout, setLayout] = useState<StartLayout>(DEFAULT_START_PLACEMENT.layout);
  const [margin, setMargin] = useState(DEFAULT_START_PLACEMENT.margin);
  const [replace, setReplace] = useState(true);
  const existing = scenario ? scenario.units.filter((u) => u.unitId === START_LOCATION).length : 0;

  if (!scenario) {
    return <DialogFrame dialogKey={entry.key} title="Auto-place Start Locations" icon={<Flag size={14} />} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
  }

  const apply = () => {
    const tileset = peekTileset(tilesetName)?.tileset ?? null;
    const r = placeStartLocations(scenario, tileset, assets?.units ?? null, { players, layout, margin, replace, placement: store.get(placementOptionsAtom) });
    const placed = r.placed.filter((p) => p !== null).length;
    if (r.changes.length === 0) { setStatus("No start location could be placed — no ground within reach passes the placement checks."); return; }
    commit({ label: `Auto-place ${placed} start location${placed === 1 ? "" : "s"}`, changes: [], units: r.changes });
    setSelected(r.changes.filter((c) => c.after !== null).map((c) => c.index));
    setLayer("units");
    const missed = r.placed.map((p, i) => (p ? null : i + 1)).filter((p): p is number => p !== null);
    setStatus(`Placed ${placed} start location${placed === 1 ? "" : "s"}${r.removed ? ` (replaced ${r.removed})` : ""}${missed.length > 0 ? ` — no room for player${missed.length === 1 ? "" : "s"} ${missed.join(", ")}` : ""}`);
  };

  return (
    <DialogFrame dialogKey={entry.key} title="Auto-place Start Locations" icon={<Flag size={14} />} size="md" okLabel="Place" onOk={apply} footerLeft={<span className="hint">{existing} on the map now</span>}>
      <div className="form wide">
        <Field label="Players"><NumberInput value={players} onChange={setPlayers} min={1} max={8} width={80} /></Field>
        <Field label="Layout" hint={layout === "ring" ? "Evenly around the map, top-left first." : "The four corners, then the edge midpoints."}>
          <Select value={layout} onChange={(e) => setLayout(e.target.value as StartLayout)} options={[{ value: "ring", label: "Ring" }, { value: "corners", label: "Corners" }]} />
        </Field>
        <Field label="Inset" hint="Tiles from the map edge to the ideal spot; each start then moves to the nearest ground it fits on."><NumberInput value={margin} onChange={setMargin} min={0} max={64} width={80} unit="tiles" /></Field>
        <div className="span">
          <Check className="wrap" label={`Replace the ${existing} start location${existing === 1 ? "" : "s"} already on the map`} checked={replace} disabled={existing === 0} onChange={(e) => setReplace(e.target.checked)} />
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>Players 1 to N get one each, on buildable ground away from other units (the Units palette's placement checks). Drag them afterwards as you would any unit; the Melee Wizard plugin lays out symmetric starts and bases from a point you pick.</p>
    </DialogFrame>
  );
}
