/**
 * Terrain pictures for the New Scenario dialog.
 *
 * The dialog shows every tileset at once and lets the map be built out of any of their
 * terrain types, so it cannot go through `useTileset`: that rasterises a ~20 MB atlas
 * per tileset. It asks `loadTilesetGraphics` for the decoded files instead, renders the
 * patches it needs and drops the tileset again — the caches here hold pixels, not
 * tilesets, and everything they hold is a few hundred kilobytes.
 *
 * Two levels, because the dialog needs two different things:
 *  - every tileset's card thumbnail and terrain swatches, which are small, cached for
 *    the session and loaded one tileset at a time so only one decode is ever live;
 *  - the graphics of the *selected* tileset, kept while the dialog is open so the map
 *    preview can be redrawn at whatever size the chosen terrain needs.
 */
import { useEffect, useState } from "react";
import { loadTilesetGraphics, TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import type { Tileset } from "../formats/tileset/decode";
import { baseTerrain } from "../formats/tileset/terrain";
import { terrainTypes } from "../formats/tileset/palette";
import { renderTerrainPatch, type TerrainPatch } from "../formats/tileset/preview";
import { TILESETS, TILESET_BY_ID, type TilesetId } from "../data/tilesets";

/** Tiles in a tileset card's thumbnail, and in a terrain swatch. */
export const CARD_TILES = { cols: 5, rows: 2 };
export const SWATCH_TILES = { cols: 2, rows: 2 };
/** The block the map preview repeats. Big enough not to read as a pattern at map scale. */
export const PREVIEW_TILES = { cols: 8, rows: 8 };

/** What one tileset contributes to the dialog's chrome. */
export interface TilesetThumbs {
  card: TerrainPatch;
  /** ISOM terrain id → its swatch, in the palette's order. */
  swatches: { id: number; name: string; group: number; patch: TerrainPatch }[];
}

const thumbs = new Map<TilesetId, TilesetThumbs | null>();
const pending = new Map<TilesetId, Promise<TilesetThumbs | null>>();
/** Decodes run one at a time: eight at once is eight live tilesets for no gain. */
let queue: Promise<unknown> = Promise.resolve();

export function tilesetFileName(id: TilesetId): TilesetFileName {
  return TILESET_FILENAMES[Math.max(0, TILESETS.findIndex((t) => t.id === id))];
}

function render(id: TilesetId, tileset: Tileset): TilesetThumbs {
  const info = TILESET_BY_ID[id];
  const types = terrainTypes(tileset, info.terrain);
  return {
    card: renderTerrainPatch(tileset, baseTerrain(tileset, info.defaultIsom), CARD_TILES.cols, CARD_TILES.rows),
    swatches: types.map((t) => ({
      id: t.id,
      name: t.name,
      group: t.group,
      patch: renderTerrainPatch(tileset, { id: t.id, group: t.group }, SWATCH_TILES.cols, SWATCH_TILES.rows),
    })),
  };
}

/** Cached patches for one tileset; null once it is known there are no graphics for it. */
export function getTilesetThumbs(id: TilesetId): Promise<TilesetThumbs | null> {
  const done = thumbs.get(id);
  if (done !== undefined) return Promise.resolve(done);
  const already = pending.get(id);
  if (already) return already;

  const load = queue.then(async () => {
    const out = await loadTilesetGraphics(tilesetFileName(id)).then((ts) => render(id, ts)).catch(() => null);
    thumbs.set(id, out);
    pending.delete(id);
    return out;
  });
  queue = load;
  pending.set(id, load);
  return load;
}

/** Every tileset's thumbnails, filling in as they arrive. */
export function useTilesetThumbs(): Map<TilesetId, TilesetThumbs | null> {
  const [map, setMap] = useState(() => new Map(thumbs));
  useEffect(() => {
    let live = true;
    for (const t of TILESETS) {
      if (thumbs.has(t.id)) continue;
      void getTilesetThumbs(t.id).then(() => { if (live) setMap(new Map(thumbs)); });
    }
    return () => { live = false; };
  }, []);
  return map;
}

/**
 * The decoded graphics of one tileset, held only while the caller is mounted. `loading`
 * is what tells a preview to wait rather than draw its no-graphics fallback.
 */
export function useTilesetGraphics(id: TilesetId): { tileset: Tileset | null; loading: boolean } {
  const [state, setState] = useState<{ id: TilesetId; tileset: Tileset | null } | null>(null);
  useEffect(() => {
    let live = true;
    loadTilesetGraphics(tilesetFileName(id))
      .then((ts) => { if (live) setState({ id, tileset: ts }); })
      .catch(() => { if (live) setState({ id, tileset: null }); });
    return () => { live = false; };
  }, [id]);
  const current = state?.id === id ? state : null;
  return { tileset: current?.tileset ?? null, loading: current === null };
}
