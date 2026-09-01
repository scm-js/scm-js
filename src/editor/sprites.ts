/**
 * Sprite (THG2) edits as invertible change lists, in the spirit of `UnitChange`.
 *
 * A THG2 record is either a *pure sprite* — a sprites.dat entry drawn where it stands,
 * no unit behind it (tree canopies, markers, glows) — or a *unit sprite*, which the game
 * turns into a unit of that type on load (StarEdit uses these for Installation doors and
 * traps, and gives them the `Disabled` flag so a door starts closed). Both kinds are
 * placed at any pixel; there is no collision or terrain rule to check.
 *
 * `before`/`after` are whole records: null `before` is an insertion at `index`, null
 * `after` a removal, both set a replacement. Removals are listed highest index first so
 * that applying them in order keeps the remaining indices valid; undo walks the list
 * backwards and so re-inserts lowest first.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { SpriteFlag, type SpriteRecord } from "../formats/chk/sections/objects";
import { TILE_PX } from "./units";

export interface SpriteChange {
  index: number;
  before: SpriteRecord | null;
  after: SpriteRecord | null;
}

/** Insert / remove / replace on an in-place list; removals are listed highest index first. */
export function applyList<T>(list: T[], changes: readonly { index: number; before: T | null; after: T | null }[], direction: "do" | "undo") {
  const ordered = direction === "do" ? changes : [...changes].reverse();
  for (const c of ordered) {
    const before = direction === "do" ? c.before : c.after;
    const after = direction === "do" ? c.after : c.before;
    if (before && after) list[c.index] = after;
    else if (after) list.splice(c.index, 0, after);
    else if (before) list.splice(c.index, 1);
  }
}

export function applySpriteChanges(scn: Scenario, changes: readonly SpriteChange[], direction: "do" | "undo" = "do") {
  applyList(scn.sprites, changes, direction);
  if (changes.length > 0) markDirty(scn, "THG2");
}

/* ── Records ─────────────────────────────────────────────── */

export type SpriteKind = "pure" | "unit";

export function spriteKind(r: SpriteRecord): SpriteKind {
  return r.flags & SpriteFlag.PureSprite ? "pure" : "unit";
}

/**
 * A fresh record the way StarEdit writes one it did not get from a doodad: a pure sprite
 * carries just the `PureSprite` bit, a unit sprite none (plus `Disabled` when asked for).
 * Doodad overlays are the exception — they copy the doodad's whole CV5 flag word — and
 * are made by `editor/doodads.ts#makeOverlaySprite`.
 */
export function makeSprite(kind: SpriteKind, id: number, owner: number, x: number, y: number, opts: { flipped?: boolean; disabled?: boolean } = {}): SpriteRecord {
  let flags = kind === "pure" ? SpriteFlag.PureSprite : 0;
  if (opts.flipped) flags |= SpriteFlag.Flipped;
  if (kind === "unit" && opts.disabled) flags |= SpriteFlag.Disabled;
  return { spriteId: id, x, y, owner, unused: 0, flags };
}

/** Keep a sprite's position on the map. */
export function clampSprite(px: number, py: number, mapW: number, mapH: number): { x: number; y: number } {
  return {
    x: Math.min(mapW * TILE_PX - 1, Math.max(0, Math.round(px))),
    y: Math.min(mapH * TILE_PX - 1, Math.max(0, Math.round(py))),
  };
}

/* ── Geometry and picking ────────────────────────────────── */

/**
 * The rectangle a sprite's graphic covers, relative to its position. A GRP's frames share
 * one box centred on the position; a frame's opaque pixels occupy a smaller rectangle
 * inside it, so `offsetX`/`offsetY` (default: centred) place that tight rectangle.
 */
export interface SpriteSize {
  width: number;
  height: number;
  offsetX?: number;
  offsetY?: number;
}

export interface SpriteBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** When the graphic is not loaded, a sprite is one tile around its position. */
export const FALLBACK_SIZE: SpriteSize = { width: TILE_PX, height: TILE_PX };

/**
 * The box a sprite occupies: its graphic's rectangle around the position, which is also
 * where the viewport draws it. `sizeOf` supplies the dimensions (the hook reads the loaded
 * GRP's frame; tests pass a constant).
 */
export function spriteBox(r: SpriteRecord, size: SpriteSize): SpriteBox {
  const left = r.x + (size.offsetX ?? -size.width / 2), top = r.y + (size.offsetY ?? -size.height / 2);
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/**
 * The tight rectangle of one frame inside a GRP box `boxW`×`boxH` whose centre sits on the
 * sprite's position; `flip` mirrors it the way the game mirrors facings 17–31.
 */
export function frameSize(boxW: number, boxH: number, frame: { x: number; y: number; width: number; height: number }, flip: boolean): SpriteSize {
  const x = flip ? boxW - frame.x - frame.width : frame.x;
  return { width: frame.width, height: frame.height, offsetX: x - boxW / 2, offsetY: frame.y - boxH / 2 };
}

export type SizeOf = (r: SpriteRecord) => SpriteSize;

/** Painter's order: by y, then by index (matches `MapViewport`'s ordering of THG2 records). */
export function spriteDrawOrder(scn: Scenario): number[] {
  const order = scn.sprites.map((_, i) => i);
  order.sort((a, b) => scn.sprites[a].y - scn.sprites[b].y || a - b);
  return order;
}

/** Index of the topmost sprite whose box contains map pixel (px, py), or -1. */
export function spriteAt(scn: Scenario, px: number, py: number, sizeOf: SizeOf): number {
  const order = spriteDrawOrder(scn);
  for (let k = order.length - 1; k >= 0; k--) {
    const r = scn.sprites[order[k]];
    const b = spriteBox(r, sizeOf(r));
    if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return order[k];
  }
  return -1;
}

/** Indices of sprites whose boxes intersect the pixel rectangle (given in any corner order). */
export function spritesInBox(scn: Scenario, box: SpriteBox, sizeOf: SizeOf): number[] {
  const left = Math.min(box.left, box.right), right = Math.max(box.left, box.right);
  const top = Math.min(box.top, box.bottom), bottom = Math.max(box.top, box.bottom);
  const out: number[] = [];
  scn.sprites.forEach((r, i) => {
    const b = spriteBox(r, sizeOf(r));
    if (b.right >= left && b.left <= right && b.bottom >= top && b.top <= bottom) out.push(i);
  });
  return out;
}

/* ── Building change lists ───────────────────────────────── */

/** Append records to the end of the list. */
export function addSprites(scn: Scenario, records: SpriteRecord[]): SpriteChange[] {
  return records.map((r, i) => ({ index: scn.sprites.length + i, before: null, after: r }));
}

/** Remove the sprites at `indices`, highest first so the earlier indices stay valid. */
export function removeSprites(scn: Scenario, indices: number[]): SpriteChange[] {
  return [...new Set(indices)]
    .filter((i) => i >= 0 && i < scn.sprites.length)
    .sort((a, b) => b - a)
    .map((i) => ({ index: i, before: scn.sprites[i], after: null }));
}

/** Replace fields on the sprites at `indices`; unchanged records produce no entry. */
export function updateSprites(scn: Scenario, indices: number[], patch: (r: SpriteRecord) => Partial<SpriteRecord>): SpriteChange[] {
  const out: SpriteChange[] = [];
  for (const i of new Set(indices)) {
    const before = scn.sprites[i];
    if (!before) continue;
    const after = { ...before, ...patch(before) };
    if ((Object.keys(after) as (keyof SpriteRecord)[]).some((k) => after[k] !== before[k])) out.push({ index: i, before, after });
  }
  return out;
}

/** Shift sprites by a pixel delta, clamped to the map. */
export function moveSprites(scn: Scenario, indices: number[], dx: number, dy: number): SpriteChange[] {
  return updateSprites(scn, indices, (r) => clampSprite(r.x + dx, r.y + dy, scn.width, scn.height));
}

/** Set or clear one `SpriteFlag` bit on the sprites at `indices`. */
export function setSpriteFlag(scn: Scenario, indices: number[], bit: number, on: boolean): SpriteChange[] {
  return updateSprites(scn, indices, (r) => ({ flags: on ? r.flags | bit : r.flags & ~bit }));
}
