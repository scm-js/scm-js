/**
 * What a tool is about to do, drawn under the pointer: the tiles a brush would lay, the
 * unit, sprite or doodad a click would place, the clip a paste would stamp.
 */
import type { Scenario } from "../../../formats/chk/scenario";
import { tilesetIndex } from "../../../formats/chk/scenario";
import type { LoadedTileset } from "../../../formats/tileset/load";
import { atlasSource } from "../../../formats/tileset/atlas";
import { megatileForTile } from "../../../formats/tileset/decode";
import { doodadOrigin, type DoodadCatalogue } from "../../../formats/tileset/doodads";
import type { UnitsDat } from "../../../formats/dat/dat";
import { inMap, neighbourOf, SIDES } from "../../../editor/blend";
import { clipLocationBounds, type Clip, type ClipParts } from "../../../editor/clipboard";
import { boundsOf } from "../../../editor/locations";
import { placementBox, unitBox, unitGeometry } from "../../../editor/units";
import { START_LOCATION } from "../../../data/units";
import type { DoodadGhost } from "../../../hooks/useDoodadTools";
import type { useSpriteTools } from "../../../hooks/useSpriteTools";
import type { useUnitTools } from "../../../hooks/useUnitTools";
import type { SpritePainter } from "./objects";
import { INK, strokeBox, strokeTileRect, TILE, type PaintView } from "./view";

type UnitGhost = ReturnType<ReturnType<typeof useUnitTools>["ghostsAt"]>[number];
type SpriteGhost = ReturnType<ReturnType<typeof useSpriteTools>["ghostsAt"]>[number];

/** One atlas tile at a tile position, at the context's current alpha. Nothing for the null tile. */
function blitTile(v: PaintView, assets: LoadedTileset, id: number, tx: number, ty: number) {
  const megatile = megatileForTile(assets.tileset, id);
  if (megatile <= 0) return;
  const src = atlasSource(assets.atlas, megatile);
  v.ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, tx * v.tilePx - v.sx, ty * v.tilePx - v.sy, v.tilePx, v.tilePx);
}

/** A doodad as it would be placed: its tiles translucent, refused cells red, the overlay sprite ghosted. */
export function drawDoodadGhost(v: PaintView, paint: SpritePainter, assets: LoadedTileset | null, g: DoodadGhost, alpha: number) {
  const { ctx, zoom, sx, sy, tilePx } = v;
  const ok = g.verdict.ok;
  const bad = new Set(g.verdict.bad);
  ctx.imageSmoothingEnabled = tilePx < TILE;
  for (let row = 0; row < g.def.height; row++) {
    for (let col = 0; col < g.def.width; col++) {
      const cell = row * g.def.width + col;
      const id = g.def.tiles[cell];
      const px = (g.x + col) * tilePx - sx, py = (g.y + row) * tilePx - sy;
      if (id !== 0 && assets && tilePx >= 4) {
        ctx.globalAlpha = alpha;
        blitTile(v, assets, id, g.x + col, g.y + row);
        ctx.globalAlpha = 1;
      }
      if (bad.has(cell)) {
        ctx.fillStyle = "rgba(240,90,90,0.45)";
        ctx.fillRect(px, py, tilePx, tilePx);
      } else if (id === 0 && g.def.required[cell] !== 0) {
        // A cell the doodad needs but does not cover (a ramp's approach): hatch it lightly.
        ctx.fillStyle = ok ? "rgba(230,185,92,0.10)" : "rgba(240,90,90,0.10)";
        ctx.fillRect(px, py, tilePx, tilePx);
      }
    }
  }
  ctx.imageSmoothingEnabled = true;
  if (g.def.overlay) {
    const cx = (g.x * TILE + g.def.width * 16) * zoom - sx, cy = (g.y * TILE + g.def.height * 16) * zoom - sy;
    ctx.imageSmoothingEnabled = zoom < 1;
    paint.thg2(g.def.overlay.id, g.def.flags, g.owner, cx, cy, alpha);
    ctx.imageSmoothingEnabled = true;
  }
  strokeTileRect(v, { x0: g.x, y0: g.y, x1: g.x + g.def.width, y1: g.y + g.def.height }, ok ? INK.gold : INK.red);
}

/**
 * The clip with its top-left tile at (`ax`, `ay`): the picture at three-quarter strength
 * (its own tiles, or the catalogue's for a doodad-only clip), the objects as ghosts, and
 * the outline — red when part of it would fall off the map.
 */
export function drawClipGhost(
  v: PaintView,
  paint: SpritePainter,
  scenario: Scenario,
  assets: LoadedTileset | null,
  catalogue: DoodadCatalogue,
  clip: Clip,
  parts: ClipParts,
  ax: number,
  ay: number,
) {
  const { ctx, zoom, sx, sy, tilePx, mapW, mapH } = v;
  const ox = ax * TILE, oy = ay * TILE;
  const sameTileset = clip.era === tilesetIndex(scenario);
  const blit = (tx: number, ty: number, id: number) => {
    if (!assets || tilePx < 4 || tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return;
    blitTile(v, assets, id, tx, ty);
  };
  ctx.globalAlpha = 0.75;
  ctx.imageSmoothingEnabled = tilePx < TILE;
  if (sameTileset && parts.terrain && clip.tiles && clip.ground) {
    const picture = parts.doodads ? clip.tiles : clip.ground;
    for (let y = 0; y < clip.height; y++) for (let x = 0; x < clip.width; x++) blit(ax + x, ay + y, picture[y * clip.width + x]);
  } else if (sameTileset && parts.doodads) {
    for (const d of clip.doodads) {
      const def = catalogue.byId.get(d.doodadId);
      if (!def) continue;
      const o = doodadOrigin(def, d.x + ox, d.y + oy);
      for (let row = 0; row < def.height; row++) for (let col = 0; col < def.width; col++) {
        const id = def.tiles[row * def.width + col];
        if (id !== 0) blit(o.x + col, o.y + row, id);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = zoom < 1;
  if (parts.units) {
    for (const u of clip.units) {
      const ux = (u.x + ox) * zoom - sx, uy = (u.y + oy) * zoom - sy;
      if (!paint.unit(u.unitId, u.owner, ux, uy, 0.6) && u.unitId !== START_LOCATION) paint.unitMarker(u.owner, ux, uy);
    }
  }
  if (parts.sprites) {
    for (const s of clip.sprites) {
      const px = (s.x + ox) * zoom - sx, py = (s.y + oy) * zoom - sy;
      if (!paint.thg2(s.spriteId, s.flags, s.owner, px, py, 0.6)) paint.spriteMarker(px, py);
    }
  }
  ctx.imageSmoothingEnabled = true;
  if (parts.locations) {
    for (const l of clip.locations) {
      const b = boundsOf(clipLocationBounds(l, ax, ay));
      ctx.fillStyle = "rgba(79,209,197,0.13)";
      ctx.fillRect(b.left * zoom - sx, b.top * zoom - sy, (b.right - b.left) * zoom, (b.bottom - b.top) * zoom);
      strokeBox(v, b, "rgba(79,209,197,0.9)", [3, 2]);
    }
  }
  const fits = ax + clip.width <= mapW && ay + clip.height <= mapH;
  strokeTileRect(v, { x0: ax, y0: ay, x1: ax + clip.width, y1: ay + clip.height }, fits ? INK.gold : INK.red);
}

/**
 * Where the active unit would land: its sprite at half strength, and the box that snaps to
 * the grid for buildings (the collision box for everything else). Red when the placement
 * checks would refuse the spot, with the unit in the way outlined. Under a symmetry mode
 * the images follow, drawn fainter.
 */
export function drawUnitGhosts(v: PaintView, paint: SpritePainter, scenario: Scenario | null, unitTables: UnitsDat | null, ghosts: readonly UnitGhost[]) {
  const { ctx, zoom, sx, sy } = v;
  ghosts.forEach((ghost, i) => {
    const gx = ghost.x * zoom - sx, gy = ghost.y * zoom - sy;
    ctx.imageSmoothingEnabled = zoom < 1;
    const drawn = paint.unit(ghost.unitId, ghost.owner, gx, gy, ghost.problem ? 0.35 : i === 0 ? 0.6 : 0.4);
    ctx.imageSmoothingEnabled = true;
    const b = ghost.geometry.building ? placementBox(ghost.geometry, ghost.x, ghost.y) : unitBox(ghost.geometry, ghost.x, ghost.y);
    if (!drawn || ghost.problem) {
      ctx.fillStyle = ghost.problem ? "rgba(240,90,90,0.28)" : paint.colorOf(ghost.owner) + "66";
      ctx.fillRect(b.left * zoom - sx, b.top * zoom - sy, (b.right - b.left) * zoom, (b.bottom - b.top) * zoom);
    }
    const color = ghost.problem ? INK.red : INK.gold;
    strokeBox(v, b, color, null, 1);
    const blocker = ghost.blocker >= 0 ? scenario?.units[ghost.blocker] : null;
    if (blocker) strokeBox(v, unitBox(unitGeometry(unitTables, blocker.unitId), blocker.x, blocker.y), color, [3, 3]);
  });
}

/** Where the active sprite would land: its graphic at half strength (a marker while the GRP loads) inside its frame box. Sprites have no placement rules to fail. */
export function drawSpriteGhosts(v: PaintView, paint: SpritePainter, ghosts: readonly SpriteGhost[]) {
  const { ctx, zoom, sx, sy } = v;
  ghosts.forEach((ghost, i) => {
    const gx = ghost.x * zoom - sx, gy = ghost.y * zoom - sy;
    ctx.imageSmoothingEnabled = zoom < 1;
    if (!paint.thg2(ghost.id, ghost.flags, ghost.owner, gx, gy, i === 0 ? 0.6 : 0.4)) paint.spriteMarker(gx, gy);
    ctx.imageSmoothingEnabled = true;
    strokeBox(v, ghost.box, INK.gold, null, 1);
  });
}

/** The isometric brush works in diamonds — 4 tiles wide, 2 tall, centred on the lattice — so the ones a stroke would set are outlined rather than a tile square. */
export function drawIsomDiamonds(v: PaintView, diamonds: readonly { x: number; y: number }[]) {
  const { ctx, sx, sy, tilePx } = v;
  ctx.strokeStyle = INK.gold;
  ctx.fillStyle = "rgba(230,185,92,0.12)";
  ctx.lineWidth = 1.5;
  for (const d of diamonds) {
    const cx = d.x * 2 * tilePx - sx, cy = d.y * tilePx - sy;
    ctx.beginPath();
    ctx.moveTo(cx - 2 * tilePx, cy);
    ctx.lineTo(cx, cy - tilePx);
    ctx.lineTo(cx + 2 * tilePx, cy);
    ctx.lineTo(cx, cy + tilePx);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * The tiles a terrain brush would leave behind, at three-quarter strength. Answers whether
 * any of them cycles, so the animation loop keeps the preview moving.
 */
export function drawTileGhost(v: PaintView, assets: LoadedTileset, ghost: readonly { x: number; y: number; id: number }[]): boolean {
  const { ctx, sx, sy, tilePx } = v;
  let animated = false;
  ctx.globalAlpha = 0.75;
  ctx.imageSmoothingEnabled = tilePx < TILE;
  for (const g of ghost) {
    const megatile = megatileForTile(assets.tileset, g.id);
    const px = g.x * tilePx - sx, py = g.y * tilePx - sy;
    if (megatile <= 0) {
      ctx.fillStyle = "#000";
      ctx.fillRect(px, py, tilePx, tilePx);
      continue;
    }
    const src = atlasSource(assets.atlas, megatile);
    if (src.animated) animated = true;
    ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
  }
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = true;
  return animated;
}

/** The square a brush of `size` tiles covers around the hovered tile, outlined in gold over a `wash` (none where the tile ghost already shows it). */
export function drawBrushSquare(v: PaintView, tile: { x: number; y: number }, size: number, wash: string | null) {
  const { ctx, sx, sy, tilePx } = v;
  const off = Math.floor((size - 1) / 2);
  const hx = (tile.x - off) * tilePx - sx, hy = (tile.y - off) * tilePx - sy;
  if (wash) {
    ctx.fillStyle = wash;
    ctx.fillRect(hx, hy, tilePx * size, tilePx * size);
  }
  ctx.strokeStyle = INK.gold;
  ctx.lineWidth = 1;
  ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(tilePx * size) - 1, Math.round(tilePx * size) - 1);
}

/** The Blend brush: the anchor cell and the four neighbours the palette can fill. */
export function drawBlendAnchor(v: PaintView, scenario: Scenario, anchor: { x: number; y: number }) {
  const { ctx, sx, sy, tilePx } = v;
  for (const side of SIDES) {
    const n = neighbourOf(anchor, side);
    if (inMap(scenario, n)) strokeTileRect(v, { x0: n.x, y0: n.y, x1: n.x + 1, y1: n.y + 1 }, "rgba(230,185,92,0.6)", [3, 2]);
  }
  ctx.strokeStyle = INK.gold;
  ctx.lineWidth = 2;
  ctx.strokeRect(Math.round(anchor.x * tilePx - sx) + 1, Math.round(anchor.y * tilePx - sy) + 1, Math.round(tilePx) - 2, Math.round(tilePx) - 2);
}
