/**
 * `scmjs replay watch` (cli/src/watch.ts, engine.ts): the picture — the braille minimap, its colours and the lines
 * around it — drawn from a runner's lines, the replay's own part (colours, chat, APM), and the driver over a stand-in
 * runner that speaks scm-sim's protocol, paced and free. The real runner needs the lifted game and a copy of
 * StarCraft, which CI has not got.
 */
import { PassThrough } from "node:stream";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Replay } from "@scm-js/replay";
import { ensureEngine, runnerFor } from "../cli/src/engine";
import type { Input } from "../cli/src/files";
import { brailleCell, clock, drawMinimap, fitPicture, nearestAnsi, parseClock, pictureLines, plainPicture, sidesOf, summaryLine, Tally, watchReplay, watchSummary, type Side, type WatchFrame, type WatchStart } from "../cli/src/watch";
import { CliError, visible } from "../cli/src/ui";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-watch-"));

const start: WatchStart = {
  kind: "start", map: { name: "x.rep", width: 64, height: 64, tileset: "jungle" }, frames: 2400, copy: "classic",
  players: [{ slot: 0, name: "A", race: "terran", type: 2 }, { slot: 1, name: "B", race: "zerg", type: 2 }],
  terrain: Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 8 ? "0" : i % 64 < 40 ? "1" : "3")).join(""), ms: { load: 1, start: 1 },
};
const sides: Side[] = [{ slot: 0, name: "A", race: "terran", color: "#f40404" }, { slot: 1, name: "B", race: "zerg", color: "#0c48cc" }];
/** A frame: A's command centre at the top left with two workers, B's hatchery bottom right, a mineral line, a critter. */
const frame: WatchFrame = {
  kind: "frame", frame: 1200,
  players: [[150, 20, 10, 18, 3], [60, 0, 9, 17, 1]],
  units: [
    16 * 32, 16 * 32, 0, 3, 17 * 32, 15 * 32, 0, 1, 18 * 32, 15 * 32, 0, 1,
    48 * 32, 48 * 32, 1, 3,
    8 * 32 + 16, 10 * 32, 11, 4, 8 * 32 + 16, 11 * 32, 11, 4,
    30 * 32, 30 * 32, 11, 0,
  ],
};
/** A replay as far as the picture reads one: players with colours and ids, commands with chat. */
const replay = {
  players: [{ slot: 0, id: 0, name: "Alpha", color: "#f40404" }, { slot: 1, id: 1, name: "Beta", color: "#0c48cc" }],
  commands: [
    { frame: 10, player: 0, kind: "select" }, { frame: 20, player: 0, kind: "train" }, { frame: 30, player: 1, kind: "rightClick" },
    { frame: 100, player: 1, kind: "chat", text: "glhf" }, { frame: 700, player: 0, kind: "system" }, { frame: 1440, player: 0, kind: "build" },
    { frame: 2000, player: 1, kind: "leave" }, { frame: 2100, player: 1, kind: "select" },
  ],
} as unknown as Replay;

describe("scmjs replay watch: the picture", () => {
  it("fits the map into the terminal keeping its shape, at most two dots a tile", () => {
    expect(fitPicture(128, 128, 200, 100)).toEqual({ cols: 128, rows: 64, scale: 2 });
    expect(fitPicture(128, 128, 99, 36)).toMatchObject({ cols: 72, rows: 36 });
    expect(fitPicture(256, 128, 60, 60)).toEqual({ cols: 60, rows: 15, scale: 60 * 2 / 256 });
    expect(fitPicture(64, 64, 4, 2).cols).toBeGreaterThan(0);
  });
  it("turns dots into braille", () => {
    expect(brailleCell([[true, false], [false, false], [false, false], [false, false]])).toBe("⠁");
    expect(brailleCell([[false, true], [false, false], [false, false], [false, true]])).toBe("⢈");
    expect(brailleCell([[true, true], [true, true], [true, true], [true, true]])).toBe("⣿");
  });
  it("finds the nearest of the sixteen colours", () => {
    expect(nearestAnsi("#f40404")).toBe(9);
    expect(nearestAnsi("#0c48cc")).toBe(4);
    expect(nearestAnsi("#ffffff")).toBe(15);
    expect(nearestAnsi("#000000")).toBe(0);
  });
  it("draws a unit a dot, a building a block, a mineral field dim, and nothing for a critter", () => {
    const size = fitPicture(64, 64, 64, 16);           // 2 dots a tile: 64 cols × 32 rows... held to 16 rows
    expect(size).toEqual({ cols: 32, rows: 16, scale: 1 });
    const lines = drawMinimap({ width: 64, height: 64, terrain: start.terrain }, frame.units, sides, { size, color: false });
    expect(lines).toHaveLength(16);
    for (const l of lines) expect([...l]).toHaveLength(32);
    // Tile (16,16) is dot (16,16): cell column 8, row 4; the building fills dots (16..17, 16..17) → the top half of that cell.
    expect(lines[4][8]).toBe("⠛");
    // Two workers one dot up at tiles 17 and 18 → dots (17,15), (18,15): row 3, the bottom-right dot of cell 8 and the bottom-left of cell 9.
    expect(lines[3][8]).toBe("⢀");
    expect(lines[3][9]).toBe("⡀");
    // B's hatchery at tile 48 → dots 48..49 × 48..49: cell (24, 12), top half.
    expect(lines[12][24]).toBe("⠛");
    // The mineral fields at tile (8.5, 10) and (8.5, 11): dots (8,10), (8,11) → cell (4, 2), rows 2 and 3 of the left column.
    expect(lines[2][4]).toBe("⡄");
    // The critter at (30,30) draws nothing: cell (15, 7) stays blank.
    expect(lines[7][15]).toBe(" ");
    const lit = lines.join("").replace(/ /g, "").length;
    expect(lit).toBe(5);
  });
  it("colours each cell by the owner with most in it, the ground behind, and strips to glyphs without colour", () => {
    const size = fitPicture(64, 64, 64, 16);
    const full = drawMinimap({ width: 64, height: 64, terrain: start.terrain }, frame.units, sides, { size, color: true, full: true });
    expect(full[4]).toContain("\x1b[38;2;244;4;4m⠛");          // A's red
    expect(full[12]).toContain("\x1b[38;2;12;72;204m⠛");       // B's blue
    expect(full[2]).toContain("\x1b[38;2;111;122;134m⡄");      // the minerals' grey
    // eslint-disable-next-line no-control-regex -- the terminal's colour codes
    expect(full[0]).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);          // the ground's shade
    expect(full[0].startsWith("\x1b[49m")).toBe(true);           // the unwalkable left edge has none
    const sixteen = drawMinimap({ width: 64, height: 64, terrain: start.terrain }, frame.units, sides, { size, color: true, full: false });
    expect(sixteen[4]).toContain("\x1b[91m⠛");
    expect(sixteen[0]).not.toMatch(/48;2/);
    expect(plainPicture(full)).toEqual(drawMinimap({ width: 64, height: 64, terrain: start.terrain }, frame.units, sides, { size, color: false }));
    const ascii = drawMinimap({ width: 64, height: 64, terrain: "" }, frame.units, sides, { size, color: false, ascii: true });
    expect(ascii[4][8]).toBe("#");
    expect(ascii[3][8]).toBe("o");
    expect(ascii[2][4]).toBe(".");
  });
  it("lays the title, the clock, a line per player and three of chat around it, the same height every time", () => {
    const size = fitPicture(64, 64, 64, 16);
    const view = { start, frame, sides, apm: [120, 95], chat: [{ frame: 100, name: "B", color: "#0c48cc", text: "glhf" }], speed: 8, paused: false };
    const lines = plainPicture(pictureLines(view, { size, color: false }));
    expect(lines).toHaveLength(1 + 16 + 1 + 2 + 3);
    expect(lines[0]).toMatch(/^x\.rep 64 × 64 · jungle +0:50 frame 1,200 {2}8×$/);
    expect(lines[18]).toBe("■ A  T  150/20  10/18  3 units  120 APM");
    expect(lines[19]).toBe("■ B  Z  60/0    9/17   1 units  95 APM");
    expect(lines[20]).toBe("0:04 B: glhf");
    expect(lines[21]).toBe("");
    expect(plainPicture(pictureLines({ ...view, paused: true }, { size, color: false }))[0]).toMatch(/paused$/);
    expect(visible(summaryLine(view))).toBe(" 0:50  A T 150/20 10/18 3u 120 APM  |  B Z 60/0 9/17 1u 95 APM");
  });
  it("reads a clock", () => {
    expect(clock(1440)).toBe("1:00");
    expect(parseClock("1:00")).toBe(1429);
    expect(parseClock("0:05")).toBe(119);
    expect(parseClock("1:00:00")).toBe(85714);
    expect(() => parseClock("abc")).toThrow(CliError);
  });
});

describe("scmjs replay watch: the replay's part", () => {
  it("joins the runner's players to the replay's names and colours", () => {
    expect(sidesOf(start, replay)).toEqual([{ slot: 0, name: "Alpha", race: "terran", color: "#f40404" }, { slot: 1, name: "Beta", race: "zerg", color: "#0c48cc" }]);
    expect(sidesOf({ ...start, players: [{ slot: 5, name: "Ghost", race: "protoss", type: 1 }] }, replay)).toEqual([{ slot: 5, name: "Ghost", race: "protoss", color: "#ffffff" }]);
  });
  it("counts APM as replay info does and hands out the chat as it is said", () => {
    const t = new Tally(replay, sidesOf(start, replay));
    expect(t.advance(50)).toEqual([]);
    expect(t.apm(50)).toEqual([Math.round(2 / ((50 * 42) / 60000)), Math.round(1 / ((50 * 42) / 60000))]);
    expect(t.advance(1440)).toEqual([{ frame: 100, name: "Beta", color: "#0c48cc", text: "glhf" }]);
    expect(t.advance(1440)).toEqual([]);
    // A: select, train, build (the system line is not an action) over a minute: 3 APM.
    expect(t.apm(1440)).toEqual([3, 1]);
    t.advance(2400);
    // B left at frame 2000: the select after it is not counted, and the time stops there.
    expect(t.apm(2400)[1]).toBe(Math.round(1 / ((2000 * 42) / 60000)));
    expect(t.chat).toHaveLength(1);
  });
});

/** A runner that speaks scm-sim's protocol: paced from standard input, or free with --every. */
const FAKE_RUNNER = `
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!fs.existsSync(flag("engine") + "/core.js")) { say({ kind: "error", message: "no engine at " + flag("engine") }); process.exit(2); }
const terrain = "1".repeat(64 * 64);
say({ kind: "start", map: { name: require("node:path").basename(args[0]), width: 64, height: 64, tileset: "jungle" }, frames: 2400, players: [{ slot: 0, name: "A", race: "terran", type: 2 }, { slot: 1, name: "B", race: "zerg", type: 2 }], copy: "classic", terrain, ms: { load: 1, start: 1 } });
let frame = Number(flag("from") ?? 0);
const line = () => say({ kind: "frame", frame, players: [[50 + frame, 0, 4, 9, 4], [50, 0, 4, 9, 4]], units: [512, 512, 0, 3, 1536, 1536, 1, 3, 600 + frame, 540, 0, 1] });
const end = (ended) => { say({ kind: "end", frame, ended, reason: null, check: { named: 1, gone: 0, ahead: 0, parted: null }, ms: { game: 1, load: 1, start: 1, total: 3 } }); process.exit(0); };
line();
const every = flag("every");
if (every !== undefined) { while (frame < 2400) { frame = Math.min(2400, frame + Number(every)); line(); } end(true); }
let buf = "";
process.stdin.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\\n")) >= 0) { const n = Number(buf.slice(0, i)); buf = buf.slice(i + 1); if (!(n > 0)) return end(false); frame = Math.min(2400, frame + n); line(); if (frame >= 2400) end(true); } });
process.stdin.on("end", () => end(false));
`;

function staged(): { dir: string; replay: Input; copy: string } {
  const dir = tmp(), build = "abcdef123456", sub = join(dir, build);
  mkdirSync(sub);
  for (const f of ["core.js", "game.js", "base-s1.bin", "interface.bin"]) writeFileSync(join(sub, f), `// ${f}\n`);
  writeFileSync(join(sub, "replay-feedface.cjs"), FAKE_RUNNER);
  writeFileSync(join(dir, "current.json"), JSON.stringify({ build, files: ["core.js", "game.js", "base-s1.bin", "interface.bin"], runner: "run-feedface.cjs", replayRunner: "replay-feedface.cjs" }));
  const copy = join(dir, "sc");
  mkdirSync(copy);
  for (const f of ["StarDat.mpq", "BrooDat.mpq"]) writeFileSync(join(copy, f), "mpq");
  const file = join(dir, "g.rep");
  writeFileSync(file, "rep");
  return { dir, replay: { path: file, name: "g.rep", bytes: new Uint8Array(3), kind: "replay" }, copy };
}

describe("scmjs replay watch: the runner", () => {
  it("knows which runner an engine has", async () => {
    const s = staged();
    const engine = await ensureEngine(s.dir);
    expect(engine.runners).toEqual({ bot: "run-feedface.cjs", replay: "replay-feedface.cjs" });
    expect(runnerFor(engine, "replay")).toBe(join(s.dir, "abcdef123456", "replay-feedface.cjs"));
    expect(() => runnerFor({ ...engine, runners: { bot: "run-x.mjs" } }, "replay")).toThrow(/no replay runner/);
    // A plain folder: runners found by name.
    const plain = tmp();
    writeFileSync(join(plain, "replay-abc.mjs"), "");
    expect((await ensureEngine(plain)).runners).toEqual({ replay: "replay-abc.mjs" });
  });

  it("into a pipe: a line a frame, the chat as it comes, and the summary", async () => {
    const s = staged();
    const out: string[] = [];
    const r = await watchReplay(s.replay, replay, { engine: s.dir, starcraft: s.copy, tty: false, every: 1200, out: (t) => out.push(visible(t)) });
    expect(r.start.map).toMatchObject({ width: 64, height: 64 });
    expect(r.end).toMatchObject({ frame: 2400, ended: true });
    expect(r.pictures).toBe(3);
    expect(r.stopped).toBe(false);
    const text = out.join("");
    expect(text).toMatch(/^ 0:00 {2}Alpha T 50\/0 4\/9 4u 0 APM {2}\| {2}Beta Z 50\/0 4\/9 4u 0 APM\n/);
    expect(text).toContain(" 0:04  Beta: glhf\n 0:50  Alpha T 1250/0");
    expect(text).toMatch(/1:41 {2}Alpha T 2450\/0 4\/9 4u 2 APM/);
    expect(visible(watchSummary(s.replay, r))).toBe("✔ g.rep: watched to the end, 1:41 (frame 2,400 of 2,400) · 0.0 s");
  });

  it("as JSON: the start, a frame a line with the replay's names, the end", async () => {
    const s = staged();
    const out: string[] = [];
    await watchReplay(s.replay, replay, { engine: s.dir, starcraft: s.copy, tty: false, every: 2400, json: true, out: (t) => out.push(t) });
    const lines = out.join("").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.kind)).toEqual(["start", "frame", "frame", "end"]);
    expect(lines[0].players[0]).toMatchObject({ slot: 0, name: "Alpha", color: "#f40404", type: 2 });
    expect(lines[2]).toMatchObject({ frame: 2400, clock: "1:41", players: [{ name: "Alpha", minerals: 2450, apm: 2 }, { name: "Beta", units: 4 }], chat: [{ frame: 100, name: "Beta", text: "glhf" }] });
    expect(lines[2].units).toHaveLength(12);
  });

  it("in a terminal: draws in place, paces the runner, takes keys, and stops on q", async () => {
    const s = staged();
    const out: string[] = [];
    const keys = new PassThrough() as unknown as NodeJS.ReadStream;
    let pictures = 0;
    const r = await watchReplay(s.replay, replay, {
      engine: s.dir, starcraft: s.copy, tty: true, speed: 8, fps: 60, columns: 60, rows: 30, keys,
      out: (t) => { out.push(t); if (t.includes("\x1b[2K")) { pictures++; if (pictures === 2) keys.write("+"); if (pictures === 4) keys.write("q"); } },
    });
    expect(r.stopped).toBe(true);
    expect(r.pictures).toBe(4);
    expect(r.end).toMatchObject({ ended: false });
    // Three frames a picture at 8× and 60 pictures a second; six a picture once + doubled the speed after the second.
    expect(r.frame).toBe(3 + 6 + 6);
    const text = out.join("");
    expect(text).toContain("\x1b[?25l");
    expect(text.endsWith("\x1b[?25h")).toBe(true);
    // eslint-disable-next-line no-control-regex -- the cursor moves
    expect(text.match(/\x1b\[\d+A/g)).toHaveLength(3);                     // redrawn in place three times
    // eslint-disable-next-line no-control-regex -- the cursor moves
    const plain = visible(text.replace(/\x1b\[\d+A/g, ""));
    expect(plain).toMatch(/Starting the game · 1\.16\.1 files · g\.rep\n/);
    expect(plain).toContain("■ Alpha  T  5");
    expect(visible(watchSummary(s.replay, r))).toMatch(/^ℹ g\.rep: stopped at 0:01 \(frame 15 of 2,400\) · 0\.0 s$/);
  });

  it("says what went wrong: a runner that could not start, a deploy with no replay runner", async () => {
    const s = staged();
    const broken = staged();
    const { rmSync } = await import("node:fs");
    rmSync(join(broken.dir, "abcdef123456", "core.js"));
    await expect(watchReplay(s.replay, replay, { engine: broken.dir, starcraft: s.copy, tty: false, out: () => {} })).rejects.toThrow(/no engine at/);
    writeFileSync(join(s.dir, "current.json"), JSON.stringify({ build: "abcdef123456", files: ["core.js"], runner: "run-feedface.cjs" }));
    await expect(watchReplay(s.replay, replay, { engine: s.dir, starcraft: s.copy, tty: false, out: () => {} })).rejects.toThrow(/no replay runner/);
  });
});
