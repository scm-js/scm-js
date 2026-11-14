import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeTerrainAtom, activeTileAtom, blendAnchorAtom, blendFollowAtom, brushSizeAtom, mapTilesetAtom, pinBrushUnpinsAtom,
  rectVariationAtom, symmetryAtom, terrainModeAtom, type TerrainMode,
} from "../atoms/editorAtoms";
import { commitTerrainAtom, pinCellsAtom, pinnedTilesAtom, scenarioAtom, terrainRevisionAtom, tilesetFileNameAtom, type HistoryEntry } from "../atoms/documentAtoms";
import { countPins, handLaidCells, withoutPinned } from "../editor/pins";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  applyChanges, brushRect, floodRegion, laidPairAt, laidPairs, replaceTerrain, stampTerrain, stampTile,
  Stroke, type Rect, type TerrainPick, type TileChange,
} from "../editor/terrain";
import { healTiles, shownSeams } from "../editor/heal";
import { tileBlockAtom } from "../atoms/tileBlockAtoms";
import { blockCells, layPattern, PatternStroke, type TileBlock } from "../editor/tileSheet";
import { pieceBlock } from "../editor/pieces";
import { laidPieceAt } from "../editor/piecePick";
import { piecesFromStore } from "../services/pieces";
import { providedTypesAtom } from "../atoms/pieceAtoms";
import { declaredTerrains } from "../editor/pieceList";
import { mirrorIndices, mirrorPixel, mirrorRect } from "../editor/symmetry";
import {
  applyIsomChanges, brushDiamonds, diamondAt, hasIsom, isDiamond, isomTables, isomTerrains, isomWidth, paintIsom, type Diamond,
} from "../editor/isom";
import { flatTerrain } from "../formats/tileset/terrain";
import { inMap, neighbourOf, placeBlend, type Side } from "../editor/blend";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { peekTileset } from "../formats/tileset/load";
import { tileGroupOf } from "../formats/tileset/decode";
import {
  copiedTerrains, hexTile, isPairTerrain, pairTerrain, terrainKeyOfTile, terrainLabel, terrainOf as terrainOfTileset, terrainTypes,
  type TerrainType,
} from "../formats/tileset/palette";
import { TILESET_BY_ID, terrainName } from "../data/tilesets";
import { t, translate } from "../i18n";

export interface GhostTile {
  x: number;
  y: number;
  id: number;
}

/** A pointer position in map pixels (32 per tile), for the isometric brush. */
export interface MapPoint {
  px: number;
  py: number;
}

/**
 * The terrain modes that place tiles under a stroke; the ISOM brush works on diamonds and
 * the Blend brush places from its palette (see `blendAt`).
 */
export function paintsTiles(mode: TerrainMode): boolean {
  return mode === "rect" || mode === "tile" || mode === "heal" || mode === "pin";
}

/** What a block's stroke is called in the history and the status line. */
export function blockLabel(block: Pick<TileBlock, "cols" | "rows">): string {
  return t("Place {cols}×{rows} tiles", { cols: block.cols, rows: block.rows });
}

/** What a status line adds when pinned tiles stood in a brush's way. */
function keptNote(kept: number): string {
  return kept > 0 ? t(" — {n, plural, one {# pinned tile} other {# pinned tiles}} left as laid (the Pin tab unpins)", { n: kept }) : "";
}

/**
 * The terrain brushes, bound to the editor's live state. Reads through the store so
 * pointer handlers always see the current brush without re-subscribing per event.
 */
export function useTerrainTools() {
  const store = useStore();
  const commit = useSetAtom(commitTerrainAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bumpRevision = useSetAtom(terrainRevisionAtom);
  const setActiveTile = useSetAtom(activeTileAtom);
  const setActiveTerrain = useSetAtom(activeTerrainAtom);
  const setMode = useSetAtom(terrainModeAtom);
  const setBlendAnchor = useSetAtom(blendAnchorAtom);
  const stroke = useRef<Stroke | null>(null);
  const isomStroke = useRef<Stroke | null>(null);
  /** The last diamond an isometric stroke painted; the brush fires once per diamond. */
  const lastDiamond = useRef<Diamond | null>(null);
  const strokeLabel = useRef(t("Paint terrain"));
  /** The cells of pinned tiles the stroke would have changed. */
  const strokeKept = useRef(new Set<number>());
  /** A stroke of the Pin brush: the pins file before it and as it stands. */
  const pinStroke = useRef<{ before: Uint8Array | null; after: Uint8Array | null } | null>(null);
  /** A stroke of the Tile brush with a block: the press set where the pattern's copies line up. */
  const patternStroke = useRef<PatternStroke | null>(null);

  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const loaded = peekTileset(useAtomValue(tilesetFileNameAtom));
  const scenarioForTables = useAtomValue(scenarioAtom);
  /**
   * The flat terrains the files vouch for: the game's types, then the pairs that are the game's
   * own ground under other flags (a mod's Mud on high ground). `useRectTerrains` adds what the
   * open map lays.
   */
  const declared = useAtomValue(providedTypesAtom);
  const types = useMemo(() => {
    const base = [...terrainTypes(loaded?.tileset ?? null, info.terrain), ...copiedTerrains(loaded?.tileset ?? null, info.terrain)];
    // Flat ground plugins declare on this tileset (`api.terrain.provideTypes`), as named pair terrains.
    const mine = loaded ? declared.filter((d) => d.tileset === info.id).flatMap((d) => d.types) : [];
    return mine.length > 0 && loaded ? [...base, ...declaredTerrains(loaded.tileset, info.terrain, mine).filter((d) => !base.some((b) => b.id === d.id))] : base;
  }, [loaded, info, declared]);
  /** The terrain an id names: one of `types`, or any other pair of the tileset by its pair id. */
  const terrainOf = useCallback(
    (id: number): TerrainType | null => types.find((t) => t.id === id) ?? (isPairTerrain(id) ? terrainOfTileset(loaded?.tileset ?? null, info.terrain, id) : null),
    [types, loaded, info],
  );
  /** CV5 indices the isometric brush can paint on this tileset. */
  const isomTypes = useMemo(
    () => (loaded && scenarioForTables ? isomTerrains(isomTables(loaded.tileset, tilesetIndex(scenarioForTables))) : []),
    [loaded, scenarioForTables],
  );
  /** True when the open map and tileset let the isometric brush run at all. */
  const isomReady = hasIsom(scenarioForTables) && loaded !== null && isomTypes.length > 0;

  /**
   * Record a finished terrain edit: `commitTerrainAtom` lifts the doodads the stroke
   * painted over and the units it stranded into the same undo step and sets the status.
   */
  const commitTerrain = useCallback((_scn: Scenario, entry: HistoryEntry, summary: string) => {
    commit({ entry, summary });
  }, [commit]);

  /** The Rect brush as a flat pair, or null when the graphics (and so the groups) are missing. */
  const currentTerrain = useCallback((): TerrainType | null => {
    return terrainOf(store.get(activeTerrainAtom)) ?? types[0] ?? null;
  }, [store, types, terrainOf]);

  /** The isometric brush's terrain: the active one when paintable, else the tileset's first. */
  const currentIsomTerrain = useCallback((): number | null => {
    const id = store.get(activeTerrainAtom);
    return isomTypes.includes(id) ? id : isomTypes[0] ?? null;
  }, [store, isomTypes]);

  /**
   * The cells one brush application at (x, y) covers: its footprint and, under a symmetry
   * mode (Tools ▸ Symmetry…), the footprint's mirror images — as one set, so the Rect
   * brush still pairs columns by parity across the seam.
   */
  const footprint = useCallback((scn: Scenario, x: number, y: number): Set<number> => {
    return mirrorRect(store.get(symmetryAtom), brushRect(x, y, store.get(brushSizeAtom), scn.width, scn.height), scn.width, scn.height);
  }, [store]);

  /** A brush's changes less those to pinned tiles, which are counted for the stroke's status line. */
  const unpinned = useCallback((changes: TileChange[]): TileChange[] => {
    const pinned = store.get(pinnedTilesAtom);
    if (!pinned) return changes;
    for (const c of changes) if (pinned[c.at]) strokeKept.current.add(c.at);
    return withoutPinned(changes, pinned).changes;
  }, [store]);

  /** Changes one brush application at (x, y) would make, without applying them. */
  const stampAt = useCallback((x: number, y: number): TileChange[] | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const mode = store.get(terrainModeAtom);
    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus(t("Rect painting needs the tileset graphics — Help ▸ Game Data…"));
        return null;
      }
      return unpinned(stampTerrain(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, footprint(scn, x, y)));
    }
    // The Tile brush is pointed at the tiles it sets, so a pin does not stop it.
    if (mode === "tile") return stampTile(scn, footprint(scn, x, y), store.get(activeTileAtom));
    if (mode === "heal") {
      if (!loaded) {
        setStatus(t("The Heal brush needs the tileset graphics — Help ▸ Game Data…"));
        return null;
      }
      return unpinned(healTiles(scn, loaded.tileset, footprint(scn, x, y)));
    }
    return null;
  }, [store, loaded, currentTerrain, footprint, unpinned, setStatus]);

  /**
   * One isometric brush application on the diamond under `p`, applied live — and, under a
   * symmetry mode, on the diamond under each image of `p` (the lattice has a diamond at
   * every image for the map sizes the game has, all multiples of four tiles).
   */
  const paintIsomAt = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    const is = isomStroke.current;
    if (!hasIsom(scn) || !loaded || !s || !is) return;
    const d = diamondAt(p.px, p.py);
    const last = lastDiamond.current;
    if (last && last.x === d.x && last.y === d.y) return;
    if (!isDiamond(d) || d.x >= isomWidth(scn) || d.y > scn.height) return;
    lastDiamond.current = d;
    const terrain = currentIsomTerrain();
    if (terrain === null) return;
    let changed = false;
    for (const q of mirrorPixel(store.get(symmetryAtom), p.px, p.py, scn.width, scn.height)) {
      const dq = diamondAt(q.x, q.y);
      if (!isDiamond(dq) || dq.x < 0 || dq.y < 0 || dq.x >= isomWidth(scn) || dq.y > scn.height) continue;
      const pinned = store.get(pinnedTilesAtom);
      const edit = paintIsom(scn, loaded.tileset, dq, terrain, store.get(brushSizeAtom), Math.random, pinned);
      if (!edit) continue;
      for (const at of edit.kept) strokeKept.current.add(at);
      s.add(edit.tiles);
      is.add(edit.isom);
      if (edit.tiles.length > 0) changed = true;
    }
    if (changed) bumpRevision((r) => r + 1);
  }, [store, loaded, currentIsomTerrain, bumpRevision]);

  const paintAt = useCallback((x: number, y: number, p?: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    if (!scn || !s) return;
    // A block repeats as a pattern along the drag: each copy the pointer reaches is laid once.
    const pattern = patternStroke.current;
    if (pattern) {
      const changes = pattern.at(scn, x, y);
      if (changes.length === 0) return;
      applyChanges(scn, changes);
      s.add(changes);
      bumpRevision((r) => r + 1);
      return;
    }
    if (store.get(terrainModeAtom) === "isom") {
      if (p) paintIsomAt(p);
      return;
    }
    if (store.get(terrainModeAtom) === "pin") {
      const part = store.set(pinCellsAtom, { cells: footprint(scn, x, y), on: !store.get(pinBrushUnpinsAtom) });
      if (!part) return;
      const stroke = pinStroke.current;
      pinStroke.current = { before: stroke ? stroke.before : part.before, after: part.after };
      bumpRevision((r) => r + 1);
      return;
    }
    const changes = stampAt(x, y);
    if (!changes || changes.length === 0) return;
    applyChanges(scn, changes);
    s.add(changes);
    bumpRevision((r) => r + 1);
  }, [store, stampAt, paintIsomAt, footprint, bumpRevision]);

  const beginStroke = useCallback((x: number, y: number, p?: MapPoint) => {
    const mode = store.get(terrainModeAtom);
    stroke.current = new Stroke();
    isomStroke.current = new Stroke();
    lastDiamond.current = null;
    strokeKept.current = new Set();
    pinStroke.current = null;
    // A block is laid only under the pointer: its pictures cannot be mirrored, so symmetry leaves it alone, as it does a paste.
    const block = mode === "tile" ? store.get(tileBlockAtom) : null;
    patternStroke.current = block ? new PatternStroke(block, { x, y }) : null;
    strokeLabel.current =
      block ? blockLabel(block)
      : mode === "pin" ? (store.get(pinBrushUnpinsAtom) ? t("Unpin tiles") : t("Pin tiles"))
      : mode === "rect" ? (currentTerrain() ? t("Paint {terrain}", { terrain: terrainLabel(currentTerrain()!) }) : t("Paint terrain"))
        : mode === "isom" ? t("Paint {terrain} (isometric)", { terrain: translate(terrainName(info, currentIsomTerrain() ?? -1)) })
          : mode === "heal" ? t("Heal seams")
            : t("Place tile {tile}", { tile: hexTile(store.get(activeTileAtom)) });
    paintAt(x, y, p);
  }, [store, info, currentTerrain, currentIsomTerrain, paintAt]);

  const endStroke = useCallback(() => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    const is = isomStroke.current;
    stroke.current = null;
    isomStroke.current = null;
    lastDiamond.current = null;
    patternStroke.current = null;
    if (!s || !scn) return;
    const pins = pinStroke.current;
    pinStroke.current = null;
    if (pins) {
      commitTerrain(scn, { label: strokeLabel.current, changes: [], pins: { before: pins.before, after: pins.after } }, t("{label} — {n, plural, one {# tile is} other {# tiles are}} pinned now", { label: strokeLabel.current, n: countPins(store.get(pinnedTilesAtom)) }));
      return;
    }
    const changes = s.finish();
    const isom = is?.finish() ?? [];
    const kept = strokeKept.current.size;
    if (changes.length === 0 && isom.length === 0) {
      if (kept > 0) setStatus(t("Nothing painted: the tiles here are pinned (the Pin tab unpins)"));
      return;
    }
    commitTerrain(scn, { label: strokeLabel.current, changes, isom: isom.length > 0 ? isom : undefined }, t("{label} — {n, plural, one {# tile} other {# tiles}}", { label: strokeLabel.current, n: changes.length }) + keptNote(kept));
  }, [store, commitTerrain, setStatus]);

  const isStroking = useCallback(() => stroke.current !== null, []);

  /**
   * Flood the connected area under (x, y) with the current brush: in Rect mode the
   * area is "same terrain type", otherwise "same exact tile". Not an isometric operation.
   * Under a symmetry mode the region's mirror images fill too.
   */
  const fillAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const mode = store.get(terrainModeAtom);
    if (mode !== "rect" && mode !== "tile") return;
    const seed = scn.tiles[y * scn.width + x];
    let changes: TileChange[] = [];
    let label = t("Fill area");

    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus(t("Fill needs the tileset graphics — Help ▸ Game Data…"));
        return;
      }
      const typeOf = (id: number) => terrainKeyOfTile(loaded.tileset, id);
      const seedType = typeOf(seed);
      const region = mirrorIndices(store.get(symmetryAtom), floodRegion(scn, x, y, (id) => typeOf(id) === seedType), scn.width, scn.height);
      changes = stampTerrain(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, region);
      label = t("Fill {terrain}", { terrain: terrainLabel(terrain) });
    } else if (store.get(tileBlockAtom)) {
      // A block fills as its pattern, lined up on the cell clicked; not mirrored, since its pictures cannot be. The
      // area is the Rect fill's (the same terrain): on a mod's varied ground the same exact tile is one tile.
      const block = store.get(tileBlockAtom)!;
      const typeOf = (id: number) => (loaded ? terrainKeyOfTile(loaded.tileset, id) : id);
      const seedType = typeOf(seed);
      changes = layPattern(scn, block, { x, y }, floodRegion(scn, x, y, (id) => typeOf(id) === seedType));
      label = t("Fill with {cols}×{rows} tiles", { cols: block.cols, rows: block.rows });
    } else {
      const tile = store.get(activeTileAtom);
      if (tile === seed) return;
      const region = mirrorIndices(store.get(symmetryAtom), floodRegion(scn, x, y, (id) => id === seed), scn.width, scn.height);
      changes = stampTile(scn, region, tile);
      label = t("Fill with {tile}", { tile: hexTile(tile) });
    }
    // A fill lays an area by rule, whichever brush it borrows its tile from: pinned tiles stay.
    const spared = withoutPinned(changes, store.get(pinnedTilesAtom));
    changes = spared.changes;

    if (changes.length === 0) {
      if (spared.kept > 0) setStatus(t("Nothing filled: the tiles here are pinned (the Pin tab unpins)"));
      return;
    }
    applyChanges(scn, changes);
    commitTerrain(scn, { label, changes }, t("{label} — {n, plural, one {# tile} other {# tiles}}", { label, n: changes.length }) + keptNote(spared.kept));
  }, [store, loaded, currentTerrain, commitTerrain, setStatus]);

  /**
   * Tools ▸ Fill Terrain: the whole map as one terrain. In Tile mode every cell becomes the
   * Tile brush's tile; otherwise the Rect brush's terrain is laid the way a new map is
   * (`flatTerrain`: StarEdit's pairs, and a matching ISOM lattice when the map has one, so
   * the isometric brush stays healthy). One undo step; doodads go with it like any stroke.
   */
  const fillMap = useCallback(() => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const changes: TileChange[] = [];
    let isom: TileChange[] | undefined;
    let label: string;
    const pinned = store.get(pinnedTilesAtom);
    let kept = 0;
    const block = store.get(terrainModeAtom) === "tile" ? store.get(tileBlockAtom) : null;
    if (block) {
      // The block's pattern from the map's top-left corner; its holes leave the map as it is.
      for (const c of layPattern(scn, block, { x: 0, y: 0 }, scn.tiles.keys())) {
        if (pinned?.[c.at]) kept++;
        else changes.push(c);
      }
      label = t("Fill map with {cols}×{rows} tiles", { cols: block.cols, rows: block.rows });
    } else if (store.get(terrainModeAtom) === "tile") {
      const tile = store.get(activeTileAtom);
      for (let at = 0; at < scn.tiles.length; at++) {
        if (scn.tiles[at] === tile) continue;
        if (pinned?.[at]) kept++;
        else changes.push({ at, before: scn.tiles[at], after: tile });
      }
      label = t("Fill map with {tile}", { tile: hexTile(tile) });
    } else {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus(t("Fill Terrain needs the tileset graphics — Help ▸ Game Data…"));
        return;
      }
      const flat = flatTerrain(scn.width, scn.height, { id: terrain.id, group: terrain.group }, loaded.tileset, Math.random, tilesetIndex(scn));
      for (let at = 0; at < flat.tiles.length; at++) {
        if (scn.tiles[at] === flat.tiles[at]) continue;
        if (pinned?.[at]) kept++;
        else changes.push({ at, before: scn.tiles[at], after: flat.tiles[at] });
      }
      // A pair the tileset does not type has no ISOM value: its tiles are laid and the lattice is left as it was.
      if (hasIsom(scn) && scn.isom.length === flat.isom.length && !isPairTerrain(terrain.id)) {
        isom = [];
        for (let i = 0; i < flat.isom.length; i++) if (scn.isom[i] !== flat.isom[i]) isom.push({ at: i, before: scn.isom[i], after: flat.isom[i] });
      }
      label = t("Fill map with {terrain}", { terrain: terrainLabel(terrain) });
    }
    if (changes.length === 0 && !(isom && isom.length > 0)) {
      setStatus(t("The map is already that terrain — nothing to fill."));
      return;
    }
    applyChanges(scn, changes);
    if (isom && isom.length > 0) applyIsomChanges(scn, isom);
    commitTerrain(scn, { label, changes, isom: isom && isom.length > 0 ? isom : undefined }, t("{label} — {n, plural, one {# tile} other {# tiles}}", { label, n: changes.length }) + keptNote(kept));
  }, [store, loaded, currentTerrain, commitTerrain, setStatus]);

  /**
   * Tools ▸ Replace Terrain…: every tile matching `from` becomes `to`, over the whole map or
   * a rect. One undo step; stranded doodads and units go with it like any stroke. Returns
   * how many tiles changed (0 with a status line when nothing matched).
   */
  const replace = useCallback((from: TerrainPick, to: TerrainPick, rect?: Rect): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return 0;
    if ((from.kind === "terrain" || to.kind === "terrain") && !loaded) {
      setStatus(t("Replace Terrain needs the tileset graphics — Help ▸ Game Data…"));
      return 0;
    }
    const spared = withoutPinned(replaceTerrain(scn, loaded?.tileset ?? null, from, to, rect), store.get(pinnedTilesAtom));
    const changes = spared.changes;
    if (changes.length === 0) {
      setStatus(spared.kept > 0 ? t("Nothing replaced: the tiles that match are pinned (the Pin tab unpins)") : t("Nothing to replace — no tile matches, or the replacement is what is there already."));
      return 0;
    }
    const name = (p: TerrainPick) => {
      if (p.kind === "tile") return hexTile(p.id);
      const type = terrainOf(p.id);
      return type ? terrainLabel(type) : translate(terrainName(TILESET_BY_ID[store.get(mapTilesetAtom)], p.id));
    };
    const label = t("Replace {from} with {to}", { from: name(from), to: name(to) });
    applyChanges(scn, changes);
    commitTerrain(scn, { label, changes }, (rect ? t("{label} — {n, plural, one {# tile} other {# tiles}} in the marked area", { label, n: changes.length }) : t("{label} — {n, plural, one {# tile} other {# tiles}}", { label, n: changes.length })) + keptNote(spared.kept));
    return changes.length;
  }, [store, loaded, terrainOf, commitTerrain, setStatus]);

  /**
   * The Heal tab's button: mend the joins that show over the whole map or a rect, as the
   * Heal brush would over each tile. One undo step. Returns how many tiles changed.
   */
  const heal = useCallback((rect?: Rect): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return 0;
    if (!loaded) {
      setStatus(t("The Heal brush needs the tileset graphics — Help ▸ Game Data…"));
      return 0;
    }
    const area = rect ?? { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
    const cells: number[] = [];
    for (let y = Math.max(0, area.y0); y < Math.min(scn.height, area.y1); y++) for (let x = Math.max(0, area.x0); x < Math.min(scn.width, area.x1); x++) cells.push(y * scn.width + x);
    const before = shownSeams(scn, loaded.tileset, cells);
    const changes = withoutPinned(healTiles(scn, loaded.tileset, cells), store.get(pinnedTilesAtom)).changes;
    if (changes.length === 0) {
      setStatus(before === 0 ? t("No join shows here — nothing to heal.") : t("{n, plural, one {# join shows} other {# joins show}} here, and the tileset has no tile that would mend one and play the same.", { n: before }));
      return 0;
    }
    applyChanges(scn, changes);
    const after = shownSeams(scn, loaded.tileset, cells);
    const label = t("Heal seams");
    commitTerrain(scn, { label, changes }, t("Healed {n, plural, one {# tile} other {# tiles}}: {before} joins showed, {after} still do", { n: changes.length, before, after }));
    return changes.length;
  }, [store, loaded, commitTerrain, setStatus]);

  /**
   * The Pin tab's buttons: pin or unpin every tile of a rect or of the whole map, or pin
   * the tiles laid by hand there (`handLaidCells`). One undo step. Returns how many tiles'
   * pins changed.
   */
  const pinArea = useCallback((what: "all" | "handLaid", on: boolean, rect?: Rect): number => {
    const scn = store.get(scenarioAtom);
    if (!scn) return 0;
    let cells: number[];
    if (what === "handLaid") {
      if (!loaded || !hasIsom(scn)) {
        setStatus(t("Finding the tiles laid by hand needs the tileset graphics and a map with isometric data."));
        return 0;
      }
      cells = handLaidCells(scn, loaded.tileset, rect);
    } else {
      const area = rect ?? { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
      cells = [];
      for (let y = Math.max(0, area.y0); y < Math.min(scn.height, area.y1); y++) for (let x = Math.max(0, area.x0); x < Math.min(scn.width, area.x1); x++) cells.push(y * scn.width + x);
    }
    const before = countPins(store.get(pinnedTilesAtom));
    const part = store.set(pinCellsAtom, { cells, on });
    if (!part) {
      setStatus(what === "handLaid" ? (cells.length === 0 ? t("No tile here was laid by hand: the isometric data accounts for all of them.") : t("The tiles laid by hand here are pinned already.")) : on ? t("Every tile here is pinned already.") : t("No tile here is pinned."));
      return 0;
    }
    const now = countPins(store.get(pinnedTilesAtom));
    const n = Math.abs(now - before);
    const label = on ? t("Pin tiles") : t("Unpin tiles");
    commitTerrain(scn, { label, changes: [], pins: part }, on
      ? t("Pinned {n, plural, one {# tile} other {# tiles}}; {total} pinned in all", { n, total: now })
      : t("Unpinned {n, plural, one {# tile} other {# tiles}}; {total} still pinned", { n, total: now }));
    return n;
  }, [store, loaded, commitTerrain, setStatus]);

  /**
   * Eyedropper. Isometric mode reads the diamond's terrain straight from the ISOM, so
   * clicking a cliff face picks the ground it belongs to; in Rect mode a flat tile
   * picks its terrain type — and so does half of an untyped pair the map lays as a pair
   * there, a mod's added ground; anything else (a cliff piece, a doodad tile) drops into
   * Tile mode so it can be placed as-is. Blend mode picks the cell itself as the
   * anchor the palette matches against.
   */
  const pickAt = useCallback((x: number, y: number, p?: MapPoint) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const id = scn.tiles[y * scn.width + x];
    const mode = store.get(terrainModeAtom);
    if (mode === "blend") {
      setBlendAnchor({ x, y });
      setStatus(t("Blend from tile {hexTile} at {x}, {y} — pick a match in the palette", { hexTile: hexTile(id), x, y }));
      return;
    }
    if (mode === "isom" && p && hasIsom(scn) && loaded) {
      const d = diamondAt(p.px, p.py);
      const w = isomWidth(scn);
      if (isDiamond(d) && d.x < w && d.y <= scn.height) {
        const value = scn.isom[(d.y * w + d.x) * 4] >> 4;
        const type = isomTables(loaded.tileset, tilesetIndex(scn)).links[value]?.terrainType ?? 0;
        if (isomTypes.includes(type)) {
          setActiveTerrain(type);
          setStatus(t("Picked {terrainName}", { terrainName: translate(terrainName(info, type)) }));
          return;
        }
      }
    }
    if (mode === "rect" || mode === "isom") {
      const pair = tileGroupOf(id, loaded?.tileset.groups.length) & ~1;
      const laid = loaded ? laidPairAt(scn, loaded.tileset, x, y) : -1;
      const type = types.find((t) => t.group === pair) ?? (loaded && laid >= 0 ? pairTerrain(loaded.tileset, info.terrain, laid) : null);
      if (type) {
        setActiveTerrain(type.id);
        if (mode === "isom" && isPairTerrain(type.id)) setMode("rect");
        setStatus(t("Picked {name}", { name: terrainLabel(type) }));
        return;
      }
      setMode("tile");
    }
    // A tile laid beside its sheet neighbour as part of a piece picks the whole piece.
    if (mode === "tile" && loaded) {
      const cut = piecesFromStore(store, loaded.tileset);
      const piece = cut ? laidPieceAt(scn, loaded.tileset.groups.length, cut.index, x, y) : null;
      if (piece) {
        store.set(tileBlockAtom, pieceBlock(piece));
        setStatus(t("Picked a {cols}×{rows} piece (group {group}) — click the map to lay it, drag to repeat it", { cols: piece.cols, rows: piece.rows, group: piece.group }));
        return;
      }
    }
    store.set(tileBlockAtom, null);
    setActiveTile(id);
    setStatus(t("Picked tile {tile} (group {group}, slot {slot})", { tile: hexTile(id), group: id >> 4, slot: id & 15 }));
  }, [store, loaded, info, types, isomTypes, setActiveTerrain, setActiveTile, setMode, setBlendAnchor, setStatus]);

  /**
   * Blend brush: put `id` (a candidate from the palette) on the `side` neighbour of the
   * anchor as one undo step, make it the Tile brush's tile, and — unless Follow is off —
   * move the anchor onto it so the next pick continues the seam.
   */
  const blendAt = useCallback((side: Side, id: number) => {
    const scn = store.get(scenarioAtom);
    const anchor = store.get(blendAnchorAtom);
    if (!scn || !anchor || !inMap(scn, anchor)) return;
    const at = neighbourOf(anchor, side);
    const changes = placeBlend(scn, anchor, side, id);
    if (!changes) {
      setStatus(t("Nothing {side, select, left {left} top {top} right {right} other {bottom}} of {x}, {y} — that is off the map", { side, x: anchor.x, y: anchor.y }));
      return;
    }
    setActiveTile(id);
    const label = t("Blend {tile} {side, select, left {left} top {top} right {right} other {bottom}} of {x}, {y}", { tile: hexTile(id), side, x: anchor.x, y: anchor.y });
    if (changes.length > 0) {
      applyChanges(scn, changes);
      commitTerrain(scn, { label, changes }, label);
    } else {
      setStatus(t("{hexTile} is already {side, select, left {left} top {top} right {right} other {bottom}} of {x}, {y}", { hexTile: hexTile(id), side, x: anchor.x, y: anchor.y }));
    }
    if (store.get(blendFollowAtom)) store.set(blendAnchorAtom, at);
  }, [store, commitTerrain, setActiveTile, setStatus]);

  /** What the brush would leave under the cursor (and its mirror images), for the viewport's hover preview. */
  const ghostAt = useCallback((x: number, y: number): GhostTile[] => {
    const scn = store.get(scenarioAtom);
    if (!scn) return [];
    const mode = store.get(terrainModeAtom);
    const cells = footprint(scn, x, y);
    const out: GhostTile[] = [];
    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain) return [];
      const variation = Math.max(0, store.get(rectVariationAtom));
      for (const at of cells) {
        const tx = at % scn.width;
        out.push({ x: tx, y: Math.floor(at / scn.width), id: ((terrain.group + (tx & 1)) << 4) | variation });
      }
    } else if (mode === "tile" && store.get(tileBlockAtom)) {
      // The whole block with its top-left under the pointer, as a paste stands; not mirrored.
      return blockCells(store.get(tileBlockAtom)!, x, y, scn.width, scn.height);
    } else if (mode === "tile") {
      const id = store.get(activeTileAtom);
      for (const at of cells) out.push({ x: at % scn.width, y: Math.floor(at / scn.width), id });
    }
    return out;
  }, [store, currentTerrain, footprint]);

  /** The diamonds the isometric brush would set from the pointer at `p`, for the hover outline. */
  const ghostDiamondsAt = useCallback((p: MapPoint): Diamond[] => {
    const scn = store.get(scenarioAtom);
    if (!scn) return [];
    // The diamonds under the pointer and, under a symmetry mode, under each of its images — what paintIsomAt paints.
    const out: Diamond[] = [];
    const seen = new Set<string>();
    mirrorPixel(store.get(symmetryAtom), p.px, p.py, scn.width, scn.height).forEach((q, i) => {
      const dq = diamondAt(q.x, q.y);
      if (i > 0 && !isDiamond(dq)) return;
      for (const d of brushDiamonds(scn, dq, store.get(brushSizeAtom))) {
        const k = `${d.x},${d.y}`;
        if (!seen.has(k)) { seen.add(k); out.push(d); }
      }
    });
    return out;
  }, [store]);

  return useMemo(
    () => ({ types, terrainOf, isomTypes, isomReady, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, fillMap, replace, heal, pinArea, pickAt, blendAt, ghostAt, ghostDiamondsAt }),
    [types, terrainOf, isomTypes, isomReady, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, fillMap, replace, heal, pinArea, pickAt, blendAt, ghostAt, ghostDiamondsAt],
  );
}

/**
 * Every flat terrain the Rect brush and Replace Terrain offer on the open map: the tools'
 * `types`, then the untyped pairs the map itself lays as ground (`laidPairs`), then the active
 * terrain when it is a pair that is neither — one picked from the Tile palette to start with.
 * The list follows the map, so a pair appears once enough of it has been painted.
 */
export function useRectTerrains(tools: Pick<ReturnType<typeof useTerrainTools>, "types" | "terrainOf" | "loaded">): TerrainType[] {
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const scenario = useAtomValue(scenarioAtom);
  const revision = useAtomValue(terrainRevisionAtom);
  const active = useAtomValue(activeTerrainAtom);
  const { types, terrainOf, loaded } = tools;
  // As a string, so a stroke that lays no new pair leaves the list below as it was.
  const laid = useMemo(
    () => (loaded && scenario ? laidPairs(scenario, loaded.tileset).join(",") : ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, scenario, revision],
  );
  return useMemo(() => {
    const out = [...types];
    if (loaded && laid !== "") {
      for (const g of laid.split(",").map(Number)) {
        if (out.some((t) => t.group === g)) continue;
        const type = pairTerrain(loaded.tileset, info.terrain, g);
        if (type) out.push(type);
      }
    }
    if (isPairTerrain(active) && !out.some((t) => t.id === active)) {
      const type = terrainOf(active);
      if (type) out.push(type);
    }
    return out;
  }, [types, terrainOf, loaded, info, laid, active]);
}
