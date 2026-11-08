/**
 * `scmjs map heatmap` (cli/src/heat.ts, heatmap.ts): which replays count for a map, the events a filter takes, the
 * per-tile counts, the field and its ramp, the picture over a made-up tileset, the cache, and the command end to end
 * over a stand-in replay runner that speaks `--events`, replays written here (`@scm-js/replay/write`) and a stand-in
 * 1.16.1 copy. The real runner needs the lifted game and a copy of StarCraft, which CI has not got.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Creator } from "mopaq";
import { chk, cmds, writeReplay } from "@scm-js/replay/write";
import { describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { loadTileset } from "../src/formats/tileset/decode";
import type { Input } from "../cli/src/files";
import {
  blur, drawHeat, fieldAt, greyGround, heatColor, heatField, heatPoints, HEAT_FLOOR, matchReplay, ownerIn, RAMP, sameName, takeEvent, tileCounts, emptyEvents,
  type GameEvents,
} from "../cli/src/heat";
import { besideEachOther, defaultParallel, eventsCachePath, heatmapMap, heatPicture, parsePlayer, readCachedEvents, replayFiles, replayLine, skippedLines, writeCachedEvents } from "../cli/src/heatmap";
import { CliError, visible } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-heatmap-"));

/** A game's events: two players, deaths, buildings and walking samples as given. */
function game(o: Partial<Pick<GameEvents, "deaths" | "built" | "walks">> & { players?: string[] } = {}): GameEvents {
  const ev = emptyEvents({ map: { name: "m", width: 64, height: 64, tileset: "jungle" }, frames: 2400, players: (o.players ?? ["Alpha", "Beta"]).map((name, slot) => ({ slot, name, race: "terran", type: 2 })), events: 1 });
  return { ...ev, deaths: o.deaths ?? [], built: o.built ?? [], walks: o.walks ?? [], end: { frame: 2400, ended: true, by: "replay", unmatched: 0, ms: 10 } };
}

describe("which replays count", () => {
  const map = { hash: "aa", name: "\x03Fighting \x04Spirit ", width: 128, height: 128 };
  it("the same scenario, else the same name and size, else not unless forced", () => {
    expect(matchReplay(map, { ...map })).toEqual({ match: "same", reason: "" });
    expect(matchReplay(map, { hash: "bb", name: "fighting  spirit", width: 128, height: 128 })).toEqual({ match: "name", reason: "" });
    expect(matchReplay(map, { hash: "bb", name: "Jade", width: 128, height: 128 })).toEqual({ match: null, reason: "played on Jade (128 × 128)" });
    expect(matchReplay(map, { hash: "bb", name: "Fighting Spirit", width: 96, height: 128 }).reason).toBe("played on Fighting Spirit (96 × 128), another size");
    expect(matchReplay(map, { hash: "bb", name: "Jade", width: 96, height: 128 }, true).match).toBe("forced");
    expect(sameName("\x03A  b", "a B")).toBe(true);
  });
  it("names each reason once, with its files", () => {
    const lines = skippedLines([{ file: "1.rep", reason: "played on Jade (128 × 128)" }, { file: "2.rep", reason: "not a replay" }, ...["3", "4", "5", "6"].map((n) => ({ file: `${n}.rep`, reason: "played on Jade (128 × 128)" }))]).map(visible);
    expect(lines).toEqual(["▲ 1.rep, 3.rep, 4.rep and 2 more left out: played on Jade (128 × 128)", "▲ 2.rep left out: not a replay"]);
  });
  it("takes the replays in a folder by name, numbers in order, and files as given", () => {
    const dir = tmp();
    for (const n of ["10.rep", "9.rep", "a.REP", "notes.txt"]) writeFileSync(join(dir, n), "x");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "1.rep"), "x");
    expect(replayFiles([dir, "x.rep"]).map((p) => p.replace(dir, "D"))).toEqual(["D/9.rep", "D/10.rep", "D/a.REP", "x.rep"]);
  });
});

describe("the events a filter takes", () => {
  // Alpha (slot 0) loses a marine to Beta at 10,10 tiles; Beta loses a zergling to Alpha; a scarab and a death with no killer.
  const g = game({
    deaths: [100, 0, 0, 320, 320, 1, 2000, 37, 1, 640, 640, 0, 150, 85, 1, 10, 10, 1, 300, 41, 1, 100, 100, -1],
    built: [50, 106, 0, 1000, 1000, 400, 131, 1, 1500, 1500],
    walks: [24, 3, 10, 10, 0, 2, 20, 20, 1, 1, 30, 30, 1, 2, 48, 1, 40, 40, 0, 2],
  });
  it("deaths: every loss but a Scarab's; one player's own; by a time", () => {
    expect(heatPoints([g], { what: "deaths" }).points).toEqual([320, 320, 640, 640, 100, 100]);
    expect(heatPoints([g], { what: "deaths", player: 2 }).points).toEqual([640, 640, 100, 100]);
    expect(heatPoints([g], { what: "deaths", until: 1000 }).points).toEqual([320, 320, 100, 100]);
    expect([...heatPoints([g], { what: "deaths" }).units]).toEqual([[0, 1], [37, 1], [41, 1]]);
  });
  it("kills: where a player's killer was another player; one player's kills", () => {
    expect(heatPoints([g], { what: "kills" }).points).toEqual([320, 320, 640, 640]);
    expect(heatPoints([g], { what: "kills", player: "alpha" }).points).toEqual([640, 640]);
  });
  it("buildings, and the armies' walking (workers left out)", () => {
    expect(heatPoints([g], { what: "buildings", player: 2 }).points).toEqual([1500, 1500]);
    expect(heatPoints([g], { what: "paths" }).points).toEqual([10, 10, 30, 30, 40, 40]);
    expect(heatPoints([g], { what: "paths", until: 30 }).points).toEqual([10, 10, 30, 30]);
  });
  it("a player by number or name, per game; a game without them gives nothing", () => {
    const other = game({ players: ["Gamma", "Alpha"], deaths: [1, 0, 1, 64, 64, 0] });
    expect(ownerIn(other, "ALPHA")).toBe(1);
    expect(ownerIn(other, 3)).toBeNull();
    expect(heatPoints([g, other], { what: "deaths", player: "Alpha" }).games).toEqual([{ count: 1, player: true }, { count: 1, player: true }]);
    expect(heatPoints([g, other], { what: "deaths", player: "Beta" }).games[1]).toEqual({ count: 0, player: false });
    expect(parsePlayer("3")).toBe(3);
    expect(parsePlayer(" Flash ")).toBe("Flash");
    expect(() => parsePlayer("9")).toThrow(CliError);
  });
  it("takes the runner's lines into a game's flat lists", () => {
    const ev = game();
    takeEvent(ev, { kind: "death", frame: 5, unit: 7, player: 1, x: 2, y: 3, by: null });
    takeEvent(ev, { kind: "built", frame: 6, unit: 106, player: 0, x: 4, y: 5 });
    takeEvent(ev, { kind: "walk", frame: 24, units: [1, 2, 0, 2, 3, 4, 1, 1] });
    expect(ev).toMatchObject({ deaths: [5, 7, 1, 2, 3, -1], built: [6, 106, 0, 4, 5], walks: [24, 2, 1, 2, 0, 2, 3, 4, 1, 1] });
  });
});

describe("counting and the field", () => {
  it("counts per tile, the busiest first, and leaves out what is off the map", () => {
    expect(tileCounts([5, 5, 40, 5, 33, 20, 70, 70, 4000, 10, -1, 5], 64, 64)).toEqual([[1, 0, 2], [0, 0, 1], [2, 2, 1]]);
  });
  it("spreads a point as a Gaussian that keeps its weight", () => {
    const v = new Float32Array(41 * 41);
    v[20 * 41 + 20] = 1;
    blur(v, 41, 41, 3);
    expect(v.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 4);
    expect(v[20 * 41 + 20]).toBeGreaterThan(v[20 * 41 + 23]);
    expect(v[20 * 41 + 23]).toBeCloseTo(v[23 * 41 + 20], 6);
  });
  it("puts the field's top at the busiest place, a quarter tile a cell", () => {
    const f = heatField([100, 100, 100, 100, 100, 100, 900, 900], 32, 32, 1);
    expect([f.width, f.height]).toEqual([128, 128]);
    expect(fieldAt(f, 100 / 8, 100 / 8)).toBe(1);
    expect(fieldAt(f, 900 / 8, 900 / 8)).toBeGreaterThan(0.2);
    expect(fieldAt(f, 900 / 8, 900 / 8)).toBeLessThan(0.6);
    expect(fieldAt(f, 60, 10)).toBe(0);
    expect(heatField([], 8, 8, 1).top).toBe(0);
  });
  it("ramps from nothing under the floor to the ramp's ends", () => {
    expect(heatColor(HEAT_FLOOR / 2).alpha).toBe(0);
    expect(heatColor(0.5).color).toEqual(RAMP[2].color);
    expect(heatColor(1)).toEqual({ color: RAMP[4].color, alpha: 0.92 });
    expect(heatColor(0.1).alpha).toBeLessThan(heatColor(0.9).alpha);
  });
});

/** The made-up jungle tileset of cli-preview.test.ts: tile id 0 is one flat colour. */
function fakeTilesetFiles([r, g, b]: [number, number, number]) {
  const cv5 = new Uint8Array(52 * 2);
  new DataView(cv5.buffer).setUint16(20, 1, true);
  new DataView(cv5.buffer).setUint16(22, 9, true);
  const vx4 = new Uint8Array(2 * 16 * 2);
  for (let i = 0; i < 16; i++) new DataView(vx4.buffer).setUint16((16 + i) * 2, 1 << 1, true);
  const vr4 = new Uint8Array(2 * 64);
  vr4.fill(5, 64);
  const vf4 = new Uint8Array(2 * 16 * 2);
  const wpe = new Uint8Array(1024);
  wpe.set([r, g, b, 0], 5 * 4);
  return { cv5, vf4, vr4, vx4, wpe };
}

describe("the picture", () => {
  it("draws the ground in grey and the heat in the ramp's colours where the events are", async () => {
    const map = await openMapBytes(chk(16, 16, 4, 0), "m.chk");
    const graphics = { tileset: loadTileset(fakeTilesetFiles([200, 100, 50])), units: null };
    const field = heatField([4 * 32 + 16, 4 * 32 + 16], 16, 16, 1);
    const { picture, scale } = heatPicture(map.scenario, graphics, field, { scale: 4 });
    expect([picture.width, picture.height, scale]).toEqual([64, 64, 4]);
    const px = (x: number, y: number) => [...picture.pixels.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 3)];
    // Far from the event: the ground's colour as grey, at half its brightness.
    const grey = Math.round((0.299 * 200 + 0.587 * 100 + 0.114 * 50) * 0.5);
    expect(px(60, 60)).toEqual([grey, grey, grey]);
    // At the event: the ramp's hot end over it.
    const hot = px(18, 18);
    expect(hot[0]).toBeGreaterThan(200);
    expect(hot[0]).toBeGreaterThan(hot[2]);
    // Fitted to a width for the terminal.
    expect(heatPicture(map.scenario, graphics, field, { width: 40 }).picture.width).toBe(40);
  });
  it("greys in place, draws nothing with no heat, and puts two pictures side by side", () => {
    const pic = { width: 2, height: 1, pixels: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) };
    greyGround(pic, 1);
    expect([...pic.pixels]).toEqual([76, 76, 76, 255, 29, 29, 29, 255]);
    drawHeat(pic, heatField([], 1, 1, 1), 2);
    expect([...pic.pixels]).toEqual([76, 76, 76, 255, 29, 29, 29, 255]);
    const both = besideEachOther({ picture: pic, marks: [] }, { picture: pic, marks: [{ kind: "start", owner: 0, color: "#ffffff", x0: 0, y0: 0, x1: 1, y1: 1 }] }, 3);
    expect([both.picture.width, both.picture.height]).toEqual([7, 1]);
    expect(both.marks[0]).toMatchObject({ x0: 5, x1: 6 });
    expect([...both.picture.pixels.subarray(8, 12)]).toEqual([0x4a, 0x4a, 0x4a, 255]);
  });
});

describe("the cache and the lines", () => {
  it("keeps a replay's events by its hash, gzipped, and reads them back", () => {
    const root = tmp(), ev = game({ deaths: [1, 2, 3, 4, 5, -1] });
    expect(readCachedEvents("ab", root)).toBeNull();
    expect(writeCachedEvents("ab", ev, root)).toBeGreaterThan(0);
    expect(eventsCachePath("ab", root)).toBe(join(root, "heatmap", "v1", "ab.json.gz"));
    expect(readCachedEvents("ab", root)).toEqual(ev);
    writeFileSync(eventsCachePath("cd", root), "not gzip");
    expect(readCachedEvents("cd", root)).toBeNull();
  });
  it("says each replay as it is done", () => {
    const ev = game();
    expect(visible(replayLine(2, 12, "a.rep", ev, { what: "deaths", count: 3 }))).toBe(" 2/12 ✔ a.rep  TT · 1:41 · 3 deaths · 0.0 s");
    expect(visible(replayLine(1, 1, "a.rep", ev, { what: "paths", cached: true }))).toBe("1/1 ✔ a.rep  TT · 1:41 · cached");
    expect(visible(replayLine(1, 1, "a.rep", null, { what: "deaths", error: "no engine" }))).toBe("1/1 ✖ a.rep: no engine");
  });
  it("plays a few at once, by the processors and the memory", () => {
    expect(defaultParallel(24, 32 * 2 ** 30)).toBe(4);
    expect(defaultParallel(4, 32 * 2 ** 30)).toBe(2);
    expect(defaultParallel(24, 2 * 2 ** 30)).toBe(2);
    expect(defaultParallel(24, 2 ** 29)).toBe(1);
  });
});

/**
 * A replay runner that speaks `--events`: two deaths and a building from the replay's own numbers (its file name's
 * digits), a walking sample, the end. A replay whose name has "old" gets a runner from before `--events` (a start
 * without it, then waiting on standard input); "broken" gets an error line.
 */
const EVENTS_RUNNER = `
const fs = require("node:fs"), path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const name = path.basename(args[0]);
fs.appendFileSync(path.join(path.dirname(process.argv[1]), "played.txt"), name + "\\n");
if (name.includes("broken")) { say({ kind: "error", message: "the game refused it" }); process.exit(2); }
const old = name.includes("old") || !args.includes("--events");
say({ kind: "start", map: { name, width: 64, height: 64, tileset: "jungle" }, frames: 2400, players: [{ slot: 0, name: "Alpha", race: "terran", type: 2 }, { slot: 1, name: "Beta", race: "zerg", type: 2 }], copy: "classic", terrain: "", ms: { load: 1, start: 1 }, ...(old ? {} : { events: 1 }) });
if (old) { process.stdin.resume(); setInterval(() => {}, 1000); return; }
const n = Number(name.replace(/\\D/g, "")) || 1;
say({ kind: "death", frame: 100, unit: 0, player: 0, x: 32 * n + 16, y: 48, by: 1 });
say({ kind: "death", frame: 1500, unit: 37, player: 1, x: 300, y: 300, by: 0 });
say({ kind: "built", frame: 200, unit: 106, player: 0, x: 500, y: 500 });
say({ kind: "walk", frame: 24, units: [100, 100, 0, 2, 120, 100, 1, 1] });
say({ kind: "end", frame: 2400, ended: true, by: "replay", events: { deaths: 2, built: 1, walks: 1, unmatched: 0 } });
`;

function staged(runner = EVENTS_RUNNER) {
  const dir = tmp(), build = "abcdef123456", sub = join(dir, build);
  mkdirSync(sub);
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "replay-feedface.cjs"), runner);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", replayRunner: "replay-feedface.cjs" }));
  // A 1.16.1 copy with the made-up jungle tileset.
  const copy = join(dir, "sc");
  mkdirSync(copy);
  const stardat = new Creator({});
  for (const [ext, data] of Object.entries(fakeTilesetFiles([60, 120, 60]))) stardat.addFile(`tileset\\jungle.${ext}`, data);
  writeFileSync(join(copy, "StarDat.mpq"), stardat.write());
  writeFileSync(join(copy, "BrooDat.mpq"), new Creator({}).write());
  return { dir, sub, copy, played: () => (existsSync(join(sub, "played.txt")) ? readFileSync(join(sub, "played.txt"), "utf8").trim().split("\n").sort() : []) };
}

/** A replay of the given map, written here. */
const rep = (scenario: Uint8Array, names = ["Alpha", "Beta"]) => writeReplay({ format: "legacy", players: names.map((name, i) => ({ index: i, id: i, name })), commands: cmds([]), chk: scenario });

describe("scmjs map heatmap", () => {
  const MAP = chk(64, 64, 4, 0);
  async function setup(files: Record<string, Uint8Array | string>) {
    const s = staged();
    const reps = join(s.dir, "reps");
    mkdirSync(reps);
    for (const [n, b] of Object.entries(files)) writeFileSync(join(reps, n), b);
    const input: Input = { path: join(s.dir, "m.chk"), name: "m.chk", bytes: MAP, kind: "map" };
    writeFileSync(input.path, MAP);
    const map = await openMapBytes(MAP, "m.chk");
    return { s, reps, input, map, cache: join(s.dir, "cache") };
  }
  const term = { columns: 100, depth: "truecolor" as const, unicode: true, inline: null };

  it("plays the replays of this map, leaves the others out, draws, and plays nothing twice", async () => {
    const { s, reps, input, map, cache } = await setup({
      "1.rep": rep(MAP), "2.rep": rep(MAP, ["Gamma", "Alpha"]), "3.rep": rep(chk(64, 64, 4, 1)), "4.rep": rep(chk(96, 64, 4, 0)), "5.rep": rep(MAP), "notes.rep": "hello",
    });
    // 2.rep is another game on the map (other names, so other bytes); 5.rep is 1.rep's bytes again.
    const lines: string[] = [];
    const o = { engine: s.dir, starcraft: s.copy, cache, out: join(s.dir, "heat.png"), parallel: "2" };
    const r = await heatmapMap(input, map, [reps], o, { term, live: (l) => lines.push(visible(l)) });
    expect(r.report.replays.map((x) => [x.file, x.match, x.cached])).toEqual([["1.rep", "same", false], ["2.rep", "same", false], ["3.rep", "name", false]]);
    expect(r.report.skipped).toEqual([
      { file: "4.rep", reason: "played on a map with no name (96 × 64), another size" },
      { file: "5.rep", reason: "the same replay as one before it" },
      { file: "notes.rep", reason: "not a replay" },
    ]);
    expect(s.played()).toEqual(["1.rep", "2.rep", "3.rep"]);
    // Deaths: the marine of each (at 32·n + 16, 48) and the zergling three times at 300,300.
    expect(r.report.total).toBe(6);
    expect(r.report.tiles[0]).toEqual([9, 9, 3]);
    expect(r.report.units).toEqual([{ unit: 0, name: "Terran Marine", count: 3 }, { unit: 37, name: "Zerg Zergling", count: 3 }]);
    expect(r.report.picture).toMatchObject({ form: "png", width: 256, height: 256, scale: 4 });
    expect([...readFileSync(o.out).subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
    expect(lines.some((l) => l.includes("3 replays played on it · 3 to play, 2 at a time"))).toBe(true);
    expect(visible(r.lines[0])).toMatch(/^✔ m\.chk: 6 deaths in 3 replays · the most in one tile: 3, at 9,9 · most: Marine 3, Zergling 3$/);

    // Again, with a player and a time: everything from the cache, nothing played.
    const again = await heatmapMap(input, map, [join(reps, "1.rep"), join(reps, "2.rep"), join(reps, "3.rep")], { ...o, out: undefined, json: true, player: "Alpha", until: "1:00" }, { term });
    expect(s.played()).toEqual(["1.rep", "2.rep", "3.rep"]);
    expect(again.report.replays.every((x) => x.cached)).toBe(true);
    // Alpha's marine in each (the stand-in names its players Alpha and Beta whatever the replay); the zergling died after a minute.
    expect(again.report.total).toBe(3);
    expect(again.report).toMatchObject({ player: "Alpha", until: "1:00" });

    // The terminal, the heat beside the map, with --what buildings.
    const t = await heatmapMap(input, map, [reps], { ...o, out: undefined, what: "buildings", sideBySide: true }, { term });
    expect(t.report.total).toBe(3);
    expect(t.report.picture).toMatchObject({ form: "blocks", columns: 98 });
    expect(visible(t.lines.at(-1)!)).toMatch(/^ {2}fewer █{12} more · 3 buildings placed in 3 replays/);
  });

  it("takes another map's replays with --force, and refuses what it cannot use", async () => {
    const { s, reps, input, map, cache } = await setup({ "4.rep": rep(chk(96, 64, 4, 0)), "old.rep": rep(MAP), "broken.rep": rep(MAP) });
    const o = { engine: s.dir, starcraft: s.copy, cache };
    const fail = (p: Promise<unknown>) => p.then(() => null, (e: CliError) => [e.exitCode, e.message]);
    expect(await fail(heatmapMap(input, map, [join(reps, "4.rep")], o, { term }))).toEqual([2, expect.stringMatching(/^4\.rep was not played on m\.chk/)]);
    const forced = await heatmapMap(input, map, [join(reps, "4.rep")], { ...o, force: true, json: true }, { term });
    expect(forced.report.replays[0].match).toBe("forced");
    expect(await fail(heatmapMap(input, map, [join(reps, "old.rep")], o, { term }))).toEqual([1, expect.stringMatching(/replay runner from before map heatmap/)]);
    const broken = await heatmapMap(input, map, [join(reps, "broken.rep"), join(reps, "4.rep")], { ...o, force: true, json: true }, { term });
    expect(broken.report.skipped).toEqual([{ file: "broken.rep", reason: "the game could not play it: the game refused it" }]);
    process.exitCode = 0;
    expect(await fail(heatmapMap(input, map, [], o, { term }))).toEqual([2, expect.stringMatching(/Name the replays/)]);
    expect(await fail(heatmapMap(input, map, [reps], { ...o, what: "units" }, { term }))).toEqual([2, '--what takes deaths, kills, buildings, paths, not "units"']);
    expect(await fail(heatmapMap(input, map, [reps], { ...o, until: "soon" }, { term }))).toEqual([2, '--until takes m:ss (or h:mm:ss), not "soon"']);
    expect(await fail(heatmapMap(input, map, [reps], { ...o, out: "x.png", scale: "3" }, { term }))).toEqual([2, '--scale takes 1, 2, 4, 8, 16, 32, not "3"']);
    expect(await fail(heatmapMap(input, map, [join(reps, "4.rep")], { ...o, force: true, player: "Nobody" }, { term }))).toEqual([2, 'No replay has a player called "Nobody".']);
  });
});
