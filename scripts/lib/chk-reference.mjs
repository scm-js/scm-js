/**
 * The generated half of `docs/chk-format.md`, the CHK format reference.
 *
 * As with the trigger reference (`trigger-reference.mjs`), the document is prose written
 * by hand with blocks between `<!-- generated: KEY -->` and `<!-- /generated -->` that this
 * module writes. What a block says about a section — its size, what the game does with a
 * second copy, whether it is required, whether the game reads it at all, the value and
 * flag tables — comes from the editor's own code, passed in as `defs`. The byte layouts
 * are written down here, once, and `tests/chkReference.test.ts` holds them to the codecs:
 * every layout must add up to the size the editor reads, and the record layouts must put
 * each field where the encoder writes it.
 */

import { createHash } from "node:crypto";
import { fillBlocks } from "./generated-blocks.mjs";
import { ISOM_EXAMPLE, ISOM_SHAPES, isomExampleValues } from "./chk-diagrams.mjs";

const P = 12; // player slots
const U = 228; // unit types

/**
 * One row of a layout: a type, how many of it, and what it holds. `field` names the
 * codec's property for the offset test; `id` names the field in the Kaitai Struct
 * description (`chk-kaitai.mjs`) where there is no codec property to take it from.
 */
const row = (type, count, holds, field, id) => ({ type, count, holds, field, id });

const players = (holds, id) => row("u8", P, `${holds}, one byte per player slot, Player 1 first`, undefined, id);

/** Byte layouts, keyed by section name without its padding. `record` sections repeat the rows. */
export const LAYOUTS = {
  TYPE: { rows: [row("char", 4, "`RAWS` for a StarCraft file, `RAWB` for Brood War", undefined, "game")] },
  VER: { rows: [row("u16", 1, "The revision; see [Revisions](#revisions)", undefined, "revision")] },
  IVER: { rows: [row("u16", 1, "StarEdit's version number, an older form", undefined, "version")] },
  IVE2: { rows: [row("u16", 1, "StarEdit's version number; 11 in a map StarEdit saves for Brood War", undefined, "version")] },
  VCOD: { rows: [row("u32", 256, "Seeds", undefined, "seeds"), row("u8", 16, "Operations", undefined, "operations")] },
  IOWN: { rows: [players("StarEdit's copy of each player's [type](#ownr)", "types")] },
  OWNR: { rows: [players("Each player's type", "types")], values: "playerTypes" },
  ERA: { rows: [row("u16", 1, "The tileset. The game uses the low three bits", undefined, "tileset")], values: "tilesets" },
  DIM: { rows: [row("u16", 1, "Width in tiles", undefined, "width"), row("u16", 1, "Height in tiles", undefined, "height")] },
  SIDE: { rows: [players("Each player's race", "races")], values: "races" },
  MTXM: { grid: "u16", holds: "The tile shown at each position, row by row from the top left: the tile group × 16 + the tile's place in the group" },
  PUNI: {
    rows: [
      row("u8", P * U, "Per player, per unit type: 1 if the player can build it. Player 1's 228 bytes first", undefined, "available"),
      row("u8", U, "Per unit type: 1 if it can be built, for every player that uses the default", undefined, "default_available"),
      row("u8", P * U, "Per player, per unit type: 1 if the player uses the default", undefined, "uses_default"),
    ],
  },
  UPGR: { rows: upgradeRows(46) },
  PTEC: { rows: techRows(24) },
  UNIT: {
    record: "unit",
    rows: [
      row("u32", 1, "The unit's serial number, unique in the map; add-ons and nydus canals are linked by it", "serial"),
      row("u16", 1, "X position in pixels", "x"),
      row("u16", 1, "Y position in pixels", "y"),
      row("u16", 1, "Unit type", "unitId"),
      row("u16", 1, "How the unit is linked to another (relations, below)", "relationType"),
      row("u16", 1, "Which special states the record sets (below)", "validProperties"),
      row("u16", 1, "Which of the following fields the record sets (fields set, below)", "validStates"),
      row("u8", 1, "Owner, 0 for Player 1", "owner"),
      row("u8", 1, "Hit points, per cent of the maximum", "hitPointsPercent"),
      row("u8", 1, "Shields, per cent", "shieldPercent"),
      row("u8", 1, "Energy, per cent", "energyPercent"),
      row("u32", 1, "Resources, for a mineral field or geyser", "resourceAmount"),
      row("u16", 1, "Units in the hangar: interceptors or scarabs", "hangarUnits"),
      row("u16", 1, "The special states themselves", "stateFlags"),
      row("u32", 1, "Unused", "unused"),
      row("u32", 1, "Serial number of the linked unit", "relatedSerial"),
    ],
    flags: [["Relations", "UnitRelation", false, "relationType"], ["Special states", "UnitState", false, "stateFlags"], ["Fields set", "UnitUsed", false, "validStates"]],
  },
  ISOM: {
    isom: true,
    record: "rect",
    rows: [
      row("u16", 1, "The word on the rect's left side", undefined, "left"),
      row("u16", 1, "Its top side", undefined, "top"),
      row("u16", 1, "Its right side", undefined, "right"),
      row("u16", 1, "Its bottom side", undefined, "bottom"),
    ],
  },
  TILE: { grid: "u16", holds: "The tile at each position with the doodads left out, row by row from the top left" },
  "DD2": {
    record: "doodad",
    rows: [
      row("u16", 1, "Doodad number in the tileset's list of doodads", "doodadId"),
      row("u16", 1, "X of the middle of the doodad, in pixels", "x"),
      row("u16", 1, "Y of the middle of the doodad, in pixels", "y"),
      row("u8", 1, "Owner", "owner"),
      row("u8", 1, "1 if disabled, else 0", "disabled"),
    ],
  },
  THG2: {
    record: "sprite",
    rows: [
      row("u16", 1, "Sprite number, or the unit type for a unit sprite (see the flags)", "spriteId"),
      row("u16", 1, "X in pixels", "x"),
      row("u16", 1, "Y in pixels", "y"),
      row("u8", 1, "Owner", "owner"),
      row("u8", 1, "Unused", "unused"),
      row("u16", 1, "Flags (below)", "flags"),
    ],
    flags: [["Flags", "SpriteFlag", false, "flags"]],
  },
  MASK: { grid: "u8", holds: "For each tile, one bit per player (bit 0 is Player 1): set where that player starts with the tile unexplored" },
  STR: { strings: "u16" },
  STRx: { strings: "u32" },
  UPRP: {
    record: "slot",
    rows: [
      row("u16", 1, "Which special states the slot sets (below)", "validProperties"),
      row("u16", 1, "Which fields the slot sets (below)", "validFields"),
      row("u8", 1, "Owner; unused", "owner"),
      row("u8", 1, "Hit points, per cent", "hitPointsPercent"),
      row("u8", 1, "Shields, per cent", "shieldsPercent"),
      row("u8", 1, "Energy, per cent", "energyPercent"),
      row("u32", 1, "Resources", "resources"),
      row("u16", 1, "Units in the hangar", "hangar"),
      row("u16", 1, "The special states themselves", "stateFlags"),
      row("u32", 1, "Unused", "unused"),
    ],
    flags: [["Special states", "CuwpState", false, "stateFlags"], ["Fields set", "CuwpField", false, "validFields"]],
    count: 64,
  },
  UPUS: { rows: [row("u8", 64, "Per slot: 1 if StarEdit considers it in use", undefined, "in_use")] },
  MRGN: {
    record: "location",
    rows: [
      row("i32", 1, "Left edge, in pixels", "left"),
      row("i32", 1, "Top edge", "top"),
      row("i32", 1, "Right edge", "right"),
      row("i32", 1, "Bottom edge", "bottom"),
      row("u16", 1, "Name, a string number", "nameIndex"),
      row("u16", 1, "Elevations the location leaves out (below)", "elevationFlags"),
    ],
    flags: [["Elevations", "Elevation", false, "elevationFlags"]],
  },
  TRIG: { rows: [row("u8", 2400, "One trigger; see [the trigger record](triggers.md#the-trigger-record)")], record: "trigger", opaque: true },
  MBRF: { rows: [row("u8", 2400, "One briefing, in the same record as a trigger")], record: "briefing", opaque: true },
  SPRP: { rows: [row("u16", 1, "The scenario's name, a string number", undefined, "name"), row("u16", 1, "Its description, a string number", undefined, "description")] },
  FORC: {
    rows: [
      row("u8", 8, "The force of each of Players 1 to 8, 0 to 3", undefined, "player_forces"),
      row("u16", 4, "The name of each force, a string number", undefined, "force_names"),
      row("u8", 4, "Each force's flags (below)", undefined, "force_flags"),
    ],
    flags: [["Force flags", "ForceFlag"]],
  },
  WAV: { rows: [row("u32", 512, "The name of each sound, a string number; 0 for an empty slot", undefined, "sound_names")] },
  UNIS: { rows: unitSettingsRows(100) },
  UPGS: { rows: upgradeSettingsRows(46, false) },
  TECS: { rows: techSettingsRows(24) },
  SWNM: { rows: [row("u32", 256, "The name of each switch, a string number; 0 for none", undefined, "switch_names")] },
  COLR: { rows: [row("u8", 8, "The colour of each of Players 1 to 8", undefined, "colors")], values: "colors" },
  PUPx: { rows: upgradeRows(61) },
  PTEx: { rows: techRows(44) },
  UNIx: { rows: unitSettingsRows(130) },
  UPGx: { rows: upgradeSettingsRows(61, true) },
  TECx: { rows: techSettingsRows(44) },
  CRGB: {
    rows: [row("u8", 24, "Red, green and blue for each of Players 1 to 8, three bytes each", undefined, "rgb"), row("u8", 8, "How each player's colour is chosen (modes, below)", undefined, "modes")],
    flags: [["Colour modes", "ColorMode", true, "modes"]],
  },
};

function upgradeRows(n) {
  return [
    row("u8", P * n, `Per player, per upgrade: the highest level they may research. Player 1's ${n} bytes first`, undefined, "max_levels"),
    row("u8", P * n, "Per player, per upgrade: the level they start at", undefined, "start_levels"),
    row("u8", n, "Per upgrade: the default highest level", undefined, "default_max_levels"),
    row("u8", n, "Per upgrade: the default starting level", undefined, "default_start_levels"),
    row("u8", P * n, "Per player, per upgrade: 1 if the player uses the defaults", undefined, "uses_default"),
  ];
}

function techRows(n) {
  return [
    row("u8", P * n, `Per player, per ability: 1 if they may research it. Player 1's ${n} bytes first`, undefined, "available"),
    row("u8", P * n, "Per player, per ability: 1 if they start with it", undefined, "researched"),
    row("u8", n, "Per ability: the default for may research", undefined, "default_available"),
    row("u8", n, "Per ability: the default for start with", undefined, "default_researched"),
    row("u8", P * n, "Per player, per ability: 1 if the player uses the defaults", undefined, "uses_default"),
  ];
}

function unitSettingsRows(weapons) {
  return [
    row("u8", U, "Per unit type: 1 to use the game's own values and ignore the rest of this section", "useDefault"),
    row("u32", U, "Hit points × 256", "hitPoints"),
    row("u16", U, "Shields", "shields"),
    row("u8", U, "Armour", "armor"),
    row("u16", U, "Build time, in game frames", "buildTime"),
    row("u16", U, "Mineral cost", "mineralCost"),
    row("u16", U, "Gas cost", "gasCost"),
    row("u16", U, "Name, a string number; 0 for the default name", "nameIndex"),
    row("u16", weapons, "Per weapon: base damage", "weaponDamage"),
    row("u16", weapons, "Per weapon: damage added by each upgrade level", "weaponBonus"),
  ];
}

function upgradeSettingsRows(n, padded) {
  return [
    row("u8", n, "Per upgrade: 1 to use the game's own values", "useDefault"),
    ...(padded ? [row("u8", 1, "Unused", undefined, "unused")] : []),
    row("u16", n, "Mineral cost of the first level", "mineralCost"),
    row("u16", n, "Minerals added for each further level", "mineralFactor"),
    row("u16", n, "Gas cost of the first level", "gasCost"),
    row("u16", n, "Gas added for each further level", "gasFactor"),
    row("u16", n, "Research time of the first level, in game frames", "timeCost"),
    row("u16", n, "Time added for each further level", "timeFactor"),
  ];
}

function techSettingsRows(n) {
  return [
    row("u8", n, "Per ability: 1 to use the game's own values", "useDefault"),
    row("u16", n, "Mineral cost", "mineralCost"),
    row("u16", n, "Gas cost", "gasCost"),
    row("u16", n, "Research time, in game frames", "researchTime"),
    row("u16", n, "Energy cost", "energyCost"),
  ];
}

const WIDTH = { u8: 1, char: 1, u16: 2, u32: 4, i32: 4 };

/** Rows with their offsets and byte counts. */
export function laidOut(rows) {
  let at = 0;
  return rows.map((r) => {
    const out = { ...r, offset: at, bytes: WIDTH[r.type] * r.count };
    at += out.bytes;
    return out;
  });
}

export const layoutSize = (rows) => rows.reduce((n, r) => n + WIDTH[r.type] * r.count, 0);

const trimName = (name) => name.trimEnd();
const code = (name) => `\`${name.replace(/ /g, "␠")}\``;
const hexOf = (name) => [...name].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join(" ");
const SPELLING = { Addon: "Add-on" };
const words = (key) => SPELLING[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (_, c) => ` ${c.toLowerCase()}`);

const MODES = {
  last: "Only the last copy counts.",
  overlay: "Every copy is written over the start of the same fixed-size space, in file order, so a later copy replaces only as many bytes as it carries.",
  append: "Every copy counts: the records of all of them, in file order.",
  first: "Only the first copy counts.",
};

function layoutTable(rows) {
  const lines = ["| Offset | Type | Holds |", "| --- | --- | --- |"];
  for (const r of laidOut(rows)) {
    const type = r.type === "char" ? `${r.count} characters` : r.count === 1 ? r.type : `${r.type} × ${r.count}`;
    lines.push(`| ${r.offset} | ${type} | ${r.holds} |`);
  }
  return lines.join("\n");
}

function flagTable(consts, enumerated) {
  const lines = [enumerated ? "| Value | Meaning |" : "| Bit | Meaning |", "| --- | --- |"];
  for (const [key, value] of Object.entries(consts)) {
    lines.push(`| ${enumerated ? value : `0x${value.toString(16).padStart(value > 0xff ? 4 : 2, "0")}`} | ${words(key)} |`);
  }
  return lines.join("\n");
}

function valueTable(kind, defs) {
  switch (kind) {
    case "playerTypes": return ["| Value | Type |", "| --- | --- |", ...[...defs.PLAYER_TYPES].sort((a, b) => a.value - b.value).map((t) => `| ${t.value} | ${t.label}${t.hint ? ` — ${t.hint.charAt(0).toLowerCase()}${t.hint.slice(1)}` : ""} |`)].join("\n");
    case "races": return ["| Value | Race |", "| --- | --- |", ...[...defs.PLAYER_RACES].sort((a, b) => a.value - b.value).map((r) => `| ${r.value} | ${r.label} |`)].join("\n");
    case "tilesets": return ["| Value | Tileset |", "| --- | --- |", ...defs.TILESETS.map((t, i) => `| ${i} | ${t.name} |`)].join("\n");
    case "colors": return ["| Value | Colour |", "| --- | --- |", ...defs.PLAYER_COLORS.map((c) => `| ${c.id} | ${c.name} |`)].join("\n");
    default: throw new Error(`No value table "${kind}"`);
  }
}

function requirement(name, defs) {
  if (defs.REQUIRED_SECTIONS.includes(name)) return "Yes. The game does not load a map without it.";
  if (defs.REQUIRED_ORIGINAL_SECTIONS.includes(name)) return "In a StarCraft 1.00 or hybrid file (`VER` below 205).";
  if (defs.REQUIRED_EXPANSION_SECTIONS.includes(name)) return "In a hybrid or Brood War file (`VER` 63 and up).";
  if (name === "STRx") return "In place of `STR ` on a Remastered map that uses it.";
  return "No.";
}

function sizeText(name, spec, layout) {
  if (layout.grid) return `${layout.grid === "u8" ? "1 byte" : "2 bytes"} per tile: width × height${layout.grid === "u8" ? "" : " × 2"}.`;
  if (layout.isom) return "(width ÷ 2 + 1) × (height + 1) × 8 bytes.";
  if (layout.strings) return "Whatever the text needs.";
  if (spec.stride) return `${spec.stride} bytes per ${layout.record}${layout.count ? `, ${layout.count} of them: ${spec.size ?? layout.count * spec.stride} bytes` : ""}.`;
  if (layout.count) return `${layout.count * layoutSize(layout.rows)} bytes: ${layout.count} ${layout.record}s of ${layoutSize(layout.rows)}.`;
  return `${spec.size} bytes.`;
}

function sectionBlock(spec, defs) {
  const name = spec.name;
  const layout = LAYOUTS[trimName(name)];
  if (!layout) throw new Error(`No layout for section "${name}"`);
  const lines = [
    `| Name | ${code(name)} (${hexOf(name)}) |`,
    "| --- | --- |",
    `| Size | ${sizeText(name, spec, layout)} |`,
    `| Read by | ${spec.editorOnly ? "Editors only. The game skips it." : "The game."} |`,
    `| Required | ${requirement(name, defs)} |`,
    `| More than one copy | ${MODES[spec.mode]} |`,
    `| In scmJS | ${defs.MODELLED_SECTIONS.has(name) ? "Read, and written again when you change what it holds." : "Kept as it is and written back unchanged."} |`,
  ];
  if (layout.rows) {
    const each = layout.record ? `Each ${layout.record}:` : "Layout:";
    lines.push("", each, "", layoutTable(layout.rows));
  }
  for (const [title, key, enumerated] of layout.flags ?? []) {
    lines.push("", `${title}:`, "", flagTable(defs[key], enumerated));
  }
  if (layout.values) lines.push("", valueTable(layout.values, defs));
  return lines.join("\n");
}

/**
 * The first sentence of each section's page, for the index: the prose stays in the
 * document, and the index cannot describe a section differently from its own page.
 */
function pageSummaries(markdown) {
  const out = new Map();
  for (const m of markdown.matchAll(/^## (\S+)\n\n([\s\S]*?)(?:\n\n|(?![\s\S]))/gm)) {
    const plain = m[2].replace(/\s+/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
    const stop = plain.search(/\.(\s|$)/);
    out.set(m[1], stop < 0 ? plain : plain.slice(0, stop));
  }
  return out;
}

function indexTable(defs, summaries) {
  const lines = ["| Section | Holds | Read by | Required |", "| --- | --- | --- | --- |"];
  for (const name of defs.APPEND_ORDER) {
    const spec = defs.SECTION_SPECS.get(name);
    if (!spec) continue;
    const required = defs.REQUIRED_SECTIONS.includes(name) ? "yes" : defs.REQUIRED_ORIGINAL_SECTIONS.includes(name) || defs.REQUIRED_EXPANSION_SECTIONS.includes(name) ? "by revision" : "";
    lines.push(`| [${code(name)}](#${trimName(name).toLowerCase()}) | ${summaries.get(trimName(name)) ?? ""} | ${spec.editorOnly ? "editors" : "the game"} | ${required} |`);
  }
  return lines.join("\n");
}

function revisionTable(defs) {
  const lines = ["| Revision | `VER` | `TYPE` | Extension |", "| --- | --- | --- | --- |"];
  for (const v of Object.values(defs.MAP_VERSIONS)) lines.push(`| ${v.label} | ${v.ver} | \`${v.type}\` | \`.${v.extension}\` |`);
  return lines.join("\n");
}


/* ── ISOM ───────────────────────────────────────────────── */

/**
 * What the low four bits of an ISOM word say: which quarter of its diamond the word is,
 * and so where that diamond sits on the rect and which of the rect's sides the word is.
 * The test holds this to the position of every word on Blizzard's maps.
 */
export const ISOM_WORD_FLAGS = [
  { bits: 0x0, quarter: "top-left", corner: "bottom-right", side: "right" },
  { bits: 0x2, quarter: "top-left", corner: "bottom-right", side: "bottom" },
  { bits: 0x4, quarter: "top-right", corner: "bottom-left", side: "left" },
  { bits: 0x6, quarter: "top-right", corner: "bottom-left", side: "bottom" },
  { bits: 0x8, quarter: "bottom-right", corner: "top-left", side: "left" },
  { bits: 0xa, quarter: "bottom-right", corner: "top-left", side: "top" },
  { bits: 0xc, quarter: "bottom-left", corner: "top-right", side: "top" },
  { bits: 0xe, quarter: "bottom-left", corner: "top-right", side: "right" },
];

const SIDES = ["left", "top", "right", "bottom"];

/** The flag bits a word at `side` of rect (x, y) carries: even rects are `\\`-cut, odd ones `/`. */
export function isomWordFlags(x, y, side) {
  const even = (x + y) % 2 === 0;
  const corner = even ? (side === 0 || side === 1 ? "top-left" : "bottom-right") : side === 0 || side === 3 ? "bottom-left" : "top-right";
  return ISOM_WORD_FLAGS.find((f) => f.corner === corner && f.side === SIDES[side]).bits;
}

/**
 * Of the two terrains each edge set joins, which is outside and which inside, by CV5
 * terrain index — keyed by `ISOM_TABLES` row (Jungle, Desert, Ice and Twilight share
 * row 4's numbering). The ISOM tables themselves only say which sets exist; this is read
 * off the tileset's CV5 by the brush's own table builder, and the test checks it there
 * when the tilesets are on disk.
 */
export const ISOM_EDGE_SETS = {
  0: { 20: [2, 6], 21: [3, 7], 22: [2, 4], 27: [2, 14], 28: [2, 15], 31: [14, 18], 34: [2, 3], 35: [5, 2] },
  1: { 13: [3, 11], 14: [3, 4], 15: [5, 6], 16: [3, 7], 17: [8, 3], 18: [9, 3], 19: [3, 10], 20: [2, 3], 21: [3, 5] },
  2: { 10: [2, 4], 11: [3, 5], 12: [2, 3], 13: [3, 6], 14: [2, 8], 15: [7, 2] },
  3: { 11: [2, 3], 12: [4, 5], 13: [2, 6], 14: [4, 7], 15: [2, 9], 16: [2, 4], 17: [8, 2] },
  4: { 22: [2, 4], 23: [2, 8], 24: [3, 10], 25: [8, 11], 26: [10, 12], 28: [2, 15], 29: [8, 9], 30: [10, 13], 32: [8, 16], 33: [10, 17], 34: [2, 3], 35: [5, 2] },
};

const ISOM_FAMILIES = [[0], [1], [2], [3], [4, 5, 6, 7]];

function isomValueTables(defs) {
  const out = [];
  for (const family of ISOM_FAMILIES) {
    const { terrainTypes } = defs.ISOM_TABLES[family[0]];
    const half = Math.floor(terrainTypes.length / 2);
    const names = family.map((era) => defs.TILESETS[era].name);
    const nameOf = (era, index) => defs.terrainName(defs.TILESETS[era], index);
    const rows = [];
    terrainTypes.forEach((t, i) => {
      if (i === 0 || !t.isomValue) return;
      if (i <= half) {
        rows.push([t.isomValue, `${t.isomValue}`, family.map((era) => nameOf(era, t.index))]);
      } else {
        const pair = ISOM_EDGE_SETS[family[0]][t.index];
        if (!pair) throw new Error(`No outside/inside terrains for edge set ${t.index} of ${names[0]}`);
        rows.push([t.isomValue, `${t.isomValue}–${t.isomValue + 13}`, family.map((era) => `${nameOf(era, pair[0])} / ${nameOf(era, pair[1])}`)]);
      }
    });
    rows.sort((a, b) => a[0] - b[0]);
    const title = names.length === 1 ? `${names[0]}:` : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}, which share one numbering:`;
    const columns = names.length === 1 ? ["Terrain, or outside / inside"] : names;
    out.push(title, "", `| Value | ${columns.join(" | ")} |`, `| --- | ${columns.map(() => "---").join(" | ")} |`);
    for (const [, value, cells] of rows) out.push(`| ${value} | ${cells.join(" | ")} |`);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

function isomShapeTable() {
  const lines = ["| Shape | The diamond is |", "| --- | --- |"];
  ISOM_SHAPES.forEach((shape, i) => lines.push(`| +${i} | ${shape.words} |`));
  return lines.join("\n");
}

function isomFlagTable() {
  const lines = ["| Low four bits | Quarter of its diamond | The diamond's centre is the rect's | Side of the rect |", "| --- | --- | --- | --- |"];
  for (const f of ISOM_WORD_FLAGS) lines.push(`| 0x${f.bits.toString(16).toUpperCase()} | ${f.quarter} | ${f.corner} corner | ${f.side} |`);
  return lines.join("\n");
}

/* ── Worked examples ────────────────────────────────────── */

const hex = (bytes) => [...bytes].map((b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");

/** A hex dump in a code block: offset, the bytes, and what they say. */
function dump(lines) {
  const width = Math.max(...lines.map(([, bytes]) => bytes.length));
  const out = ["```text"];
  for (const [offset, bytes, what] of lines) out.push(`${String(offset).padStart(4)}  ${bytes.padEnd(width)}  ${what}`);
  out.push("```");
  return out.join("\n");
}

function readLE(bytes, at, width) {
  let v = 0;
  for (let i = width - 1; i >= 0; i--) v = v * 256 + bytes[at + i];
  return v;
}

/** A Carrier with half its hit points and four interceptors. */
function unitExample(defs) {
  const U = defs.UnitUsed;
  const record = {
    ...defs.decodeUnits(new Uint8Array(36))[0],
    serial: 17, x: 1616, y: 848, unitId: 72, owner: 1,
    validStates: U.Owner | U.HitPoints | U.Shields | U.Hangar,
    hitPointsPercent: 50, shieldPercent: 100, hangarUnits: 4,
  };
  const bytes = defs.encodeUnits([record]);
  const set = (value, table) => Object.entries(table).filter(([, bit]) => value & bit).map(([k]) => words(k).toLowerCase()).join(", ") || "none";
  const say = {
    serial: (v) => `serial number ${v}`,
    x: (v) => `x ${v} px (tile ${Math.floor(v / 32)})`,
    y: (v) => `y ${v} px (tile ${Math.floor(v / 32)})`,
    unitId: (v) => `unit type ${v}, ${defs.unitName(v)}`,
    relationType: () => "not linked",
    validProperties: () => "sets no special states",
    validStates: (v) => `sets: ${set(v, defs.UnitUsed)}`,
    owner: (v) => `owner: Player ${v + 1}`,
    hitPointsPercent: (v) => `hit points ${v}%`,
    shieldPercent: (v) => `shields ${v}%`,
    energyPercent: (v) => `energy ${v}% (not set, so not used)`,
    resourceAmount: (v) => `resources ${v} (not set)`,
    hangarUnits: (v) => `${v} in the hangar`,
    stateFlags: () => "no special states",
    unused: () => "unused",
    relatedSerial: () => "no linked unit",
  };
  return recordDump("UNIT", bytes, say);
}

/** One record, field by field, in the layout's order; `say` words each field's value. */
function recordDump(name, bytes, say, base = 0) {
  return dump(laidOut(LAYOUTS[name].rows).map((r) => {
    const width = WIDTH[r.type];
    const at = base + r.offset;
    return [at, hex(bytes.subarray(at, at + width)), say[r.field](readLE(bytes, at, width))];
  }));
}

const flagWords = (value, table) => Object.entries(table).filter(([, bit]) => value & bit).map(([k]) => words(k).toLowerCase());

/** A pure sprite, then a unit sprite: an Installation door that starts closed. */
function spritesExample(defs) {
  const door = defs.UNIT_NAMES.indexOf("Left Upper Level Door");
  const F = defs.SpriteFlag;
  const records = [
    { spriteId: 130, x: 640, y: 400, owner: 11, unused: 0, flags: F.PureSprite },
    { spriteId: door, x: 1216, y: 592, owner: 11, unused: 0, flags: F.Disabled },
  ];
  const bytes = defs.encodeSprites(records);
  const out = [];
  records.forEach((rec, i) => {
    const pure = rec.flags & F.PureSprite;
    out.push(recordDump("THG2", bytes, {
      spriteId: (v) => (pure ? `sprite ${v}` : `unit type ${v}, ${defs.unitName(v)}`),
      x: (v) => `x ${v} px`,
      y: (v) => `y ${v} px`,
      owner: (v) => `owner: Player ${v + 1}`,
      unused: () => "unused",
      flags: (v) => `flags: ${flagWords(v, F).join(", ") || "none"}`,
    }, i * 10));
  });
  return out.join("\n\n");
}

function doodadExample(defs) {
  const bytes = defs.encodeDoodads([{ doodadId: 43, x: 1040, y: 752, owner: 11, disabled: 0 }]);
  return recordDump("DD2", bytes, {
    doodadId: (v) => `doodad ${v} of the tileset's list`,
    x: (v) => `x ${v} px, the middle of the doodad`,
    y: (v) => `y ${v} px`,
    owner: (v) => `owner: Player ${v + 1}`,
    disabled: (v) => (v ? "disabled" : "enabled"),
  });
}

/** A ground-only location over tiles 10–14 across and 12–15 down. */
function locationExample(defs) {
  const E = defs.Elevation;
  const bytes = defs.encodeLocations([{ left: 320, top: 384, right: 480, bottom: 512, nameIndex: 5, elevationFlags: E.LowAir | E.MediumAir | E.HighAir }]);
  return recordDump("MRGN", bytes, {
    left: (v) => `left ${v} px (tile ${v / 32})`,
    top: (v) => `top ${v} px (tile ${v / 32})`,
    right: (v) => `right ${v} px: tiles up to ${v / 32 - 1}`,
    bottom: (v) => `bottom ${v} px: tiles up to ${v / 32 - 1}`,
    nameIndex: (v) => `name: string ${v}`,
    elevationFlags: (v) => `leaves out ${flagWords(v, E).join(", ")}`,
  });
}

/** Players 1–4 against 5–8; the first force allied with shared vision. */
function forcesExample(defs) {
  const F = defs.ForceFlag;
  const bytes = defs.encodeForces({
    playerForce: [0, 0, 0, 0, 1, 1, 1, 1],
    nameIndex: [3, 4, 5, 6],
    flags: [F.Allied | F.AlliedVictory | F.SharedVision | F.RandomStart, F.RandomStart, 0, 0],
  });
  const lines = [];
  for (let p = 0; p < 8; p++) lines.push([p, hex(bytes.subarray(p, p + 1)), `Player ${p + 1}: force ${bytes[p] + 1}`]);
  for (let f = 0; f < 4; f++) lines.push([8 + 2 * f, hex(bytes.subarray(8 + 2 * f, 10 + 2 * f)), `force ${f + 1}'s name: string ${readLE(bytes, 8 + 2 * f, 2)}`]);
  for (let f = 0; f < 4; f++) lines.push([16 + f, hex(bytes.subarray(16 + f, 17 + f)), `force ${f + 1}: ${flagWords(bytes[16 + f], F).join(", ") || "no flags"}`]);
  return dump(lines);
}

/** Carriers: every player takes the default, which allows them, except Player 3. */
function availabilityExample(defs) {
  const carrier = 72, player = 2;
  const a = defs.decodeUnitAvailability(new Uint8Array(defs.PUNI_SIZE));
  a.defaultAvailable[carrier] = 1;
  a.playerUsesDefault.fill(1);
  a.playerUsesDefault[defs.puniIndex(player, carrier)] = 0;
  a.playerAvailable[defs.puniIndex(player, carrier)] = 0;
  a.playerAvailable[defs.puniIndex(0, carrier)] = 0;
  const bytes = defs.encodeUnitAvailability(a);
  const per = 12 * 228;
  const at = (o, what) => [o, hex(bytes.subarray(o, o + 1)), what];
  return dump([
    at(defs.puniIndex(0, carrier), "Player 1, Carrier: may not build it, but see below"),
    at(defs.puniIndex(player, carrier), "Player 3, Carrier: may not build it"),
    at(per + carrier, "the default for Carriers: may build them"),
    at(per + 228 + defs.puniIndex(0, carrier), "Player 1 uses the default, so may build them"),
    at(per + 228 + defs.puniIndex(player, carrier), "Player 3 does not, so may not"),
  ]);
}

/** A Carrier with 400 hit points and a cost of 300 minerals and 200 gas. */
function unitSettingsExample(defs) {
  const carrier = 72;
  const model = defs.defaultUnitSettings();
  model.useDefault[carrier] = 0;
  model.hitPoints[carrier] = 400 * 256;
  model.shields[carrier] = 150;
  model.armor[carrier] = 4;
  model.buildTime[carrier] = 2100;
  model.mineralCost[carrier] = 300;
  model.gasCost[carrier] = 200;
  const bytes = defs.encodeUnitSettings(model, defs.WEAPONS_BW);
  const rows = laidOut(LAYOUTS.UNIx.rows);
  const say = {
    useDefault: (v) => `${v ? "uses" : "does not use"} the game's own values`,
    hitPoints: (v) => `hit points ${v} = ${v / 256} × 256`,
    shields: (v) => `shields ${v}`,
    armor: (v) => `armour ${v}`,
    buildTime: (v) => `build time ${v} frames`,
    mineralCost: (v) => `${v} minerals`,
    gasCost: (v) => `${v} gas`,
    nameIndex: (v) => (v ? `name: string ${v}` : "the game's own name"),
  };
  return dump(rows.filter((r) => say[r.field]).map((r) => {
    const width = WIDTH[r.type];
    const o = r.offset + carrier * width;
    return [o, hex(bytes.subarray(o, o + width)), say[r.field](readLE(bytes, o, width))];
  }));
}

/** Three strings, the first and last the same text, as a map's first strings might be. */
function stringsExample(defs) {
  const texts = [null, "Hills", "Force 1", "Hills"];
  const bytes = defs.encodeStrings({ strings: texts, extended: false, encoding: "utf-8" });
  const count = readLE(bytes, 0, 2);
  const lines = [[0, hex(bytes.subarray(0, 2)), `${count} strings`]];
  for (let i = 1; i <= count; i++) {
    const at = i * 2;
    lines.push([at, hex(bytes.subarray(at, at + 2)), `string ${i} starts at ${readLE(bytes, at, 2)}`]);
  }
  let at = 2 * (count + 1);
  while (at < bytes.length) {
    let end = at;
    while (bytes[end] !== 0) end++;
    const text = new TextDecoder().decode(bytes.subarray(at, end));
    lines.push([at, hex(bytes.subarray(at, end + 1)), text ? `"${text}" and its 0` : "a lone 0: an empty string"]);
    at = end + 1;
  }
  return dump(lines);
}

/** Two rects of the worked example, word by word. */
function isomExample() {
  const ex = ISOM_EXAMPLE;
  const values = isomExampleValues(ex);
  const w = ex.width / 2 + 1;
  const owner = (x, y, side) => {
    const flags = isomWordFlags(x, y, side);
    const { corner } = ISOM_WORD_FLAGS.find((f) => f.bits === flags);
    const dx = corner.endsWith("right") ? 1 : 0, dy = corner.startsWith("bottom") ? 1 : 0;
    return { d: [x + dx, y + dy], flags };
  };
  const lines = [];
  for (const [x, y] of [[3, 3], [4, 3]]) {
    for (let side = 0; side < 4; side++) {
      const { d, flags } = owner(x, y, side);
      const value = values.get(`${d[0]},${d[1]}`);
      const word = (value << 4) | flags;
      const offset = ((y * w + x) * 4 + side) * 2;
      const bytes = [word & 0xff, word >> 8];
      lines.push([offset, hex(bytes), `rect (${x},${y}) ${SIDES[side].padEnd(6)} 0x${word.toString(16).toUpperCase().padStart(4, "0")}: diamond (${d[0]},${d[1]}), value ${value}, bits 0x${flags.toString(16).toUpperCase()}`]);
    }
  }
  return dump(lines);
}

function textCodeTable(defs) {
  const lines = ["| Byte | Written | What it does |", "| --- | --- | --- |"];
  for (const c of defs.TEXT_CODES) {
    const what = c.effect === "color" ? `Colour: ${c.label}${c.rgb ? ` (${c.rgb})` : ""}` : c.label;
    lines.push(`| 0x${c.byte.toString(16).toUpperCase().padStart(2, "0")} | \`${c.code}\` | ${what} |`);
  }
  return lines.join("\n");
}

function vcodFacts(defs) {
  const bytes = defs.defaultVcod();
  const sha = createHash("sha256").update(bytes).digest("hex");
  return [
    "| Fact | Value |",
    "| --- | --- |",
    `| Length | ${bytes.length} bytes |`,
    `| SHA-256 | \`${sha}\` |`,
    `| The 16 operation bytes | \`${hex(bytes.subarray(1024))}\` |`,
  ].join("\n");
}

/** Every block the document may hold, keyed as its marker names it. */
export function referenceBlocks(defs, markdown = "") {
  const blocks = new Map();
  blocks.set("index", indexTable(defs, pageSummaries(markdown)));
  blocks.set("revisions", revisionTable(defs));
  for (const spec of defs.SECTION_SPECS.values()) blocks.set(`section ${trimName(spec.name)}`, sectionBlock(spec, defs));
  blocks.set("isom flags", isomFlagTable());
  blocks.set("isom values", isomValueTables(defs));
  blocks.set("isom shapes", isomShapeTable());
  blocks.set("example ISOM", isomExample());
  blocks.set("example UNIT", unitExample(defs));
  blocks.set("example STR", stringsExample(defs));
  blocks.set("example THG2", spritesExample(defs));
  blocks.set("example DD2", doodadExample(defs));
  blocks.set("example MRGN", locationExample(defs));
  blocks.set("example FORC", forcesExample(defs));
  blocks.set("example PUNI", availabilityExample(defs));
  blocks.set("example UNIx", unitSettingsExample(defs));
  blocks.set("text codes", textCodeTable(defs));
  blocks.set("vcod", vcodFacts(defs));
  return blocks;
}

/** The document with every generated block rewritten, and the blocks it lacks or does not know. */
export const fillReference = (markdown, defs) => fillBlocks(markdown, referenceBlocks(defs, markdown));
