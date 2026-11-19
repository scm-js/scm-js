/** The MCP tools that run the map in the game or draw it with the game's graphics, and `doctor`, which says whether they can. */
import { z } from "zod";
import { doctorJson, doctorReport, printDoctor, readiness, type Check, type ReadyGroup } from "./doctor";
import { balanceJson, printBalance, runBalance } from "./balance";
import { parseRaces } from "./ladder";
import { loadMapInput, type Input, openMap } from "./files";
import { mapReport } from "./map";
import { coverageJson, coverageScenario, printCoverage, runCoverage } from "./coverage";
import { openGameFiles } from "./gamefiles";
import { analyzeLayout, layoutLines, layoutPicture, layoutReport, loadLayoutFiles } from "./analyze";
import { encodePng } from "./png";
import { DEFAULT_PNG_SCALE, loadGraphics, previewPng, tilesetOf } from "./preview";
import { costJson, gameClock, gameMap, printCost, printTrace, removeGameMap, replayRun, runMapInGame, traceJson, type MapRunOptions, replayForGame } from "./trace";
import { gameFilesOrNull } from "./mod/open";
import { modOverlay } from "./mod/overlay";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defaultOut, defaultTests, happened, happenedLines, planInline, readMapForTests, readTests, runTests, saveScenarios, testJson, type Happened, type PlannedScenario, type ScenarioResult } from "./maptest";
import { CliError, nearPath, num, plural, visible, printErr } from "./ui";
import { path, ok, noPipe, outsideRoot, tool, MAX_FRAMES, FRAMES, WIDTH, starcraftArg, type Extra, type McpContext, type Reg } from "./mcpkit";

/** A frame as the trace gives it: the game's clock. */
const clock = gameClock;

/**
 * A scenario as `map_test` reports it: every expectation with what the game gave, held or not, then what the game did
 * whatever was expected — how it ended, what the person was shown, which triggers fired. A model asks to find out as
 * often as to check, and has no screen to look at.
 */
export function testLines(r: ScenarioResult, h: Happened | undefined, all: boolean): string[] {
  const failed = r.results.filter((x) => !x.ok).length;
  const verdict = !r.results.length ? "· " : failed ? "✖ " : "✔ ";
  const out = [`  ${verdict}${r.name}  ${r.results.length ? `${r.results.length - failed} of ${plural(r.results.length, "expectation")} held` : "expects nothing"}`];
  for (const x of r.results) out.push(`      ${x.ok ? "✔" : "✖"} ${x.what}: ${x.actual}`);
  // What the game said at the start (a unit it could not place) is often why a scenario failed; "shown" has it for the rest.
  if (failed) for (const n of r.notices.slice(0, 3)) out.push(`      the game said: ${n}`);
  if (r.parted !== null) out.push(`      ▲ the game parted from the replay at ${clock(r.parted)} (frame ${num(r.parted)}): the map has changed too much for this game`);
  if (r.replay) out.push(`      replay of this game: ${nearPath(r.replay)} (map_trace takes it as \`replay\`, for every trigger and why it did not fire)`);
  if (h) out.push(...happenedLines(h, all, "`all`"));
  return out;
}

export function addGameTools(reg: Reg, { options, root }: McpContext): void {
  /** The game tools' arguments: the map, how long, the seed, the copy of the game. */
  const game = (most: number) => ({
    path: path.optional().describe("the map file: .scm, .scx or .chk; with `replay`, played in place of the replay's own (leave it out for the replay's own map)"),
    frames: z.number().int().min(1).max(most).optional().describe(`frames to run, 24 a second: ${FRAMES.toLocaleString("en")} (100 seconds of play) by default, at most ${most.toLocaleString("en")}; the game may end sooner. With \`replay\`, to the replay's end (within the cap) by default`),
    every: z.number().int().min(1).optional().describe("frames between progress notifications, 600 by default (the command's --every)"),
    replay: z.string().optional().describe("play a replay's game instead (the command's --replay): its players' commands, on its own map or on `path`"),
    order: z.boolean().optional().describe("with `replay`, list every firing in the order the game ran it"),
    seed: z.number().int().min(0).optional().describe("the game's seed, 1 by default; the same seed and map give the same run"),
    starcraft: starcraftArg,
    all: z.boolean().optional().describe("list every trigger; a long list is cut otherwise (the data has them all)"),
    mod: z.string().optional().describe("lay a mod over the game (the command's --mod): a mod folder, an .mpq, a mod's .exe or .zip; needs a play page whose engine takes a mod"),
  });
  /**
   * Runs the map in the game for one of the two taps: the copy the game is handed, the runner's live lines to standard
   * error (standard output is the protocol), its progress as the client's progress notifications when it asked for them.
   */
  const play = async (what: "trace" | "cost", a: { path?: string; frames?: number; every?: number; seed?: number; starcraft?: string; mod?: string; replay?: string; order?: boolean }, extra: Extra) => {
    noPipe(a.mod, a.replay);
    if (a.order && !a.replay) throw new CliError("`order` lists the firings of a replay's game: give `replay` too", null, 2);
    if (!a.path && !a.replay) throw new CliError("Give `path`, the map, or `replay`", null, 2);
    const named = a.path ? await openMap(a.path) : null;
    let input: Input, doc: Awaited<ReturnType<typeof loadMapInput>> | null = named?.doc ?? null, scenario, target: { path: string | null; converted: boolean }, note: string[] = [];
    if (a.replay) {
      const { input: replayInput, rep } = await replayForGame(a.replay, { mod: a.mod, starcraft: a.starcraft, warn: (line) => note.push(visible(line)) });
      const run = await replayRun(rep, named && { doc: named.doc, path: named.input.path, name: named.input.name, bytes: named.input.bytes });
      input = replayInput;
      scenario = run.scenario;
      target = { path: run.map, converted: run.converted };
      if (named && run.differs) note.push(`${named.input.name} differs from the map in the replay (${run.differs}): a changed map can make the replay go out of step, and the trace says if that happens`);
    } else {
      input = named!.input;
      scenario = named!.doc.scenario;
      target = await gameMap(named!.doc, input.path, input.name);
    }
    const overlay = a.mod ? modOverlay(a.mod, () => gameFilesOrNull(a.starcraft)) : null;
    const frames = a.frames ?? (a.replay ? MAX_FRAMES[what] : FRAMES);
    const token = extra._meta?.progressToken;
    const o: MapRunOptions = {
      frames, every: a.every ?? 600, seed: a.seed ?? 1, starcraft: a.starcraft, engine: options.engine, weigh: options.weigh, replay: a.replay ? input.path : undefined, order: a.order,
      live: (line) => printErr(visible(line)),
      onProgress: token === undefined ? undefined : (l) => void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: l.frame, total: frames, message: `frame ${l.frame} of ${frames}` } }).catch(() => {}),
      // The client cancelling the request stops the game, rather than leaving the runner to play on unheard.
      signal: extra.signal,
      mod: overlay ?? undefined,
    };
    const r = await runMapInGame(target.path, what, o).finally(() => overlay?.remove());
    if (target.converted) note = [`${named ? named.input.name : `The map in ${input.name}`} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War was run instead`, ...note];
    return { input, doc, scenario, r, note };
  };
  const needs = "Needs a copy of StarCraft (Remastered or 1.16.1) on this computer and the game engine, which is fetched from the play page the first time (about 25 MB to download) into the cache; doctor says whether both are there. Takes a few seconds for the default run.";

  reg("map_trace", {
    title: "Run the triggers in the game",
    description: `Run the map in the game itself (scmjs map trace) as Use Map Settings, the person's seat idle and the computers as the map has them, for a number of frames, and report each trigger: how often it fired, the first and last frame, whose it is; then the triggers that never fired, each with the condition that said no last. Nobody plays, so a trigger waiting on a player's move will not fire: map_test puts someone at the controls. The rows as data, with every copy of a trigger the game held. ${needs}`,
    inputSchema: game(MAX_FRAMES.trace),
    annotations: { readOnlyHint: true },
  }, tool(async (a, extra) => {
    const { input, scenario, r, note } = await play("trace", a, extra);
    return ok([...note, ...printTrace(input.name, scenario, r, { all: !!a.all, width: WIDTH })], traceJson(input.name, scenario, r));
  }));

  reg("map_cost", {
    title: "What the triggers cost a frame",
    description: `Run the map in the game as map_trace does and weigh every trigger the game passes and every condition and action it runs as StarCraft: Remastered charges for them (scmjs map cost): milliseconds a frame on average where the triggers ran and at the most, against what a frame can carry (smooth to about 15 ms), then the costliest triggers. The frame-by-frame series as data. ${needs}`,
    inputSchema: game(MAX_FRAMES.cost),
    annotations: { readOnlyHint: true },
  }, tool(async (a, extra) => {
    const { input, scenario, r, note } = await play("cost", a, extra);
    return ok([...note, ...printCost(input.name, scenario, r, { all: !!a.all, width: WIDTH })], costJson(input.name, r));
  }));

  reg("map_coverage", {
    title: "Which triggers fired in many games",
    description: `Play each replay's game on the map in the game itself, as map_trace plays a replay, and count every trigger's firings over all of them (scmjs map coverage): for each trigger the games it fired in, how often in all and when first, then the triggers a player owned that never fired in any game, each with the condition that said no last. Replays are files or folders (sub-folders too); only Use Map Settings games of this map count (the same map, or one with the same name and size; \`anyMap\` takes others). \`tests\` counts the map's tests (map.tests.json beside it) as games too, without judging what they expect: map_test plays them and judges. A game whose commands parted from the map counts only what fired before that, and the result says so. ${needs.replace(" Takes a few seconds for the default run.", "")} A replay takes about as many seconds as it has minutes of play, a few at once.`,
    inputSchema: {
      path,
      replays: z.array(z.string()).describe("replay files (.rep) or folders of them; a tests file (.json) counts its scenarios"),
      tests: z.boolean().optional().describe("count the games of the map's tests (<map>.tests.json beside it) too"),
      anyMap: z.boolean().optional().describe("take replays played on another map too (the command's --any-map)"),
      force: z.boolean().optional().describe("the same as anyMap, its older name"),
      starcraft: starcraftArg,
      all: z.boolean().optional().describe("list every trigger, those no player in the games owned too"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, replays, tests, anyMap, force: forceToo, starcraft, all }, extra) => {
    const force = anyMap ?? forceToo;
    noPipe(...replays);
    const { input, doc } = await openMap(file);
    const r = await runCoverage(input, doc, replays, { tests, force, starcraft, engine: options.engine, signal: extra.signal }, (line) => printErr(visible(line)));
    const scn = await coverageScenario(input);
    return ok(printCoverage(r, scn, { all: !!all, width: WIDTH }), coverageJson(r, scn));
  }));

  reg("map_test", {
    title: "Play scenarios on the map and see what happens",
    description: `Play the map in the game itself with someone at the controls (scmjs map test), a game a scenario, and report what happened: each expectation held or not with what the game gave instead, how the game ended and for whom, the person's minerals and gas, every line of text the person was shown and when, and the map's triggers that fired in the order they first did. Use it to check your own work after changing triggers, and to find out what a map does. Scenarios come inline in \`scenarios\`, from tests files in \`tests\`, or with neither from <map>.tests.json beside the map; \`save\` writes the inline ones into that file (a scenario of the same name replaced), so they are run again later by map_test with the path alone. A scenario: {"name": "fetch quest", "frames": "1:30", "setup": [...], "steps": [...], "expect": [...]}; frames are 24 a second, and any time is frames or "m:ss". \`setup\` entries happen at the start and \`steps\` entries at their "at": {"create": "Terran Marine", "player": 1, "count": 2, "location": "Gate"}, {"kill": unit, "player", "count" or "all", "location"}, {"remove": …}, {"give": unit, "player", "to": 2}, {"switch": "Door open", "state": "set" or "clear"}, {"minerals": 500 or "+50", "player": 1}, {"gas": …}, {"deaths": unit, "player", "count": 3}, {"action": "Any action as the trigger text writes it;"}. Steps also take the person's own commands: {"at": "0:05", "order": "move", "unit": "Terran Marine", "location": "Village", "to": "Gate"} (move, attack, patrol, stop, hold; \`unit\` and \`location\` pick which of the person's units, all of them when left out; \`to\` is a location's name or a tile [x, y]) and {"at": 24, "chat": "text"}. \`expect\` entries are judged at the end: {"trigger": number or its Comment, "fired": true, false, a count or ">= 2"}, {"switch": name, "is": "set"}, {"deaths": unit, "player": 3, "is": ">= 6"}, {"minerals": ">= 100", "player": 1}, {"units": unit, "player": 1, "location": name, "is": 1}, {"text": "part of a line", "shown": true}, {"outcome": "victory", "defeat", "draw" or "none", "player": 1}, {"ended": true}. A scenario may leave \`expect\` out to see what happens. Setup and timed effects run as triggers, so they land on the game's trigger passes (about every 31 frames), and a unit killed by "kill" is a trigger's Kill Unit, which adds to no death count: to test a Deaths condition, create units that fight or set the count with "deaths". Units move at the game's pace: give an order time to arrive. The replay of a scenario that failed is kept in <map>.tests/ beside the map. A scenario takes about two seconds plus its play. ${needs.replace(" Takes a few seconds for the default run.", "")}`,
    inputSchema: {
      path,
      scenarios: z.array(z.record(z.string(), z.unknown())).optional().describe("scenarios to play, in the tests file's form (the description has it)"),
      tests: z.array(z.string()).optional().describe("tests files (.json) to play; <map>.tests.json beside the map when neither this nor `scenarios` is given"),
      only: z.array(z.string()).optional().describe("of the scenarios read from files, play only those with these names"),
      save: z.boolean().optional().describe("write `scenarios` into <map>.tests.json beside the map after playing them, to be run again later"),
      frames: z.number().int().min(1).max(MAX_FRAMES.test).optional().describe(`frames a scenario runs when it does not say: ${FRAMES.toLocaleString("en")} (100 seconds of play) by default, at most ${MAX_FRAMES.test.toLocaleString("en")}`),
      seed: z.number().int().min(0).optional().describe("the game's seed when a scenario does not say, 1 by default; the same seed and map give the same game"),
      all: z.boolean().optional().describe("list every line shown and every trigger fired; long lists are cut otherwise"),
      mod: z.string().optional().describe("lay a mod over the game (the command's --mod): a mod folder, an .mpq, a mod's .exe or .zip"),
      starcraft: starcraftArg,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, tool(async ({ path: file, scenarios: inline, tests, only, save, frames, seed, all, mod, starcraft }, extra) => {
    noPipe(mod, ...(tests ?? []));
    if (save && !inline?.length) throw new CliError("`save` keeps the scenarios given in `scenarios`: give some", null, 2);
    const { input } = await openMap(file);
    const map = await readMapForTests(input.bytes);
    const defaults = { frames: frames ?? FRAMES, seed: seed ?? 1 };
    const beside = defaultTests(input.path);
    const planned: PlannedScenario[] = [];
    if (inline?.length) {
      // A replay a scenario names is a file read from this computer, kept to the folder as every path argument is.
      for (const s of inline) if (root !== null && typeof s.replay === "string" && outsideRoot({ replay: resolve(dirname(beside), s.replay) }, root) !== null) throw new CliError(`${s.replay} is outside the folder the tools work in (${root})`, null, 2);
      planned.push(...planInline(map.chk, inline, beside, defaults));
    }
    const files = tests?.length ? tests : inline?.length ? [] : [beside];
    for (const f of files) {
      if (!existsSync(f)) throw new CliError(`No tests file ${f}`, tests?.length ? null : "Give the scenarios to play in `scenarios`; with `save` they are written to that file.", 2);
      const read = readTests(f, readFileSync(f, "utf8"), map.chk, defaults);
      const wanted = only?.map((n) => n.trim().toLowerCase());
      planned.push(...(wanted ? read.filter((p) => wanted.includes(p.name.toLowerCase())) : read));
    }
    if (!planned.length) throw new CliError(only?.length ? `No scenario is named ${only.map((n) => JSON.stringify(n)).join(" or ")} in ${files.join(", ")}` : "There are no scenarios to play", null, 2);
    const long = planned.find((p) => !p.replay && p.frames > MAX_FRAMES.test);
    if (long) throw new CliError(`"${long.name}" runs ${num(long.frames)} frames: a scenario here runs ${num(MAX_FRAMES.test)} at most (an hour of play)`, null, 2);
    const overlay = mod ? modOverlay(mod, () => gameFilesOrNull(starcraft)) : null;
    const seen = new Map<PlannedScenario, Happened>();
    const token = extra._meta?.progressToken;
    let done = 0;
    const run = await runTests(input.name, planned, map, {
      out: defaultOut(input.path), starcraft, engine: options.engine, signal: extra.signal, mod: overlay ?? undefined, quiet: true,
      live: (line) => printErr(visible(line)),
      onEnd: (p, start, end) => {
        seen.set(p, happened(p, start, end));
        if (token !== undefined) void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: ++done, total: planned.length, message: `${p.name}: played` } }).catch(() => {});
      },
    }).finally(() => overlay?.remove());
    const what = planned.map((p) => seen.get(p));
    const failed = run.scenarios.filter((s) => !s.ok).length, unjudged = run.scenarios.filter((s) => !s.results.length).length, passed = run.scenarios.length - failed - unjudged;
    const lines = [`${input.name}: ${plural(planned[0].rows, "trigger")}, ${plural(planned.length, "scenario")} played`];
    if (planned[0].converted) lines.push(`${input.name} is in the StarCraft 1.00 form, which the engine does not run: each scenario ran a copy converted to Brood War`);
    run.scenarios.forEach((r, i) => lines.push(...testLines(r, what[i], !!all)));
    lines.push(`${failed ? "✖" : "✔"} ${[passed ? `${passed} passed` : "", failed ? `${failed} failed` : "", unjudged ? `${unjudged} expected nothing` : ""].filter(Boolean).join(", ")}`);
    let kept: ReturnType<typeof saveScenarios> | null = null;
    if (save) {
      kept = saveScenarios(beside, inline!);
      lines.push(`Kept in ${nearPath(beside)}: ${[kept.added.length ? `${kept.added.length} added` : "", kept.replaced.length ? `${kept.replaced.length} replaced` : ""].filter(Boolean).join(", ")}. map_test with the path alone plays the file.`);
    }
    const result = ok(lines, { ...testJson(input.path, run), scenarios: run.scenarios.map((s, i) => ({ ...s, ms: Math.round(s.ms), happened: what[i] ?? null })), ...(kept ? { saved: { file: beside, ...kept } } : {}) });
    // A scenario that failed is a result to read, not a tool that failed.
    return result;
  }));

  reg("map_balance", {
    title: "Is the map fair to every start",
    description: `Play games on a melee map (scmjs map balance) with the person's own BWAPI bots: one bot against the game's computer, or two bots both ways round, a seed a round. The game deals the start locations, so each game's replay is played back to read which start each side had and when one first lost a unit to the other. Per start location: games, wins, the win rate beside what the sides' own records predict, average length and first contact, the walk to the other starts, the main's minerals and gas; then a verdict. Takes minutes (a game is 10 to 60 seconds, several at once). ${needs.replace(" Takes a few seconds for the default run.", "")}`,
    inputSchema: {
      path,
      bots: z.array(z.string()).min(1).max(2).describe("one or two .scmbot files on this computer; a race after a colon: mybot.scmbot:p"),
      races: z.string().optional().describe("the races a side plays when it has none of its own: letters of z, t, p and r, r (random) by default"),
      games: z.number().int().min(1).max(50).optional().describe("rounds, a seed each: 8 by default"),
      frames: z.number().int().min(1000).max(50000).optional().describe("stop a game nobody has won after this many frames, 30,000 by default"),
      parallel: z.number().int().min(1).max(8).optional().describe("games at once"),
      starcraft: starcraftArg,
    },
    annotations: { readOnlyHint: true },
  }, tool(async (a) => {
    const { input, doc } = await openMap(a.path);
    const races = parseRaces(a.races ?? "r");
    const playMap = await gameMap(doc, input.path, input.name), rushMap = await gameMap(doc, input.path, input.name);
    try {
      const r = await runBalance(input.name, input.path, doc, {
        bots: a.bots, races, seeds: Array.from({ length: a.games ?? 8 }, (_, k) => k + 1), frames: a.frames ?? 30000, parallel: a.parallel,
        starcraft: a.starcraft, engine: options.engine, play: playMap.path, rushPlay: rushMap.path, live: (line) => printErr(visible(line)),
      });
      return ok(printBalance(r), balanceJson(r));
    } finally { removeGameMap(playMap.path); removeGameMap(rushMap.path); }
  }));
}

/**
 * What the tools need, by tool: the doctor tool's summary in place of the commands'. Everything else a tool does needs
 * nothing beyond scmjs.
 */
const TOOL_READY: ReadyGroup[] = [
  { commands: "map_info, map_check, map_edit and the other map, mod, replay and editor tools", needs: [] },
  { commands: "map_preview, map_analyze, map_generate, map_terrain, map_doodads", needs: ["StarCraft"] },
  { commands: "map_build, and the compile check of map_script_import", needs: ["TypeScript"] },
  { commands: "map_trace, map_cost, map_test", needs: ["StarCraft", "map"] },
  { commands: "map_coverage", needs: ["StarCraft", "replay"] },
  { commands: "map_balance", needs: ["StarCraft", "match", "replay"] },
];
/**
 * The checks a tool can be held up by. Docker, the browser, ffmpeg, the desktop app and Claude Code's settings serve
 * commands that are not tools. TypeScript is `map_build`'s and the compile check's: it was left out once, after a
 * map maker in Claude Desktop was told to run npm for it, and then a model was told "every tool is ready" beside a
 * TypeScript 7 that `map_build` cannot use. The Claude Desktop bundle now carries its own, so there it reads as found.
 */
const TOOL_CHECKS = new Set(["Node", "scmjs", "TypeScript", "StarCraft", "Game engine", "scmjs.dev"]);

/**
 * `scmjs doctor` as the tools see it: the checks a tool can be held up by, each said in the tools' terms, and what is
 * ready by tool. A model read the commands' report to a person in Claude Desktop as "map build is not working, run npm
 * install typescript", and said twice that the check did not say what a thing was for (2026-11-17).
 */
export function doctorForTools(r: Awaited<ReturnType<typeof doctorReport>>): { text: string[]; json: ReturnType<typeof doctorJson> } {
  const checks = r.checks.filter((c) => TOOL_CHECKS.has(c.what)).map((c): Check => {
    if (c.what === "Game engine" && !c.engine?.build) return { ...c, note: "map_trace, map_cost, map_coverage and map_balance fetch it from the play page by themselves the first time one runs (about 25 MB). Nothing to install." };
    // The Claude Desktop extension carries its own, so a map maker there is never sent to npm for it.
    if (c.what === "TypeScript" && c.state !== "ok") return { ...c, note: "map_build and the compile check of map_script_import use it (TypeScript 6); every other tool works without. In a terminal, in the maps folder: npm install typescript@6.", fix: undefined };
    if (c.what === "scmjs.dev") return { ...c, note: "share, replay_sync and the library_ tools use the session. account_login signs the person in, in their browser, if they want to.", fix: undefined };
    return c;
  });
  const ready = readiness(r.checks, TOOL_READY);
  const report = { ...r, checks };
  // "Tools" heads TypeScript and the sign-in in the commands' report; here a tool is one of these.
  const text = printDoctor(report, 140, { ready, every: "Every tool is ready on this computer.", notes: true }).map((l) => (visible(l) === "  Tools" ? "  Also used" : l));
  return { text, json: doctorJson(report, ready) };
}

export function addDoctorTool(reg: Reg): void {
  reg("doctor", {
    title: "What this computer has",
    description: "Checks what scmJS can use on this computer: a copy of StarCraft, the game engine, the scmjs.dev sign-in, and whether a newer scmjs is out (scmjs doctor, said in the tools' terms). It ends with which tools are ready, and for each thing missing says what it is for and what the person can install or set. Call it before map_trace or map_cost, when one fails, or when the person asks whether their setup works. Changes nothing.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => {
    const { text, json } = doctorForTools(await doctorReport());
    return ok(text, json);
  }));
}

export function addPictureTools(reg: Reg): void {
  reg("map_preview", {
    title: "A picture of the map",
    description: "The map as a picture (scmjs map preview): the terrain drawn with the game's own tileset graphics, read from the person's copy of StarCraft, with a dot for every unit in its owner's colour, mineral fields and geysers in theirs, and the start locations framed. The result is a PNG image, plus the picture's facts as text and data. `scale` is pixels a tile, 1 to 8 (4 by default: a 128 × 128 map is 512 px); `marks: false` draws the terrain alone. Needs a copy of StarCraft (Remastered or 1.16.1) on this computer; doctor says whether one is there.",
    inputSchema: {
      path,
      scale: z.number().int().min(1).max(8).optional().describe("pixels a tile: 1, 2, 4 or 8 (4 by default)"),
      marks: z.boolean().optional().describe("units, resources and start locations over the terrain (the default); false for the terrain alone"),
      units: z.boolean().optional().describe("the command's --no-units as units: false; the same as marks"),
      starcraft: starcraftArg,
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, scale, marks: drawMarks, units, starcraft }) => {
    const marks = drawMarks ?? units;
    const s = scale ?? DEFAULT_PNG_SCALE;
    if (![1, 2, 4, 8].includes(s)) throw new CliError(`scale takes 1, 2, 4 or 8, not ${s}`, null, 2);
    const { input, doc } = await openMap(file);
    const t0 = performance.now();
    const files = await openGameFiles(starcraft);
    const graphics = await loadGraphics(doc.scenario, files);
    const drawn = previewPng(doc, graphics, { scale: s, marks: marks !== false });
    const facts = { file: input.name, name: mapReport(input, doc).name, size: { width: doc.scenario.width, height: doc.scenario.height }, tileset: tilesetOf(doc.scenario), picture: { width: drawn.picture.width, height: drawn.picture.height, scale: s, bytes: drawn.png.length }, drawn: drawn.counts, ms: Math.round(performance.now() - t0) };
    const text = `${input.name}: ${facts.size.width} × ${facts.size.height}, ${facts.tileset}, drawn at ${s} px a tile (${facts.picture.width} × ${facts.picture.height}); ${plural(facts.drawn.starts, "start location")}, ${plural(facts.drawn.units, "unit")}, ${plural(facts.drawn.buildings, "building")}, ${plural(facts.drawn.minerals, "mineral field")}, ${plural(facts.drawn.geysers, "geyser")}`;
    return { content: [{ type: "image", data: Buffer.from(drawn.png).toString("base64"), mimeType: "image/png" }, { type: "text", text }], structuredContent: facts };
  }));

  reg("map_analyze", {
    title: "A melee map's layout",
    description: "A melee map's layout without running the game (scmjs map analyze): each start location's place, its main's fields and geysers, its natural (the nearest other base on foot) with the ground and straight-line distance, the ground walk between every pair of starts beside the straight line (tiles, and seconds for a Zergling, Marine and Zealot), the narrowest passage on each walk and on each main's way out, the walkable, buildable and high-ground shares, and verdicts (a ✔/▲/ℹ line each, with the rule's threshold in the docs). Walks are over the tileset's walkable minitiles with buildings and resources in the way; they agree with the game's own walks (map rush) within a few percent. With `picture`, also a PNG: the map with the walks in white, the walks to the naturals in yellow, naturals circled in the player's colour, each way out boxed in orange and other narrow points in red. Needs a copy of StarCraft (Remastered or 1.16.1) on this computer for the tileset; doctor says whether one is there.",
    inputSchema: {
      path,
      all: z.boolean().optional().describe("every pair of starts and every base in the text, not only the shortest and longest pair on a map of five starts or more"),
      picture: z.boolean().optional().describe("also return the map as a PNG with the walks, naturals and narrow points drawn on it"),
      scale: z.number().int().min(1).max(8).optional().describe("the picture's pixels a tile: 1, 2, 4 or 8 (4 by default)"),
      starcraft: starcraftArg,
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, all, picture, scale, starcraft }) => {
    const s = scale ?? DEFAULT_PNG_SCALE;
    if (![1, 2, 4, 8].includes(s)) throw new CliError(`scale takes 1, 2, 4 or 8, not ${s}`, null, 2);
    const { input, doc } = await openMap(file);
    const t0 = performance.now();
    const files = await openGameFiles(starcraft, "Which ground is walkable comes from the person's installation's tileset");
    const layoutFiles = await loadLayoutFiles(doc.scenario, files);
    const t1 = performance.now();
    const layout = analyzeLayout(doc.scenario, layoutFiles);
    const report = layoutReport(input, doc.scenario, files, layout, { copy: Math.round(t1 - t0), analyze: Math.round(performance.now() - t1), total: Math.round(performance.now() - t0) });
    const result = ok(layoutLines(report, files, !!all), report);
    if (picture) {
      const pic = layoutPicture(doc, layoutFiles, layout, s);
      result.content.unshift({ type: "image", data: Buffer.from(encodePng(pic.pixels, pic.width, pic.height)).toString("base64"), mimeType: "image/png" });
    }
    return result;
  }));
}
