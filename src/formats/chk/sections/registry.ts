/**
 * CHK section layouts and validation sizes. Community format reference:
 * https://wiki.staredit.net/wiki/Scenario.chk
 * Full provenance: ../../../../ATTRIBUTION.md
 */
import type { CombineMode, EntryLayout } from "../reader";
import { msg } from "../../../i18n";

export interface Dim {
  width: number;
  height: number;
}

export interface SectionSpec {
  name: string;
  /** How repeated occurrences combine. Only meaningful for sections we decode. */
  mode: CombineMode;
  /** Fixed buffer width the game reads into, where there is one. */
  size?: number | ((dim: Dim) => number);
  /** Record stride for list sections. */
  stride?: number;
  /**
   * The shortest copy the game takes, for a "last" or "first" section. A shorter one is
   * passed over: it does not count and does not replace an earlier copy. Protected maps put
   * such a decoy after the real section.
   */
  minimum?: number;
  /** The layout of a settings table, for the "entries" mode. */
  entries?: EntryLayout;
  what: string;
  /**
   * Read by StarEdit and other editors only — the game skips it. Leaving one out of a
   * saved file changes nothing in play, only what an editor can do with the file later.
   */
  editorOnly?: true;
}

/** Per-entry column widths of the settings tables: hit points, shields, armour, time, minerals, gas, name. */
const UNIT_ENTRIES: EntryLayout = { count: 228, columns: [4, 2, 1, 2, 2, 2, 2] };
const UPGRADE_WIDTHS = [2, 2, 2, 2, 2, 2];
const TECH_WIDTHS = [2, 2, 2, 2];

const SPECS: SectionSpec[] = [
  { name: "TYPE", mode: "last", size: 4, what: msg("Map type (RAWS/RAWB/RAWU)") },
  { name: "VER ", mode: "last", size: 2, what: msg("File format version") },
  { name: "IVER", mode: "last", size: 2, what: msg("StarEdit version (obsolete)"), editorOnly: true },
  { name: "IVE2", mode: "last", size: 2, what: msg("StarEdit version"), editorOnly: true },
  { name: "VCOD", mode: "last", size: 1040, what: msg("Verification hash table") },
  { name: "IOWN", mode: "last", size: 12, what: msg("StarEdit player types"), editorOnly: true },
  { name: "OWNR", mode: "last", size: 12, what: msg("Player types") },
  { name: "ERA ", mode: "last", size: 2, what: msg("Tileset") },
  { name: "DIM ", mode: "last", size: 4, what: msg("Map dimensions") },
  { name: "SIDE", mode: "last", size: 12, what: msg("Player races") },
  { name: "MTXM", mode: "overlay", size: (d) => d.width * d.height * 2, what: msg("Terrain (final tiles)") },
  { name: "PUNI", mode: "last", size: 5700, what: msg("Unit availability") },
  { name: "UPGR", mode: "last", size: 1748, what: msg("Upgrade levels (original)") },
  { name: "PTEC", mode: "last", size: 912, what: msg("Tech availability (original)") },
  { name: "UNIT", mode: "append", stride: 36, what: msg("Placed units") },
  { name: "ISOM", mode: "overlay", size: (d) => (Math.floor(d.width / 2) + 1) * (d.height + 1) * 8, what: msg("Isometric terrain"), editorOnly: true },
  { name: "TILE", mode: "overlay", size: (d) => d.width * d.height * 2, what: msg("Terrain (StarEdit tiles)"), editorOnly: true },
  { name: "DD2 ", mode: "append", stride: 8, what: msg("Isometric doodads"), editorOnly: true },
  { name: "THG2", mode: "append", stride: 10, what: msg("Sprites") },
  { name: "MASK", mode: "overlay", size: (d) => d.width * d.height, what: msg("Fog of war") },
  // Measured in Remastered: a 1-byte copy after the real table is passed over, a 2-byte one
  // (no strings) is taken and leaves every string missing. 1.16.1 takes any copy; the
  // editor follows Remastered here, the game most maps are played in.
  { name: "STR ", mode: "last", minimum: 2, what: msg("String table") },
  { name: "UPRP", mode: "last", size: 1280, what: msg("CUWP slots") },
  { name: "UPUS", mode: "last", size: 64, what: msg("CUWP slots used"), editorOnly: true },
  // Every copy must be the revision's full size (64 or 255 locations), so the last one wins.
  { name: "MRGN", mode: "last", stride: 20, what: msg("Locations") },
  { name: "TRIG", mode: "append", stride: 2400, what: msg("Triggers") },
  { name: "MBRF", mode: "append", stride: 2400, what: msg("Mission briefing") },
  { name: "SPRP", mode: "last", size: 4, what: msg("Scenario name and description") },
  { name: "FORC", mode: "last", size: 20, what: msg("Forces") },
  { name: "WAV ", mode: "last", size: 2048, what: msg("WAV string indices"), editorOnly: true },
  { name: "UNIS", mode: "entries", size: 4048, entries: UNIT_ENTRIES, what: msg("Unit settings (original)") },
  { name: "UPGS", mode: "entries", size: 598, entries: { count: 46, columns: UPGRADE_WIDTHS }, what: msg("Upgrade settings (original)") },
  { name: "TECS", mode: "entries", size: 216, entries: { count: 24, columns: TECH_WIDTHS }, what: msg("Tech settings (original)") },
  { name: "SWNM", mode: "last", size: 1024, what: msg("Switch names"), editorOnly: true },
  { name: "COLR", mode: "last", size: 8, what: msg("Player colours") },
  { name: "PUPx", mode: "last", size: 2318, what: msg("Upgrade restrictions (BW)") },
  { name: "PTEx", mode: "last", size: 1672, what: msg("Tech restrictions (BW)") },
  { name: "UNIx", mode: "entries", size: 4168, entries: UNIT_ENTRIES, what: msg("Unit settings (BW)") },
  { name: "UPGx", mode: "entries", size: 794, entries: { count: 61, pad: 1, columns: UPGRADE_WIDTHS }, what: msg("Upgrade settings (BW)") },
  { name: "TECx", mode: "entries", size: 396, entries: { count: 44, columns: TECH_WIDTHS }, what: msg("Tech settings (BW)") },
  { name: "STRx", mode: "last", what: msg("String table (Remastered, 32-bit offsets)") },
  { name: "CRGB", mode: "last", size: 32, what: msg("Player colours (Remastered RGB)") },
];

export const SECTION_SPECS: ReadonlyMap<string, SectionSpec> = new Map(SPECS.map((s) => [s.name, s]));

export function specFor(name: string): SectionSpec | undefined {
  return SECTION_SPECS.get(name);
}

export function sizeOf(spec: SectionSpec, dim: Dim): number | undefined {
  return typeof spec.size === "function" ? spec.size(dim) : spec.size;
}
