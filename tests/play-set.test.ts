/**
 * The play set (`gamedata/play.ts`): what a stored copy keeps for the site's play page
 * beyond the editor's own files — the list, the sounds read out of the game's own table,
 * and the copy itself with what its stamp comes to say.
 */
import { describe, expect, it } from "vitest";
import { copyPlaySet, PLAY_COUNTDOWN, PLAY_MEMBERS, PLAY_REQUIRED, PLAY_VERSION, playImageMembers, playSoundMembers } from "../src/gamedata/play";

/** sfxdata.dat with the given sound ids pointing at entries of the table, and that table. */
function sfx(names: string[], ids: [id: number, index1: number][]) {
  const dat = new Uint8Array(1144 * 9);
  const dv = new DataView(dat.buffer);
  for (const [id, index] of ids) dv.setUint32(id * 4, index, true);
  const text = names.map((n) => n + "\0").join("");
  const tbl = new Uint8Array(2 + names.length * 2 + text.length);
  const tv = new DataView(tbl.buffer);
  tv.setUint16(0, names.length, true);
  let at = 2 + names.length * 2;
  names.forEach((n, i) => {
    tv.setUint16(2 + i * 2, at, true);
    for (let k = 0; k < n.length; k++) tbl[at + k] = n.charCodeAt(k);
    at += n.length + 1;
  });
  return { dat, tbl };
}

describe("the play set", () => {
  it("names the game's files as the game does, each once", () => {
    expect(new Set(PLAY_MEMBERS).size).toBe(PLAY_MEMBERS.length);
    expect(PLAY_MEMBERS.every((m) => m === m.toLowerCase() && !m.includes("/"))).toBe(true);
    expect(PLAY_MEMBERS).toContain("tileset\\jungle\\trans50.pcx");
    expect(PLAY_REQUIRED).toContain("triggers\\melee.trg");
    expect(PLAY_REQUIRED).not.toContain("triggers\\ctf.trg");
    expect(PLAY_REQUIRED).not.toContain("cursor\\arrow.grp");
    // The lobby's count down: kept from every installation, and no game waits for it.
    expect(PLAY_MEMBERS).toContain("sound\\glue\\countdown.wav");
    expect(PLAY_REQUIRED).not.toContain(PLAY_COUNTDOWN);
    // Remastered's console is there for a Remastered installation and no 1.16 one has it.
    expect(PLAY_MEMBERS).toContain("hd2\\game\\consoles\\zerg\\console_center.dds");
    expect(PLAY_REQUIRED.some((m) => m.startsWith("hd2\\"))).toBe(false);
  });

  it("reads the sounds out of the game's table: each file once, the unused ids skipped", () => {
    const { dat, tbl } = sfx(["Terran\\Marine\\TMaYes00.wav", "Misc\\Buzz.wav"], [[1, 1], [2, 2], [3, 1], [4, 9]]);
    expect(playSoundMembers(dat, tbl)).toEqual(["sound\\terran\\marine\\tmayes00.wav", "sound\\misc\\buzz.wav"]);
    expect(playSoundMembers(new Uint8Array(10), tbl)).toEqual([]);
  });

  // Twenty sounds, as the game's table names them: A.wav to T.wav.
  const twenty = () => sfx(Array.from({ length: 20 }, (_, i) => `${String.fromCharCode(65 + i)}.wav`), Array.from({ length: 20 }, (_, i) => [i + 1, i + 1] as [number, number]));

  it("copies what a full installation has and says so, a sound short as Remastered is", async () => {
    const { dat, tbl } = twenty();
    const written = new Map<string, number>();
    const play = await copyPlaySet(
      async (member) => (member === "sound\\b.wav" || member === "cursor\\time.grp" ? null : new Uint8Array(member.length)),
      async (path, data) => { written.set(path, data.length); },
      { sfxDat: dat, sfxTbl: tbl },
    );
    expect(play).toEqual({ version: PLAY_VERSION, files: PLAY_MEMBERS.length - 1, sounds: 19, bytes: [...written.values()].reduce((a, b) => a + b, 0) });
    expect(written.has("sound/a.wav")).toBe(true);
    expect(written.has("tileset/ice/dark.pcx")).toBe(true);
    expect(written.has("cursor/time.grp")).toBe(false);
  });

  it("takes every image's picture the copy has not got, and its Remastered sprite", async () => {
    // images.dat: 999 images, the first two on GRP 1 and 2, image 0 with an overlay file (GRP column, then the overlay columns from 14).
    const images = new Uint8Array(999 * 38);
    const iv = new DataView(images.buffer);
    iv.setUint32(0, 1, true); iv.setUint32(4, 2, true); iv.setUint32(999 * 14, 3, true);
    const { tbl: imagesTbl } = sfx(["Terran\\Marine.grp", "Thingy\\Dust.grp", "Terran\\Marine.los"], []);
    expect(playImageMembers(images, imagesTbl).files).toEqual(["unit\\terran\\marine.grp", "unit\\terran\\marine.los", "unit\\thingy\\dust.grp"]);
    const { dat, tbl } = sfx(["A.wav"], [[1, 1]]);
    const asked: string[] = [], written: string[] = [];
    await copyPlaySet(
      async (member) => { asked.push(member); return new Uint8Array(4); },
      async (path) => { written.push(path); },
      { sfxDat: dat, sfxTbl: tbl, imagesDat: images, imagesTbl },
      undefined,
      (path) => path === "unit/terran/marine.grp" || path === "unit/hd/main_000.anim",
    );
    // What the copy has is not read again; the rest is, the sprite of every other image among it.
    expect(asked).not.toContain("unit\\terran\\marine.grp");
    expect(written).toContain("unit/thingy/dust.grp");
    expect(written).toContain("unit/terran/marine.los");
    expect(asked).not.toContain("HD2\\anim\\main_000.anim");
    expect(written).toContain("unit/hd/main_001.anim");

    // Asked to keep the lighting's layers: every image's sprite is read, the copy's own among them, and written again.
    // (These are not sprite files, so nothing was kept and the stamp does not say so.)
    const again: string[] = [];
    const play = await copyPlaySet(
      async () => new Uint8Array(4),
      async (path) => { again.push(path); },
      { sfxDat: dat, sfxTbl: tbl, imagesDat: images, imagesTbl },
      undefined,
      (path) => path === "unit/terran/marine.grp" || path === "unit/hd/main_000.anim",
      { lighting: true },
    );
    expect(again).toContain("unit/hd/main_000.anim");
    expect(again).toContain("unit/hd/main_001.anim");
    expect(play?.lit).toBeUndefined();
  });

  it("says nothing of a source without the sounds, or without a file a game needs", async () => {
    const { dat, tbl } = sfx(["A.wav"], [[1, 1]]);
    const none = async () => {};
    expect(await copyPlaySet(async (m) => (m.startsWith("sound\\") ? null : new Uint8Array(1)), none, { sfxDat: dat, sfxTbl: tbl })).toBeNull();
    expect(await copyPlaySet(async (m) => (m === "scripts\\aiscript.bin" ? null : new Uint8Array(1)), none, { sfxDat: dat, sfxTbl: tbl })).toBeNull();
    expect(await copyPlaySet(async () => new Uint8Array(1), none, { sfxDat: undefined, sfxTbl: undefined })).toBeNull();
  });

  it("says nothing of a source that could read only a few of the sounds", async () => {
    // What mopaq before 1.6 made of an installation's archives: three sounds of eleven hundred, the rest undecodable.
    const { dat, tbl } = twenty();
    const few = new Set(["sound\\a.wav", "sound\\b.wav", "sound\\c.wav"]);
    expect(await copyPlaySet(async (m) => (m.startsWith("sound\\") && !few.has(m) ? null : new Uint8Array(1)), async () => {}, { sfxDat: dat, sfxTbl: tbl })).toBeNull();
  });
});
