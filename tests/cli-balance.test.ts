/**
 * `scmjs map balance` (cli/src/balance.ts): the starts dealt read from a replay's events, the first contact, the
 * main's resources, the rows and the verdict, and a run over stand-in runners — a match runner whose winner is the side
 * dealt the first start, and a replay runner whose events put each side's workers at the start the seed dealt it.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { OpenedMap } from "../src/editor/mapFile";
import { createScenario } from "../src/formats/chk/create";
import { makeUnit } from "../src/editor/units";
import { START_LOCATION } from "../src/data/units";
import {
  balanceJson, balanceReport, dealtStart, differs, firstContact, mainResources, printBalance, readGame, runBalance, startPlaces, verdictOf,
  type BalanceGame, type StartRow,
} from "../cli/src/balance";
import { emptyEvents, type GameEvents } from "../cli/src/heat";
import type { Entrant, GameResult, MatchEnd, ScheduledGame } from "../cli/src/ladder";
import { visible } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-balance-"));

/** Where the three starts of the test map are, in pixels. */
const STARTS = [[256, 256], [3840, 256], [2048, 3840]];

/** A 128 × 128 map with three starts, each with 8 mineral fields; start 1 has two geysers, the others one. */
function threeStarts(): OpenedMap {
  const scn = createScenario({ width: 128, height: 128, era: 4, name: "Three" });
  let serial = 1;
  STARTS.forEach(([x, y], p) => {
    scn.units.push(makeUnit(null, START_LOCATION, p, x, y, serial++));
    for (let k = 0; k < 8; k++) scn.units.push(makeUnit(null, 176, 11, x + (k - 4) * 64, y + 224, serial++));
    scn.units.push(makeUnit(null, 188, 11, x + 224, y, serial++));
    if (p === 0) scn.units.push(makeUnit(null, 188, 11, x - 224, y, serial++));
  });
  // A field far from every start belongs to no main.
  scn.units.push(makeUnit(null, 176, 11, 2048, 2048, serial++));
  return { scenario: scn, extras: new Map(), fileName: "three.scx" };
}

function events(o: { walks?: number[][]; built?: number[][]; deaths?: number[][] }): GameEvents {
  const ev = emptyEvents({ map: { name: "x", width: 128, height: 128, tileset: "jungle" }, frames: 1000, players: [] });
  for (const [frame, ...units] of o.walks ?? []) ev.walks.push(frame, units.length / 4, ...units);
  for (const b of o.built ?? []) ev.built.push(...b);
  for (const d of o.deaths ?? []) ev.deaths.push(...d);
  return ev;
}

describe("scmjs map balance: what needs no game", () => {
  it("finds the starts and each main's resources", () => {
    const doc = threeStarts();
    const starts = startPlaces(doc);
    expect(starts.map((s) => [s.player, s.x, s.y, s.clock])).toEqual([[1, 256, 256, 11], [2, 3840, 256, 2], [3, 2048, 3840, 6]]);
    const res = mainResources(doc, starts);
    expect(res.map((r) => [r.fields, r.minerals, r.geysers, r.gas])).toEqual([[8, 12000, 2, 10000], [8, 12000, 1, 5000], [8, 12000, 1, 5000]]);
    expect(res[0].geyserTiles).toBe(7);
    expect(res[1].fieldTiles).toBeGreaterThan(7);
  });
});

describe("scmjs map balance: what a game's events say", () => {
  const starts = startPlaces(threeStarts());
  it("reads the start a side was dealt from where its workers first walked, else its first building", () => {
    const ev = events({ walks: [[24, 300, 280, 0, 1, 280, 300, 0, 1], [48, 3800, 300, 1, 1]], built: [[400, 106, 2, 2000, 3800]] });
    expect(dealtStart(ev, 0, starts)).toBe(0);
    expect(dealtStart(ev, 1, starts)).toBe(1);
    expect(dealtStart(ev, 2, starts)).toBe(2);
    expect(dealtStart(ev, 3, starts)).toBeNull();
    // Workers in the middle of nowhere are no start.
    expect(dealtStart(events({ walks: [[24, 2048, 2048, 0, 1]] }), 0, starts)).toBeNull();
  });

  it("takes the first unit one side lost to the other, not to itself, a neutral or a Scarab", () => {
    const ev = events({ deaths: [[50, 85, 0, 1, 1, 1], [80, 7, 0, 1, 1, 0], [90, 7, 1, 1, 1, -1], [100, 64, 1, 1, 1, 11], [300, 64, 1, 1, 1, 0], [400, 64, 0, 1, 1, 1]] });
    expect(firstContact(ev, [0, 1])).toBe(300);
    expect(firstContact(ev, [0, 2])).toBeNull();
  });
});

/** A finished game: the sides, who won (side 0 or 1, null undecided), and the slots the runner gave them. */
function finished(index: number, sides: [number, number], won: 0 | 1 | null, frame = 9000): { game: ScheduledGame; result: GameResult } {
  const game: ScheduledGame = { index, sides, races: ["p", "p"], map: "m.scx", seed: index, replay: `g${index}.rep` };
  const end: MatchEnd = {
    frame, seed: index, decided: won !== null, winner: won, by: won === null ? "frames" : "victory",
    players: [0, 1].map((k) => ({ side: k, slot: k, kind: "bot" as const, name: `s${k}`, race: "protoss", minerals: 0, gas: 0, supplyUsed: 0, supplyAvailable: 0, outcome: null })),
    bots: [], replay: null, hashes: { compared: 0, differedAt: null }, ms: { game: 1, bots: [], total: 1 },
  };
  return { game, result: { game, end, error: null, winner: won === null ? null : sides[won], replay: `g${index}.rep` } };
}

describe("scmjs map balance: the rows and the verdict", () => {
  const doc = threeStarts();
  const starts = startPlaces(doc);
  const entrants: Entrant[] = [{ key: "a", label: "A", kind: "bot", file: "/a", race: "p" }, { key: "b", label: "B", kind: "bot", file: "/b", race: "p" }];
  /** A game with side 0 dealt start `s0` and side 1 start `s1`, and a first contact at frame 2000. */
  const at = (i: number, sides: [number, number], won: 0 | 1 | null, s0: number, s1: number): BalanceGame => {
    const { game, result } = finished(i, sides, won);
    return readGame(game, result, events({ walks: [[24, STARTS[s0][0], STARTS[s0][1], 0, 1, STARTS[s1][0], STARTS[s1][1], 1, 1]], deaths: [[2000, 64, 1, 0, 0, 0]] }), starts);
  };

  it("counts each start's games, wins and the expectation from the sides' records, and flags a start that wins too often", () => {
    // Start 1 wins every game it is in; between 2 and 3 the first in the lobby wins. Both sides play both ways round.
    const games: BalanceGame[] = [];
    let i = 1;
    for (const [s0, s1] of [[0, 1], [1, 2], [2, 0], [0, 2], [1, 0], [2, 1]]) for (const sides of [[0, 1], [1, 0]] as [number, number][]) {
      const won: 0 | 1 = s0 === 0 ? 0 : s1 === 0 ? 1 : 0;
      games.push(at(i++, sides, won, s0, s1));
    }
    const rep = balanceReport("three.scx", doc, starts, entrants, games, null);
    expect(rep.starts.map((s) => [s.player, s.games, s.won, s.lost])).toEqual([[1, 8, 8, 0], [2, 8, 2, 6], [3, 8, 2, 6]]);
    expect(rep.starts[0].expected).toBeCloseTo(0.5);
    expect(rep.starts[0].contact).toBe(2000);
    expect(rep.pairs.map((p) => p.games)).toEqual([4, 4, 4]);
    expect(rep.verdict.kind).toBe("unbalanced");
    expect(rep.verdict.start).toBe(0);
    expect(rep.verdict.text).toMatch(/^Start 1 \(11 o'clock\) wins 100% where 50% was expected — look at its gas: its main has 10,000, the others average 5,000\.$/);
  });

  it("calls an even map balanced, a small sample chance, a sweep one-sided, and too few games too few", () => {
    const even: BalanceGame[] = [at(1, [0, 1], 0, 0, 1), at(2, [1, 0], 0, 0, 1), at(3, [0, 1], 0, 1, 2), at(4, [1, 0], 0, 1, 2), at(5, [0, 1], 0, 2, 0), at(6, [1, 0], 0, 2, 0)];
    expect(balanceReport("t", doc, starts, entrants, even, null).verdict).toMatchObject({ kind: "balanced" });
    expect(balanceReport("t", doc, starts, entrants, even, null).verdict.text).toMatch(/^Balanced within 0%/);
    const sweep = [at(1, [0, 1], 0, 0, 1), at(2, [0, 1], 0, 1, 2), at(3, [0, 1], 0, 2, 0)];
    expect(balanceReport("t", doc, starts, entrants, sweep, null).verdict.kind).toBe("one-sided");
    expect(balanceReport("t", doc, starts, entrants, [at(1, [0, 1], null, 0, 1)], null).verdict.kind).toBe("too-few");
    const few = [at(1, [0, 1], 0, 0, 1), at(2, [1, 0], 1, 0, 1), at(3, [0, 1], 1, 1, 2), at(4, [1, 0], 0, 2, 1)];
    expect(balanceReport("t", doc, starts, entrants, few, null).verdict.kind).toBe("chance");
  });

  it("says what is different about a start from the numbers that need no game", () => {
    const row = (gas: number, rush: number | null): StartRow => ({ player: 1, x: 0, y: 0, clock: 12, games: 0, won: 0, lost: 0, undecided: 0, winRate: null, expected: null, margin: null, frames: null, contact: null, rushSeconds: rush, resources: { fields: 8, minerals: 12000, geysers: 1, gas, fieldTiles: 7, geyserTiles: 7 } });
    expect(differs([row(5000, 30), row(5000, 40), row(5000, 40)], 0, true)).toBe("look at its distances: its walks to the other starts average 30.0 s, the others' 40.0 s");
    expect(differs([row(5000, 40), row(5000, 40)], 0, true)).toMatch(/within 10% of the others'/);
    expect(verdictOf([row(5000, 1)], [])).toMatchObject({ kind: "too-few" });
  });
});

/**
 * A match runner as scm-sim's speaks: the seed deals slot 0 start seed % 3 and slot 1 start (seed + 1) % 3, and the
 * side dealt the first start wins (else the first in the lobby). The replay it writes says the seed.
 */
const FAKE_MATCH = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const sides = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--bot") { const [file, race] = args[++i].split("|"); sides.push({ kind: "bot", file, race }); }
  else if (args[i] === "--computer") sides.push({ kind: "computer", race: args[++i] });
}
const seed = Number(flag("seed"));
const dealt = [seed % 3, (seed + 1) % 3];
const players = sides.map((s, k) => ({ side: k, slot: k, kind: s.kind, name: s.kind, race: "protoss", minerals: 50, gas: 0, supplyUsed: 4, supplyAvailable: 9, outcome: null }));
say({ kind: "start", map: { name: path.basename(args[0]), width: 128, height: 128, tileset: "jungle" }, copy: "classic", seed, players, seats: 1, ms: { load: 1, start: 1 } });
const winner = dealt[0] === 0 ? 0 : dealt[1] === 0 ? 1 : 0;
fs.writeFileSync(flag("replay"), String(seed));
say({ kind: "end", frame: 6000 + seed, players, seed, decided: true, winner, by: "victory", bots: [], replay: { file: flag("replay"), bytes: 1, agreed: true }, hashes: { compared: 1, differedAt: null }, ms: { game: 1, bots: [1], total: 2 } });
`;

/** A replay runner's --events: each side's workers at the start the seed dealt it, and a first loss at frame 1500. */
const FAKE_REPLAY = `
const fs = require("node:fs");
const seed = Number(fs.readFileSync(process.argv[2], "utf8"));
const at = ${JSON.stringify(STARTS)};
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!process.argv.includes("--events")) process.exit(3);
const [a, b] = [at[seed % 3], at[(seed + 1) % 3]];
say({ kind: "start", map: { name: "x", width: 128, height: 128, tileset: "jungle" }, frames: 6000, players: [{ slot: 0, name: "a", race: "protoss", type: 2 }, { slot: 1, name: "b", race: "protoss", type: 2 }], copy: "classic", events: 1 });
say({ kind: "walk", frame: 24, units: [a[0] + 30, a[1] + 40, 0, 1, b[0] - 30, b[1] + 40, 1, 1] });
say({ kind: "death", frame: 1500, unit: 64, player: 1, x: 1, y: 1, by: 0 });
say({ kind: "end", frame: 6000, ended: true, by: "victory", events: { deaths: 1, built: 0, walks: 1, unmatched: 0 } });
`;

function stagedEngine(): string {
  const dir = tmp(), build = "abcdef123456", sub = join(dir, build);
  mkdirSync(sub, { recursive: true });
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "run-feedface.cjs"), "");
  writeFileSync(join(sub, "match-cafe.cjs"), FAKE_MATCH);
  writeFileSync(join(sub, "replay-beef.cjs"), FAKE_REPLAY);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", matchRunner: "match-cafe.cjs", replayRunner: "replay-beef.cjs" }));
  return dir;
}

function classicCopy(): string {
  const dir = tmp();
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(dir, f), "mpq");
  return dir;
}

/** A `.scmbot` with only its header. */
function botFile(dir: string, key: string): string {
  const header = new TextEncoder().encode(JSON.stringify({ format: 1, key, name: key.toUpperCase(), memoryPages: 1, commit: "x" }));
  const bytes = new Uint8Array(12 + header.length);
  bytes.set(new TextEncoder().encode("SCMBOT1\n"));
  new DataView(bytes.buffer).setUint32(8, header.length, true);
  bytes.set(header, 12);
  writeFileSync(join(dir, `${key}.scmbot`), bytes);
  return join(dir, `${key}.scmbot`);
}

describe("scmjs map balance over stand-in runners", () => {
  it("plays every seed both ways round, reads each replay's starts, and finds the start that wins", async () => {
    const dir = tmp();
    const map = join(dir, "three.scx");
    writeFileSync(map, "MPQ");
    const lines: string[] = [];
    const out = join(dir, "kept");
    const r = await runBalance("three.scx", map, threeStarts(), { bots: [botFile(dir, "alpha"), botFile(dir, "beta")], seeds: [1, 2, 3, 4, 5, 6], parallel: 3, rush: false, engine: stagedEngine(), starcraft: classicCopy(), out, live: (l) => lines.push(visible(l)) });
    expect(lines[0]).toMatch(/^12 games · ALPHA vs BETA · 3 start locations · abcdef123456 · 3 at once$/);
    expect(lines.filter((l) => /beat/.test(l))).toHaveLength(12);
    // Counted as they finish (a few at once, any order): 1/12 to 12/12, one each.
    expect(lines.filter((l) => /beat/.test(l)).map((l) => /^ ?(\d+)\/12/.exec(l)?.[1])).toEqual(Array.from({ length: 12 }, (_, k) => String(k + 1)));
    expect(lines).toContainEqual(expect.stringMatching(/ALPHA P \(start 2, 2 o'clock\) beat BETA P \(start 3, 6 o'clock\) · 4:12 · first contact 1:03 · seed 1$/));
    const rep = r.report;
    // Between starts 2 and 3 the runner's seed deals slot 0 start 2, and slot 0 is the first in the lobby, who wins.
    expect(rep.starts.map((s) => [s.player, s.games, s.won, s.lost])).toEqual([[1, 8, 8, 0], [2, 8, 4, 4], [3, 8, 0, 8]]);
    expect(rep.verdict).toMatchObject({ kind: "unbalanced", start: 0 });
    expect(rep.verdict.text).toMatch(/look at its gas/);
    expect(readdirSync(out).filter((f) => f.endsWith(".rep"))).toHaveLength(12);
    const json = balanceJson(r);
    expect(json.verdict.start).toBe(1);
    expect(json.games[0]).toMatchObject({ index: 1, seed: 1, contact: 1500, sides: [{ entrant: "alpha", slot: 0, start: 2 }, { entrant: "beta", slot: 1, start: 3 }] });
    const text = printBalance(r).map(visible).join("\n");
    expect(text).toMatch(/Start 1 \(11 o'clock\) wins 100% where 50% was expected/);
    expect(text).toMatch(/Pairs met: 1–2 ×4, 1–3 ×4, 2–3 ×4/);
    expect(text).toMatch(/the game cannot be told which to give/);
  });

  it("plays a bot against itself once a seed: the other lobby order is the same game", async () => {
    const dir = tmp();
    const map = join(dir, "three.scx");
    writeFileSync(map, "MPQ");
    const bot = botFile(dir, "alpha");
    const r = await runBalance("three.scx", map, threeStarts(), { bots: [bot, bot], seeds: [1, 2, 3], rush: false, engine: stagedEngine(), starcraft: classicCopy() });
    expect(r.report.games.map((g) => [g.game.index, g.game.seed, g.game.sides])).toEqual([[1, 1, [0, 1]], [2, 2, [0, 1]], [3, 3, [0, 1]]]);
  });

  it("plays one bot against the computer, and leaves no replays behind without --out", async () => {
    const dir = tmp();
    const map = join(dir, "three.scx");
    writeFileSync(map, "MPQ");
    const r = await runBalance("three.scx", map, threeStarts(), { bots: [botFile(dir, "solo")], races: ["p"], seeds: [1, 2, 3], rush: false, engine: stagedEngine(), starcraft: classicCopy() });
    expect(r.report.sides.map((s) => s.label)).toEqual(["SOLO", "Protoss computer"]);
    expect(r.report.games).toHaveLength(3);
    expect(r.out).toBeNull();
    expect(existsSync(join(dir, "bwapi-data"))).toBe(false);
  });

  it("refuses a map with one start and a third bot", async () => {
    const one = threeStarts();
    one.scenario.units = one.scenario.units.filter((u) => u.unitId !== START_LOCATION || u.owner === 0);
    await expect(runBalance("one.scx", "one.scx", one, { bots: ["x"] })).rejects.toThrow(/one start location/);
    await expect(runBalance("three.scx", "three.scx", threeStarts(), { bots: ["a", "b", "c"] })).rejects.toThrow(/one bot .* or two/);
  });
});
