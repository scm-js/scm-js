/**
 * `scmjs map optimize` (cli/src/optimize.ts, relocate.ts): the committed ums.scx with junk added — a string nothing
 * refers to, a sound nothing plays or lists, a sound list entry for a file the map lacks, a stray file — loses exactly
 * that, keeps what the game or the editor's tools need, and opens again with only those removals to tell it apart. A
 * built map keeps its scenario and its source; a member carried as stored is moved and re-keyed and still reads.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openMapBytes, readArchive, writeArchiveBytes, writeMapBytes } from "../src/editor/mapFile";
import { addSound, applySounds, readWavs } from "../src/editor/sounds";
import { internString } from "../src/editor/settings";
import { newAction, newTrigger, readTriggers } from "../src/editor/triggers";
import { packBuiltMap, sha256Hex } from "../src/editor/mapBuild";
import { markDirty, serializeScenario } from "../src/formats/chk/scenario";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { loadMap, saveMap } from "../src/formats/mpq/scm";
import { diffMaps } from "../cli/src/diff";
import { GAME_MEMBERS, keepTest, optimizeMap, printOptimize, sizeLine, usesMemory } from "../cli/src/optimize";
import { fileKey, packStored, relocate } from "../src/formats/mpq/stored";
import { visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const ums = () => new Uint8Array(readFileSync(testMap("ums.scx")));
const TONE = "staredit\\wav\\tone.wav";

/** ums.scx with junk: a stray string, an unplayed and unlisted sound, a listed-only sound, an entry for a missing file, a stray file, and members to keep. */
async function junkMap(): Promise<{ bytes: Uint8Array; stray: number }> {
  const doc = await openMapBytes(ums(), "ums.scx");
  const tone = doc.extras.get(TONE)!;
  const stray = internString(doc.scenario, "A string nothing uses");
  doc.extras.set("staredit\\wav\\junk.wav", tone);
  doc.extras.set("staredit\\wav\\listed.wav", tone);
  doc.extras.set("notes\\readme.txt", new TextEncoder().encode("left here by a tool"));
  doc.extras.set("trigscript\\main.ts", new TextEncoder().encode("// the script\n"));
  doc.extras.set("magenta\\project.json", new TextEncoder().encode("{}"));
  doc.extras.set("blizzard_2.cnd", new TextEncoder().encode("Blizzard Authentication Candidate Scenario\r\n"));
  doc.extras.set("mine\\keep.bin", new Uint8Array([1, 2, 3]));
  const wavs = readWavs(doc.scenario);
  addSound(doc.scenario, wavs, "staredit\\wav\\listed.wav");
  addSound(doc.scenario, wavs, "staredit\\wav\\gone.wav");
  addSound(doc.scenario, wavs, "sound\\Terran\\Marine\\TMaYes00.wav");
  applySounds(doc.scenario, wavs);
  markDirty(doc.scenario, "STR ");
  const bytes = await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, options: { compression: "zlib" } });
  return { bytes, stray };
}

describe("scmjs map optimize", () => {
  it("drops the junk and only the junk, and the map opens with nothing else changed", async () => {
    const { bytes, stray } = await junkMap();
    const r = await optimizeMap(bytes, "junk.scx", { keep: ["mine\\"] });
    expect(r.after).toBeLessThan(r.before);
    expect(r.removed.filter((x) => x.kind !== "string").map((x) => [x.kind, x.name])).toEqual([
      ["sound", "staredit\\wav\\junk.wav"],
      ["member", "notes\\readme.txt"],
      ["entry", "staredit\\wav\\gone.wav"],
    ]);
    // The stray string, and the entry's path once the entry went; the listed sound's path stays.
    const strings = r.removed.filter((x) => x.kind === "string");
    expect(strings.map((x) => x.name)).toContain("A string nothing uses");
    expect(strings.map((x) => x.index)).toContain(stray);
    expect(strings.map((x) => x.name)).toContain("staredit\\wav\\gone.wav");
    expect(strings.map((x) => x.name)).not.toContain("staredit\\wav\\listed.wav");
    expect(r.kept.map((k) => [k.name, k.why])).toEqual(expect.arrayContaining([
      ["trigscript\\main.ts", "TrigScript, Magenta or build file"], ["magenta\\project.json", "TrigScript, Magenta or build file"],
      ["blizzard_2.cnd", "the game opens it"], ["mine\\keep.bin", "--keep"],
    ]));
    expect(r.steps.map((s) => s.key)).toEqual(["sounds", "members", "strings", "sections", "compression"]);
    // The steps add up to the whole.
    expect(r.steps.reduce((t, s) => t + s.saved, 0)).toBe(r.before - r.after);

    const before = await openMapBytes(bytes, "a"), after = await openMapBytes(r.bytes, "b");
    expect([...after.extras.keys()].sort()).toEqual([...before.extras.keys()].filter((n) => !["staredit\\wav\\junk.wav", "notes\\readme.txt"].includes(n)).sort());
    for (const [name, data] of after.extras) expect(data, name).toEqual(before.extras.get(name));
    const d = diffMaps({ name: "a", doc: before }, { name: "b", doc: after });
    expect(d.units).toEqual([]);
    expect(d.triggers).toEqual([]);
    expect(d.locations).toEqual([]);
    expect(d.members.map((m) => [m.change, m.text.replace(/ \(.*\)$/, "")]).sort()).toEqual([["removed", "notes\\readme.txt"], ["removed", "staredit\\wav\\junk.wav"]]);
    expect(d.sections.map((s) => s.name.trim()).sort()).toEqual(["STR", "WAV"]);
    expect(readTriggers(after.scenario)).toEqual(readTriggers(before.scenario));
    // The file list is kept.
    expect((await readArchive(r.bytes)).files).not.toBeNull();
  });

  it("with --strip-editor drops the editor-only sections and the sound only the list named, and says what that costs", async () => {
    const { bytes } = await junkMap();
    const r = await optimizeMap(bytes, "junk.scx", { stripEditor: true });
    expect(r.removed.filter((x) => x.kind === "sound").map((x) => x.name).sort()).toEqual(["staredit\\wav\\junk.wav", "staredit\\wav\\listed.wav"]);
    const sections = r.removed.filter((x) => x.kind === "section").map((x) => x.name);
    expect(sections).toContain("WAV");
    for (const s of sections) expect(["ISOM", "TILE", "DD2", "IVER", "IVE2", "IOWN", "UPUS", "SWNM", "WAV"]).toContain(s);
    expect(r.warnings.join("\n")).toMatch(/no isometric terrain/);
    const after = await openMapBytes(r.bytes, "b");
    expect(after.scenario.chk.sections.map((s) => s.name.trim())).not.toContain("WAV");
    // What plays is still there: the tone a trigger plays.
    expect(after.extras.has(TONE)).toBe(true);
  });

  it("keeps a built map's scenario as built, its source and its script, and it still opens as the source", async () => {
    const source = await openMapBytes(ums(), "ums.scx");
    const sourceChk = serializeScenario(source.scenario);
    const built = (await openMapBytes(ums(), "ums.scx")).scenario;
    internString(built, "A string the build left unused");
    markDirty(built, "STR ");
    const builtChk = serializeScenario(built);
    const extras = new Map(source.extras);
    extras.set("trigscript\\main.ts", new TextEncoder().encode("// program\n"));
    extras.set("stray.txt", new TextEncoder().encode("stray"));
    const bytes = await packBuiltMap({ sourceChk, extras, stored: null, built: builtChk, steps: [{ id: "trigscript/build", label: "TrigScript" }], options: { compression: "zlib", encrypt: false } });
    const r = await optimizeMap(bytes, "built.scx");
    expect(r.built).toBe(true);
    expect(r.steps.find((s) => s.key === "strings")!.skipped).toMatch(/built map/);
    expect(r.removed.map((x) => x.name)).toEqual(["stray.txt"]);
    const out = await readArchive(r.bytes);
    expect(sha256Hex(out.chk)).toBe(sha256Hex(builtChk));
    expect([...out.extras.keys()].sort()).toEqual(["scmjs\\build.json", "scmjs\\source.chk", TONE, "trigscript\\main.ts"].sort());
    const reopened = await openMapBytes(r.bytes, "built.scx");
    expect(reopened.builtBy?.map((b) => b.id)).toEqual(["trigscript/build"]);
  });

  it("leaves the strings of a map whose triggers reach the game's memory (EUD)", async () => {
    const doc = await openMapBytes(ums(), "ums.scx");
    const t = newTrigger();
    const a = newAction(ActionType.SetDeaths);
    a.player = 0x1000;
    t.actions[0] = a;
    doc.scenario.triggers.push(t);
    markDirty(doc.scenario, "TRIG");
    internString(doc.scenario, "payload?");
    markDirty(doc.scenario, "STR ");
    expect(usesMemory(doc.scenario)).toBe(true);
    const r = await optimizeMap(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, options: { compression: "zlib" } }), "eud.scx");
    expect(r.eud).toBe(true);
    expect(r.steps.find((s) => s.key === "strings")!.skipped).toMatch(/EUD/);
    expect(r.removed.filter((x) => x.kind === "string")).toEqual([]);
  });

  it("picks the compression: PKWARE by default, the smaller of the two for a zlib map, or the one asked for", async () => {
    const zlib = await optimizeMap(ums(), "ums.scx");
    expect((await readArchive(zlib.bytes)).origin?.compression).toBe(zlib.compression.to === "zlib" ? "zlib" : "pkware");
    const pk = await optimizeMap(ums(), "ums.scx", { compression: "pkware" });
    expect((await readArchive(pk.bytes)).origin?.compression).toBe("pkware");
    expect(pk.steps.at(-1)!.did).toBe("zlib → PKWARE");
    const melee = await optimizeMap(new Uint8Array(readFileSync(testMap("melee.scx"))), "melee.scx");
    expect(melee.compression.to).toBe("PKWARE");
    const lines = printOptimize(melee).map(visible);
    if (melee.after >= melee.before) expect(lines[0]).toMatch(/cannot write it smaller/);
  });

  it("treats a bare scenario as the scenario alone", async () => {
    const { bytes } = await junkMap();
    const chk = (await readArchive(bytes)).chk;
    const r = await optimizeMap(chk, "junk.chk");
    expect(r.steps.find((s) => s.key === "compression")!.skipped).toMatch(/bare scenario/);
    expect(r.removed.every((x) => x.kind === "string" || x.kind === "entry")).toBe(true);
    expect(r.after).toBeLessThan(r.before);
  });

  it("names the members to keep, and the game's own", () => {
    const keep = keepTest(["mine\\", "one.txt"]);
    expect([keep("MINE\\a.bin"), keep("mine/b"), keep("one.txt"), keep("two.txt"), keep("mined\\x")]).toEqual([true, true, true, false, false]);
    expect(["blizzard_2.cnd", "Ladder_3.cnd", "(attributes)", "(signature)", "staredit\\x.cnd"].map((n) => GAME_MEMBERS.test(n))).toEqual([true, true, true, true, false]);
    expect(visible(sizeLine(2048, 1024))).toBe("2.0 KB → 1.0 KB (−50%)");
  });
});

describe("a member carried as stored, moved", () => {
  it("re-keys an encrypted member whose key depends on its offset, and it reads the same", async () => {
    const tone = (await openMapBytes(ums(), "ums.scx")).extras.get(TONE)!;
    const name = "staredit\\wav\\moved.wav";
    // StarEdit's layout: PKWARE, encrypted with the offset-adjusted key.
    const archive = (await loadMap(await saveMap(new Uint8Array(64), { extras: new Map([[name, tone]]), compress: "pkware", encrypt: true }))).archive!;
    const slot = archive.slotOf(name);
    const member = archive.members().find((m) => m.slot === slot)!;
    expect(member.block.flags & 0x20000).toBe(0x20000);
    const moved = relocate(member, name, member.block.filePos + 4096);
    expect(moved.block.filePos).toBe(member.block.filePos + 4096);
    expect(moved.data).not.toEqual(member.data);
    // Placed by packStored at the archive's start, then written round a fresh scenario and read by name.
    const [placed] = packStored([{ member, name }], []);
    expect(placed.block.filePos).toBe(32);
    const out = await writeArchiveBytes(new Uint8Array(64), { stored: { hashTable: archive.hashEntries(), sectorSize: archive.sectorSize, members: [placed], unreadable: [] }, compression: "pkware", encrypt: true, listfile: false });
    expect(await (await loadMap(out)).archive!.readFileAsync(name)).toEqual(tone);
    expect(fileKey("A\\b.wav", 0, 0, false)).toBe(fileKey("b.WAV", 0, 0, false));
  });
});
