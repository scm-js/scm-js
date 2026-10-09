/**
 * Placed units and THG2 sprites: GRP sprites in the game's painter's order, team-coloured
 * through tunit.pcx and the tileset palette. A type whose graphic is still loading — or
 * everything, when the unit data is not installed — gets a marker instead.
 */
import type { Scenario } from "../../../formats/chk/scenario";
import { tilesetIndex } from "../../../formats/chk/scenario";
import { SpriteFlag, UnitState, UnitUsed } from "../../../formats/chk/sections/objects";
import { NO_UNIT } from "../../../formats/dat/dat";
import type { LoadedTileset } from "../../../formats/tileset/load";
import type { UnitAnimator, SpriteState } from "../../../formats/units/animate";
import type { UnitAssets } from "../../../formats/units/load";
import { getImageFrame, getUnitSprite, subunitOf } from "../../../formats/units/sprites";
import type { TeamColorSpec } from "../../../formats/units/teamColor";
import { displayColorHex, playerTeamColor } from "../../../data/players";
import { START_LOCATION } from "../../../data/units";
import { unitGeometry } from "../../../editor/units";
import type { PaintView } from "./view";

/** How far outside the view a unit is still drawn, in map pixels: the largest GRP box is a few hundred. */
export const UNIT_MARGIN = 512;

/** How one map's units and sprites are put on the canvas; every position is in screen pixels. */
export interface SpritePainter {
  /** The player's colour as the editor shows it, `#rrggbb`. */
  colorOf(owner: number): string;
  /** A unit in its editor pose, with its turret. False when the graphic is not there to draw. */
  unit(unitId: number, owner: number, x: number, y: number, alpha?: number): boolean;
  /** A unit or sprite as its iscript sprite: shadow, main graphic, overlays, turret, fires and smoke. False when the main graphic is not ready yet. */
  animated(sprite: SpriteState, owner: number, x: number, y: number, alpha: number): boolean;
  /** A THG2 sprite in its editor pose: the sprites.dat image (pure) or the unit's picture. */
  thg2(spriteId: number, flags: number, owner: number, x: number, y: number, alpha?: number): boolean;
  unitMarker(owner: number, x: number, y: number): void;
  spriteMarker(x: number, y: number): void;
}

export function spritePainter(v: PaintView, scenario: Scenario | null, unitAssets: UnitAssets | null, tilesetAssets: LoadedTileset | null): SpritePainter {
  const { ctx, zoom, tilePx } = v;
  const palette = tilesetAssets?.tileset.palette ?? null;
  const paletteKey = tilesetAssets?.name ?? "";
  const colors = scenario?.playerColors;
  const playerRgb = scenario?.playerRgb;
  const teamOf = (owner: number) => playerTeamColor(colors, playerRgb, owner);
  const colorOf = (owner: number) => displayColorHex(colors, playerRgb, owner);

  const unit = (unitId: number, owner: number, ux: number, uy: number, alpha = 1): boolean => {
    if (!unitAssets || !palette || tilePx < 8) return false;
    const team = teamOf(owner);
    const sprite = getUnitSprite(unitAssets, unitId, team, palette, paletteKey);
    if (!sprite) return false;
    const w = sprite.width * zoom, h = sprite.height * zoom;
    ctx.globalAlpha = alpha;
    ctx.drawImage(sprite.image, ux - w / 2, uy - h / 2, w, h);
    const sub = subunitOf(unitAssets, unitId);
    if (sub !== NO_UNIT) {
      const turret = getUnitSprite(unitAssets, sub, team, palette, paletteKey);
      if (turret) ctx.drawImage(turret.image, ux - (turret.width * zoom) / 2, uy - (turret.height * zoom) / 2, turret.width * zoom, turret.height * zoom);
    }
    ctx.globalAlpha = 1;
    return true;
  };
  /** One sprite's images, each at its own offset. */
  const images = (sprite: SpriteState, team: TeamColorSpec, ux: number, uy: number): boolean => {
    if (!unitAssets || !palette) return false;
    for (const img of sprite.images) {
      if (img.hidden) continue;
      const frame = getImageFrame(unitAssets, img.imageId, img.frame, img.flip, team, palette, paletteKey);
      if (!frame) {
        if (img === sprite.main) return false;
        continue;
      }
      const w = frame.width * zoom, h = frame.height * zoom;
      ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
      ctx.drawImage(frame.image, ux + img.x * zoom - w / 2, uy + img.y * zoom - h / 2, w, h);
    }
    ctx.globalCompositeOperation = "source-over";
    return true;
  };
  const animated = (sprite: SpriteState, owner: number, ux: number, uy: number, alpha: number): boolean => {
    ctx.globalAlpha = alpha;
    const team = teamOf(owner);
    const drawn = images(sprite, team, ux, uy);
    if (drawn && sprite.turret) images(sprite.turret, team, ux, uy);
    ctx.globalAlpha = 1;
    return drawn;
  };
  const thg2 = (spriteId: number, flags: number, owner: number, px: number, py: number, alpha = 1): boolean => {
    if (!unitAssets || !palette || tilePx < 8) return false;
    if (!(flags & SpriteFlag.PureSprite)) return unit(spriteId, owner, px, py, alpha);
    const imageId = unitAssets.sprites.image[spriteId];
    if (imageId === undefined) return false;
    const frame = getImageFrame(unitAssets, imageId, 0, (flags & SpriteFlag.Flipped) !== 0, teamOf(owner), palette, paletteKey);
    if (!frame) return false;
    const w = frame.width * zoom, h = frame.height * zoom;
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = frame.additive ? "lighter" : "source-over";
    ctx.drawImage(frame.image, px - w / 2, py - h / 2, w, h);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    return true;
  };
  const unitMarker = (owner: number, ux: number, uy: number) => {
    const r = Math.max(2, tilePx * 0.34);
    ctx.fillStyle = colorOf(owner) + "cc";
    ctx.fillRect(ux - r, uy - r, r * 2, r * 2);
    if (tilePx >= 12) {
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(ux - r) + 0.5, Math.round(uy - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
    }
  };
  const spriteMarker = (px: number, py: number) => {
    const r = Math.max(2, tilePx * 0.25);
    ctx.fillStyle = "rgba(201,168,255,0.85)";
    ctx.beginPath();
    ctx.moveTo(px, py - r);
    ctx.lineTo(px + r, py);
    ctx.lineTo(px, py + r);
    ctx.lineTo(px - r, py);
    ctx.closePath();
    ctx.fill();
  };
  return { colorOf, unit, animated, thg2, unitMarker, spriteMarker };
}

/**
 * Every unit and sprite near the view. Units and THG2 sprites share the game's painter's
 * order: everything on the ground by y (so a tree canopy over a unit works out by
 * position), flyers last. Only what is near the view is sorted — the order among those is
 * the same, and a paint does not build and sort a record for every unit on the map.
 * Answers whether anything was drawn, for the animation loop.
 */
export function drawObjects(
  v: PaintView,
  paint: SpritePainter,
  scenario: Scenario,
  unitAssets: UnitAssets | null,
  animator: UnitAnimator | null,
  show: { units: boolean; sprites: boolean },
): boolean {
  const { ctx, zoom, sx, sy, tilePx } = v;
  const unitTables = unitAssets?.units ?? null;
  const margin = UNIT_MARGIN * zoom;
  const animated = animator?.enabled ? animator : null;
  if (animated && show.units) animated.sync(scenario.units, tilesetIndex(scenario));
  if (animated && show.sprites) animated.syncSprites(scenario.sprites, tilesetIndex(scenario));
  type Drawable = { kind: "unit" | "sprite"; i: number; y: number; flyer: number };
  const order: Drawable[] = [];
  const near = (x: number, y: number) => {
    const px = x * zoom - sx, py = y * zoom - sy;
    return px >= -margin && py >= -margin && px <= v.w + margin && py <= v.h + margin;
  };
  if (show.units) scenario.units.forEach((u, i) => { if (near(u.x, u.y)) order.push({ kind: "unit", i, y: u.y, flyer: unitGeometry(unitTables, u.unitId).flyer ? 1 : 0 }); });
  if (show.sprites) scenario.sprites.forEach((r, i) => { if (near(r.x, r.y)) order.push({ kind: "sprite", i, y: r.y, flyer: 0 }); });
  order.sort((a, b) => a.flyer - b.flyer || a.y - b.y || (a.kind === b.kind ? a.i - b.i : a.kind === "unit" ? -1 : 1));
  ctx.imageSmoothingEnabled = zoom < 1;
  for (const d of order) {
    if (d.kind === "sprite") {
      const r = scenario.sprites[d.i];
      const px = r.x * zoom - sx, py = r.y * zoom - sy;
      const alpha = r.flags & SpriteFlag.Disabled ? 0.5 : 1;
      const sprite = animated?.spriteForRecord(r);
      if (sprite && tilePx >= 8 && paint.animated(sprite, r.owner, px, py, alpha)) continue;
      if (paint.thg2(r.spriteId, r.flags, r.owner, px, py, alpha)) continue;
      paint.spriteMarker(px, py);
      continue;
    }
    const u = scenario.units[d.i];
    const ux = u.x * zoom - sx;
    const uy = u.y * zoom - sy;
    // A cloaked unit is drawn faint, the way the game shows your own cloaked units.
    const cloaked = (u.validStates & UnitUsed.State) !== 0 && (u.stateFlags & UnitState.Cloaked) !== 0;
    const sprite = animated?.spriteFor(u);
    if (sprite && tilePx >= 8 && paint.animated(sprite, u.owner, ux, uy, cloaked ? 0.5 : 1)) continue;
    if (paint.unit(u.unitId, u.owner, ux, uy, cloaked ? 0.5 : 1)) continue;
    // The numbered start-location marker stands in for its sprite.
    if (u.unitId !== START_LOCATION) paint.unitMarker(u.owner, ux, uy);
  }
  ctx.imageSmoothingEnabled = true;
  return order.length > 0;
}
