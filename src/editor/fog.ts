/**
 * Fog of war edits as invertible change lists over the MASK section.
 *
 * MASK is one byte per tile; bit n set means the tile starts the game *unexplored* for
 * player n+1 (black), clear means explored (the player sees the terrain, darkened, until
 * a unit gives vision). StarEdit writes 0xFF everywhere and a map without the section
 * behaves the same, so "no MASK" reads as fully fogged and the first edit creates a
 * 0xFF-filled section (`ensureMask`) for the caller to record in the undo history.
 *
 * The brushes here are the fog counterparts of `editor/terrain.ts`: they compute
 * `TileChange`s (flat index, before, after byte) without touching the scenario, and
 * `applyFogChanges` applies or reverts a list and marks MASK dirty.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import { brushRect, type TileChange } from "./terrain";

/** MASK carries fog for the eight playable slots only. */
export const FOG_PLAYERS = 8;
export const ALL_FOG_PLAYERS = 0xff;

export type FogMode = "fog" | "clear";

export function playerBit(player: number): number {
  return 1 << player;
}

/** The section's default: every tile unexplored for every player. */
export function defaultMask(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height).fill(ALL_FOG_PLAYERS);
}

/**
 * The scenario's mask, creating the default one when the file had no MASK. Returns
 * the new array when one was created (record it as `createdMask` in the history
 * entry so undo removes the section again), else null.
 */
export function ensureMask(scn: Scenario): Uint8Array | null {
  if (scn.mask) return null;
  scn.mask = defaultMask(scn.width, scn.height);
  markDirty(scn, "MASK");
  return scn.mask;
}

/** Whether tile `at` starts fogged for `player`; a missing section means yes. */
export function isFogged(scn: Scenario, at: number, player: number): boolean {
  return scn.mask ? (scn.mask[at] & playerBit(player)) !== 0 : true;
}

/** The byte a tile ends up with after painting `players` in `mode`. */
export function fogByte(before: number, players: number, mode: FogMode): number {
  return mode === "fog" ? before | players : before & ~players & 0xff;
}

function fogIndices(scn: Scenario, x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) out.push(y * scn.width + x);
  return out;
}

/** Set or clear the `players` bits over a set of tiles. Needs a mask (see `ensureMask`). */
export function paintFog(scn: Scenario, indices: Iterable<number>, players: number, mode: FogMode): TileChange[] {
  const mask = scn.mask;
  if (!mask || players === 0) return [];
  const out: TileChange[] = [];
  for (const at of indices) {
    const before = mask[at];
    const after = fogByte(before, players, mode);
    if (before !== after) out.push({ at, before, after });
  }
  return out;
}

/** One N×N brush application centred on (x, y), same footprint as the terrain brushes. */
export function paintFogAt(scn: Scenario, x: number, y: number, size: number, players: number, mode: FogMode): TileChange[] {
  const r = brushRect(x, y, size, scn.width, scn.height);
  return paintFog(scn, fogIndices(scn, r.x0, r.y0, r.x1, r.y1), players, mode);
}

/** Fog or clear the whole map for `players`. */
export function fillFog(scn: Scenario, players: number, mode: FogMode): TileChange[] {
  return paintFog(scn, fogIndices(scn, 0, 0, scn.width, scn.height), players, mode);
}

/** Swap fogged and explored everywhere for `players`. */
export function invertFog(scn: Scenario, players: number): TileChange[] {
  const mask = scn.mask;
  if (!mask || players === 0) return [];
  const out: TileChange[] = [];
  for (let at = 0; at < mask.length; at++) {
    const before = mask[at];
    const after = before ^ players;
    if (before !== after) out.push({ at, before, after });
  }
  return out;
}

/** Give every player in `to` (a bit mask) exactly player `from`'s fog. */
export function copyFog(scn: Scenario, from: number, to: number): TileChange[] {
  const mask = scn.mask;
  const targets = to & ~playerBit(from) & 0xff;
  if (!mask || targets === 0) return [];
  const bit = playerBit(from);
  const out: TileChange[] = [];
  for (let at = 0; at < mask.length; at++) {
    const before = mask[at];
    const after = before & bit ? before | targets : before & ~targets;
    if (before !== after) out.push({ at, before, after });
  }
  return out;
}

/**
 * The 4-connected area around (x, y) with the same fog state as that tile for
 * `player` — what a fill on the fog layer covers.
 */
export function floodFog(scn: Scenario, x: number, y: number, player: number): Set<number> {
  const { width, height } = scn;
  const out = new Set<number>();
  if (x < 0 || y < 0 || x >= width || y >= height) return out;
  const start = y * width + x;
  const seed = isFogged(scn, start, player);
  const total = width * height;
  const stack = [start];
  out.add(start);
  while (stack.length > 0) {
    const at = stack.pop()!;
    const ax = at % width;
    const neighbours = [ax > 0 ? at - 1 : -1, ax + 1 < width ? at + 1 : -1, at - width, at + width < total ? at + width : -1];
    for (const n of neighbours) {
      if (n < 0 || out.has(n) || isFogged(scn, n, player) !== seed) continue;
      out.add(n);
      stack.push(n);
    }
  }
  return out;
}

/** Apply a fog change list, or take it back. */
export function applyFogChanges(scn: Scenario, changes: readonly TileChange[], direction: "do" | "undo" = "do") {
  if (changes.length === 0 || !scn.mask) return;
  for (const c of changes) scn.mask[c.at] = direction === "do" ? c.after : c.before;
  markDirty(scn, "MASK");
}

/** How many tiles start fogged for `player`. */
export function fogCount(scn: Scenario, player: number): number {
  if (!scn.mask) return scn.width * scn.height;
  const bit = playerBit(player);
  let n = 0;
  for (let at = 0; at < scn.mask.length; at++) if (scn.mask[at] & bit) n++;
  return n;
}

/** The players that have fog on tile (x, y), as a bit mask — the fog layer's eyedropper. */
export function fogPlayersAt(scn: Scenario, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= scn.width || y >= scn.height) return 0;
  return scn.mask ? scn.mask[y * scn.width + x] & ALL_FOG_PLAYERS : ALL_FOG_PLAYERS;
}
