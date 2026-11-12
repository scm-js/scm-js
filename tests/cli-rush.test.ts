/**
 * `scmjs map rush` (cli/src/rush.ts): the unit named, the engine's map runner run with `--rush`, its walks kept and laid
 * out as a table of the start locations. The runner here is a stand-in script that prints what scm-sim's
 * `src/exact/mapRush.ts` prints through `runMap.ts --rush`; the real one needs the lifted game and a copy of StarCraft,
 * which CI has not got. The trace's stand-in (`tests/support/mapRunner.ts`) plays a runner from before `--rush`.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clockOf, printRush, runRush, rushJson, rushReport, unitByName } from "../cli/src/rush";
import { CliError, visible } from "../cli/src/ui";
import { classicCopy, stagedEngine } from "./support/mapRunner";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-rush-"));
const plain = (lines: string[]) => lines.map(visible);

/**
 * A runner that prints what scm-sim's does with `--rush`: three starts on a 64 × 64 map. 1 and 2 are joined (2 → 1
 * slower), 2 → 3 arrives and 3 → 2 is stuck, and 3 stands apart from 1. A map named `island.scx` has every pair apart,
 * `crowded.scx` has the map's own units (a Carrier, unit 72) walked beside the unit asked, and in its place from 1 to
 * 2, as the real runner does on a map that places units for player 1; `bare.scx` has no walks at all,
 * `bad.scx` is refused, and unit 43 (a Mutalisk) does not walk.
 */
const RUSH_RUNNER = `
const path = require("node:path");
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : undefined; };
const say = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
if (!args.includes("--rush")) { say({ kind: "error", message: "not asked for a rush" }); process.exit(2); }
const unit = Number(flag("unit"));
if (unit === 43) { say({ kind: "error", message: "unit 43 does not walk: a building, a flyer or a turret" }); process.exit(2); }
const name = path.basename(args[0]);
if (name === "bad.scx") { say({ kind: "error", message: "the game did not take this map" }); process.exit(2); }
const starts = [{ owner: 0, x: 200, y: 200 }, { owner: 1, x: 1800, y: 200 }, { owner: 2, x: 1800, y: 1800 }];
const air = (a, b) => Math.round(Math.hypot(starts[a].x - starts[b].x, starts[a].y - starts[b].y));
const island = name === "island.scx";
const walk = (from, to, outcome, frames, travelled, off) => ({ from, to, unit, outcome: island ? "apart" : outcome, frames: island ? 0 : frames, travelled: island ? 0 : travelled, off, regions: 4, air: air(from, to), at: { x: starts[from].x + 100, y: starts[from].y + 100 }, ms: 5 });
let walks = [walk(0, 1, "arrived", 400, 1900, 60), walk(0, 2, "apart", 0, 0, 2200), walk(1, 0, "arrived", 420, 1960, 60), walk(1, 2, "arrived", 380, 1750, 70), walk(2, 0, "apart", 0, 0, 2200), walk(2, 1, "stuck", 300, 900, 700)];
if (name === "crowded.scx") walks = walks.flatMap((w, i) => [{ ...w, unit: 72, outcome: "arrived", frames: 99, travelled: 333 }, ...(i === 0 ? [] : [w])]);
if (name === "bare.scx") walks = [];
say({ kind: "start", mode: "rush", map: { name, width: 64, height: 64, tileset: "badlands" }, copy: "classic", seed: Number(flag("seed") ?? 12345), unit, starts, walks: walks.length, ms: { load: 1, start: 2 } });
for (const w of walks) say({ kind: "walk", ...w });
say({ kind: "end", mode: "rush", walks, ms: { load: 1, start: 2, walk: 30, total: 1200 } });
process.exit(0);
`;

/** A staged engine whose map runner knows `--rush`. */
function rushEngine(): string {
  const staged = stagedEngine(tmp());
  writeFileSync(join(staged.dir, staged.build, "map-cafe0000.cjs"), RUSH_RUNNER);
  return staged.dir;
}
function aMap(name = "m.scx"): string {
  const dir = tmp();
  writeFileSync(join(dir, name), "MPQ");
  return join(dir, name);
}

describe("scmjs map rush: the unit", () => {
  it("takes the editor's name, the name without the race, or units.dat's id", () => {
    expect(unitByName("SCV")).toBe(7);
    expect(unitByName("Zergling")).toBe(37);
    expect(unitByName("zerg  zergling")).toBe(37);
    expect(unitByName("Dragoon")).toBe(66);
    expect(unitByName("Protoss Probe")).toBe(64);
    expect(unitByName("41")).toBe(41);
    expect(unitByName("valk")).toBe(58);
  });

  it("says which units a name could be, and when there is none", () => {
    expect(() => unitByName("Siege Tank")).toThrow(/could be "Terran Siege Tank \(Tank Mode\)" \(5\), "Siege Tank Turret \(Tank Mode\)" \(6\)/);
    expect(() => unitByName("Hydra Lisk Queen")).toThrow(/No unit is called/);
    expect(() => unitByName("999")).toThrow(/no unit 999/);
    try { unitByName("nothing at all"); } catch (e) { expect((e as CliError).exitCode).toBe(2); }
  });

  it("puts a start on the clock face from the map's middle", () => {
    expect(clockOf(2048, 100, 128, 128)).toBe(12);
    expect(clockOf(3900, 200, 128, 128)).toBe(2);
    expect(clockOf(3900, 2048, 128, 128)).toBe(3);
    expect(clockOf(2048, 4000, 128, 128)).toBe(6);
    expect(clockOf(200, 3700, 128, 128)).toBe(8);
    expect(clockOf(200, 200, 128, 128)).toBe(11);
  });
});

describe("scmjs map rush: the runner", () => {
  it("runs the map runner with --rush and keeps the walks", async () => {
    const live: string[] = [];
    const r = await runRush(aMap(), { engine: rushEngine(), starcraft: classicCopy(tmp()), unit: 37, live: (l) => live.push(visible(l)) });
    expect(r.start).toMatchObject({ mode: "rush", unit: 37, walks: 6 });
    expect(r.end.walks).toHaveLength(6);
    expect(live[0]).toBe("m.scx 64 × 64, badlands · 3 start locations · a Zergling walked 6 times · 1.16.1 files");
    expect(live.slice(1, 3)).toEqual(["  1 → 2  1,900 px, 16.8 s", "  1 → 3  apart"]);
  });

  it("says when the engine's map runner is older than map rush, a unit does not walk, or the game refuses the map", async () => {
    const copy = classicCopy(tmp());
    // The trace's stand-in ignores --rush and runs the triggers, as a runner from before it would.
    await expect(runRush(aMap(), { engine: stagedEngine(tmp()).dir, starcraft: copy })).rejects.toThrow(/is from before map rush/);
    await expect(runRush(aMap(), { engine: stagedEngine(tmp(), false).dir, starcraft: copy })).rejects.toThrow(/has no map runner/);
    const flyer = runRush(aMap(), { engine: rushEngine(), starcraft: copy, unit: 43 });
    await expect(flyer).rejects.toThrow(/The Mutalisk does not walk/);
    await expect(flyer).rejects.toMatchObject({ exitCode: 2 });
    await expect(runRush(aMap("bad.scx"), { engine: rushEngine(), starcraft: copy })).rejects.toThrow(/did not take this map/);
    await expect(runRush(join(tmp(), "nowhere.scx"), { engine: rushEngine(), starcraft: copy })).rejects.toThrow(/No file/);
  });
});

describe("scmjs map rush: the report", () => {
  it("lays the walks out by start, names the shortest and longest, and the ones that did not arrive", async () => {
    const r = await runRush(aMap(), { engine: rushEngine(), starcraft: classicCopy(tmp()), unit: 7 });
    const rep = rushReport("m.scx", r);
    expect(rep.unit).toEqual({ id: 7, name: "Terran SCV" });
    expect(rep.starts.map((s) => [s.player, s.clock])).toEqual([[1, 11], [2, 1], [3, 5]]);
    expect(rep.matrix[0][0]).toBeNull();
    expect(rep.matrix[0][1]).toMatchObject({ from: 1, to: 2, outcome: "arrived", frames: 400, seconds: 16.8, pixels: 1900, tiles: 59, air: 1600 });
    expect(rep.shortest).toMatchObject({ from: 2, to: 3, frames: 380 });
    expect(rep.longest).toMatchObject({ from: 2, to: 1, frames: 420 });
    expect(rep.short.map((w) => [w.from, w.to, w.outcome])).toEqual([[1, 3, "apart"], [3, 1, "apart"], [3, 2, "stuck"]]);

    const lines = plain(printRush("m.scx", r, { width: 120 }));
    expect(lines[0]).toBe("▲ m.scx: an SCV walked between 3 start locations by the game · 6 walks · 1.2 s");
    expect(lines.slice(2, 6)).toEqual([
      "  from ╲ to                    1                 2                 3",
      "  1 11 o'clock                 –  1,900 px, 16.8 s            no way",
      "  2 1 o'clock   1,960 px, 17.6 s                 –  1,750 px, 16.0 s",
      "  3 5 o'clock             no way             stuck                 –",
    ]);
    expect(lines).toContain("  Shortest 2 → 3: 1,750 px (55 tiles), 16.0 s · air 1,600 px, 1.09× the straight line");
    expect(lines).toContain("  Longest  2 → 1: 1,960 px (61 tiles), 17.6 s · air 1,600 px, 1.23× the straight line");
    expect(lines).toContain("  ▸ No ground joins 1 ↔ 3: an island, or ground walled off — the way there is by air or by drop");
    expect(lines).toContain("  ▸ 3 → 2 did not arrive: stuck 700 px from the base after 12.6 s");
  });

  it("splits the table in two where the terminal is too narrow for both figures", async () => {
    const r = await runRush(aMap(), { engine: rushEngine(), starcraft: classicCopy(tmp()) });
    const lines = plain(printRush("m.scx", r, { width: 60 }));
    expect(lines).toContain("  Seconds at Fastest");
    expect(lines).toContain("  Pixels walked");
    expect(lines).toContain("  2 1 o'clock   17.6 s       –  16.0 s");
    expect(lines).toContain("  2 1 o'clock    1,960      –   1,750");
  });

  it("says an island map is one, with the straight lines", async () => {
    const r = await runRush(aMap("island.scx"), { engine: rushEngine(), starcraft: classicCopy(tmp()) });
    const lines = plain(printRush("island.scx", r));
    expect(lines[0]).toMatch(/^▲ island\.scx: an SCV walked/);
    expect(lines.slice(2)).toEqual(["▲ No two start locations are joined by ground: an island map.", "  The straight lines between them:", "  1 ↔ 2  1,600 px", "  1 ↔ 3  2,263 px", "  2 ↔ 3  1,600 px"]);
    // Nothing walked at all (no walkable ground at the starts): the straight lines, under a warning.
    const bare = plain(printRush("bare.scx", await runRush(aMap("bare.scx"), { engine: rushEngine(), starcraft: classicCopy(tmp()) })));
    expect(bare[0]).toMatch(/^▲ bare\.scx: /);
    expect(bare.slice(2)).toEqual(["▲ The game could not put an SCV at the start locations to walk it: there may be no ground to walk there. map analyze reads the ground without the game.", "  The straight lines between them:", "  1 ↔ 2  1,600 px", "  1 ↔ 3  2,263 px", "  2 ↔ 3  1,600 px"]);
  });

  it("takes only the walks of the unit asked: the map's own units walked beside it are not its", async () => {
    const live: string[] = [];
    const r = await runRush(aMap("crowded.scx"), { engine: rushEngine(), starcraft: classicCopy(tmp()), live: (l) => live.push(visible(l)) });
    const rep = rushReport("crowded.scx", r);
    // One walk a pair, as on a map with no units of its own; 1 → 2 had none of the SCV's.
    expect(rep.walks.map((w) => [w.from, w.to, w.outcome])).toEqual([[1, 2, "unwalked"], [1, 3, "apart"], [2, 1, "arrived"], [2, 3, "arrived"], [3, 1, "apart"], [3, 2, "stuck"]]);
    expect(rep.walks[0]).toMatchObject({ instead: true, pixels: 0 });
    expect(live.filter((l) => /→/.test(l))).toHaveLength(5);
    const lines = plain(printRush("crowded.scx", r));
    expect(lines).toContain("  ▸ 1 → 2 not walked: the game walked the map's own units of player 1 there, not the unit asked for");
    expect(lines.join("\n")).not.toMatch(/333 px/);
  });

  it("gives the matrix and every walk as JSON", async () => {
    const r = await runRush(aMap(), { engine: rushEngine(), starcraft: classicCopy(tmp()), seed: 9 });
    const j = JSON.parse(JSON.stringify(rushJson("m.scx", r)));
    expect(Object.keys(j)).toEqual(["file", "unit", "map", "starts", "walks", "matrix", "shortest", "longest", "short", "seed", "engine", "game", "ms"]);
    expect(j.seed).toBe(9);
    expect(j.matrix).toHaveLength(3);
    expect(j.matrix[1][2]).toMatchObject({ from: 2, to: 3, seconds: 16, pixels: 1750 });
    expect(j.walks).toHaveLength(6);
  });
});
