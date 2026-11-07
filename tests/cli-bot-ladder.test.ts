/**
 * `scmjs bot ladder` (cli/src/ladder.ts): the entrants read off the command line, the schedule, the replay names, the
 * Elo maths, the standing and head-to-head, and the ladder run over a stand-in match runner that prints the lines
 * scm-sim's prints and writes a replay where it is asked to. The real runner needs the lifted game, the bots and a copy
 * of StarCraft, which CI has not got.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  eloRatings, expected, gameLine, headToHead, ladderFolder, ladderJson, ladderLines, parseEntrants, parseRaces, raceLetter, replayName, runLadder, schedule, standings,
  type Entrant, type GameResult, type MatchEnd, type ScheduledGame,
} from "../cli/src/ladder";
import { CliError, visible } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-ladder-"));

/** A `.scmbot` with only its header: what the ladder reads of a bot. */
function botFile(dir: string, file: string, key: string, name: string): string {
  const header = new TextEncoder().encode(JSON.stringify({ format: 1, key, name, memoryPages: 20480, commit: "abc" }));
  const bytes = new Uint8Array(12 + header.length);
  bytes.set(new TextEncoder().encode("SCMBOT1\n"));
  new DataView(bytes.buffer).setUint32(8, header.length, true);
  bytes.set(header, 12);
  const path = join(dir, file);
  writeFileSync(path, bytes);
  return path;
}

const bot = (key: string, label = key, race: Entrant["race"] = null): Entrant => ({ key, label, kind: "bot", file: `/b/${key}.scmbot`, race });
const computer = (r: "z" | "t" | "p"): Entrant => ({ key: `computer-${r}`, label: `${r} computer`, kind: "computer", race: r });

/** A game's result as the ladder keeps it: `won` 0 or 1 is the side that won, null undecided. */
function result(index: number, sides: [number, number], won: 0 | 1 | null, o: { by?: MatchEnd["by"]; frames?: number; crashed?: 0 | 1; ms?: number } = {}): GameResult {
  const game: ScheduledGame = { index, sides, races: ["p", "z"], map: "m.scx", seed: index, replay: `g${index}.rep` };
  const end: MatchEnd = {
    frame: o.frames ?? 10_000, seed: index, decided: won !== null, winner: won, by: o.by ?? (won === null ? "frames" : "victory"),
    players: [0, 1].map((k) => ({ side: k, slot: k, kind: "bot" as const, name: `s${k}`, race: k ? "zerg" : "protoss", minerals: 0, gas: 0, supplyUsed: 0, supplyAvailable: 0, outcome: won === null ? null : won === k ? "victory" as const : "defeat" as const })),
    bots: [0, 1].map((k) => ({ side: k, name: `s${k}`, commit: "", state: o.crashed === k ? "crashed" as const : "ended" as const, error: null, frames: o.frames ?? 10_000, ms: (o.ms ?? 1) * (o.frames ?? 10_000), maxMs: 40 + k, over55: k, over1s: 0, over10s: 0, commands: 100, kept: 1 })),
    replay: { file: `g${index}.rep`, bytes: 10, agreed: true }, hashes: { compared: 400, differedAt: null }, ms: { game: 1, bots: [1, 1], total: 2 },
  };
  return { game, end, error: null, winner: won === null ? null : sides[won], replay: `g${index}.rep` };
}

describe("scmjs bot ladder: who plays", () => {
  it("reads races as letters or words, each once", () => {
    expect(parseRaces("tpz")).toEqual(["t", "p", "z"]);
    expect(parseRaces("t,p,t")).toEqual(["t", "p"]);
    expect(raceLetter("Protoss")).toBe("p");
    expect(raceLetter("x")).toBeNull();
    expect(() => parseRaces("tx")).toThrow(/"x" is not a race/);
  });

  it("names bots by their files' headers, a race after a colon, and the computer once a race", () => {
    const dir = tmp();
    const a = botFile(dir, "a.scmbot", "mcrave", "McRave"), b = botFile(dir, "b.scmbot", "uab", "UAlbertaBot");
    const e = parseEntrants([`${a}:z`, b, "computer"], ["t", "p"]);
    expect(e.map((x) => [x.key, x.label, x.kind, x.race])).toEqual([
      ["mcrave", "McRave", "bot", "z"], ["uab", "UAlbertaBot", "bot", null], ["computer-t", "Terran computer", "computer", "t"], ["computer-p", "Protoss computer", "computer", "p"],
    ]);
    expect(parseEntrants([a, "computer:zerg"], ["t"]).map((x) => x.key)).toEqual(["mcrave", "computer-z"]);
    // The same bot twice (a bot against itself): told apart by key and label.
    expect(parseEntrants([a, a], ["r"]).map((x) => [x.key, x.label])).toEqual([["mcrave", "McRave"], ["mcrave-2", "McRave (mcrave-2)"]]);
  });

  it("takes a colon that is not a race as part of the path, and says what is wrong", () => {
    const dir = tmp();
    const odd = join(dir, "x:y");
    mkdirSync(odd);
    botFile(odd, "a.scmbot", "a", "A");
    expect(parseEntrants([join(odd, "a.scmbot"), "computer:t"], ["r"])[0].file).toBe(join(odd, "a.scmbot"));
    expect(() => parseEntrants([join(dir, "none.scmbot"), "computer"], ["r"])).toThrow(/No file/);
    writeFileSync(join(dir, "map.scx"), "MPQ");
    expect(() => parseEntrants([join(dir, "map.scx"), "computer"], ["r"])).toThrow(/is not a bot file/);
    expect(() => parseEntrants([botFile(dir, "c.scmbot", "c", "C")], ["r"])).toThrow(/two sides at least/);
    expect(() => parseEntrants(["computer"], ["t", "z"])).toThrow(/needs a bot/);
    try { parseEntrants(["computer:t"], ["r"]); } catch (e) { expect((e as CliError).exitCode).toBe(2); }
  });
});

describe("scmjs bot ladder: the schedule", () => {
  it("plays a bot against the computer once, two bots both ways round, and never two computers", () => {
    const e = [bot("a", "A", "p"), bot("b", "B", "z"), computer("t"), computer("z")];
    const g = schedule(e, ["m1.scx", "m2.scx"], ["r"], [1, 2]);
    // A pairing of bots twice, each bot against each computer once: 2 + 4 a map and a seed.
    expect(g).toHaveLength(6 * 2 * 2);
    expect(g.map((x) => x.index)).toEqual(g.map((_, i) => i + 1));
    const first = g.filter((x) => x.seed === 1 && x.map === "m1.scx").map((x) => `${e[x.sides[0]].key}-${e[x.sides[1]].key}`);
    expect(first).toEqual(["a-b", "b-a", "a-computer-t", "a-computer-z", "b-computer-t", "b-computer-z"]);
    // Rounds first: every game of seed 1 before any of seed 2.
    expect(g.findIndex((x) => x.seed === 2)).toBe(12);
    expect(g.every((x) => e[x.sides[0]].kind === "bot")).toBe(true);
  });

  it("gives a side with no race of its own each race asked for, and names every replay apart", () => {
    const e = [bot("a"), bot("b", "B", "z"), computer("t")];
    const g = schedule(e, ["(2)Boxer.scm"], ["t", "p"], [7]);
    expect(g.map((x) => `${x.races.join("")}`)).toEqual(["tz", "zt", "pz", "zp", "tt", "pt", "zt"]);
    expect(g[0].replay).toBe("a-vs-b_boxer_TvZ_seed7.rep");
    expect(g[1].replay).toBe("b-vs-a_boxer_ZvT_seed7.rep");
    expect(g[4].replay).toBe("a-vs-computer-t_boxer_TvT_seed7.rep");
    expect(g[6].replay).toBe("b-vs-computer-t_boxer_ZvT_seed7.rep");
    expect(new Set(g.map((x) => x.replay)).size).toBe(g.length);
    expect(replayName(e[0], e[2], "t", "t", "maps/(4)Lost Temple.scx", 3)).toBe("a-vs-computer-t_lost-temple_TvT_seed3.rep");
    expect(replayName(e[0], e[2], "t", "t", "m.scx", 3, 2)).toBe("a-vs-computer-t_m_TvT_seed3-2.rep");
  });

  it("names its folder by the date and time, and does not take one that is there", () => {
    const dir = tmp();
    const now = new Date(2026, 10, 7, 9, 5);
    expect(ladderFolder(dir, now)).toBe(join(dir, "ladder-2026-11-07-0905"));
    mkdirSync(join(dir, "ladder-2026-11-07-0905"));
    expect(ladderFolder(dir, now)).toBe(join(dir, "ladder-2026-11-07-0905-2"));
  });
});

describe("scmjs bot ladder: Elo and the standing", () => {
  it("moves a win between equals by K/2, a draw between equals not at all, and counts nothing for a game not played", () => {
    expect(expected(1500, 1500)).toBe(0.5);
    expect(expected(1900, 1500)).toBeCloseTo(10 / 11, 6);
    expect(eloRatings(2, [result(1, [0, 1], 0)])).toEqual([1516, 1484]);
    expect(eloRatings(2, [result(1, [0, 1], null)])).toEqual([1500, 1500]);
    expect(eloRatings(2, [{ ...result(1, [0, 1], 0), end: null, error: "no map", winner: null }])).toEqual([1500, 1500]);
    expect(eloRatings(2, [result(1, [0, 1], 0, { by: "desync" })])).toEqual([1500, 1500]);
    // The second game between them: the favourite's win is worth less than the first.
    const [a, b] = eloRatings(2, [result(1, [0, 1], 0), result(2, [1, 0], 1)]);
    expect(a - 1516).toBeCloseTo(32 * (1 - expected(1516, 1484)), 9);
    expect(a + b).toBeCloseTo(3000, 9);
    // Scheduled order, not the order the games ended in.
    const games = [result(1, [0, 1], 0), result(2, [0, 1], 1), result(3, [0, 1], 1)];
    expect(eloRatings(2, [...games].reverse())).toEqual(eloRatings(2, games));
  });

  it("tables each side's games, wins, length and time a frame, best Elo first, and the head-to-head", () => {
    const e = [bot("a", "A"), bot("b", "B"), computer("t")];
    const games = [
      result(1, [0, 1], 0, { frames: 12_000, ms: 2 }), result(2, [1, 0], 1, { frames: 8_000, ms: 2 }), result(3, [0, 2], 0, { frames: 10_000 }),
      result(4, [1, 2], null, { frames: 24_000 }), result(5, [1, 2], 1, { crashed: 0, by: "left", frames: 500 }),
    ];
    const s = standings(e, games);
    expect(s.map((x) => x.key)).toEqual(["a", "computer-t", "b"]);
    expect(s[0]).toMatchObject({ games: 3, won: 3, lost: 0, undecided: 0, frames: 10_000, crashed: 0 });
    expect(s[0].msPerFrame).toBeCloseTo((2 * 12_000 + 2 * 8_000 + 10_000) / 30_000, 9);
    expect(s[2]).toMatchObject({ games: 4, won: 0, lost: 3, undecided: 1, crashed: 1 });
    expect(s[1].msPerFrame).toBeNull();
    const h = headToHead(3, games);
    expect(h[0][1]).toEqual([2, 0, 0]);
    expect(h[1][0]).toEqual([0, 2, 0]);
    expect(h[1][2]).toEqual([0, 1, 1]);
    expect(h[0][0]).toBeNull();
    const lines = ladderLines(e, games).map(visible);
    expect(lines[1]).toBe("Standing");
    expect(lines[3]).toMatch(/^ {2}1 +A +15\d\d +3 +3 +0 +0 +7:00 +1\.67 +41 ms +1$/);
    expect(lines.some((l) => /B: its copy failed in 1 game/.test(l))).toBe(true);
    expect(lines.some((l) => l.startsWith("Head to head"))).toBe(true);
  });

  it("words each game as it ends: the winner, undecided, the copies out of step, not played", () => {
    const e = [bot("a", "A"), bot("b", "B")];
    // Side 0 (B) played protoss, side 1 (A) zerg; side 1 won.
    expect(visible(gameLine(result(3, [1, 0], 1, { frames: 14_400 }), e, 12))).toBe(" 3/12 ✔ A Z beat B P on m.scx · seed 3 · 10:05  g3.rep");
    expect(visible(gameLine(result(1, [0, 1], null), e, 2))).toMatch(/^1\/2 ▲ A P and B Z undecided on m\.scx · seed 1 · 7:00 \(the frame limit\)/);
    expect(visible(gameLine(result(1, [0, 1], 1, { crashed: 0, by: "left" }), e, 2))).toMatch(/B Z beat A P .*\(the other left\) · A crashed/);
    const out = result(1, [0, 1], null, { by: "desync" });
    out.end!.hashes.differedAt = 480;
    expect(visible(gameLine(out, e, 2))).toMatch(/the copies went out of step at frame 480/);
    expect(visible(gameLine({ ...result(2, [0, 1], 0), end: null, winner: null, error: "the game did not start" }, e, 2))).toBe("2/2 ✖ A vs B on m.scx · seed 2: the game did not start");
  });
});

/**
 * A match runner that prints what scm-sim's does: a start, a bot's text, an end. Side 0 wins on an odd seed, side 1
 * on an even one; a bot file named crash*.scmbot dies (the other side wins by "left"); a map named broken* is refused.
 * It writes the replay where it is asked and notes each game in the bots' data folders.
 */
const FAKE_MATCH = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const sides = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bot") { const [file, race, data] = args[++i].split("|"); sides.push({ kind: "bot", file, race, data }); }
  else if (args[i] === "--computer") sides.push({ kind: "computer", race: args[++i] });
}
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
if (/broken/.test(path.basename(args[0]))) { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const seed = Number(flag("seed")), frames = Number(flag("frames") ?? 50000);
const players = sides.map((s, k) => ({ side: k, slot: k, kind: s.kind, name: s.kind === "bot" ? path.basename(s.file) : "computer", race: s.race, minerals: 50, gas: 0, supplyUsed: 4, supplyAvailable: 9, outcome: null }));
say({ kind: "start", map: { name: path.basename(args[0]), width: 64, height: 64, tileset: "jungle" }, copy: "classic", seed, players, seats: sides.filter((s) => s.kind === "bot").length, ms: { load: 1, start: 1 } });
say({ kind: "text", side: 0, text: "gl hf" });
const crashed = sides.findIndex((s) => s.kind === "bot" && /crash/.test(path.basename(s.file)));
let winner = crashed >= 0 ? 1 - crashed : seed % 2 ? 0 : 1, by = crashed >= 0 ? "left" : "victory", frame = 1000 * seed;
if (seed === 99 && crashed < 0) { winner = null; by = "frames"; frame = frames; }
for (const [k, p] of players.entries()) p.outcome = winner === null ? null : k === winner ? "victory" : "defeat";
fs.writeFileSync(flag("replay"), "REPLAY " + seed);
for (const s of sides) if (s.kind === "bot" && s.data && !/crash/.test(s.file)) { fs.mkdirSync(s.data, { recursive: true }); fs.appendFileSync(path.join(s.data, "games.txt"), seed + "\\n"); }
const bots = sides.flatMap((s, k) => s.kind === "bot" ? [{ side: k, name: path.basename(s.file), commit: "", state: k === crashed ? "crashed" : "ended", error: k === crashed ? "its process stopped" : null, frames: frame, ms: frame * 0.5, maxMs: 30, over55: 0, over1s: 0, over10s: 0, commands: 10, kept: 1 }] : []);
say({ kind: "end", frame, players, seed, decided: winner !== null, winner, by, bots, replay: { file: flag("replay"), bytes: 8, agreed: true }, hashes: { compared: 10, differedAt: null }, ms: { game: 1, bots: [1], total: 2 } });
process.exit(crashed >= 0 ? 1 : 0);
`;

/** A staged engine whose deploy has a match runner (or not: an older deploy). */
function stagedEngine(withMatch = true): string {
  const dir = tmp(), build = "abcdef123456", sub = join(dir, build);
  mkdirSync(sub, { recursive: true });
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "run-feedface.cjs"), "");
  if (withMatch) writeFileSync(join(sub, "match-cafe.cjs"), FAKE_MATCH);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", ...(withMatch ? { matchRunner: "match-cafe.cjs" } : {}) }));
  return dir;
}

function classicCopy(): string {
  const dir = tmp();
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}

describe("scmjs bot ladder: a ladder over a stand-in runner", () => {
  it("plays every game, a line as each ends, saves each replay and ladder.json, and keeps what the bots learn", async () => {
    const dir = tmp();
    const e = parseEntrants([botFile(dir, "a.scmbot", "alpha", "Alpha"), botFile(dir, "b.scmbot", "beta", "Beta"), "computer:t"], ["r"]);
    writeFileSync(join(dir, "m.scx"), "MPQ");
    const lines: string[] = [], texts: string[] = [];
    const out = join(dir, "out");
    const r = await runLadder(e, { maps: [join(dir, "m.scx")], seeds: [1, 2], engine: stagedEngine(), starcraft: classicCopy(), out, live: (l) => lines.push(visible(l)), text: (who, t) => texts.push(`${who}: ${t}`) });
    expect(r.results).toHaveLength(8);
    expect(lines[0]).toMatch(/^8 games · Alpha, Beta, Terran computer · 1 map/);
    expect(lines.slice(1).filter((l) => /beat/.test(l))).toHaveLength(8);
    expect(lines[1]).toMatch(/^1\/8 ✔ Alpha R beat Beta R on m\.scx · seed 1 · 0:42 {2}alpha-vs-beta_m_RvR_seed1\.rep$/);
    expect(texts[0]).toBe("Alpha: gl hf");
    // Seed 1: the first in the lobby wins; seed 2: the second.
    expect(r.results.map((x) => x.winner === null ? null : e[x.winner].key)).toEqual(["alpha", "beta", "alpha", "beta", "beta", "alpha", "computer-t", "computer-t"]);
    const files = readdirSync(out).sort();
    expect(files).toContain("ladder.json");
    expect(files.filter((f) => f.endsWith(".rep"))).toHaveLength(8);
    expect(readFileSync(join(out, "alpha-vs-computer-t_m_RvT_seed2.rep"), "utf8")).toBe("REPLAY 2");
    // Every game a bot played noted in its own folder, in order, one at a time.
    expect(readFileSync(join(out, "bwapi-data", "alpha", "games.txt"), "utf8")).toBe("1\n1\n1\n2\n2\n2\n");
    const json = JSON.parse(readFileSync(join(out, "ladder.json"), "utf8")) as ReturnType<typeof ladderJson>;
    expect(json.games[0]).toMatchObject({ index: 1, seed: 1, winner: "alpha", by: "victory", frames: 1000, clock: "0:42", replay: join(out, "alpha-vs-beta_m_RvR_seed1.rep") });
    expect(json.standings.map((s) => s.entrant)).toEqual(["computer-t", "alpha", "beta"]);
    expect(json.headToHead.alpha.beta).toEqual({ won: 2, lost: 2, undecided: 0 });
    expect(r.standings.find((s) => s.key === "alpha")!.msPerFrame).toBe(0.5);
  });

  it("goes on past a map the game refuses and a bot whose copy dies, and counts them as such", async () => {
    const dir = tmp();
    const e = parseEntrants([botFile(dir, "crash.scmbot", "crashy", "Crashy"), "computer:z"], ["r"]);
    for (const m of ["m.scx", "broken.scx"]) writeFileSync(join(dir, m), "MPQ");
    const lines: string[] = [];
    const r = await runLadder(e, { maps: [join(dir, "m.scx"), join(dir, "broken.scx")], seeds: [5], engine: stagedEngine(), starcraft: classicCopy(), out: join(dir, "o"), live: (l) => lines.push(visible(l)) });
    expect(r.results.map((x) => x.error)).toEqual([null, "the game did not take this map"]);
    expect(lines[1]).toMatch(/Zerg computer Z beat Crashy R .*\(the other left\) · Crashy crashed/);
    expect(lines[2]).toMatch(/✖ Crashy vs Zerg computer on broken\.scx · seed 5: the game did not take this map/);
    expect(r.standings.find((s) => s.key === "crashy")).toMatchObject({ games: 1, lost: 1, crashed: 1, uncounted: 1 });
    expect(existsSync(join(dir, "o", "bwapi-data", "crashy", "games.txt"))).toBe(false);
  });

  it("plays games side by side with --parallel, and keeps the scheduled order for the table", async () => {
    const dir = tmp();
    const e = parseEntrants([botFile(dir, "a.scmbot", "a", "A"), "computer:t", "computer:p", "computer:z"], ["r"]);
    writeFileSync(join(dir, "m.scx"), "MPQ");
    const r = await runLadder(e, { maps: [join(dir, "m.scx")], seeds: [1, 2, 3], parallel: 4, engine: stagedEngine(), starcraft: classicCopy(), out: join(dir, "o") });
    expect(r.results.map((x) => x.game.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(r.standings.find((s) => s.key === "a")).toMatchObject({ games: 9, won: 6, lost: 3 });
  });

  it("says what is missing: a map, a copy of the game, a deploy before the match runner", async () => {
    const dir = tmp();
    const e = parseEntrants([botFile(dir, "a.scmbot", "a", "A"), "computer:t"], ["r"]);
    writeFileSync(join(dir, "m.scx"), "MPQ");
    await expect(runLadder(e, { maps: [], engine: stagedEngine(), starcraft: classicCopy() })).rejects.toThrow(/needs a map/);
    await expect(runLadder(e, { maps: [join(dir, "none.scx")], engine: stagedEngine(), starcraft: classicCopy() })).rejects.toThrow(/No file .*none\.scx/);
    await expect(runLadder(e, { maps: [join(dir, "m.scx")], engine: stagedEngine(), starcraft: tmp() })).rejects.toThrow(/not a copy of StarCraft/);
    await expect(runLadder(e, { maps: [join(dir, "m.scx")], engine: stagedEngine(false), starcraft: classicCopy(), out: join(dir, "o") })).rejects.toThrow(/has no match runner/);
  });
});
