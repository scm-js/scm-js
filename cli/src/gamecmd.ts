/**
 * The `scmjs map` commands that run the map in the game or read its ground: trace, cost, rush, analyze, balance, test,
 * preview, heatmap and coverage.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { Command, Option } from "commander";
import { VERSION } from "./about";
import { parseRaces } from "./ladder";
import { costJson, gameMap, printCost, printTrace, removeGameMap, replayRun, runMapInGame, traceJson, replayForGame } from "./trace";
import { printRush, runRush, rushJson, unitByName } from "./rush";
import { balanceJson, printBalance, runBalance, startPlaces } from "./balance";
import { CLIP_KINDS, clipsDir, clipsSummary, makeClips, type ClipKind, type ClipRun } from "./clips";
import { expectKind, loadReplayInput, readInput, STDIO, openMap } from "./files";
import { refuseModReplay } from "./replaymod";
import { githubCoverageAnnotations, githubTestAnnotations, junitCoverageXml, junitTestXml, sarifCoverageJson, sarifTestJson, type Format, type TestReport } from "./report";
import { coverageForm, coverageJson, coverageScenario, printCoverage, runCoverage } from "./coverage";
import { defaultOut, defaultTests, readMapForTests, readTests, recordLines, recordTest, runTests, testHeader, testJson, testSummary, updateSkipped, updateTests, type PlannedScenario } from "./maptest";
import { previewMap, PNG_SCALES } from "./preview";
import { analyzeMap } from "./analyze";
import { heatmapMap, type HeatmapOptions as HeatmapFlags } from "./heatmap";
import { gameFilesOrNull } from "./mod/open";
import { modOverlay } from "./mod/overlay";
import { modWords } from "./engine";
import { t } from "./i18n";
import { CliError, mark, pc, print, visible } from "./ui";
import { parseFrames, parseWhole } from "./values";
import { say, note } from "./cmdkit";
import { jsonOption, starcraftOption, outOption, forceOption, engineOption, modOption, formatOption, checkFormat, raiseExitCode, refuseJsonOnPipe, reportFormat } from "./options";

/** `--every`, `--seed`, `--games`: whole numbers, or exit 2 (values.ts reads them for every command alike). */
const whole = parseWhole;
const gameOptions = (cmd: Command) => cmd
  .option("--frames <n>", t("frames to run (24 a second), or a time as m:ss; the game may end sooner"), "2400")
  .option("--every <n>", t("frames between progress lines; 0 for none (with --replay, a minute of play: 1,440)"), "600")
  .option("--seed <n>", t("the game's seed; the same seed and map give the same run"), "1")
  .option("--all", t("list every trigger; by default a long list is cut"))
  .addOption(starcraftOption())
  .addOption(modOption())
  .addOption(engineOption());
interface GameOptions { json?: boolean; frames: string; every: string; seed: string; all?: boolean; starcraft?: string; engine?: string; mod?: string }

/** `--mod`: the mod written out for the runner when the engine takes one, removed when the run ends. */
const overlayOf = (o: { mod?: string; starcraft?: string }) => (o.mod ? modOverlay(o.mod, () => gameFilesOrNull(o.starcraft)) : null);

/** `--replay` and `--order` for map trace and map cost. */
interface ReplayOptions { replay?: string; order?: boolean }

/**
 * What map trace and map cost run: the map with nobody playing, or with `--replay` the replay's game — on its own
 * map, or on the map named in place of it (said when the two differ: a changed map can make the replay go out of
 * step). `--frames` left at its default runs a replay to its end.
 */
async function gameRun(file: string | undefined, o: GameOptions & ReplayOptions, cmd: Command) {
  if (o.order && !o.replay) throw new CliError(t("--order lists the firings of a replay's game: use it with --replay."), null, 2);
  if (o.replay && cmd.getOptionValueSource("seed") === "cli") throw new CliError(t("--seed does nothing with --replay: the game plays with the replay's own seed."), null, 2);
  // The values first: nothing is opened for a run that cannot start.
  const frames = cmd.getOptionValueSource("frames") === "default" && o.replay ? undefined : parseFrames(o.frames);
  if (!o.replay) {
    if (!file) throw new CliError(t("Name a map, or a replay with --replay."), null, 2);
    const { input, doc } = await openMap(file);
    const game = await gameMap(doc, input.path, input.name);
    if (game.converted && !o.json) note(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead", { name: input.name })));
    return { name: file, scenario: doc.scenario, map: game.path as string | null, replay: undefined, frames, extra: {} };
  }
  const { input: replayInput, rep } = await replayForGame(o.replay, { mod: o.mod, starcraft: o.starcraft, warn: (line) => process.stderr.write(`${mark.warn} ${line}\n`) });
  const named = file ? await openMap(file) : null;
  const run = await replayRun(rep, named && { doc: named.doc, path: named.input.path, name: named.input.name, bytes: named.input.bytes });
  if (!o.json) {
    if (run.converted) note(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is played instead", { name: named ? named.input.name : t("The map in {file}", { file: replayInput.name }) })));
    if (named && run.differs) note(`${mark.warn} ${t("{name} differs from the map in the replay {how}. A changed map can make the replay go out of step: when a unit a player clicked is not there, the game plays on with commands meant for another game. The trace says if that happens.", { name: named.input.name, how: pc.dim(`(${run.differs})`) })}`);
  }
  return { name: o.replay, scenario: run.scenario, map: run.map, replay: replayInput.path, frames, extra: { replayFile: replayInput.name, map: named?.input.name ?? null, differs: run.differs } };
}

/** `--every`: a replay's game is long, so left at its default a progress line comes a minute of play apart (1,440 frames at 24 a second). */
const everyOf = (o: GameOptions & ReplayOptions, cmd: Command) => (o.replay && cmd.getOptionValueSource("every") === "default" ? 1440 : whole(o.every, "every"));

const replayFlags = (cmd: Command) => cmd
  .option("--replay <file>", t("play a replay's game instead: its players' commands, on its own map or on the map named"))
  .option("--order", t("with --replay, list every firing in the order the game ran it"));

/** `map test` (and `mod test`, which names the mod first): the map's scenarios played in the game, with `--mod` laid over it. */
export async function mapTestAction(file: string, testFiles: string[], o: { json?: boolean; format: string; out?: string; frames: string; seed: string; update?: boolean; clips?: string | true; clipsFormat?: ClipKind; starcraft?: string; engine?: string; mod?: string }, cmd?: Command) {
  // An optional value takes the next word, so `--clips ums.tests.json` would read the tests file as the folder.
  if (typeof o.clips === "string" && /\.json$/i.test(o.clips)) { testFiles.push(o.clips); o.clips = true; }
  checkFormat(o.format);
  // Options that cannot go together, or need another, are refused rather than one of them quietly dropped.
  if (o.json && cmd?.getOptionValueSource("format") === "cli" && o.format !== "json") throw new CliError(t("--json and --format {format} both say what standard output holds: give one.", { format: o.format }), null, 2);
  if (o.clips === undefined && cmd?.getOptionValueSource("clipsFormat") === "cli") throw new CliError(t("--clips-format says what the clips are: use it with --clips."), null, 2);
  const format: Format = o.json ? "json" : (o.format as Format);
  const defaults = { frames: parseFrames(o.frames), seed: whole(o.seed, "seed") };
  const input = await readInput(file);
  expectKind(input, "map");
  if (input.path === STDIO && !testFiles.length) throw new CliError(t("A map read from standard input has no tests beside it: name the tests file."), null, 2);
  const files = testFiles.length ? testFiles : [defaultTests(input.path)];
  const map = await readMapForTests(input.bytes);
  const scenarios: PlannedScenario[] = [];
  for (const f of files) {
    if (!existsSync(f)) throw new CliError(t("No tests file {file}", { file: f }), testFiles.length ? null : t("A map's tests are in {tests} beside it, or name the file: scmjs map test {map} <tests.json>. docs.scmjs.dev/cli/ has the file's form.", { tests: relative(process.cwd(), f) || f, map: file }), 2);
    scenarios.push(...readTests(f, await readFile(f, "utf8"), map.chk, defaults));
  }
  if (!scenarios.length) throw new CliError(t("{n, plural, one {{files} has no scenarios.} other {{files} have no scenarios.}}", { n: files.length, files: files.join(", ") }), null, 2);
  const text = format === "text";
  if (text && scenarios[0].converted) print(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: each scenario runs a copy converted to Brood War", { name: input.name })));
  const overlay = overlayOf(o);
  const run = await runTests(input.name, scenarios, map, {
    out: o.out ?? defaultOut(input.path === STDIO ? input.name : input.path), starcraft: o.starcraft, engine: o.engine, update: !!o.update, mod: overlay ?? undefined,
    live: text ? (line) => print(line) : undefined, onStart: text ? (start) => { print(testHeader(input.name, scenarios[0].rows, scenarios, start)); if (start?.mod) print(modWords(start.mod)); } : undefined,
  }).finally(() => overlay?.remove());
  const written = o.update ? updateTests(run.scenarios) : [];
  if (o.update) { const left = updateSkipped(scenarios); if (left) process.stderr.write(`${mark.info} ${left}\n`); }
  if (text) for (const w of written) print(`${pc.cyan("✎")} ${t("{n, plural, one {# expectation} other {# expectations}} written into {file}", { n: w.expectations, file: relative(process.cwd(), w.file) || w.file })}`);
  if (run.scenarios.some((s) => !s.ok)) raiseExitCode(1);
  if (text) print("", testSummary(run));
  // The clips come after the verdict: they take longer, and a want of a browser leaves the result as it is.
  let clips: ClipRun | null = null;
  if (o.clips !== undefined && run.scenarios.some((s) => !s.ok)) {
    const engine = o.engine ?? "";
    if (text) note(pc.dim(t("Drawing the clips of {n, plural, one {the failed scenario} other {the # failed scenarios}}…", { n: run.scenarios.filter((s) => !s.ok).length })));
    clips = await makeClips(run.scenarios, {
      dir: clipsDir(input.path, input.name, o.clips), kind: o.clipsFormat ?? "gif", starcraft: o.starcraft, play: /^https?:/.test(engine) ? engine : undefined,
      live: text ? (line) => print(line) : undefined,
    });
    if (text) print(...clipsSummary(clips));
    else if (clips.missing) process.stderr.write(`${clips.missing}\n`);
  }
  const clipOf = (s: (typeof run.scenarios)[number]) => clips?.clips.find((c) => c.scenario === s.name && c.tests === s.file)?.file ?? null;
  // What the game said in a failed scenario (a unit it could not place) is often why: carried with its last failure.
  const failuresOf = (s: (typeof run.scenarios)[number]) => s.results.filter((x) => !x.ok).map((x, i, all) => (i === all.length - 1 && s.notices.length ? { ...x, actual: [x.actual, ...s.notices.map((n) => t("the game said: {text}", { text: n }))].join("\n") } : x));
  const report: TestReport = { map: input.path, name: input.name, cases: run.scenarios.map((s) => ({ name: s.name, file: s.file, line: s.line, ok: s.ok, ms: s.ms, failures: failuresOf(s), replay: s.replay, clip: clipOf(s) })) };
  if (format === "json") print(JSON.stringify({ ...testJson(input.path === STDIO ? input.name : input.path, run), ...(clips ? { clips: clips.clips.map((c) => ({ ...c, file: c.file && (relative(process.cwd(), c.file) || c.file) })), clipsMissing: clips.missing } : {}) }, null, 2));
  else if (format === "github") print(...githubTestAnnotations([report]));
  else if (format === "junit") process.stdout.write(junitTestXml([report]));
  else if (format === "sarif") process.stdout.write(sarifTestJson([report], VERSION));
}

/**
 * A subcommand's options with those its parent declares too: commander gives an option both declare to the parent,
 * wherever it is typed (`map test record … --json` sets `map test`'s), so what was typed there (not a default) is
 * read from the parent.
 */
export function typedOptions<T extends object>(cmd: Command, local: T, keys: readonly (keyof T & string)[]): T {
  const o = { ...local };
  const parent = cmd.parent;
  if (!parent) return o;
  for (const key of keys) {
    if (o[key] === undefined && ["cli", "env"].includes(parent.getOptionValueSource(key) ?? "")) (o as Record<string, unknown>)[key] = parent.opts()[key];
  }
  return o;
}

export function addGameCommands(map: Command): void {
  const json = jsonOption();
  replayFlags(gameOptions(map.command("trace").description(t("run the map's triggers in the game with nobody playing: what fired, what never did")).argument("[map]", t("the map; with --replay, played in place of the replay's own")).addOption(json)))
    .addHelpText("after", t(`
The game itself runs the map as Use Map Settings, your seat idle and the computers as the map has them, for the
frames given, and every condition it asks and action it runs is noted. Prints each trigger with how often it fired,
when first and last and whose it is, then the ones that never fired and which condition said no last. The engine is
fetched once from the play page (about 25 MB) and the game's own files come from your copy of StarCraft, as for
scmjs bot run. Exits 2 when the game could not start.

With --replay the game is the replay's: its players' commands are played to its end (or --frames), and the first
and last firings are the game's clock. With a map named as well, that map is played in place of the replay's own,
to test a fixed map against the game in a bug report.
  scmjs map trace --replay report.rep --order
  scmjs map trace fixed.scx --replay report.rep`))
    .action(async (file: string | undefined, o: GameOptions & ReplayOptions, cmd: Command) => {
      const every = everyOf(o, cmd), seed = whole(o.seed, "seed");
      const g = await gameRun(file, o, cmd);
      const overlay = overlayOf(o);
      const r = await runMapInGame(g.map, "trace", { mod: overlay ?? undefined, frames: g.frames, every, seed, starcraft: o.starcraft, engine: o.engine, replay: g.replay, order: o.order, live: o.json ? undefined : note }).finally(() => overlay?.remove());
      if (o.json) print(JSON.stringify({ ...traceJson(g.name, g.scenario, r), ...g.extra }, null, 2));
      else print("", ...printTrace(g.name, g.scenario, r, { all: !!o.all }));
    });

  replayFlags(gameOptions(map.command("cost").description(t("what the map's triggers cost Remastered a frame, in milliseconds")).argument("[map]", t("the map; with --replay, played in place of the replay's own")).addOption(json)))
    .addOption(new Option("--weigh <module>", t("the weigher to hand the game instead of the one beside the command")).hideHelp())
    .addHelpText("after", t(`
The game runs the map as scmjs map trace does, and every trigger the game passes and every condition and action it
runs is weighed as Remastered charges for it (TrigScript's model, measured on the real game). Says what a frame costs
on average where the triggers ran and at the most, against what a frame can carry, then the costliest triggers.
With --replay, the cost of the replay's game, as map trace --replay plays it.`))
    .action(async (file: string | undefined, o: GameOptions & ReplayOptions & { weigh?: string }, cmd: Command) => {
      if (o.order) throw new CliError(t("--order is map trace's: map cost lists the costliest triggers."), null, 2);
      const every = everyOf(o, cmd), seed = whole(o.seed, "seed");
      const g = await gameRun(file, o, cmd);
      const overlay = overlayOf(o);
      const r = await runMapInGame(g.map, "cost", { mod: overlay ?? undefined, frames: g.frames, every, seed, starcraft: o.starcraft, engine: o.engine, weigh: o.weigh, replay: g.replay, live: o.json ? undefined : note }).finally(() => overlay?.remove());
      if (o.json) print(JSON.stringify({ ...costJson(g.name, r, g.scenario), ...g.extra }, null, 2));
      else print("", ...printCost(g.name, g.scenario, r, { all: !!o.all }));
    });

  map.command("rush").description(t("the ground distance between the start locations, walked by the game's own pathing")).argument("<map>", t("the map")).addOption(json)
    .option("--unit <name>", t("the unit walked: Zergling, Dragoon, a units.dat id…"), "SCV")
    .option("--seed <n>", t("the game's seed; the same seed and map give the same walks"), "12345")
    .addOption(starcraftOption())
    .addOption(new Option("--limit <frames>", t("frames a walk may take before it is given up")).default("10000").hideHelp())
    .addOption(engineOption())
    .addHelpText("after", t(`
The game walks the unit from each start location to every other, as a player's unit would go when sent there, and
each walk is timed. Prints a table with the starts as rows and columns: the pixels walked and the seconds it took at
Fastest, then the shortest and longest of them beside the straight line, and any walk that did not arrive (no ground
between two starts is an island map). The engine and your copy of StarCraft are needed, as for scmjs map trace.
Exits 2 when the game could not start.`))
    .action(async (file: string, o: { json?: boolean; unit: string; seed: string; limit: string; starcraft?: string; engine?: string }) => {
      const unit = unitByName(o.unit);
      const seed = whole(o.seed, "seed"), limit = whole(o.limit, "limit", 1);
      const { input, doc } = await openMap(file);
      // Said before the game starts, as map analyze and map balance say it.
      const starts = startPlaces(doc).length;
      if (starts < 2) throw new CliError(starts ? t("{file} has one start location: a rush is walked between two or more.", { file: input.name }) : t("{file} has no start locations: a rush is walked between two or more.", { file: input.name }), t("A melee map places a Start Location for each player."), 2);
      const game = await gameMap(doc, input.path, input.name);
      if (game.converted && !o.json) note(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead", { name: input.name })));
      const r = await runRush(game.path, { unit, seed, limit, starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : note });
      if (o.json) print(JSON.stringify(rushJson(file, r), null, 2));
      else print("", ...printRush(file, r));
    });

  map.command("analyze").description(t("a melee map's layout: starts, mains, naturals, walks, chokes and ground, without running the game")).argument("<map>", t("the map")).addOption(json)
    .addOption(outOption("picture.png", t("also draw the map with the walks, chokes and naturals on it; - for standard output")))
    .addOption(new Option("--picture <file.png>", t("the old name of --out")).hideHelp())
    .option("--scale <n>", t("the picture's pixels a tile: {scales} (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--all", t("every pair of starts and every base, not only the shortest and longest"))
    .addOption(starcraftOption())
    .addHelpText("after", t(`
Reads the ground as a unit walks it, from the tileset of your copy of StarCraft (which minitiles are walkable, at
which height), with buildings and resources in the way, and reports each start's main and natural, the walk between
every pair of starts beside the straight line (in tiles, and in seconds for a Zergling, Marine and Zealot), the
narrowest point on each walk and on each main's way to its natural, how much of the map is walkable, buildable and
high ground, then a few verdicts. Nothing runs in the game, so it takes about a second; map rush has the game walk.
Exits 2 for a map with fewer than two start locations.`) + `
  scmjs map analyze "(4)Crossing.scx"
  scmjs map analyze "(4)Crossing.scx" --out crossing.png`)
    .action(async (file: string, o: { json?: boolean; out?: string; picture?: string; scale?: string; all?: boolean; starcraft?: string }) => {
      if (o.out !== undefined && o.picture !== undefined) throw new CliError(t("--out and --picture name the same picture: give one."), null, 2);
      o.picture = o.out ?? o.picture;
      const piped = o.picture === STDIO;
      refuseJsonOnPipe(piped, o.json, "picture");
      const { input, doc } = await openMap(file);
      const { report, lines } = await analyzeMap(input, doc, o);
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, ...lines);
    });

  map.command("balance").description(t("is the map fair to every start? games played over and over, a row a start location")).argument("<map>", t("the map")).addOption(json)
    .requiredOption("--bots <files>", t("one bot (it plays the game's computer) or two, comma separated; a race after a colon: mybot.scmbot:p"))
    .option("--races <races>", t("the races a side plays when it has none of its own: letters of z, t, p and r (random) run together, or words with commas"), "r")
    .option("--games <n>", t("rounds: every pairing once a seed, seeds 1 to n"), "8")
    .option("--seeds <list>", t("the seeds to play, comma separated, in place of --games"))
    .option("--frames <n>", t("stop a game nobody has won after this many frames (24 a second)"), "30000")
    .option("--parallel <n>", t("games at once (default: up to 4, as this computer's cores and memory allow)"))
    .addOption(outOption("folder", t("keep every game's replay here (by default they are deleted)")))
    .option("--no-rush", t("leave out the walks between the starts (map rush)"))
    .option("--timeout <seconds>", t("how long a bot may think over one frame before it counts as hung"), "60")
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", t(`
The same sides play game after game on the map, as scmjs bot ladder plays them: a bot against the game's computer,
or two bots both ways round. The game deals the start locations itself, so each game's replay is played back to see
which start each side had and when one first lost a unit to the other. Prints a row a start: games, wins, the win
rate beside what the two sides' own records predict, the average length and first contact, the walk to the other
starts (as map rush) and the main's minerals and gas, then a verdict. Needs your copy of StarCraft and the engine,
as for scmjs bot ladder. Exits 1 when a game could not be played, 2 when the map has fewer than two starts.

  scmjs map balance "(4)My Map.scx" --bots out/mybot.scmbot:p --races p --games 12 --parallel 4
  scmjs map balance "(4)My Map.scx" --bots mybot.scmbot,mybot.scmbot --games 6`))
    .action(async (file: string, o: { json?: boolean; bots: string; races: string; games: string; seeds?: string; frames: string; parallel?: string; out?: string; rush: boolean; timeout: string; starcraft?: string; engine?: string }, cmd: Command) => {
      if (o.seeds && cmd.getOptionValueSource("games") === "cli") throw new CliError(t("--games and --seeds both say which games to play: give one."), null, 2);
      const races = parseRaces(o.races);
      const games = whole(o.games, "games", 1);
      const seeds = o.seeds ? o.seeds.split(",").map((x) => x.trim()).filter(Boolean).map((x) => whole(x, "seeds")) : Array.from({ length: games }, (_, k) => k + 1);
      const bots = o.bots.split(",").map((b) => b.trim()).filter(Boolean);
      const { input, doc } = await openMap(file);
      if (input.path === STDIO) throw new CliError(t("map balance plays the map from a file, not standard input."), null, 2);
      const say = note;
      // A map in the original 1.00 form is played as Brood War (as bot ladder does), so that its replays play back;
      // the rush's walks get a copy of their own, which map rush deletes when it ends.
      const play = await gameMap(doc, input.path, input.name);
      const rushPlay = o.rush ? await gameMap(doc, input.path, input.name) : null;
      if (play.converted) say(pc.dim(t("{name} is an original StarCraft map: it is played converted to Brood War.", { name: input.name })));
      let r;
      try {
        r = await runBalance(file, input.path, doc, {
          bots, races, seeds, frames: parseFrames(o.frames), parallel: o.parallel === undefined ? undefined : whole(o.parallel, "parallel", 1), timeout: whole(o.timeout, "timeout", 1),
          out: o.out, rush: o.rush, starcraft: o.starcraft, engine: o.engine, play: play.path, rushPlay: rushPlay?.path, live: say,
        });
      } finally { removeGameMap(play.path); if (rushPlay) removeGameMap(rushPlay.path); }
      if (o.json) print(JSON.stringify(balanceJson(r), null, 2));
      else print("", ...printBalance(r));
      if (r.report.games.some((g) => !g.result.end || g.result.end.by === "desync")) process.exitCode = 1;
    });

  const test = map.command("test").description(t("runs the map's tests in the game: each scenario set up, played and checked, a replay of each that failed")).argument("<map>", t("the map")).argument("[tests...]", t("tests files (JSON); <map>.tests.json beside the map by default")).addOption(json)
    .addOption(formatOption())
    .addOption(outOption("folder", t("where the replays of failing scenarios go (<map>.tests/ beside the map)")))
    .option("--frames <n>", t("frames a scenario runs when it does not say (24 a second)"), "2400")
    .option("--seed <n>", t("the game's seed when a scenario does not say; the same seed and map give the same game"), "1")
    .option("-u, --update", t("a scenario driven by a replay: write what the game gives now into the expectations that no longer hold"))
    .option("--clips [folder]", t("a clip of the last seconds of each failed scenario's game, drawn in a browser (<map>.clips/ beside the map)"))
    .addOption(new Option("--clips-format <kind>", t("the clips' kind")).choices(CLIP_KINDS).default("gif"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`A tests file holds scenarios: what the game starts with (units made, switches set, resources), what happens at a
frame (units killed, a switch flipped, your units ordered somewhere, a chat line), how long it runs, and what must
hold at the end (a trigger fired or never did, a switch, a death count, units in a location, a line shown, who won).
Each scenario is one game with nobody playing but the steps; one that fails says what did not hold and keeps its
replay. A scenario may name a replay instead ("replay": "game.rep"): its players' commands are the game, played on
this map; scmjs map test record makes one from a replay, and -u writes in what such a scenario's game gives now.
--clips keeps a GIF (or a WebM) of each failed scenario: the 8 seconds of its game before the frame it ended on and 2
after, drawn as scmjs replay export draws a replay, so it needs a browser too; without one the tests still run.
Exits 1 when a scenario fails, 2 when the tests or the map cannot be read or the game could not start.
The engine and your copy of StarCraft are needed, as for scmjs map trace. docs.scmjs.dev/cli/ has the file's form.`))
    .addOption(modOption())
    .action(mapTestAction);

  test.command("record").description(t("a scenario from a replay: the game played on the map, its end written as expectations to trim")).argument("<map>", t("the map")).argument("<replay>", t("the replay to play on it")).addOption(json)
    .option("--name <name>", t("the scenario's name (the replay's file name by default); a scenario of that name is written anew"))
    .option("--tests <file>", t("the tests file to write into (<map>.tests.json beside the map)"))
    .option("--frames <n>", t("frames to play (the replay's length by default)"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`The replay's players' commands are played on the map, as scmjs map trace --replay plays them, and the end of the
game is written into the tests file as a scenario: the replay (from the tests file's folder), the frames, and what
the game ended with — how often each trigger fired, the switches, the lines shown, each player's outcome, units,
minerals, gas and deaths. Delete the expectations you do not care about; scmjs map test runs the scenario against
the map as it is then, and scmjs map test -u writes in what has changed.`) + `
  scmjs map test record bunker.scx bug-report.rep --name "bunker fills at 7:30"`)
    .action(async (file: string, replayFile: string, local: { json?: boolean; name?: string; tests?: string; frames?: string; starcraft?: string; engine?: string }, cmd: Command) => {
      // map test declares --json, --frames, --starcraft and --engine too, and takes them wherever they are typed.
      const o = typedOptions(cmd, local, ["json", "frames", "starcraft", "engine"]);
      const input = await readInput(file);
      expectKind(input, "map");
      const replayInput = await readInput(replayFile);
      expectKind(replayInput, "replay");
      if (input.path === STDIO || replayInput.path === STDIO) throw new CliError(t("map test record writes beside the map and names the replay's file: give both as files."), null, 2);
      const rep = await loadReplayInput(replayInput);
      refuseModReplay(rep, replayInput.name, "map test record");
      const players = rep.players.filter((p) => p.type === 1 || p.type === 2).map((p) => ({ slot: p.index, name: p.name, computer: p.type === 1 }));
      const map = await readMapForTests(input.bytes);
      const r = await recordTest(input.name, map, { path: replayInput.path, frames: rep.header.frames, players }, o.tests ?? defaultTests(input.path), {
        name: o.name ?? basename(replayInput.name).replace(/\.rep$/i, ""), frames: o.frames === undefined ? undefined : parseFrames(o.frames),
        out: defaultOut(input.path), starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : note,
      });
      // The map as it was typed, for the hint's command and the JSON (the runner had its name).
      const typed = { ...r, map: file };
      if (o.json) print(JSON.stringify(typed, null, 2));
      else print(...recordLines(typed));
    });

  map.command("preview").description(t("a picture of the map in the terminal, or as a PNG, with your copy of the game's graphics")).argument("<map>", t("the map")).addOption(json)
    .addOption(outOption("picture.png", t("write a PNG instead; - for standard output")))
    .option("--scale <n>", t("pixels a tile: {scales} in a PNG (4 by default); in the terminal a pixel is half a character", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("the terminal picture's width in characters (as wide as the terminal by default)"))
    .option("--no-units", t("the terrain alone: no units, resources or start locations"))
    .addOption(new Option("--units", t("units, resources and start locations on the picture (the default)")).hideHelp())
    .option("--blocks", t("colour blocks, even in kitty or iTerm2, which can show the picture itself"))
    .addOption(starcraftOption())
    .addHelpText("after", "\n" + t(`The terrain is drawn with the map's tileset as your copy of StarCraft has it, Remastered or 1.16.1; nothing of the
game is fetched or kept. Over it: a dot a unit in its owner's colour, sized as the unit is placed, mineral fields
and geysers in their own colours, and start locations framed (numbered in the terminal). In the terminal each
character is two pixels, in 24-bit colour where the terminal says it has it, else the nearest of 256.`) + `
  scmjs map preview ridge.scx
  scmjs map preview ridge.scx --out ridge.png --scale 8`)
    .action(async (file: string, o: { json?: boolean; out?: string; scale?: string; width?: string; units?: boolean; blocks?: boolean; starcraft?: string }) => {
      const piped = o.out === STDIO;
      refuseJsonOnPipe(piped, o.json, "picture");
      const { input, doc } = await openMap(file);
      const { report, lines } = await previewMap(input, doc, o);
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, ...lines);
    });

  map.command("heatmap").description(t("where units died, buildings went up or armies walked in many replays, as heat over the map")).argument("<map>", t("the map")).argument("<replays...>", t("replays (.rep), or folders of them")).addOption(json)
    .option("--what <kind>", t("deaths, kills, buildings or paths (where armies walked)"), "deaths")
    .option("--player <n|name>", t("one player's: their number (1-8) or their name as the replays have it; for kills, the killer"))
    .option("--until <m:ss>", t("only what happened by this time in each game: m:ss, or a number of seconds"))
    .addOption(outOption("picture.png", t("write a PNG instead; - for standard output")))
    .option("--side-by-side", t("the map as map preview draws it beside the heat"))
    .option("--scale <n>", t("pixels a tile: {scales} in a PNG (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("the terminal picture's width in characters"))
    .option("--blocks", t("colour blocks, even in kitty or iTerm2"))
    .option("--any-map", t("take replays played on another map too: their own games, laid over this map"))
    .addOption(forceOption(t("the old name of --any-map")).hideHelp())
    .option("--parallel <n>", t("replays played at once (half the processors, at most 4, by default)"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`Each replay is played to its end in the game, as scmjs replay watch plays it, and every unit's death (where it
died, and who killed it), every building placed and where the armies walked are noted. Only replays played on this
map count: the same map, or one with the same name and size; the others are listed as left out. What a replay gave
is kept in scmjs's cache, so a second run with more replays plays only the new ones. Needs your copy of StarCraft.`) + `
  scmjs map heatmap "Fighting Spirit.scx" replays/
  scmjs map heatmap fs.scx replays/*.rep --what kills --player 1 --until 10:00 --out kills.png`)
    .action(async (file: string, replays: string[], o: HeatmapFlags & { anyMap?: boolean }) => {
      o.force = !!(o.force || o.anyMap);
      const piped = o.out === STDIO;
      refuseJsonOnPipe(piped, o.json, "picture");
      const { input, doc } = await openMap(file);
      const live = note;
      const { report, lines } = await heatmapMap(input, doc, replays, o, { live });
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, "", ...lines);
    });

  map.command("coverage").description(t("which of the map's triggers fired in a folder of replays, how often, and which never did")).argument("<map>", t("the map")).argument("[replays...]", t("replays (.rep) or folders of them; a tests file (.json) counts its scenarios")).addOption(json)
    .option("--tests", t("count the games of the map's tests (<map>.tests.json beside it) too"))
    .option("--strict", t("exit 1 when a trigger a player in the games owned never fired"))
    .addOption(formatOption())
    .option("--all", t("list every trigger, those no player in the games owned too"))
    .option("--any-map", t("take replays played on another map too: their players' commands, played on this map"))
    .addOption(forceOption(t("the old name of --any-map")).hideHelp())
    .option("--parallel <n>", t("games played at once (half the processors, at most 4, by default)"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`Each replay's game is played on the map in the game itself, as scmjs map trace --replay plays one, and every
trigger's firings are counted. Prints each trigger with the games it fired in, how often in all and when first,
then the ones that never fired and which condition said no last. Only Use Map Settings games of this map count
(the same map, or one with the same name and size); a folder's replays are taken with its sub-folders'. A game
whose players' commands parted from the map counts what fired before that, and is said. Needs your copy of
StarCraft. Exits 1 with --strict when a trigger never fired, 2 when no replay could be counted.`) + `
  scmjs map coverage td.scx replays/
  scmjs map coverage td.scx replays/ --tests --strict --format github`)
    .action(async (file: string, sources: string[], o: { json?: boolean; tests?: boolean; strict?: boolean; format: string; all?: boolean; force?: boolean; anyMap?: boolean; parallel?: string; starcraft?: string; engine?: string }) => {
      o.force = !!(o.force || o.anyMap);
      const format = reportFormat(o);
      const { input, doc } = await openMap(file);
      const live = (line: string) => note(format === "text" ? line : visible(line));
      const r = await runCoverage(input, doc, sources, o, live);
      const scn = await coverageScenario(input);
      if (o.strict && r.never) raiseExitCode(1);
      const form = () => coverageForm(input.path, r, scn, !!o.strict);
      if (format === "json") print(JSON.stringify(coverageJson(r, scn), null, 2));
      else if (format === "github") print(...githubCoverageAnnotations([form()]));
      else if (format === "junit") process.stdout.write(junitCoverageXml([form()]));
      else if (format === "sarif") process.stdout.write(sarifCoverageJson([form()], VERSION));
      else print("", ...printCoverage(r, scn, { all: !!o.all, strict: !!o.strict }));
    });
}
