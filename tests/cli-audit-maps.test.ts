/**
 * The map commands that need no game, held to what the command-line audit of 0.13.3 found: bytes that are not a map
 * are refused rather than read as a blank one, a write keeps the members it did not change as they were stored, an
 * empty import is refused, an edit is kept when the map cannot be written — and the smaller findings after them.
 * Everything runs on the committed maps in tests/maps (and, where present, the fixtures); writes go to a temporary
 * folder.
 */
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { Archive, Creator } from "mopaq";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeScenario, openMapBytes, readArchive, writeMapBytes } from "../src/editor/mapFile";
import { SCENARIO_PATH } from "../src/formats/mpq/scm";
import { scenarioName } from "../src/formats/chk/scenario";
import { storedFormOf, storedInOtherForm } from "../src/formats/mpq/stored";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";
import { editInEditor } from "../cli/src/texteditor";
import { exportTriggers, importStrings, importTriggers, trgKind, writeBack } from "../cli/src/exchange";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-audit-maps-"));
const scenarioNameOf = (doc: { scenario: Parameters<typeof scenarioName>[0] }) => scenarioName(doc.scenario);

/** A command run as `scmjs …` would run it: what it printed, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number; raw: Buffer }> {
  const chunks: Buffer[] = [];
  let err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array, ...rest: unknown[]) => {
    chunks.push(Buffer.from(s));
    const cb = rest.find((r) => typeof r === "function") as ((e?: Error) => void) | undefined;
    cb?.();
    return true;
  });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (x) {
    if (!(x instanceof CliError)) throw x;
    err += x.message + (x.hint ? `\n  ${x.hint}` : "");
    process.exitCode = x.exitCode;
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  const raw = Buffer.concat(chunks);
  return { out: visible(raw.toString("utf8")), err: visible(err), code, raw };
}
afterEach(() => { process.exitCode = 0; });

describe("S1: bytes that are not a map", () => {
  it("are refused where every map is opened, and the editor's real maps are not", async () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    const random = new Uint8Array(3000).map((_, i) => (i * 2654435761) >>> 24);
    for (const bytes of [enc("hello\n"), new Uint8Array(0), enc("abcde"), enc("# A readme\n\nSome text about a thing.\n"), random, new Uint8Array(64)]) {
      expect(looksLikeScenario(bytes)).toBe(false);
      await expect(openMapBytes(bytes, "x.chk")).rejects.toThrow(/no section a map has/);
    }
    for (const m of ["ums.scx", "melee.scx", "original.scm", "hybrid.scm", "remastered.scx"]) {
      const bytes = new Uint8Array(readFileSync(testMap(m)));
      expect(looksLikeScenario((await readArchive(bytes)).chk)).toBe(true);
    }
    // A bare scenario of one section is still one.
    expect(looksLikeScenario(new Uint8Array([0x54, 0x59, 0x50, 0x45, 4, 0, 0, 0, 82, 65, 87, 66]))).toBe(true);
  });

  it("is said and exits 2, and a writer leaves the file as it was", async () => {
    const dir = tmp();
    const note = join(dir, "note.scm");
    writeFileSync(note, "hello\n");
    const info = await scmjs("map", "info", note);
    expect(info.code).toBe(2);
    expect(info.err).toMatch(/note\.scm is not a map this can read: .*no section a map has/);
    const set = await scmjs("map", "set", note, "--name", "x");
    expect(set.code).toBe(2);
    expect(readFileSync(note, "utf8")).toBe("hello\n");
  });

  it("refuses a folder to pack whose scenario is not one", async () => {
    const dir = tmp();
    const folder = join(dir, "ums");
    expect((await scmjs("map", "unpack", testMap("ums.scx"), "--out", folder)).code).toBe(0);
    writeFileSync(join(folder, "staredit", "scenario.chk"), "not a scenario");
    const r = await scmjs("map", "pack", folder, "--out", join(dir, "x.scx"));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/not a map the editor reads/);
    expect(existsSync(join(dir, "x.scx"))).toBe(false);
  });
});

/**
 * ums.scx with its sound stored as StarEdit stores one: ADPCM sectors (mopaq writes only PKWARE and zlib, so the
 * sectors are made here — silence, each sample "the same as the last"). 8,192 bytes of PCM in 4,116 stored.
 */
async function adpcmMap(): Promise<{ bytes: Uint8Array; stored: number; pcm: Uint8Array }> {
  const chk = (await readArchive(new Uint8Array(readFileSync(testMap("ums.scx"))))).chk;
  const WAV = "staredit\\wav\\tone.wav";
  const pcm = new Uint8Array(8192);
  const first = new Creator({ sectorSize: 4096 });
  first.addFile(SCENARIO_PATH, chk, { compress: "pkware" });
  first.addFile(WAV, pcm, { compress: false });
  const a = await Archive.openAsync(await first.writeAsync());
  const plain = a.members().find((m) => m.slot === a.slotOf(WAV))!;
  // A sector: the method (0x40, ADPCM mono), a byte the decoder skips, the shift, the first sample, then 2,047 times
  // "the same sample again" (0x80).
  const sector = new Uint8Array([0x40, 0, 0, 0, 0, ...new Array(2047).fill(0x80)]);
  const data = new Uint8Array(12 + sector.length * 2);
  new DataView(data.buffer).setUint32(0, 12, true);
  new DataView(data.buffer).setUint32(4, 12 + sector.length, true);
  new DataView(data.buffer).setUint32(8, 12 + sector.length * 2, true);
  data.set(sector, 12); data.set(sector, 12 + sector.length);
  const second = new Creator({ sectorSize: 4096, hashTable: a.hashEntries(), listfile: false });
  second.addStored({ ...plain, block: { ...plain.block, compressedSize: data.length, flags: 0x80000000 | 0x200 }, data });
  second.addFile(SCENARIO_PATH, chk, { compress: "pkware" });
  second.addFile("(listfile)", new TextEncoder().encode([SCENARIO_PATH, WAV].join("\r\n")), { compress: "pkware" });
  return { bytes: await second.writeAsync(), stored: data.length, pcm };
}
const WAV = "staredit\\wav\\tone.wav";
const storedSize = async (bytes: Uint8Array) => (await Archive.openAsync(bytes)).fileInfo(WAV)!.compressedSize;

describe("S2: a sound StarEdit stored with ADPCM", () => {
  it("is read as PCM, known to be in a form the writer cannot make, and written back as it was stored while unchanged", async () => {
    const { bytes, stored, pcm } = await adpcmMap();
    const doc = await openMapBytes(bytes, "a.scx");
    expect(doc.extras.get(WAV)).toEqual(pcm);
    expect(storedFormOf(doc.extras.get(WAV)!)?.name).toBe(WAV);
    const a = await Archive.openAsync(bytes);
    expect(storedInOtherForm(a.members().find((m) => m.slot === a.slotOf(WAV))!, WAV)).toBe(true);
    // What the editor's Save and every command that writes a map run.
    const out = await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored, options: { compression: "pkware", encrypt: true } });
    expect(await storedSize(out)).toBe(stored);
    const again = await openMapBytes(out, "a.scx");
    expect(again.extras.get(WAV)).toEqual(pcm);
    expect((await Archive.openAsync(out)).files()).toContain(WAV);
    // A sound given new bytes is written afresh.
    doc.extras.set(WAV, new Uint8Array(8192).fill(1));
    expect(await storedSize(await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras, stored: doc.stored, options: { compression: "pkware" } }))).not.toBe(stored);
    // And one changed in place too.
    const inPlace = await openMapBytes(bytes, "a.scx");
    inPlace.extras.get(WAV)![100] = 7;
    expect(storedFormOf(inPlace.extras.get(WAV)!)).toBeNull();
  });

  it("stays as it was through map set, and through unpack and pack while its file is unchanged", async () => {
    const dir = tmp();
    const { bytes, stored } = await adpcmMap();
    writeFileSync(join(dir, "a.scx"), bytes);
    expect((await scmjs("map", "set", join(dir, "a.scx"), "--name", "B", "--out", join(dir, "b.scx"))).code).toBe(0);
    expect(await storedSize(new Uint8Array(readFileSync(join(dir, "b.scx"))))).toBe(stored);
    expect((await scmjs("map", "unpack", join(dir, "a.scx"), "--out", join(dir, "a"))).code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, "a", "archive.json"), "utf8")).version).toBe(3);
    const packed = await scmjs("map", "pack", join(dir, "a"), "--out", join(dir, "c.scx"), "--json");
    expect(packed.code).toBe(0);
    expect(JSON.parse(packed.out)).toMatchObject({ keptAsStored: 1, changedSounds: 0 });
    expect(await storedSize(new Uint8Array(readFileSync(join(dir, "c.scx"))))).toBe(stored);
    // Edited: written afresh, and said.
    writeFileSync(join(dir, "a", "staredit", "wav", "tone.wav"), new Uint8Array(8192).fill(3));
    const edited = await scmjs("map", "pack", join(dir, "a"), "--out", join(dir, "d.scx"));
    expect(edited.code).toBe(0);
    expect(edited.out + edited.err).toMatch(/1 sound was changed since the unpack and goes in as plain PCM/);
    expect(await storedSize(new Uint8Array(readFileSync(join(dir, "d.scx"))))).not.toBe(stored);
  });
});

const WAKKA = join("fixtures", "maps", "(2)Wakka Wakka.scm");
describe.skipIf(!existsSync(WAKKA))("S2 on a StarEdit map (fixtures)", () => {
  it("writes Wakka Wakka smaller than it was, every member the same once read", async () => {
    const bytes = new Uint8Array(readFileSync(WAKKA));
    const doc = await openMapBytes(bytes, "w.scm");
    const out = await writeMapBytes(doc.scenario, { format: "scm", extras: doc.extras, stored: doc.stored, options: { compression: "pkware", encrypt: true } });
    expect(out.length).toBeLessThan(bytes.length);
    const again = await openMapBytes(out, "w.scm");
    expect([...again.extras.keys()].sort()).toEqual([...doc.extras.keys()].sort());
    for (const [name, data] of doc.extras) expect(again.extras.get(name), name).toEqual(data);
  }, 30_000);
});

/** A copy of a committed map in a folder of its own. */
function copyOf(name: string): { dir: string; path: string } {
  const dir = tmp();
  copyFileSync(testMap(name), join(dir, name));
  return { dir, path: join(dir, name) };
}

describe("S3: an import with nothing in it", () => {
  it("is refused, exit 2, unless --allow-empty says it is meant", async () => {
    const { dir, path } = copyOf("ums.scx");
    const before = readFileSync(path);
    writeFileSync(join(dir, "empty.txt"), "");
    const r = await scmjs("map", "triggers", "import", path, join(dir, "empty.txt"));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/empty\.txt holds no triggers/);
    expect(readFileSync(path)).toEqual(before);
    const s = await scmjs("map", "strings", "import", path, join(dir, "empty.txt"));
    expect(s.code).toBe(2);
    expect(s.err).toMatch(/holds no strings/);
    const ok = await scmjs("map", "triggers", "import", path, join(dir, "empty.txt"), "--allow-empty", "--json");
    expect(ok.code).toBe(0);
    expect(JSON.parse(ok.out)).toMatchObject({ before: 3, after: 0, read: 0, dryRun: false });
  });

  it("refuses a .trg of the other kind, and a string given twice", async () => {
    const doc = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    const briefing = exportTriggers(doc, "b.trg", true).bytes!;
    const triggers = exportTriggers(doc, "t.trg").bytes!;
    expect(() => importTriggers(doc, "b.trg", briefing)).toThrow(/holds a mission briefing's triggers/);
    expect(() => importTriggers(doc, "t.trg", triggers, { briefing: true })).toThrow(/holds triggers, not a mission briefing's/);
    expect(importTriggers(doc, "b.trg", briefing, { briefing: true }).read).toBe(1);
    expect(trgKind([])).toBeNull();
    expect(() => importStrings(doc, "s.txt", "1\ta\n1\tb\n")).toThrow(/string 1 is on two lines/);
  });
});

describe("S4: an edit whose map cannot be written", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keeps the text and says how to bring it in", async () => {
    const { dir, path } = copyOf("ums.scx");
    chmodSync(path, 0o444);
    const script = join(dir, "editor.mjs");
    writeFileSync(script, `import { appendFileSync } from "node:fs"; appendFileSync(process.argv[2], 'Trigger("Player 1"){\\nConditions:\\n\\tAlways();\\n\\nActions:\\n\\tDefeat();\\n}\\n');`);
    const doc = await openMapBytes(new Uint8Array(readFileSync(path)), "ums.scx");
    const e = await editInEditor(doc, path, "triggers", { dir, editor: `"${process.execPath}" "${script}"`, write: async () => { await writeBack(doc, path, null); } }).catch((x: unknown) => x as CliError);
    expect(e).toBeInstanceOf(CliError);
    expect((e as CliError).message).toMatch(/could not be written: no permission/);
    const kept = /kept in (\S+\.txt)/.exec((e as CliError).hint ?? "")![1];
    expect(readFileSync(kept, "utf8")).toContain("Defeat();");
    expect((e as CliError).hint).toContain("scmjs map triggers import");
  });

  it("refuses an empty --editor", async () => {
    const r = await scmjs("map", "triggers", "edit", testMap("ums.scx"), "--editor", "");
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/--editor needs a command/);
  });
});

describe("B1 and the unpacked folder", () => {
  it("map pack --out - writes the map to standard output and its line to standard error; unpack refuses -", async () => {
    const dir = tmp();
    await scmjs("map", "unpack", testMap("ums.scx"), "--out", join(dir, "u"));
    const r = await scmjs("map", "pack", join(dir, "u"), "--out", "-");
    expect(r.code).toBe(0);
    expect((await openMapBytes(new Uint8Array(r.raw), "x.scx")).scenario.units.length).toBeGreaterThan(0);
    expect(r.err).toMatch(/standard output: the scenario and 1 member/);
    expect(existsSync("-")).toBe(false);
    expect((await scmjs("map", "pack", join(dir, "u"), "--out", "-", "--json")).code).toBe(2);
    const json = JSON.parse((await scmjs("map", "pack", join(dir, "u"), "--dry-run", "--json")).out);
    expect(json).toMatchObject({ members: 1, dryRun: true, file: join(dir, "u") });
    expect(existsSync(join(dir, "ums.scx"))).toBe(false);
    const u = await scmjs("map", "unpack", testMap("ums.scx"), "--out", "-");
    expect(u.code).toBe(2);
    expect(u.err).toMatch(/--out - cannot be standard output/);
  });

  it("never merges: an earlier unpack of the map is replaced, anything else refused unless --force", async () => {
    const dir = tmp();
    const x = join(dir, "X");
    // The same name, two versions: the second has no sound, and the first's must not survive into the folder.
    copyFileSync(testMap("ums.scx"), join(dir, "ums.scx"));
    expect((await scmjs("map", "unpack", join(dir, "ums.scx"), "--out", x)).code).toBe(0);
    expect(existsSync(join(x, "staredit", "wav", "tone.wav"))).toBe(true);
    expect((await scmjs("map", "unpack", join(dir, "ums.scx"), "--out", x)).code).toBe(0);
    const other = join(tmp(), "ums.scx");
    copyFileSync(testMap("melee.scx"), other);
    expect((await scmjs("map", "unpack", other, "--out", x)).code).toBe(0);
    expect(existsSync(join(x, "staredit", "wav", "tone.wav"))).toBe(false);
    // Another map, an edit, an added file: refused, and the folder left as it was.
    const melee = await scmjs("map", "unpack", testMap("original.scm"), "--out", x);
    expect(melee.code).toBe(2);
    expect(melee.err).toMatch(/holds the unpack of ums\.scx, not of original\.scm/);
    writeFileSync(join(x, "staredit", "scenario.chk"), new Uint8Array([1, 2, 3]));
    const edited = await scmjs("map", "unpack", other, "--out", x);
    expect(edited.code).toBe(2);
    expect(edited.err).toMatch(/changed since the unpack: staredit\/scenario\.chk/);
    expect(readFileSync(join(x, "staredit", "scenario.chk"))).toEqual(Buffer.from([1, 2, 3]));
    expect((await scmjs("map", "unpack", other, "--out", x, "--force")).code).toBe(0);
    writeFileSync(join(x, "notes.txt"), "mine");
    expect((await scmjs("map", "unpack", other, "--out", x)).err).toMatch(/added since the unpack: notes\.txt/);
    // A folder that is no unpack is refused even with --force.
    writeFileSync(join(dir, "keep.txt"), "x");
    const j = await scmjs("map", "unpack", testMap("ums.scx"), "--out", dir, "--force");
    expect(j.code).toBe(2);
    expect(j.err).toMatch(/holds other files, not an unpack of a map/);
    expect(readFileSync(join(dir, "keep.txt"), "utf8")).toBe("x");
  });
});

/** A command fed `input` on standard input, as `cat x | scmjs …` would. */
async function piped(input: Uint8Array, ...args: string[]) {
  const { Readable } = await import("node:stream");
  const stdin = Object.getOwnPropertyDescriptor(process, "stdin")!;
  Object.defineProperty(process, "stdin", { value: Readable.from([Buffer.from(input)]), configurable: true });
  try { return await scmjs(...args); } finally { Object.defineProperty(process, "stdin", stdin); }
}

describe("B2, B3, B6: map optimize", () => {
  it("passes a map it cannot make smaller down a pipe, and writes --out whatever happens", async () => {
    const dir = tmp();
    const once = join(dir, "pk.scx");
    // B3: a compression asked for is written though the file is larger, and the list is the one written.
    const asked = await scmjs("map", "optimize", testMap("ums.scx"), "--compression", "PKWARE", "--out", once);
    expect(asked.code).toBe(0);
    expect(asked.out).toMatch(/written to .*pk\.scx \(in the compression asked for, though not smaller\)/);
    expect(asked.out).toContain("Removed");
    expect(asked.out).not.toMatch(/ADPCM/);
    expect((await readArchive(new Uint8Array(readFileSync(once)))).origin?.compression).toBe("pkware");
    // B2: nothing to gain, still written where it was asked for.
    const r = await piped(new Uint8Array(readFileSync(once)), "map", "optimize", "-");
    expect(r.code).toBe(0);
    expect(r.raw).toEqual(readFileSync(once));
    expect(r.err).toMatch(/written as it was to standard output/);
    const out = await scmjs("map", "optimize", once, "--out", join(dir, "copy.scx"));
    expect(out.code).toBe(0);
    expect(readFileSync(join(dir, "copy.scx"))).toEqual(readFileSync(once));
  });

  it("takes --keep once per member, keeps the map argument, and says a name the map lacks", async () => {
    const r = await scmjs("map", "optimize", "--keep", "notes\\", "--keep", "nope.txt", testMap("ums.scx"), "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/--keep notes\\: the map has no such member/);
    expect(r.out).toMatch(/--keep nope\.txt: the map has no such member/);
  });
});

describe("B2: --out is written when the command succeeds", () => {
  it("map strings prune with nothing to drop", async () => {
    const dir = tmp();
    const once = join(dir, "pruned.scx");
    await scmjs("map", "strings", "prune", testMap("ums.scx"), "--out", once);
    const again = await scmjs("map", "strings", "prune", once, "--out", join(dir, "again.scx"));
    expect(again.code).toBe(0);
    expect(existsSync(join(dir, "again.scx"))).toBe(true);
  });
});

describe("B5, B7: map run", () => {
  it("passes the map down a pipe unchanged, keeps a script's console off standard output, and makes save quiet", async () => {
    const dir = tmp();
    const script = join(dir, "s.mjs");
    writeFileSync(script, `export default async (api) => {
  console.log("from the script");
  api.ui.toast("a plain toast");
  console.log("save:", await api.document.save());
  setTimeout(() => api.ui.status("later"), 50);
};`);
    const bytes = new Uint8Array(readFileSync(testMap("ums.scx")));
    const p = await piped(bytes, "map", "run", script, "-");
    expect(p.code).toBe(0);
    expect((await openMapBytes(new Uint8Array(p.raw), "x.scx")).scenario.units.length).toBe((await openMapBytes(bytes, "x.scx")).scenario.units.length);
    const json = await scmjs("map", "run", script, testMap("ums.scx"), "--json", "--dry-run");
    const r = JSON.parse(json.out);
    expect(r.file).toBe(testMap("ums.scx"));
    // The toast by its text; the status the script set after it returned, waited for.
    expect(r.events.map((e: { text: string }) => e.text)).toEqual(["a plain toast", "later"]);
    expect(json.err).toContain("from the script");
    expect(json.err).toContain("save: true");
    expect(json.err).not.toMatch(/window is not defined|at /);
    const arg = await scmjs("map", "run", script, testMap("ums.scx"), "--arg", "x");
    expect(arg.code).toBe(2);
  });

  it("loads a plugin from its source when its build is not there, and says what a path is not", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ name: "Src", id: "src", version: "1.0.0", entry: "plugin.js", build: "dist/plugin.js", api: 1 }));
    writeFileSync(join(dir, "plugin.js"), `export function activate(api) { api.ui.status("from source"); }`);
    const r = await scmjs("map", "run", dir, testMap("ums.scx"), "--dry-run");
    expect(r.code).toBe(0);
    expect(r.out).toContain("from source");
    expect((await scmjs("map", "run", join(dir, "nope.mjs"), testMap("ums.scx"))).err).toMatch(/No file or folder/);
    writeFileSync(join(dir, "note.txt"), "x");
    expect((await scmjs("map", "run", join(dir, "note.txt"), testMap("ums.scx"))).err).toMatch(/note\.txt is not a plugin/);
  });
});

describe("B4, B9 and the values: map set, map new, map generate", () => {
  it("says an encoding has nothing to change on plain ASCII text, and writes nothing", async () => {
    const { path } = copyOf("melee.scx");
    const before = readFileSync(path);
    const r = await scmjs("map", "set", path, "--encoding", "EUC-KR");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/plain ASCII, the same in every encoding/);
    expect(r.out).toMatch(/nothing changed/);
    expect(readFileSync(path)).toEqual(before);
    const dry = await scmjs("map", "set", path, "--revision", "Remastered", "--dry-run");
    expect(dry.out).toMatch(/Brood War 1\.04 → Remastered 1\.21\+ \(--dry-run: nothing written\)/);
    expect(readFileSync(path)).toEqual(before);
  });

  it("reads --name as map set does, takes set's five revisions, and checks the name and --layout", async () => {
    const dir = tmp();
    const named = await scmjs("map", "new", join(dir, "b.scx"), "--name", "My <04>Map", "--players", "2", "--layout", "Corners");
    expect(named.code).toBe(0);
    expect(scenarioNameOf(await openMapBytes(new Uint8Array(readFileSync(join(dir, "b.scx"))), "b.scx"))).toBe("My \x04Map");
    expect((await scmjs("map", "new", join(dir, "o"), "--revision", "Original")).code).toBe(0);
    expect(existsSync(join(dir, "o.scm"))).toBe(true);
    const txt = await scmjs("map", "new", join(dir, "f.txt"));
    expect(txt.code).toBe(2);
    expect(existsSync(join(dir, "f.txt"))).toBe(false);
    expect((await scmjs("map", "new", join(dir, "g.scx"), "--layout", "corners")).err).toMatch(/--layout lays out start locations/);
    const bare = await scmjs("map", "new", join(dir, "h.scx"));
    expect(bare.out).toMatch(/No start locations yet/);
  });
});

describe("B5: a baseline in a folder that is not there yet", () => {
  it("is written there, and one of an unknown version is refused", async () => {
    const dir = tmp();
    const file = join(dir, "sub", "dir", "b.json");
    const r = await scmjs("map", "check", testMap("ums.scx"), "--write-baseline", file);
    expect(r.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    writeFileSync(file, JSON.stringify({ version: 99, maps: {} }));
    const v = await scmjs("map", "check", testMap("ums.scx"), "--baseline", file);
    expect(v.code).toBe(2);
    expect(v.err).toMatch(/version 99/);
  });
});

describe("B8: map dump", () => {
  it("has no file name in the first line, and shows a sprite, a doodad, a setting and a section's hash", async () => {
    const a = await scmjs("map", "dump", testMap("ums.scx"));
    const dir = tmp();
    copyFileSync(testMap("ums.scx"), join(dir, "renamed.scx"));
    expect((await scmjs("map", "dump", join(dir, "renamed.scx"))).out).toBe(a.out);
    expect(a.out.split("\n")[0]).toBe("# scmjs map dump 2");
    expect(a.out).toMatch(/## Sprites \(\d+\)/);
    expect(a.out).toMatch(/## Settings \(1\)\n {2}units {2}/);
    expect(a.out).toMatch(/ {2}MTXM +\d+ B {2}sha1 [0-9a-f]{12}/);
    // A terrain-only change: the MTXM line changes.
    const doc = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
    doc.scenario.tiles[0] = (doc.scenario.tiles[0] + 1) & 0xffff;
    doc.scenario.dirty.add("MTXM");
    const { dumpMap, printDump } = await import("../cli/src/dump");
    const before = a.out.split("\n"), after = printDump(dumpMap(doc, "ums.scx"), doc.scenario).split("\n");
    expect(after.filter((l) => !before.includes(l))).toEqual([expect.stringMatching(/^ {2}MTXM /)]);
  });
});

describe("B10 and the smaller ones: map find, map info, map check", () => {
  it("finds a trigger by its arguments, numbers hits from 1 in JSON, and counts only the maps read", async () => {
    const r = await scmjs("map", "find", "Marine", "nope.scx", testMap("ums.scx"), "--json");
    const [missing, found] = JSON.parse(r.out);
    expect(missing).toEqual({ file: "nope.scx", error: "No file nope.scx" });
    expect(r.err).toMatch(/No file nope\.scx/);
    expect(found.file).toBe(testMap("ums.scx"));
    expect(found.hits.find((h: { label: string }) => h.label === "Trigger 2")).toMatchObject({ kind: "triggers", index: 1, number: 2 });
    const none = await scmjs("map", "find", "zzzz", "nope.scx", testMap("ums.scx"));
    expect(none.out).toMatch(/Nothing in 1 map matches/);
    const both = await scmjs("map", "find", "Middle", testMap("ums.scx"), "--in", "locations", "--in", "triggers", "--json");
    expect(new Set(JSON.parse(both.out).hits.map((h: { kind: string }) => h.kind))).toEqual(new Set(["locations", "triggers"]));
  });

  it("says a file it could not read in every format, and counts only the maps read", async () => {
    const junit = await scmjs("map", "check", "--format", "junit", "nope.scx", testMap("melee.scx"));
    expect(junit.err).toMatch(/No file nope\.scx/);
    expect(junit.out).toMatch(/tests="2" failures="0" errors="1"/);
    expect(junit.out).toMatch(/<error message="No file nope\.scx"\/>/);
    const sarif = JSON.parse((await scmjs("map", "check", "--format", "sarif", "nope.scx")).out);
    expect(sarif.runs[0].invocations[0].toolExecutionNotifications[0].message.text).toBe("No file nope.scx");
    const text = await scmjs("map", "check", "nope.scx", testMap("melee.scx"));
    expect(text.out).toMatch(/1 map checked, none failed · 1 file not read/);
    expect(text.out).not.toMatch(/^\n/);
    expect((await scmjs("map", "info", testMap("ums.scx"), "--table", "--json")).code).toBe(2);
    expect((await scmjs("map", "check", testMap("ums.scx"), "--json", "--format", "github")).code).toBe(2);
    const info = JSON.parse((await scmjs("map", "info", testMap("ums.scx"), "--json")).out);
    expect(info).toMatchObject({ name: "Test Scenario", rawName: "Test Scenario", stringsWithText: expect.any(Number) });
  });
});

describe("map sounds", () => {
  it("says a file in the folder's place in one line, numbers slots from 1 in JSON, and gives paths as typed", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "afile"), "x");
    const r = await scmjs("map", "sounds", "export", testMap("ums.scx"), "--out", join(dir, "afile"));
    expect(r.code).toBe(2);
    expect(r.err).toMatch(/afile is a file, not a folder/);
    const list = JSON.parse((await scmjs("map", "sounds", testMap("ums.scx"), "--json")).out);
    expect(list.file).toBe(testMap("ums.scx"));
    expect(list.sounds[0]).toMatchObject({ slot: 0, number: 1 });
    const out = join(dir, "s");
    const ex = JSON.parse((await scmjs("map", "sounds", "export", testMap("ums.scx"), "--out", out, "--json")).out);
    expect(ex.dir).toBe(out);
    expect(ex.sounds[0].file).toBe(join(out, "tone.wav"));
  });
});
