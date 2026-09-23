/**
 * The generated half of `docs/triggers.md`, the trigger reference.
 *
 * The document is prose written by hand, with blocks between
 * `<!-- generated: KEY -->` and `<!-- /generated -->` that this module writes: each
 * condition's and action's number, its text form and the table of where every argument
 * is stored, the player groups, the argument values and the record layout. They come
 * from the same tables the editor reads and writes maps with (`src/data/triggerDefs.ts`),
 * so the reference cannot say a field is somewhere the editor does not put it.
 *
 * Pure: the tables are passed in, so `scripts/reference-docs.mjs` (plain Node) and
 * `tests/triggerReference.test.ts` (vitest) run the same code over the same input.
 */
import { fillBlocks } from "./generated-blocks.mjs";

/** Byte offset and width of each field of a 20-byte condition. Checked against the codec by the test. */
export const CONDITION_FIELDS = {
  location: [0, 4, "Location number, counted from 1; 0 for none."],
  player: [4, 4, "Player or group."],
  amount: [8, 4, "Amount compared against."],
  unitId: [12, 2, "Unit type."],
  comparison: [14, 1, "Comparison, or the switch state for Switch."],
  type: [15, 1, "Which condition this is."],
  resource: [16, 1, "Resource type, score type or switch number, depending on the condition."],
  flags: [17, 1, "Flags: 0x02 disabled; the others are editor and game bookkeeping."],
  mask: [18, 2, "Unused by ordinary triggers; some EUD tools store a mask here."],
};

/** Byte offset and width of each field of a 32-byte action. */
export const ACTION_FIELDS = {
  location: [0, 4, "Location number, counted from 1; 0 for none. The source location where there are two."],
  text: [4, 4, "String-table entry of the text."],
  wav: [8, 4, "String-table entry of the sound file's name."],
  time: [12, 4, "A time: milliseconds, or seconds for Set Countdown Timer."],
  player: [16, 4, "Player or group; the first player where there are two."],
  target: [20, 4, "Second player, destination location, amount, properties slot or AI script, depending on the action."],
  unitId: [24, 2, "Unit type, or the score, resource or alliance type."],
  type: [26, 1, "Which action this is."],
  modifier: [27, 1, "Unit count, modifier, switch action, order or state, depending on the action."],
  flags: [28, 1, "Flags: 0x02 disabled, 0x04 always display; the others are editor and game bookkeeping."],
  padding: [29, 1, "Unused."],
  mask: [30, 2, "Unused by ordinary triggers; some EUD tools store a mask here."],
};

const COUNT_WORDS = { 1: "byte", 2: "bytes", 4: "bytes" };

function bytes([offset, width]) {
  return width === 1 ? `byte ${offset}` : `${COUNT_WORDS[width]} ${offset}–${offset + width - 1}`;
}

/** What an argument of each kind takes, in a reader's words, linking to the table of its values. */
function takes(arg) {
  switch (arg.kind) {
    case "player": return "a [player or group](#players-and-groups)";
    case "unit": return "a unit type, or one of the [unit classes](#unit-classes)";
    case "location": return "a location (Anywhere is location 64)";
    case "switch": return "one of the 256 [switches](#switches)";
    case "comparison": return "[At least, At most or Exactly](#comparisons)";
    case "switchState": return "[set or not set](#switches)";
    case "switchAction": return "[set, clear, toggle or randomize](#switches)";
    case "modifier": return "[Set To, Add or Subtract](#modifiers)";
    case "unitState": return "[enable, disable or toggle](#states)";
    case "order": return "[move, patrol or attack](#orders)";
    case "alliance": return "[Enemy, Ally or Allied Victory](#alliances)";
    case "resource": return "[ore, gas, or ore and gas](#resources)";
    case "score": return "a [score type](#scores)";
    case "aiScript": return "an [AI script](#ai-scripts), stored as its four-letter code";
    case "textFlags": return "Always Display or Don't Always Display";
    case "text": return "text, stored as a string-table entry";
    case "wav": return "the name of a sound file in the map, stored as a string-table entry";
    case "number": case "amount": return "a whole number, 0 to 4,294,967,295";
    case "count": return "a number of units, 1 to 255, or All (stored as 0)";
    case "duration": return arg.label === "Seconds" ? "a number of seconds" : "a time in milliseconds";
    case "percent": return "a percentage, 0 to 100";
    case "cuwp": return "a [unit properties slot](#create-unit-with-properties)";
    case "slot": return "a portrait slot, 0 to 3";
    default: return arg.kind;
  }
}

function where(arg, fields) {
  if (arg.kind === "textFlags") return `bit 0x04 of byte ${fields.flags[0]}`;
  const field = fields[arg.field];
  if (!field) throw new Error(`No layout for field "${arg.field}"`);
  return bytes(field);
}

function entryBlock(noun, def, fields) {
  const form = `${def.name}(${def.args.map((a) => a.label).join(", ")});`;
  const lines = [`**${noun} ${def.type}** · \`${form}\``, ""];
  if (def.args.length === 0) {
    lines.push("It takes no arguments.");
  } else {
    lines.push(`| Argument | Takes | Stored in the ${noun.toLowerCase()} |`, "| --- | --- | --- |");
    for (const arg of def.args) lines.push(`| ${arg.label} | ${takes(arg)} | ${where(arg, fields)} |`);
  }
  return lines.join("\n");
}

function choiceTable(choices, header = "Name") {
  const lines = [`| ${header} | Stored as |`, "| --- | --- |"];
  for (const c of choices) {
    const also = c.aliases?.length ? ` (also ${c.aliases.map((a) => `\`${a}\``).join(", ")})` : "";
    lines.push(`| ${c.label}${also} | ${c.value} |`);
  }
  return lines.join("\n");
}

function layoutTable(fields, noun) {
  const lines = [`| Bytes | Holds |`, "| --- | --- |"];
  for (const f of Object.values(fields)) lines.push(`| ${bytes(f).replace(/^bytes? /, "")} | ${f[2]} |`);
  return `${lines.join("\n")}\n\nAll numbers are little-endian. An unused ${noun} slot is all zeros.`;
}

/** Every block the document may hold, keyed as its marker names it. */
export function referenceBlocks(defs) {
  const { CONDITION_DEFS, ACTION_DEFS, BRIEFING_ACTION_DEFS, CHOICES, PLAYER_GROUP_CHOICES, UNIT_CLASS_CHOICES, AI_SCRIPT_CHOICES } = defs;
  const blocks = new Map();
  for (const d of CONDITION_DEFS) blocks.set(`condition ${d.type}`, entryBlock("Condition", d, CONDITION_FIELDS));
  for (const d of ACTION_DEFS) blocks.set(`action ${d.type}`, entryBlock("Action", d, ACTION_FIELDS));
  for (const d of BRIEFING_ACTION_DEFS) blocks.set(`briefing ${d.type}`, entryBlock("Briefing action", d, ACTION_FIELDS));
  blocks.set("players", choiceTable(PLAYER_GROUP_CHOICES, "Player or group"));
  for (const kind of ["comparison", "modifier", "switchState", "switchAction", "resource", "score", "order", "alliance", "unitState"]) {
    blocks.set(`values ${kind}`, choiceTable(CHOICES[kind]));
  }
  blocks.set("values unitClass", choiceTable(UNIT_CLASS_CHOICES, "Class"));
  blocks.set("values aiScript", ["| Code | Script |", "| --- | --- |", ...AI_SCRIPT_CHOICES.map((s) => `| \`${s.id}\` | ${s.name} |`)].join("\n"));
  blocks.set("layout condition", layoutTable(CONDITION_FIELDS, "condition"));
  blocks.set("layout action", layoutTable(ACTION_FIELDS, "action"));
  return blocks;
}

/**
 * The document with every generated block rewritten. `missing` lists the blocks the
 * tables have and the document does not — a condition or action with no page — and
 * `unknown` the markers the tables do not recognise.
 */
export const fillReference = (markdown, defs) => fillBlocks(markdown, referenceBlocks(defs));
