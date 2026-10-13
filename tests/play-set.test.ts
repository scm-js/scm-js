/**
 * The play set (`gamedata/play.ts`): what a stored copy keeps for the site's play page
 * beyond the editor's own files — the list, the sounds read out of the game's own table,
 * and the copy itself with what its stamp comes to say.
 */
import { describe, expect, it } from "vitest";
import { copyPlaySet, PLAY_MEMBERS, PLAY_REQUIRED, PLAY_VERSION, playSoundMembers } from "../src/gamedata/play";

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
  });

  it("reads the sounds out of the game's table: each file once, the unused ids skipped", () => {
    const { dat, tbl } = sfx(["Terran\\Marine\\TMaYes00.wav", "Misc\\Buzz.wav"], [[1, 1], [2, 2], [3, 1], [4, 9]]);
    expect(playSoundMembers(dat, tbl)).toEqual(["sound\\terran\\marine\\tmayes00.wav", "sound\\misc\\buzz.wav"]);
    expect(playSoundMembers(new Uint8Array(10), tbl)).toEqual([]);
  });

  it("copies what a full installation has and says so", async () => {
    const { dat, tbl } = sfx(["A.wav", "B.wav"], [[1, 1], [2, 2]]);
    const written = new Map<string, number>();
    const play = await copyPlaySet(
      async (member) => (member === "sound\\b.wav" || member === "cursor\\time.grp" ? null : new Uint8Array(member.length)),
      async (path, data) => { written.set(path, data.length); },
      { dat, tbl },
    );
    expect(play).toEqual({ version: PLAY_VERSION, files: PLAY_MEMBERS.length - 1, sounds: 1, bytes: [...written.values()].reduce((a, b) => a + b, 0) });
    expect(written.has("sound/a.wav")).toBe(true);
    expect(written.has("tileset/ice/dark.pcx")).toBe(true);
    expect(written.has("cursor/time.grp")).toBe(false);
  });

  it("says nothing of a source without the sounds, or without a file a game needs", async () => {
    const { dat, tbl } = sfx(["A.wav"], [[1, 1]]);
    const none = async () => {};
    expect(await copyPlaySet(async (m) => (m.startsWith("sound\\") ? null : new Uint8Array(1)), none, { dat, tbl })).toBeNull();
    expect(await copyPlaySet(async (m) => (m === "scripts\\aiscript.bin" ? null : new Uint8Array(1)), none, { dat, tbl })).toBeNull();
    expect(await copyPlaySet(async () => new Uint8Array(1), none, { dat: undefined, tbl: undefined })).toBeNull();
  });
});
