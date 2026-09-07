/**
 * `api.graphics`: the pictures the viewport draws, handed to a plugin for its own lists,
 * palettes and previews.
 *
 * Nothing here renders anything new — a unit or sprite frame comes out of the same
 * per-(image, frame, colour, palette) cache the viewport blits from, and a tile is one
 * copy out of the megatile atlas — so a plugin listing five hundred units costs about
 * what the Units palette costs. Tiles and doodads are kept in a cache of their own,
 * keyed by tileset name, because they are composed rather than cached upstream.
 *
 * Everything answers null when the game data it needs was never extracted; that is a
 * normal state everywhere else in the editor and a plugin should show a name instead.
 */
import type { createStore } from "jotai";
import { scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { displayColorHex, playerTeamColor } from "../data/players";
import { logError } from "../editor/log";
import { atlasSource } from "../formats/tileset/atlas";
import { megatileForTile } from "../formats/tileset/decode";
import { ensureTileset, peekTileset, type LoadedTileset } from "../formats/tileset/load";
import { getUnitAssets, imageGrpPath, onGrpLoaded, peekUnitAssets, requestGrp, unitImageId, type UnitAssets } from "../formats/units/load";
import { getImageFrame, getUnitSprite, subunitOf } from "../formats/units/sprites";
import { NO_UNIT } from "../formats/dat/dat";
import { DEFAULT_IMAGE_OPTIONS, exportMapImage } from "../services/mapImage";
import { SpriteFlag } from "../formats/chk/sections/objects";
import { doodadOrigin } from "../formats/tileset/doodads";
import { TILESET_FILENAMES } from "../formats/tileset/load";
import { ALL_CLIP_PARTS, clipLocationBounds, type Clip } from "../editor/clipboard";
import { boundsOf } from "../editor/locations";
import type { GraphicsApi, PluginImage, RenderClipOptions, SpriteKind } from "./api";

type Store = ReturnType<typeof createStore>;

/** `Contributions` from `host.ts`, structurally — importing it there would be a cycle. */
interface Bag {
  add(dispose: () => void): { dispose(): void };
}

const TILE = 32;

/** Composed pictures (a tile, a doodad) by tileset and id; the upstream caches cover the rest. */
const composed = new Map<string, PluginImage | null>();

/** Drop the composed pictures: the keys are tileset *names*, which another data set draws differently. */
export function clearComposedImages(): void {
  composed.clear();
}

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d");
  return ctx ? { canvas, ctx } : null;
}

/** One megatile out of the atlas, as its own 32 × 32 canvas. */
function buildTile(loaded: LoadedTileset, tileId: number): PluginImage | null {
  const megatile = megatileForTile(loaded.tileset, tileId);
  if (megatile < 0) return null;
  const made = canvasOf(TILE, TILE);
  if (!made) return null;
  const src = atlasSource(loaded.atlas, megatile);
  made.ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, 0, 0, TILE, TILE);
  return { image: made.canvas, width: TILE, height: TILE };
}

/** A doodad drawn from the MTXM ids it stamps; cells it leaves alone stay transparent. */
function buildDoodad(loaded: LoadedTileset, doodadId: number): PluginImage | null {
  const def = loaded.doodads.byId.get(doodadId);
  if (!def) return null;
  const made = canvasOf(def.width * TILE, def.height * TILE);
  if (!made) return null;
  for (let y = 0; y < def.height; y++) {
    for (let x = 0; x < def.width; x++) {
      const tile = def.tiles[y * def.width + x];
      if (!tile) continue;
      const megatile = megatileForTile(loaded.tileset, tile);
      if (megatile < 0) continue;
      const src = atlasSource(loaded.atlas, megatile);
      made.ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, x * TILE, y * TILE, TILE, TILE);
    }
  }
  return { image: made.canvas, width: def.width * TILE, height: def.height * TILE };
}

/**
 * A clip as the paste ghost draws it — `MapViewport`'s clipboard pass, without the
 * viewport: the picture, the objects out of the sprite cache, the location boxes. Drawn
 * with the graphics of the clip's own tileset, so a clip from another one is null rather
 * than a picture of the wrong tiles.
 */
function renderClip(clip: Clip, loaded: LoadedTileset, assets: UnitAssets | null, teamOf: (owner: number) => ReturnType<typeof playerTeamColor>, colorOf: (owner: number) => string, options: RenderClipOptions): PluginImage | null {
  const ppt = Math.max(1, Math.floor(options.pixelsPerTile ?? TILE));
  const parts = { ...ALL_CLIP_PARTS, ...options.parts };
  const made = canvasOf(clip.width * ppt, clip.height * ppt);
  if (!made) return null;
  const { ctx } = made;
  const scale = ppt / TILE;
  const blit = (x: number, y: number, id: number) => {
    if (x < 0 || y < 0 || x >= clip.width || y >= clip.height) return;
    const megatile = megatileForTile(loaded.tileset, id);
    if (megatile <= 0) return;
    const src = atlasSource(loaded.atlas, megatile);
    ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, x * ppt, y * ppt, ppt, ppt);
  };
  ctx.imageSmoothingEnabled = ppt < TILE;
  if (parts.terrain && clip.tiles && clip.ground) {
    const picture = parts.doodads ? clip.tiles : clip.ground;
    for (let y = 0; y < clip.height; y++) for (let x = 0; x < clip.width; x++) blit(x, y, picture[y * clip.width + x]);
  } else if (parts.doodads) {
    for (const d of clip.doodads) {
      const def = loaded.doodads.byId.get(d.doodadId);
      if (!def) continue;
      const o = doodadOrigin(def, d.x, d.y);
      for (let row = 0; row < def.height; row++) for (let col = 0; col < def.width; col++) {
        const id = def.tiles[row * def.width + col];
        if (id !== 0) blit(o.x + col, o.y + row, id);
      }
    }
  }
  ctx.imageSmoothingEnabled = scale < 1;
  const { palette, key } = { palette: loaded.tileset.palette, key: loaded.name };
  const drawFrame = (frame: { image: CanvasImageSource; width: number; height: number } | null, cx: number, cy: number) => {
    if (!frame) return false;
    const w = frame.width * scale, h = frame.height * scale;
    ctx.drawImage(frame.image, cx * scale - w / 2, cy * scale - h / 2, w, h);
    return true;
  };
  const drawUnit = (unitId: number, owner: number, cx: number, cy: number) => {
    if (!assets) return false;
    const team = teamOf(owner);
    if (!drawFrame(getUnitSprite(assets, unitId, team, palette, key), cx, cy)) return false;
    const sub = subunitOf(assets, unitId);
    if (sub !== NO_UNIT) drawFrame(getUnitSprite(assets, sub, team, palette, key), cx, cy);
    return true;
  };
  const drawSprite = (spriteId: number, flags: number, owner: number, cx: number, cy: number) => {
    if (!assets) return false;
    if (!(flags & SpriteFlag.PureSprite)) return drawUnit(spriteId, owner, cx, cy);
    const imageId = assets.sprites.image[spriteId];
    if (imageId === undefined) return false;
    return drawFrame(getImageFrame(assets, imageId, 0, (flags & SpriteFlag.Flipped) !== 0, teamOf(owner), palette, key), cx, cy);
  };
  const marker = (cx: number, cy: number, color: string) => {
    const r = Math.max(2, 6 * scale);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx * scale, cy * scale, r, 0, Math.PI * 2);
    ctx.fill();
  };
  if (parts.doodads) {
    for (const d of clip.doodads) {
      const def = loaded.doodads.byId.get(d.doodadId);
      if (!def?.overlay) continue;
      const flags = (def.overlay.kind === "sprite" ? SpriteFlag.PureSprite : 0) | (def.overlay.flipped ? SpriteFlag.Flipped : 0);
      drawSprite(def.overlay.id, flags, d.owner, d.x, d.y);
    }
  }
  if (parts.units) for (const u of clip.units) if (!drawUnit(u.unitId, u.owner, u.x, u.y)) marker(u.x, u.y, colorOf(u.owner));
  if (parts.sprites) for (const s of clip.sprites) if (!drawSprite(s.spriteId, s.flags, s.owner, s.x, s.y)) marker(s.x, s.y, "#c9a0ff");
  if (parts.locations) {
    ctx.lineWidth = 1;
    for (const l of clip.locations) {
      const b = boundsOf(clipLocationBounds(l, 0, 0));
      const x = b.left * scale, y = b.top * scale, w = (b.right - b.left) * scale, h = (b.bottom - b.top) * scale;
      ctx.fillStyle = "rgba(79,209,197,0.13)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(79,209,197,0.9)";
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.setLineDash([]);
    }
  }
  return { image: made.canvas, width: made.canvas.width, height: made.canvas.height };
}

export function createGraphicsApi(store: Store, bag: Bag): GraphicsApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const teamOf = (owner: number) => {
    const scn = scenario();
    return playerTeamColor(scn?.playerColors ?? null, scn?.playerRgb ?? null, owner);
  };
  /** The tileset palette every sprite is painted through, and the key its cache uses. */
  const paletteOf = (l: LoadedTileset) => ({ palette: l.tileset.palette, key: l.name });
  const cached = (kind: string, id: number, build: (l: LoadedTileset) => PluginImage | null): PluginImage | null => {
    const l = loaded();
    if (!l) return null;
    const key = `${l.name}|${kind}|${id}`;
    if (!composed.has(key)) composed.set(key, build(l));
    return composed.get(key) ?? null;
  };
  const frameImage = (assets: UnitAssets, imageId: number, flip: boolean, owner: number): PluginImage | null => {
    const l = loaded();
    if (!l || imageId < 0) return null;
    const { palette, key } = paletteOf(l);
    const frame = getImageFrame(assets, imageId, 0, flip, teamOf(owner), palette, key);
    return frame ? { image: frame.image, width: frame.width, height: frame.height } : null;
  };

  return {
    ready: () => ({ tileset: loaded() !== null, units: peekUnitAssets() !== null }),

    load: async () => {
      await Promise.allSettled([ensureTileset(store.get(tilesetFileNameAtom)), getUnitAssets()]);
      return { tileset: loaded() !== null, units: peekUnitAssets() !== null };
    },

    unitImage: (unitId, options = {}) => {
      const assets = peekUnitAssets();
      const l = loaded();
      if (!assets || !l) return null;
      const { palette, key } = paletteOf(l);
      const sprite = getUnitSprite(assets, unitId, teamOf(options.owner ?? 0), palette, key);
      return sprite ? { image: sprite.image, width: sprite.width, height: sprite.height } : null;
    },

    spriteImage: (kind: SpriteKind, id, options = {}) => {
      const assets = peekUnitAssets();
      if (!assets) return null;
      if (kind === "unit") {
        const l = loaded();
        if (!l) return null;
        const { palette, key } = paletteOf(l);
        const sprite = getUnitSprite(assets, id, teamOf(options.owner ?? 0), palette, key);
        return sprite ? { image: sprite.image, width: sprite.width, height: sprite.height } : null;
      }
      const imageId = assets.sprites.image[id];
      return imageId === undefined ? null : frameImage(assets, imageId, options.flipped ?? false, options.owner ?? 0);
    },

    tileImage: (tileId) => cached("tile", tileId, (l) => buildTile(l, tileId)),
    doodadImage: (doodadId) => cached("doodad", doodadId, (l) => buildDoodad(l, doodadId)),

    renderClip: (clip, options = {}) => {
      const name = TILESET_FILENAMES[clip.era];
      const l = name ? peekTileset(name) : null;
      if (!l || typeof document === "undefined") return null;
      const scn = scenario();
      return renderClip(clip, l, peekUnitAssets(), teamOf, (owner) => displayColorHex(scn?.playerColors, scn?.playerRgb, owner), options);
    },

    renderRect: async (rect, options = {}) => {
      const scn = scenario();
      if (!scn || typeof document === "undefined") return null;
      try {
        await ensureTileset(store.get(tilesetFileNameAtom));
      } catch {
        return null;
      }
      return exportMapImage(scn, { ...DEFAULT_IMAGE_OPTIONS, pixelsPerTile: 8, ...options, rect });
    },

    playerColor: (owner) => {
      const scn = scenario();
      return displayColorHex(scn?.playerColors, scn?.playerRgb, owner);
    },

    onImageLoaded: (listener) => {
      const off = onGrpLoaded(() => { try { listener(); } catch (err) { logError("plugins", "An onImageLoaded listener failed", err); } });
      return bag.add(off);
    },

    /**
     * Ask for the GRPs a unit type draws through. `requestGrp` starts the fetch and
     * `onImageLoaded` reports when one lands, so a list can fill in as they arrive.
     */
    requestUnit: (unitId) => {
      const assets = peekUnitAssets();
      if (!assets) return false;
      const want = [unitImageId(assets, unitId)];
      const sub = subunitOf(assets, unitId);
      if (sub !== NO_UNIT) want.push(unitImageId(assets, sub));
      let ready = true;
      for (const imageId of want) {
        const path = imageId >= 0 ? imageGrpPath(assets, imageId) : null;
        if (!path || !requestGrp(path)) ready = false;
      }
      return ready;
    },

    requestSprite: (kind: SpriteKind, id) => {
      const assets = peekUnitAssets();
      if (!assets) return false;
      const imageId = kind === "unit" ? unitImageId(assets, id) : assets.sprites.image[id] ?? -1;
      const path = imageId >= 0 ? imageGrpPath(assets, imageId) : null;
      return path ? Boolean(requestGrp(path)) : false;
    },
  };
}
