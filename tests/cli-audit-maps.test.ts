/**
 * The map commands that need no game, held to what the command-line audit of 0.13.3 found: bytes that are not a map
 * are refused rather than read as a blank one, a write keeps the members it did not change as they were stored, an
 * empty import is refused, an edit is kept when the map cannot be written — and the smaller findings after them.
 * Everything runs on the committed maps in tests/maps (and, where present, the fixtures); writes go to a temporary
 * folder.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { Archive, Creator } from "mopaq";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { looksLikeScenario, openMapBytes, readArchive, writeMapBytes } from "../src/editor/mapFile";
import { SCENARIO_PATH } from "../src/formats/mpq/scm";
import { storedFormOf, storedInOtherForm } from "../src/formats/mpq/stored";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-audit-maps-"));

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
