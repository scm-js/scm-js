/**
 * `scmjs bot run` (cli/src/botrun.ts): the engine fetched into the cache from a `current.json`, the copy of the game
 * found, the runner run as a process and its JSON lines worded. The runner here is a stand-in script that prints the
 * lines scm-sim's prints; the real one needs the lifted game and a copy of StarCraft, which CI has not got.
 */
import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { botRunValues, cacheRoot, checkBotGame, gameKind, looksLikeMapSettings, ensureEngine, findGameCopy, gameCopyKind, plainRunnerError, runBotGame, usualGameFolders, wordLine, type EndLine } from "../cli/src/botrun";
import { TEST_MAPS_DIR } from "./support/maps";
import { CliError, visible } from "../cli/src/ui";
import { checkBotFolder } from "../cli/src/bot";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-botrun-"));

/** A runner that prints what scm-sim's does, from its arguments: a start, two texts, progress lines, an end. */
const FAKE_RUNNER = `
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!require("node:fs").existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
const players = [{ slot: 0, kind: "computer", race: "zerg", minerals: 50, gas: 0, supplyUsed: 4, supplyAvailable: 9, outcome: null }, { slot: 1, kind: "bot", race: flag("race") ?? "protoss", minerals: 50, gas: 0, supplyUsed: 4, supplyAvailable: 9, outcome: null }];
say({ kind: "start", bot: { name: "Fake", commit: "abc", memoryPages: 20480 }, map: { name: require("node:path").basename(args[0]), width: 96, height: 96, tileset: "platform" }, copy: "classic", seed: Number(flag("seed") ?? 1), players, ms: { load: 1, start: 2 } });
say({ kind: "text", text: "The map is Boxer!" });
say({ kind: "text", text: "oracle: gl hf" });
const frames = Number(flag("frames") ?? 3000), every = Number(flag("every") ?? 1000);
for (let f = every; f <= frames; f += every) say({ kind: "progress", frame: f, units: { visible: 70, hidden: 0 }, players, ms: { game: f / 4, bot: f / 20 } });
const won = flag("seed") === "7";
say({ kind: "end", frame: frames, units: { visible: 70, hidden: 0 }, players, bot: { name: "Fake", commit: "abc", memoryPages: 20480 }, seed: Number(flag("seed") ?? 1), ended: won, outcome: won ? "victory" : null, reason: won ? "victory" : null, commandBytes: 2048, errors: flag("race") === "terran" ? ["boom"] : [], hash: 7, ms: { game: frames / 4, bot: frames / 20, load: 1, start: 2, total: frames / 3 } });
process.exit(flag("race") === "terran" ? 1 : 0);
`;

/** A folder shaped like a staged engine: the four files, a runner and current.json. */
function stagedEngine(dir: string, runner = FAKE_RUNNER): { dir: string; build: string } {
  const build = "abcdef123456";
  const sub = join(dir, build);
  mkdirSync(sub, { recursive: true });
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "run-feedface.cjs"), runner);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", runnerBytes: runner.length }));
  return { dir, build };
}

/** A folder shaped like a 1.16.1 copy of the game. */
function classicCopy(dir: string): string {
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}

const servers: ReturnType<typeof createServer>[] = [];
afterAll(() => { for (const s of servers) s.close(); });

describe("scmjs bot run", () => {
  it("knows the cache folder and the usual places a copy of the game is", () => {
    expect(cacheRoot({ XDG_CACHE_HOME: "/x" } as NodeJS.ProcessEnv, "/home/u")).toBe("/x/scmjs");
    expect(cacheRoot({ SCMJS_CACHE: "/c" } as NodeJS.ProcessEnv, "/home/u")).toBe("/c");
    expect(cacheRoot({} as NodeJS.ProcessEnv, "/home/u")).toBe("/home/u/.cache/scmjs");
    expect(usualGameFolders({ SCMJS_STARCRAFT: "/sc" } as NodeJS.ProcessEnv)[0]).toBe("/sc");
    expect(usualGameFolders({ "ProgramFiles(x86)": "C:\\PF" } as NodeJS.ProcessEnv)).toContain(join("C:\\PF", "StarCraft"));
    const dir = tmp();
    expect(gameCopyKind(dir)).toBeNull();
    writeFileSync(join(dir, ".build.info"), "");
    expect(gameCopyKind(dir)).toBe("remastered");
    expect(findGameCopy(dir)).toEqual({ folder: dir, kind: "remastered" });
    expect(() => findGameCopy(tmp())).toThrow(/not a copy of StarCraft/);
  });

  it("finds a 1.16.1 copy whatever the case of its archives' names", () => {
    const lower = tmp();
    for (const f of ["stardat.mpq", "broodat.mpq"]) writeFileSync(join(lower, f), "mpq");
    expect(gameCopyKind(lower)).toBe("classic");
    expect(findGameCopy(lower)).toEqual({ folder: lower, kind: "classic" });
    const upper = tmp();
    for (const f of ["STARDAT.MPQ", "BrooDat.mpq", "patch_rt.mpq"]) writeFileSync(join(upper, f), "mpq");
    expect(gameCopyKind(upper)).toBe("classic");
    expect(gameCopyKind(classicCopy(tmp()))).toBe("classic");
    const one = tmp();
    writeFileSync(join(one, "stardat.mpq"), "mpq");
    expect(gameCopyKind(one)).toBeNull();
    expect(gameCopyKind(join(one, "not-there"))).toBeNull();
  });

  it("takes an engine from a staged folder, and fetches one into the cache from the page's address", async () => {
    const staged = stagedEngine(tmp());
    const local = await ensureEngine(staged.dir);
    expect(local).toMatchObject({ build: staged.build, runner: "run-feedface.cjs", fetched: 0 });
    expect(local.dir).toBe(join(staged.dir, staged.build));

    // Served as the bucket serves it: the engine's files gzip-compressed, current.json plain.
    const server = createServer((req, res) => {
      const path = join(staged.dir, decodeURIComponent((req.url ?? "/").replace(/^\/play\/engine\//, "")));
      if (!existsSync(path)) { res.statusCode = 404; res.end(); return; }
      const bytes = readFileSync(path);
      res.end(path.endsWith("current.json") ? bytes : gzipSync(bytes));
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as { port: number }).port;
    const cache = tmp();
    // The line is standard error's, whatever the command (its standard output may be JSON).
    const said: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => { said.push(visible(String(chunk))); return true; }) as typeof process.stderr.write;
    const fetched = await ensureEngine(`http://127.0.0.1:${port}/play`, cache).finally(() => { process.stderr.write = write; });
    expect(fetched.build).toBe(staged.build);
    expect(fetched.fetched).toBeGreaterThan(0);
    expect(said[0]).toMatch(/Fetching the game engine/);
    expect(readFileSync(join(cache, "engine", staged.build, "core.js"), "utf8")).toBe("// core.js\n");
    expect(readFileSync(join(cache, "engine", staged.build, "run-feedface.cjs"), "utf8")).toBe(FAKE_RUNNER);
    const again = await ensureEngine(`http://127.0.0.1:${port}/play`, cache);
    expect(again.fetched).toBe(0);
    await expect(ensureEngine(`http://127.0.0.1:${port}/nowhere`, cache)).rejects.toThrow(/answered 404/);
    await expect(ensureEngine(tmp())).rejects.toThrow(/holds no engine/);
  });

  it("runs the runner, words its lines as they come, and keeps them", async () => {
    const staged = stagedEngine(tmp());
    const copy = classicCopy(tmp());
    const dir = tmp();
    writeFileSync(join(dir, "x.scmbot"), "SCMBOT1\n");
    copyFileSync(join(TEST_MAPS_DIR, "melee.scx"), join(dir, "m.scx"));
    const lines: string[] = [];
    const r = await runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: copy, seed: 7, frames: 2000, every: 1000, race: "protoss", live: (l) => lines.push(visible(l)) });
    expect(r.game).toEqual({ folder: copy, kind: "classic" });
    expect(r.start?.map.name).toBe("m.scx");
    // (the game's name for the bot's player is the engine's word: the bot's own name is said)
    expect(r.texts).toEqual(["The map is Boxer!", "Fake: gl hf"]);
    expect(r.progress.map((p) => p.frame)).toEqual([1000, 2000]);
    expect(r.end).toMatchObject({ outcome: "victory", ended: true, frame: 2000 });
    expect(r.exitCode).toBe(0);
    expect(lines[0]).toMatch(/Fake on m\.scx 96 × 96, platform · computer zerg vs bot protoss · seed 7 · 1\.16\.1 files/);
    expect(lines.at(-1)).toMatch(/the bot won at frame 2000 · 2\.0 KB of orders/);
    expect(lines.filter((l) => /^\s+frame\s+\d+/.test(l))).toHaveLength(2);

    const lost = await runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: copy, seed: 1, frames: 1000, race: "terran" });
    expect(lost.exitCode).toBe(1);
    expect(lost.end?.errors).toEqual(["boom"]);
    expect(visible(wordLine(lost.end as EndLine)!)).toMatch(/no outcome after 1,000 frames.*1 error/);
    // A loss is a result, not an error: no error mark.
    expect(visible(wordLine({ ...(lost.end as EndLine), outcome: "defeat", ended: true })!)).toMatch(/^▲ the bot lost at frame 1000/);
  });

  it("says what went wrong: no bot file, no copy, a runner that could not start", async () => {
    const staged = stagedEngine(tmp());
    const copy = classicCopy(tmp());
    const dir = tmp();
    writeFileSync(join(dir, "x.scmbot"), "SCMBOT1\n");
    copyFileSync(join(TEST_MAPS_DIR, "melee.scx"), join(dir, "m.scx"));
    await expect(runBotGame(join(dir, "none.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: copy })).rejects.toThrow(/No file .*none\.scmbot/);
    await expect(runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: tmp() })).rejects.toThrow(CliError);
    // An engine folder with no core.js: the stand-in runner answers with an error line, which becomes the message.
    const broken = stagedEngine(tmp());
    const { rmSync } = await import("node:fs");
    rmSync(join(broken.dir, broken.build, "core.js"));
    await expect(runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: broken.dir, starcraft: copy })).rejects.toThrow(/no engine at/);
  });

  it("reads every value before anything starts, and refuses a bad one with exit 2", async () => {
    const v = await botRunValues({ race: "t", opponents: "Zerg, p", seed: "7", frames: "1:00", every: "0" });
    expect(v).toEqual({ race: "terran", opponents: ["zerg", "protoss"], seed: 7, frames: 1429, every: 0 });
    const file = join(tmp(), "afile"); writeFileSync(file, "x");
    const bad: [Partial<Parameters<typeof botRunValues>[0]>, RegExp][] = [
      [{ frames: "abc" }, /--frames takes/], [{ frames: "0" }, /--frames takes/], [{ frames: "-5" }, /--frames takes/],
      [{ seed: "abc" }, /--seed takes/], [{ every: "abc" }, /--every takes/], [{ race: "bogus" }, /--race: "bogus" is not a race/],
      [{ opponents: "bogus" }, /--opponents: "bogus" is not a race/], [{ opponents: "" }, /--opponents names no race/], [{ data: file }, /is a file, not a folder/],
    ];
    for (const [o, said] of bad) {
      const e = await botRunValues({ race: "random", opponents: "zerg", frames: "50000", every: "1000", ...o }).catch((x) => x);
      expect(e, JSON.stringify(o)).toBeInstanceOf(CliError);
      expect(e.message).toMatch(said);
      expect(e.exitCode).toBe(2);
    }
  });

  it("looks at the bot and the map before the game starts: each the right kind, the map one the game opens, with room", async () => {
    const dir = tmp();
    const bot = join(dir, "b.scmbot"); writeFileSync(bot, "SCMBOT1\n\0\0\0\0");
    const melee = join(TEST_MAPS_DIR, "melee.scx");
    await expect(checkBotGame(bot, melee)).resolves.toEqual({ starts: 2, mapSettings: false });
    const rep = join(dir, "g.rep"); writeFileSync(rep, Buffer.concat([Buffer.alloc(12), Buffer.from("seRS"), Buffer.alloc(64)]));
    mkdirSync(join(dir, "mybot", "out"), { recursive: true });
    writeFileSync(join(dir, "mybot", "out", "mybot.scmbot"), "SCMBOT1\n");
    const cases: [string, string, object, RegExp, RegExp | null][] = [
      [melee, bot, {}, /melee\.scx is a map, not a bot: the bot comes first/, /scmjs bot run <bot> <map>/],
      [bot, rep, {}, /g\.rep is a replay, not a map/, /scmjs replay map/],
      [join(dir, "mybot"), melee, {}, /mybot is a folder: its built bot is .*mybot\.scmbot/, /scmjs bot run .*mybot\.scmbot/],
      [bot, dir, {}, /is a folder, not a map/, null],
      [join(dir, "none.scmbot"), melee, {}, /No file/, null],
      [bot, join(TEST_MAPS_DIR, "ums.scx"), {}, /compressed with zlib, which only StarCraft: Remastered opens/, /--compression pkware/],
      [bot, melee, { opponents: 2 }, /has 2 start locations: the bot and 2 computers do not fit/, /fewer --opponents/],
    ];
    for (const [b, m, o, said, hint] of cases) {
      const e = await checkBotGame(b, m, o).catch((x) => x);
      expect(e, `${b} ${m}`).toBeInstanceOf(CliError);
      expect(e.message).toMatch(said);
      if (hint) expect(e.hint).toMatch(hint);
      expect(e.exitCode).toBe(2);
    }
    // A map's own settings (--ums) seat the players as the map does: not counted.
    await expect(checkBotGame(bot, melee, { opponents: 2, game: "ums" })).resolves.toMatchObject({ starts: 2 });
  });

  it("plays a melee map as melee under a mod with no plugins (a FireGraft project alone is no reason for the map's own settings)", async () => {
    const overlay = (plugins: number) => ({ layers: async () => [], report: (m: never) => m, remove: () => {}, plugins: async () => plugins });
    expect(await gameKind(false, overlay(0))).toBe("melee");
    expect(await gameKind(false, overlay(2))).toBeUndefined();
    expect(await gameKind(true, overlay(0))).toBeUndefined();
    expect(await gameKind(false, null)).toBeUndefined();
    const melee = { playerTypes: [6, 6, 0, 0, 0, 0, 0, 0], units: [{ owner: 0, unitId: 214 }, { owner: 11, unitId: 176 }] };
    expect(looksLikeMapSettings(melee)).toBe(false);
    expect(looksLikeMapSettings({ ...melee, playerTypes: [6, 5, 0, 0, 0, 0, 0, 0] })).toBe(true);
    expect(looksLikeMapSettings({ ...melee, units: [...melee.units, { owner: 1, unitId: 0 }] })).toBe(true);
  });

  it("says a missing licence file before the toolchain starts", () => {
    const dir = tmp();
    writeFileSync(join(dir, "scmbot.json"), JSON.stringify({ key: "b", license: "LICENSE" }));
    const e = (() => { try { checkBotFolder(dir); } catch (x) { return x as CliError; } })();
    expect(e).toBeInstanceOf(CliError);
    expect(e!.message).toBe("scmbot.json names LICENSE as the bot's licence, and there is no LICENSE here.");
    expect(e!.exitCode).toBe(2);
    writeFileSync(join(dir, "LICENSE"), "MIT");
    expect(() => checkBotFolder(dir)).not.toThrow();
    expect(() => checkBotFolder(tmp())).not.toThrow();
  });

  it("says the runner's error without the game's insides", () => {
    delete process.env.SCMJS_DEBUG;
    expect(plainRunnerError("the game did not take this map (it opens only a map StarCraft itself opens: a whole .scm or .scx): no stand-in for kernel32.dll!LoadLibraryA (called from 0x1501E69D; stack words 15052680 0 0 3002007c)"))
      .toBe("the game did not take this map (it opens only a map StarCraft itself opens: a whole .scm or .scx)");
    expect(plainRunnerError("the game stopped reading its startup data again: neither the mod nor the game has unit\\zerg\\avenger.grp; the game ended the process (the game's fatal error, from 0x4d29c5): unit\\zerg\\avenger.grp"))
      .toBe("the game stopped reading its startup data again: neither the mod nor the game has unit\\zerg\\avenger.grp; the game ended the process: unit\\zerg\\avenger.grp");
    expect(plainRunnerError("\"bogus\" is not a race: zerg, terran, protoss or random.")).toBe("\"bogus\" is not a race: zerg, terran, protoss or random.");
    // The toolchain's commands as this command names them, the newest toolchain first.
    expect(plainRunnerError("bot1 was built before bots could play beside a mod's plugins (its memory starts at 1 GB, where eudenabler's plugins keep theirs): build it again with the scmbot toolchain (scmbot build) to play it with eudenabler."))
      .toBe("bot1 was built before bots could play beside a mod's plugins (its memory starts at 1 GB, where eudenabler's plugins keep theirs): build it again with the newest toolchain (scmjs bot update, then scmjs bot build) to play it with eudenabler.");
    process.env.SCMJS_DEBUG = "1";
    try { expect(plainRunnerError("x (from 0x4d29c5)")).toBe("x (from 0x4d29c5)"); } finally { delete process.env.SCMJS_DEBUG; }
  });
});
