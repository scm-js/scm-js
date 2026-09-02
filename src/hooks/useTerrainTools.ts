import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeTerrainAtom, activeTileAtom, blendAnchorAtom, blendFollowAtom, brushSizeAtom, mapTilesetAtom,
  rectVariationAtom, symmetryAtom, terrainModeAtom, type TerrainMode,
} from "../atoms/editorAtoms";
import { commitTerrainAtom, scenarioAtom, terrainRevisionAtom, tilesetFileNameAtom, type HistoryEntry } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  applyChanges, brushRect, floodRegion, stampTerrain, stampTile,
  Stroke, type TileChange,
} from "../editor/terrain";
import { mirrorIndices, mirrorRect } from "../editor/symmetry";
import {
  applyIsomChanges, brushDiamonds, diamondAt, hasIsom, isDiamond, isomTables, isomTerrains, isomWidth, paintIsom, type Diamond,
} from "../editor/isom";
import { flatTerrain } from "../formats/tileset/terrain";
import { inMap, neighbourOf, placeBlend, type Side } from "../editor/blend";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { peekTileset } from "../formats/tileset/load";
import { hexTile, terrainTypes, type TerrainType } from "../formats/tileset/palette";
import { TILESET_BY_ID, terrainName } from "../data/tilesets";

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
  return mode === "rect" || mode === "tile";
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
  const strokeLabel = useRef("Paint terrain");

  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const loaded = peekTileset(useAtomValue(tilesetFileNameAtom));
  const scenarioForTables = useAtomValue(scenarioAtom);
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);
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
    const id = store.get(activeTerrainAtom);
    return types.find((t) => t.id === id) ?? types[0] ?? null;
  }, [store, types]);

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

  /** Changes one brush application at (x, y) would make, without applying them. */
  const stampAt = useCallback((x: number, y: number): TileChange[] | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const mode = store.get(terrainModeAtom);
    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus("Rect painting needs the tileset graphics — Help ▸ Game Data…");
        return null;
      }
      return stampTerrain(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, footprint(scn, x, y));
    }
    if (mode === "tile") return stampTile(scn, footprint(scn, x, y), store.get(activeTileAtom));
    return null;
  }, [store, loaded, currentTerrain, footprint, setStatus]);

  /** One isometric brush application on the diamond under `p`, applied live. */
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
    const edit = paintIsom(scn, loaded.tileset, d, terrain, store.get(brushSizeAtom));
    if (!edit) return;
    s.add(edit.tiles);
    is.add(edit.isom);
    if (edit.tiles.length > 0) bumpRevision((r) => r + 1);
  }, [store, loaded, currentIsomTerrain, bumpRevision]);

  const paintAt = useCallback((x: number, y: number, p?: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    if (!scn || !s) return;
    if (store.get(terrainModeAtom) === "isom") {
      if (p) paintIsomAt(p);
      return;
    }
    const changes = stampAt(x, y);
    if (!changes || changes.length === 0) return;
    applyChanges(scn, changes);
    s.add(changes);
    bumpRevision((r) => r + 1);
  }, [store, stampAt, paintIsomAt, bumpRevision]);

  const beginStroke = useCallback((x: number, y: number, p?: MapPoint) => {
    const mode = store.get(terrainModeAtom);
    stroke.current = new Stroke();
    isomStroke.current = new Stroke();
    lastDiamond.current = null;
    strokeLabel.current =
      mode === "rect" ? `Paint ${currentTerrain()?.name ?? "terrain"}`
        : mode === "isom" ? `Paint ${terrainName(info, currentIsomTerrain() ?? -1)} (isometric)`
          : `Place tile ${hexTile(store.get(activeTileAtom))}`;
    paintAt(x, y, p);
  }, [store, info, currentTerrain, currentIsomTerrain, paintAt]);

  const endStroke = useCallback(() => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    const is = isomStroke.current;
    stroke.current = null;
    isomStroke.current = null;
    lastDiamond.current = null;
    if (!s || !scn) return;
    const changes = s.finish();
    const isom = is?.finish() ?? [];
    if (changes.length === 0 && isom.length === 0) return;
    commitTerrain(scn, { label: strokeLabel.current, changes, isom: isom.length > 0 ? isom : undefined }, `${strokeLabel.current} — ${changes.length} tile${changes.length === 1 ? "" : "s"}`);
  }, [store, commitTerrain]);

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
    if (!paintsTiles(mode)) return;
    const seed = scn.tiles[y * scn.width + x];
    let changes: TileChange[] = [];
    let label = "Fill area";

    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus("Fill needs the tileset graphics — Help ▸ Game Data…");
        return;
      }
      const groups = loaded.tileset.groups;
      const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
      const seedType = typeOf(seed);
      const region = mirrorIndices(store.get(symmetryAtom), floodRegion(scn, x, y, (id) => typeOf(id) === seedType), scn.width, scn.height);
      changes = stampTerrain(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, region);
      label = `Fill ${terrain.name}`;
    } else {
      const tile = store.get(activeTileAtom);
      if (tile === seed) return;
      const region = mirrorIndices(store.get(symmetryAtom), floodRegion(scn, x, y, (id) => id === seed), scn.width, scn.height);
      changes = stampTile(scn, region, tile);
      label = `Fill with ${hexTile(tile)}`;
    }

    if (changes.length === 0) return;
    applyChanges(scn, changes);
    commitTerrain(scn, { label, changes }, `${label} — ${changes.length} tile${changes.length === 1 ? "" : "s"}`);
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
    if (store.get(terrainModeAtom) === "tile") {
      const tile = store.get(activeTileAtom);
      for (let at = 0; at < scn.tiles.length; at++) if (scn.tiles[at] !== tile) changes.push({ at, before: scn.tiles[at], after: tile });
      label = `Fill map with ${hexTile(tile)}`;
    } else {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus("Fill Terrain needs the tileset graphics — Help ▸ Game Data…");
        return;
      }
      const flat = flatTerrain(scn.width, scn.height, { id: terrain.id, group: terrain.group }, loaded.tileset, Math.random, tilesetIndex(scn));
      for (let at = 0; at < flat.tiles.length; at++) if (scn.tiles[at] !== flat.tiles[at]) changes.push({ at, before: scn.tiles[at], after: flat.tiles[at] });
      if (hasIsom(scn) && scn.isom.length === flat.isom.length) {
        isom = [];
        for (let i = 0; i < flat.isom.length; i++) if (scn.isom[i] !== flat.isom[i]) isom.push({ at: i, before: scn.isom[i], after: flat.isom[i] });
      }
      label = `Fill map with ${terrain.name}`;
    }
    if (changes.length === 0 && !(isom && isom.length > 0)) {
      setStatus("The map is already that terrain — nothing to fill.");
      return;
    }
    applyChanges(scn, changes);
    if (isom && isom.length > 0) applyIsomChanges(scn, isom);
    commitTerrain(scn, { label, changes, isom: isom && isom.length > 0 ? isom : undefined }, `${label} — ${changes.length} tile${changes.length === 1 ? "" : "s"}`);
  }, [store, loaded, currentTerrain, commitTerrain, setStatus]);

  /**
   * Eyedropper. Isometric mode reads the diamond's terrain straight from the ISOM, so
   * clicking a cliff face picks the ground it belongs to; in Rect mode a flat tile
   * picks its terrain type; anything else (a cliff piece, a doodad tile) drops into
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
      setStatus(`Blend from tile ${hexTile(id)} at ${x}, ${y} — pick a match in the palette`);
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
          setStatus(`Picked ${terrainName(info, type)}`);
          return;
        }
      }
    }
    if (mode === "rect" || mode === "isom") {
      const type = types.find((t) => t.group === (id >> 4 & ~1));
      if (type) {
        setActiveTerrain(type.id);
        setStatus(`Picked ${type.name}`);
        return;
      }
      setMode("tile");
    }
    setActiveTile(id);
    setStatus(`Picked tile ${hexTile(id)} (group ${id >> 4}, slot ${id & 15})`);
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
      setStatus(`Nothing ${side} of ${anchor.x}, ${anchor.y} — that is off the map`);
      return;
    }
    setActiveTile(id);
    const label = `Blend ${hexTile(id)} ${side} of ${anchor.x}, ${anchor.y}`;
    if (changes.length > 0) {
      applyChanges(scn, changes);
      commitTerrain(scn, { label, changes }, label);
    } else {
      setStatus(`${hexTile(id)} is already ${side} of ${anchor.x}, ${anchor.y}`);
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
    return brushDiamonds(scn, diamondAt(p.px, p.py), store.get(brushSizeAtom));
  }, [store]);

  return useMemo(
    () => ({ types, isomTypes, isomReady, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, fillMap, pickAt, blendAt, ghostAt, ghostDiamondsAt }),
    [types, isomTypes, isomReady, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, fillMap, pickAt, blendAt, ghostAt, ghostDiamondsAt],
  );
}
