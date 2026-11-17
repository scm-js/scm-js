/**
 * `api.terrain` and `api.tileset`: the tileset's terrain, the ISOM lattice, the brush and the tiles' reads.
 */
import { activeTerrainAtom, activeTileAtom, brushSizeAtom, mapTilesetAtom, rectVariationAtom, symmetryAtom, terrainModeAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, scenarioAtom, tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { tileBlockAtom } from "../../atoms/tileBlockAtoms";
import { checkedBlock, copyBlock, pieceCalls } from "../pieces";
import { borrowCalls } from "../borrow";
import { copyCalls } from "../copies";
import { TILESET_BY_ID, TILESETS } from "../../data/tilesets";
import { tilesetIndex } from "../../formats/chk/scenario";
import { ensureTileset, peekTileset, type LoadedTileset, TILESET_FILENAMES } from "../../formats/tileset/load";
import { megatileForTile } from "../../formats/tileset/decode";
import { variationsOf } from "../../formats/tileset/terrain";
import { terrainTypes, tileInfo } from "../../formats/tileset/palette";
import { type Rect, floodRegion, flatGroupOf } from "../../editor/terrain";
import { diamondAt, hasIsom, isDiamond, isomHeight, isomReport, isomTables, isomTerrainAt, isomTerrains, isomWidth, type Diamond } from "../../editor/isom";
import type { PluginInfo, TerrainApi, TilesetApi } from "../api";
import { blendCandidates, DEFAULT_BLEND_OPTIONS, seamStep } from "../../editor/blend";
import { shownSeams } from "../../editor/heal";
import { handLaidCells, pinsOf } from "../../editor/pins";
import { fairnessReport, symmetryShares } from "../../editor/fairness";
import { mirrorIndices, mirrorPixel, symmetryAvailable } from "../../editor/symmetry";
import type { Store, Contributions } from "./shared";

/** `api.terrain`: the tileset's terrain types, the ISOM lattice, the brush, and the reads over the map's tiles. */
export function terrainApi(store: Store, info: PluginInfo, bag: Contributions): TerrainApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const names = () => TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  const rgb = (packed: number) => [packed >> 16 & 0xff, packed >> 8 & 0xff, packed & 0xff];
  return {
    types: () => terrainTypes(loaded()?.tileset ?? null, names()),
    isomTypes: () => {
      const l = loaded(), scn = scenario();
      return l && scn ? isomTerrains(isomTables(l.tileset, tilesetIndex(scn))) : [];
    },
    hasIsom: () => hasIsom(scenario()),
    checkIsom: async () => {
      const scn = scenario();
      if (!scn) return null;
      const l = loaded() ?? await ensureTileset(store.get(tilesetFileNameAtom));
      const current = scenario();
      return current ? isomReport(current, l.tileset) : null;
    },
    tileInfo: (id) => { const l = loaded(); return l ? tileInfo(l.tileset, names(), id) : null; },
    terrainAt: (tx, ty) => {
      const scn = scenario(), l = loaded();
      if (!scn || !l || tx < 0 || ty < 0 || tx >= scn.width || ty >= scn.height) return null;
      const info = tileInfo(l.tileset, names(), scn.tiles[ty * scn.width + tx]);
      if (info.kind === "terrain") return l.tileset.groups[info.group]?.index ?? null;
      return hasIsom(scn) ? isomTerrainAt(scn, l.tileset, tx, ty) : null;
    },
    color: (tileId) => {
      const l = loaded();
      if (!l) return null;
      const megatile = megatileForTile(l.tileset, tileId);
      return megatile > 0 ? l.atlas.averages[megatile] : null;
    },
    terrainColor: (terrainId) => {
      const l = loaded();
      if (!l) return null;
      const type = terrainTypes(l.tileset, names()).find((t) => t.id === terrainId);
      if (!type) return null;
      let r = 0, g = 0, b = 0, n = 0;
      for (const group of [type.group, type.group + 1]) {
        for (const slot of variationsOf(l.tileset, group).common) {
          const megatile = megatileForTile(l.tileset, (group << 4) | slot);
          if (megatile <= 0) continue;
          const [cr, cg, cb] = rgb(l.atlas.averages[megatile]);
          r += cr; g += cg; b += cb; n++;
        }
      }
      return n === 0 ? null : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    },
    heightOf: (terrainId) => terrainTypes(loaded()?.tileset ?? null, names()).find((t) => t.id === terrainId)?.height ?? null,
    diamondAt,
    isDiamond,
    diamondsIn: (rect) => {
      const scn = scenario();
      if (!scn) return [];
      const iw = isomWidth(scn), ih = isomHeight(scn);
      const out: Diamond[] = [];
      // A diamond (x, y) is centred on pixel (64x, 32y): tile column 2x, row y. Inclusive of the far edges,
      // so a rect that reaches the map edge covers the last lattice column and row.
      for (let y = Math.max(0, rect.y0); y <= Math.min(ih - 1, rect.y1); y++) {
        for (let x = Math.max(0, Math.ceil(rect.x0 / 2)); x <= Math.min(iw - 1, Math.floor(rect.x1 / 2)); x++) {
          if ((x + y) % 2 === 0) out.push({ x, y });
        }
      }
      return out;
    },
    active: () => {
      const block = store.get(tileBlockAtom);
      return { mode: store.get(terrainModeAtom), terrain: store.get(activeTerrainAtom), tile: store.get(activeTileAtom), brushSize: store.get(brushSizeAtom), variation: store.get(rectVariationAtom), block: block ? copyBlock(block) : null };
    },
    setActive: (brush) => {
      if (brush.mode !== undefined) store.set(terrainModeAtom, brush.mode);
      if (brush.terrain !== undefined) store.set(activeTerrainAtom, brush.terrain);
      if (brush.tile !== undefined) store.set(activeTileAtom, brush.tile);
      if (brush.brushSize !== undefined) store.set(brushSizeAtom, brush.brushSize);
      if (brush.variation !== undefined) store.set(rectVariationAtom, brush.variation);
      // After the tile, so a block given with one wins (arming it sets the tile to its first).
      if (brush.block !== undefined) store.set(tileBlockAtom, brush.block === null ? null : checkedBlock(brush.block, "setActive"));
    },
    ...pieceCalls(store, info.id, bag),
    ...borrowCalls(store, info.id, bag),
    ...copyCalls(store, info.id, bag),
    floodRegion: (x, y, match = "terrain") => {
      const scn = scenario();
      if (!scn || x < 0 || y < 0 || x >= scn.width || y >= scn.height) return [];
      const seed = scn.tiles[y * scn.width + x];
      const l = loaded();
      if (match === "terrain" && l) {
        const groups = l.tileset.groups;
        const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
        const seedType = typeOf(seed);
        return [...floodRegion(scn, x, y, (id) => typeOf(id) === seedType)];
      }
      return [...floodRegion(scn, x, y, (id) => id === seed)];
    },
    blendCandidates: (anchorId, side, options = {}) => { const l = loaded(); return l ? blendCandidates(l.tileset, anchorId, side, { ...DEFAULT_BLEND_OPTIONS, ...options }) : []; },
    seamStep: (tileId, side, neighbourId) => {
      const l = loaded();
      if (!l) return null;
      const a = megatileForTile(l.tileset, tileId), b = megatileForTile(l.tileset, neighbourId);
      return a > 0 && b > 0 ? seamStep(l.tileset, a, side, b) : null;
    },
    seams: (cells) => {
      const scn = scenario(), l = loaded();
      if (!scn || !l) return 0;
      const list: number[] = [];
      if (cells === undefined) for (let at = 0; at < scn.width * scn.height; at++) list.push(at);
      else if (typeof (cells as Rect).x0 === "number") {
        const r = cells as Rect;
        for (let y = Math.max(0, r.y0); y < Math.min(scn.height, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(scn.width, r.x1); x++) list.push(y * scn.width + x);
      } else for (const at of cells as Iterable<number>) if (at >= 0 && at < scn.width * scn.height) list.push(at);
      return shownSeams(scn, l.tileset, list);
    },
    pinned: () => {
      const scn = scenario();
      const pins = scn ? pinsOf(store.get(archiveExtrasAtom), scn) : null;
      const out: number[] = [];
      if (pins) for (let at = 0; at < pins.length; at++) if (pins[at]) out.push(at);
      return out;
    },
    handLaid: (rect) => { const scn = scenario(), l = loaded(); return scn && l ? handLaidCells(scn, l.tileset, rect) : []; },
    symmetryShares: () => { const scn = scenario(), l = loaded(); return scn && l ? symmetryShares(scn, l.tileset) : {}; },
    fairness: (mode = store.get(symmetryAtom)) => { const scn = scenario(), l = loaded(); return scn && l ? fairnessReport(scn, l.tileset, mode) : null; },
    flatGroupOf: (terrainId) => { const l = loaded(); return l ? flatGroupOf(l.tileset, terrainId) : -1; },
    symmetry: () => store.get(symmetryAtom),
    setSymmetry: (mode) => store.set(symmetryAtom, mode),
    symmetryAvailable: (mode) => { const scn = scenario(); return scn ? symmetryAvailable(mode, scn.width, scn.height) : mode === "none"; },
    mirror: (cells) => {
      const scn = scenario();
      if (!scn) return [];
      const list = typeof (cells as Rect).x0 === "number"
        ? (() => { const r = cells as Rect; const out: number[] = []; for (let y = Math.max(0, r.y0); y < Math.min(scn.height, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(scn.width, r.x1); x++) out.push(y * scn.width + x); return out; })()
        : [...(cells as Iterable<number>)];
      return [...mirrorIndices(store.get(symmetryAtom), list, scn.width, scn.height)];
    },
    mirrorPoint: (px, py) => { const scn = scenario(); return scn ? mirrorPixel(store.get(symmetryAtom), px, py, scn.width, scn.height) : [{ x: px, y: py }]; },
  };
}

/** `api.tileset`: which tileset the map uses, and its graphics. */
export function tilesetApi(store: Store): TilesetApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  return {
    id: () => (scenario() ? TILESETS[tilesetIndex(scenario()!)].id : null),
    name: () => { const scn = scenario(); return scn ? TILESETS[tilesetIndex(scn)].name : TILESET_BY_ID[store.get(mapTilesetAtom)].name; },
    isLoaded: () => loaded() !== null,
    load: async (id) => {
      const era = id === undefined ? -1 : TILESETS.findIndex((t) => t.id === id);
      if (id !== undefined && era < 0) return false;
      try { await ensureTileset(era < 0 ? store.get(tilesetFileNameAtom) : TILESET_FILENAMES[era]); return true; } catch { return false; }
    },
    raw: loaded,
  };
}
