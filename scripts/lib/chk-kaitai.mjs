/**
 * `docs/chk.ksy`: the CHK format as a Kaitai Struct description, for anyone who wants a
 * parser in another language (the Kaitai compiler writes one for C++, C#, Go, Java,
 * JavaScript, Python, Rust and more). It is generated from the same tables as the
 * reference page — the byte layouts in `chk-reference.mjs`, the codecs' flag values, the
 * value tables, the trigger record in `trigger-reference.mjs` — so the two cannot
 * disagree. `npm run docs:reference` writes it and `tests/chkReference.test.ts` fails
 * when the file on disk is not what this module writes.
 *
 * The description reads a file the way it is laid out: sections in order, repeats kept,
 * every section's body parsed on its own. It does not combine repeated sections as the
 * game does, and a section length that is negative or runs past the end of the file
 * stops it; protected maps rely on both (see "Odd lengths" on the reference page).
 */
import { LAYOUTS } from "./chk-reference.mjs";
import { ACTION_FIELDS, CONDITION_FIELDS } from "./trigger-reference.mjs";

const DOCS = "https://docs.scmjs.dev/chk";

const KS_TYPE = { u8: "u1", u16: "u2", u32: "u4", i32: "s4" };
const WIDTH_TYPE = { 1: "u1", 2: "u2", 4: "u4" };

const snake = (s) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
const plain = (s) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "");
const typeName = (section) => `sec_${snake(section.trimEnd())}`;

/** Enum member names: identifiers, unique, never starting with a digit. */
function enumOf(entries) {
  const out = {};
  const used = new Set();
  for (const [value, label] of entries) {
    let id = snake(label.replace(/'/g, "")) || "value";
    if (/^[0-9]/.test(id)) id = `n_${id}`;
    if (used.has(id)) id = `${id}_${value}`;
    used.add(id);
    out[value] = id;
  }
  return out;
}

/* ── A small YAML writer: enough for a .ksy, nothing more ── */

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const scalar = (v) => (typeof v === "number" || typeof v === "boolean" ? String(v) : SAFE.test(v) ? v : JSON.stringify(v));
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const key = (k) => (typeof k === "number" || /^[0-9]+$/.test(k) ? String(k) : SAFE_KEY.test(k) ? k : JSON.stringify(k));

function yaml(value, indent = 0) {
  const pad = " ".repeat(indent);
  const lines = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (item && typeof item === "object") {
        const [first, ...rest] = yaml(item, indent + 2).split("\n");
        lines.push(`${pad}- ${first.trimStart()}`, ...rest);
      } else {
        lines.push(`${pad}- ${scalar(item)}`);
      }
    }
    return lines.join("\n");
  }
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue;
    if (typeof v === "string" && v.includes("\n")) {
      lines.push(`${pad}${key(k)}: |`, ...v.trimEnd().split("\n").map((l) => (l ? `${pad}  ${l}` : "")));
    } else if (v && typeof v === "object") {
      if (Array.isArray(v) && v.length === 0) { lines.push(`${pad}${key(k)}: []`); continue; }
      lines.push(`${pad}${key(k)}:`, yaml(v, indent + 2));
    } else {
      lines.push(`${pad}${key(k)}: ${scalar(v)}`);
    }
  }
  return lines.join("\n");
}

/* ── Building the description ───────────────────────────── */

/** Which value table gives a field its enum, by section. */
const VALUE_ENUMS = { OWNR: "player_type", IOWN: "player_type", SIDE: "race", ERA: "tileset", COLR: "color" };

function fieldsOf(rows, name, enumName) {
  return rows.map((r) => {
    const id = r.id ?? (r.field ? snake(r.field) : null);
    if (!id) throw new Error(`${name}: a row with no id ("${r.holds}")`);
    const f = { id };
    if (r.type === "char") {
      Object.assign(f, { type: "str", size: r.count, encoding: "ASCII" });
    } else {
      f.type = KS_TYPE[r.type];
      if (r.count > 1) Object.assign(f, { repeat: "expr", "repeat-expr": r.count });
    }
    if (enumName) f.enum = enumName;
    f.doc = plain(r.holds);
    return f;
  });
}

/** `is_…` instances for each bit of a flag word. */
function flagInstances(layout, defs) {
  const out = {};
  for (const [, constName, enumerated, field] of layout.flags ?? []) {
    if (enumerated || !field) continue;
    const id = snake(field);
    for (const [flag, bit] of Object.entries(defs[constName])) {
      out[`${id}_${snake(flag)}`] = { value: `(${id} & 0x${bit.toString(16)}) != 0` };
    }
  }
  return out;
}

function triggerTypes() {
  const record = (fields, typeKey, enumName) => Object.entries(fields).map(([name, [, width, doc]]) => {
    const f = { id: name === "type" ? typeKey : snake(name), type: WIDTH_TYPE[width] };
    if (name === "type") f.enum = enumName;
    f.doc = doc;
    return f;
  });
  const trigger = (actionType, doc) => ({
    doc,
    seq: [
      { id: "conditions", type: "condition", repeat: "expr", "repeat-expr": 16, doc: "The list ends at the first slot whose type is 0." },
      { id: "actions", type: actionType, repeat: "expr", "repeat-expr": 64, doc: "The list ends at the first slot whose type is 0." },
      { id: "flags", type: "u4", doc: "0x04 preserved, 0x08 disabled, 0x02 ignores Defeat and Draw; the rest are the game's while it runs." },
      { id: "players", type: "u1", repeat: "expr", "repeat-expr": 27, doc: "Per player or group: non-zero where the trigger runs for it." },
      { id: "current_action", type: "u1", doc: "Used by the game while the trigger runs; 0 in a saved map." },
    ],
  });
  return {
    trigger: trigger("action", "One trigger, 2400 bytes."),
    briefing: trigger("briefing_action", "One mission briefing, in the trigger's record with its own actions."),
    condition: { doc: "One condition, 20 bytes.", seq: record(CONDITION_FIELDS, "condition_type", "condition_type") },
    action: { doc: "One action, 32 bytes.", seq: record(ACTION_FIELDS, "action_type", "action_type") },
    briefing_action: { doc: "One briefing action, 32 bytes.", seq: record(ACTION_FIELDS, "action_type", "briefing_action_type") },
  };
}

function sectionType(spec, defs) {
  const name = spec.name.trimEnd();
  const layout = LAYOUTS[name];
  const doc = `${DOCS}/${snake(name).replace(/_/g, "")}/`;
  if (name === "TRIG" || name === "MBRF") {
    const record = name === "TRIG" ? "trigger" : "briefing";
    return { types: {}, type: { "doc-ref": doc, seq: [{ id: `${record}s`, type: record, repeat: "eos" }] } };
  }
  if (name === "STR" || name === "STRx") {
    const width = name === "STR" ? "u2" : "u4";
    return {
      types: {},
      type: {
        "doc-ref": doc,
        seq: [
          { id: "count", type: width },
          { id: "offsets", type: width, repeat: "expr", "repeat-expr": "count", doc: "Where each string starts, from the start of the section. String numbers count from 1: offsets[0] is string 1." },
        ],
        instances: {
          strings: { type: "string_at(offsets[_index])", repeat: "expr", "repeat-expr": "count", doc: "strings[0] is string 1." },
        },
      },
    };
  }
  if (name === "ISOM") {
    return {
      types: {
        isom_rect: {
          doc: "A rect two tiles wide and one tall; each word is a quarter of one of the two diamonds the rect's diagonal divides it between.",
          seq: LAYOUTS.ISOM.rows.map((r) => ({ id: r.id, type: "isom_word", doc: r.holds })),
        },
        isom_word: {
          seq: [{ id: "raw", type: "u2" }],
          instances: {
            value: { value: "raw >> 4", doc: "The diamond's value: a flat terrain, or an edge set's first value plus its shape (0 to 13)." },
            quarter: { value: "(raw >> 2) & 3", enum: "isom_quarter", doc: "Which quarter of its diamond the word is. StarEdit leaves these bits 0 on ground it filled rather than painted." },
            second_side: { value: "((raw >> 1) & 1) != 0", doc: "Which of the quarter's two rect sides this word is." },
          },
        },
      },
      type: { "doc-ref": doc, seq: [{ id: "rects", type: "isom_rect", repeat: "eos", doc: "(width / 2 + 1) × (height + 1) rects, row by row." }] },
    };
  }
  if (layout.grid) {
    if (layout.grid === "u16") {
      return { types: {}, type: { "doc-ref": doc, seq: [{ id: "tiles", type: "tile", repeat: "eos", doc: plain(layout.holds) }] } };
    }
    return { types: {}, type: { "doc-ref": doc, seq: [{ id: "tiles", type: "u1", repeat: "eos", doc: plain(layout.holds) }] } };
  }
  const enumName = VALUE_ENUMS[name];
  const enumFor = (rows) => rows.map((r) => (layout.flags ?? []).find(([, , enumerated, field]) => enumerated && field === r.id));
  if (layout.record) {
    const recordType = snake(layout.record === "slot" ? "properties_slot" : layout.record);
    const instances = flagInstances(layout, defs);
    const record = { seq: fieldsOf(layout.rows, name) };
    if (Object.keys(instances).length) record.instances = instances;
    const repeat = layout.count ? { repeat: "expr", "repeat-expr": layout.count } : { repeat: "eos" };
    return { types: { [recordType]: record }, type: { "doc-ref": doc, seq: [{ id: `${recordType}s`, type: recordType, ...repeat }] } };
  }
  const seq = fieldsOf(layout.rows, name, enumName);
  enumFor(layout.rows).forEach((flag, i) => { if (flag) seq[i].enum = snake(flag[1]); });
  return { types: {}, type: { "doc-ref": doc, seq } };
}

/** The whole description, as the text of a .ksy file. */
export function chkKaitai(defs) {
  const sectionTypes = {};
  const shared = {};
  const cases = {};
  for (const spec of defs.SECTION_SPECS.values()) {
    const { types, type } = sectionType(spec, defs);
    type.doc = plain(`${spec.name.trimEnd()}: ${spec.editorOnly ? "read by editors only." : "read by the game."}`);
    sectionTypes[typeName(spec.name)] = type;
    Object.assign(shared, types);
    cases[JSON.stringify(spec.name)] = typeName(spec.name);
  }

  const colorModes = Object.entries(defs.ColorMode).map(([k, v]) => [v, k]);
  const description = {
    meta: {
      id: "starcraft_scenario_chk",
      title: "StarCraft and Brood War scenario file (scenario.chk)",
      application: ["StarCraft", "StarCraft: Brood War", "StarCraft: Remastered"],
      "file-extension": "chk",
      license: "MIT",
      "ks-version": "0.10",
      endian: "le",
    },
    doc: [
      "The scenario inside a StarCraft map archive (.scm, .scx): a run of sections, each a",
      "four-character name, a 32-bit length and that many bytes.",
      "",
      "Generated from the scmJS CHK format reference, which explains every field:",
      `${DOCS}/`,
      "",
      "This reads a file section by section and keeps repeats. It does not combine repeated",
      "sections the way the game does, and a negative length or one past the end of the file",
      "stops it; protected maps use both. Sizes that follow from DIM (MTXM, TILE, MASK, ISOM)",
      "are read to the end of the section.",
      "",
    ].join("\n"),
    "doc-ref": `${DOCS}/`,
    seq: [{ id: "sections", type: "section", repeat: "eos" }],
    types: {
      section: {
        seq: [
          { id: "name", type: "str", size: 4, encoding: "ISO-8859-1", doc: "Padded with spaces: \"VER \", \"DIM \", \"STR \"." },
          { id: "length", type: "s4" },
          { id: "body", size: "length", type: { "switch-on": "name", cases } },
        ],
      },
      tile: {
        doc: "A tile number: the tileset's CV5 tile group and the megatile within it.",
        seq: [{ id: "raw", type: "u2" }],
        instances: {
          group: { value: "raw >> 4", doc: "The tile group in the tileset's CV5." },
          variation: { value: "raw & 0xf", doc: "Which of the group's 16 megatiles." },
        },
      },
      string_at: {
        params: [{ id: "ofs", type: "u4" }],
        instances: {
          text: {
            pos: "ofs",
            io: "_parent._io",
            terminator: 0,
            "eos-error": false,
            if: "ofs < _parent._io.size",
            doc: "The string's bytes. The file does not say which encoding they are in.",
          },
        },
      },
      ...sectionTypes,
      ...shared,
      ...triggerTypes(),
    },
    enums: {
      player_type: enumOf([...defs.PLAYER_TYPES].sort((a, b) => a.value - b.value).map((t) => [t.value, t.label])),
      race: enumOf([...defs.PLAYER_RACES].sort((a, b) => a.value - b.value).map((r) => [r.value, r.label])),
      tileset: enumOf(defs.TILESETS.map((t, i) => [i, t.name])),
      color: enumOf(defs.PLAYER_COLORS.map((c) => [c.id, c.name])),
      color_mode: enumOf(colorModes),
      isom_quarter: { 0: "top_left", 1: "top_right", 2: "bottom_right", 3: "bottom_left" },
      condition_type: enumOf([[0, "None"], ...defs.CONDITION_DEFS.map((d) => [d.type, d.name])]),
      action_type: enumOf([[0, "None"], ...defs.ACTION_DEFS.map((d) => [d.type, d.name])]),
      briefing_action_type: enumOf([[0, "None"], ...defs.BRIEFING_ACTION_DEFS.map((d) => [d.type, d.name])]),
    },
  };
  return `# Generated by npm run docs:reference from the scmJS CHK format reference. Do not edit.\n${yaml(description)}\n`;
}
