/**
 * Races a mod adds, on the command line: `scmjs replay info` names a player's race from the replay's tag, else from the
 * mod named with `--mod` (its mod.json), else "Race n"; `mod info` lists the races mod.json declares; `mod check` gives
 * one hint, never a finding, when the mod's files suggest races and it declares none; `mod play --race` takes a
 * declared race; the heatmap's race letters. The replays and mods are made here. Where `SCMJS_COSMONARCHY` names
 * Cosmonarchy's release and its replay of BattleGuard is in the cache, the real replay too.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appendModTag, parseReplay, type ModTag } from "@scm-js/replay";
import { chk, cmds, le16, writeReplay } from "@scm-js/replay/write";
import { encodeTblFile } from "../src/formats/dat/tblFile";
import { emptyDat, encodeDat } from "../src/formats/dat/table";
import { decodeUnitsDat } from "../src/formats/dat/dat";
import { gameFilesHash as dataSetHash } from "./support/modHash";
import { raceCandidates } from "@scm-js/mod";
import { racePlaysAs } from "../src/formats/mod/races";
import { printReplayInfo, replayReport } from "../cli/src/replay";
import { replayNamer } from "../cli/src/replaymod";
import { openMod } from "../cli/src/mod/open";
import { modInfo, printModInfo } from "../cli/src/mod/info";
import { checkModSource, printModCheck } from "../cli/src/mod/check";
import { pageRace } from "../cli/src/mod/play";
import { raceLetter } from "../cli/src/heatmap";
import { setLocale } from "../cli/src/i18n";
import { CliError, visible } from "../cli/src/ui";

const ASKOSI = { id: 69, name: "Askosi", letter: "a", like: 1 as const };
const RACES = [ASKOSI, { id: 70, name: "Bloodsummon" }];

/** Three players: one of race 69 (a mod's own), one Zerg, one Protoss; two teams. */
const players = [
  { index: 0, id: 0, race: 69, name: "Wheat", team: 1 },
  { index: 1, id: 1, race: 0, name: "Kenoli", team: 2 },
  { index: 2, id: 2, race: 2, name: "Group B", team: 2 },
];
const commands = cmds([[10, 0, 0x1f, ...le16(7)], [20, 1, 0x1f, ...le16(41)]]);
const plain = () => writeReplay({ format: "legacy", players, commands, chk: chk(64, 64) });
const input = (bytes: Uint8Array, name = "game.rep") => ({ path: name, name, bytes, kind: "replay" as const });
const tag = (hash: string, races?: unknown): ModTag => ({
  v: 1, dataSet: { hash, name: "Test Mod", url: null, ...(races ? { races } : {}) }, plugins: [], firegraft: null, noplugins: false, engine: null, madeBy: "test",
});
const quiet = () => {};
const dir = mkdtempSync(join(tmpdir(), "scmjs-races-cli-"));
/** A player's row of the table (the last line that names them: the first is the title). */
const playerRow = (lines: string[], name: string) => lines.filter((l) => l.trimStart().startsWith(name)).at(-1) ?? "";

/** A mod folder of two files, and a mod.json naming it (and its races, when given). Its hash leaves mod.json out. */
async function madeMod(races?: unknown): Promise<{ folder: string; hash: string }> {
  const folder = join(dir, `mod-${Math.random().toString(36).slice(2)}`);
  const files = [
    { name: "arr\\units.dat", bytes: encodeDat(emptyDat("units")) },
    { name: "rez\\unitnames.tbl", bytes: encodeTblFile({ strings: Array.from({ length: 228 }, () => "\0"), encoding: "windows-1252" }) },
  ];
  for (const f of files) {
    const path = join(folder, ...f.name.split("\\"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, f.bytes);
  }
  writeFileSync(join(folder, "mod.json"), JSON.stringify({ name: "Test Mod", ...(races ? { races } : {}) }));
  return { folder, hash: await dataSetHash(files) };
}

describe("scmjs replay info and a race a mod adds", () => {
  afterEach(() => setLocale("en"));

  it("keeps the byte and says Race 69 when nothing names it, in the report and the table", async () => {
    const r = replayReport(input(plain()), await parseReplay(plain()));
    expect(r.players.map((p) => [p.name, p.race, p.raceId])).toEqual([["Wheat", "Race 69", 69], ["Kenoli", "Zerg", 0], ["Group B", "Protoss", 2]]);
    const lines = printReplayInfo(r).map(visible);
    expect(playerRow(lines, "Wheat")).toMatch(/^ *Wheat +Race 69 /);
    expect(playerRow(lines, "Kenoli")).toMatch(/Zerg/);
    // The matchup has no letter for a race nobody names.
    expect(lines[0]).toMatch(/\?vZP$/);
    setLocale("ko");
    expect(playerRow(printReplayInfo(r).map(visible), "Wheat")).toMatch(/종족 69/);
  });

  it("names it from the replay's tag", async () => {
    const rep = await parseReplay(await appendModTag(plain(), tag("0123456789abcdef", RACES)));
    const r = replayReport(input(plain()), rep);
    expect(r.players[0]).toMatchObject({ race: "Askosi", raceId: 69 });
    const lines = printReplayInfo(r).map(visible);
    expect(playerRow(lines, "Wheat")).toMatch(/Askosi/);
    expect(lines[0]).toMatch(/AvZP$/);
    // The JSON keeps what it had: the race a string, the tag as read.
    expect(JSON.parse(JSON.stringify(r)).mod.dataSet.races).toEqual(RACES);
    // A tag whose table is no table names nothing.
    const odd = replayReport(input(plain()), await parseReplay(await appendModTag(plain(), tag("0123456789abcdef", "Askosi"))));
    expect(odd.players[0].race).toBe("Race 69");
  });

  it("names it from the mod named with --mod when the tag does not", async () => {
    const mod = await madeMod(RACES);
    const rep = await parseReplay(await appendModTag(plain(), tag(mod.hash)));
    const names = await replayNamer(rep, "game.rep", { mod: mod.folder, warn: quiet });
    expect(names.from).toMatchObject({ kind: "mod", hash: mod.hash });
    expect(names.races).toEqual(RACES);
    const r = replayReport(input(plain()), rep, names.races);
    expect(r.players[0].race).toBe("Askosi");
    expect(printReplayInfo(r, names.races).map(visible)[0]).toMatch(/AvZP$/);
    // The tag's own table first.
    const told = await parseReplay(await appendModTag(plain(), tag(mod.hash, [{ id: 69, name: "From The Tag" }])));
    expect(replayReport(input(plain()), told, names.races).players[0].race).toBe("From The Tag");
    // A mod.json with no races: Race 69 still.
    const bare = await madeMod();
    const bareNames = await replayNamer(await parseReplay(await appendModTag(plain(), tag(bare.hash))), "game.rep", { mod: bare.folder, warn: quiet });
    expect(bareNames.races).toEqual([]);
  });
});

describe("scmjs mod and the races a mod declares", () => {
  /** A folder of the game's files whose network.tbl runs past the game's and that has a console of its own. */
  function hinting(json?: unknown): string {
    const folder = join(dir, `hint-${Math.random().toString(36).slice(2)}`);
    const put = (path: string, b: Uint8Array) => { mkdirSync(join(folder, path, ".."), { recursive: true }); writeFileSync(join(folder, path), b); };
    put("rez/network.tbl", encodeTblFile({ strings: [...Array.from({ length: 168 }, (_, i) => `S${i}`), "Askosi", "Bloodsummon"], encoding: "windows-1252" }));
    put("game/aconsole.pcx", new Uint8Array([10, 5, 1, 8]));
    put("rez/statbtna.bin", new Uint8Array([1]));
    if (json) writeFileSync(join(folder, "mod.json"), JSON.stringify(json));
    return folder;
  }

  it("mod info lists the races mod.json declares", async () => {
    const info = modInfo(await openMod(hinting({ name: "Hinting", races: RACES }), null));
    expect(info.races).toEqual(RACES);
    const lines = printModInfo(info).map(visible);
    expect(lines).toContainEqual(expect.stringMatching(/^ {2}Races +Askosi \(race 69, letter a, plays as Terran\), Bloodsummon \(race 70\)$/));
    expect(modInfo(await openMod(hinting(), null)).races).toEqual([]);
    expect(printModInfo(modInfo(await openMod(hinting(), null))).map(visible).some((l) => /Races/.test(l))).toBe(false);
  });

  it("mod check hints at races the files suggest when none are declared, and fails nothing for it", async () => {
    const r = await checkModSource(await openMod(hinting(), null), null);
    expect(r.failed).toBe(false);
    expect(r.findings.some((f) => /race/i.test(f.why))).toBe(false);
    expect(r.hints).toHaveLength(1);
    expect(r.hints[0]).toMatch(/Askosi, Bloodsummon/);
    expect(r.hints[0]).toMatch(/letters a\b/);
    // No colour in what the check says (FORCE_COLOR=1 runs too).
    expect(visible(r.hints[0])).toBe(r.hints[0]);
    expect(printModCheck(r).map(visible).filter((l) => l.includes("Askosi"))).toHaveLength(1);
    // Declared: no hint.
    const declared = await checkModSource(await openMod(hinting({ name: "Hinting", races: RACES }), null), null);
    expect(declared.hints).toEqual([]);
  });

  it("mod play --race takes a declared race by name or number, and the game's four as before", () => {
    expect([pageRace("zerg"), pageRace("T"), pageRace("protoss"), pageRace("r")]).toEqual([0, 1, 2, 6]);
    expect([pageRace("Askosi", RACES), pageRace("askosi", RACES), pageRace("70", RACES), pageRace("terran", RACES)]).toEqual([69, 69, 70, 1]);
    expect(() => pageRace("69")).toThrow(/is not a race: zerg, terran, protoss or random$/);
    expect(() => pageRace("Kogri", RACES)).toThrow(CliError);
    try { pageRace("Kogri", RACES); } catch (e) {
      expect((e as Error).message).toBe("--race Kogri is not a race: zerg, terran, protoss, random, or one the mod declares (Askosi 69, Bloodsummon 70)");
    }
  });

  it("the heatmap's letters: the game's three, a declared letter, else ?", () => {
    expect(["zerg", "terran", "protoss"].map((r) => raceLetter(r))).toEqual(["Z", "T", "P"]);
    expect(raceLetter("69", RACES)).toBe("A");
    expect(raceLetter("race 69", RACES)).toBe("A");
    expect(raceLetter("70", RACES)).toBe("?"); // declared without a letter
    expect(raceLetter("69")).toBe("?");
    expect(raceLetter("unknown", RACES)).toBe("?");
  });
});

/* ── Cosmonarchy's release and its replay, where this machine has them ── */

const releaseOf = (root: string) => (existsSync(join(root, "mpq/arr/units.datex")) ? root : join(root, "release"));
const release = process.env.SCMJS_COSMONARCHY ? releaseOf(process.env.SCMJS_COSMONARCHY) : "";
const replayPath = process.env.SCMJS_COSMONARCHY_REPLAY ?? join(homedir(), ".cache/scmjs-cosmonarchy/replays/40ca0e2_17-28_BattleGuard.rep");
const haveReal = !!release && existsSync(join(release, "mpq/arr/units.datex")) && existsSync(replayPath);

/** Every file under `root`, by its path there. */
function filesUnder(root: string, at = root): string[] {
  return readdirSync(at).flatMap((name) => { const full = join(at, name); return statSync(full).isDirectory() ? filesUnder(root, full) : [relative(root, full)]; });
}

if (haveReal) {
  describe("Cosmonarchy's replay of BattleGuard (SCMJS_COSMONARCHY)", () => {
    it("says Race 69 for the player of the mod's fourth race, and names it from a tag", async () => {
      const bytes = new Uint8Array(readFileSync(replayPath));
      const rep = await parseReplay(bytes);
      const r = replayReport(input(bytes, "BattleGuard.rep"), rep);
      expect(r.players.map((p) => [p.race, p.raceId])).toEqual([["Race 69", 69], ["Zerg", 0], ["Protoss", 2]]);
      expect(playerRow(printReplayInfo(r).map(visible), r.players[0].name)).toMatch(/Race 69/);
      const named = replayReport(input(bytes, "BattleGuard.rep"), await parseReplay(await appendModTag(bytes, tag("0123456789abcdef", [ASKOSI]))));
      expect(named.players[0].race).toBe("Askosi");
    });

    it("plays as Terran by the units the player builds, and the mod's files hint at its names and letter", async () => {
      const rep = await parseReplay(new Uint8Array(readFileSync(replayPath)));
      const units = decodeUnitsDat(new Uint8Array(readFileSync(join(release, "mpq/arr/units.datex"))), "units.datex");
      const built = (id: number) => rep.commands.filter((c) => c.player === id && ["train", "build", "morph", "buildingMorph"].includes(c.kind) && c.unit !== undefined).map((c) => c.unit!);
      const [wheat, zerg] = rep.players;
      expect(racePlaysAs(built(wheat.id), units)).toBe(1);
      expect(racePlaysAs(built(zerg.id), units)).toBe(0);
      const found = raceCandidates({ network: new Uint8Array(readFileSync(join(release, "mpq/rez/network.tbl"))), paths: filesUnder(join(release, "mpq")) });
      expect(found.names.map((n) => n.name)).toEqual(expect.arrayContaining(["Askosi", "Bloodsummon", "Kogri"]));
      expect(found.letters).toContain("a");
    });
  });
}
