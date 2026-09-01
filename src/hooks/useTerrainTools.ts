import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  activeTerrainAtom, activeTileAtom, brushSizeAtom, mapTilesetAtom, rectVariationAtom,
  terrainModeAtom, type TerrainMode,
} from "../atoms/editorAtoms";
import { commitEditAtom, scenarioAtom, terrainRevisionAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  applyChanges, brushRect, floodRegion, stampTerrain, stampTerrainAt, stampTile, stampTileAt,
  Stroke, type TileChange,
} from "../editor/terrain";
import { peekTileset } from "../formats/tileset/load";
import { hexTile, terrainTypes, type TerrainType } from "../formats/tileset/palette";
import { TILESET_BY_ID } from "../data/tilesets";

export interface GhostTile {
  x: number;
  y: number;
  id: number;
}

/** The terrain modes that place tiles directly; the ISOM brush is its own thing. */
export function paintsTiles(mode: TerrainMode): boolean {
  return mode !== "isom";
}

/**
 * The terrain brushes, bound to the editor's live state. Reads through the store so
 * pointer handlers always see the current brush without re-subscribing per event.
 */
export function useTerrainTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bumpRevision = useSetAtom(terrainRevisionAtom);
  const setActiveTile = useSetAtom(activeTileAtom);
  const setActiveTerrain = useSetAtom(activeTerrainAtom);
  const setMode = useSetAtom(terrainModeAtom);
  const stroke = useRef<Stroke | null>(null);
  const strokeLabel = useRef("Paint terrain");

  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const loaded = peekTileset(useAtomValue(tilesetFileNameAtom));
  const types = useMemo(() => terrainTypes(loaded?.tileset ?? null, info.terrain), [loaded, info]);

  /** The Rect brush as a flat pair, or null when the graphics (and so the groups) are missing. */
  const currentTerrain = useCallback((): TerrainType | null => {
    const id = store.get(activeTerrainAtom);
    return types.find((t) => t.id === id) ?? types[0] ?? null;
  }, [store, types]);

  /** Changes one brush application at (x, y) would make, without applying them. */
  const stampAt = useCallback((x: number, y: number): TileChange[] | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const size = store.get(brushSizeAtom);
    const mode = store.get(terrainModeAtom);
    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus("Rect painting needs the tileset graphics — run scripts/extract-tilesets.mjs.");
        return null;
      }
      return stampTerrainAt(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, x, y, size);
    }
    if (mode === "tile") return stampTileAt(scn, x, y, size, store.get(activeTileAtom));
    return null;
  }, [store, loaded, currentTerrain, setStatus]);

  const paintAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    if (!scn || !s) return;
    const changes = stampAt(x, y);
    if (!changes || changes.length === 0) return;
    applyChanges(scn, changes);
    s.add(changes);
    bumpRevision((r) => r + 1);
  }, [store, stampAt, bumpRevision]);

  const beginStroke = useCallback((x: number, y: number) => {
    const mode = store.get(terrainModeAtom);
    stroke.current = new Stroke();
    strokeLabel.current = mode === "rect" ? `Paint ${currentTerrain()?.name ?? "terrain"}` : `Place tile ${hexTile(store.get(activeTileAtom))}`;
    paintAt(x, y);
  }, [store, currentTerrain, paintAt]);

  const endStroke = useCallback(() => {
    const s = stroke.current;
    stroke.current = null;
    if (!s) return;
    const changes = s.finish();
    if (changes.length === 0) return;
    commit({ label: strokeLabel.current, changes });
    setStatus(`${strokeLabel.current} — ${changes.length} tile${changes.length === 1 ? "" : "s"}`);
  }, [commit, setStatus]);

  const isStroking = useCallback(() => stroke.current !== null, []);

  /**
   * Flood the connected area under (x, y) with the current brush: in Rect mode the
   * area is "same terrain type", otherwise "same exact tile".
   */
  const fillAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const mode = store.get(terrainModeAtom);
    const seed = scn.tiles[y * scn.width + x];
    let changes: TileChange[] = [];
    let label = "Fill area";

    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain || !loaded) {
        setStatus("Fill needs the tileset graphics — run scripts/extract-tilesets.mjs.");
        return;
      }
      const groups = loaded.tileset.groups;
      const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
      const seedType = typeOf(seed);
      const region = floodRegion(scn, x, y, (id) => typeOf(id) === seedType);
      changes = stampTerrain(scn, loaded.tileset, { group: terrain.group, variation: store.get(rectVariationAtom) }, region);
      label = `Fill ${terrain.name}`;
    } else {
      const tile = store.get(activeTileAtom);
      if (tile === seed) return;
      const region = floodRegion(scn, x, y, (id) => id === seed);
      changes = stampTile(scn, region, tile);
      label = `Fill with ${hexTile(tile)}`;
    }

    if (changes.length === 0) return;
    applyChanges(scn, changes);
    commit({ label, changes });
    setStatus(`${label} — ${changes.length} tile${changes.length === 1 ? "" : "s"}`);
  }, [store, loaded, currentTerrain, commit, setStatus]);

  /**
   * Eyedropper. In Rect mode a flat tile picks its terrain type; anything else (a
   * cliff piece, a doodad tile) drops into Tile mode so it can be placed as-is.
   */
  const pickAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const id = scn.tiles[y * scn.width + x];
    const mode = store.get(terrainModeAtom);
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
  }, [store, types, setActiveTerrain, setActiveTile, setMode, setStatus]);

  /** What the brush would leave under the cursor, for the viewport's hover preview. */
  const ghostAt = useCallback((x: number, y: number): GhostTile[] => {
    const scn = store.get(scenarioAtom);
    if (!scn) return [];
    const mode = store.get(terrainModeAtom);
    const rect = brushRect(x, y, store.get(brushSizeAtom), scn.width, scn.height);
    const out: GhostTile[] = [];
    if (mode === "rect") {
      const terrain = currentTerrain();
      if (!terrain) return [];
      const variation = Math.max(0, store.get(rectVariationAtom));
      for (let ty = rect.y0; ty < rect.y1; ty++) {
        for (let tx = rect.x0; tx < rect.x1; tx++) out.push({ x: tx, y: ty, id: ((terrain.group + (tx & 1)) << 4) | variation });
      }
    } else if (mode === "tile") {
      const id = store.get(activeTileAtom);
      for (let ty = rect.y0; ty < rect.y1; ty++) for (let tx = rect.x0; tx < rect.x1; tx++) out.push({ x: tx, y: ty, id });
    }
    return out;
  }, [store, currentTerrain]);

  return useMemo(
    () => ({ types, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, pickAt, ghostAt }),
    [types, loaded, beginStroke, paintAt, endStroke, isStroking, fillAt, pickAt, ghostAt],
  );
}
