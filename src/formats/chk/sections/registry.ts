/**
 * CHK section layouts and validation sizes. Community format reference:
 * https://wiki.staredit.net/wiki/Scenario.chk
 * Full provenance: ../../../../ATTRIBUTION.md
 */
import type { CombineMode } from "../reader";

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
  what: string;
}

const SPECS: SectionSpec[] = [
  { name: "TYPE", mode: "last", size: 4, what: "Map type (RAWS/RAWB/RAWU)" },
  { name: "VER ", mode: "last", size: 2, what: "File format version" },
  { name: "IVER", mode: "last", size: 2, what: "StarEdit version (obsolete)" },
  { name: "IVE2", mode: "last", size: 2, what: "StarEdit version" },
  { name: "VCOD", mode: "last", size: 1040, what: "Verification hash table" },
  { name: "IOWN", mode: "last", size: 12, what: "StarEdit player types" },
  { name: "OWNR", mode: "last", size: 12, what: "Player types" },
  { name: "ERA ", mode: "last", size: 2, what: "Tileset" },
  { name: "DIM ", mode: "last", size: 4, what: "Map dimensions" },
  { name: "SIDE", mode: "last", size: 12, what: "Player races" },
  { name: "MTXM", mode: "overlay", size: (d) => d.width * d.height * 2, what: "Terrain (final tiles)" },
  { name: "PUNI", mode: "last", size: 5700, what: "Unit availability" },
  { name: "UPGR", mode: "last", size: 1748, what: "Upgrade levels (original)" },
  { name: "PTEC", mode: "last", size: 912, what: "Tech availability (original)" },
  { name: "UNIT", mode: "append", stride: 36, what: "Placed units" },
  { name: "ISOM", mode: "overlay", size: (d) => (Math.floor(d.width / 2) + 1) * (d.height + 1) * 8, what: "Isometric terrain" },
  { name: "TILE", mode: "overlay", size: (d) => d.width * d.height * 2, what: "Terrain (StarEdit tiles)" },
  { name: "DD2 ", mode: "append", stride: 8, what: "Isometric doodads" },
  { name: "THG2", mode: "append", stride: 10, what: "Sprites" },
  { name: "MASK", mode: "overlay", size: (d) => d.width * d.height, what: "Fog of war" },
  { name: "STR ", mode: "last", what: "String table" },
  { name: "UPRP", mode: "last", size: 1280, what: "CUWP slots" },
  { name: "UPUS", mode: "last", size: 64, what: "CUWP slots used" },
  { name: "MRGN", mode: "overlay", stride: 20, what: "Locations" },
  { name: "TRIG", mode: "append", stride: 2400, what: "Triggers" },
  { name: "MBRF", mode: "append", stride: 2400, what: "Mission briefing" },
  { name: "SPRP", mode: "last", size: 4, what: "Scenario name and description" },
  { name: "FORC", mode: "last", size: 20, what: "Forces" },
  { name: "WAV ", mode: "last", size: 2048, what: "WAV string indices" },
  { name: "UNIS", mode: "last", size: 4048, what: "Unit settings (original)" },
  { name: "UPGS", mode: "last", size: 598, what: "Upgrade settings (original)" },
  { name: "TECS", mode: "last", size: 216, what: "Tech settings (original)" },
  { name: "SWNM", mode: "last", size: 1024, what: "Switch names" },
  { name: "COLR", mode: "last", size: 8, what: "Player colours" },
  { name: "PUPx", mode: "last", size: 2318, what: "Upgrade restrictions (BW)" },
  { name: "PTEx", mode: "last", size: 1672, what: "Tech restrictions (BW)" },
  { name: "UNIx", mode: "last", size: 4168, what: "Unit settings (BW)" },
  { name: "UPGx", mode: "last", size: 794, what: "Upgrade settings (BW)" },
  { name: "TECx", mode: "last", size: 396, what: "Tech settings (BW)" },
  { name: "STRx", mode: "last", what: "String table (Remastered, 32-bit offsets)" },
  { name: "CRGB", mode: "last", size: 32, what: "Player colours (Remastered RGB)" },
];

export const SECTION_SPECS: ReadonlyMap<string, SectionSpec> = new Map(SPECS.map((s) => [s.name, s]));

export function specFor(name: string): SectionSpec | undefined {
  return SECTION_SPECS.get(name);
}

export function sizeOf(spec: SectionSpec, dim: Dim): number | undefined {
  return typeof spec.size === "function" ? spec.size(dim) : spec.size;
}
