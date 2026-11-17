/** The MCP tools that run the map in the game or draw it with the game's graphics, and `doctor`, which says whether they can. */
import { z } from "zod";
import { doctorJson, doctorReport, printDoctor } from "./doctor";
import { balanceJson, printBalance, runBalance } from "./balance";
import { parseRaces } from "./ladder";
import { loadMapInput, type Input, openMap } from "./files";
import { mapReport } from "./map";
import { coverageJson, coverageScenario, printCoverage, runCoverage } from "./coverage";
import { openGameFiles } from "./gamefiles";
import { analyzeLayout, layoutLines, layoutPicture, layoutReport, loadLayoutFiles } from "./analyze";
import { encodePng } from "./png";
import { DEFAULT_PNG_SCALE, loadGraphics, previewPng, tilesetOf } from "./preview";
import { costJson, gameMap, printCost, printTrace, removeGameMap, replayRun, runMapInGame, traceJson, type MapRunOptions, replayForGame } from "./trace";
import { gameFilesOrNull } from "./mod/open";
import { modOverlay } from "./mod/overlay";
import { CliError, plural, visible, printErr } from "./ui";
import { path, ok, noPipe, tool, MAX_FRAMES, FRAMES, WIDTH, starcraftArg, type Extra, type McpContext, type Reg } from "./mcpkit";

export function addGameTools(reg: Reg, { options }: McpContext): void {
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
    description: `Run the map in the game itself (scmjs map trace) as Use Map Settings, the person's seat idle and the computers as the map has them, for a number of frames, and report each trigger: how often it fired, the first and last frame, whose it is; then the triggers that never fired, each with the condition that said no last. Nobody plays, so a trigger waiting on a player's move will not fire. The rows as data, with every copy of a trigger the game held. ${needs}`,
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
    description: `Play each replay's game on the map in the game itself, as map_trace plays a replay, and count every trigger's firings over all of them (scmjs map coverage): for each trigger the games it fired in, how often in all and when first, then the triggers a player owned that never fired in any game, each with the condition that said no last. Replays are files or folders (sub-folders too); only Use Map Settings games of this map count (the same map, or one with the same name and size; \`anyMap\` takes others). \`tests\` counts the map's tests (map.tests.json beside it) as games too. A game whose commands parted from the map counts only what fired before that, and the result says so. ${needs.replace(" Takes a few seconds for the default run.", "")} A replay takes about as many seconds as it has minutes of play, a few at once.`,
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

export function addDoctorTool(reg: Reg): void {
  reg("doctor", {
    title: "What this computer has",
    description: "What this computer has of what the tools need beyond Node (scmjs doctor): whether a copy of StarCraft and the game engine are there, which map_trace and map_cost need, TypeScript for map_build, and whether npm has a newer scmjs; for each thing missing, what the person can install or set. Call it before map_trace or map_cost, or when one fails, to know what to tell the person. Changes nothing.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => {
    const r = await doctorReport();
    return ok(printDoctor(r), doctorJson(r));
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
