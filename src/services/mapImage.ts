import { ANYWHERE_INDEX, isLocationUsed, SpriteFlag, UnitState, UnitUsed } from "../formats/chk/sections/objects";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { NO_UNIT } from "../formats/dat/dat";
import { atlasSource, type TilesetAtlas } from "../formats/tileset/atlas";
import { megatileForTile } from "../formats/tileset/decode";
import {
  ensureTileset, peekTileset, TILESET_FILENAMES, type LoadedTileset,
} from "../formats/tileset/load";
import {
  awaitGrps, getUnitAssets, imageGrpPath, peekUnitAssets, unitImageId, type UnitAssets,
} from "../formats/units/load";
import { getImageFrame, getUnitSprite, subunitOf } from "../formats/units/sprites";
import { displayColorHex, playerTeamColor } from "../data/players";
import { TILESETS } from "../data/tilesets";
import { START_LOCATION } from "../data/units";
import { boundsOf, locationName } from "../editor/locations";
import { isResource, unitGeometry } from "../editor/units";
import { drawFogOverlay } from "../components/viewport/fog";

/**
 * Rendering the open map to a picture, for File ▸ Export ▸ Image.
 *
 * There is one renderer and one dial: how many output pixels a map tile gets. At the top
 * of the range it is the map at the game's own 32 px per tile — real tileset graphics and
 * unit and sprite GRPs in the game's painter's order — and at the bottom it is the game's
 * minimap, one mean colour per tile with a dot per unit. Everything between is the same
 * picture losing detail, and the two thresholds where it does are the viewport's own, so
 * an export looks like what the map looks like on screen at that zoom:
 *
 * - below `SPRITE_PX` a unit is too small to show its graphic and becomes a minimap dot,
 *   sized by its placement box, resources in cyan (sprites drop out entirely, as they do
 *   on the game's minimap);
 * - below `FLAT_PX` the atlas blit costs more than it shows and terrain is filled from
 *   the precomputed mean megatile colours.
 *
 * A 128×128 map is 4096×4096 px at 32, and 128×128 px at 1.
 */

/** Below this many output pixels per tile, terrain is filled from mean megatile colours. */
const FLAT_PX = 4;
/** Below this many output pixels per tile, units are drawn as minimap dots rather than GRPs. */
const SPRITE_PX = 8;
const TILE = 32;

/** The scales the export offers, largest first. */
export const IMAGE_SCALES = [32, 16, 8, 4, 2, 1] as const;

export interface MapImageOptions {
  /** Output pixels per map tile. 32 matches the game's art 1:1; 1 is a minimap. */
  pixelsPerTile: number;
  units: boolean;
  sprites: boolean;
  locations: boolean;
  locationNames: boolean;
  startLocations: boolean;
  fog: boolean;
  /** Whose fog is drawn (0-based player), when `fog` is on. */
  fogPlayer: number;
  /** Grid spacing in map pixels (32 = one tile); 0 for no grid. */
  grid: number;
}

export const DEFAULT_IMAGE_OPTIONS: MapImageOptions = {
  pixelsPerTile: 32,
  units: true,
  sprites: true,
  locations: false,
  locationNames: false,
  startLocations: false,
  fog: false,
  fogPlayer: 0,
  grid: 0,
};

/** True when this scale draws unit and sprite graphics rather than minimap dots. */
export function drawsSprites(pixelsPerTile: number): boolean {
  return pixelsPerTile >= SPRITE_PX;
}

/** What `renderMapImage` draws with; either may be null when the game data is not installed. */
export interface MapImageAssets {
  tileset: LoadedTileset | null;
  units: UnitAssets | null;
}

export function imageSize(scn: Scenario, options: MapImageOptions) {
  return { width: scn.width * options.pixelsPerTile, height: scn.height * options.pixelsPerTile };
}

/**
 * Fetch what the options ask for: the map's tileset always, the unit tables and every GRP
 * the drawn units and sprites need when they will be big enough to show one. Missing game
 * data is a normal state, so anything that fails comes back null and the render degrades.
 */
export async function loadMapImageAssets(scn: Scenario, options: MapImageOptions): Promise<MapImageAssets> {
  const file = TILESET_FILENAMES[tilesetIndex(scn)];
  const tileset = peekTileset(file) ?? await ensureTileset(file).catch(() => null);

  // The tables are wanted either way — the dots are sized from units.dat placement boxes.
  const units = peekUnitAssets() ?? await getUnitAssets().catch(() => null);
  if (units && drawsSprites(options.pixelsPerTile) && (options.units || options.sprites)) {
    await awaitGrps(grpPaths(scn, units, options));
  }
  return { tileset, units };
}

/** Every GRP the export will ask for, so they can all be fetched before the single draw pass. */
function grpPaths(scn: Scenario, assets: UnitAssets, options: MapImageOptions): string[] {
  const paths = new Set<string>();
  const addImage = (imageId: number) => {
    const path = imageId >= 0 ? imageGrpPath(assets, imageId) : null;
    if (path) paths.add(path);
  };
  const addUnit = (unitId: number) => {
    addImage(unitImageId(assets, unitId));
    const sub = subunitOf(assets, unitId);
    if (sub !== NO_UNIT) addImage(unitImageId(assets, sub));
  };
  if (options.units) for (const u of scn.units) addUnit(u.unitId);
  if (options.sprites) {
    for (const r of scn.sprites) {
      if (r.flags & SpriteFlag.PureSprite) addImage(assets.sprites.image[r.spriteId] ?? -1);
      else addUnit(r.spriteId);
    }
  }
  return [...paths];
}

/** The whole map on a fresh canvas. Everything it needs must already be loaded (see above). */
export function renderMapImage(scn: Scenario, assets: MapImageAssets, options: MapImageOptions): HTMLCanvasElement {
  const { width, height } = imageSize(scn, options);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, width);
  canvas.height = Math.max(1, height);
  const ctx = canvas.getContext("2d")!;
  const tilePx = options.pixelsPerTile;
  const zoom = tilePx / TILE;
  const era = tilesetIndex(scn);

  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawTerrain(ctx, scn, assets.tileset, tilePx);

  if (options.grid > 0) drawGrid(ctx, canvas, (options.grid / TILE) * tilePx);

  const colorOf = (owner: number) => displayColorHex(scn.playerColors, scn.playerRgb, owner);

  if (options.locations) drawLocations(ctx, scn, zoom, options.locationNames && drawsSprites(tilePx));

  if (drawsSprites(tilePx)) drawObjects(ctx, scn, assets, options, zoom, colorOf);
  else drawUnitDots(ctx, scn, assets.units, options, tilePx, colorOf);

  if (options.startLocations) drawStartLocations(ctx, scn, tilePx, colorOf);

  if (options.fog) {
    drawFogOverlay(ctx, scn, era, options.fogPlayer, {
      x0: 0, y0: 0, x1: scn.width, y1: scn.height, tilePx, sx: 0, sy: 0,
    });
  }
  return canvas;
}

function drawTerrain(ctx: CanvasRenderingContext2D, scn: Scenario, loaded: LoadedTileset | null, tilePx: number) {
  if (!loaded) {
    // No tileset graphics installed: the flat per-tileset colour the viewport falls back to.
    ctx.fillStyle = TILESETS[tilesetIndex(scn)]?.color ?? "#20303a";
    ctx.fillRect(0, 0, scn.width * tilePx, scn.height * tilePx);
    return;
  }
  const { atlas, tileset } = loaded;
  const flat = tilePx < FLAT_PX;
  ctx.imageSmoothingEnabled = !flat && tilePx < TILE;
  for (let ty = 0; ty < scn.height; ty++) {
    for (let tx = 0; tx < scn.width; tx++) {
      const megatile = megatileForTile(tileset, scn.tiles[ty * scn.width + tx]);
      const px = tx * tilePx;
      const py = ty * tilePx;
      if (megatile < 0) {
        ctx.fillStyle = "#000";
        ctx.fillRect(px, py, tilePx, tilePx);
      } else if (flat) {
        ctx.fillStyle = meanColor(atlas, megatile);
        ctx.fillRect(px, py, tilePx, tilePx);
      } else {
        const src = atlasSource(atlas, megatile);
        ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
      }
    }
  }
  ctx.imageSmoothingEnabled = true;
}

function meanColor(atlas: TilesetAtlas, megatile: number): string {
  const rgb = atlas.averages[megatile];
  return `rgb(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255})`;
}

function drawGrid(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, step: number) {
  if (step < 3) return;
  ctx.strokeStyle = step >= 16 ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= canvas.width; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, canvas.height);
  }
  for (let y = 0; y <= canvas.height; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(canvas.width, Math.round(y) + 0.5);
  }
  ctx.stroke();
}

/** Units and THG2 sprites in the game's painter's order: ground by y, flyers last. */
function drawObjects(
  ctx: CanvasRenderingContext2D,
  scn: Scenario,
  assets: MapImageAssets,
  options: MapImageOptions,
  zoom: number,
  colorOf: (owner: number) => string,
) {
  if (!options.units && !options.sprites) return;
  const unitAssets = assets.units;
  const tables = unitAssets?.units ?? null;
  const palette = assets.tileset?.tileset.palette ?? null;
  const paletteKey = assets.tileset?.name ?? "";
  const tilePx = zoom * TILE;
  const teamOf = (owner: number) => playerTeamColor(scn.playerColors, scn.playerRgb, owner);

  const drawUnit = (unitId: number, owner: number, ux: number, uy: number, alpha: number): boolean => {
    if (!unitAssets || !palette || tilePx < SPRITE_PX) return false;
    const team = teamOf(owner);
    const sprite = getUnitSprite(unitAssets, unitId, team, palette, paletteKey);
    if (!sprite) return false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite.image, ux - (sprite.width * zoom) / 2, uy - (sprite.height * zoom) / 2, sprite.width * zoom, sprite.height * zoom);
    const sub = subunitOf(unitAssets, unitId);
    const turret = sub === NO_UNIT ? null : getUnitSprite(unitAssets, sub, team, palette, paletteKey);
    if (turret) ctx.drawImage(turret.image, ux - (turret.width * zoom) / 2, uy - (turret.height * zoom) / 2, turret.width * zoom, turret.height * zoom);
    ctx.globalAlpha = 1;
    return true;
  };
  const drawThg2 = (spriteId: number, flags: number, owner: number, px: number, py: number, alpha: number): boolean => {
    if (!unitAssets || !palette || tilePx < SPRITE_PX) return false;
    if (!(flags & SpriteFlag.PureSprite)) return drawUnit(spriteId, owner, px, py, alpha);
    const imageId = unitAssets.sprites.image[spriteId];
    if (imageId === undefined) return false;
    const frame = getImageFrame(unitAssets, imageId, 0, (flags & SpriteFlag.Flipped) !== 0, teamOf(owner), palette, paletteKey);
    if (!frame) return false;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
    ctx.drawImage(frame.image, px - (frame.width * zoom) / 2, py - (frame.height * zoom) / 2, frame.width * zoom, frame.height * zoom);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    return true;
  };
  const marker = (color: string, ux: number, uy: number, r: number) => {
    ctx.fillStyle = color;
    ctx.fillRect(ux - r, uy - r, r * 2, r * 2);
  };

  type Drawable = { kind: "unit" | "sprite"; i: number; y: number; flyer: number };
  const order: Drawable[] = [];
  if (options.units) scn.units.forEach((u, i) => order.push({ kind: "unit", i, y: u.y, flyer: unitGeometry(tables, u.unitId).flyer ? 1 : 0 }));
  if (options.sprites) scn.sprites.forEach((r, i) => order.push({ kind: "sprite", i, y: r.y, flyer: 0 }));
  order.sort((a, b) => a.flyer - b.flyer || a.y - b.y || (a.kind === b.kind ? a.i - b.i : a.kind === "unit" ? -1 : 1));

  ctx.imageSmoothingEnabled = zoom < 1;
  for (const d of order) {
    if (d.kind === "sprite") {
      const r = scn.sprites[d.i];
      const alpha = r.flags & SpriteFlag.Disabled ? 0.5 : 1;
      if (drawThg2(r.spriteId, r.flags, r.owner, r.x * zoom, r.y * zoom, alpha)) continue;
      marker("rgba(201,168,255,0.85)", r.x * zoom, r.y * zoom, Math.max(1, tilePx * 0.25));
      continue;
    }
    const u = scn.units[d.i];
    // A cloaked unit is drawn faint, the way the game shows your own cloaked units.
    const cloaked = (u.validStates & UnitUsed.State) !== 0 && (u.stateFlags & UnitState.Cloaked) !== 0;
    if (drawUnit(u.unitId, u.owner, u.x * zoom, u.y * zoom, cloaked ? 0.5 : 1)) continue;
    // Start locations get their numbered marker below instead.
    if (u.unitId !== START_LOCATION) marker(colorOf(u.owner) + "cc", u.x * zoom, u.y * zoom, Math.max(1, tilePx * 0.34));
  }
  ctx.imageSmoothingEnabled = true;
}

/**
 * The game's minimap dots: one rectangle per unit in its owner's colour sized by its
 * placement box, resources cyan. What a unit becomes once it is too small to draw.
 */
function drawUnitDots(
  ctx: CanvasRenderingContext2D,
  scn: Scenario,
  units: UnitAssets | null,
  options: MapImageOptions,
  tilePx: number,
  colorOf: (owner: number) => string,
) {
  if (!options.units) return;
  const tables = units?.units ?? null;
  for (const u of scn.units) {
    if (u.unitId === START_LOCATION) continue;
    const g = unitGeometry(tables, u.unitId);
    const uw = Math.max(1, (g.placeW / TILE) * tilePx);
    const uh = Math.max(1, (g.placeH / TILE) * tilePx);
    ctx.fillStyle = isResource(u.unitId) ? "#5fd7ff" : colorOf(u.owner);
    ctx.fillRect((u.x / TILE) * tilePx - uw / 2, (u.y / TILE) * tilePx - uh / 2, uw, uh);
  }
}

/** The location boxes as the viewport draws them; Anywhere spans the map and is skipped. */
function drawLocations(ctx: CanvasRenderingContext2D, scn: Scenario, zoom: number, names: boolean) {
  const fontPx = Math.max(9, Math.min(13, zoom * TILE * 0.4));
  ctx.font = `${fontPx}px sans-serif`;
  ctx.lineWidth = 1;
  scn.locations.forEach((l, index) => {
    if (index === ANYWHERE_INDEX || !isLocationUsed(l)) return;
    const b = boundsOf(l);
    const lx = b.left * zoom, ly = b.top * zoom;
    const lw = (b.right - b.left) * zoom, lh = (b.bottom - b.top) * zoom;
    ctx.fillStyle = "rgba(79,209,197,0.13)";
    ctx.fillRect(lx, ly, lw, lh);
    ctx.strokeStyle = "rgba(79,209,197,0.9)";
    ctx.strokeRect(Math.round(lx) + 0.5, Math.round(ly) + 0.5, Math.max(1, Math.round(lw)), Math.max(1, Math.round(lh)));
    if (!names) return;
    const name = locationName(scn, index);
    const tw = ctx.measureText(name).width;
    ctx.fillStyle = "rgba(10,12,16,0.78)";
    ctx.fillRect(lx + 1, ly + 1, tw + 8, fontPx + 5);
    ctx.fillStyle = "#bff5ef";
    ctx.fillText(name, lx + 5, ly + 1 + fontPx);
  });
}

function drawStartLocations(ctx: CanvasRenderingContext2D, scn: Scenario, tilePx: number, colorOf: (owner: number) => string) {
  const r = Math.max(3, tilePx * 1.5);
  for (const u of scn.units) {
    if (u.unitId !== START_LOCATION) continue;
    const cx = (u.x / TILE) * tilePx, cy = (u.y / TILE) * tilePx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(u.owner) + "55";
    ctx.fill();
    ctx.lineWidth = Math.max(1, tilePx / 16);
    ctx.strokeStyle = colorOf(u.owner);
    ctx.stroke();
    if (tilePx >= 12) {
      ctx.fillStyle = "#fff";
      ctx.font = `bold ${Math.max(10, tilePx * 0.5)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(String(u.owner + 1), cx, cy + tilePx * 0.18);
      ctx.textAlign = "left";
    }
  }
}

/** Render and encode in one go. Rejects if the browser refuses the canvas size. */
export async function exportMapImage(scn: Scenario, options: MapImageOptions): Promise<Blob> {
  const assets = await loadMapImageAssets(scn, options);
  const canvas = renderMapImage(scn, assets, options);
  return await canvasToPng(canvas);
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      // A canvas past the browser's size limit encodes to nothing rather than throwing.
      if (blob) resolve(blob);
      else reject(new Error("The image is too large for this browser to encode. Try a smaller scale."));
    }, "image/png");
  });
}
