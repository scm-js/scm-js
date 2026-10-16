/**
 * What StarCraft 1.16.1 does with each section of a `scenario.chk`: which of its reads takes
 * the section, whether that read fails without it, the size it insists on, and what a second
 * copy does. Found by studying how the game loads a map, and confirmed by loading probe maps
 * in it (`scripts/chk-probes.mjs` builds the first set). The CHK reference's tables and
 * pictures are drawn from here, so a table and a picture cannot disagree.
 *
 * This is the game, not the editor: the editor's reader (`SECTION_SPECS`) is more lenient on
 * purpose, and follows Remastered where Remastered was measured to differ.
 */

/** The file revisions 1.16.1 knows. Any other `VER` is refused; 205 needs Brood War. */
export const GAME_VERSIONS = [59, 63, 205];

const need = (...names) => names.map((name) => ({ name, required: true }));
const read = (...names) => names.map((name) => ({ name, required: false }));

const LIST = need("VER ", "DIM ", "ERA ", "OWNR", "SIDE", "STR ", "SPRP", "FORC", "VCOD");
const MELEE = need("STR ", "MTXM", "THG2", "UNIT");
const UMS_ORIGINAL = [
  ...need("STR ", "MTXM", "THG2", "MASK", "UNIS", "UPGS", "TECS", "PUNI", "UPGR", "PTEC"),
  ...read("UNIx", "UPGx", "TECx", "PUPx", "PTEx"),
  ...need("UNIT", "UPRP", "MRGN", "TRIG"),
];

/**
 * The game's reads of a map, each a list of sections per revision in the order the game
 * handles them. Before every read it looks for `TYPE` (never read) and `VER` (required).
 * A read fails when a required section is missing or any copy of any section it handles is
 * refused, and the first failure stops it.
 */
export const GAME_READS = [
  {
    id: "list", title: "Map list",
    when: "when the map list shows the map, when a game is created, and again when it starts",
    failure: "Invalid Scenario",
    sections: { 59: LIST, 63: LIST, 205: LIST },
  },
  {
    id: "melee", title: "Melee start",
    when: "when a game of any type but Use Map Settings starts",
    failure: "Error loading scenario file.",
    sections: { 59: MELEE, 63: MELEE, 205: [...MELEE, ...need("COLR")] },
  },
  {
    id: "ums", title: "Use Map Settings start",
    when: "when a Use Map Settings game starts",
    failure: "Error loading scenario file.",
    sections: {
      59: UMS_ORIGINAL,
      63: UMS_ORIGINAL,
      205: need("STR ", "MTXM", "THG2", "MASK", "UNIx", "UPGx", "TECx", "PUNI", "PUPx", "PTEx", "UNIT", "UPRP", "MRGN", "TRIG", "COLR"),
    },
  },
  {
    id: "briefing", title: "Briefing",
    when: "when the briefing room of a Use Map Settings game opens",
    failure: null, // the game ignores the result: no briefing, and nothing else happens
    sections: { 59: need("STR ", "MBRF"), 63: need("STR ", "MBRF"), 205: need("STR ", "MBRF") },
  },
];

/** Sections the game looks for before every read, whatever the revision. */
export const GAME_PREAMBLE = [{ name: "TYPE", required: false }, { name: "VER ", required: true }];

/** Sections in no read: the game's code does not contain their names. */
export const GAME_NEVER = ["IVER", "IVE2", "IOWN", "ISOM", "TILE", "DD2 ", "UPUS", "WAV ", "SWNM"];
/** Sections only Remastered reads. 1.16.1 does not know them, and refuses `VER` 206. */
export const REMASTERED_ONLY = ["STRx", "CRGB"];

/**
 * The length the game accepts for each section it reads. `exactly`: any other length refuses
 * the map; `multiple`: whole records only; `atMost`: anything up to the size; `any`: no check.
 */
export const GAME_SIZES = {
  "TYPE": { any: true },
  "VER ": { exactly: 2 },
  "VCOD": { exactly: 1040 },
  "OWNR": { exactly: 12 },
  "ERA ": { exactly: 2 },
  "DIM ": { exactly: 4 },
  "SIDE": { exactly: 12 },
  "MTXM": { atMost: 131072 },
  "PUNI": { exactly: 5700 },
  "UPGR": { exactly: 1748 },
  "PTEC": { exactly: 912 },
  "UNIT": { multiple: 36 },
  "THG2": { multiple: 10 },
  "MASK": { any: true },
  "STR ": { any: true },
  "UPRP": { exactly: 1280 },
  "MRGN": { exactly: { 59: 1280, 63: 5100, 205: 5100 } },
  "TRIG": { multiple: 2400 },
  "MBRF": { multiple: 2400 },
  "SPRP": { exactly: 4 },
  "FORC": { atMost: 20 },
  "UNIS": { exactly: 4048 },
  "UPGS": { exactly: 598 },
  "TECS": { exactly: 216 },
  "COLR": { exactly: 8 },
  "PUPx": { exactly: 2318 },
  "PTEx": { exactly: 1672 },
  "UNIx": { exactly: 4168 },
  "UPGx": { exactly: 794 },
  "TECx": { exactly: 396 },
};

/**
 * What the game does with a second copy. Every copy goes to the section's handler in file
 * order; these are what the handlers make of that.
 */
export const GAME_COPIES = {
  "TYPE": "never",
  "VER ": "last",
  "VCOD": "every",
  "OWNR": "last",
  "ERA ": "last",
  "DIM ": "last",
  "SIDE": "last",
  "MTXM": "overlay",
  "PUNI": "last",
  "UPGR": "last",
  "PTEC": "last",
  "UNIT": "units",
  "THG2": "append",
  "MASK": "fog",
  "STR ": "anyLast",
  "UPRP": "last",
  "MRGN": "whole",
  "TRIG": "append",
  "MBRF": "append",
  "SPRP": "last",
  "FORC": "padded",
  "UNIS": "entries",
  "UPGS": "entries",
  "TECS": "entries",
  "COLR": "compose",
  "PUPx": "last",
  "PTEx": "last",
  "UNIx": "entries",
  "UPGx": "entries",
  "TECx": "entries",
};

export const COPY_RULES = {
  never: "The game never reads what it holds, so copies make no difference.",
  last: "The last copy replaces the others. Every copy must still be the right size, or the map is refused.",
  anyLast: "The last copy replaces the others, whatever its length: a copy of 1 byte replaces the real table, and the map loses its text. Remastered passes over a copy shorter than 2 bytes.",
  padded: "The last copy replaces the others. A copy shorter than 20 bytes is filled out with zeros.",
  whole: "The last copy replaces the others. Every copy must be the full size, so a short copy refuses the map rather than overwriting part of the first.",
  every: "Every copy is checked, and one copy that fails refuses the map. A good copy after a bad one does not help.",
  overlay: "Each copy is written over the start of the same space, in file order, so a later copy replaces only as many tiles as it carries.",
  fog: "Each copy is written over the start of the same space, in file order. The space starts with every tile unexplored, so tiles no copy reaches stay unexplored.",
  append: "The copies are joined into one list: the records of all of them, in file order.",
  units: "The copies are joined into one list, with two exceptions: start locations come from the last copy alone, and an add-on or nydus canal is linked only to a unit in the same copy.",
  entries: "Combined entry by entry: a copy changes only the entries it marks as not using the game's own values, and every other entry keeps what an earlier copy gave it.",
  compose: "Each copy rearranges the colours as the copy before left them, so two copies that swap the same two colours put them back.",
};

/**
 * Where StarCraft: Remastered was found to need a section 1.16.1 does not, by playing probe
 * maps in it (the twelve in `Maps/CHK/Remastered`, 2026-10-15). The other eleven behaved
 * as in 1.16.1. Shown on the section's Required row and in the index.
 */
export const REMASTERED_NEEDS = {
  "TRIG": "In StarCraft: Remastered every map needs it, whatever the game type: without it the map list shows the map as *Invalid Scenario*. (Found playing Remastered.)",
};

/** The messages a player sees, by where the game gives up. */
export const GAME_MESSAGES = {
  invalid: "Invalid Scenario",
  unreadable: "This scenario is unreadable because it is invalid or corrupted.",
  expansion: "This scenario is intended for use with a StarCraft Expansion Set.",
  notValid: "The selected scenario is not valid.",
  loading: "Error loading scenario file.",
  umsOnly: "This map can only be played with the 'Use Map Settings' game type.",
  unplaceable: "WARNING: Unit unplaceable! (name) (x,y)",
};

/** Where a section is read and whether it is needed there, per read and revision. */
export function gameUse(name) {
  const out = {};
  for (const r of GAME_READS) {
    out[r.id] = {};
    for (const v of GAME_VERSIONS) {
      const entry = r.sections[v].find((s) => s.name === name);
      out[r.id][v] = entry ? (entry.required ? "need" : "read") : null;
    }
  }
  return out;
}
