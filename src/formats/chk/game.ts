/**
 * What the game itself accepts of a `scenario.chk`: which sections each of its reads takes in
 * each revision, the length it insists on, and the VCOD check. The same facts as the CHK
 * reference's generator (`scripts/lib/chk-game.mjs`, which `tests/chk-game.test.ts` holds this
 * to), in the form Check Map uses. The editor's own reader (`sections/registry.ts`) is more
 * lenient on purpose; this is what decides whether a map loads.
 */
import { defaultVcod, VCOD_SIZE } from "./sections/vcod";

/** One of the game's reads of a map, and what the player sees when it fails. */
export type GameRead = "list" | "melee" | "ums" | "briefing";

const LIST = ["VER ", "DIM ", "ERA ", "OWNR", "SIDE", "STR ", "SPRP", "FORC", "VCOD"];
const MELEE = ["STR ", "MTXM", "THG2", "UNIT"];
const UMS_ORIGINAL = [
  "STR ", "MTXM", "THG2", "MASK", "UNIS", "UPGS", "TECS", "PUNI", "UPGR", "PTEC",
  "UNIx", "UPGx", "TECx", "PUPx", "PTEx", "UNIT", "UPRP", "MRGN", "TRIG",
];
const UMS_EXPANSION = ["STR ", "MTXM", "THG2", "MASK", "UNIx", "UPGx", "TECx", "PUNI", "PUPx", "PTEx", "UNIT", "UPRP", "MRGN", "TRIG", "COLR"];

/** The revisions the game knows: 1.16.1's three, and the two only Remastered reads. */
export const KNOWN_VERSIONS: readonly number[] = [59, 63, 64, 205, 206];

/**
 * The sections a read takes in a file of this revision. Remastered's 64 reads as 63 and its
 * 206 as 205; Remastered's map list also reads CRGB, and TRIG (`remastered`).
 */
export function gameReadSections(read: GameRead, fileVersion: number, remastered = false): string[] {
  const expansion = fileVersion >= 205;
  switch (read) {
    case "list": return remastered ? [...LIST, "CRGB", "TRIG"] : LIST;
    case "melee": return expansion ? [...MELEE, "COLR"] : MELEE;
    case "ums": return expansion ? UMS_EXPANSION : UMS_ORIGINAL;
    case "briefing": return ["STR ", "MBRF"];
  }
}

/** A length the game accepts: exactly so many bytes, whole records, at most so many, or anything. */
export type SizeRule = { exactly: number } | { multiple: number } | { atMost: number } | { any: true };

const EXACT: Record<string, number> = {
  "VER ": 2, "VCOD": VCOD_SIZE, "OWNR": 12, "ERA ": 2, "DIM ": 4, "SIDE": 12, "PUNI": 5700, "UPGR": 1748, "PTEC": 912,
  "UPRP": 1280, "SPRP": 4, "UNIS": 4048, "UPGS": 598, "TECS": 216, "COLR": 8, "PUPx": 2318, "PTEx": 1672,
  "UNIx": 4168, "UPGx": 794, "TECx": 396, "CRGB": 32,
};
const MULTIPLE: Record<string, number> = { "UNIT": 36, "THG2": 10, "TRIG": 2400, "MBRF": 2400 };
const AT_MOST: Record<string, number> = { "MTXM": 131072, "FORC": 20 };

/** The length the game insists on for a section it reads. MRGN's depends on the revision. */
export function gameSizeRule(name: string, fileVersion: number): SizeRule {
  if (name === "MRGN") return { exactly: fileVersion === 59 ? 1280 : 5100 };
  if (name in EXACT) return { exactly: EXACT[name] };
  if (name in MULTIPLE) return { multiple: MULTIPLE[name] };
  if (name in AT_MOST) return { atMost: AT_MOST[name] };
  return { any: true };
}

/** Whether the game takes a copy of this length. */
export function gameAcceptsSize(rule: SizeRule, length: number): boolean {
  if ("exactly" in rule) return length === rule.exactly;
  if ("multiple" in rule) return length % rule.multiple === 0;
  if ("atMost" in rule) return length <= rule.atMost;
  return true;
}

/* ── VCOD ─────────────────────────────────────────────── */

const rol = (x: number, n: number) => { n &= 31; return n ? ((x << n) | (x >>> (32 - n))) >>> 0 : x; };
const ror = (x: number, n: number) => { n &= 31; return n ? ((x >>> n) | (x << (32 - n))) >>> 0 : x; };

/** The game's VCOD hash of `data` with a table of 256 seeds and its operation bytes. */
export function vcodHash(table: Uint8Array, data: Uint8Array): number {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const seed = (i: number) => view.getUint32(i * 4, true);
  const ops = table.subarray(1024);
  const words = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let h = 0;
  for (let at = 0; at + 4 <= data.length; at += 4) {
    const w = words.getUint32(at, true);
    const b0 = w & 255, b1 = (w >>> 8) & 255, b2 = (w >>> 16) & 255, b3 = w >>> 24;
    for (const op of ops) {
      if (op === 0) h = (h ^ w) >>> 0;
      else if (op === 1) h = (h + w) >>> 0;
      else if (op === 2) h = (h - w) >>> 0;
      else if (op <= 5) h = (h ^ seed(b0) ^ seed(b1) ^ seed(b2) ^ seed(b3)) >>> 0;
      else if (op === 6) h = rol(rol(rol(rol(h, b0), b1), b2), b3);
      else if (op === 7) h = ror(ror(ror(ror(h, b0), b1), b2), b3);
    }
  }
  return h;
}

/** What the game hashes: twelve 36-byte player records, each zero but its type (+8) and race (+9). */
function vcodData(playerTypes: readonly number[], playerRaces: readonly number[]): Uint8Array {
  const data = new Uint8Array(12 * 36);
  for (let i = 0; i < 12; i++) {
    data[i * 36 + 8] = playerTypes[i] ?? 0;
    data[i * 36 + 9] = playerRaces[i] ?? 0;
  }
  return data;
}

/**
 * Whether a VCOD copy passes the game's check for these players: the map's table and the
 * game's own must hash OWNR and SIDE to the same number. StarEdit's table, which is the
 * game's, passes for every combination.
 */
export function vcodPasses(vcod: Uint8Array, playerTypes: readonly number[], playerRaces: readonly number[]): boolean {
  if (vcod.length !== VCOD_SIZE) return false;
  const data = vcodData(playerTypes, playerRaces);
  return vcodHash(vcod, data) === vcodHash(defaultVcod(), data);
}
