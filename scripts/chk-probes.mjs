/**
 * Probe maps for the CHK format reference (`docs/chk-format.md`): one small map per claim
 * the page makes about what the game does with a file, built so that playing it in
 * StarCraft shows whether the claim holds. The maps and a checklist (`CHECKLIST.txt`) go
 * to one folder; nothing here is committed output.
 *
 *   node scripts/chk-probes.mjs [out-dir]
 *
 * Needs the Jungle tileset in public/tileset (`npm run extract`). Each map is built the
 * way the editor builds a new one and then taken apart at the section level, so a probe
 * can drop a section, repeat one, shorten one or write a header the editor never would.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/load-ts.mjs";

const root = resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(join(root, "src", file)).href);
const out = resolve(process.argv[2] ?? join(root, "chk-probes"));

const { createScenario } = await load("formats/chk/create.ts");
const { serializeScenario, setMapVersion, markDirty } = await load("formats/chk/scenario.ts");
const { parseChk } = await load("formats/chk/reader.ts");
const { saveMap } = await load("formats/mpq/scm.ts");
const { loadTileset } = await load("formats/tileset/decode.ts");
const { baseTerrain, flatTerrain } = await load("formats/tileset/terrain.ts");
const { triggersFromText } = await load("editor/exchange.ts");
const { PlayerType, PlayerRace, ColorMode } = await load("formats/chk/sections/players.ts");
const { UnitUsed, UnitState, SpriteFlag } = await load("formats/chk/sections/objects.ts");
const { cloneUnitSettings } = await load("formats/chk/sections/settings.ts");

/* ── The base map ──────────────────────────────────────── */

const W = 64, H = 64;
const JUNGLE_ERA = 4;
const TERRAIN = { dirt: 2, jungle: 8 }; // ISOM terrain ids on the Jungle family

const tilesetFile = (ext) => readFileSync(join(root, "public", "tileset", `jungle.${ext}`));
const jungle = loadTileset({ cv5: tilesetFile("cv5"), vf4: tilesetFile("vf4"), vr4: tilesetFile("vr4"), wpe: tilesetFile("wpe"), vx4: tilesetFile("vx4") });

/** The same pseudo-random tiles every run, so two builds of a probe are the same file. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const ORIGINAL_TABLES = ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"];
const EXPANSION_TABLES = ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"];

/** Change the file's revision and the settings tables with it: a hybrid file has both sets, a 1.00 file only the original. */
function revision(scn, version) {
  setMapVersion(scn, version);
  if (version === "original" || version === "hybrid") markDirty(scn, ...ORIGINAL_TABLES);
  if (version === "original") for (const name of EXPANSION_TABLES) scn.dirty.delete(name);
}

const flat = (terrainId) => flatTerrain(W, H, baseTerrain(jungle, terrainId), jungle, seeded(7), JUNGLE_ERA);

const UNIT = { marine: 0, ghost: 1, firebat: 32, medic: 34, zergling: 37, carrier: 72, mineral: 176, start: 214 };
const px = (tile) => tile * 32 + 16;

let serial = 1;
function unit(unitId, owner, tx, ty, extra = {}) {
  return {
    serial: serial++, x: px(tx), y: px(ty), unitId, relationType: 0, validProperties: 0, validStates: 0,
    owner, hitPointsPercent: 100, shieldPercent: 100, energyPercent: 100, resourceAmount: 0, hangarUnits: 0,
    stateFlags: 0, unused: 0, relatedSerial: 0, ...extra,
  };
}

function addString(scn, text) {
  scn.strings.strings.push(text);
  markDirty(scn, scn.strings.extended ? "STRx" : "STR ");
  return scn.strings.strings.length - 1;
}

function setLocation(scn, index, name, tx0, ty0, tx1, ty1) {
  scn.locations[index] = { left: tx0 * 32, top: ty0 * 32, right: tx1 * 32, bottom: ty1 * 32, nameIndex: addString(scn, name), elevationFlags: 0 };
  markDirty(scn, "MRGN");
}

function setTriggers(scn, text, briefing = false) {
  const parsed = triggersFromText(scn, text, briefing);
  if (briefing) scn.briefing = parsed; else scn.triggers = parsed;
  markDirty(scn, briefing ? "MBRF" : "TRIG");
}

const say = (id, words) => `Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\tDisplay Text Message(Always Display, "${id}: ${words}");\n}\n`;

/**
 * A playable 64×64 Jungle map: Player 1 human Terran, Player 2 computer Zerg, a start
 * location each (so it plays as Melee), a Marine for Player 1 and one trigger that says
 * the map loaded (so it shows in Use Map Settings).
 */
function base(id, title, { terrain = TERRAIN.jungle, p1 = [12, 52], p2 = [52, 12] } = {}) {
  const { tiles, isom } = flat(terrain);
  const scn = createScenario({ width: W, height: H, era: JUNGLE_ERA, name: `CHK ${id} ${title}`, description: `Probe ${id} for the CHK format reference.`, tiles, isom });
  scn.playerTypes = scn.playerTypes.map((t, i) => (i === 0 ? PlayerType.Human : i === 1 ? PlayerType.Computer : i < 8 ? PlayerType.Inactive : t));
  scn.editorPlayerTypes = [...scn.playerTypes];
  scn.playerRaces = scn.playerRaces.map((r, i) => (i === 0 ? PlayerRace.Terran : i === 1 ? PlayerRace.Zerg : i < 8 ? PlayerRace.Inactive : r));
  scn.forces.playerForce = [0, 1, 0, 0, 0, 0, 0, 0];
  serial = 1;
  scn.units = [
    unit(UNIT.start, 0, p1[0], p1[1]),
    unit(UNIT.start, 1, p2[0], p2[1]),
    unit(UNIT.marine, 0, p1[0] + 3, p1[1] - 2),
  ];
  markDirty(scn, "OWNR", "IOWN", "SIDE", "FORC", "UNIT");
  setTriggers(scn, say(id, "loaded (Use Map Settings)"));
  return scn;
}

/* ── Sections as a list the probes can take apart ──────── */

const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** The scenario's sections, in file order: `{ name, data, size? }`, `size` the declared length when it differs. */
const sectionsOf = (scn) => parseChk(serializeScenario(scn)).sections.map((s) => ({ name: s.name, data: s.data.slice() }));

const find = (list, name) => {
  const s = list.find((x) => x.name === name);
  if (!s) throw new Error(`no ${name}`);
  return s;
};
const drop = (list, ...names) => list.filter((s) => !names.includes(s.name));
const dataOf = (scn, name) => find(sectionsOf(scn), name).data;

/** Headers and data written exactly as given: a probe may declare any length, and `raw` entries are bytes as they are. */
function writeChk(list, trailing = new Uint8Array(0)) {
  const parts = [];
  for (const s of list) {
    if (s.raw) { parts.push(s.raw); continue; }
    const head = new Uint8Array(8);
    head.set(latin1(s.name.padEnd(4, " ").slice(0, 4)));
    new DataView(head.buffer).setInt32(4, s.size ?? s.data.length, true);
    parts.push(head, s.data);
  }
  parts.push(trailing);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  return bytes;
}

const u16s = (...values) => { const b = new Uint8Array(values.length * 2); const v = new DataView(b.buffer); values.forEach((x, i) => v.setUint16(i * 2, x, true)); return b; };
const header = (name, size) => { const b = new Uint8Array(8); b.set(latin1(name)); new DataView(b.buffer).setInt32(4, size, true); return b; };
const concat = (...parts) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { b.set(p, at); at += p.length; } return b; };

function locationBytes(tx0, ty0, tx1, ty1, nameIndex) {
  const b = new Uint8Array(20);
  const v = new DataView(b.buffer);
  [tx0 * 32, ty0 * 32, tx1 * 32, ty1 * 32].forEach((n, i) => v.setInt32(i * 4, n, true));
  v.setUint16(16, nameIndex, true);
  return b;
}

/** A string table from byte strings, laid out as StarEdit lays one out. */
function strBytes(strings) {
  const count = strings.length;
  const offsets = new Uint8Array(2 + count * 2);
  const v = new DataView(offsets.buffer);
  v.setUint16(0, count, true);
  const bodies = [];
  let at = offsets.length;
  strings.forEach((s, i) => {
    v.setUint16(2 + i * 2, at, true);
    const bytes = concat(s, new Uint8Array(1));
    bodies.push(bytes);
    at += bytes.length;
  });
  return concat(offsets, ...bodies);
}

/* ── The probes ───────────────────────────────────────── */

/**
 * `play`: how to look — "list" (the map list is enough), "melee", "ums", or "both" (host it
 * once as Melee and once as Use Map Settings). `claim` is what the reference says;
 * `look` is what to check.
 */
const probes = [];
const probe = (id, title, play, claim, look, build, ext = "scx") => probes.push({ id, title, play, claim, look, build, ext });

// A — the base map, which every other probe changes one thing in.
probe("A00", "baseline", "both", "A map built the way the editor builds one loads and plays.",
  "It loads both ways; in Use Map Settings the text \"A00: loaded\" appears.",
  () => sectionsOf(base("A00", "baseline")));

// B — the sections the reference calls required.
const REQUIRED = ["VER ", "VCOD", "OWNR", "ERA ", "DIM ", "SIDE", "MTXM", "PUNI", "UNIT", "THG2", "STR ", "UPRP", "MRGN", "TRIG", "MBRF", "SPRP", "FORC"];
REQUIRED.forEach((name, i) => {
  const id = `B${String(i + 1).padStart(2, "0")}`;
  const n = name.trim();
  probe(id, `no ${n}`, "both", `${n} is required: the game does not load a map without it.`,
    `Does it load as Melee? As Use Map Settings? (Refused, crash, or loads — note any message.)${n === "SPRP" || n === "STR" ? " With no name it shows under its file name." : ""}`,
    () => drop(sectionsOf(base(id, `no ${n}`)), name));
});
EXPANSION_TABLES.forEach((name, i) => {
  const id = `B${18 + i}`;
  probe(id, `no ${name}`, "both", `A Brood War file (VER 205) needs ${name}.`, "Does it load as Melee? As Use Map Settings?",
    () => drop(sectionsOf(base(id, `no ${name}`)), name));
});
probe("B23", "hybrid, no UNIS", "both", "A hybrid file (VER 63) needs the original tables (UNIS) as well as the Brood War ones.",
  "Host it as a Brood War game: does it load? If Remastered offers an original StarCraft game type, try that too.",
  () => { const s = base("B23", "hybrid, no UNIS"); revision(s, "hybrid"); return drop(sectionsOf(s), "UNIS"); }, "scm");
probe("B24", "StarCraft 1.00 file", "both", "A StarCraft 1.00 file (VER 59, RAWS, .scm) with only the original tables loads.",
  "Does it load? Which game types does Remastered offer for it?",
  () => { const s = base("B24", "StarCraft 1.00"); revision(s, "original"); return sectionsOf(s); }, "scm");

// C — the sections the reference says the game never reads, or does not need.
probe("C01", "required only", "both", "Every section not marked required can be left out (TYPE, IVE2, IOWN, ISOM, TILE, DD2, MASK, UPUS, WAV, SWNM, COLR, and the rest).",
  "Loads both ways. The map starts fully fogged (no MASK) and the colours are the lobby's.",
  () => sectionsOf(base("C01", "required only")).filter((s) => REQUIRED.includes(s.name) || EXPANSION_TABLES.includes(s.name)));
probe("C02", "editor sections zeroed", "both", "ISOM, TILE and DD2 can be filled with zeros; the game never reads them.",
  "Loads both ways, and the terrain looks the same as A00.",
  () => sectionsOf(base("C02", "editor sections zeroed")).map((s) => (["ISOM", "TILE", "DD2 "].includes(s.name) ? { ...s, data: new Uint8Array(s.data.length) } : s)));
probe("C03", "no MASK", "ums", "A map with no MASK plays fully fogged.",
  "At the start, is everything outside your units' sight black (unexplored)?",
  () => drop(sectionsOf(base("C03", "no MASK")), "MASK"));

// D — repeated sections.
probe("D01", "last copy counts", "ums",
  "For SPRP, STR, ERA, SIDE, OWNR, FORC and UNIx only the last copy counts.",
  "The name in the map list is \"CHK D01 last copy counts\" (anything starting WRONG names the copy that won). Tileset: Jungle, not Badlands. In the lobby: Player 1 is Terran, Player 2 a computer, the forces are \"Right 1\" and \"Right 2\". In the game your Marine has 200 hit points.",
  () => {
    const s = base("D01", "last copy counts");
    const wrongName = addString(s, "WRONG: the first SPRP won");
    const f1 = addString(s, "Right 1"), f2 = addString(s, "Right 2"), wf = addString(s, "WRONG: first FORC");
    s.forces.nameIndex = [f1, f2, 0, 0];
    s.unitSettings = cloneUnitSettings(s.unitSettings);
    marineSettings(s, 200);
    markDirty(s, "FORC", "UNIx");
    const list = sectionsOf(s);
    const decoy = base("D01", "decoy");
    decoy.strings.strings = decoy.strings.strings.map((t) => (t === null ? null : "WRONG: the first STR won"));
    markDirty(decoy, "STR ");
    decoy.forces.nameIndex = [wf, wf, 0, 0];
    decoy.playerRaces[0] = PlayerRace.Zerg;
    decoy.playerTypes[1] = PlayerType.Human;
    decoy.era = 0; // Badlands
    decoy.unitSettings = cloneUnitSettings(decoy.unitSettings);
    marineSettings(decoy, 10);
    markDirty(decoy, "FORC", "SIDE", "OWNR", "ERA ", "UNIx");
    const first = sectionsOf(decoy);
    const firstCopies = [
      { name: "STR ", data: find(first, "STR ").data },
      { name: "SPRP", data: u16s(wrongName, 2) },
      { name: "ERA ", data: find(first, "ERA ").data },
      { name: "SIDE", data: find(first, "SIDE").data },
      { name: "OWNR", data: find(first, "OWNR").data },
      { name: "FORC", data: find(first, "FORC").data },
      { name: "UNIx", data: find(first, "UNIx").data },
    ];
    return [...firstCopies, ...list];
  });
probe("D02", "copies written over", "ums",
  "MTXM, MASK and MRGN: each copy is written over the start of the same space, so a short second copy replaces only the start.",
  "The top half of the map is dirt and the bottom half jungle (MTXM). The top half starts explored, the bottom black (MASK). A Marine appears in the top-left corner and a Firebat near your start at the bottom left (MRGN: location 1 moved by the short copy, location 2 kept from the first).",
  () => {
    const s = base("D02", "copies written over");
    setLocation(s, 0, "Probe A", 50, 44, 54, 48);
    setLocation(s, 1, "Probe B", 16, 50, 20, 54);
    setTriggers(s, say("D02", "loaded (Use Map Settings)") +
      'Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\tCreate Unit("Player 1", "Terran Marine", 1, "Probe A");\n\tCreate Unit("Player 1", "Terran Firebat", 1, "Probe B");\n}\n');
    const list = sectionsOf(s);
    const half = W * H; // bytes in half the MTXM
    const dirt = flat(TERRAIN.dirt).tiles;
    const second = [
      { name: "MTXM", data: new Uint8Array(dirt.buffer, 0, half).slice() },
      { name: "MASK", data: new Uint8Array((W * H) / 2) },
      { name: "MRGN", data: locationBytes(4, 4, 8, 8, s.locations[0].nameIndex) },
    ];
    return [...list, ...second];
  });
probe("D03", "every copy counts", "ums",
  "UNIT, TRIG and MBRF: the records of every copy count, in file order.",
  "The briefing shows two lines, first then second. In the game you have a Marine, a Firebat and a Medic, and the two trigger texts appear in the order first, second.",
  () => {
    const s = base("D03", "every copy counts");
    s.units.push(unit(UNIT.firebat, 0, 16, 50), unit(UNIT.medic, 0, 17, 50));
    setTriggers(s, say("D03", "trigger from the first TRIG") +
      'Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\tWait(1000);\n\tDisplay Text Message(Always Display, "D03: trigger from the second TRIG");\n}\n');
    const brief = (which) => `Trigger("Player 1"){\nConditions:\n\tMission Briefing();\n\nActions:\n\tText Message("D03: briefing from the ${which} MBRF", 3000);\n\tWait(3000);\n}\n`;
    setTriggers(s, brief("first") + brief("second"), true);
    // One scenario's records, cut in two: the first copy keeps the start, the second gets the rest.
    const cut = { UNIT: 3 * 36, TRIG: 2400, MBRF: 2400 };
    const list = sectionsOf(s).map((x) => (x.name in cut ? { ...x, data: x.data.slice(0, cut[x.name]) } : x));
    const whole = sectionsOf(s);
    return [...list, ...Object.keys(cut).map((n) => ({ name: n, data: find(whole, n).data.slice(cut[n]) }))];
  });

// E — the container.
function odd(id, title, change) {
  return () => change(sectionsOf(base(id, title)));
}
probe("E01", "container tricks", "both",
  "The game reads sections in any order, skips unknown and non-text names, reads only what it needs of a longer section, drops a partial record, and ignores bytes after the last section.",
  "Loads both ways and plays like A00. If it does not, play E02–E06 to find which trick it is.",
  odd("E01", "container tricks", (list) => {
    const l = list.map((s) => (s.name === "SIDE" ? { ...s, data: concat(s.data, latin1("JUNKJUNK")) } : s.name === "UNIT" ? { ...s, data: concat(s.data, new Uint8Array(10).fill(0xee)) } : s));
    return [...l.reverse(), { name: "JUNK", data: latin1("nothing to see") }, { name: "ÿ\u0000\u0001\u0002", data: new Uint8Array(6) }];
  }));
probe("E02", "reversed order", "both", "Sections may come in any order.", "Loads both ways.", odd("E02", "reversed order", (l) => l.reverse()));
probe("E03", "unknown names", "both", "A name the game does not know, or one that is not text, is skipped.", "Loads both ways.",
  odd("E03", "unknown names", (l) => [{ name: "JUNK", data: latin1("nothing to see") }, ...l, { name: "ÿ\u0000\u0001\u0002", data: new Uint8Array(6) }]));
probe("E04", "longer sections", "both", "A section with more bytes than the game reads: it reads what it needs and ignores the rest.",
  "Loads both ways; Player 1 is still Terran, the map is still called \"CHK E04 longer sections\".",
  odd("E04", "longer sections", (l) => l.map((s) => (["SIDE", "SPRP", "DIM ", "ERA "].includes(s.name) ? { ...s, data: concat(s.data, latin1("JUNKJUNK")) } : s))));
probe("E05", "partial record", "ums", "A record section that ends in part of a record: the whole records are read.",
  "Loads; your Marine is there.",
  odd("E05", "partial record", (l) => l.map((s) => (s.name === "UNIT" ? { ...s, data: concat(s.data, new Uint8Array(10).fill(0xee)) } : s))));
probe("E06", "bytes after the end", "both", "Bytes after the last section are ignored.", "Loads both ways.",
  () => ({ list: sectionsOf(base("E06", "bytes after the end")), trailing: latin1("\u0001\u0002\u0003\u0004\u0005") }));
probe("E07", "length past the end", "ums", "A length that runs past the end of the file: the game reads the bytes that are there.",
  "Loads; your Marine and both start locations are there (UNIT is the last section and claims 360 bytes more than the file has).",
  odd("E07", "length past the end", (l) => { const u = find(l, "UNIT"); return [...drop(l, "UNIT"), { ...u, size: u.data.length + 360 }]; }));
probe("E08", "negative length", "list",
  "A negative length makes the game move back by that much and read on from there.",
  "The map list shows \"CHK E08 found by jumping back\". \"WRONG: jump not followed\" means the game did not go back; if the map is refused, note that.",
  () => {
    const s = base("E08", "x");
    const hidden = addString(s, "CHK E08 found by jumping back");
    const wrong = addString(s, "WRONG: jump not followed");
    const list = sectionsOf(s).map((x) => (x.name === "SPRP" ? { ...x, data: u16s(wrong, 2) } : x));
    // JNK1's data holds a whole SPRP and a header that skips JNK2 on the way out; JNK2 jumps back into JNK1's data.
    const inner = concat(header("SPRP", 4), u16s(hidden, 2), header("JNK3", 8));
    const trick = concat(header("JNK1", inner.length), inner, header("JNK2", -(inner.length + 8)));
    const at = list.findIndex((x) => x.name === "SPRP") + 1;
    return [...list.slice(0, at), { raw: trick }, ...list.slice(at)];
  });
probe("E09", "one short MTXM", "ums", "A short copy is written over zeros: the rest of the terrain stays zero (tile 0).",
  "The top half is jungle; what does the bottom half look like (black, or some tile)? Both start locations are in the top half.",
  () => { const l = sectionsOf(base("E09", "one short MTXM", { p1: [12, 12], p2: [52, 12] })); const m = find(l, "MTXM"); return l.map((x) => (x === m ? { ...m, data: m.data.slice(0, W * H) } : x)); });

// F — values.
function marineSettings(scn, hp) {
  const u = scn.unitSettings;
  u.useDefault[UNIT.marine] = 0;
  u.hitPoints[UNIT.marine] = hp * 256;
  u.buildTime[UNIT.marine] = 360;
  u.mineralCost[UNIT.marine] = 50;
  u.weaponDamage[0] = 6; // Gauss Rifle
  u.weaponBonus[0] = 1;
}
probe("F01", "ERA high bits", "list", "Only the low three bits of ERA pick the tileset.",
  "ERA is 0xFFFC; the map list shows Jungle (4). Anything else, note which.",
  () => sectionsOf(base("F01", "ERA high bits")).map((s) => (s.name === "ERA " ? { ...s, data: u16s(0xfffc) } : s)));
probe("F02", "IOWN differs", "both", "The game reads OWNR; IOWN is StarEdit's copy.",
  "In the lobby, Player 2 is a computer and slot 3 is not offered (as OWNR says). IOWN says slot 2 is human and slot 3 a computer.",
  () => { const s = base("F02", "IOWN differs"); s.editorPlayerTypes[1] = PlayerType.Human; s.editorPlayerTypes[2] = PlayerType.Computer; markDirty(s, "IOWN"); return sectionsOf(s); });
probe("F03", "VCOD seed changed", "list", "The game checks VCOD and refuses the map when the check fails.",
  "Is it refused? (One bit of the first seed is flipped.)",
  () => sectionsOf(base("F03", "VCOD seed changed")).map((s) => (s.name === "VCOD" ? { ...s, data: Uint8Array.from(s.data, (b, i) => (i === 0 ? b ^ 1 : b)) } : s)));
probe("F04", "VCOD operation changed", "list", "The game checks VCOD and refuses the map when the check fails.",
  "Is it refused? (The first operation byte is changed.)",
  () => sectionsOf(base("F04", "VCOD operation changed")).map((s) => (s.name === "VCOD" ? { ...s, data: Uint8Array.from(s.data, (b, i) => (i === 1024 ? (b + 1) % 8 : b)) } : s)));
probe("F05", "text encodings", "list",
  "Remastered reads each string as UTF-8 when its bytes are valid UTF-8, else as Korean when they are valid Korean, else as Windows-1252.",
  "Name: \"CHK F05 UTF-8: é ü ß 한글\". Description: \"Latin-1: café naïve\" (read as Windows-1252). Each string is read on its own, so the description does not spoil the name.",
  () => {
    const s = base("F05", "x");
    const list = sectionsOf(s);
    const utf8 = new TextEncoder().encode("CHK F05 UTF-8: é ü ß 한글");
    const latin = latin1("Latin-1: café naïve");
    const table = strBytes([utf8, latin, latin1("Force 1"), latin1("Force 2"), latin1("Force 3"), latin1("Force 4"), latin1("Anywhere"),
      ...s.strings.strings.slice(8).map((t) => latin1(t ?? ""))]);
    return list.map((x) => (x.name === "STR " ? { ...x, data: table } : x));
  });
probe("F06", "STR and STRx (206)", "list", "Remastered reads STRx where a map has it.",
  "The map list shows \"CHK F06 STRx read\", not \"WRONG: STR read\".",
  () => {
    const x = base("F06", "STRx read"); setMapVersion(x, "remastered"); x.strings.strings[1] = "CHK F06 STRx read"; markDirty(x, "STRx");
    const o = base("F06", "x"); o.strings.strings[1] = "WRONG: STR read"; markDirty(o, "STR ");
    const list = sectionsOf(x);
    const at = list.findIndex((s) => s.name === "STRx");
    return [...list.slice(0, at), { name: "STR ", data: dataOf(o, "STR ") }, ...list.slice(at)];
  });
probe("F07", "STRx only (206)", "both", "A map with STRx does not need STR.", "Loads both ways; the name reads \"CHK F07 STRx only (206)\".",
  () => { const x = base("F07", "STRx only (206)"); setMapVersion(x, "remastered"); return drop(sectionsOf(x), "STR "); });
probe("F08", "STR and STRx (205)", "list", "Only Remastered reads STRx. Does it need VER 206 to?",
  "Which name shows: \"CHK F08 STRx read\" or \"CHK F08 STR read\"?",
  () => {
    const x = base("F08", "x"); setMapVersion(x, "remastered"); x.strings.strings[1] = "CHK F08 STRx read"; markDirty(x, "STRx");
    const o = base("F08", "x"); o.strings.strings[1] = "CHK F08 STR read"; markDirty(o, "STR ");
    const list = sectionsOf(o);
    const at = list.findIndex((s) => s.name === "STR ") + 1;
    return [...list.slice(0, at), { name: "STRx", data: dataOf(x, "STRx") }, ...list.slice(at)];
  });
function colours(id, version) {
  return () => {
    const s = base(id, `CRGB (${version === "remastered" ? "206" : "205"})`);
    if (version === "remastered") setMapVersion(s, "remastered");
    s.playerColors[1] = 6; // White
    s.playerRgb = { rgb: Array.from({ length: 8 }, (_, i) => (i === 0 ? [255, 0, 255] : [0, 0, 0])), mode: Array.from({ length: 8 }, (_, i) => (i === 0 ? ColorMode.Custom : ColorMode.Palette)) };
    markDirty(s, "COLR", "CRGB");
    return sectionsOf(s);
  };
}
probe("F09", "CRGB (206)", "ums", "CRGB: a Custom mode colour replaces COLR; a Palette slot keeps its COLR colour whatever its third byte says (0 here).",
  "Player 1's units are magenta (Custom 255,0,255). Player 2's are white (COLR), not red.", colours("F09", "remastered"));
probe("F10", "CRGB (205)", "ums", "The same in a VER 205 file: Remastered reads CRGB in every revision.",
  "Player 1 magenta (CRGB read) or red? Player 2 white?", colours("F10", "broodwar"));
probe("F11", "MASK bits", "ums", "MASK: bit 0 is Player 1; a set bit means the tile starts unexplored.",
  "The left half starts explored for you (you see the ground in grey fog), the right half black.",
  () => { const s = base("F11", "MASK bits"); for (let y = 0; y < H; y++) for (let x = 0; x < W / 2; x++) s.mask[y * W + x] = 0xfe; markDirty(s, "MASK"); return sectionsOf(s); });
probe("F12", "unit settings", "ums",
  "UNIx: a unit's values count only while its use-default byte is 0.",
  "Your Marine is called \"Probe Marine\" and has 200 hit points. The Firebat has its usual 50, although the map stores 999 for it with use-default set.",
  () => {
    const s = base("F12", "unit settings");
    s.unitSettings = cloneUnitSettings(s.unitSettings);
    marineSettings(s, 200);
    s.unitSettings.nameIndex[UNIT.marine] = addString(s, "Probe Marine");
    s.unitSettings.hitPoints[UNIT.firebat] = 999 * 256;
    s.units.push(unit(UNIT.firebat, 0, 16, 50));
    markDirty(s, "UNIx", "UNIT");
    return sectionsOf(s);
  });
probe("F13", "hybrid settings", "ums", "A hybrid file (VER 63): Brood War reads UNIx, the original game UNIS.",
  "As a Brood War game your Marine has 150 hit points (UNIx); as an original StarCraft game, if offered, 20 (UNIS).",
  () => {
    const bw = base("F13", "hybrid settings"); revision(bw, "hybrid");
    bw.unitSettings = cloneUnitSettings(bw.unitSettings); marineSettings(bw, 150); markDirty(bw, "UNIx", "UNIS");
    const old = base("F13", "x"); revision(old, "hybrid");
    old.unitSettings = cloneUnitSettings(old.unitSettings); marineSettings(old, 20); markDirty(old, "UNIS");
    return sectionsOf(bw).map((x) => (x.name === "UNIS" ? { ...x, data: dataOf(old, "UNIS") } : x));
  }, "scm");
probe("F14", "unit fields", "ums",
  "UNIT: each value counts only when its bit is set in the fields-set or special-states word.",
  "Carrier: half hit points, full shields, 4 Interceptors. Ghost: cloaked, 10% energy. Marine with 25% stored but the bit clear: full hit points. Mineral field: 1234 minerals.",
  () => {
    const s = base("F14", "unit fields");
    s.units.push(
      unit(UNIT.carrier, 0, 18, 46, { validStates: UnitUsed.Owner | UnitUsed.HitPoints | UnitUsed.Shields | UnitUsed.Hangar, hitPointsPercent: 50, hangarUnits: 4 }),
      unit(UNIT.ghost, 0, 20, 50, { validProperties: UnitState.Cloaked, stateFlags: UnitState.Cloaked, validStates: UnitUsed.Owner | UnitUsed.Energy | UnitUsed.State, energyPercent: 10 }),
      unit(UNIT.marine, 0, 14, 48, { validStates: UnitUsed.Owner, hitPointsPercent: 25 }),
      unit(UNIT.mineral, 11, 8, 46, { validStates: UnitUsed.Resources, resourceAmount: 1234 }),
    );
    markDirty(s, "UNIT");
    return sectionsOf(s);
  });
probe("F15", "unit sprites", "ums",
  "THG2: a record without the pure-sprite flag makes the game create a unit of that type; 0x8000 starts it disabled.",
  "Two extra Marines near your start: one you can command, one disabled (greyed out, cannot be ordered). Note if neither appears, or they are sprites only.",
  () => {
    const s = base("F15", "unit sprites");
    s.sprites = [
      { spriteId: UNIT.marine, x: px(16), y: px(48), owner: 0, unused: 0, flags: 0 },
      { spriteId: UNIT.marine, x: px(18), y: px(48), owner: 0, unused: 0, flags: SpriteFlag.Disabled },
    ];
    markDirty(s, "THG2");
    return sectionsOf(s);
  });

const SUPPLY_DEPOT = 109;
probe("F16", "CRGB and COLR disagree", "ums",
  "When CRGB (Palette, colour in the third byte) and COLR give a player different colours, which one does Remastered show?",
  "Three Supply Depots by your start, Players 1, 2 and 3 from left to right. Player 1's depot: blue (CRGB wins), teal (COLR wins) or pink (COLR re-shuffles the lobby colours: Player 1 takes Player 3's)? Player 2 should be orange and Player 3 pink either way.",
  () => {
    const s = base("F16", "CRGB and COLR");
    setMapVersion(s, "remastered");
    s.playerTypes[2] = PlayerType.Computer; s.editorPlayerTypes[2] = PlayerType.Computer; s.playerRaces[2] = PlayerRace.Protoss;
    s.units.push(unit(UNIT.start, 2, 52, 52), unit(SUPPLY_DEPOT, 0, 10, 46), unit(SUPPLY_DEPOT, 1, 14, 46), unit(SUPPLY_DEPOT, 2, 18, 46));
    s.playerColors = [2, 1, 2, 3, 4, 5, 6, 7]; // Player 1 Teal in COLR; 2 and 3 on their own slots, which COLR leaves alone
    s.playerRgb = { rgb: Array.from({ length: 8 }, (_, i) => [0, 0, [1, 4, 16][i] ?? i]), mode: Array.from({ length: 8 }, () => ColorMode.Palette) };
    markDirty(s, "OWNR", "IOWN", "SIDE", "UNIT", "COLR", "CRGB");
    return sectionsOf(s);
  });

/* ── Write ───────────────────────────────────────────── */

mkdirSync(out, { recursive: true });
const lines = [
  "CHK format reference: probe maps",
  "",
  "Each map changes one thing in the A00 baseline. For each: find it in the map list,",
  "look where it says, and write down what happens. 'both' means host it once as Melee",
  "and once as Use Map Settings (single player, against the computer); 'list' means the",
  "map list and lobby are enough; 'ums' means Use Map Settings.",
  "",
];
for (const p of probes) {
  const built = p.build();
  const { list, trailing } = Array.isArray(built) ? { list: built } : built;
  const file = `CHK ${p.id} ${p.title.replace(/[^\w ().-]/g, "")}.${p.ext}`;
  writeFileSync(join(out, file), await saveMap(writeChk(list, trailing), { compress: "pkware" }));
  lines.push(`${p.id}  ${file}   [${p.play}]`, `     Reference: ${p.claim}`, `     Look:      ${p.look}`, "     Result:    ", "");
}
writeFileSync(join(out, "CHECKLIST.txt"), lines.join("\r\n"));
console.log(`${probes.length} maps and CHECKLIST.txt in ${out}`);
