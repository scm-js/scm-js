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
import { t } from "../../i18n";

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
    return <DialogFrame dialogKey={entry.key} title={t("Replace Terrain")} icon={<Replace size={14} />} size="sm"><p className="hint">{t("Open or create a map first.")}</p></DialogFrame>;
  }

  const options = types.map((t) => ({ value: String(t.id), label: t.name }));
  const picker = (kind: PickKind, setKind: (k: PickKind) => void, terrain: number, setTerrain: (id: number) => void, tile: number, setTile: (id: number) => void, what: string) => (
    <div className="form">
      <Field label={t("Match")}>
        <Select value={kind} onChange={(e) => setKind(e.target.value as PickKind)} options={[{ value: "terrain", label: t("Terrain type") }, { value: "tile", label: t("Exact tile") }]} />
      </Field>
      {kind === "terrain"
        ? <Field label={what}>{options.length > 0 ? <Select value={String(terrain)} onChange={(e) => setTerrain(Number(e.target.value))} options={options} /> : <span className="hint">{t("Needs the tileset graphics")}</span>}</Field>
        : <Field label={what} hint={t("Tile {hexTile} — the Tile brush's number, as the palette shows it", { hexTile: hexTile(tile) })}><NumberInput value={tile} onChange={setTile} min={0} max={65535} width={110} /></Field>}
    </div>
  );

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Replace Terrain")}
      icon={<Replace size={14} />}
      size="md"
      okLabel={t("Replace")}
      okDisabled={count === 0 || same || needsGraphics}
      onOk={() => { tools.replace(from, to, rect); }}
      footerLeft={<span className="hint">{needsGraphics ? t("Terrain types need the tileset graphics — Help ▸ Game Data…") : same ? t("Pick something different to replace with.") : t("{n, plural, one {# tile matches} other {# tiles match}}", { n: count }) + (rect ? t(" in the marked area") : "")}</span>}
    >
      <div className="split" style={{ ["--split" as string]: "1fr" }}>
        <Group title={t("Replace")}>{picker(fromKind, setFromKind, fromTerrain, setFromTerrain, fromTile, setFromTile, t("Terrain"))}</Group>
        <Group title={t("With")}>{picker(toKind, setToKind, toTerrain, setToTerrain, toTile, setToTile, t("Terrain"))}</Group>
      </div>
      <Group title={t("Where")}>
        <Check label={marked ? t("Only the marked area ({v} × {v2} tiles)", { v: marked.x1 - marked.x0, v2: marked.y1 - marked.y0 }) : t("Only the marked area — mark one on the Cut / Copy / Paste layer first")} checked={inMarked && marked !== null} disabled={marked === null} onChange={(e) => setInMarked(e.target.checked)} />
        <p className="hint" style={{ marginTop: 6 }}>
          {t("A terrain type is every tile of its flat pair; cliff edges and doodads stay. The replacement is laid as the Rect brush lays it, left and right halves in step. The isometric lattice is not touched — use the isometric brush, or the Repair plugin's Rebuild ISOM, when it should follow. One undo step.")}
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
    return <DialogFrame dialogKey={entry.key} title={t("Auto-place Start Locations")} icon={<Flag size={14} />} size="sm"><p className="hint">{t("Open or create a map first.")}</p></DialogFrame>;
  }

  const apply = () => {
    const tileset = peekTileset(tilesetName)?.tileset ?? null;
    const r = placeStartLocations(scenario, tileset, assets?.units ?? null, { players, layout, margin, replace, placement: store.get(placementOptionsAtom) });
    const placed = r.placed.filter((p) => p !== null).length;
    if (r.changes.length === 0) { setStatus(t("No start location could be placed — no ground within reach passes the placement checks.")); return; }
    commit({ label: t("Auto-place {n, plural, one {# start location} other {# start locations}}", { n: placed }), changes: [], units: r.changes });
    setSelected(r.changes.filter((c) => c.after !== null).map((c) => c.index));
    setLayer("units");
    const missed = r.placed.map((p, i) => (p ? null : i + 1)).filter((p): p is number => p !== null);
    setStatus(t("Placed {n, plural, one {# start location} other {# start locations}}", { n: placed }) + (r.removed ? t(" (replaced {n})", { n: r.removed }) : "") + (missed.length > 0 ? t(" — no room for {n, plural, one {player} other {players}} {list}", { n: missed.length, list: missed.join(", ") }) : ""));
  };

  return (
    <DialogFrame dialogKey={entry.key} title={t("Auto-place Start Locations")} icon={<Flag size={14} />} size="md" okLabel={t("Place")} onOk={apply} footerLeft={<span className="hint">{t("{existing} on the map now", { existing })}</span>}>
      <div className="form wide">
        <Field label={t("Players")}><NumberInput value={players} onChange={setPlayers} min={1} max={8} width={80} /></Field>
        <Field label={t("Layout")} hint={layout === "ring" ? t("Evenly around the map, top-left first.") : t("The four corners, then the edge midpoints.")}>
          <Select value={layout} onChange={(e) => setLayout(e.target.value as StartLayout)} options={[{ value: "ring", label: t("Ring") }, { value: "corners", label: t("Corners") }]} />
        </Field>
        <Field label={t("Inset")} hint={t("Tiles from the map edge to the ideal spot; each start then moves to the nearest ground it fits on.")}><NumberInput value={margin} onChange={setMargin} min={0} max={64} width={80} unit="tiles" /></Field>
        <div className="span">
          <Check className="wrap" label={t("Replace the {n, plural, one {# start location} other {# start locations}} already on the map", { n: existing })} checked={replace} disabled={existing === 0} onChange={(e) => setReplace(e.target.checked)} />
        </div>
      </div>
      <p className="hint" style={{ marginTop: 10 }}>{t("Players 1 to N get one each, on buildable ground away from other units (the Units palette's placement checks). Drag them afterwards as you would any unit; the Melee Wizard plugin lays out symmetric starts and bases from a point you pick.")}</p>
    </DialogFrame>
  );
}
