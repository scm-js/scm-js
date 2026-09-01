import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { loadMap } from "../src/formats/mpq/scm";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { WAV_SLOTS } from "../src/formats/chk/sections/sounds";
import { newAction, newTrigger } from "../src/editor/triggers";
import { internString } from "../src/editor/settings";
import { addSound, applySounds, findMember, normalizeMember, orphanSounds, readWavs, removeSound, slotOf, soundBytes, soundList, wavMemberName, wavUsage } from "../src/editor/sounds";

function fresh() {
  const scn = createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" });
  scn.dirty.clear();
  return scn;
}

describe("sounds", () => {
  it("joins the WAV table with the archive members and the triggers that play them", () => {
    const scn = fresh();
    const extras = new Map<string, Uint8Array>([
      ["staredit\\wav\\Beacon.WAV", new Uint8Array(100)],
      ["sound/extra.ogg", new Uint8Array(50)],
      ["staredit\\scenario.chk", new Uint8Array(1)],
    ]);
    const wavs = readWavs(scn);
    expect(wavs.length).toBe(WAV_SLOTS);
    expect(addSound(scn, wavs, "staredit\\wav\\beacon.wav")).toBe(0);
    expect(addSound(scn, wavs, "STAREDIT/WAV/BEACON.WAV")).toBe(0); // already listed, however spelt
    expect(addSound(scn, wavs, "staredit\\wav\\missing.wav")).toBe(1);
    expect(slotOf(scn, wavs, "staredit\\wav\\missing.wav")).toBe(1);
    const t = newTrigger();
    const a = newAction(ActionType.PlayWav);
    a.wav = wavs[0];
    t.actions.push(a);
    scn.triggers.push(t);

    const rows = soundList(scn, extras, wavs);
    expect(rows.map((r) => r.slot)).toEqual([0, 1]);
    expect(rows[0]).toMatchObject({ path: "staredit\\wav\\beacon.wav", present: true, size: 100, member: "staredit\\wav\\Beacon.WAV", usedBy: ["Trigger 1: Play WAV"] });
    expect(rows[1]).toMatchObject({ present: false, size: 0, member: null, usedBy: [] });
    expect(wavUsage(scn, wavs[0])).toEqual(["Trigger 1: Play WAV"]);
    expect(orphanSounds(scn, extras, wavs)).toEqual(["sound/extra.ogg"]);
    expect(findMember(extras, "sound\\EXTRA.ogg")).toBe("sound/extra.ogg");
    expect(normalizeMember("A/b\\C")).toBe("a\\b\\c");
    expect(wavMemberName("C:\\music\\Round Start.wav")).toBe("staredit\\wav\\Round Start.wav");
    expect(soundBytes(extras)).toBe(150);

    const fewer = removeSound(wavs, 0);
    expect(fewer[0]).toBe(0);
    expect(wavs[0]).not.toBe(0);
    expect(soundList(scn, extras, fewer).map((r) => r.slot)).toEqual([1]);
  });

  it("creates the section on first apply and marks it dirty only on a change", () => {
    const scn = fresh();
    scn.wavs = null;
    const wavs = readWavs(scn);
    expect(applySounds(scn, wavs)).toBe(true); // null → an (empty) table
    expect(scn.dirty.has("WAV ")).toBe(true);
    scn.dirty.clear();
    expect(applySounds(scn, wavs)).toBe(false);
    const slot = addSound(scn, wavs, "staredit\\wav\\x.wav");
    expect(slot).toBe(0);
    expect(applySounds(scn, wavs)).toBe(true);
    const back = parseScenario(serializeScenario(scn));
    expect(back.wavs![0]).toBe(wavs[0]);
    expect(back.strings.strings[wavs[0]]).toBe("staredit\\wav\\x.wav");
    // A full table refuses.
    const full = readWavs(back).map((_, i) => i + 1);
    expect(addSound(back, full, "staredit\\wav\\y.wav")).toBe(-1);
    // A short table is padded to 512 on apply.
    expect(applySounds(back, [internString(back, "z")])).toBe(true);
    expect(back.wavs!.length).toBe(WAV_SLOTS);
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const BURGHS = join(MAPS, "(2)Binary Burghs.scx");

describe.skipIf(!existsSync(BURGHS))("Binary Burghs", () => {
  it("has an empty WAV table and no sound members", async () => {
    const { chk, archive, files } = await loadMap(new Uint8Array(readFileSync(BURGHS)));
    const scn = parseScenario(chk);
    expect(scn.wavs).not.toBeNull();
    expect(soundList(scn, new Map())).toEqual([]);
    expect(applySounds(scn, readWavs(scn))).toBe(false);
    void archive; void files;
  });
});
