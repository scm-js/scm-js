/**
 * `scmjs bot run` (cli/src/botrun.ts): the engine fetched into the cache from a `current.json`, the copy of the game
 * found, the runner run as a process and its JSON lines worded. The runner here is a stand-in script that prints the
 * lines scm-sim's prints; the real one needs the lifted game and a copy of StarCraft, which CI has not got.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { cacheRoot, ensureEngine, findGameCopy, gameCopyKind, runBotGame, usualGameFolders, wordLine, type EndLine } from "../cli/src/botrun";
import { CliError, visible } from "../cli/src/ui";

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
    const said: string[] = [];
    const fetched = await ensureEngine(`http://127.0.0.1:${port}/play`, cache, (l) => said.push(visible(l)));
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
    writeFileSync(join(dir, "m.scx"), "MPQ");
    const lines: string[] = [];
    const r = await runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: copy, seed: 7, frames: 2000, every: 1000, race: "protoss", live: (l) => lines.push(visible(l)) });
    expect(r.game).toEqual({ folder: copy, kind: "classic" });
    expect(r.start?.map.name).toBe("m.scx");
    expect(r.texts).toEqual(["The map is Boxer!"]);
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
  });

  it("says what went wrong: no bot file, no copy, a runner that could not start", async () => {
    const staged = stagedEngine(tmp());
    const copy = classicCopy(tmp());
    const dir = tmp();
    writeFileSync(join(dir, "x.scmbot"), "SCMBOT1\n");
    writeFileSync(join(dir, "m.scx"), "MPQ");
    await expect(runBotGame(join(dir, "none.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: copy })).rejects.toThrow(/No file .*none\.scmbot/);
    await expect(runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: staged.dir, starcraft: tmp() })).rejects.toThrow(CliError);
    // An engine folder with no core.js: the stand-in runner answers with an error line, which becomes the message.
    const broken = stagedEngine(tmp());
    const { rmSync } = await import("node:fs");
    rmSync(join(broken.dir, broken.build, "core.js"));
    await expect(runBotGame(join(dir, "x.scmbot"), join(dir, "m.scx"), { engine: broken.dir, starcraft: copy })).rejects.toThrow(/no engine at/);
  });
});
