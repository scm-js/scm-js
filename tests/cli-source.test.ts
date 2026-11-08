/**
 * `scmjs map unpack --text` / `map pack` (cli/src/source.ts): the scenario as a folder of text and back. Every map the
 * suites know is unpacked and packed again and must come back byte for byte, its text the same on a second unpack;
 * edits to the text change what they say and nothing else. Blizzard's maps (fixtures/maps) run where present.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes, readArchive, writeArchiveBytes } from "../src/editor/mapFile";
import { parseChk, serializeChk } from "../src/formats/chk/reader";
import { MODELLED_SECTIONS } from "../src/formats/chk/scenario";
import { MANIFEST_FILE, packMap, unpackMap, type ArchiveManifest } from "../cli/src/archive";
import { diffMaps, type MapDiff } from "../cli/src/diff";
import { scenarioFromText, scenarioToText, SECTIONS_FILE, stableJson, TEXT_FOLDER, type SectionsList } from "../cli/src/source";
import { fixtureMapFiles, testMap, testMapFiles, type MapFile } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-source-"));
const ums = () => new Uint8Array(readFileSync(testMap("ums.scx")));

/** Every file under a folder, by path relative to it, with its bytes. */
function filesUnder(dir: string, under = dir, out = new Map<string, Buffer>()): Map<string, Buffer> {
  for (const e of readdirSync(under, { withFileTypes: true })) {
    const path = join(under, e.name);
    if (e.isDirectory()) filesUnder(dir, path, out);
    else out.set(relative(dir, path).replace(/\\/g, "/"), readFileSync(path));
  }
  return out;
}

const read = (dir: string, file: string) => readFileSync(join(dir, TEXT_FOLDER, file), "utf8");
const write = (dir: string, file: string, text: string) => writeFileSync(join(dir, TEXT_FOLDER, file), text);
const sectionsOf = (dir: string) => JSON.parse(read(dir, SECTIONS_FILE)) as SectionsList;

/** Unpack as text, pack to a file beside, and open both. */
async function roundTrip(bytes: Uint8Array, name: string) {
  const root = tmp();
  const dir = join(root, "map");
  const unpacked = await unpackMap(bytes, name, dir, { text: true });
  const packed = await packMap(dir, { out: join(root, `back${extname(name) || ".scx"}`) });
  const back = new Uint8Array(readFileSync(packed.path));
  return { root, dir, unpacked, packed, back };
}

async function diff(a: Uint8Array, b: Uint8Array): Promise<MapDiff> {
  return diffMaps({ name: "a", doc: await openMapBytes(a, "a.scx") }, { name: "b", doc: await openMapBytes(b, "b.scx") });
}

/** The sections whose bytes differ between two scenarios, by name. */
function changedSections(a: Uint8Array, b: Uint8Array): string[] {
  const [x, y] = [parseChk(a).sections, parseChk(b).sections];
  const names = new Set([...x, ...y].map((s) => s.name));
  const bytes = (list: typeof x, name: string) => serializeChk({ sections: list.filter((s) => s.name === name) });
  return [...names].filter((n) => Buffer.compare(Buffer.from(bytes(x, n)), Buffer.from(bytes(y, n))) !== 0).map((n) => n.trim()).sort();
}

/** The whole round trip, as every map must pass it. */
async function checkMap(m: MapFile) {
  const bytes = new Uint8Array(readFileSync(m.path));
  const { dir, unpacked, back, root } = await roundTrip(bytes, m.name);
  const [a, b] = [await readArchive(bytes), await readArchive(back)];
  // The scenario, byte for byte, and its sections parse the same.
  expect(Buffer.compare(Buffer.from(b.chk), Buffer.from(a.chk))).toBe(0);
  expect(parseChk(b.chk).sections.map((s) => [s.name, s.declaredSize, Buffer.from(s.data).toString("hex")]))
    .toEqual(parseChk(a.chk).sections.map((s) => [s.name, s.declaredSize, Buffer.from(s.data).toString("hex")]));
  // The archive's other members come along.
  expect([...b.extras.keys()].sort()).toEqual([...a.extras.keys()].sort());
  expect((await diff(bytes, back)).same).toBe(true);
  // A section kept as bytes is its bytes.
  const list = sectionsOf(dir);
  const original = parseChk(a.chk).sections;
  list.sections.forEach((e, i) => {
    expect(e.name).toBe(original[i].name);
    if (!e.text) expect(Buffer.compare(readFileSync(join(dir, TEXT_FOLDER, e.bytes!)), Buffer.from(original[i].data))).toBe(0);
  });
  // Only what the editor does not model is kept as bytes alone.
  expect(unpacked.text!.bytes.filter((s) => MODELLED_SECTIONS.has(s.name))).toEqual([]);
  // The same text again from the packed map.
  const again = join(root, "again");
  await unpackMap(back, m.name, again, { text: true });
  const [first, second] = [filesUnder(join(dir, TEXT_FOLDER)), filesUnder(join(again, TEXT_FOLDER))];
  expect([...second.keys()].sort()).toEqual([...first.keys()].sort());
  for (const [file, data] of first) expect(Buffer.compare(second.get(file)!, data), file).toBe(0);
}

describe("scmjs map unpack --text / pack: every committed map", () => {
  for (const m of testMapFiles()) it(`round-trips ${m.name}`, () => checkMap(m));
});

const fixtures = fixtureMapFiles();
describe.skipIf(!fixtures.length)("scmjs map unpack --text / pack: Blizzard's maps", () => {
  for (const m of fixtures) it(`round-trips ${m.name}`, () => checkMap(m));
});

describe("scmjs map unpack --text: the folder", () => {
  it("writes the scenario as text, names the folder in archive.json, and leaves staredit/scenario.chk out", async () => {
    const { dir, unpacked, packed } = await roundTrip(ums(), "ums.scx");
    const manifest = JSON.parse(readFileSync(join(dir, MANIFEST_FILE), "utf8")) as ArchiveManifest;
    expect(manifest.version).toBe(2);
    expect(manifest.scenario.text).toBe(TEXT_FOLDER);
    expect(existsSync(join(dir, "staredit", "scenario.chk"))).toBe(false);
    for (const f of ["map.json", "strings.txt", "terrain.txt", "units.tsv", "locations.tsv", "triggers.txt", "settings/units.tsv", SECTIONS_FILE]) {
      expect(existsSync(join(dir, TEXT_FOLDER, f)), f).toBe(true);
    }
    expect(unpacked.text!.text).toContain("UNIT");
    expect(unpacked.text!.bytes.map((b) => b.name)).toEqual(["IVE2", "VCOD"]);
    expect(packed.fromText).toBe(true);
    const map = JSON.parse(read(dir, "map.json"));
    expect(map).toMatchObject({ type: "RAWB", version: 205, width: 64, height: 64, tileset: "badlands" });
    expect(map.players[0]).toMatchObject({ slot: 1, type: "Human", force: 1 });
    expect(read(dir, "units.tsv").split("\n")[0]).toBe("serial\tx\ty\tunitId\trelationType\tvalidProperties\tvalidStates\towner\thitPointsPercent\tshieldPercent\tenergyPercent\tresourceAmount\thangarUnits\tstateFlags\tunused\trelatedSerial\tname");
    // A grid row per line.
    expect(read(dir, "terrain.txt").trimEnd().split("\n").filter((l) => !l.startsWith("#"))).toHaveLength(64);
  });

  it("packs a folder with no archive.json from its text", async () => {
    const { dir, root } = await roundTrip(ums(), "ums.scx");
    rmSync(join(dir, MANIFEST_FILE));
    const p = await packMap(dir, { out: join(root, "plain.scx") });
    expect(p.fromText).toBe(true);
    expect((await readArchive(new Uint8Array(readFileSync(p.path)))).chk).toEqual((await readArchive(ums())).chk);
  });

  it("keeps one form of the scenario in a folder unpacked again the other way", async () => {
    const dir = join(tmp(), "ums");
    await unpackMap(ums(), "ums.scx", dir);
    await unpackMap(ums(), "ums.scx", dir, { text: true });
    expect(existsSync(join(dir, "staredit", "scenario.chk"))).toBe(false);
    await unpackMap(ums(), "ums.scx", dir);
    expect(existsSync(join(dir, TEXT_FOLDER))).toBe(false);
    expect(existsSync(join(dir, "staredit", "scenario.chk"))).toBe(true);
  });

  it("refuses --text for a map with a member in the scenario folder's place", async () => {
    const odd = await writeArchiveBytes((await readArchive(ums())).chk, { extras: new Map([["scenario\\notes.txt", new Uint8Array([1])]]) });
    await expect(unpackMap(odd, "odd.scx", join(tmp(), "odd"), { text: true })).rejects.toThrow(/in the folder --text writes the scenario to/);
  });

  it("keeps a built map's members and writes its built scenario", async () => {
    const built = await writeArchiveBytes((await readArchive(ums())).chk, { extras: new Map([["scmjs\\source.chk", new Uint8Array([1, 2, 3])], ["scmjs\\build.json", new TextEncoder().encode("{}")]]), compression: "pkware" });
    const { dir, back } = await roundTrip(built, "built.scx");
    expect(readFileSync(join(dir, "scmjs", "source.chk"))).toEqual(Buffer.from([1, 2, 3]));
    expect((await readArchive(back)).extras.get("scmjs\\source.chk")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("formats JSON a line per value where it helps a diff", () => {
    expect(stableJson({ a: 1, b: [1, 2], c: [{ x: 1, y: [2, 3] }], d: { e: "f" }, g: [] })).toBe(
      '{\n  "a": 1,\n  "b": [1, 2],\n  "c": [\n    { "x": 1, "y": [2, 3] }\n  ],\n  "d": {\n    "e": "f"\n  },\n  "g": []\n}');
  });
});

describe("scmjs map unpack --text: a scenario only bytes can hold", () => {
  it("keeps repeated, unknown and cut-off sections and trailing bytes as they are", async () => {
    // ums's scenario with a one-byte STR decoy after the real table, an odd section name, and bytes past the last section.
    const chk = parseChk((await readArchive(ums())).chk);
    const decoy = { name: "STR ", offset: -1, declaredSize: 1, data: new Uint8Array([7]) };
    const odd = { name: "\u0001x%:", offset: -1, declaredSize: 3, data: new Uint8Array([1, 2, 3]) };
    const bytes = serializeChk({ sections: [...chk.sections, decoy, odd], trailing: new Uint8Array([0xde, 0xad, 0xbe]) });
    const t = scenarioToText(bytes);
    expect(t.report.bytes).toEqual(expect.arrayContaining([{ name: "STR ", why: "2 copies" }, { name: "\u0001x%:", why: "not modelled" }]));
    expect([...t.files.keys()]).toEqual(expect.arrayContaining(["sections/STR.bin", "sections/STR.2.bin", "sections/%01x%25%3A.bin", "sections/trailing.bin"]));
    // strings.txt is gone with the table: the triggers' text then refers to strings the bytes hold.
    expect(t.files.has("strings.txt")).toBe(false);
    const source = { text: (p: string) => { const v = t.files.get(p); return typeof v === "string" ? v : null; }, bytes: (p: string) => { const v = t.files.get(p); return v instanceof Uint8Array ? v : null; } };
    expect(Buffer.compare(Buffer.from(scenarioFromText(source)), Buffer.from(bytes))).toBe(0);

    // A last section whose length runs past the end of the file.
    const cut = new Uint8Array([...serializeChk({ sections: chk.sections }), ...new TextEncoder().encode("JUNK"), 0x00, 0x10, 0, 0, 1, 2]);
    const c = scenarioToText(cut);
    expect(c.report.bytes).toContainEqual({ name: "JUNK", why: "not modelled" });
    const list = JSON.parse(c.files.get(SECTIONS_FILE) as string) as SectionsList;
    expect(list.sections.at(-1)).toMatchObject({ name: "JUNK", size: 0x1000 });
    const cs = { text: (p: string) => { const v = c.files.get(p); return typeof v === "string" ? v : null; }, bytes: (p: string) => { const v = c.files.get(p); return v instanceof Uint8Array ? v : null; } };
    expect(Buffer.compare(Buffer.from(scenarioFromText(cs)), Buffer.from(cut))).toBe(0);
  });
});

describe("scmjs map pack: the text decides", () => {
  it("moves a unit: one line of units.tsv, the UNIT section and nothing else", async () => {
    const { dir, root } = await roundTrip(ums(), "ums.scx");
    const lines = read(dir, "units.tsv").split("\n");
    const cells = lines[1].split("\t");
    cells[1] = String(Number(cells[1]) + 64);
    lines[1] = cells.join("\t");
    write(dir, "units.tsv", lines.join("\n"));
    const p = await packMap(dir, { out: join(root, "moved.scx") });
    const back = new Uint8Array(readFileSync(p.path));
    const d = await diff(ums(), back);
    expect(d.units.map((u) => u.change).sort()).toEqual(["added", "removed"]);
    expect(changedSections((await readArchive(ums())).chk, (await readArchive(back)).chk)).toEqual(["UNIT"]);
    // Unpacked again, the text is the edited text.
    const again = join(root, "again");
    await unpackMap(back, "moved.scx", again, { text: true });
    expect(read(again, "units.tsv")).toBe(lines.join("\n"));
  });

  it("changes a tile, a string, a player, a location, a setting and a trigger, each in its own section", async () => {
    const { dir, root } = await roundTrip(ums(), "ums.scx");
    const original = (await readArchive(ums())).chk;
    const pack = async (name: string) => (await readArchive(new Uint8Array(readFileSync((await packMap(dir, { out: join(root, name) })).path)))).chk;

    const terrain = read(dir, "terrain.txt").split("\n");
    terrain[1] = terrain[1].replace(/^[0-9a-f]{4}/, "0010");
    write(dir, "terrain.txt", terrain.join("\n"));
    // The ground under doodads is where TILE differs from MTXM, so a tile changes both, as the editor's brush does.
    expect(changedSections(original, await pack("t.scx"))).toEqual(["MTXM", "TILE"]);

    write(dir, "strings.txt", read(dir, "strings.txt").replace(/^1\t.*$/m, "1\tRenamed"));
    const named = await pack("s.scx");
    expect(changedSections(original, named)).toEqual(["MTXM", "STR", "TILE"]);
    expect((await openMapBytes(named, "n.chk")).scenario.strings.strings[1]).toBe("Renamed");

    const map = JSON.parse(read(dir, "map.json"));
    map.players[2].type = "Computer";
    write(dir, "map.json", JSON.stringify(map));
    expect(changedSections(original, await pack("p.scx"))).toEqual(["MTXM", "OWNR", "STR", "TILE"]);

    write(dir, "locations.tsv", read(dir, "locations.tsv").replace(/^(1\t)(\d+)/m, (_, a, left) => `${a}${Number(left) + 32}`));
    write(dir, "settings/units.tsv", read(dir, "settings/units.tsv").replace(/^1\t1\t0\t/m, "1\t0\t25600\t"));
    const settled = await pack("l.scx");
    expect(changedSections(original, settled)).toEqual(["MRGN", "MTXM", "OWNR", "STR", "TILE", "UNIx"]);
    const doc = await openMapBytes(settled, "l.chk");
    expect(doc.scenario.unitSettings!.hitPoints[1]).toBe(25600);
    expect(doc.scenario.unitSettings!.useDefault[1]).toBe(0);

    const triggers = read(dir, "triggers.txt");
    expect(triggers).toMatch(/Preserve Trigger\(\);/);
    write(dir, "triggers.txt", triggers.replace("Preserve Trigger();", "Preserve Trigger();\n\tSet Switch(\"Switch 5\", set);"));
    const triggered = await pack("g.scx");
    expect(changedSections(original, triggered)).toEqual(["MRGN", "MTXM", "OWNR", "STR", "TILE", "TRIG", "UNIx"]);
    expect((await diff(ums(), triggered)).triggers.map((t) => t.change).sort()).toEqual(["added", "removed"]);
  });

  it("names the file and line of text that does not read", async () => {
    const { dir } = await roundTrip(ums(), "ums.scx");
    const units = read(dir, "units.tsv");
    write(dir, "units.tsv", units.replace(/\n(\d+)\t(\d+)/, "\n$1\tabc"));
    await expect(packMap(dir)).rejects.toThrow(/scenario\/units\.tsv, line 2: x: "abc" is not a number/);
    write(dir, "units.tsv", units.replace(/\n(\d+)\t(\d+)/, "\n$1\t70000"));
    await expect(packMap(dir)).rejects.toThrow(/line 2: x: 70000 is out of range \(0 to 65535\)/);
    write(dir, "units.tsv", units.replace("serial\tx", "serial\tX"));
    await expect(packMap(dir)).rejects.toThrow(/units\.tsv, line 1: the columns are serial x y/);
    write(dir, "units.tsv", units);

    const terrain = read(dir, "terrain.txt");
    write(dir, "terrain.txt", terrain.trimEnd().split("\n").slice(0, -1).join("\n"));
    await expect(packMap(dir)).rejects.toThrow(/terrain\.txt: 63 rows, the map's size needs 64/);
    write(dir, "terrain.txt", terrain);

    const map = read(dir, "map.json");
    write(dir, "map.json", map.replace('"badlands"', '"moon"'));
    await expect(packMap(dir)).rejects.toThrow(/map\.json: tileset: "moon" is not one of badlands/);
    write(dir, "map.json", map);

    const triggers = read(dir, "triggers.txt");
    write(dir, "triggers.txt", triggers.replace("Preserve Trigger();", "Preserve Trigger(;"));
    await expect(packMap(dir)).rejects.toThrow(/triggers\.txt, line \d+:/);
    write(dir, "triggers.txt", triggers);

    const list = read(dir, SECTIONS_FILE);
    const bin = sectionsOf(dir).sections.find((e) => e.bytes)!.bytes!;
    rmSync(join(dir, TEXT_FOLDER, bin));
    await expect(packMap(dir)).rejects.toThrow(new RegExp(`${bin.replace(".", "\\.")} is listed but not in the folder`));
    write(dir, SECTIONS_FILE, list.replace('"format": 1', '"format": 9'));
    await expect(packMap(dir)).rejects.toThrow(/format 9 is not one this scmjs reads/);
  });

  it("writes a StarEdit string table's layout while the text is unchanged, and the editor's once it is not", async () => {
    // A table with a slot pointing at a shared empty string (StarEdit's way): equal in the model, not in the bytes.
    const chk = parseChk((await readArchive(ums())).chk);
    const str = chk.sections.find((s) => s.name === "STR ")!;
    const view = new DataView(str.data.buffer, str.data.byteOffset, str.data.byteLength);
    const count = view.getUint16(0, true);
    const data = new Uint8Array(str.data.length + 2);
    data.set(str.data.subarray(0, 2 + count * 2));
    new DataView(data.buffer).setUint16(0, count + 1, true);
    // The new last slot points at the 0 byte that ends the first string.
    const firstEnd = str.data.indexOf(0, view.getUint16(2, true));
    for (let i = 1; i <= count; i++) new DataView(data.buffer).setUint16(i * 2, view.getUint16(i * 2, true) + 2, true);
    new DataView(data.buffer).setUint16((count + 1) * 2, firstEnd + 2, true);
    data.set(str.data.subarray(2 + count * 2), 2 + (count + 1) * 2);
    const bytes = serializeChk({ sections: chk.sections.map((s) => (s === str ? { ...s, data, declaredSize: data.length } : s)) });
    const t = scenarioToText(bytes);
    expect(t.report.layout).toEqual(["STR "]);
    const entry = (JSON.parse(t.files.get(SECTIONS_FILE) as string) as SectionsList).sections.find((e) => e.name === "STR ")!;
    expect(entry).toMatchObject({ text: "strings.txt", bytes: "sections/STR.bin" });
    expect(entry.sha1).toMatch(/^[0-9a-f]{40}$/);
    const files = new Map(t.files);
    const source = { text: (p: string) => { const v = files.get(p); return typeof v === "string" ? v : null; }, bytes: (p: string) => { const v = files.get(p); return v instanceof Uint8Array ? v : null; } };
    expect(Buffer.compare(Buffer.from(scenarioFromText(source)), Buffer.from(bytes))).toBe(0);
    files.set("strings.txt", (files.get("strings.txt") as string).replace(/^1\t.*$/m, "1\tRenamed"));
    const edited = scenarioFromText(source);
    expect(changedSections(bytes, edited)).toEqual(["STR"]);
    expect((await openMapBytes(edited, "e.chk")).scenario.strings.strings[1]).toBe("Renamed");
  });

  it("measures: the text is a few times the scenario, and every file is plain text but the kept bytes", async () => {
    const { dir } = await roundTrip(ums(), "ums.scx");
    const all = filesUnder(join(dir, TEXT_FOLDER));
    const kept = [...all.keys()].filter((f) => f.startsWith("sections/"));
    expect(kept.sort()).toEqual(["sections/IVE2.bin", "sections/VCOD.bin"]);
    for (const [f, data] of all) if (!kept.includes(f)) expect(data.includes(0), f).toBe(false);
    const size = [...all.values()].reduce((n, d) => n + d.length, 0);
    expect(size).toBeLessThan(statSync(testMap("ums.scx")).size * 40);
  });
});
