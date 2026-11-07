/**
 * `scmjs map sounds` and `scmjs map sounds export` (cli/src/sounds.ts): the sounds a map carries, listed and written
 * out. The committed ums.scx carries one WAV; a map made here from it adds an Ogg, a second file with the same base
 * name, a name in the WAV table that the archive lacks, and one of the game's own sounds.
 */
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";
import { addSound, applySounds, readWavs } from "../src/editor/sounds";
import { kindOf, type Input } from "../cli/src/files";
import { audioType, exportSounds, oggSeconds, printSounds, readSounds, soundFileName } from "../cli/src/sounds";
import { visible } from "../cli/src/ui";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-sounds-"));
const asInput = (name: string, bytes: Uint8Array): Input => ({ path: name, name, bytes, kind: kindOf(name, bytes) });

/** An Ogg Vorbis stream's first and last pages, enough for its length: 22,050 Hz, `samples` long. */
function ogg(samples: number): Uint8Array {
  const page = (granule: number, payload: number[]) => {
    // capture pattern, version, type, granule (8), serial, sequence, checksum, one segment of the payload's length
    const head = [...new TextEncoder().encode("OggS"), 0, 0, ...Array.from({ length: 8 }, () => 0), 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, payload.length];
    const bytes = new Uint8Array([...head, ...payload]);
    new DataView(bytes.buffer).setBigInt64(6, BigInt(granule), true);
    return [...bytes];
  };
  const id = [1, ...new TextEncoder().encode("vorbis"), 0, 0, 0, 0, 1, 0x22, 0x56, 0, 0];
  return new Uint8Array([...page(0, id), ...page(samples, [0, 0, 0, 0])]);
}

/** ums.scx with an Ogg, a second tone.wav elsewhere, a missing WAV entry and a stock sound. */
async function soundMap(): Promise<Input> {
  const doc = await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx");
  const tone = [...doc.extras.values()][0];
  doc.extras.set("staredit\\wav\\theme.ogg", ogg(44100));
  doc.extras.set("music\\tone.wav", tone);
  const wavs = readWavs(doc.scenario);
  addSound(doc.scenario, wavs, "staredit\\wav\\theme.ogg");
  addSound(doc.scenario, wavs, "staredit\\wav\\gone.wav");
  addSound(doc.scenario, wavs, "sound\\Terran\\Marine\\TMaYes00.wav");
  applySounds(doc.scenario, wavs);
  return asInput("sounds.scx", await writeMapBytes(doc.scenario, { format: "scx", extras: doc.extras }));
}

describe("scmjs map sounds", () => {
  it("lists the committed map's sound with its length, format and the trigger that plays it", async () => {
    const { report } = await readSounds(asInput("ums.scx", new Uint8Array(readFileSync(testMap("ums.scx")))));
    expect(report.sounds).toEqual([{ name: "staredit\\wav\\tone.wav", slot: 0, state: "present", type: "wav", bytes: 11069, seconds: 1, format: "11025 Hz · 8-bit · mono", usedBy: ["Trigger 1: Play WAV"], stock: false }]);
    const lines = printSounds(report).map(visible);
    expect(lines[0]).toBe("ums.scx · 1 sound, 11 KB");
    expect(lines[1]).toMatch(/^ {4}1 {2}staredit\\wav\\tone\.wav {2}1\.0 s · 11025 Hz · 8-bit · mono · 11 KB {2}Trigger 1: Play WAV$/);
  });

  it("lists what the table names and the archive lacks, and audio the table does not name", async () => {
    const { report } = await readSounds(await soundMap());
    const by = (name: string) => report.sounds.find((s) => s.name === name)!;
    expect(report.sounds.map((s) => [s.name, s.slot, s.state])).toEqual([
      ["staredit\\wav\\tone.wav", 0, "present"],
      ["staredit\\wav\\theme.ogg", 1, "present"],
      ["staredit\\wav\\gone.wav", 2, "missing"],
      ["sound\\Terran\\Marine\\TMaYes00.wav", 3, "missing"],
      ["music\\tone.wav", null, "present"],
    ]);
    expect(by("staredit\\wav\\theme.ogg")).toMatchObject({ type: "ogg", seconds: 2 });
    expect(by("sound\\Terran\\Marine\\TMaYes00.wav").stock).toBe(true);
    const text = printSounds(report).map(visible).join("\n");
    expect(text).toMatch(/gone\.wav +not in the archive/);
    expect(text).toMatch(/TMaYes00\.wav +the game's own sound; not in the map/);
  });
});

describe("scmjs map sounds export", () => {
  it("writes each sound the map carries as a file that plays, the bytes as they went in", async () => {
    const dir = join(tmp(), "out");
    const input = await soundMap();
    const r = await exportSounds(input, dir);
    expect(r.written).toBe(3);
    expect(readdirSync(dir).sort()).toEqual(["theme.ogg", "tone-2.wav", "tone.wav"]);
    const original = (await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx")).extras.get("staredit\\wav\\tone.wav")!;
    expect(new Uint8Array(readFileSync(join(dir, "tone.wav")))).toEqual(original);
    expect(new Uint8Array(readFileSync(join(dir, "tone-2.wav")))).toEqual(original);
    expect(audioType(new Uint8Array(readFileSync(join(dir, "theme.ogg"))))).toBe("ogg");
    // The missing ones are in the list, with no file.
    expect(r.sounds.filter((s) => s.file === null).map((s) => s.name)).toEqual(["staredit\\wav\\gone.wav", "sound\\Terran\\Marine\\TMaYes00.wav"]);
  });

  it("writes nothing, and makes no folder, for a map with no sounds", async () => {
    const dir = join(tmp(), "none");
    const r = await exportSounds(asInput("melee.scx", new Uint8Array(readFileSync(testMap("melee.scx")))), dir);
    expect([r.written, r.dir]).toEqual([0, null]);
    expect(printSounds(r).map(visible)[0]).toBe("melee.scx · no sounds");
  });

  it("names a file by its member's base name, with the extension its bytes call for", () => {
    expect(soundFileName("staredit\\wav\\tone.wav", "wav")).toBe("tone.wav");
    expect(soundFileName("staredit\\wav\\voice", "wav")).toBe("voice.wav");
    expect(soundFileName("staredit\\wav\\a:b?.ogg", "ogg")).toBe("a%3Ab%3F.ogg");
    expect(oggSeconds(new Uint8Array(8))).toBeNull();
  });
});
