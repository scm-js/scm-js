/**
 * A scenario built from nothing, for File ▸ New and for the map the editor opens on.
 *
 * The CHK it carries holds only the three sections the editor never models — StarEdit's
 * version stamp (IVE2), the game's verification table (VCOD) and the empty CUWP slots
 * (UPRP / UPUS) — as raw bytes; every modelled section is marked dirty, so
 * `serializeScenario` writes them all out in StarEdit's section order. The settings
 * tables start on their defaults but are *present*, since the game refuses a map
 * without them: what comes out is the same set of sections a fresh StarEdit map has.
 */
import { ANYWHERE_INDEX, type LocationRecord } from "./sections/objects";
import { FORCE_SLOTS, PLAYER_SLOTS, PlayerRace, PlayerType } from "./sections/players";
import {
  defaultTechRestrictions, defaultTechSettings, defaultUnitAvailability, defaultUnitSettings, defaultUpgradeRestrictions, defaultUpgradeSettings,
} from "./sections/settings";
import { defaultWavs } from "./sections/sounds";
import { defaultVcod } from "./sections/vcod";
import type { ChkSection } from "./reader";
import type { Scenario } from "./scenario";
import { isomSize } from "./sections/terrain";

/** Brood War: TYPE "RAWB", VER 205. */
const BROOD_WAR_VERSION = 205;
/** IVE2 value StarEdit writes for a Brood War map. */
const STAREDIT_VERSION = 11;

/** BW maps carry 255 location slots; index 63 is the fixed "Anywhere". */
const LOCATION_SLOTS = 255;

/** CUWP: 64 slots of 20 bytes, and the 64 "slot used" bytes. */
const UPRP_SIZE = 1280;
const UPUS_SIZE = 64;

/**
 * Sections `createScenario` fills in, and therefore has to have written on save: the
 * section set of a Brood War map StarEdit creates — the `x` layouts of the settings
 * pairs only, as in Blizzard's own maps (a hybrid map is the one that carries both).
 */
const CREATED_SECTIONS = [
  "TYPE", "VER ", "ERA ", "DIM ", "SIDE", "OWNR", "COLR", "MTXM", "TILE", "ISOM", "MASK",
  "UNIT", "THG2", "DD2 ", "MRGN", "STR ", "SPRP", "FORC", "TRIG", "MBRF", "WAV ",
  "PUNI", "UNIx", "UPGx", "PUPx", "TECx", "PTEx",
];

/** Where each string the table is created with lands, by construction. */
const STRING_INDEX = { name: 1, description: 2, force1: 3, anywhere: 7 } as const;

export interface CreateScenarioOptions {
  width: number;
  height: number;
  /** ERA value: 0 badlands, 1 platform, 2 install, 3 ashworld, 4 jungle, 5 desert, 6 ice, 7 twilight. */
  era: number;
  name: string;
  description?: string;
  /** Terrain to start from; a map of null tiles when omitted. See tileset/terrain.ts. */
  tiles?: Uint16Array;
  /** The matching ISOM lattice; all null terrain (zeros, as StarEdit starts) when omitted. */
  isom?: Uint16Array;
}

function emptyLocations(width: number, height: number, anywhereName: number): LocationRecord[] {
  const blank = () => ({ left: 0, top: 0, right: 0, bottom: 0, nameIndex: 0, elevationFlags: 0 });
  const locations = Array.from({ length: LOCATION_SLOTS }, blank);
  locations[ANYWHERE_INDEX] = {
    left: 0, top: 0, right: width * 32, bottom: height * 32,
    nameIndex: anywhereName, elevationFlags: 0,
  };
  return locations;
}

/** A section the editor carries as bytes only. */
function raw(name: string, data: Uint8Array): ChkSection {
  return { name, offset: -1, declaredSize: data.length, data };
}

/** The unmodelled sections a game-loadable map still needs, on StarEdit's defaults. */
export function rawCreatedSections(): ChkSection[] {
  const ive2 = new Uint8Array(2);
  new DataView(ive2.buffer).setUint16(0, STAREDIT_VERSION, true);
  return [
    raw("IVE2", ive2),
    raw("VCOD", defaultVcod()),
    raw("UPRP", new Uint8Array(UPRP_SIZE)),
    raw("UPUS", new Uint8Array(UPUS_SIZE)),
  ];
}

export function createScenario(options: CreateScenarioOptions): Scenario {
  const { width, height, era, name, description = "" } = options;

  // Index 0 means "no string", so the table starts at 1 and STRING_INDEX names the
  // slots this order produces.
  const strings = {
    strings: [null, name, description, "Force 1", "Force 2", "Force 3", "Force 4", "Anywhere"],
    extended: false,
  };

  return {
    chk: { sections: rawCreatedSections() },
    dirty: new Set(CREATED_SECTIONS),
    warnings: [],
    type: "RAWB",
    fileVersion: BROOD_WAR_VERSION,
    width,
    height,
    era,
    strings,
    nameIndex: STRING_INDEX.name,
    descriptionIndex: STRING_INDEX.description,
    // Eight open slots plus the four neutral ones, which is what a melee map looks like
    // before anyone touches Player Settings.
    playerTypes: Array.from({ length: PLAYER_SLOTS }, (_, i) => (i < FORCE_SLOTS ? PlayerType.Human : PlayerType.Neutral)),
    playerRaces: Array.from({ length: PLAYER_SLOTS }, (_, i) => (i < FORCE_SLOTS ? PlayerRace.UserSelectable : PlayerRace.Neutral)),
    playerColors: [0, 1, 2, 3, 4, 5, 6, 7],
    playerRgb: null,
    unitSettings: defaultUnitSettings(),
    unitAvailability: defaultUnitAvailability(),
    upgradeSettings: defaultUpgradeSettings(),
    upgradeRestrictions: defaultUpgradeRestrictions(),
    techSettings: defaultTechSettings(),
    techRestrictions: defaultTechRestrictions(),
    wavs: defaultWavs(),
    forces: {
      playerForce: Array.from({ length: FORCE_SLOTS }, () => 0),
      nameIndex: [0, 1, 2, 3].map((i) => STRING_INDEX.force1 + i),
      flags: [0, 0, 0, 0],
    },
    tiles: options.tiles ?? new Uint16Array(width * height),
    editorTiles: options.tiles ? new Uint16Array(options.tiles) : new Uint16Array(width * height),
    isom: options.isom ?? new Uint16Array(isomSize(width, height) / 2),
    // Every tile unexplored for every player, as StarEdit starts a map.
    mask: new Uint8Array(width * height).fill(0xff),
    units: [],
    sprites: [],
    doodads: [],
    locations: emptyLocations(width, height, STRING_INDEX.anywhere),
    triggers: [],
    briefing: [],
    switchNames: null,
  };
}

/**
 * The sections StarCraft needs to load a scenario, whatever its revision. The settings
 * pairs come on top: the original layouts for a StarCraft 1.00 file (VER < 205), the `x`
 * layouts for anything Brood War reads (VER ≥ 63) — a hybrid map needs both. Used by
 * Check Map to tell a map that will not load from one that merely lacks optional data.
 */
export const REQUIRED_SECTIONS: readonly string[] = [
  "VER ", "VCOD", "OWNR", "ERA ", "DIM ", "SIDE", "MTXM", "PUNI", "UNIT", "THG2", "STR ", "UPRP",
  "MRGN", "TRIG", "MBRF", "SPRP", "FORC",
];
export const REQUIRED_ORIGINAL_SECTIONS: readonly string[] = ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"];
export const REQUIRED_EXPANSION_SECTIONS: readonly string[] = ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"];

/** Everything a file of this revision must carry to load (`STR ` stands for STRx on a Remastered file). */
export function requiredSections(fileVersion: number): string[] {
  return [
    ...REQUIRED_SECTIONS,
    ...(fileVersion < 205 ? REQUIRED_ORIGINAL_SECTIONS : []),
    ...(fileVersion >= 63 ? REQUIRED_EXPANSION_SECTIONS : []),
  ];
}
