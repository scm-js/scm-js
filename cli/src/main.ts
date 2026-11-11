/**
 * scmjs: StarCraft: Brood War maps, replays and bots from the command line. One command, a noun for each kind of
 * thing (`map`, `replay`, `plugin`, `bot`), the editor's own code underneath (docs/cli.md, .claude/internals/cli.md).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, relative } from "node:path";
import { Command, Help, Option } from "commander";
import { aboutReport, printAbout, VERSION } from "./about";
import { listMembers, MANIFEST_FILE, packMap, unpackMap } from "./archive";
import { rootHelp } from "./banner";
import { BOT_GUIDE, runBot, updateBot } from "./bot";
import { runBotGame } from "./botrun";
import { ladderJson, parseEntrants, parseRaces, printLadder, runLadder } from "./ladder";
import { costReport, gameMap, printCost, printTrace, removeGameMap, replayRun, runMapInGame, traceReport } from "./trace";
import { printRush, runRush, rushJson, unitByName } from "./rush";
import { balanceJson, printBalance, runBalance, startPlaces } from "./balance";
import { buildMap, hasScript, loadTypeScript, printBuild } from "./build";
import { completionScript, SHELLS, type Shell } from "./completion";
import { LAYOUTS, nameFromFile, NEW_VERSIONS, parseSize, parseTileset, writeNewMap, type NewMapVersion } from "./create";
import { doctorJson, doctorReport, printDoctor } from "./doctor";
import { initFolder, printInit, printRecipe } from "./init";
import { diffMaps, printDiff, revisionInput } from "./diff";
import { mapLog, printLog } from "./maplog";
import { BLAME_KINDS, blameMap, printBlame, printBlameItem, type BlameKind } from "./blame";
import { asMap, printMerge, runMerge, stagedInputs, type Side } from "./merge";
import { diffPicture } from "./diffpicture";
import { CLIP_KINDS, clipsDir, clipsSummary, makeClips, type ClipKind, type ClipRun } from "./clips";
import { dumpMap, printDump } from "./dump";
import { ANCHORS, parseAnchor, pruneStrings, resizeMap, setHeader, VERSIONS, ENCODINGS } from "./edit";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack, writeOutput } from "./exchange";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { formatOf } from "../../src/editor/save";
import { COMPRESSIONS, optimizeJson, optimizeMap, printOptimize, type Compression } from "./optimize";
import { expectKind, loadMapInput, loadReplayInput, readInput, STDIO, toStdout, type Input } from "./files";
import { findInMap, KINDS, parseKinds, printHits } from "./find";
import { DEFAULT_LIMIT, fetchJson, fetchMap, mapIdFrom, MAX_LIMIT, parseLimit, printFetched, printSearch, searchJson, searchMaps } from "./fetch";
import { baselineLine, baselineWritten, issueLine, mapReport, printIssues, printMapInfo, type MapReport } from "./map";
import { baselineEntries, BASELINE_FILE, mapKey, matchBaseline, readBaseline, writeBaseline, type BaselineEntry } from "./baseline";
import type { Issue } from "../../src/editor/validate";
import { serveStdio } from "./mcp";
import { serveLsp } from "./lsp";
import { openInScmjs, playInLobby } from "./open";
import { checkPlugin, devPlugin, newPlugin, printPluginCheck, type PluginCheck } from "./plugin";
import { printReplayInfo, replayReport } from "./replay";
import { buildOrders, checkPlayedMod, refuseModReplay, replayNamer, type ReplayNameOptions } from "./replaymod";
import { SCMSCX, scmscx } from "./scmscx";
import { mapFileFor, writeReplayMap } from "./replaymap";
import { printReplayShare, shareReplay } from "./replayshare";
import { exportReplay, exportSummary, type ExportOptions } from "./export";
import { parseClock, watchReplay, watchSummary } from "./watch";
import { FORMATS, githubAnnotations, githubCoverageAnnotations, githubTestAnnotations, junitCoverageXml, junitTestXml, junitXml, sarifCoverageJson, sarifJson, sarifTestJson, type CheckReport, type Format, type TestReport } from "./report";
import { coverageForm, coverageJson, coverageScenario, printCoverage, runCoverage } from "./coverage";
import { defaultOut, defaultTests, readMapForTests, readTests, recordLines, recordTest, runTests, testHeader, testJson, testSummary, updateTests, type PlannedScenario } from "./maptest";
import { printRun, runOnMap } from "./run";
import { previewMap, PNG_SCALES } from "./preview";
import { analyzeMap } from "./analyze";
import { heatmapMap, type HeatmapOptions as HeatmapFlags } from "./heatmap";
import { printGenerated, runGenerate, type GenerateFlags } from "./generatecmd";
import { GEN_PLAYERS, GEN_STYLES, GEN_SYMMETRIES } from "./generate";
import { accountReport, login, logout, PROVIDERS, printAccount, serverLabel } from "./account";
import { printShare, shareMap } from "./share";
import { qrFor } from "./qr";
import { exportSounds, printSounds, readSounds } from "./sounds";
import { editInEditor, type EditKind, type EditOutcome } from "./texteditor";
import { checkModSource, printModCheck } from "./mod/check";
import { diffModSources, printModDiff } from "./mod/diff";
import { modInfo, printModInfo } from "./mod/info";
import { newMod } from "./mod/new";
import { gameFilesOrNull, openMod } from "./mod/open";
import { sourceHash } from "./mod/hash";
import { writeModHeader } from "./mod/header";
import { modOverlay } from "./mod/overlay";
import { modWords } from "./engine";
import { MOD_COMPRESSIONS, packMod, readModFolder, type ModCompression } from "./mod/pack";
import { pageRace, playBotOf, playOnPage, playSet } from "./mod/play";
import { unpackMod } from "./mod/unpack";
import { shownPath } from "./mod/source";
import { chooseLocale, inEnglish, locale, setLocale, t, translate } from "./i18n";
import { commanderError, helpExtras, helpTitle } from "./commanderText";
import { CliError, columns, dot, gameText, mark, num, padColumns, pc, print, rows, size, table, visible } from "./ui";
import { parseFrames, parseWhole } from "./values";

/** The widest a command's term in the overview may be, so its description stays beside it (banner.ts fits 80 columns). */
const TERM_WIDTH = 28;

/**
 * Runs `fn` on each file in turn; a file that fails is said and the rest go on. JSON: one value, or a list for
 * several. `silent` prints nothing and only collects, for a command that lays the results out itself afterwards.
 */
async function eachFile(paths: string[], asJson: boolean, fn: (input: Input) => Promise<{ data: unknown; lines: string[] }>, rule = true, silent = false): Promise<unknown[]> {
  const results: unknown[] = [];
  let printed = false;
  for (const path of paths) {
    try {
      const { data, lines } = await fn(await readInput(path));
      results.push(data);
      // A file with nothing to say (no match in `find`) prints nothing, and no separator either.
      if (!silent && !asJson && lines.length) { if (printed) print(...(rule ? ["", pc.dim("─".repeat(Math.min(process.stdout.columns || 60, 60))), ""] : [""])); print(...lines); printed = true; }
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      if (asJson) results.push({ file: path, error: e.message });
      else { if (printed) print(""); fail(e); printed = true; }
      process.exitCode = Math.max(Number(process.exitCode ?? 0), e.exitCode);
    }
  }
  if (asJson && !silent) print(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  return results;
}

function fail(e: CliError): void {
  process.stderr.write(`${mark.error} ${e.message}\n${e.hint ? pc.dim(`  ${e.hint}`) + "\n" : ""}`);
}

async function mapInfo(input: Input) {
  expectKind(input, "map");
  const doc = await loadMapInput(input);
  const data: MapReport = { ...mapReport(input, doc), script: await hasScript(doc.extras) };
  return { data, lines: printMapInfo(data) };
}
async function replayInfo(input: Input, o: ReplayNameOptions = {}) {
  expectKind(input, "replay");
  const rep = await loadReplayInput(input);
  const names = o.mod || o.builds ? await replayNamer(rep, input.name, { mod: o.mod, starcraft: o.starcraft, costs: !!o.builds, warn: (line) => process.stderr.write(`${mark.warn} ${line}\n`) }) : null;
  // (A race the replay's tag does not name, the mod named with --mod may declare.)
  const races = names?.races ?? [];
  const data = replayReport(input, rep, races);
  if (names) {
    data.names = names.from;
    if (o.builds) data.builds = buildOrders(rep, names);
  }
  return { data, lines: printReplayInfo(data, races) };
}
/** A bot file's header (the scm-sim toolchain's `.scmbot`). */
async function botInfo(input: Input) {
  const n = new DataView(input.bytes.buffer, input.bytes.byteOffset).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(input.bytes.subarray(12, 12 + n))) as Record<string, unknown>;
  const data = { file: { name: input.name, bytes: input.bytes.length }, key: h.key, name: h.name, source: h.source, commit: h.commit, memoryMB: Number(h.memoryPages) / 16, toolchain: h.toolchain, license: String(h.license ?? "").split("\n").find((l) => l.trim())?.trim() ?? "" };
  return { data, lines: [
    pc.bold(String(data.name)), pc.dim(t("A BWAPI bot for scm-sim's play page")), "",
    ...rows([[t("Key"), String(data.key)], [t("Source"), data.source ? `${data.source}${data.commit ? pc.dim(` @ ${String(data.commit).slice(0, 7)}`) : ""}` : null], [t("Licence"), data.license || null], [t("Memory"), `${data.memoryMB} MB`], [t("Built by"), String(data.toolchain)], [t("File"), `${input.name}${dot}${size(input.bytes.length)}`]]),
  ] };
}

// Output piped into something that stops reading (`| head`): stop quietly, as other commands do, not with a stack.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(process.exitCode ?? 0); else throw e; });
}

/**
 * The program: its commands, their options and their help, in the language set last (`setLocale`) — the descriptions
 * are made here, so the language is chosen before this runs (below, and `tests/cli-i18n.test.ts` builds one in Korean).
 */
export function buildProgram(): Command {
  const json = new Option("--json", t("print JSON instead of text, for scripts"));
  const program = new Command("scmjs")
    .description(t("StarCraft: Brood War maps, replays, plugins and bots from the command line"))
    .version(VERSION, "-v, --version", t("print the version"))
    .helpOption("-h, --help", t("show help for a command"))
    .addOption(new Option("--no-color", t("plain text, no colour (also NO_COLOR=1)")))
    // Read from the arguments before the program is built (chooseLocale); here so commander takes it anywhere.
    .addOption(new Option("--lang <code>", t("the language: en or ko (also SCMJS_LANG)")).choices(["en", "ko"]))
    .showSuggestionAfterError()
    .commandsGroup(t("This tool:"))
    .configureOutput({ outputError: (text, write) => write(text.replace(/^error: ([^]*?)(\n?)$/, (_, said: string, end: string) => `${mark.error} ${commanderError(said)}${end}`)) })
    .showHelpAfterError(pc.dim(t("(scmjs --help lists the commands)")))
    .configureHelp({
      styleTitle: (s) => pc.bold(helpTitle(s)),
      // Hangul takes two columns in a terminal: commander pads and wraps by this.
      displayWidth: (s) => columns(s),
      optionDescription(option) { return helpExtras(Help.prototype.optionDescription.call(this, option)); },
      argumentDescription(argument) { return helpExtras(Help.prototype.argumentDescription.call(this, argument)); },
      styleCommandText: (s) => pc.cyan(s),
      styleSubcommandText: (s) => pc.cyan(s),
      styleArgumentText: (s) => pc.yellow(s),
      styleOptionText: (s) => pc.green(s),
      // A noun lists what it does (`map info|check|open`), so the overview shows every command at once — up to a
      // width that keeps the descriptions beside them (`map info|check|open|diff|…`); the noun's own help has the rest.
      subcommandTerm: (cmd) => {
        const subs = cmd.commands.map((c) => c.name()).filter((n) => n !== "help");
        if (!subs.length) return new Help().subcommandTerm(cmd).replace(" [options]", "");
        let term = cmd.name();
        // A noun's own help (`scmjs map --help`) has two columns more, so `triggers export|import|edit` is there whole.
        const width = cmd.parent?.parent ? TERM_WIDTH + 2 : TERM_WIDTH;
        for (const [i, sub] of subs.entries()) {
          const next = `${term}${i ? "|" : " "}${sub}`;
          // The last verb too: a term past the width widens the column and wraps every description.
          if (next.length > width - 2 && i > 0) return `${term}|…`;
          term = next;
        }
        return term;
      },
      // The overview has the banner (banner.ts); a command's own help is commander's.
      formatHelp: (cmd, helper) => (cmd.parent ? Help.prototype.formatHelp.call(helper, cmd, helper) : rootHelp(cmd, helper, VERSION)),
    });

  // `scmjs help map` works, but the row is not in the overview: `-h, --help` is on the same screen, and the 23 lines
  // (a 24-row terminal keeps the globe on screen) go to the commands.
  const helpCommand = program.createCommand("help").argument("[command]").description(t("show help for a command"));
  (helpCommand as unknown as { _hidden: boolean })._hidden = true;
  program.addHelpCommand(helpCommand);

  program.command("info").description(t("what a map, replay or bot file holds")).helpGroup(t("Maps and replays:")).argument("<files...>", t("maps (.scm .scx .chk), replays (.rep) or bots (.scmbot)")).addOption(json)
    .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, async (input) => {
      const kind = expectKind(input, "map", "replay", "bot");
      return kind === "map" ? mapInfo(input) : kind === "replay" ? replayInfo(input) : botInfo(input);
    }));

  const map = program.command("map").description(t("read, check and open maps")).helpGroup(t("Maps and replays:"));
  map.command("info").description(t("a map's size, players, units, triggers and its check")).argument("<maps...>").addOption(json)
    .option("--table", t("one row per map, for a folder of them"))
    .action(async (files: string[], o: { json?: boolean; table?: boolean }) => {
      if (!o.table || o.json) { await eachFile(files, !!o.json, mapInfo); return; }
      const reports = (await eachFile(files, true, mapInfo, true, true)).filter((r): r is MapReport => !!r && !("error" in (r as object)));
      if (!reports.length) return;
      print(...table([
        [t("File"), t("Name"), t("Size"), t("Tileset"), t("Version"), t("Players"), t("Units"), t("Triggers"), t("Check")].map((h) => pc.dim(h)),
        ...reports.map((r) => [r.file.name, gameText(r.name) || pc.italic(t("Untitled")), `${r.width} × ${r.height}`, r.tileset, r.version, String(r.usedSlots.length), num(r.statistics.units.total), num(r.statistics.triggers.count), issueLine(r.issues)]),
      ], 0));
    });
  map.command("check").description(t("Check Map, as the editor's: errors, then warnings"))
    .argument("<maps...>").addOption(json)
    .option("--all", t("list notes too, not only errors and warnings"))
    .option("--strict", t("fail on warnings as well as errors"))
    .option("--format <kind>", t("{formats}: github is workflow annotations, junit and sarif the files CI tools read", { formats: FORMATS.join(", ") }), "text")
    .option("--baseline [file]", t("report and fail only on findings the file does not hold ({file} by default)", { file: BASELINE_FILE }))
    .option("--write-baseline [file]", t("write the maps' findings now as the baseline, and fail on none"))
    .addHelpText("after", t(`
Exits 1 when a map has errors (or warnings, with --strict): fit for a CI step. In a GitHub workflow,
  - run: npx @scm-js/cli map check maps/*.scx --strict --format github
puts each finding on the pull request itself.

A map with many old findings can still be held to that: --write-baseline keeps today's findings in
{file}, and --baseline then fails only on new ones and counts the ones fixed since.
  scmjs map check maps/*.scx --write-baseline
  scmjs map check maps/*.scx --baseline --strict --format github`, { file: BASELINE_FILE }))
    .action(async (files: string[], o: { json?: boolean; all?: boolean; strict?: boolean; format: string; baseline?: string | true; writeBaseline?: string | true }) => {
      if (!(FORMATS as readonly string[]).includes(o.format)) throw new CliError(t("--format takes {formats}, not \"{value}\"", { formats: FORMATS.join(", "), value: o.format }), null, 2);
      const format: Format = o.json ? "json" : (o.format as Format);
      const machine = format !== "text" && format !== "json";
      // An optional value takes the next word, so `--baseline a.scx b.scx` would read a.scx as the baseline: a map is a map.
      const fileOf = (v: string | true | undefined) => { if (typeof v === "string" && /\.(scm|scx|chk)$/i.test(v)) { files.unshift(v); return true; } return v; };
      const asked = fileOf(o.baseline), writing = fileOf(o.writeBaseline);
      const baselineFile = writing !== undefined ? (typeof writing === "string" ? writing : typeof asked === "string" ? asked : BASELINE_FILE) : asked !== undefined ? (typeof asked === "string" ? asked : BASELINE_FILE) : null;
      if (baselineFile && files.includes(STDIO)) throw new CliError(t("A baseline keeps each map by its path: name the map's file rather than standard input."), null, 2);
      const known = baselineFile && (asked !== undefined || existsSync(baselineFile)) ? readBaseline(baselineFile) : null;
      const now: Record<string, BaselineEntry[]> = {};
      const reports = await eachFile(files, format === "json" || machine, async (input) => {
        expectKind(input, "map");
        const doc = await loadMapInput(input);
        const r = mapReport(input, doc);
        const key = baselineFile ? mapKey(baselineFile, input.path) : "";
        // A baseline knows a finding by its English text (the file is shared between computers), so the findings are
        // matched in English and shown in the reader's language: the check gives the same findings in the same order.
        const english = baselineFile && locale() !== "en" ? inEnglish(() => mapReport(input, doc).issues) : r.issues;
        const shownAs = (list: Issue[]) => list.map((i) => r.issues[english.indexOf(i)] ?? i);
        const matched = baselineFile ? matchBaseline(known?.maps[key], english, doc.scenario) : null;
        const m = matched && { ...matched, fresh: shownAs(matched.fresh), suppressed: shownAs(matched.suppressed) };
        if (writing !== undefined) now[key] = baselineEntries(english.filter((i) => o.all || i.level !== "info"), doc.scenario);
        // Written down as known, nothing fails; else only what the baseline does not hold counts.
        const issues = writing !== undefined ? [] : m ? m.fresh : r.issues;
        const failed = issues.some((i) => i.level === "error" || (o.strict && i.level === "warn"));
        if (failed) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
        const listed = (list: Issue[]) => list.filter((i) => o.all || i.level !== "info");
        const data: CheckReport = { file: input.path, name: r.name, issues: listed(issues), failed };
        if (!m || !baselineFile) return { data, lines: [`${pc.bold(input.name)}  ${issueLine(r.issues)}`, ...printIssues(r.issues, !!o.all)] };
        const shown = writing !== undefined ? listed(m.fresh) : listed(issues);
        const baseline = { file: baselineFile, suppressed: listed(m.suppressed).length, fixed: m.fixed.length, new: shown.length, ...(writing !== undefined ? { written: now[key].length } : {}), fixedFindings: m.fixed.map(({ level, where, text }) => ({ level, where, text })) };
        return { data: { ...data, baseline }, lines: writing !== undefined ? [baselineWritten(input.name, baseline, !!known?.maps[key])] : [`${pc.bold(input.name)}  ${baselineLine(shown, baseline)}`, ...printIssues(shown, !!o.all)] };
      }, false, machine) as { issues?: unknown[] }[];
      // Nothing written when no map could be read: the file would only lose what it held.
      if (writing !== undefined && baselineFile && Object.keys(now).length) {
        writeBaseline(baselineFile, known, now);
        const written = Object.values(now).reduce((n, l) => n + l.length, 0);
        if (format === "text") print("", `${mark.ok} ${t("{findings, plural, one {# finding} other {# findings}} of {maps, plural, one {# map} other {# maps}} written to {file}", { findings: written, maps: Object.keys(now).length, file: pc.cyan(baselineFile) })}${dot}${pc.dim(t("a check with --baseline fails only on others"))}`);
      }
      if (machine) {
        const ok = reports.filter((r): r is CheckReport => !!r && !("error" in r));
        if (format === "github") print(...githubAnnotations(ok));
        else process.stdout.write(format === "junit" ? junitXml(ok) : sarifJson(ok, VERSION));
        return;
      }
      if (format === "text" && writing === undefined && files.length > 1) {
        const ok = reports.filter((r): r is CheckReport => !!r && !("error" in r));
        const bad = ok.filter((r) => r.failed).length;
        const b = known ? ok.reduce((n, r) => { const x = (r as CheckReport & { baseline?: { suppressed: number; fixed: number } }).baseline; return { suppressed: n.suppressed + (x?.suppressed ?? 0), fixed: n.fixed + (x?.fixed ?? 0) }; }, { suppressed: 0, fixed: 0 }) : null;
        const known_ = b && (b.suppressed || b.fixed) ? pc.dim(`${dot}${t("{n, plural, one {# known finding} other {# known findings}} left out", { n: b.suppressed })}${b.fixed ? t(", {n} fixed since the baseline", { n: num(b.fixed) }) : ""}`) : "";
        print("", (bad ? `${mark.error} ${t("{bad, plural, one {# map} other {# maps}} of {total} failed the check", { bad, total: files.length })}` : `${mark.ok} ${t("{n, plural, one {# map} other {# maps}} checked, none failed", { n: files.length })}`) + known_);
      }
    });
  map.command("open").description(t("open a map in the scmJS app, or the editor in your browser")).argument("<map>")
    .option("--browser", t("the editor in the browser, even with the app installed"))
    .addOption(new Option("--editor <url>", t("the editor's address (SCMJS_EDITOR_URL)")).hideHelp())
    .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "map"); await openInScmjs(input, o); });

  map.command("new").description(t("a new map: flat ground, start locations laid out, the file written")).argument("<map>", t("the file to write: .scx, .scm or .chk")).addOption(json)
    .option("--size <WxH>", t("width and height, each 64, 96, 128, 192 or 256"), "128x128")
    .option("--tileset <name>", t("badlands, platform, install, ashworld, jungle, desert, ice or twilight"), "badlands")
    .option("--name <text>", t("the map's name; the file's by default"))
    .option("--description <text>", t("the map's description"), "")
    .option("--players <n>", t("start locations for players 1 to n, as Auto-place lays them; the other slots closed"), "0")
    .option("--layout <how>", t("{layouts}: how the start locations are laid out", { layouts: LAYOUTS.join(t(" or ")) }), "ring")
    // Not --version: that is the program's own flag, and commander answers it wherever it appears.
    .option("--revision <which>", t("{versions}: the file's revision", { versions: NEW_VERSIONS.join(t(" or ")) }), "broodwar")
    .option("--force", t("overwrite a file that is there"))
    .addHelpText("after", t(`
The map File ▸ New makes: flat ground, eight open slots (or n, with --players) and nothing else. Without the game's
graphics the ground is written by its ids, as the editor does without game data, and opens as it should. The same
arguments give the same file. Exits 2 when the file is there (--force overwrites it) or an option is not one.`))
    .action(async (file: string, o: { json?: boolean; size: string; tileset: string; name?: string; description: string; players: string; layout: string; revision: string; force?: boolean }) => {
      const { width, height } = parseSize(o.size);
      const tileset = parseTileset(o.tileset);
      if (!(NEW_VERSIONS as readonly string[]).includes(o.revision)) throw new CliError(t("--revision takes {values}, not \"{value}\"", { values: NEW_VERSIONS.join(t(" or ")), value: o.revision }), null, 2);
      if (!(LAYOUTS as readonly string[]).includes(o.layout)) throw new CliError(t("--layout takes {values}, not \"{value}\"", { values: LAYOUTS.join(t(" or ")), value: o.layout }), null, 2);
      const players = Number(o.players);
      if (!Number.isInteger(players) || players < 0 || players > 8) throw new CliError(t("--players takes 0 to 8, not \"{value}\"", { value: o.players }), null, 2);
      const piped = file === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Name a file to write, or leave --json off."), 2);
      if (!piped && existsSync(file) && !o.force) throw new CliError(t("{file} is there already", { file }), t("--force overwrites it."), 2);
      const r = await writeNewMap(file, { width, height, tileset, name: o.name ?? (piped ? "Untitled Scenario" : nameFromFile(file)), description: o.description, version: o.revision as NewMapVersion, players, layout: o.layout as (typeof LAYOUTS)[number] });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      say(piped, `${mark.ok} ${pc.bold(piped ? t("standard output") : relative(process.cwd(), r.path) || r.path)}: ${r.width} × ${r.height}${dot}${translate(r.tileset)}${dot}${translate(r.version)}${r.starts ? `${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: r.starts })}` : ""}${dot}${size(r.bytes)}`);
    });

  map.command("generate").description(t("a symmetric melee map from a seed, laid with your copy of the game's tileset")).argument("<map>", t("the file to write: .scx, .scm or .chk")).addOption(json)
    .option("--players <n>", `${GEN_PLAYERS.join(", ")}`, "2")
    .option("--size <WxH>", t("width and height, each 96, 128, 192 or 256 (128x128; 192x192 for 8 players)"))
    .option("--tileset <name>", t("badlands, platform, ashworld, jungle, desert, ice or twilight"), "jungle")
    .option("--seed <n>", t("the same seed and options give the same map (a new one each time without)"))
    .option("--symmetry <how>", `${GEN_SYMMETRIES.join(", ")}`)
    .option("--style <how>", t("{styles}: an open middle, or one narrowed by more high ground", { styles: GEN_STYLES.join(t(" or ")) }), "open")
    .option("--name <text>", t("the map's name; the file's by default"))
    .option("--rush", t("then walk a unit between the starts in the game, as scmjs map rush does"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .option("--force", t("overwrite a file that is there"))
    .addOption(new Option("--tilesets <folder>", t("a folder of extracted tilesets (<name>.cv5, <name>.dddata.bin, …) instead of the game")).hideHelp())
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", t(`
A main on high ground for each player with one ramp down to a natural, free bases where there is room, and a middle of
low ground with mesas, lakes and patches of the tileset's other ground. Every player's bases are the same, mirrored or
turned with the map. The ground is laid with the editor's isometric brush and the ramps are the tileset's own, so the
graphics come from your copy of StarCraft (Remastered or 1.16.1), as for scmjs map preview. Before the file is written
the map passes Check Map and every start is walked to every other over the walkable ground; a layout that fails is
thrown away and the next one tried. Exits 1 when none passes, 2 when an option is not one.
  scmjs map generate duel.scx --seed 7
  scmjs map generate four.scx --players 4 --tileset badlands --style chokes`))
    .action(async (file: string, o: GenerateFlags & { json?: boolean; rush?: boolean; force?: boolean; engine?: string }) => {
      const piped = file === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Name a file to write, or leave --json off."), 2);
      if (piped && o.rush) throw new CliError(t("--rush walks the map in the game, which needs it in a file"), t("Name a file to write."), 2);
      if (!piped && existsSync(file) && !o.force) throw new CliError(t("{file} is there already", { file }), t("--force overwrites it."), 2);
      const name = o.name ?? (piped ? "Generated" : nameFromFile(file));
      const { report } = await runGenerate(file, o, name);
      const near = relative(process.cwd(), report.path);
      if (!o.json) say(piped, ...printGenerated(report, piped ? t("standard output") : near && !near.startsWith("..") ? near : report.path));
      if (!o.rush) { if (o.json) print(JSON.stringify(report, null, 2)); return; }
      if (!o.json) print("");
      const rush = await runRush(file, { starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line) });
      if (o.json) print(JSON.stringify({ ...report, rush: rushJson(file, rush) }, null, 2));
      else print("", ...printRush(relative(process.cwd(), file) || file, rush));
    });

  map.command("dump").description(t("the whole map as text, for git diff and grep")).argument("<map>").addOption(json)
    .addHelpText("after", t(`
Everything the map holds, in one stable text form: the header, players, every unit and location, the triggers in the
trigger window's text, the strings, the archive's other files and the sections. To have git show a map's changes as
this text (git diff, git log -p, git show), once in the repository:
  git config diff.scmjs.textconv "scmjs map dump"
  git config diff.scmjs.xfuncname "^## .*"
  printf '*.scx diff=scmjs\\n*.scm diff=scmjs\\n*.chk diff=scmjs\\n' >> .gitattributes`))
    .action(async (file: string, o: { json?: boolean }) => {
      const { input, doc } = await openForEdit(file);
      const d = dumpMap(doc, input.name);
      if (o.json) print(JSON.stringify(d, null, 2));
      else process.stdout.write(printDump(d, doc.scenario));
    });

  map.command("find").description(t("search units, locations, strings and triggers across maps")).argument("<text>", t("what to look for; a number matches an id, slot or index too")).argument("<maps...>").addOption(json)
    .option("--in <kinds>", t("which of {kinds} to search, with commas between; all by default", { kinds: KINDS.join(", ") }))
    .option("--case", t("match case"))
    .addHelpText("after", t(`
Edit ▸ Find over any number of maps: a unit, location, sprite or doodad whose name holds the text, a string or a
trigger whose text does. Prints what matched and where. Exits 1 when nothing matched in any map, like grep.`))
    .action(async (text: string, files: string[], o: { json?: boolean; in?: string; case?: boolean }) => {
      const kinds = parseKinds(o.in);
      let found = 0;
      await eachFile(files, !!o.json, async (input) => {
        expectKind(input, "map");
        const hits = findInMap(await loadMapInput(input), input.name, text, kinds, !!o.case);
        found += hits.length;
        return { data: { file: input.name, matches: hits.length, hits: hits.map(({ file: _f, ...h }) => h) }, lines: hits.length ? [`${pc.bold(input.name)}  ${pc.dim(t("{n, plural, one {# match} other {# matches}}", { n: hits.length }))}`, ...printHits(hits)] : [] };
      }, false);
      if (!found) { if (!o.json) print(pc.dim(t("Nothing in {n, plural, one {# map} other {# maps}} matches \"{text}\"", { n: files.length, text }))); process.exitCode = Math.max(Number(process.exitCode ?? 0), 1); }
    });

  /** A map read for a command that changes it: the input and the parsed document, or a CliError. */
  async function openForEdit(file: string) {
    const input = await readInput(file);
    expectKind(input, "map");
    return { input, doc: await loadMapInput(input) };
  }
  /**
   * A command that writes a map: when the map itself is going to standard output (`--out -`, or a map read from `-` with
   * no `--out`), what the command says goes to standard error instead, and `--json` is refused — both want the pipe.
   */
  function piping(input: Input, o: { out?: string; json?: boolean; dryRun?: boolean }): boolean {
    const piped = toStdout(input.path, o.out) && !o.dryRun;
    if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Write the map to a file with --out, or leave --json off."), 2);
    return piped;
  }
  /** What a writing command says: standard output, or standard error while the map takes standard output. */
  function say(piped: boolean, ...lines: (string | null | undefined | false)[]): void {
    if (!piped) { print(...lines); return; }
    for (const l of lines) if (l !== null && l !== undefined && l !== false) process.stderr.write(l + "\n");
  }
  /** The output's name for a message: the file, or "standard output". */
  const outName = (w: { path: string }) => (w.path === STDIO ? t("standard output") : pc.cyan(w.path));

  /** `--out` for text: the file, or stdout when there is none (or `-`). */
  async function emit(text: string, out: string | undefined, said: string): Promise<void> {
    if (!out || out === STDIO) { process.stdout.write(text); return; }
    await writeFile(out, text);
    print(`${mark.ok} ${said} ${pc.dim("→")} ${pc.cyan(out)}`);
  }

  /** "3 triggers", or "3 briefing triggers". */
  const triggerCount = (n: number, briefing?: boolean) => (briefing ? t("{n, plural, one {# briefing trigger} other {# briefing triggers}}", { n }) : t("{n, plural, one {# trigger} other {# triggers}}", { n }));

  /** A link's lines with its QR code under the first (the link alone stays the first line, for `| head -1`). */
  const withQr = (lines: string[], link: string, qr: boolean | undefined) => (qr ? [lines[0], "", ...qrFor(link), "", ...lines.slice(1)] : lines);
  const qrOption = () => new Option("--qr", t("the link as a QR code under it too, for a phone"));

  /**
   * `map triggers edit` / `map strings edit`: the text in the editor, imported when it closes, the map written back as
   * `import` writes it. Standard input cannot be edited: the editor needs the terminal.
   */
  async function editCommand(kind: EditKind, file: string, o: { editor?: string; out?: string; briefing?: boolean }): Promise<void> {
    if (file === STDIO) throw new CliError(t("map {kind} edit needs a map file, not standard input", { kind }), t("The editor takes the terminal; name the file, or use export and import in a pipe."), 2);
    if (o.out === STDIO) throw new CliError(t("--out - is for a pipe; edit writes a file"), null, 2);
    const { input, doc } = await openForEdit(file);
    const r: EditOutcome = await editInEditor(doc, input.path, kind, {
      editor: o.editor, briefing: o.briefing,
      onWait: (path) => { if (process.stderr.isTTY) process.stderr.write(pc.dim(`${t("Waiting for your editor to close {path}…", { path })}\n`)); },
    });
    if (!r.changed) { print(`${mark.info} ${pc.bold(input.name)}: ${t("nothing changed")}${o.out ? t("; nothing written") : ""}`); return; }
    const w = await writeBack(doc, input.path, o.out ?? null);
    const what = r.kind === "triggers"
      ? `${triggerCount(r.triggers.before, o.briefing)} ${pc.dim("→")} ${triggerCount(r.triggers.after, o.briefing)}`
      : t("{n, plural, one {# string} other {# strings}} replaced, {added} added", { n: r.strings.replaced, added: r.strings.added });
    print(`${mark.ok} ${pc.bold(input.name)}: ${what}${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}`);
  }

  map.command("set").description(t("the map's name, description, revision or text encoding")).argument("<map>").addOption(json)
    .option("--name <text>", t("the map's name"))
    .option("--description <text>", t("the map's description"))
    .option("--revision <which>", t("the file's revision: {versions}", { versions: VERSIONS.join(", ") }))
    .option("--encoding <id>", t("the text encoding: {encodings}", { encodings: ENCODINGS.join(", ") }))
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .addHelpText("after", t(`
Scenario ▸ Map Properties from the terminal: what is given is set, the rest is left. Nothing is written when nothing
changed. A revision change does what the editor's does (the string table's form, the colour section the revision
needs); the encoding is how the map's text is written for 1.16.1, where Remastered reads UTF-8.`))
    .action(async (file: string, o: { json?: boolean; name?: string; description?: string; revision?: string; encoding?: string; out?: string }) => {
      if (o.name === undefined && o.description === undefined && o.revision === undefined && o.encoding === undefined) throw new CliError(t("Nothing to set"), t("--name, --description, --revision or --encoding, any of them."), 2);
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const changes = setHeader(doc, { name: o.name, description: o.description, version: o.revision, encoding: o.encoding });
      // A pipe always gets the map, changed or not, so the next step has one.
      const w = changes.length || o.out || piped ? await writeBack(doc, input.path, o.out ?? null) : null;
      if (o.json) { print(JSON.stringify({ file: input.name, changes, written: w }, null, 2)); return; }
      if (!changes.length) { say(piped, `${mark.ok} ${pc.bold(input.name)}: ${t("nothing changed")}${w ? `${dot}${t("written to {out}", { out: outName(w) })}` : ""}`); return; }
      say(piped, `${mark.ok} ${pc.bold(input.name)}: ${changes.map((c) => `${translate(c.field)} ${pc.red(c.from || pc.dim(t("(none)")))} ${pc.dim("→")} ${pc.green(c.to || pc.dim(t("(none)")))}`).join(dot)}${dot}${t("written to {out}", { out: outName(w!) })}${dot}${size(w!.bytes)}`);
    });

  map.command("resize").description(t("Scenario ▸ Resize: the map to another size, anchored")).argument("<map>").addOption(json)
    .requiredOption("--size <WxH>", t("the new width and height, each 64, 96, 128, 192 or 256"))
    .option("--anchor <where>", t("{anchors}: which part of the map stays", { anchors: Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ") }), "center")
    .option("--no-clamp", t("leave locations that hang past the new edge where the shift put them"))
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .addHelpText("after", t(`
The map is moved under the anchor; what falls outside is dropped (units, sprites, doodads) or pulled inside
(locations, unless --no-clamp), and new ground is the tileset's base terrain. Says what was dropped.`))
    .action(async (file: string, o: { json?: boolean; size: string; anchor: string; clamp: boolean; out?: string }) => {
      const { width, height } = parseSize(o.size);
      const anchor = parseAnchor(o.anchor);
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const r = resizeMap(doc, { width, height, anchor, clampLocations: o.clamp });
      const w = await writeBack(doc, input.path, o.out ?? null);
      if (o.json) { print(JSON.stringify({ file: input.name, ...r, written: w }, null, 2)); return; }
      const dropped = [r.unitsDropped && t("{n, plural, one {# unit} other {# units}}", { n: r.unitsDropped }), r.spritesDropped && t("{n, plural, one {# sprite} other {# sprites}}", { n: r.spritesDropped }), r.doodadsDropped && t("{n, plural, one {# doodad} other {# doodads}}", { n: r.doodadsDropped })].filter(Boolean).join(", ");
      say(piped, `${mark.ok} ${pc.bold(input.name)}: ${r.from.width} × ${r.from.height} ${pc.dim("→")} ${r.to.width} × ${r.to.height}${dropped ? `${dot}${pc.yellow(t("{list} dropped", { list: dropped }))}` : ""}${r.locationsClamped ? `${dot}${t("{n, plural, one {# location} other {# locations}} pulled inside", { n: r.locationsClamped })}` : ""}${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}`);
    });

  const triggers = map.command("triggers").description(t("a map's triggers as a text or .trg file, and back"))
    .addHelpText("after", t(`
The text form is the trigger window's (docs.scmjs.dev/triggers); a .trg holds the raw records, as SCMDraft trades
them. Text in a file beside the map can be diffed and edited, and imported back.`));
  triggers.command("export").description(t("the triggers as text (to stdout), or as .trg with --out x.trg")).argument("<map>")
    .option("-o, --out <file>", t("write to this file instead of stdout; .trg writes the raw records"))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .action(async (file: string, o: { out?: string; briefing?: boolean }) => {
      const { doc } = await openForEdit(file);
      const r = exportTriggers(doc, o.out ?? null, !!o.briefing);
      if (r.bytes) { await writeFile(o.out!, r.bytes); print(`${mark.ok} ${triggerCount(r.count)} ${pc.dim("→")} ${pc.cyan(o.out!)}`); }
      else await emit(r.text!, o.out, triggerCount(r.count));
    });
  triggers.command("import").description(t("replace the map's triggers with a text or .trg file's")).argument("<map>").argument("<file>", t("the triggers: text, or .trg"))
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .option("--append", t("add the file's triggers after the map's own instead of replacing them"))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .action(async (file: string, from: string, o: { out?: string; append?: boolean; briefing?: boolean }) => {
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const r = importTriggers(doc, from, new Uint8Array(await readFile(from)), { briefing: !!o.briefing, append: !!o.append });
      const w = await writeBack(doc, input.path, o.out ?? null);
      say(piped, `${mark.ok} ${pc.bold(input.name)}: ${triggerCount(r.before)} ${pc.dim("→")} ${triggerCount(r.after)}${o.append ? pc.dim(t(" ({n} added)", { n: r.read })) : ""}${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}`);
    });
  const editorOption = () => new Option("--editor <command>", t("the editor to open, such as \"code --wait\"; VISUAL or EDITOR otherwise, else vi (Notepad on Windows)"));
  triggers.command("edit").description(t("the triggers as text in your editor, imported when you close it")).argument("<map>")
    .addOption(editorOption())
    .option("-o, --out <map>", t("write the result here instead of over the map"))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .addHelpText("after", t(`
Writes the text export to a file of its own, opens it in your editor and waits for the editor to close. Saved with
changes, the text is imported as triggers import reads it and the map is written; unchanged, nothing is written.
Text that does not read is kept, and the error says where, so the edit is not lost. A graphical editor has to wait
for its window to close: code --wait, subl -w, gedit -s.`))
    .action((file: string, o: { editor?: string; out?: string; briefing?: boolean }) => editCommand("triggers", file, o));

  const strings = map.command("strings").description(t("a map's strings as a text file, and back"))
    .addHelpText("after", t(`
One line per string: its number, a tab, its text. Colour codes are written <XX>. Importing sets the numbered
strings in place and adds any past the end; nothing is renumbered, since triggers and locations hold the numbers.`));
  strings.command("export").description(t("the strings as <number><TAB><text> lines (to stdout)")).argument("<map>")
    .option("-o, --out <file>", t("write to this file instead of stdout"))
    .action(async (file: string, o: { out?: string }) => {
      const { doc } = await openForEdit(file);
      const r = exportStrings(doc);
      await emit(r.text, o.out, t("{n, plural, one {# string} other {# strings}}", { n: r.count }));
    });
  strings.command("import").description(t("set the map's strings from such a file")).argument("<map>").argument("<file>")
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .action(async (file: string, from: string, o: { out?: string }) => {
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const r = importStrings(doc, from, await readFile(from, "utf8"));
      const w = await writeBack(doc, input.path, o.out ?? null);
      say(piped, `${mark.ok} ${pc.bold(input.name)}: ${t("{n, plural, one {# string} other {# strings}} replaced, {added} added, {unchanged} unchanged", { n: r.replaced, added: r.added, unchanged: r.unchanged })}${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}`);
    });
  strings.command("edit").description(t("the strings in your editor, imported when you close it")).argument("<map>")
    .addOption(editorOption())
    .option("-o, --out <map>", t("write the result here instead of over the map"))
    .addHelpText("after", t(`
As strings import: a line changed sets that string, a line past the end adds one, and a line taken out leaves the
string as it was (strings prune drops the unused ones).`))
    .action((file: string, o: { editor?: string; out?: string }) => editCommand("strings", file, o));

  strings.command("prune").description(t("drop the strings nothing in the map refers to")).argument("<map>").addOption(json)
    .option("--dry-run", t("list them and write nothing"))
    .option("--all", t("list every string dropped; by default a long list is cut at 20"))
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .addHelpText("after", t(`
The editor's Delete Unused: a string no trigger, location, name, force, sound or setting refers to is blanked. Nothing
is renumbered, so what the triggers hold stays right; blank slots at the end of the table are dropped.`))
    .action(async (file: string, o: { json?: boolean; dryRun?: boolean; all?: boolean; out?: string }) => {
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const removed = pruneStrings(doc, { dryRun: !!o.dryRun });
      const w = (removed.length || piped) && !o.dryRun ? await writeBack(doc, input.path, o.out ?? null) : null;
      if (o.json) { print(JSON.stringify({ file: input.name, removed, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      if (!removed.length) { say(piped, `${mark.ok} ${pc.bold(input.name)}: ${t("every string is referred to")}`); return; }
      const limit = o.all ? Infinity : 20;
      const show = (s: string) => { const p = s.replace(/\s+/g, " "); return p.length > 70 ? `${p.slice(0, 67)}…` : p; };
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${o.dryRun ? t("{n, plural, one {# unused string} other {# unused strings}} would be dropped", { n: removed.length }) : t("{n, plural, one {# unused string} other {# unused strings}} dropped", { n: removed.length })}${w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : ""}`,
        ...removed.slice(0, limit).map((r) => `  ${pc.dim(String(r.index).padStart(4))}  ${show(r.text)}`),
        ...(removed.length > limit ? [pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(removed.length - limit) })}`)] : []));
    });

  map.command("optimize").description(t("the map made smaller without changing what the game plays")).argument("<map>").addOption(json)
    .option("--dry-run", t("say what would go and what each step saves; write nothing"))
    .option("--strip-editor", t("also drop the sections only editors read (ISOM, TILE, DD2, the sound list, switch names…)"))
    .option("--compression <method>", t("pkware (every version of the game) or zlib (Remastered only); default pkware, or the smaller for a zlib map"))
    .option("--keep <members...>", t("archive members to keep though nothing names them; a name ending in \\ keeps a folder"))
    .option("--all", t("list everything removed; by default a long list is cut at 20"))
    .option("-o, --out <map>", t("write the result here instead of over the map; - for standard output"))
    .addHelpText("after", t(`
In order: sounds no trigger or briefing plays and the sound list does not name, the sound list's entries for files
the map lacks, any other archive member nothing names, the strings nothing refers to, and every member compressed
again. A table says what each step saved. Kept whatever refers to them: TrigScript, Magenta and build files
(trigscript\\, magenta\\, scmjs\\), members with no name, and sounds stored with the game's own ADPCM compression,
which nothing the editor writes beats. A built map keeps its scenario as built, and a map whose triggers write to
the game's memory (EUD) keeps its strings.

--strip-editor also drops ISOM, TILE, DD2, IVER, IVE2, IOWN, UPUS, SWNM and WAV, which the game never reads: the map
plays the same, but an editor opening it has no isometric terrain, no doodads to select, no sound list and no
switch names. Keep the original to go on editing.
  scmjs map optimize "My Map.scx" --dry-run
  scmjs map optimize "My Map.scx" --out "My Map (small).scx" --strip-editor`))
    .action(async (file: string, o: { json?: boolean; dryRun?: boolean; stripEditor?: boolean; compression?: string; keep?: string[]; all?: boolean; out?: string }) => {
      if (o.compression !== undefined && !(COMPRESSIONS as readonly string[]).includes(o.compression)) throw new CliError(t("--compression takes {values}, not \"{value}\"", { values: COMPRESSIONS.join(t(" or ")), value: o.compression }), null, 2);
      const input = await readInput(file);
      expectKind(input, "map");
      const piped = piping(input, o);
      const bare = !looksLikeMpq(input.bytes);
      if (o.out && o.out !== STDIO && (formatOf(o.out) === "chk") !== bare) throw new CliError(t("map optimize writes the map in its own form: {how}", { how: bare ? t("a bare scenario stays a .chk") : t("an archive stays a .scx or .scm") }), t("Name an output of the same kind, or convert with the editor first."), 2);
      const r = await optimizeMap(input.bytes, input.name, { stripEditor: !!o.stripEditor, compression: o.compression as Compression | undefined, keep: o.keep });
      const w = !o.dryRun && r.after < r.before ? await writeOutput(r.bytes, o.out ?? input.path) : null;
      if (o.json) { print(JSON.stringify(optimizeJson(r, { dryRun: !!o.dryRun, written: w }), null, 2)); return; }
      say(piped, ...printOptimize(r, { dryRun: !!o.dryRun, written: w ? outName(w) : null, all: !!o.all }));
    });

  map.command("unpack").description(t("a map's archive as a folder: the scenario, its sounds, scripts and other files")).argument("<map>").addOption(json)
    .option("-o, --out <folder>", t("the folder to write; by default one named after the map, beside it"))
    .option("--list", t("list the archive's members and write nothing"))
    .option("--text", t("the scenario as a folder of text files (scenario/), for git, instead of staredit/scenario.chk"))
    .addHelpText("after", t(`
Each member becomes a file at its archive path (staredit/scenario.chk, staredit/wav/…, trigscript/…), and
{manifest} records the map's name, how it was stored and the members without a name, so that scmjs map pack
puts the archive back together as it was.

With --text the scenario is written as text instead: scenario/map.json (size, tileset, players, forces),
terrain.txt, units.tsv, locations.tsv, strings.txt, triggers.txt and the rest, and the sections the editor does
not model as bytes under scenario/sections/. Edit the text and scmjs map pack builds the map from it; an
untouched folder packs back into the same scenario, byte for byte. The scenario/ folder is replaced each time.`, { manifest: MANIFEST_FILE }))
    .action(async (file: string, o: { json?: boolean; out?: string; list?: boolean; text?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      if (o.list) {
        const r = await listMembers(input.bytes);
        if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
        const width = Math.max(...r.members.map((m) => m.name.length));
        print(`${pc.bold(input.name)}${dot}${t("{n, plural, one {# member} other {# members}}", { n: r.members.length })}${r.listfile ? "" : dot + pc.yellow(t("no file list"))}`, ...r.members.map((m) => `  ${(m.kind === "stored" ? pc.dim(m.name) : m.name).padEnd(width + (m.kind === "stored" ? 9 : 0))}  ${pc.dim(size(m.bytes).padStart(8))}`), ...r.problems.map((p) => `${mark.warn} ${p}`));
        return;
      }
      const base = input.path === STDIO ? "stdin" : input.path;
      const dir = o.out ?? base.replace(/\.(scm|scx|chk)$/i, "") + (/\.(scm|scx|chk)$/i.test(base) ? "" : "-unpacked");
      const r = await unpackMap(input.bytes, input.name, dir, { text: !!o.text });
      if (o.json) { print(JSON.stringify({ file: input.name, dir: r.dir, files: r.files, bytes: r.bytes, stored: r.stored, manifest: r.manifest, text: r.text }, null, 2)); return; }
      const text = r.text;
      const sections = (names: string[]) => names.map((n) => n.trim()).join(" ");
      // "Kept as bytes" lines up with "Scenario as text" above it; "Bytes kept beside" is the longer one and stands out.
      const asText = t("Scenario as text");
      print(`${mark.ok} ${pc.bold(input.name)}: ${t("{n, plural, one {# file} other {# files}}", { n: r.files })}${r.stored ? pc.dim(t(" ({n} without a name)", { n: r.stored })) : ""}${dot}${size(r.bytes)}${dot}${pc.dim("→")} ${pc.cyan(relative(process.cwd(), r.dir) || ".")}`,
        ...(text ? [
          `  ${pc.dim(asText)}  ${t("{n, plural, one {# section} other {# sections}}", { n: text.text.length + text.layout.length + text.records.length })}${dot}${t("{size} in {n, plural, one {# file} other {# files}}", { size: size(text.size), n: text.files })}`,
          ...(text.layout.length || text.records.length ? [`  ${pc.dim(t("Bytes kept beside"))}  ${sections([...text.layout, ...text.records])} ${pc.dim(t("(used while their text is unchanged)"))}`] : []),
          ...(text.bytes.length ? [`  ${pc.dim(padColumns(t("Kept as bytes"), columns(asText)))}  ${text.bytes.map((b) => `${b.name.trim()}${pc.dim(` (${b.why})`)}`).join(", ")}`] : []),
        ] : []),
        ...r.manifest.problems.map((p) => `${mark.warn} ${p}`));
    });
  map.command("pack").description(t("the folder scmjs map unpack wrote, back into a map file")).argument("<folder>").addOption(json)
    .option("-o, --out <map>", t("the file to write; by default the name {manifest} records, beside the folder", { manifest: MANIFEST_FILE }))
    .option("--compression <method>", t("none, pkware or zlib for every member, instead of how the map was stored"))
    .addHelpText("after", t(`
Every file in the folder goes in: the ones {manifest} names at their archive paths, and any added since at the
path they have in the folder. The archive is compressed and encrypted as the map was, and written without a file list
when the map had none. A folder map unpack --text wrote has its scenario built from the text in scenario/. The packed
file is opened as a map before it is written.`, { manifest: MANIFEST_FILE }))
    .action(async (dir: string, o: { json?: boolean; out?: string; compression?: string }) => {
      if (o.compression && !["none", "pkware", "zlib"].includes(o.compression)) throw new CliError(t("--compression takes none, pkware or zlib, not \"{value}\"", { value: o.compression }), null, 2);
      const r = await packMap(dir, { out: o.out ?? null, compression: o.compression as "none" | "pkware" | "zlib" | undefined });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(`${mark.ok} ${pc.bold(relative(process.cwd(), r.path) || r.path)}: ${t("{n, plural, one {# member} other {# members}}", { n: r.members + 1 })}${r.fromText ? pc.dim(t(" (the scenario from text)")) : ""}${r.stored ? pc.dim(t(" ({n} without a name)", { n: r.stored })) : ""}${r.added.length ? `${dot}${t("{n, plural, one {# file} other {# files}} added: {list}", { n: r.added.length, list: r.added.join(", ") })}` : ""}${dot}${r.compression}${r.encrypted ? t(", encrypted") : ""}${dot}${size(r.bytes)}`);
    });

  const sounds = map.command("sounds").description(t("a map's sounds, listed or written out as files"))
    .addHelpText("after", t(`
The sounds are the WAV table's entries (the Sound Editor's list) and any other file in the archive that is audio.
They come out as the files that went in: a WAV plays as it is (the archive's own sound compression is undone on the
way), an Ogg is written as it is. A name in the table that the map does not carry is listed, not an error: a path
under sound\\ is one of the game's own sounds.`));
  sounds.command("list", { isDefault: true }).description(t("each sound: its slot, length, format, size and what plays it")).argument("<map>").addOption(json)
    .action(async (file: string, o: { json?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      const { report } = await readSounds(input);
      print(...(o.json ? [JSON.stringify(report, null, 2)] : printSounds(report)));
    });
  sounds.command("export").description(t("the sounds as .wav and .ogg files in a folder")).argument("<map>").addOption(json)
    .option("-o, --out <folder>", t("the folder to write; by default one named after the map with -sounds, beside it"))
    .action(async (file: string, o: { json?: boolean; out?: string }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      const base = input.path === STDIO ? "stdin" : input.path.replace(/\.(scm|scx|chk)$/i, "");
      const r = await exportSounds(input, o.out ?? `${base}-sounds`);
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      const near = r.dir ? relative(process.cwd(), r.dir) : "";
      const where = r.dir ? `${dot}${pc.dim("→")} ${pc.cyan(near.startsWith("..") ? r.dir : near || ".")}` : "";
      print(...printSounds(r, (s) => ("file" in s && s.file ? relative(r.dir ?? "", s.file) : s.name)).map((l, i) => (i === 0 ? `${r.written ? mark.ok : mark.info} ${l}${where}` : l)));
    });

  map.command("build").description(t("apply the map's TrigScript script and build its programs, as Save does")).argument("<map>").addOption(json)
    .option("-o, --out <map>", t("write the built map here instead of over the map; - for standard output"))
    .option("--check", t("compile (and test, with --test) and write nothing"))
    .option("--test", t("run the script's tests first; a failing test refuses the build"))
    .addHelpText("after", t(`
The script is the one the map keeps (Triggers ▸ TrigScript… in the editor). Its trigger() calls go into the trigger
list and its program()s are built into the file, with the map as you edit it kept beside them, so it opens in the
editor as it was. Needs TypeScript on this computer: npm install typescript. Exits 1 when the script does not
compile, a test fails or the build is refused; nothing is written then.`))
    .action(async (file: string, o: { json?: boolean; out?: string; check?: boolean; test?: boolean }) => {
      const { input, doc } = await openForEdit(file);
      const piped = !o.check && piping(input, o);
      const typescript = await loadTypeScript();
      const r = await buildMap(doc, input.path, typescript, { check: !!o.check, test: !!o.test, out: o.out ?? null });
      if (o.json) print(JSON.stringify({ file: input.name, ...r }, null, 2));
      else say(piped, ...printBuild(input.name, r));
      if (!r.ok) process.exitCode = 1;
    });

  map.command("run").description(t("run a plugin, or a script written like one, over a map with the plugin API")).argument("<plugin>", t("a folder with plugin.json, a plugin.ts/.js file, github:owner/repo or a URL")).argument("<map>").addOption(json)
    .option("--command <id>", t("after it starts, run this command of its (the id it registered)"))
    .option("--arg <value...>", t("arguments for --command"))
    .option("-o, --out <map>", t("write the changed map here instead of over the map; - for standard output"))
    .option("--dry-run", t("say what would change, as map diff does, and write nothing"))
    .addHelpText("after", t(`
The plugin gets the editor's plugin API (docs.scmjs.dev/plugins) with the map open and no editor around it: what it
would show — its status line, toasts, log — is printed here, and dialogs show nothing. A script is a file exporting
activate(api), like a plugin's entry; a .ts needs TypeScript installed. The map is written back only when the
plugin changed it. Exits 1 when the plugin does not load or throws.`))
    .action(async (target: string, file: string, o: { json?: boolean; command?: string; arg?: string[]; out?: string; dryRun?: boolean }) => {
      const { input, doc } = await openForEdit(file);
      const piped = piping(input, o);
      const r = await runOnMap(doc, input.path, input.bytes, target, { command: o.command, args: o.arg, out: o.out ?? null, dryRun: !!o.dryRun, live: o.json ? undefined : (line) => say(piped, line) });
      if (o.json) print(JSON.stringify({ file: input.name, ...r }, null, 2));
      else say(piped, ...printRun(input.name, r, { dryRun: !!o.dryRun }));
    });

  /** `--every`, `--seed`, `--games`: whole numbers, or exit 2 (values.ts reads them for every command alike). */
  const whole = parseWhole;
  const gameOptions = (cmd: Command) => cmd
    .option("--frames <n>", t("frames to run (24 a second); the game may end sooner"), "2400")
    .option("--every <n>", t("frames between progress lines; 0 for none"), "600")
    .option("--seed <n>", t("the game's seed; the same seed and map give the same run"), "1")
    .option("--all", t("list every trigger; by default a long list is cut"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .option("--mod <mod>", t("lay a mod over the game: a mod folder, an .mpq, a mod's .exe or .zip, or a folder of its files"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp());
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
    if (!o.replay) {
      if (!file) throw new CliError(t("Name a map, or a replay with --replay."), null, 2);
      const { input, doc } = await openForEdit(file);
      const game = await gameMap(doc, input.path, input.name);
      if (game.converted && !o.json) print(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead", { name: input.name })));
      return { name: input.name, scenario: doc.scenario, map: game.path as string | null, replay: undefined, frames: parseFrames(o.frames), extra: {} };
    }
    const replayInput = await readInput(o.replay);
    expectKind(replayInput, "replay");
    if (replayInput.path === STDIO) throw new CliError(t("--replay takes a replay file, not standard input."), null, 2);
    const rep = await loadReplayInput(replayInput);
    await checkPlayedMod(rep, replayInput.name, o.mod, o.starcraft, (line) => process.stderr.write(`${mark.warn} ${line}\n`));
    const named = file ? await openForEdit(file) : null;
    const run = await replayRun(rep, named && { doc: named.doc, path: named.input.path, name: named.input.name, bytes: named.input.bytes });
    if (!o.json) {
      if (run.converted) print(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is played instead", { name: named ? named.input.name : t("The map in {file}", { file: replayInput.name }) })));
      if (named && run.differs) print(`${mark.warn} ${t("{name} differs from the map in the replay {how}. A changed map can make the replay go out of step: when a unit a player clicked is not there, the game plays on with commands meant for another game. The trace says if that happens.", { name: named.input.name, how: pc.dim(`(${run.differs})`) })}`);
    }
    const frames = cmd.getOptionValueSource("frames") === "default" ? undefined : parseFrames(o.frames);
    return { name: replayInput.name, scenario: run.scenario, map: run.map, replay: replayInput.path, frames, extra: { replayFile: replayInput.name, map: named?.input.name ?? null, differs: run.differs } };
  }

  /** `--every`: a replay's game is long, so left at its default a progress line comes a minute of play apart (1,440 frames at 24 a second). */
  const everyOf = (o: GameOptions & ReplayOptions, cmd: Command) => (o.replay && cmd.getOptionValueSource("every") === "default" ? 1440 : whole(o.every, "every"));

  const replayFlags = (cmd: Command) => cmd
    .option("--replay <file>", t("play a replay's game instead: its players' commands, on its own map or on the map named"))
    .option("--order", t("with --replay, list every firing in the order the game ran it"));

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
      const g = await gameRun(file, o, cmd);
      const overlay = overlayOf(o);
      const r = await runMapInGame(g.map, "trace", { mod: overlay ?? undefined, frames: g.frames, every: everyOf(o, cmd), seed: whole(o.seed, "seed"), starcraft: o.starcraft, engine: o.engine, replay: g.replay, order: o.order, live: o.json ? undefined : (line) => print(line) }).finally(() => overlay?.remove());
      if (o.json) print(JSON.stringify({ ...traceReport(g.name, g.scenario, r), ...g.extra, engine: r.engine, game: r.game, copies: r.end.trace, ms: r.end.ms }, null, 2));
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
      const g = await gameRun(file, o, cmd);
      const overlay = overlayOf(o);
      const r = await runMapInGame(g.map, "cost", { mod: overlay ?? undefined, frames: g.frames, every: everyOf(o, cmd), seed: whole(o.seed, "seed"), starcraft: o.starcraft, engine: o.engine, weigh: o.weigh, replay: g.replay, live: o.json ? undefined : (line) => print(line) }).finally(() => overlay?.remove());
      if (o.json) print(JSON.stringify({ ...costReport(g.name, r), ...g.extra, engine: r.engine, game: r.game, series: r.end.cost, ms: r.end.ms }, null, 2));
      else print("", ...printCost(g.name, g.scenario, r, { all: !!o.all }));
    });

  map.command("rush").description(t("the ground distance between the start locations, walked by the game's own pathing")).argument("<map>").addOption(json)
    .option("--unit <name>", t("the unit walked: Zergling, Dragoon, a units.dat id…"), "SCV")
    .option("--seed <n>", t("the game's seed; the same seed and map give the same walks"), "12345")
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--limit <frames>", t("frames a walk may take before it is given up")).default("10000").hideHelp())
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", t(`
The game walks the unit from each start location to every other, as a player's unit would go when sent there, and
each walk is timed. Prints a table with the starts as rows and columns: the pixels walked and the seconds it took at
Fastest, then the shortest and longest of them beside the straight line, and any walk that did not arrive (no ground
between two starts is an island map). The engine and your copy of StarCraft are needed, as for scmjs map trace.
Exits 2 when the game could not start.`))
    .action(async (file: string, o: { json?: boolean; unit: string; seed: string; limit: string; starcraft?: string; engine?: string }) => {
      const unit = unitByName(o.unit);
      const seed = whole(o.seed, "seed"), limit = whole(o.limit, "limit", 1);
      const { input, doc } = await openForEdit(file);
      // Said before the game starts, as map analyze and map balance say it.
      const starts = startPlaces(doc).length;
      if (starts < 2) throw new CliError(starts ? t("{file} has one start location: a rush is walked between two or more.", { file: input.name }) : t("{file} has no start locations: a rush is walked between two or more.", { file: input.name }), t("A melee map places a Start Location for each player."), 2);
      const game = await gameMap(doc, input.path, input.name);
      if (game.converted && !o.json) print(pc.dim(t("{name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead", { name: input.name })));
      const r = await runRush(game.path, { unit, seed, limit, starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line) });
      if (o.json) print(JSON.stringify(rushJson(input.name, r), null, 2));
      else print("", ...printRush(input.name, r));
    });

  map.command("analyze").description(t("a melee map's layout: starts, mains, naturals, walks, chokes and ground, without running the game")).argument("<map>").addOption(json)
    .option("--picture <file.png>", t("also draw the map with the walks, chokes and naturals on it; - for standard output"))
    .option("--scale <n>", t("the picture's pixels a tile: {scales} (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--all", t("every pair of starts and every base, not only the shortest and longest"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addHelpText("after", t(`
Reads the ground as a unit walks it, from the tileset of your copy of StarCraft (which minitiles are walkable, at
which height), with buildings and resources in the way, and reports each start's main and natural, the walk between
every pair of starts beside the straight line (in tiles, and in seconds for a Zergling, Marine and Zealot), the
narrowest point on each walk and on each main's way to its natural, how much of the map is walkable, buildable and
high ground, then a few verdicts. Nothing runs in the game, so it takes about a second; map rush has the game walk.
Exits 2 for a map with fewer than two start locations.`) + `
  scmjs map analyze "(4)Crossing.scx"
  scmjs map analyze "(4)Crossing.scx" --picture crossing.png`)
    .action(async (file: string, o: { json?: boolean; picture?: string; scale?: string; all?: boolean; starcraft?: string }) => {
      const piped = o.picture === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the picture both want standard output"), t("Write the PNG to a file with --picture, or leave --json off."), 2);
      const { input, doc } = await openForEdit(file);
      const { report, lines } = await analyzeMap(input, doc, o);
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, ...lines);
    });

  map.command("balance").description(t("is the map fair to every start? games played over and over, a row a start location")).argument("<map>").addOption(json)
    .requiredOption("--bots <files>", t("one bot (it plays the game's computer) or two, comma separated; a race after a colon: mybot.scmbot:p"))
    .option("--races <letters>", t("the races a side plays when it has none of its own: z, t, p and r (random)"), "r")
    .option("--games <n>", t("rounds: every pairing once a seed, seeds 1 to n"), "8")
    .option("--seeds <list>", t("the seeds to play, comma separated, in place of --games"))
    .option("--frames <n>", t("stop a game nobody has won after this many frames (24 a second)"), "30000")
    .option("--parallel <n>", t("games at once (default: up to 4, as this computer's cores and memory allow)"))
    .option("-o, --out <folder>", t("keep every game's replay here (by default they are deleted)"))
    .option("--no-rush", t("leave out the walks between the starts (map rush)"))
    .option("--timeout <seconds>", t("how long a bot may think over one frame before it counts as hung"), "60")
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", t(`
The same sides play game after game on the map, as scmjs bot ladder plays them: a bot against the game's computer,
or two bots both ways round. The game deals the start locations itself, so each game's replay is played back to see
which start each side had and when one first lost a unit to the other. Prints a row a start: games, wins, the win
rate beside what the two sides' own records predict, the average length and first contact, the walk to the other
starts (as map rush) and the main's minerals and gas, then a verdict. Needs your copy of StarCraft and the engine,
as for scmjs bot ladder. Exits 1 when a game could not be played, 2 when the map has fewer than two starts.

  scmjs map balance "(4)My Map.scx" --bots out/mybot.scmbot:p --races p --games 12 --parallel 4
  scmjs map balance "(4)My Map.scx" --bots mybot.scmbot,mybot.scmbot --games 6`))
    .action(async (file: string, o: { json?: boolean; bots: string; races: string; games: string; seeds?: string; frames: string; parallel?: string; out?: string; rush: boolean; timeout: string; starcraft?: string; engine?: string }) => {
      const races = parseRaces(o.races);
      const games = whole(o.games, "games", 1);
      const seeds = o.seeds ? o.seeds.split(",").map((x) => x.trim()).filter(Boolean).map((x) => whole(x, "seeds")) : Array.from({ length: games }, (_, k) => k + 1);
      const bots = o.bots.split(",").map((b) => b.trim()).filter(Boolean);
      const { input, doc } = await openForEdit(file);
      if (input.path === STDIO) throw new CliError(t("map balance plays the map from a file, not standard input."), null, 2);
      const say = (l: string) => (o.json ? process.stderr.write(l + "\n") : print(l));
      // A map in the original 1.00 form is played as Brood War (as bot ladder does), so that its replays play back;
      // the rush's walks get a copy of their own, which map rush deletes when it ends.
      const play = await gameMap(doc, input.path, input.name);
      const rushPlay = o.rush ? await gameMap(doc, input.path, input.name) : null;
      if (play.converted) say(pc.dim(t("{name} is an original StarCraft map: it is played converted to Brood War.", { name: input.name })));
      let r;
      try {
        r = await runBalance(input.name, input.path, doc, {
          bots, races, seeds, frames: parseFrames(o.frames), parallel: o.parallel === undefined ? undefined : whole(o.parallel, "parallel", 1), timeout: whole(o.timeout, "timeout", 1),
          out: o.out, rush: o.rush, starcraft: o.starcraft, engine: o.engine, play: play.path, rushPlay: rushPlay?.path, live: say,
        });
      } finally { removeGameMap(play.path); if (rushPlay) removeGameMap(rushPlay.path); }
      if (o.json) print(JSON.stringify(balanceJson(r), null, 2));
      else print("", ...printBalance(r));
      if (r.report.games.some((g) => !g.result.end || g.result.end.by === "desync")) process.exitCode = 1;
    });

  /** `map test` (and `mod test`, which names the mod first): the map's scenarios played in the game, with `--mod` laid over it. */
  async function mapTestAction(file: string, testFiles: string[], o: { json?: boolean; format: string; out?: string; frames: string; seed: string; update?: boolean; clips?: string | true; clipsFormat?: ClipKind; starcraft?: string; engine?: string; mod?: string }) {
    // An optional value takes the next word, so `--clips ums.tests.json` would read the tests file as the folder.
    if (typeof o.clips === "string" && /\.json$/i.test(o.clips)) { testFiles.push(o.clips); o.clips = true; }
    if (!(FORMATS as readonly string[]).includes(o.format)) throw new CliError(t("--format takes {formats}, not \"{value}\"", { formats: FORMATS.join(", "), value: o.format }), null, 2);
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
    if (text) for (const w of written) print(`${pc.cyan("✎")} ${t("{n, plural, one {# expectation} other {# expectations}} written into {file}", { n: w.expectations, file: relative(process.cwd(), w.file) || w.file })}`);
    if (run.scenarios.some((s) => !s.ok)) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
    if (text) print("", testSummary(run));
    // The clips come after the verdict: they take longer, and a want of a browser leaves the result as it is.
    let clips: ClipRun | null = null;
    if (o.clips !== undefined && run.scenarios.some((s) => !s.ok)) {
      const engine = o.engine ?? "";
      clips = await makeClips(run.scenarios, {
        dir: clipsDir(input.path, input.name, o.clips), kind: o.clipsFormat ?? "gif", starcraft: o.starcraft, play: /^https?:/.test(engine) ? engine : undefined,
        live: text ? (line) => print(line) : undefined,
      });
      if (text) print(...clipsSummary(clips));
      else if (clips.missing) process.stderr.write(`${clips.missing}\n`);
    }
    const clipOf = (s: (typeof run.scenarios)[number]) => clips?.clips.find((c) => c.scenario === s.name && c.tests === s.file)?.file ?? null;
    const report: TestReport = { map: input.path, name: input.name, cases: run.scenarios.map((s) => ({ name: s.name, file: s.file, line: s.line, ok: s.ok, ms: s.ms, failures: s.results.filter((x) => !x.ok), replay: s.replay, clip: clipOf(s) })) };
    if (format === "json") print(JSON.stringify({ ...testJson(input.name, run), ...(clips ? { clips: clips.clips, clipsMissing: clips.missing } : {}) }, null, 2));
    else if (format === "github") print(...githubTestAnnotations([report]));
    else if (format === "junit") process.stdout.write(junitTestXml([report]));
    else if (format === "sarif") process.stdout.write(sarifTestJson([report], VERSION));
  }

  const test = map.command("test").description(t("runs the map's tests in the game: each scenario set up, played and checked, a replay of each that failed")).argument("<map>").argument("[tests...]", t("tests files (JSON); <map>.tests.json beside the map by default")).addOption(json)
    .option("--format <kind>", t("{formats}: github is workflow annotations, junit and sarif the files CI tools read", { formats: FORMATS.join(", ") }), "text")
    .option("-o, --out <folder>", t("where the replays of failing scenarios go (<map>.tests/ beside the map)"))
    .option("--frames <n>", t("frames a scenario runs when it does not say (24 a second)"), "2400")
    .option("--seed <n>", t("the game's seed when a scenario does not say; the same seed and map give the same game"), "1")
    .option("-u, --update", t("a scenario driven by a replay: write what the game gives now into the expectations that no longer hold"))
    .option("--clips [folder]", t("a clip of the last seconds of each failed scenario's game, drawn in a browser (<map>.clips/ beside the map)"))
    .addOption(new Option("--clips-format <kind>", t("the clips' kind")).choices(CLIP_KINDS).default("gif"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
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
    .option("--mod <mod>", t("lay a mod over the game: a mod folder, an .mpq, a mod's .exe or .zip, or a folder of its files"))
    .action(mapTestAction);

  test.command("record").description(t("a scenario from a replay: the game played on the map, its end written as expectations to trim")).argument("<map>").argument("<replay>").addOption(json)
    .option("--name <name>", t("the scenario's name (the replay's file name by default); a scenario of that name is written anew"))
    .option("--tests <file>", t("the tests file to write into (<map>.tests.json beside the map)"))
    .option("--frames <n>", t("frames to play (the replay's length by default)"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
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
        out: defaultOut(input.path), starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line),
      });
      // The map as it was typed, for the hint's command and the JSON (the runner had its name).
      const typed = { ...r, map: file };
      if (o.json) print(JSON.stringify(typed, null, 2));
      else print(...recordLines(typed));
    });

  map.command("preview").description(t("a picture of the map in the terminal, or as a PNG, with your copy of the game's graphics")).argument("<map>").addOption(json)
    .option("-o, --out <picture.png>", t("write a PNG instead; - for standard output"))
    .option("--scale <n>", t("pixels a tile: {scales} in a PNG (4 by default); in the terminal a pixel is half a character", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("the terminal picture's width in characters (as wide as the terminal by default)"))
    .option("--no-units", t("the terrain alone: no units, resources or start locations"))
    .addOption(new Option("--units", t("units, resources and start locations on the picture (the default)")).hideHelp())
    .option("--blocks", t("colour blocks, even in kitty or iTerm2, which can show the picture itself"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addHelpText("after", "\n" + t(`The terrain is drawn with the map's tileset as your copy of StarCraft has it, Remastered or 1.16.1; nothing of the
game is fetched or kept. Over it: a dot a unit in its owner's colour, sized as the unit is placed, mineral fields
and geysers in their own colours, and start locations framed (numbered in the terminal). In the terminal each
character is two pixels, in 24-bit colour where the terminal says it has it, else the nearest of 256.`) + `
  scmjs map preview ridge.scx
  scmjs map preview ridge.scx --out ridge.png --scale 8`)
    .action(async (file: string, o: { json?: boolean; out?: string; scale?: string; width?: string; units?: boolean; blocks?: boolean; starcraft?: string }) => {
      const piped = o.out === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the picture both want standard output"), t("Write the PNG to a file with --out, or leave --json off."), 2);
      const { input, doc } = await openForEdit(file);
      const { report, lines } = await previewMap(input, doc, o);
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, ...lines);
    });

  map.command("heatmap").description(t("where units died, buildings went up or armies walked in many replays, as heat over the map")).argument("<map>").argument("<replays...>", t("replays (.rep), or folders of them")).addOption(json)
    .option("--what <kind>", t("deaths, kills, buildings or paths (where armies walked)"), "deaths")
    .option("--player <n|name>", t("one player's: their number (1-8) or their name as the replays have it; for kills, the killer"))
    .option("--until <m:ss>", t("only what happened by this time in each game"))
    .option("-o, --out <picture.png>", t("write a PNG instead; - for standard output"))
    .option("--side-by-side", t("the map as map preview draws it beside the heat"))
    .option("--scale <n>", t("pixels a tile: {scales} in a PNG (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("the terminal picture's width in characters"))
    .option("--blocks", t("colour blocks, even in kitty or iTerm2"))
    .option("--any-map", t("take replays played on another map too: their own games, laid over this map"))
    .addOption(new Option("--force", t("the old name of --any-map")).hideHelp())
    .option("--parallel <n>", t("replays played at once (half the processors, at most 4, by default)"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`Each replay is played to its end in the game, as scmjs replay watch plays it, and every unit's death (where it
died, and who killed it), every building placed and where the armies walked are noted. Only replays played on this
map count: the same map, or one with the same name and size; the others are listed as left out. What a replay gave
is kept in scmjs's cache, so a second run with more replays plays only the new ones. Needs your copy of StarCraft.`) + `
  scmjs map heatmap "Fighting Spirit.scx" replays/
  scmjs map heatmap fs.scx replays/*.rep --what kills --player 1 --until 10:00 --out kills.png`)
    .action(async (file: string, replays: string[], o: HeatmapFlags & { anyMap?: boolean }) => {
      o.force = !!(o.force || o.anyMap);
      const piped = o.out === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the picture both want standard output"), t("Write the PNG to a file with --out, or leave --json off."), 2);
      const { input, doc } = await openForEdit(file);
      const live = (line: string) => (o.json || piped ? process.stderr.write(line + "\n") : print(line));
      const { report, lines } = await heatmapMap(input, doc, replays, o, { live });
      if (o.json) print(JSON.stringify(report, null, 2));
      else say(piped, "", ...lines);
    });

  map.command("coverage").description(t("which of the map's triggers fired in a folder of replays, how often, and which never did")).argument("<map>").argument("[replays...]", t("replays (.rep) or folders of them; a tests file (.json) counts its scenarios")).addOption(json)
    .option("--tests", t("count the games of the map's tests (<map>.tests.json beside it) too"))
    .option("--strict", t("exit 1 when a trigger a player in the games owned never fired"))
    .option("--format <kind>", t("{formats}: github is workflow annotations, junit and sarif the files CI tools read", { formats: FORMATS.join(", ") }), "text")
    .option("--all", t("list every trigger, those no player in the games owned too"))
    .option("--any-map", t("take replays played on another map too: their players' commands, played on this map"))
    .addOption(new Option("--force", t("the old name of --any-map")).hideHelp())
    .option("--parallel <n>", t("games played at once (half the processors, at most 4, by default)"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
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
      if (!(FORMATS as readonly string[]).includes(o.format)) throw new CliError(t("--format takes {formats}, not \"{value}\"", { formats: FORMATS.join(", "), value: o.format }), null, 2);
      const format: Format = o.json ? "json" : (o.format as Format);
      const { input, doc } = await openForEdit(file);
      const live = (line: string) => (format === "text" ? print(line) : process.stderr.write(visible(line) + "\n"));
      const r = await runCoverage(input, doc, sources, o, live);
      const scn = await coverageScenario(input);
      if (o.strict && r.never) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
      const form = () => coverageForm(input.path, r, scn, !!o.strict);
      if (format === "json") print(JSON.stringify(coverageJson(r, scn), null, 2));
      else if (format === "github") print(...githubCoverageAnnotations([form()]));
      else if (format === "junit") process.stdout.write(junitCoverageXml([form()]));
      else if (format === "sarif") process.stdout.write(sarifCoverageJson([form()], VERSION));
      else print("", ...printCoverage(r, scn, { all: !!o.all, strict: !!o.strict }));
    });

  map.command("play").description(t("a lobby on the play page with this map, and its invite link to send around")).argument("<map>").addOption(json)
    .addOption(new Option("--play <url>", t("the play page's address (SCMJS_PLAY_URL)")).hideHelp())
    .addOption(qrOption())
    .addHelpText("after", "\n" + t(`Opens scmjs.dev/play in your browser with the map and asks it for a lobby; the page is the host, and the link it
reports is printed here. The page asks you to sign in to scmjs.dev when you are not (opening a lobby needs an
account; joining one does not), and for the game's files the first time. The people you send the link to need
their own StarCraft files and no account. Waits up to five minutes for the page.`))
    .action(async (file: string, o: { json?: boolean; play?: string; qr?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      const r = await playInLobby(input, { play: o.play, qr: o.qr, live: o.json ? undefined : (line) => print(line) });
      if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
      if (!r.link) throw new CliError(r.error ?? t("The page opened no lobby"), t("Invite Players on the play page opens one by hand."));
    });

  map.command("diff").description(t("what changed between two maps, or since a git revision")).argument("<a>").argument("[b]", t("the other map; none with --rev")).addOption(json)
    .option("--all", t("list every item; by default a long list is cut at 20"))
    .option("--rev <revision>", t("compare the map as git has it at this revision (HEAD, HEAD~1, a branch, a tag) with the file as it is"))
    .option("--picture", t("draw the maps with the changes marked, with your copy of the game's graphics (as map preview)"))
    .option("-o, --out <picture.png>", t("with --picture: write a PNG instead; - for standard output"))
    .option("--side-by-side", t("with --picture: the first map, the changes and the second map in one picture"))
    .option("--scale <n>", t("with --picture: pixels a tile, {scales} in a PNG (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("with --picture: the terminal picture's width in characters"))
    .option("--blocks", t("with --picture: colour blocks, even in kitty or iTerm2"))
    .option("--starcraft <folder>", t("with --picture: your installation of StarCraft (SCMJS_STARCRAFT)"))
    .addHelpText("after", "\n" + t(`Exits 1 when the maps differ, 0 when they are the same, like diff.`) + `
  scmjs map diff old.scx new.scx
  scmjs map diff --rev HEAD~1 maps/ridge.scx     # ${t("what the last commit changed in the map")}
  scmjs map diff old.scx new.scx --picture --out diff.png --side-by-side`)
    .action(async (a: string, b: string | undefined, o: { json?: boolean; all?: boolean; rev?: string; picture?: boolean; out?: string; sideBySide?: boolean; scale?: string; width?: string; blocks?: boolean; starcraft?: string }) => {
      if (o.rev ? b !== undefined : b === undefined) throw new CliError(o.rev ? t("--rev compares one map with its earlier version: give the map alone") : t("Two maps to compare, or one with --rev <revision>"), null, 2);
      const picture = !!o.picture || o.out !== undefined || !!o.sideBySide;
      const pictureOnly = (["scale", "width", "blocks", "starcraft"] as const).find((k) => o[k] !== undefined);
      if (!picture && pictureOnly) throw new CliError(t("--{flag} is the picture's: add --picture", { flag: pictureOnly }), null, 2);
      const piped = o.out === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the picture both want standard output"), t("Write the PNG to a file with --out, or leave --json off."), 2);
      const fromRev = async () => { const input = revisionInput(o.rev!, a); expectKind(input, "map"); return { input, doc: await loadMapInput(input) }; };
      const [x, y] = await Promise.all([o.rev ? fromRev() : openForEdit(a), openForEdit(o.rev ? a : b!)]);
      const d = diffMaps({ name: x.input.name, doc: x.doc }, { name: y.input.name, doc: y.doc });
      if (picture) {
        const { report, lines } = await diffPicture(x, y, o);
        if (o.json) print(JSON.stringify({ ...d, picture: report }, null, 2));
        else say(piped, ...lines);
      } else print(...(o.json ? [JSON.stringify(d, null, 2)] : printDiff(d, !!o.all)));
      if (!d.same) process.exitCode = 1;
    });

  map.command("log").description(t("the map's history in git, each commit's changes in the map's terms")).argument("<map>").addOption(json)
    .option("--rev <revision>", t("the history up to this revision, or a range A..B (HEAD by default)"))
    .option("-n, --max-count <n>", t("the newest n commits only"))
    .addHelpText("after", "\n" + t(`One entry per commit that changed the file: hash, date, author, subject, and what changed in
the map, as map diff would say it between the commit's version and its parent's.`) + `
  scmjs map log maps/ridge.scx
  scmjs map log maps/ridge.scx -n 5
  scmjs map log maps/ridge.scx --rev main..HEAD     # ${t("what this branch did to the map")}`)
    .action(async (file: string, o: { json?: boolean; rev?: string; maxCount?: string }) => {
      const limit = o.maxCount === undefined ? undefined : Number(o.maxCount);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new CliError(t("-n takes a number of commits, not {value}", { value: String(o.maxCount) }), null, 2);
      const log = await mapLog(file, { rev: o.rev, limit });
      print(...(o.json ? [JSON.stringify(log, null, 2)] : printLog(log)));
    });

  map.command("blame").description(t("the commit that last changed each trigger, location, string, unit or setting")).argument("<map>").addOption(json)
    .option("--triggers", t("the triggers (the default, when the map has any)"))
    .option("--locations", t("the locations"))
    .option("--strings", t("the strings"))
    .option("--units", t("the units, a row for each kind and owner"))
    .option("--settings", t("the name, size, players, forces, terrain, unit and tech settings, and the archive's files"))
    .option("--trigger <n>", t("one trigger, by its number in the list, with its whole text"))
    .option("--location <name>", t("one location, by name or number"))
    .option("--string <n>", t("one string, by number"))
    .option("--rev <revision>", t("the map as this revision has it (the file as it is by default), or a range A..B"))
    .addHelpText("after", "\n" + t(`Like git blame, a row per thing in the map instead of per line: the commit, author and date
that last changed it. A trigger that only moved in the list has not changed. Without --rev
the file is read as it is, and what is not committed yet says so.`) + `
  scmjs map blame maps/ridge.scx
  scmjs map blame maps/ridge.scx --locations --strings
  scmjs map blame maps/ridge.scx --trigger 4`)
    .action(async (file: string, o: { json?: boolean; rev?: string; trigger?: string; location?: string; string?: string } & Partial<Record<BlameKind, boolean>>) => {
      const one = (["trigger", "location", "string"] as const).filter((k) => o[k] !== undefined);
      if (one.length > 1) throw new CliError(t("--{a} or --{b}, one at a time", { a: one[0], b: one[1] }), null, 2);
      const number = (v: string | undefined, what: string) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new CliError(t("--{flag} takes a number from 1, not {value}", { flag: what, value: v }), null, 2);
        return n;
      };
      const trigger = number(o.trigger, "trigger"), str = number(o.string, "string");
      let kinds: BlameKind[] = BLAME_KINDS.filter((k) => o[k]);
      if (one.length) kinds = [one[0] === "trigger" ? "triggers" : one[0] === "location" ? "locations" : "strings"];
      const fallback = !kinds.length;
      if (fallback) kinds = ["triggers", "settings"];
      const b = await blameMap(file, kinds, { rev: o.rev, trigger });
      // With no choice: the triggers, or the settings for a map with none (a melee map).
      if (fallback) { if (b.kinds.triggers!.length) delete b.kinds.settings; else delete b.kinds.triggers; }
      if (one.length) {
        const kind = kinds[0];
        const rows = b.kinds[kind]!;
        const want = one[0] === "location" ? o.location! : String(trigger ?? str);
        const at = one[0] === "location"
          ? rows.findIndex((r) => r.label.toLowerCase() === want.toLowerCase() || r.text.startsWith(`#${want} `))
          : rows.findIndex((r) => r.label === want);
        if (at < 0) {
          const what = one[0] === "trigger" ? t("trigger") : one[0] === "location" ? t("location") : t("string");
          throw new CliError(b.rev ? t("{file} has no {kind} {name} at {rev}", { file: b.path, kind: what, name: want, rev: b.rev }) : t("{file} has no {kind} {name}", { file: b.path, kind: what, name: want }), t("scmjs map blame \"{file}\" --{kind} lists them.", { file, kind }), 2);
        }
        const row = rows[at];
        if (o.json) { print(JSON.stringify({ file: b.file, path: b.path, rev: b.rev, kind, ...row, ...(kind === "triggers" ? { textForm: b.detail } : {}) }, null, 2)); return; }
        print(...printBlameItem(b, kind, row, one[0] === "trigger" ? t("Trigger {label}", { label: row.label }) : one[0] === "location" ? t("Location {label}", { label: row.label }) : t("String {label}", { label: row.label })));
        return;
      }
      print(...(o.json ? [JSON.stringify(b, null, 2)] : printBlame(b)));
    });

  map.command("merge").description(t("merge two versions of a map with their common ancestor, as git's merge driver")).argument("<base>", t("the common ancestor; with no other map, the map git stopped on")).argument("[ours]").argument("[theirs]").addOption(json)
    .option("-o, --out <map>", t("write the merged map here instead of over <ours>; - for standard output"))
    .option("--ours", t("settle each conflict with ours's version"))
    .option("--theirs", t("settle each conflict with theirs's version"))
    .option("--name <path>", t("the map's name in what is said (git gives it as %P)"))
    .option("--dry-run", t("say what would merge, and write nothing"))
    .addHelpText("after", "\n" + t(`Part by part: what one side changed is taken, what both changed is merged finer (terrain by tile, units by
instance, triggers in order, settings by field) or is a conflict. With no conflicts the merged map is written over
<ours> (or to --out); with conflicts nothing is written and the command exits 1, unless --ours or --theirs settles
them. scmjs init sets it up as git's merge driver:`) + `
  git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"
  scmjs map merge base.scx mine.scx theirs.scx --out merged.scx
  scmjs map merge maps/ridge.scx --ours     # ${t("after git merge stopped on it: the three versions from git")}`)
    .action(async (a: string, b: string | undefined, c: string | undefined, o: { json?: boolean; out?: string; ours?: boolean; theirs?: boolean; name?: string; dryRun?: boolean }) => {
      if (o.ours && o.theirs) throw new CliError(t("--ours or --theirs, not both"), null, 2);
      if (b !== undefined && c === undefined) throw new CliError(t("Three maps (base, ours, theirs), or one that git merge stopped on"), null, 2);
      const staged = b === undefined;
      const inputs = staged ? stagedInputs(a) : { base: asMap(await readInput(a)), ours: asMap(await readInput(b!)), theirs: asMap(await readInput(c!)) };
      const piped = o.out === STDIO && !o.dryRun;
      if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Write the map to a file with --out, or leave --json off."), 2);
      const prefer: Side | null = o.ours ? "ours" : o.theirs ? "theirs" : null;
      const r = await runMerge(inputs, { prefer, name: o.name ?? null, out: o.out ?? null, dryRun: !!o.dryRun, staged });
      if (o.json) print(JSON.stringify(r, null, 2));
      else say(piped, ...printMerge(r));
      if (r.conflicts.length && !r.settled) process.exitCode = 1;
    });

  map.command("fetch").description(t("search scmscx.com, the community's map database, and download a map")).argument("[words...]", t("what to search for: a map's name, words in its description, a file name")).addOption(json)
    .option("--limit <n>", t("how many of the best matches to list, 1 to {max}", { max: MAX_LIMIT }), String(DEFAULT_LIMIT))
    .option("--id <id>", t("download this map: its id from the list, or its address on the site"))
    .option("--first", t("download the best match for the words"))
    .option("-o, --out <path>", t("the file to write, or a folder to write it in (the site's file name); - for standard output"))
    .option("--force", t("overwrite a file that is there"))
    .option("--open", t("open the map in scmJS once it is downloaded, as scmjs map open does"))
    .addHelpText("after", "\n" + t(`The maps come from scmscx.com ({site}), where people have shared StarCraft maps for years; they are their
makers', and the site's. The list shows the best matches with their size, tileset, players, downloads and id; --id
or --first downloads one, named as the site names the file, into this folder or --out. The file is opened as the
editor opens it before it is written, so what arrives is a map. Exits 1 when nothing matched or the site did not
answer (within 10 seconds), 2 when the file is there already (--force overwrites it).`, { site: SCMSCX }) + `
  scmjs map fetch lost temple
  scmjs map fetch --id B8V7fdyj --out maps/
  scmjs map fetch lost temple --first --open
  scmjs map fetch fastest --first --out - | scmjs map info -`)
    .action(async (words: string[], o: { json?: boolean; limit?: string; id?: string; first?: boolean; out?: string; force?: boolean; open?: boolean }) => {
      const text = words.join(" ").trim();
      if (o.id && text) throw new CliError(t("--id downloads one map: give the id or the words, not both"), null, 2);
      if (!o.id && !text) throw new CliError(t("What to search for, or --id <id>"), "scmjs map fetch lost temple", 2);
      const download = !!(o.id || o.first);
      if (!download && (o.out || o.force || o.open)) throw new CliError(t("--out, --force and --open are for a download"), t("Add --first for the best match, or --id <id> from the list."), 2);
      const piped = download && o.out === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Write the map to a file with --out, or leave --json off."), 2);
      if (piped && o.open) throw new CliError(t("--open needs the map in a file"), t("Leave --out - off, or name a file or folder."), 2);
      const site = scmscx();
      if (!download) {
        const r = await searchMaps(site, text, parseLimit(o.limit));
        print(...(o.json ? [JSON.stringify(searchJson(r), null, 2)] : printSearch(r)));
        if (!r.maps.length) process.exitCode = 1;
        return;
      }
      let id = o.id ? mapIdFrom(o.id) : null;
      if (!id) {
        const best = (await site.search(text)).rows[0];
        if (!best) { if (!o.json) say(piped, pc.dim(t("Nothing on scmscx.com matches \"{words}\"", { words: text }))); process.exitCode = 1; return; }
        id = best.id;
      }
      const r = await fetchMap(site, id, { out: o.out, force: o.force });
      if (o.json) print(JSON.stringify(fetchJson(r), null, 2));
      else say(piped, ...printFetched(r));
      if (o.open) await openInScmjs({ path: r.written.path, name: r.report.file.name, bytes: new Uint8Array(await readFile(r.written.path)), kind: "map" }, {});
    });
  map.command("share").description(t("a link to the map on scmjs.dev: a copy anyone can open, or --edit to edit it together")).argument("<map>", t("the map, or - for standard input")).addOption(json)
    .option("--name <name>", t("the map's name on your account and in the link; the scenario's name by default"))
    .option("--note <text>", t("a note for this revision, as My Maps shows it"))
    .option("--edit", t("a link to edit the map together (Account ▸ Share this Map…), not a copy"))
    .option("--keep <how long>", t("with --edit: keep it open day, week, month or forever after its last edit; by default it is open until everyone leaves"))
    .option("--new", t("store it as a new map even when your account has one with this file name"))
    .option("--no-picture", t("upload no picture for the link's card"))
    .option("--starcraft <folder>", t("your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(qrOption())
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. A copy link stores the map on your account (My Maps) as a new map, or as a
new revision of the map there with the same file name, and links that revision: whoever opens it gets a copy in
their editor. --edit opens the map for editing together instead; whoever opens that link edits it with you.`) + `
  scmjs map share ridge.scx
  scmjs map share ridge.scx --edit --keep week`)
    .action(async (path: string, o: { json?: boolean; name?: string; note?: string; edit?: boolean; keep?: string; new?: boolean; picture?: boolean; starcraft?: string; qr?: boolean }) => {
      const input = await readInput(path);
      expectKind(input, "map");
      const r = await shareMap(input, await loadMapInput(input), o);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : withQr(printShare(r), r.link, o.qr)));
    });

  const replay = program.command("replay").description(t("read and open replays")).helpGroup(t("Maps and replays:"));
  replay.command("info").description(t("who played, on what map, for how long, at what APM")).argument("<replays...>").addOption(json)
    .option("--builds", t("what each player ordered: units, buildings, upgrades and technologies, by name, with their cost"))
    .option("--mod <mod>", t("the mod the replay was played with, for its names and costs: a mod folder, an .mpq, a mod's .exe or .zip"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT), for the game's costs and the files under a mod; found in the usual places otherwise"))
    .addHelpText("after", "\n" + t(`A replay saved by scmJS from a game of a mod says which mod it was (the Mod line): its name, the hash of its data
set, its makers' link and the plugins that ran. --mod names the mod's folder for the names and costs of its units,
upgrades and technologies, and is refused when its data set is not the one the replay names. Without it, a mod's
replay shows ids, never the game's names for them.`) + `
  scmjs replay info game.rep --builds
  scmjs replay info game.rep --builds --mod "My Mod"`)
    .action(async (files: string[], o: { json?: boolean } & ReplayNameOptions) => void await eachFile(files, !!o.json, (input) => replayInfo(input, o)));
  replay.command("map").description(t("the map the replay was played on, written out as a map file")).argument("<replay>").addOption(json)
    .option("-o, --out <map>", t("the file to write (.scx, .scm or .chk); the replay's name with .scx by default; - for standard output"))
    .option("--force", t("overwrite a file that is there"))
    .addHelpText("after", "\n" + t(`A replay carries the map the game loaded, so the map is there whole whether or not you still have the file. It is
written as the game had it: a bare .chk, or an archive like a new map's. Opens in the editor like any map.`) + `
  scmjs replay map game.rep                      # ${t("game.scx beside it")}
  scmjs replay map game.rep --out - | scmjs map info -`)
    .action(async (file: string, o: { json?: boolean; out?: string; force?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const out = o.out ?? mapFileFor(input.path === STDIO ? "stdin.rep" : input.path);
      const piped = out === STDIO;
      if (piped && o.json) throw new CliError(t("--json and the map both want standard output"), t("Write the map to a file with --out, or leave --json off."), 2);
      if (!piped && existsSync(out) && !o.force) throw new CliError(t("{file} is there already", { file: out }), t("--force overwrites it, --out names another file."), 2);
      const r = await writeReplayMap(await loadReplayInput(input), out);
      if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
      say(piped, `${mark.ok} ${pc.bold(gameText(r.name) || pc.italic(t("Untitled")))}: ${r.width} × ${r.height}${dot}${t("from {file}", { file: input.name })}${dot}${t("written to {file}", { file: outName(r.written) })}${dot}${size(r.written.bytes)}`);
    });
  replay.command("share").description(t("a link to the replay on scmjs.dev, which anyone opens to watch it in the editor")).argument("<replay>", t("the replay, or - for standard input")).addOption(json)
    .option("--note <text>", t("a note, as My Maps shows it"))
    .option("--no-picture", t("upload no map picture for the link's card"))
    .option("--starcraft <folder>", t("your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(qrOption())
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. The replay is stored on your account (My Maps ▸ Replays, up to 8 MB each,
counted with your maps) and linked; whoever opens the link watches it in the editor's replay viewer. The link's
card shows the map's picture when your copy of the game is here to draw it.`) + `
  scmjs replay share game.rep`)
    .action(async (path: string, o: { json?: boolean; note?: string; picture?: boolean; starcraft?: string; qr?: boolean }) => {
      const input = await readInput(path);
      expectKind(input, "replay");
      const r = await shareReplay(input, await loadReplayInput(input), o);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : withQr(printReplayShare(r), r.link, o.qr)));
    });
  replay.command("open").description(t("watch a replay in the scmJS app, or the editor in your browser")).argument("<replay>")
    .option("--browser", t("the editor in the browser, even with the app installed"))
    .addOption(new Option("--editor <url>", t("the editor's address (SCMJS_EDITOR_URL)")).hideHelp())
    .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "replay"); await openInScmjs(input, o); });
  replay.command("watch").description(t("play a replay in the terminal: the minimap, each player's figures, the chat")).argument("<replay>").addOption(json)
    .option("--speed <x>", t("how fast, against the game's Fastest (24 frames a second)"), "8")
    .option("--from <m:ss>", t("start the game here"))
    .option("--size <WxH>", t("the picture's size in characters; as much of the terminal as the map fills by default"))
    .option("--every <frames>", t("frames between lines when the output is not a terminal"), "1440")
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`The game is the play page's engine, fetched once (about 25 MB) and kept; the game's own files come from your copy of
StarCraft, Remastered or 1.16.1. The replay plays as the game plays it, drawn as a minimap: a dot a unit in its
player's colour, buildings as blocks, resources dim. Keys: space pauses, + and - change the speed, q stops. Into a
pipe or a file it prints a line per minute of game instead (--every), or JSON lines with --json.`))
    .action(async (file: string, o: { json?: boolean; speed: string; from?: string; size?: string; every: string; starcraft?: string; engine?: string }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const replay = await loadReplayInput(input);
      refuseModReplay(replay, input.name, "replay watch");
      const speed = Number(o.speed);
      if (!(speed > 0 && speed <= 64)) throw new CliError(t("--speed takes a number from 0.25 to 64, not \"{value}\"", { value: o.speed }), null, 2);
      const every = Number(o.every);
      if (!Number.isInteger(every) || every < 1) throw new CliError(t("--every takes a number of frames, not \"{value}\"", { value: o.every }), null, 2);
      let size: { cols: number; rows: number } | undefined;
      if (o.size) { const m = /^(\d+)x(\d+)$/i.exec(o.size); if (!m || Number(m[1]) < 8 || Number(m[2]) < 4) throw new CliError(t("--size takes WxH in characters, 8x4 or more, not \"{value}\"", { value: o.size }), null, 2); size = { cols: Number(m[1]), rows: Number(m[2]) }; }
      const r = await watchReplay(input, replay, { speed, from: o.from ? parseClock(o.from) : undefined, size, every, json: !!o.json, starcraft: o.starcraft, engine: o.engine });
      if (!o.json) print(watchSummary(input, r));
    });

  replay.command("export").description(t("the replay as a video or GIF with the game's own pictures, for sharing")).argument("<replay>").addOption(json)
    .option("-o, --out <file>", t("the clip: .webm, .mp4 or .gif (the replay's name with .webm beside it by default)"))
    .option("--from <m:ss>", t("where the clip starts in the game (its start by default)"))
    .option("--to <m:ss>", t("where it ends (the game's end by default)"))
    .option("--follow <player>", t("keep the camera on a player's play: a name, or a number as replay info lists them (the first person by default)"))
    .option("--at <x,y>", t("hold the camera on this tile"))
    .option("--all", t("show the whole map, scaled to fit"))
    .option("--speed <x>", t("game speed against Fastest (1 is the game's own pace)"), "1")
    .option("--size <WxH>", t("the clip's size in pixels (1280x720; a GIF 640x360)"))
    .option("--fps <n>", t("pictures a second (24; a GIF 12)"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .option("--browser <path>", t("the browser to draw with (SCMJS_BROWSER); Chrome, Chromium or Edge, found in the usual places otherwise"))
    .addOption(new Option("--play <url>", t("the play page's address (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`The clip is drawn by the play page's replay viewer, in a browser already on this computer (Chrome, Chromium or Edge,
started without a window), with the pictures of your own copy of StarCraft. The game is stepped picture by picture,
so the clip plays at the speed asked whatever the computer's pace. A .webm or a .gif needs nothing more; an .mp4 is
made from the .webm with ffmpeg, when it is installed. The camera follows where the player's army is and fights.`) + `
  scmjs replay export game.rep --from 4:30 --to 5:00
  scmjs replay export game.rep --out fight.mp4 --follow 2 --from 12:10 --to 12:40
  scmjs replay export game.rep --out game.gif --all --speed 16`)
    .action(async (file: string, o: ExportOptions & { json?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const replay = await loadReplayInput(input);
      refuseModReplay(replay, input.name, "replay export");
      const tty = !!process.stderr.isTTY && !o.json;
      let shown = 0;
      const r = await exportReplay(input, replay, o, (line, done) => {
        if (tty) process.stderr.write(`\r\x1b[2K${line}${done ? "\n" : ""}`);
        // (Into a file or a pipe, a line every ten seconds or so, not a line a picture.)
        else if (!o.json && (done || Date.now() - shown > 10_000)) { shown = Date.now(); process.stderr.write(`${visible(line)}\n`); }
      });
      if (tty) process.stderr.write("\r\x1b[2K");
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(exportSummary(r));
    });

  // ── Mods ──────────────────────────────────────────────────────────────────

  const starcraftOption = () => new Option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT), whose files are under the mod; found in the usual places otherwise"));

  /** Runs `fn` on each mod named; one that fails is said and the rest go on (as `eachFile` does for maps). */
  async function eachMod(paths: string[], asJson: boolean, fn: (path: string) => Promise<{ data: unknown; lines: string[] }>): Promise<void> {
    const results: unknown[] = [];
    for (const [i, path] of paths.entries()) {
      try {
        const { data, lines } = await fn(path);
        results.push(data);
        if (!asJson) { if (i) print(""); print(...lines); }
      } catch (e) {
        if (!(e instanceof CliError)) throw e;
        if (asJson) results.push({ file: path, error: e.message }); else fail(e);
        process.exitCode = Math.max(Number(process.exitCode ?? 0), e.exitCode);
      }
    }
    if (asJson) print(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  }

  /** A count of one of unpack's forms, in words. */
  function formWords(kind: string, n: number): string {
    switch (kind) {
      case "table": return t("{n, plural, one {# table} other {# tables}}", { n });
      case "strings": return t("{n, plural, one {# string table} other {# string tables}}", { n });
      case "iscript": return t("{n, plural, one {# iscript} other {# iscripts}}", { n });
      case "ai": return t("{n, plural, one {# AI script} other {# AI scripts}}", { n });
      case "overlay": return t("{n, plural, one {# overlay file} other {# overlay files}}", { n });
      case "graft": return t("{n, plural, one {# .graft file} other {# .graft files}}", { n });
      case "graphics": return t("{n, plural, one {# GRP} other {# GRPs}}", { n });
      case "sound": return t("{n, plural, one {# sound} other {# sounds}}", { n });
      case "map": return t("{n, plural, one {# map} other {# maps}}", { n });
      case "plugin": return t("{n, plural, one {# plugin} other {# plugins}}", { n });
      case "firegraft": return t("{n, plural, one {# FireGraft file} other {# FireGraft files}}", { n });
      default: return t("{n, plural, one {# other file} other {# other files}}", { n });
    }
  }
  const formsText = (forms: Record<string, number>, keys: string[]) => keys.filter((k) => forms[k]).map((k) => formWords(k, forms[k])).join(", ");

  const modCmd = program.command("mod").description(t("unpack, check, pack and play a mod of the game")).helpGroup(t("Plugins and bots:"))
    .addHelpText("after", "\n" + t(`A mod is a folder of text and pictures: its tables as PyDAT's text, its string tables, iscript and AI as PyMS's text,
its GRPs as PNG sheets, its sounds as they are. unpack makes one from what a mod ships as (a folder, an .mpq, a mod's
.exe, a .zip); pack makes the MPQ the launchers load; check looks for mistakes across the tables; play plays it on the
play page. docs.scmjs.dev/mods has the folder's form.`));

  modCmd.command("info").description(t("what a mod is: its files, tables, plugins and the game it is for")).argument("<mods...>", t("mods: a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).addOption(json)
    .addOption(starcraftOption())
    .action(async (paths: string[], o: { json?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      await eachMod(paths, !!o.json, async (path) => { const source = await openMod(path, base); const r = modInfo(source, await sourceHash(source)); return { data: r, lines: printModInfo(r) }; });
    });

  modCmd.command("unpack").description(t("a mod as a folder of text and pictures, to edit and keep in git")).argument("<mod>", t("a folder, an .mpq, a mod's .exe or a .zip")).argument("<folder>", t("the folder to write")).addOption(json)
    .option("--palette <name>", t("the tileset whose palette the GRPs are drawn with"), "jungle")
    .addOption(starcraftOption())
    .addHelpText("after", "\n" + t(`Each table, string table, iscript, AI script, overlay and .graft file is written as text, and each GRP as a PNG
sheet, only when that text or picture packs back into the same bytes; anything else is kept as it is under files/,
and mod.json says which and why. Sounds, maps and every other file are copied as they are, plugins and FireGraft
files too (never run). The names beside the tables and in the AI script come from the mod's own string tables, else
your copy of the game's. Unpacking over an earlier unpack replaces its folders.`))
    .action(async (path: string, dir: string, o: { json?: boolean; palette: string; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const source = await openMod(path, base);
      const r = await unpackMod(source, dir, { base, palette: o.palette });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      const text = formsText(r.forms, ["table", "strings", "iscript", "ai", "overlay", "graft"]);
      const kept = r.kept.reduce((n, k) => n + k.count, 0);
      print(`${mark.ok} ${pc.bold(r.name)}: ${t("{n, plural, one {# file} other {# files}}", { n: r.members })}${dot}${size(r.bytes)}${dot}${pc.dim("→")} ${pc.cyan(shownPath(r.dir))}`,
        ...rows([
          [t("As text"), text || null],
          [t("As pictures"), r.forms.graphics ? `${formWords("graphics", r.forms.graphics)} ${pc.dim(t("(the {palette} palette)", { palette: r.palette ?? "" }))}` : null],
          [t("As they are"), formsText(r.forms, ["sound", "map", "file"]) || null],
          [t("Kept as bytes"), kept ? t("{n, plural, one {# file} other {# files}}", { n: kept }) : null],
          ...r.kept.slice(0, 6).map((k) => ["", pc.dim(`${num(k.count)}: ${k.why}`)] as [string, string]),
          [t("Carried"), r.plugins + r.firegraft ? `${formWords("plugin", r.plugins)}, ${formWords("firegraft", r.firegraft)} ${pc.dim(t("(kept, never run)"))}` : null],
          [t("Names"), r.names === "mod" ? t("from the mod's string tables") : r.names === "game" ? t("from the game's string tables") : pc.dim(t("none (no string tables): numbers"))],
        ]),
        ...r.notes.map((n) => `${mark.info} ${n}`));
    });

  modCmd.command("pack").description(t("the folder back into an MPQ the launchers load, or a loose folder")).argument("<folder>", t("a folder mod unpack or mod new wrote")).addOption(json)
    .option("-o, --out <file>", t("the MPQ to write (<folder>.mpq beside the folder by default)"))
    .option("--folder <out>", t("write the files loose in the game's paths instead (for samase, or the play page)"))
    .option("--compression <method>", t("{methods} for every file", { methods: MOD_COMPRESSIONS.join(", ") }), "zlib")
    .addOption(starcraftOption())
    .addHelpText("after", "\n" + t(`Every file under the folder's tables/, strings/, iscript/, ai/, overlays/, graphics/, sounds/, grafts/, maps/ and
files/ goes in, at the game's path mod.json and its own path say. The same folder gives the same bytes every time. A
PNG that is no longer in its palette's colours is brought to the nearest, and a sound that is not a WAV is converted
with ffmpeg. MPQDraft makes a self-executing mod from the MPQ; Chaoslauncher and FireGraft load it as it is.`))
    .action(async (dir: string, o: { json?: boolean; out?: string; folder?: string; compression: string; starcraft?: string }) => {
      if (!(MOD_COMPRESSIONS as readonly string[]).includes(o.compression)) throw new CliError(t("--compression takes {methods}, not \"{value}\"", { methods: MOD_COMPRESSIONS.join(", "), value: o.compression }), null, 2);
      const r = await packModFolder(dir, { out: o.out, folder: o.folder, compression: o.compression as ModCompression, starcraft: o.starcraft });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(...printPacked(r));
    });

  /** Opens a folder mod unpack or mod new wrote, and packs it. */
  async function packModFolder(dir: string, o: { out?: string; folder?: string; compression: ModCompression; starcraft?: string }) {
    const manifest = await readModFolder(dir);
    return packMod(dir, manifest, { out: o.out, folder: o.folder, compression: o.compression, base: await gameFilesOrNull(o.starcraft) });
  }

  function printPacked(r: Awaited<ReturnType<typeof packMod>>): string[] {
    return [
      `${mark.ok} ${pc.bold(shownPath(r.path))}: ${t("{n, plural, one {# file} other {# files}}", { n: r.members })}${r.compression ? `${dot}${r.compression}` : `${dot}${t("loose")}`}${dot}${size(r.bytes)}`,
      ...r.converted.map((c) => `  ${pc.dim(t("{file} converted to a WAV", { file: c }))}`),
      ...r.quantised.map((q) => `${mark.warn} ${t("{file}: {pixels, plural, one {# pixel} other {# pixels}} in {colours, plural, one {# colour} other {# colours}} not in the palette, brought to the nearest", { file: q.file, pixels: q.pixels, colours: q.colours })}`),
      ...(r.left.length ? [pc.dim(`  ${t("Left out (not in a mod's folders): {list}", { list: `${r.left.slice(0, 6).join(", ")}${r.left.length > 6 ? " …" : ""}` })}`)] : []),
    ];
  }

  modCmd.command("check").description(t("mistakes across the tables: pictures, scripts, sounds and references that are not there")).argument("<mods...>").addOption(json)
    .option("--all", t("list every finding; by default a long list is cut at 40"))
    .addOption(starcraftOption())
    .addHelpText("after", "\n" + t(`Errors: a reference past its table (a unit's weapon, flingy, sprite or image), a string past its string table, an
image with no GRP, an image whose iscript entry is missing, a button set or requirement for something that is not
there. Warnings: a weapon or iscript entry the mod added that nothing uses, a sound row with no file, two tables in
different extended layouts, units with the same name. What the mod leaves as the game had it is not judged.
Exits 1 when there is an error.`))
    .action(async (paths: string[], o: { json?: boolean; all?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      await eachMod(paths, !!o.json, async (path) => {
        const r = await checkModSource(await openMod(path, base), base);
        if (r.failed) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
        return { data: r, lines: printModCheck(r, { all: !!o.all }) };
      });
    });

  modCmd.command("diff").description(t("what changed between two mods, or what one changes in the game, as a changelog")).argument("<a>").argument("[b]", t("the other mod; with none, the game against <a>")).addOption(json)
    .option("--all", t("list every change; by default each kind is cut at 30"))
    .addOption(starcraftOption())
    .action(async (a: string, b: string | undefined, o: { json?: boolean; all?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const r = await diffModSources(await openMod(a, base), b ? await openMod(b, base) : null, base);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printModDiff(r, { all: !!o.all })));
    });

  modCmd.command("new").description(t("an empty mod folder: mod.json and a README")).argument("<folder>").addOption(json)
    .option("--name <name>", t("the mod's name (the folder's by default)"))
    .action(async (dir: string, o: { json?: boolean; name?: string }) => {
      const r = await newMod(dir, o.name);
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(`${mark.ok} ${t("{name}: {files} in {folder}", { name: pc.bold(r.name), files: r.files.join(", "), folder: pc.cyan(relative(process.cwd(), r.dir) || ".") })}`, pc.dim(`  ${t("Put the game's files you change under files/ at their paths, or start from a mod: scmjs mod unpack <mod> {folder}", { folder: dir })}`));
    });

  modCmd.command("build").description(t("check the folder, then pack it; a check error stops it")).argument("<folder>").addOption(json)
    .option("-o, --out <file>", t("the MPQ to write (<folder>.mpq beside the folder by default)"))
    .option("--folder <out>", t("write the files loose in the game's paths instead"))
    .option("--compression <method>", t("{methods} for every file", { methods: MOD_COMPRESSIONS.join(", ") }), "zlib")
    .option("--force", t("pack even when the check finds errors"))
    .addOption(starcraftOption())
    .action(async (dir: string, o: { json?: boolean; out?: string; folder?: string; compression: string; force?: boolean; starcraft?: string }) => {
      if (!(MOD_COMPRESSIONS as readonly string[]).includes(o.compression)) throw new CliError(t("--compression takes {methods}, not \"{value}\"", { methods: MOD_COMPRESSIONS.join(", "), value: o.compression }), null, 2);
      const base = await gameFilesOrNull(o.starcraft);
      await readModFolder(dir);
      const check = await checkModSource(await openMod(dir, base), base);
      if (check.failed && !o.force) {
        if (o.json) print(JSON.stringify({ check, packed: null }, null, 2)); else print(...printModCheck(check), "", `${mark.error} ${t("Not packed: the check found {n, plural, one {# error} other {# errors}}", { n: check.errors })} ${pc.dim(t("(--force packs anyway)"))}`);
        process.exitCode = 1;
        return;
      }
      const packed = await packModFolder(dir, { out: o.out, folder: o.folder, compression: o.compression as ModCompression, starcraft: o.starcraft });
      if (o.json) { print(JSON.stringify({ check, packed }, null, 2)); return; }
      print(...printModCheck(check), ...printPacked(packed));
    });

  modCmd.command("play").description(t("play the mod on the play page in your browser")).argument("<mod>", t("a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).addOption(json)
    .option("--map <file>", t("start this map with the mod (otherwise the page offers its maps)"))
    .option("--bot <bot>", t("a bot for the other side: a .scmbot file, or a bot of the play page by its key (cosmonarchy-example, mcrave, ualbertabot, example)"))
    .option("--race <race>", t("the bot's race: zerg, terran, protoss or random, or a race the mod's mod.json declares, by its name or number"))
    .option("--start", t("with --bot, start the game at once instead of showing the setup screen"))
    .addOption(starcraftOption())
    .addOption(new Option("--play <url>", t("the play page's address (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`Opens scmjs.dev/play in your browser and hands it every file of the mod, its plugins and FireGraft files with them,
and the mod's hash, which the page works out again from the same files. The page keeps the files that differ from
your copy of the game. Nothing is uploaded: the page keeps the mod in your browser. A mod with plugins or a
FireGraft project is opened with ?lift=live, where they run. Waits up to five minutes for the page.`) + "\n\n" + t(`With --bot the map is on the setup screen with the bot in the row beside yours, saying whether it was made for the mod
(scmjs mod header --bot), plays vanilla data, or was made for another; press Start Game, or give --start. A mod with
plugins plays the map with its own settings, as the runners do. A bot of the play page needs a scmjs.dev account (the
page asks you to sign in); your own .scmbot file does not, and the page keeps it as Options → Add a bot from a file…
does.`))
    .action(async (path: string, o: { json?: boolean; map?: string; bot?: string; race?: string; start?: boolean; starcraft?: string; play?: string }) => {
      if (o.bot && !o.map) throw new CliError(t("--bot needs --map: the bot plays on a map."), null, 2);
      if (o.race && !o.bot) throw new CliError(t("--race is the bot's: use it with --bot."), null, 2);
      const bot = o.bot ? playBotOf(o.bot) : null;
      const base = await gameFilesOrNull(o.starcraft);
      const source = await openMod(path, base);
      // (A race the mod declares in its mod.json is taken by its name or number.)
      const botRace = o.race ? pageRace(o.race, source.races) : undefined;
      const set = await playSet(source);
      const map = o.map ? await readInput(o.map) : null;
      if (map) expectKind(map, "map");
      if (!o.json) print(`${pc.bold(set.name)}: ${t("{n, plural, one {# file} other {# files}} to hand over", { n: set.total.files })}${set.plugins + set.firegraft ? pc.dim(` ${t("(and {n, plural, one {# plugin or FireGraft file} other {# plugins and FireGraft files}})", { n: set.plugins + set.firegraft })}`) : ""}${dot}${size(set.total.bytes)}${dot}${pc.dim(t("hash {hash}", { hash: set.hash }))}`);
      const r = await playOnPage(set, { map: map && { name: map.name, bytes: map.bytes }, bot, botRace, start: o.start, play: o.play, live: o.json ? undefined : (line) => print(line) });
      if (o.json) { print(JSON.stringify({ name: set.name, hash: set.hash, withoutPlugins: set.withoutPlugins, files: set.files.map((f) => ({ path: f.path, bytes: f.bytes.length })), ...r }, null, 2)); }
      else if (r.error) throw new CliError(t("The play page said: {error}", { error: r.error }), null, 1);
      else print(`${mark.ok} ${r.shown ? (r.bot ? t("On the play page's setup screen: press Start Game") : t("On the play page's setup screen")) : t("Playing on the play page")}`, ...(r.bot ? rows([[t("Bot"), r.bot]]) : []));
      if (r.error) process.exitCode = 1;
    });

  modCmd.command("header").description(t("the mod's units, weapons, upgrades and techs by name, for a bot made for it (C++ and JSON)")).argument("<mod>", t("a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).addOption(json)
    .option("-o, --out <folder>", t("where the files go (the working folder by default)"))
    .option("--namespace <name>", t("the C++ namespace, and the files' name (the mod's name made an identifier by default)"))
    .option("--bot", t("--out is a bot's folder: its scmbot.json gains the mod, which the bot file then carries"))
    .addOption(starcraftOption())
    .addHelpText("after", "\n" + t(`Writes <Mod>.h, C++ for a BWAPI bot built with scmbot (Cosmonarchy_BW::UnitTypes::Terran_Mason is a
BWAPI::UnitType, Ids::Units::Terran_Mason the number), and <Mod>.ids.json, the same for other languages. Every name
in the mod's tables is there, as the editor shows it. Both carry the mod's name and hash; with --bot, scmbot build
writes them into the .scmbot file, and the runners say whether the game is the mod the bot was made for.`))
    .action(async (path: string, o: { json?: boolean; out?: string; namespace?: string; bot?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const r = await writeModHeader(await openMod(path, base), base, { out: o.out, namespace: o.namespace, bot: o.bot });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(`${mark.ok} ${pc.bold(r.mod.name)}: ${t("{units} units, {weapons} weapons, {upgrades} upgrades, {techs} techs named", { units: num(r.counts.units), weapons: num(r.counts.weapons), upgrades: num(r.counts.upgrades), techs: num(r.counts.techs) })}${dot}${pc.dim(t("hash {hash}", { hash: r.mod.hash }))}`,
        ...rows([
          [t("Header"), pc.cyan(shownPath(r.files.header))],
          [t("Ids"), pc.cyan(shownPath(r.files.ids))],
          [t("Bot"), r.files.scmbot ? t("{file} now names the mod: build the bot again", { file: shownPath(r.files.scmbot) }) : null],
          [t("From the game"), r.fromGame.length ? t("the names of {list}: the mod has not got them", { list: r.fromGame.join(", ") }) : null],
        ]));
    });

  modCmd.command("test").description(t("map test with the mod laid over the game")).argument("<mod>").argument("<map>").argument("[tests...]", t("tests files (JSON); <map>.tests.json beside the map by default")).addOption(json)
    .option("--format <kind>", `${FORMATS.join(", ")}`, "text")
    .option("-o, --out <folder>", t("where the replays of failing scenarios go (<map>.tests/ beside the map)"))
    .option("--frames <n>", t("frames a scenario runs when it does not say (24 a second)"), "2400")
    .option("--seed <n>", t("the game's seed when a scenario does not say"), "1")
    .option("-u, --update", t("a scenario driven by a replay: write what the game gives now into the expectations that no longer hold"))
    .addOption(starcraftOption())
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`The same as scmjs map test <map> --mod <mod>: each scenario played in the game with the mod's files over the game's.
Needs a game engine whose runners take a mod.`))
    .action(async (path: string, file: string, tests: string[], o: Parameters<typeof mapTestAction>[2]) => mapTestAction(file, tests, { ...o, mod: path }));

  const plugin = program.command("plugin").description(t("start, check and run a plugin for the editor")).helpGroup(t("Plugins and bots:"));
  plugin.command("new").description(t("a plugin to start from, in a new folder")).argument("[name]", t("the plugin's name, such as \"Base Check\""))
    .option("--dir <folder>", t("the folder to write it in (default plugin-<id>)"))
    .action((name: string | undefined, o: { dir?: string }) => {
      const made = newPlugin({ name, dir: o.dir });
      const rel = relative(process.cwd(), made.dir) || ".";
      print(`${mark.ok} ${t("{name} written in {folder}", { name: pc.bold(name ?? rel), folder: pc.cyan(rel) })}${dot}${t("{n, plural, one {# file} other {# files}}", { n: made.files.length })}`, "",
        pc.dim(`  ${t("Next:")}`), `    cd ${rel.includes(" ") ? JSON.stringify(rel) : rel}`, "    npm install", `    npm start            ${pc.dim(t("the editor with your plugin, reloaded each time you save"))}`, "",
        pc.dim(`  ${t("plugin.ts is the plugin; plugin.json describes it. Guide: {url}", { url: "https://docs.scmjs.dev/plugins/" })}`));
    });
  plugin.command("check").description(t("what the editor would make of the plugin"))
    .argument("[folder]", t("the plugin's folder"), ".").addOption(json)
    .option("--all", t("list notes too, not only errors and warnings"))
    .option("--strict", t("fail on warnings as well as errors"))
    .addHelpText("after", "\n" + t("Exits 1 when the editor would not load it (or on warnings, with --strict): fit for a CI step."))
    .action((folder: string, o: { json?: boolean; all?: boolean; strict?: boolean }) => {
      const c: PluginCheck = checkPlugin(folder);
      if (c.issues.some((i) => i.level === "error" || (o.strict && i.level === "warn"))) process.exitCode = 1;
      print(...(o.json ? [JSON.stringify(c, null, 2)] : printPluginCheck(c, !!o.all)));
    });
  plugin.command("dev").description(t("the editor with your plugin, reloaded on every save"))
    .argument("[folder]", t("the plugin's folder"), ".")
    .option("--port <port>", t("the port to serve it on; the editor remembers the plugin by it"), "5310")
    .option("--no-open", t("do not open the editor; print its address instead"))
    .addOption(new Option("--editor <url>", t("the editor's address (SCMJS_EDITOR_URL), such as a local one")).hideHelp())
    .addHelpText("after", "\n" + t("Builds it first when plugin.json names a \"build\" and package.json has a build script."))
    .action(async (folder: string, o: { port: string; open: boolean; editor?: string }) => {
      const port = Number(o.port);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError(t("--port {value} is not a port", { value: o.port }), null, 2);
      await devPlugin({ dir: folder, port, open: o.open, editor: o.editor });
    });

  const bot = program.command("bot").description(t("build a BWAPI bot, play it, run a ladder")).helpGroup(t("Plugins and bots:"))
    .addHelpText("after", () => "\n" + t(`new, init, build and update run in your bot's folder; the toolchain is a Docker image, downloaded the
first time. A built bot is added on the play page: Options → Community bots → Add a bot from a file…
run and ladder play it here, with your copy of StarCraft and the play page's engine.`) + `

${pc.dim(t("Guide: {url}", { url: BOT_GUIDE }))}`);
  bot.command("new").description(t("a bot to start from, in this folder"))
    .action(async () => { await runBot(["new"]); });
  bot.command("init").description(t("scmbot.json from the bot's Visual Studio project")).argument("[project]", t("the .vcxproj, when the folder has several"))
    .action(async (project?: string) => { await runBot(project ? ["init", project] : ["init"]); });
  bot.command("build").description(t("out/<key>.scmbot, to add on the play page"))
    .addHelpText("after", "\n" + t("Needs Docker: the toolchain is a Docker image, downloaded the first time. scmjs mod play --bot hands the file to the play page."))
    .action(async () => { await runBot(["build"]); });
  bot.command("update").description(t("the newest toolchain, the one the play page expects"))
    .action(async () => { await updateBot(); });
  bot.command("run").description(t("play the bot against the game's computers on a map, with no page")).argument("<bot>", t("a .scmbot file")).argument("<map>").addOption(json)
    .option("--race <race>", t("the bot's race: zerg, terran, protoss or random"), "random")
    .option("--opponents <races>", t("the game's computers, a race each (zerg,terran)"), "zerg")
    .option("--seed <n>", t("the game's seed; the same seed, bot and map give the same game"))
    .option("--frames <n>", t("stop after this many frames when nobody has won (24 a second)"), "50000")
    .option("--every <n>", t("frames between progress lines; 0 for none"), "1000")
    .option("--data <folder>", t("a folder the bot keeps its files in between games"))
    .option("--mod <mod>", t("play a mod: its files, its plugins and its FireGraft project (a mod folder, an .mpq, a mod's .exe or .zip, or the release as its makers ship it)"))
    .option("--ums", t("play the map with its own settings (the default for a mod with plugins)"))
    .option("--melee", t("play a melee game even on a mod with plugins"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`The game is the play page's engine, fetched once (about 25 MB) and kept; the game's own files come from your copy
of StarCraft, Remastered or 1.16.1. Prints what the bot says and each side's purse and supply as it plays, then who
won. Exits 1 when the bot printed errors, 2 when the game could not start.`) + "\n\n" + t(`With --mod the mod's plugins run beside the bot, and the first lines say whether the bot was made for the mod
(scmjs mod header --bot), plays vanilla data, or was made for another mod, which plays all the same.`) + "\n" + t(`--mod needs a play page whose engine runs a mod's code ("mods": 2 in its engine/current.json); with an older one
the command stops and says which version it needs.`))
    .action(async (botFile: string, map: string, o: { json?: boolean; race: string; opponents: string; seed?: string; frames: string; every: string; data?: string; mod?: string; ums?: boolean; melee?: boolean; starcraft?: string; engine?: string }) => {
      if (o.ums && o.melee) throw new CliError(t("--ums and --melee: one kind of game"), null, 2);
      const overlay = o.mod ? modOverlay(o.mod, () => gameFilesOrNull(o.starcraft), { code: true }) : null;
      let r;
      try {
        r = await runBotGame(botFile, map, {
          race: o.race, opponents: o.opponents.split(",").map((s) => s.trim()).filter(Boolean), seed: o.seed === undefined ? undefined : Number(o.seed), frames: Number(o.frames), every: Number(o.every),
          data: o.data, starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line),
          mod: overlay, game: o.ums ? "ums" : o.melee ? "melee" : undefined,
        });
      } finally { overlay?.remove(); }
      if (o.json) print(JSON.stringify({ bot: botFile, map, ...r }, null, 2));
      if (r.exitCode) process.exitCode = r.exitCode;
    });

  bot.command("ladder").description(t("a round robin of bots and the game's computer over maps: a table, Elo and every replay"))
    .argument("<bots...>", t("bots (.scmbot files) and computer; a race after a colon: mybot.scmbot:p, computer:t")).addOption(json)
    .requiredOption("--maps <maps...>", t("the maps to play on"))
    .option("--races <letters>", t("the races a side plays when it has none of its own: z, t, p and r (random)"), "r")
    .option("--games <n>", t("games of each pairing on each map, in each race, a seed each (1, 2, 3, …)"), "1")
    .option("--seeds <list>", t("the seeds to play, comma separated, in place of --games"))
    .option("--frames <n>", t("stop a game nobody has won after this many frames (24 a second)"), "50000")
    .option("-o, --out <folder>", t("where the replays and ladder.json go (default: ladder-<date>-<time> here)"))
    .option("--data <folder>", t("where each bot keeps its files between games (default: the ladder's folder)"))
    .option("--parallel <n>", t("games played at once"), "1")
    .option("--timeout <seconds>", t("how long a bot may think over one frame before it counts as hung (the first frame: 5 minutes at least)"), "60")
    .option("--mod <mod>", t("play a mod: its files, its plugins and its FireGraft project (a mod folder, an .mpq, a mod's .exe or .zip, or the release as its makers ship it)"))
    .option("--ums", t("play the map with its own settings (the default for a mod with plugins)"))
    .option("--melee", t("play a melee game even on a mod with plugins"))
    .option("--starcraft <folder>", t("your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise"))
    .addOption(new Option("--engine <where>", t("the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)")).hideHelp())
    .addHelpText("after", "\n" + t(`Every pairing plays on every map: a bot against the computer once a seed, two bots both ways round (who is first in
the lobby). Two bots are two copies of the game, one a bot, kept in step on this computer. A line as each game ends,
then the standing with Elo, each bot's time a frame, and the head-to-head. Each game's replay is saved in the
ladder's folder for scmjs replay watch. Exits 1 when a game could not be played or a bot's copy failed.`) + `

  scmjs bot ladder out/mybot.scmbot:p computer --maps "(2)Boxer.scm" --races tzp --games 3
  scmjs bot ladder a.scmbot b.scmbot c.scmbot --maps maps/*.scx --frames 30000
  scmjs bot ladder cosmo.scmbot:t other.scmbot:t --maps "(4)Exodus 1.0.scx" --mod "Cosmonarchy BW"` + "\n\n" + t(`--mod needs a play page whose engine runs a mod's code ("mods": 2 in its engine/current.json); with an older one
the command stops and says which version it needs.`))
    .action(async (specs: string[], o: { json?: boolean; maps: string[]; races: string; games: string; seeds?: string; frames: string; out?: string; data?: string; parallel: string; timeout: string; mod?: string; ums?: boolean; melee?: boolean; starcraft?: string; engine?: string }) => {
      if (o.ums && o.melee) throw new CliError(t("--ums and --melee: one kind of game"), null, 2);
      const races = parseRaces(o.races);
      const count = (v: string, name: string, least = 1) => { const n = Number(v); if (!Number.isInteger(n) || n < least) throw new CliError(t("--{flag} {value} is not a whole number of {least} or more", { flag: name, value: v, least }), null, 2); return n; };
      const games = count(o.games, "games");
      const seeds = o.seeds ? o.seeds.split(",").map((x) => x.trim()).filter(Boolean).map((x) => count(x, "seeds", 0)) : Array.from({ length: games }, (_, k) => k + 1);
      const entrants = parseEntrants(specs, races);
      const say = (l: string) => (o.json ? process.stderr.write(l + "\n") : print(l));
      // A map in the original 1.00 form is played as Brood War (as map trace does), so that its replays play back.
      const play = new Map<string, string>();
      for (const m of o.maps) {
        const { input, doc } = await openForEdit(m);
        const game = await gameMap(doc, input.path, input.name);
        if (game.path !== m) play.set(m, game.path);
        if (game.converted) say(pc.dim(t("{name} is an original StarCraft map: it is played converted to Brood War.", { name: input.name })));
      }
      let r;
      const overlay = o.mod ? modOverlay(o.mod, () => gameFilesOrNull(o.starcraft), { code: true }) : null;
      try {
        r = await runLadder(entrants, {
          maps: o.maps, play, races, seeds, frames: count(o.frames, "frames"), out: o.out, data: o.data, parallel: count(o.parallel, "parallel"), timeout: count(o.timeout, "timeout"),
          starcraft: o.starcraft, engine: o.engine, live: say, mod: overlay, game: o.ums ? "ums" : o.melee ? "melee" : undefined,
        });
      } finally { for (const p of play.values()) removeGameMap(p); overlay?.remove(); }
      if (o.json) print(JSON.stringify(ladderJson(r), null, 2));
      else printLadder(r);
      if (r.results.some((x) => !x.end || x.end.by === "desync" || x.end.bots.some((b) => b.state === "crashed" || b.state === "failed"))) process.exitCode = 1;
    });

  // A scmjs.dev account. Hidden from the overview, which is held to 23 lines: `map share` (under `map …`) and the
  // doctor's scmjs.dev row say `scmjs login`, and `scmjs help account` lists it all.
  const signIn = async (o: { provider?: string }) => {
    const r = await login({ provider: o.provider, say: (page, provider) => print(`${mark.info} ${t("Signing in with {provider} in your browser", { provider })}`, pc.dim(`  ${t("If nothing opens, go to {page}", { page })}`)) });
    print(`${mark.ok} ${t("Signed in to {server} as {name}", { server: serverLabel(r.server), name: pc.bold(r.account.name ?? t("(no name)")) })}`, pc.dim(`  ${t("The session is kept in {file}; scmjs logout ends it.", { file: r.file })}`));
  };
  const signOut = async () => {
    const r = await logout();
    if (!r.was) { print(`${mark.info} ${t("Not signed in")}`); return; }
    print(`${mark.ok} ${r.was.name ? t("Signed out of {server} ({name})", { server: serverLabel(r.was.server), name: r.was.name }) : t("Signed out of {server}", { server: serverLabel(r.was.server) })}`, r.told ? null : pc.dim(`  ${t("The server could not be reached to end the session there; {file} is deleted.", { file: r.file })}`));
  };
  const providerOption = () => new Option("--provider <name>", t("the sign-in to use: {list}", { list: PROVIDERS.join(", ") })).default("discord");
  const account = program.command("account").description(t("sign in to scmjs.dev, see your account, sign out")).helpGroup(t("This tool:"))
    .addHelpText("after", "\n" + t(`The sign-in opens Discord in your browser, as the editor's does (--provider google or battlenet for the others). The
session is kept in your configuration folder (~/.config/scmjs/session.json; SCMJS_SESSION names another file), and
scmjs logout ends it. scmjs login and scmjs logout are the same as account login and account logout.`));
  account.command("show", { isDefault: true }).description(t("who you are, the storage you use and the maps you are sharing")).addOption(json)
    .addOption(new Option("--qr", t("each shared map's link as a QR code too, for a phone")))
    .action(async (o: { json?: boolean; qr?: boolean }) => {
      const r = await accountReport();
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printAccount(r, undefined, { qr: o.qr })));
    });
  account.command("login").description(t("sign in to scmjs.dev in your browser")).addOption(providerOption()).action(signIn);
  account.command("logout").description(t("end the session and delete its file")).action(signOut);
  program.command("login", { hidden: true }).description(t("sign in to scmjs.dev in your browser (scmjs account login)")).addOption(providerOption()).action(signIn);
  program.command("logout", { hidden: true }).description(t("sign out of scmjs.dev (scmjs account logout)")).action(signOut);

  program.command("completion", { hidden: true }).description(t("a completion script for your shell")).argument("<shell>", SHELLS.join("|"))
    .addHelpText("after", `
  eval "$(scmjs completion bash)"                        # ${t("in ~/.bashrc")}
  scmjs completion zsh > ~/.zsh/completions/_scmjs       # ${t("a folder on $fpath")}
  scmjs completion fish > ~/.config/fish/completions/scmjs.fish`)
    .action((shell: string) => {
      if (!(SHELLS as readonly string[]).includes(shell)) throw new CliError(t("{shell} is not a shell this knows", { shell }), t("One of {list}.", { list: SHELLS.join(", ") }), 2);
      process.stdout.write(completionScript(program, shell as Shell));
    });

  // Hidden from the overview, which holds 23 lines (banner.ts); `scmjs help init`, `map --help` and docs/cli.md name it.
  program.command("init").description(t("set a folder of maps up for git and GitHub")).helpGroup(t("Maps and replays:"))
    .argument("[folder]", t("the folder the maps are in"), ".").addOption(json)
    .option("--print", t("print what would be written, to paste by hand, and write nothing"))
    .option("--git", t("git init the folder when it is in no git repository (never done without it)"))
    .option("--force", t("replace a README.md or workflow that is there, and set a git setting that holds another value"))
    .addHelpText("after", "\n" + t(`Writes what is not there yet:
  .gitattributes              *.scx, *.scm and *.chk read through scmjs map dump by git diff
  .gitignore                  *.bak, the copy the desktop app's Save keeps
  .github/workflows/maps.yml  map check on every push and pull request (and map build --check for maps with a
                              TrigScript script), with this version of scmjs pinned
  README.md                   the maps, and the commands to check, dump and diff them
and, in the git repository, git config diff.scmjs.textconv, .xfuncname and .cachetextconv, which are per clone.
.gitattributes and .gitignore get only the lines they lack; nothing else that is there is changed without --force.
Exits 2 when there is no such folder.`))
    .action(async (folder: string, o: { json?: boolean; print?: boolean; git?: boolean; force?: boolean }) => {
      const r = await initFolder(folder, { print: !!o.print, git: !!o.git, force: !!o.force });
      if (o.json) print(JSON.stringify({ ...r, files: r.files.map(({ content, ...f }) => (o.print ? { ...f, content } : f)) }, null, 2));
      else if (o.print) process.stdout.write(printRecipe(r));
      else print(...printInit(r));
    });
  map.addHelpText("after", "\n" + t(`scmjs init [folder] sets a folder of maps up for git and GitHub: git diff shows a map's changes as text, a workflow
checks the maps on every push, and a README lists them (scmjs help init).`));

  program.command("doctor").description(t("what this computer has for each command")).helpGroup(t("This tool:")).addOption(json)
    .addHelpText("after", "\n" + t(`TypeScript (map build, a .ts plugin), Docker (bot new|build), a copy of StarCraft and the game engine's runners (bot
run, replay watch, map trace|cost), the desktop app (map open), whether Claude Code has scmjs mcp, and whether npm has
a newer scmjs; then the commands this computer can run now. Nothing is changed. Exits 1 only when Node is too old.`))
    .action(async (o: { json?: boolean }) => {
      const r = await doctorReport();
      print(...(o.json ? [JSON.stringify(doctorJson(r), null, 2)] : printDoctor(r)));
      if (r.blocked) process.exitCode = 1;
    });

  program.command("mcp").description(t("these commands as an MCP server, for AI tools")).helpGroup(t("This tool:"))
    .addHelpText("after", "\n" + t(`Speaks the Model Context Protocol on standard input and output, so an AI tool that runs on this computer (Claude
Code, Cursor, VS Code, …) can read, check, search, compare and change maps with the same code these commands use:
map_info, map_check, map_dump, map_find, map_diff, map_triggers_export|import, map_strings_export|import|prune,
map_set, map_resize, map_new, map_build, map_run, map_preview (the picture itself), map_analyze, map_trace, map_cost,
replay_info, replay_map, mod_info, mod_check, mod_diff, mod_unpack, mod_pack, mod_new and doctor. map_preview,
map_analyze, map_trace and map_cost need a copy of StarCraft here, as the commands do; doctor says whether there is
one. Paths are files on this
computer, relative to the folder the tool started it in. Claude Code, in your maps folder:`) + `
  claude mcp add scmjs -- npx -y @scm-js/cli mcp
${t("Anything else takes the same thing as JSON:")}
  { "mcpServers": { "scmjs": { "command": "npx", "args": ["-y", "@scm-js/cli", "mcp"] } } }`)
    // English whatever the language: the tools' descriptions and results are read by the model, not shown.
    .action(async () => { setLocale("en"); await serveStdio(); });

  // Hidden from the overview, which holds 23 lines (banner.ts): an editor starts it, and docs/cli.md says how.
  program.command("lsp", { hidden: true }).description(t("a TrigScript language server, for text editors")).helpGroup(t("This tool:"))
    .option("--map <map>", t("the map that names a script outside an unpacked map: a map file, or a folder map unpack wrote"))
    .option("--stdio", t("speak on standard input and output (the default; editors pass it)"))
    .addHelpText("after", "\n" + t(`Speaks the Language Server Protocol on standard input and output, so VS Code, Neovim, Helix, Zed or any editor
with an LSP client shows a TrigScript script's errors as map build would find them, completes the map's locations,
units and switches, and goes to a definition in the standard library or a library. A script is the trigscript/
folder of a map scmjs map unpack wrote; the map's names come from the scenario beside it. docs.scmjs.dev/cli has
the setup for each editor. Needs TypeScript, as map build does.`))
    // English whatever the language, as the TrigScript compiler's diagnostics it carries are.
    .action(async (o: { map?: string }) => { setLocale("en"); await serveLsp({ map: o.map }); });

  // Hidden from the overview, which holds 23 lines (banner.ts): the mod noun took its line.
  program.command("about", { hidden: true }).description(t("this version, any newer one, and links")).helpGroup(t("This tool:")).addOption(json)
    .action(async (o: { json?: boolean }) => {
      const r = await aboutReport();
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printAbout(r)));
    });
  return program;
}

// The language is fixed before the program is built, from the arguments and the environment (cli/src/i18n.ts). Tests
// build theirs in English unless they set one.
if (!process.env.VITEST) setLocale(chooseLocale(process.argv.slice(2)));
export const program = buildProgram();

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

/** Runs the command line on `process.argv`. Not a top-level await: the single executable's bundle is CommonJS. */
async function run() {
  try {
    // `scmjs` on its own is a request for the overview, not a mistake.
    if (process.argv.length <= 2) program.outputHelp();
    else await program.parseAsync();
  } catch (e) {
    if (e instanceof CliError) { fail(e); process.exitCode = e.exitCode; }
    else { process.stderr.write(`${mark.error} ${pc.red(t("Something went wrong"))}: ${e instanceof Error ? e.stack ?? e.message : e}\n${pc.dim(`  ${t("Please report it: {url}", { url: "https://github.com/scm-js/scm-js/issues" })}`)}\n`); process.exitCode = 1; }
  }
}

// tests/cli.test.ts imports the program to read its help; only the command runs it.
if (!process.env.VITEST) void run();
