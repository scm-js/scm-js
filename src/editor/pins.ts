/**
 * Pinned tiles: ground the brushes that lay terrain by rule leave as it is.
 *
 * The isometric brush re-derives every tile around the diamonds it changes, the Rect brush
 * and the fills lay whole areas, Replace Terrain and Heal trade tiles wherever they match.
 * None of them knows that a ramp was stretched across this cliff by hand, or that these
 * forty tiles were set one at a time, and a stroke nearby undoes the work. A pinned tile is
 * one they skip. What is pointed at a tile directly still writes it: the Tile brush, Blend,
 * a paste, a doodad.
 *
 * The pins are saved with the map, as a file of the map's archive (`PINS_MEMBER`) beside
 * the scenario: a bit per tile. The game does not read it and neither does any other
 * editor, and a map opened without it has no pins. Keeping them among the archive's files
 * is also what shares them on a shared map and parks them with a map in the background.
 *
 * Pure and canvas-free; `tests/pins.test.ts`.
 */
import type { Scenario } from "../formats/chk/scenario";
import type { Tileset } from "../formats/tileset/decode";
import { hasIsom, latticeMisses } from "./isom";
import type { TileChange } from "./terrain";

/** The member's name in the map's archive. */
export const PINS_MEMBER = "scmjs\\pins.bin";

/** "PIN1", then the map's width and height (u16 LE each), then a bit per tile, row-major, low bit first. */
const MAGIC = [0x50, 0x49, 0x4e, 0x31];
const HEADER = 8;

type Size = Pick<Scenario, "width" | "height">;

/** The member for a set of pins (a byte per tile, non-zero pinned), or null when nothing is pinned. */
export function encodePins(size: Size, pinned: Uint8Array | null): Uint8Array | null {
  if (!pinned) return null;
  const cells = size.width * size.height;
  const out = new Uint8Array(HEADER + Math.ceil(cells / 8));
  out.set(MAGIC);
  out[4] = size.width & 0xff; out[5] = size.width >> 8;
  out[6] = size.height & 0xff; out[7] = size.height >> 8;
  let any = false;
  for (let at = 0; at < cells; at++) {
    if (!pinned[at]) continue;
    out[HEADER + (at >> 3)] |= 1 << (at & 7);
    any = true;
  }
  return any ? out : null;
}

/** The pins a member holds for a map of this size: a byte per tile. Null when it holds none, is not ours or is for another size. */
export function decodePins(member: Uint8Array | undefined | null, size: Size): Uint8Array | null {
  if (!member || member.length < HEADER || MAGIC.some((b, i) => member[i] !== b)) return null;
  if ((member[4] | (member[5] << 8)) !== size.width || (member[6] | (member[7] << 8)) !== size.height) return null;
  const cells = size.width * size.height;
  if (member.length < HEADER + Math.ceil(cells / 8)) return null;
  const out = new Uint8Array(cells);
  let any = false;
  for (let at = 0; at < cells; at++) {
    if (member[HEADER + (at >> 3)] & (1 << (at & 7))) { out[at] = 1; any = true; }
  }
  return any ? out : null;
}

const decoded = new WeakMap<Uint8Array, { width: number; height: number; pinned: Uint8Array | null }>();

/** The pins of a map among its archive's files, decoded once per member. Read-only: change them with `pinCells`. */
export function pinsOf(extras: ReadonlyMap<string, Uint8Array>, size: Size): Uint8Array | null {
  const member = extras.get(PINS_MEMBER);
  if (!member) return null;
  const known = decoded.get(member);
  if (known && known.width === size.width && known.height === size.height) return known.pinned;
  const pinned = decodePins(member, size);
  decoded.set(member, { width: size.width, height: size.height, pinned });
  return pinned;
}

/** The archive's files with the pins member set, or removed for null. A new map; `extras` is not touched. */
export function withPinsMember(extras: ReadonlyMap<string, Uint8Array>, member: Uint8Array | null): Map<string, Uint8Array> {
  const next = new Map(extras);
  if (member) next.set(PINS_MEMBER, member);
  else next.delete(PINS_MEMBER);
  return next;
}

/** `pinned` with `cells` pinned or unpinned: a copy, or null when nothing would change. */
export function pinCells(size: Size, pinned: Uint8Array | null, cells: Iterable<number>, on: boolean): Uint8Array | null {
  const total = size.width * size.height;
  let out: Uint8Array | null = null;
  for (const at of cells) {
    if (at < 0 || at >= total || !!(out ?? pinned)?.[at] === on) continue;
    out ??= pinned ? new Uint8Array(pinned) : new Uint8Array(total);
    out[at] = on ? 1 : 0;
  }
  return out;
}

export function countPins(pinned: Uint8Array | null): number {
  let n = 0;
  if (pinned) for (let at = 0; at < pinned.length; at++) if (pinned[at]) n++;
  return n;
}

/** A change list without the changes to pinned tiles, and how many those were. */
export function withoutPinned(changes: readonly TileChange[], pinned: Uint8Array | null): { changes: TileChange[]; kept: number } {
  if (!pinned) return { changes: changes as TileChange[], kept: 0 };
  const out = changes.filter((c) => !pinned[c.at]);
  return { changes: out, kept: changes.length - out.length };
}

/** The pins of a map after a resize that moved its old top-left tile to (dx, dy). Null when none are left. */
export function resizePins(pinned: Uint8Array | null, from: Size, to: Size, dx: number, dy: number): Uint8Array | null {
  if (!pinned) return null;
  const out = new Uint8Array(to.width * to.height);
  let any = false;
  for (let y = 0; y < from.height; y++) {
    const ny = y + dy;
    if (ny < 0 || ny >= to.height) continue;
    for (let x = 0; x < from.width; x++) {
      const nx = x + dx;
      if (nx < 0 || nx >= to.width || !pinned[y * from.width + x]) continue;
      out[ny * to.width + nx] = 1;
      any = true;
    }
  }
  return any ? out : null;
}

/**
 * The tiles that were laid by hand, as far as the map can tell: those the isometric
 * lattice under them does not produce. A doodad placed as terrain, a stretched ramp, a
 * blend set tile by tile, another editor's ground. What the isometric brush would write
 * over the moment it came near, which is why the Pin tab offers to pin them all at once.
 * Empty for a map with no lattice.
 */
export function handLaidCells(scn: Scenario, tileset: Tileset, rect?: { x0: number; y0: number; x1: number; y1: number }): number[] {
  if (!hasIsom(scn)) return [];
  const misses = latticeMisses(scn, tileset);
  const out: number[] = [];
  const x0 = Math.max(0, rect?.x0 ?? 0), y0 = Math.max(0, rect?.y0 ?? 0);
  const x1 = Math.min(scn.width, rect?.x1 ?? scn.width), y1 = Math.min(scn.height, rect?.y1 ?? scn.height);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (misses[y * scn.width + x]) out.push(y * scn.width + x);
  return out;
}
