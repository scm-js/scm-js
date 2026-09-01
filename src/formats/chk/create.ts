/**
 * A scenario built from nothing, for File ▸ New and for the map the editor opens on.
 *
 * The CHK it carries starts empty and every modelled section is marked dirty, so
 * `serializeScenario` writes them all out in StarEdit's section order. Sections the
 * editor does not model yet — VCOD, PUNI, the unit/upgrade/tech settings — are not
 * generated, so a map created here round-trips through this editor but is not yet a
 * file StarCraft will load.
 */
import { ANYWHERE_INDEX, type LocationRecord } from "./sections/objects";
import { FORCE_SLOTS, PLAYER_SLOTS, PlayerRace, PlayerType } from "./sections/players";
import type { Scenario } from "./scenario";
import { isomSize } from "./sections/terrain";

/** Brood War: TYPE "RAWB", VER 205. */
const BROOD_WAR_VERSION = 205;

/** BW maps carry 255 location slots; index 63 is the fixed "Anywhere". */
const LOCATION_SLOTS = 255;

/** Sections `createScenario` fills in, and therefore has to have written on save. */
const CREATED_SECTIONS = [
  "TYPE", "VER ", "ERA ", "DIM ", "SIDE", "OWNR", "COLR", "MTXM", "TILE", "ISOM",
  "UNIT", "THG2", "DD2 ", "MRGN", "STR ", "SPRP", "FORC",
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

export function createScenario(options: CreateScenarioOptions): Scenario {
  const { width, height, era, name, description = "" } = options;

  // Index 0 means "no string", so the table starts at 1 and STRING_INDEX names the
  // slots this order produces.
  const strings = {
    strings: [null, name, description, "Force 1", "Force 2", "Force 3", "Force 4", "Anywhere"],
    extended: false,
  };

  return {
    chk: { sections: [] },
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
    forces: {
      playerForce: Array.from({ length: FORCE_SLOTS }, () => 0),
      nameIndex: [0, 1, 2, 3].map((i) => STRING_INDEX.force1 + i),
      flags: [0, 0, 0, 0],
    },
    tiles: options.tiles ?? new Uint16Array(width * height),
    editorTiles: options.tiles ? new Uint16Array(options.tiles) : new Uint16Array(width * height),
    isom: options.isom ?? new Uint16Array(isomSize(width, height) / 2),
    mask: null,
    units: [],
    sprites: [],
    doodads: [],
    locations: emptyLocations(width, height, STRING_INDEX.anywhere),
  };
}
