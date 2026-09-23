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

import { fillBlocks } from "./generated-blocks.mjs";

const P = 12; // player slots
const U = 228; // unit types

/**
 * One row of a layout: a type, how many of it, and what it holds. `field` names the
 * codec's property for the offset test; `per` says what one element of an array is.
 */
const row = (type, count, holds, field) => ({ type, count, holds, field });

const players = (holds) => row("u8", P, `${holds}, one byte per player slot, Player 1 first`);

/** Byte layouts, keyed by section name without its padding. `record` sections repeat the rows. */
export const LAYOUTS = {
  TYPE: { rows: [row("char", 4, "`RAWS` for a StarCraft file, `RAWB` for Brood War")] },
  VER: { rows: [row("u16", 1, "The revision; see [Revisions](#revisions)")] },
  IVER: { rows: [row("u16", 1, "StarEdit's version number, an older form")] },
  IVE2: { rows: [row("u16", 1, "StarEdit's version number; 11 in a map StarEdit saves for Brood War")] },
  VCOD: { rows: [row("u32", 256, "Seeds"), row("u8", 16, "Operations")] },
  IOWN: { rows: [players("StarEdit's copy of each player's [type](#ownr)")] },
  OWNR: { rows: [players("Each player's type")], values: "playerTypes" },
  ERA: { rows: [row("u16", 1, "The tileset. The game uses the low three bits")], values: "tilesets" },
  DIM: { rows: [row("u16", 1, "Width in tiles"), row("u16", 1, "Height in tiles")] },
  SIDE: { rows: [players("Each player's race")], values: "races" },
  MTXM: { grid: "u16", holds: "The tile shown at each position, row by row from the top left: the tile group × 16 + the tile's place in the group" },
  PUNI: {
    rows: [
      row("u8", P * U, "Per player, per unit type: 1 if the player can build it. Player 1's 228 bytes first"),
      row("u8", U, "Per unit type: 1 if it can be built, for every player that uses the default"),
      row("u8", P * U, "Per player, per unit type: 1 if the player uses the default"),
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
    flags: [["Relations", "UnitRelation"], ["Special states", "UnitState"], ["Fields set", "UnitUsed"]],
  },
  ISOM: { isom: true },
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
    flags: [["Flags", "SpriteFlag"]],
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
    flags: [["Special states", "CuwpState"], ["Fields set", "CuwpField"]],
    count: 64,
  },
  UPUS: { rows: [row("u8", 64, "Per slot: 1 if StarEdit considers it in use")] },
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
    flags: [["Elevations", "Elevation"]],
  },
  TRIG: { rows: [row("u8", 2400, "One trigger; see [the trigger record](triggers.md#the-trigger-record)")], record: "trigger", opaque: true },
  MBRF: { rows: [row("u8", 2400, "One briefing, in the same record as a trigger")], record: "briefing", opaque: true },
  SPRP: { rows: [row("u16", 1, "The scenario's name, a string number"), row("u16", 1, "Its description, a string number")] },
  FORC: {
    rows: [
      row("u8", 8, "The force of each of Players 1 to 8, 0 to 3"),
      row("u16", 4, "The name of each force, a string number"),
      row("u8", 4, "Each force's flags (below)"),
    ],
    flags: [["Force flags", "ForceFlag"]],
  },
  WAV: { rows: [row("u32", 512, "The name of each sound, a string number; 0 for an empty slot")] },
  UNIS: { rows: unitSettingsRows(100) },
  UPGS: { rows: upgradeSettingsRows(46, false) },
  TECS: { rows: techSettingsRows(24) },
  SWNM: { rows: [row("u32", 256, "The name of each switch, a string number; 0 for none")] },
  COLR: { rows: [row("u8", 8, "The colour of each of Players 1 to 8")], values: "colors" },
  PUPx: { rows: upgradeRows(61) },
  PTEx: { rows: techRows(44) },
  UNIx: { rows: unitSettingsRows(130) },
  UPGx: { rows: upgradeSettingsRows(61, true) },
  TECx: { rows: techSettingsRows(44) },
  CRGB: {
    rows: [row("u8", 24, "Red, green and blue for each of Players 1 to 8, three bytes each"), row("u8", 8, "How each player's colour is chosen (modes, below)")],
    flags: [["Colour modes", "ColorMode", true]],
  },
};

function upgradeRows(n) {
  return [
    row("u8", P * n, `Per player, per upgrade: the highest level they may research. Player 1's ${n} bytes first`),
    row("u8", P * n, "Per player, per upgrade: the level they start at"),
    row("u8", n, "Per upgrade: the default highest level"),
    row("u8", n, "Per upgrade: the default starting level"),
    row("u8", P * n, "Per player, per upgrade: 1 if the player uses the defaults"),
  ];
}

function techRows(n) {
  return [
    row("u8", P * n, `Per player, per ability: 1 if they may research it. Player 1's ${n} bytes first`),
    row("u8", P * n, "Per player, per ability: 1 if they start with it"),
    row("u8", n, "Per ability: the default for may research"),
    row("u8", n, "Per ability: the default for start with"),
    row("u8", P * n, "Per player, per ability: 1 if the player uses the defaults"),
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
    ...(padded ? [row("u8", 1, "Unused")] : []),
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

/** Every block the document may hold, keyed as its marker names it. */
export function referenceBlocks(defs, markdown = "") {
  const blocks = new Map();
  blocks.set("index", indexTable(defs, pageSummaries(markdown)));
  blocks.set("revisions", revisionTable(defs));
  for (const spec of defs.SECTION_SPECS.values()) blocks.set(`section ${trimName(spec.name)}`, sectionBlock(spec, defs));
  return blocks;
}

/** The document with every generated block rewritten, and the blocks it lacks or does not know. */
export const fillReference = (markdown, defs) => fillBlocks(markdown, referenceBlocks(defs, markdown));
