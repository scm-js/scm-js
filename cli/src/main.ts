/**
 * scmjs: StarCraft: Brood War maps, replays and bots from the command line. One command, a noun for each kind of
 * thing (`map`, `replay`, `plugin`, `bot`), the editor's own code underneath (docs/cli.md, .claude/internals/cli.md).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { Command, Help, Option } from "commander";
import { aboutReport, printAbout, VERSION } from "./about";
import { listMembers, MANIFEST_FILE, packMap, unpackMap } from "./archive";
import { rootHelp } from "./banner";
import { BOT_GUIDE, runBot, updateBot } from "./bot";
import { runBotGame } from "./botrun";
import { costReport, gameMap, printCost, printTrace, runMapInGame, traceReport } from "./trace";
import { printRush, runRush, rushJson, unitByName } from "./rush";
import { buildMap, loadTypeScript, printBuild } from "./build";
import { completionScript, SHELLS, type Shell } from "./completion";
import { LAYOUTS, nameFromFile, NEW_VERSIONS, parseSize, parseTileset, writeNewMap, type NewMapVersion } from "./create";
import { doctorJson, doctorReport, printDoctor } from "./doctor";
import { initFolder, printInit, printRecipe } from "./init";
import { diffMaps, printDiff, revisionInput } from "./diff";
import { diffPicture } from "./diffpicture";
import { dumpMap, printDump } from "./dump";
import { ANCHORS, parseAnchor, pruneStrings, resizeMap, setHeader, VERSIONS, ENCODINGS } from "./edit";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack } from "./exchange";
import { expectKind, loadMapInput, loadReplayInput, readInput, STDIO, toStdout, type Input } from "./files";
import { findInMap, KINDS, parseKinds, printHits } from "./find";
import { DEFAULT_LIMIT, fetchJson, fetchMap, mapIdFrom, MAX_LIMIT, parseLimit, printFetched, printSearch, searchJson, searchMaps } from "./fetch";
import { issueLine, mapReport, printIssues, printMapInfo, type MapReport } from "./map";
import { serveStdio } from "./mcp";
import { openInScmjs, playInLobby } from "./open";
import { checkPlugin, devPlugin, newPlugin, printPluginCheck, type PluginCheck } from "./plugin";
import { printReplayInfo, replayReport } from "./replay";
import { SCMSCX, scmscx } from "./scmscx";
import { mapFileFor, writeReplayMap } from "./replaymap";
import { printReplayShare, shareReplay } from "./replayshare";
import { parseClock, watchReplay, watchSummary } from "./watch";
import { FORMATS, githubAnnotations, junitXml, sarifJson, type CheckReport, type Format } from "./report";
import { printRun, runOnMap } from "./run";
import { previewMap, PNG_SCALES } from "./preview";
import { accountReport, login, logout, PROVIDERS, printAccount, serverLabel } from "./account";
import { printShare, shareMap } from "./share";
import { CliError, dot, gameText, mark, num, pc, plural, print, rows, size, table } from "./ui";

const json = new Option("--json", "print JSON instead of text, for scripts");
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
  const data = mapReport(input, await loadMapInput(input));
  return { data, lines: printMapInfo(data) };
}
async function replayInfo(input: Input) {
  expectKind(input, "replay");
  const data = replayReport(input, await loadReplayInput(input));
  return { data, lines: printReplayInfo(data) };
}
/** A bot file's header (the scm-sim toolchain's `.scmbot`). */
async function botInfo(input: Input) {
  const n = new DataView(input.bytes.buffer, input.bytes.byteOffset).getUint32(8, true);
  const h = JSON.parse(new TextDecoder().decode(input.bytes.subarray(12, 12 + n))) as Record<string, unknown>;
  const data = { file: { name: input.name, bytes: input.bytes.length }, key: h.key, name: h.name, source: h.source, commit: h.commit, memoryMB: Number(h.memoryPages) / 16, toolchain: h.toolchain, license: String(h.license ?? "").split("\n").find((l) => l.trim())?.trim() ?? "" };
  return { data, lines: [
    pc.bold(String(data.name)), pc.dim("A BWAPI bot for scm-sim's play page"), "",
    ...rows([["Key", String(data.key)], ["Source", data.source ? `${data.source}${data.commit ? pc.dim(` @ ${String(data.commit).slice(0, 7)}`) : ""}` : null], ["Licence", data.license || null], ["Memory", `${data.memoryMB} MB`], ["Built by", String(data.toolchain)], ["File", `${input.name}${dot}${size(input.bytes.length)}`]]),
  ] };
}

// Output piped into something that stops reading (`| head`): stop quietly, as other commands do, not with a stack.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(process.exitCode ?? 0); else throw e; });
}

export const program = new Command("scmjs")
  .description("StarCraft: Brood War maps, replays, plugins and bots from the command line")
  .version(VERSION, "-v, --version", "print the version")
  .helpOption("-h, --help", "show help for a command")
  .addOption(new Option("--no-color", "plain text, no colour (also NO_COLOR=1)"))
  .showSuggestionAfterError()
  .commandsGroup("This tool:")
  .configureOutput({ outputError: (text, write) => write(text.replace(/^error: /, `${mark.error} `)) })
  .showHelpAfterError(pc.dim("(scmjs --help lists the commands)"))
  .configureHelp({
    styleTitle: (s) => pc.bold(s),
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
      for (const [i, sub] of subs.entries()) {
        const next = `${term}${i ? "|" : " "}${sub}`;
        // The last verb too: a term past the width widens the column and wraps every description.
        if (next.length > TERM_WIDTH - 2 && i > 0) return `${term}|…`;
        term = next;
      }
      return term;
    },
    // The overview has the banner (banner.ts); a command's own help is commander's.
    formatHelp: (cmd, helper) => (cmd.parent ? Help.prototype.formatHelp.call(helper, cmd, helper) : rootHelp(cmd, helper, VERSION)),
  });

// `scmjs help map` works, but the row is not in the overview: `-h, --help` is on the same screen, and the 23 lines
// (a 24-row terminal keeps the globe on screen) go to the commands.
const helpCommand = program.createCommand("help").argument("[command]").description("show help for a command");
(helpCommand as unknown as { _hidden: boolean })._hidden = true;
program.addHelpCommand(helpCommand);

program.command("info").description("what a map, replay or bot file holds").helpGroup("Maps and replays:").argument("<files...>", "maps (.scm .scx .chk), replays (.rep) or bots (.scmbot)").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, async (input) => {
    const kind = expectKind(input, "map", "replay", "bot");
    return kind === "map" ? mapInfo(input) : kind === "replay" ? replayInfo(input) : botInfo(input);
  }));

const map = program.command("map").description("read, check and open maps").helpGroup("Maps and replays:");
map.command("info").description("a map's size, players, units, triggers and its check").argument("<maps...>").addOption(json)
  .option("--table", "one row per map, for a folder of them")
  .action(async (files: string[], o: { json?: boolean; table?: boolean }) => {
    if (!o.table || o.json) { await eachFile(files, !!o.json, mapInfo); return; }
    const reports = (await eachFile(files, true, mapInfo, true, true)).filter((r): r is MapReport => !!r && !("error" in (r as object)));
    if (!reports.length) return;
    print(...table([
      ["File", "Name", "Size", "Tileset", "Version", "Players", "Units", "Triggers", "Check"].map((h) => pc.dim(h)),
      ...reports.map((r) => [r.file.name, gameText(r.name) || pc.italic("Untitled"), `${r.width} × ${r.height}`, r.tileset, r.version, String(r.usedSlots.length), num(r.statistics.units.total), num(r.statistics.triggers.count), issueLine(r.issues)]),
    ], 0));
  });
map.command("check").description("Check Map, as the editor's: errors, then warnings")
  .argument("<maps...>").addOption(json)
  .option("--all", "list notes too, not only errors and warnings")
  .option("--strict", "fail on warnings as well as errors")
  .option("--format <kind>", `${FORMATS.join(", ")}: github is workflow annotations, junit and sarif the files CI tools read`, "text")
  .addHelpText("after", `
Exits 1 when a map has errors (or warnings, with --strict): fit for a CI step. In a GitHub workflow,
  - run: npx @scm-js/cli map check maps/*.scx --strict --format github
puts each finding on the pull request itself.`)
  .action(async (files: string[], o: { json?: boolean; all?: boolean; strict?: boolean; format: string }) => {
    if (!(FORMATS as readonly string[]).includes(o.format)) throw new CliError(`--format takes ${FORMATS.join(", ")}, not "${o.format}"`, null, 2);
    const format: Format = o.json ? "json" : (o.format as Format);
    const machine = format !== "text" && format !== "json";
    const reports = await eachFile(files, format === "json" || machine, async (input) => {
      expectKind(input, "map");
      const r = mapReport(input, await loadMapInput(input));
      const failed = r.issues.some((i) => i.level === "error" || (o.strict && i.level === "warn"));
      if (failed) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
      const lines = printIssues(r.issues, !!o.all);
      const data: CheckReport = { file: input.path, name: r.name, issues: r.issues.filter((i) => o.all || i.level !== "info"), failed };
      return { data, lines: [`${pc.bold(input.name)}  ${issueLine(r.issues)}`, ...lines] };
    }, false, machine) as { issues?: unknown[] }[];
    if (machine) {
      const ok = reports.filter((r): r is CheckReport => !!r && !("error" in r));
      if (format === "github") print(...githubAnnotations(ok));
      else process.stdout.write(format === "junit" ? junitXml(ok) : sarifJson(ok, VERSION));
      return;
    }
    if (format === "text" && files.length > 1) {
      const bad = Number(process.exitCode ?? 0) ? reports.filter((r) => (r as { issues?: { level: string }[] }).issues?.some((i) => i.level === "error" || (o.strict && i.level === "warn"))).length : 0;
      print("", bad ? `${mark.error} ${plural(bad, "map")} of ${files.length} failed the check` : `${mark.ok} ${plural(files.length, "map")} checked, none failed`);
    }
  });
map.command("open").description("open a map in the scmJS app, or the editor in your browser").argument("<map>")
  .option("--browser", "the editor in the browser, even with the app installed")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL)").hideHelp())
  .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "map"); await openInScmjs(input, o); });

map.command("new").description("a new map: flat ground, start locations laid out, the file written").argument("<map>", "the file to write: .scx, .scm or .chk").addOption(json)
  .option("--size <WxH>", "width and height, each 64, 96, 128, 192 or 256", "128x128")
  .option("--tileset <name>", "badlands, platform, install, ashworld, jungle, desert, ice or twilight", "badlands")
  .option("--name <text>", "the map's name; the file's by default")
  .option("--description <text>", "the map's description", "")
  .option("--players <n>", "start locations for players 1 to n, as Auto-place lays them; the other slots closed", "0")
  .option("--layout <how>", `${LAYOUTS.join(" or ")}: how the start locations are laid out`, "ring")
  // Not --version: that is the program's own flag, and commander answers it wherever it appears.
  .option("--revision <which>", `${NEW_VERSIONS.join(" or ")}: the file's revision`, "broodwar")
  .option("--force", "overwrite a file that is there")
  .addHelpText("after", `
The map File ▸ New makes: flat ground, eight open slots (or n, with --players) and nothing else. Without the game's
graphics the ground is written by its ids, as the editor does without game data, and opens as it should. The same
arguments give the same file. Exits 2 when the file is there (--force overwrites it) or an option is not one.`)
  .action(async (file: string, o: { json?: boolean; size: string; tileset: string; name?: string; description: string; players: string; layout: string; revision: string; force?: boolean }) => {
    const { width, height } = parseSize(o.size);
    const tileset = parseTileset(o.tileset);
    if (!(NEW_VERSIONS as readonly string[]).includes(o.revision)) throw new CliError(`--revision takes ${NEW_VERSIONS.join(" or ")}, not "${o.revision}"`, null, 2);
    if (!(LAYOUTS as readonly string[]).includes(o.layout)) throw new CliError(`--layout takes ${LAYOUTS.join(" or ")}, not "${o.layout}"`, null, 2);
    const players = Number(o.players);
    if (!Number.isInteger(players) || players < 0 || players > 8) throw new CliError(`--players takes 0 to 8, not "${o.players}"`, null, 2);
    const piped = file === STDIO;
    if (piped && o.json) throw new CliError("--json and the map both want standard output", "Name a file to write, or leave --json off.", 2);
    if (!piped && existsSync(file) && !o.force) throw new CliError(`${file} is there already`, "--force overwrites it.", 2);
    const r = await writeNewMap(file, { width, height, tileset, name: o.name ?? (piped ? "Untitled Scenario" : nameFromFile(file)), description: o.description, version: o.revision as NewMapVersion, players, layout: o.layout as (typeof LAYOUTS)[number] });
    if (o.json) { print(JSON.stringify(r, null, 2)); return; }
    say(piped, `${mark.ok} ${pc.bold(piped ? "standard output" : relative(process.cwd(), r.path) || r.path)}: ${r.width} × ${r.height}${dot}${r.tileset}${dot}${r.version}${r.starts ? `${dot}${plural(r.starts, "start location")}` : ""}${dot}${size(r.bytes)}`);
  });

map.command("dump").description("the whole map as text, for git diff and grep").argument("<map>").addOption(json)
  .addHelpText("after", `
Everything the map holds, in one stable text form: the header, players, every unit and location, the triggers in the
trigger window's text, the strings, the archive's other files and the sections. To have git show a map's changes as
this text (git diff, git log -p, git show), once in the repository:
  git config diff.scmjs.textconv "scmjs map dump"
  git config diff.scmjs.xfuncname "^## .*"
  printf '*.scx diff=scmjs\\n*.scm diff=scmjs\\n*.chk diff=scmjs\\n' >> .gitattributes`)
  .action(async (file: string, o: { json?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const d = dumpMap(doc, input.name);
    if (o.json) print(JSON.stringify(d, null, 2));
    else process.stdout.write(printDump(d, doc.scenario));
  });

map.command("find").description("search units, locations, strings and triggers across maps").argument("<text>", "what to look for; a number matches an id, slot or index too").argument("<maps...>").addOption(json)
  .option("--in <kinds>", `which of ${KINDS.join(", ")} to search, with commas between; all by default`)
  .option("--case", "match case")
  .addHelpText("after", `
Edit ▸ Find over any number of maps: a unit, location, sprite or doodad whose name holds the text, a string or a
trigger whose text does. Prints what matched and where. Exits 1 when nothing matched in any map, like grep.`)
  .action(async (text: string, files: string[], o: { json?: boolean; in?: string; case?: boolean }) => {
    const kinds = parseKinds(o.in);
    let found = 0;
    await eachFile(files, !!o.json, async (input) => {
      expectKind(input, "map");
      const hits = findInMap(await loadMapInput(input), input.name, text, kinds, !!o.case);
      found += hits.length;
      return { data: { file: input.name, matches: hits.length, hits: hits.map(({ file: _f, ...h }) => h) }, lines: hits.length ? [`${pc.bold(input.name)}  ${pc.dim(`${num(hits.length)} ${hits.length === 1 ? "match" : "matches"}`)}`, ...printHits(hits)] : [] };
    }, false);
    if (!found) { if (!o.json) print(pc.dim(`Nothing in ${plural(files.length, "map")} matches "${text}"`)); process.exitCode = Math.max(Number(process.exitCode ?? 0), 1); }
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
  if (piped && o.json) throw new CliError("--json and the map both want standard output", "Write the map to a file with --out, or leave --json off.", 2);
  return piped;
}
/** What a writing command says: standard output, or standard error while the map takes standard output. */
function say(piped: boolean, ...lines: (string | null | undefined | false)[]): void {
  if (!piped) { print(...lines); return; }
  for (const l of lines) if (l !== null && l !== undefined && l !== false) process.stderr.write(l + "\n");
}
/** The output's name for a message: the file, or "standard output". */
const outName = (w: { path: string }) => (w.path === STDIO ? "standard output" : pc.cyan(w.path));

/** `--out` for text: the file, or stdout when there is none (or `-`). */
async function emit(text: string, out: string | undefined, said: string): Promise<void> {
  if (!out || out === STDIO) { process.stdout.write(text); return; }
  await writeFile(out, text);
  print(`${mark.ok} ${said} ${pc.dim("→")} ${pc.cyan(out)}`);
}

map.command("set").description("the map's name, description, revision or text encoding").argument("<map>").addOption(json)
  .option("--name <text>", "the map's name")
  .option("--description <text>", "the map's description")
  .option("--revision <which>", `the file's revision: ${VERSIONS.join(", ")}`)
  .option("--encoding <id>", `the text encoding: ${ENCODINGS.join(", ")}`)
  .option("--out <map>", "write the result here instead of over the map; - for standard output")
  .addHelpText("after", `
Scenario ▸ Map Properties from the terminal: what is given is set, the rest is left. Nothing is written when nothing
changed. A revision change does what the editor's does (the string table's form, the colour section the revision
needs); the encoding is how the map's text is written for 1.16.1, where Remastered reads UTF-8.`)
  .action(async (file: string, o: { json?: boolean; name?: string; description?: string; revision?: string; encoding?: string; out?: string }) => {
    if (o.name === undefined && o.description === undefined && o.revision === undefined && o.encoding === undefined) throw new CliError("Nothing to set", "--name, --description, --revision or --encoding, any of them.", 2);
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const changes = setHeader(doc, { name: o.name, description: o.description, version: o.revision, encoding: o.encoding });
    // A pipe always gets the map, changed or not, so the next step has one.
    const w = changes.length || o.out || piped ? await writeBack(doc, input.path, o.out ?? null) : null;
    if (o.json) { print(JSON.stringify({ file: input.name, changes, written: w }, null, 2)); return; }
    if (!changes.length) { say(piped, `${mark.ok} ${pc.bold(input.name)}: nothing changed${w ? `${dot}written to ${outName(w)}` : ""}`); return; }
    say(piped, `${mark.ok} ${pc.bold(input.name)}: ${changes.map((c) => `${c.field} ${pc.red(c.from || pc.dim("(none)"))} ${pc.dim("→")} ${pc.green(c.to || pc.dim("(none)"))}`).join(dot)}${dot}written to ${outName(w!)}${dot}${size(w!.bytes)}`);
  });

map.command("resize").description("Scenario ▸ Resize: the map to another size, anchored").argument("<map>").addOption(json)
  .requiredOption("--size <WxH>", "the new width and height, each 64, 96, 128, 192 or 256")
  .option("--anchor <where>", `${Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ")}: which part of the map stays`, "center")
  .option("--no-clamp", "leave locations that hang past the new edge where the shift put them")
  .option("--out <map>", "write the result here instead of over the map; - for standard output")
  .addHelpText("after", `
The map is moved under the anchor; what falls outside is dropped (units, sprites, doodads) or pulled inside
(locations, unless --no-clamp), and new ground is the tileset's base terrain. Says what was dropped.`)
  .action(async (file: string, o: { json?: boolean; size: string; anchor: string; clamp: boolean; out?: string }) => {
    const { width, height } = parseSize(o.size);
    const anchor = parseAnchor(o.anchor);
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const r = resizeMap(doc, { width, height, anchor, clampLocations: o.clamp });
    const w = await writeBack(doc, input.path, o.out ?? null);
    if (o.json) { print(JSON.stringify({ file: input.name, ...r, written: w }, null, 2)); return; }
    const dropped = [r.unitsDropped && plural(r.unitsDropped, "unit"), r.spritesDropped && plural(r.spritesDropped, "sprite"), r.doodadsDropped && plural(r.doodadsDropped, "doodad")].filter(Boolean).join(", ");
    say(piped, `${mark.ok} ${pc.bold(input.name)}: ${r.from.width} × ${r.from.height} ${pc.dim("→")} ${r.to.width} × ${r.to.height}${dropped ? `${dot}${pc.yellow(`${dropped} dropped`)}` : ""}${r.locationsClamped ? `${dot}${plural(r.locationsClamped, "location")} pulled inside` : ""}${dot}written to ${outName(w)}${dot}${size(w.bytes)}`);
  });

const triggers = map.command("triggers").description("a map's triggers as a text or .trg file, and back")
  .addHelpText("after", `
The text form is the trigger window's (docs.scmjs.dev/triggers); a .trg holds the raw records, as SCMDraft trades
them. Text in a file beside the map can be diffed and edited, and imported back.`);
triggers.command("export").description("the triggers as text (to stdout), or as .trg with --out x.trg").argument("<map>")
  .option("--out <file>", "write to this file instead of stdout; .trg writes the raw records")
  .option("--briefing", "the mission briefing's triggers instead")
  .action(async (file: string, o: { out?: string; briefing?: boolean }) => {
    const { doc } = await openForEdit(file);
    const r = exportTriggers(doc, o.out ?? null, !!o.briefing);
    if (r.bytes) { await writeFile(o.out!, r.bytes); print(`${mark.ok} ${plural(r.count, "trigger")} ${pc.dim("→")} ${pc.cyan(o.out!)}`); }
    else await emit(r.text!, o.out, plural(r.count, "trigger"));
  });
triggers.command("import").description("replace the map's triggers with a text or .trg file's").argument("<map>").argument("<file>", "the triggers: text, or .trg")
  .option("--out <map>", "write the result here instead of over the map; - for standard output")
  .option("--append", "add the file's triggers after the map's own instead of replacing them")
  .option("--briefing", "the mission briefing's triggers instead")
  .action(async (file: string, from: string, o: { out?: string; append?: boolean; briefing?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const r = importTriggers(doc, from, new Uint8Array(await readFile(from)), { briefing: !!o.briefing, append: !!o.append });
    const w = await writeBack(doc, input.path, o.out ?? null);
    say(piped, `${mark.ok} ${pc.bold(input.name)}: ${plural(r.before, "trigger")} ${pc.dim("→")} ${plural(r.after, "trigger")}${o.append ? pc.dim(` (${r.read} added)`) : ""}${dot}written to ${outName(w)}${dot}${size(w.bytes)}`);
  });

const strings = map.command("strings").description("a map's strings as a text file, and back")
  .addHelpText("after", `
One line per string: its number, a tab, its text. Colour codes are written <XX>. Importing sets the numbered
strings in place and adds any past the end; nothing is renumbered, since triggers and locations hold the numbers.`);
strings.command("export").description("the strings as <number><TAB><text> lines (to stdout)").argument("<map>")
  .option("--out <file>", "write to this file instead of stdout")
  .action(async (file: string, o: { out?: string }) => {
    const { doc } = await openForEdit(file);
    const r = exportStrings(doc);
    await emit(r.text, o.out, plural(r.count, "string"));
  });
strings.command("import").description("set the map's strings from such a file").argument("<map>").argument("<file>")
  .option("--out <map>", "write the result here instead of over the map; - for standard output")
  .action(async (file: string, from: string, o: { out?: string }) => {
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const r = importStrings(doc, from, await readFile(from, "utf8"));
    const w = await writeBack(doc, input.path, o.out ?? null);
    say(piped, `${mark.ok} ${pc.bold(input.name)}: ${plural(r.replaced, "string")} replaced, ${r.added} added, ${r.unchanged} unchanged${dot}written to ${outName(w)}${dot}${size(w.bytes)}`);
  });

strings.command("prune").description("drop the strings nothing in the map refers to").argument("<map>").addOption(json)
  .option("--dry-run", "list them and write nothing")
  .option("--all", "list every string dropped; by default a long list is cut at 20")
  .option("--out <map>", "write the result here instead of over the map; - for standard output")
  .addHelpText("after", `
The editor's Delete Unused: a string no trigger, location, name, force, sound or setting refers to is blanked. Nothing
is renumbered, so what the triggers hold stays right; blank slots at the end of the table are dropped.`)
  .action(async (file: string, o: { json?: boolean; dryRun?: boolean; all?: boolean; out?: string }) => {
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const removed = pruneStrings(doc, { dryRun: !!o.dryRun });
    const w = (removed.length || piped) && !o.dryRun ? await writeBack(doc, input.path, o.out ?? null) : null;
    if (o.json) { print(JSON.stringify({ file: input.name, removed, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
    if (!removed.length) { say(piped, `${mark.ok} ${pc.bold(input.name)}: every string is referred to`); return; }
    const limit = o.all ? Infinity : 20;
    const show = (t: string) => { const p = t.replace(/\s+/g, " "); return p.length > 70 ? `${p.slice(0, 67)}…` : p; };
    say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${plural(removed.length, "unused string")}${o.dryRun ? " would be dropped" : " dropped"}${w ? `${dot}written to ${outName(w)}${dot}${size(w.bytes)}` : ""}`,
      ...removed.slice(0, limit).map((r) => `  ${pc.dim(String(r.index).padStart(4))}  ${show(r.text)}`),
      ...(removed.length > limit ? [pc.dim(`  … and ${num(removed.length - limit)} more (--all lists them)`)] : []));
  });

map.command("unpack").description("a map's archive as a folder: the scenario, its sounds, scripts and other files").argument("<map>").addOption(json)
  .option("--out <folder>", "the folder to write; by default one named after the map, beside it")
  .option("--list", "list the archive's members and write nothing")
  .addHelpText("after", `
Each member becomes a file at its archive path (staredit/scenario.chk, staredit/wav/…, trigscript/…), and
${MANIFEST_FILE} records the map's name, how it was stored and the members without a name, so that scmjs map pack
puts the archive back together as it was.`)
  .action(async (file: string, o: { json?: boolean; out?: string; list?: boolean }) => {
    const input = await readInput(file);
    expectKind(input, "map");
    if (o.list) {
      const r = await listMembers(input.bytes);
      if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
      const width = Math.max(...r.members.map((m) => m.name.length));
      print(`${pc.bold(input.name)}${dot}${plural(r.members.length, "member")}${r.listfile ? "" : dot + pc.yellow("no file list")}`, ...r.members.map((m) => `  ${(m.kind === "stored" ? pc.dim(m.name) : m.name).padEnd(width + (m.kind === "stored" ? 9 : 0))}  ${pc.dim(size(m.bytes).padStart(8))}`), ...r.problems.map((p) => `${mark.warn} ${p}`));
      return;
    }
    const base = input.path === STDIO ? "stdin" : input.path;
    const dir = o.out ?? base.replace(/\.(scm|scx|chk)$/i, "") + (/\.(scm|scx|chk)$/i.test(base) ? "" : "-unpacked");
    const r = await unpackMap(input.bytes, input.name, dir);
    if (o.json) { print(JSON.stringify({ file: input.name, dir: r.dir, files: r.files, bytes: r.bytes, stored: r.stored, manifest: r.manifest }, null, 2)); return; }
    print(`${mark.ok} ${pc.bold(input.name)}: ${plural(r.files, "file")}${r.stored ? pc.dim(` (${r.stored} without a name)`) : ""}${dot}${size(r.bytes)}${dot}${pc.dim("→")} ${pc.cyan(relative(process.cwd(), r.dir) || ".")}`, ...r.manifest.problems.map((p) => `${mark.warn} ${p}`));
  });
map.command("pack").description("the folder scmjs map unpack wrote, back into a map file").argument("<folder>").addOption(json)
  .option("--out <map>", `the file to write; by default the name ${MANIFEST_FILE} records, beside the folder`)
  .option("--compression <method>", "none, pkware or zlib for every member, instead of how the map was stored")
  .addHelpText("after", `
Every file in the folder goes in: the ones ${MANIFEST_FILE} names at their archive paths, and any added since at the
path they have in the folder. The archive is compressed and encrypted as the map was, and written without a file list
when the map had none. The packed file is opened as a map before it is written.`)
  .action(async (dir: string, o: { json?: boolean; out?: string; compression?: string }) => {
    if (o.compression && !["none", "pkware", "zlib"].includes(o.compression)) throw new CliError(`--compression takes none, pkware or zlib, not "${o.compression}"`, null, 2);
    const r = await packMap(dir, { out: o.out ?? null, compression: o.compression as "none" | "pkware" | "zlib" | undefined });
    if (o.json) { print(JSON.stringify(r, null, 2)); return; }
    print(`${mark.ok} ${pc.bold(relative(process.cwd(), r.path) || r.path)}: ${plural(r.members + 1, "member")}${r.stored ? pc.dim(` (${r.stored} without a name)`) : ""}${r.added.length ? `${dot}${plural(r.added.length, "file")} added: ${r.added.join(", ")}` : ""}${dot}${r.compression}${r.encrypted ? ", encrypted" : ""}${dot}${size(r.bytes)}`);
  });

map.command("build").description("apply the map's TrigScript script and build its programs, as Save does").argument("<map>").addOption(json)
  .option("--out <map>", "write the built map here instead of over the map; - for standard output")
  .option("--check", "compile (and test, with --test) and write nothing")
  .option("--test", "run the script's tests first; a failing test refuses the build")
  .addHelpText("after", `
The script is the one the map keeps (Triggers ▸ TrigScript… in the editor). Its trigger() calls go into the trigger
list and its program()s are built into the file, with the map as you edit it kept beside them, so it opens in the
editor as it was. Needs TypeScript on this computer: npm install typescript. Exits 1 when the script does not
compile, a test fails or the build is refused; nothing is written then.`)
  .action(async (file: string, o: { json?: boolean; out?: string; check?: boolean; test?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const piped = !o.check && piping(input, o);
    const typescript = await loadTypeScript();
    const r = await buildMap(doc, input.path, typescript, { check: !!o.check, test: !!o.test, out: o.out ?? null });
    if (o.json) print(JSON.stringify({ file: input.name, ...r }, null, 2));
    else say(piped, ...printBuild(input.name, r));
    if (!r.ok) process.exitCode = 1;
  });

map.command("run").description("run a plugin, or a script written like one, over a map with the plugin API").argument("<plugin>", "a folder with plugin.json, a plugin.ts/.js file, github:owner/repo or a URL").argument("<map>").addOption(json)
  .option("--command <id>", "after it starts, run this command of its (the id it registered)")
  .option("--arg <value...>", "arguments for --command")
  .option("--out <map>", "write the changed map here instead of over the map; - for standard output")
  .option("--dry-run", "say what would change, as map diff does, and write nothing")
  .addHelpText("after", `
The plugin gets the editor's plugin API (docs.scmjs.dev/plugins) with the map open and no editor around it: what it
would show — its status line, toasts, log — is printed here, and dialogs show nothing. A script is a file exporting
activate(api), like a plugin's entry; a .ts needs TypeScript installed. The map is written back only when the
plugin changed it. Exits 1 when the plugin does not load or throws.`)
  .action(async (target: string, file: string, o: { json?: boolean; command?: string; arg?: string[]; out?: string; dryRun?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const piped = piping(input, o);
    const r = await runOnMap(doc, input.path, input.bytes, target, { command: o.command, args: o.arg, out: o.out ?? null, dryRun: !!o.dryRun, live: o.json ? undefined : (line) => say(piped, line) });
    if (o.json) print(JSON.stringify({ file: input.name, ...r }, null, 2));
    else say(piped, ...printRun(input.name, r, { dryRun: !!o.dryRun }));
  });

/** `--frames`, `--every`, `--seed`: whole numbers, or exit 2. */
function whole(value: string, name: string, least = 0): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < least) throw new CliError(`--${name} takes a whole number${least ? ` of ${least} or more` : ""}, not "${value}"`, null, 2);
  return n;
}
const gameOptions = (cmd: Command) => cmd
  .option("--frames <n>", "frames to run (24 a second); the game may end sooner", "2400")
  .option("--every <n>", "frames between progress lines; 0 for none", "600")
  .option("--seed <n>", "the game's seed; the same seed and map give the same run", "1")
  .option("--all", "list every trigger; by default a long list is cut")
  .option("--starcraft <folder>", "your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addOption(new Option("--engine <where>", "the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)").hideHelp());
interface GameOptions { json?: boolean; frames: string; every: string; seed: string; all?: boolean; starcraft?: string; engine?: string }

gameOptions(map.command("trace").description("run the map's triggers in the game with nobody playing: what fired, what never did").argument("<map>").addOption(json))
  .addHelpText("after", `
The game itself runs the map as Use Map Settings, your seat idle and the computers as the map has them, for the
frames given, and every condition it asks and action it runs is noted. Prints each trigger with how often it fired,
when first and last and whose it is, then the ones that never fired and which condition said no last. The engine is
fetched once from the play page (about 25 MB) and the game's own files come from your copy of StarCraft, as for
scmjs bot run. Exits 2 when the game could not start.`)
  .action(async (file: string, o: GameOptions) => {
    const { input, doc } = await openForEdit(file);
    const game = await gameMap(doc, input.path, input.name);
    if (game.converted && !o.json) print(pc.dim(`${input.name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead`));
    const r = await runMapInGame(game.path, "trace", { frames: whole(o.frames, "frames", 1), every: whole(o.every, "every"), seed: whole(o.seed, "seed"), starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line) });
    if (o.json) print(JSON.stringify({ ...traceReport(input.name, doc.scenario, r), engine: r.engine, game: r.game, copies: r.end.trace, ms: r.end.ms }, null, 2));
    else print("", ...printTrace(input.name, doc.scenario, r, { all: !!o.all }));
  });

gameOptions(map.command("cost").description("what the map's triggers cost Remastered a frame, in milliseconds").argument("<map>").addOption(json))
  .addOption(new Option("--weigh <module>", "the weigher to hand the game instead of the one beside the command").hideHelp())
  .addHelpText("after", `
The game runs the map as scmjs map trace does, and every trigger the game passes and every condition and action it
runs is weighed as Remastered charges for it (TrigScript's model, measured on the real game). Says what a frame costs
on average where the triggers ran and at the most, against what a frame can carry, then the costliest triggers.`)
  .action(async (file: string, o: GameOptions & { weigh?: string }) => {
    const { input, doc } = await openForEdit(file);
    const game = await gameMap(doc, input.path, input.name);
    if (game.converted && !o.json) print(pc.dim(`${input.name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead`));
    const r = await runMapInGame(game.path, "cost", { frames: whole(o.frames, "frames", 1), every: whole(o.every, "every"), seed: whole(o.seed, "seed"), starcraft: o.starcraft, engine: o.engine, weigh: o.weigh, live: o.json ? undefined : (line) => print(line) });
    if (o.json) print(JSON.stringify({ ...costReport(input.name, r), engine: r.engine, game: r.game, series: r.end.cost, ms: r.end.ms }, null, 2));
    else print("", ...printCost(input.name, doc.scenario, r, { all: !!o.all }));
  });

map.command("rush").description("the ground distance between the start locations, walked by the game's own pathing").argument("<map>").addOption(json)
  .option("--unit <name>", "the unit walked: Zergling, Dragoon, a units.dat id…", "SCV")
  .option("--seed <n>", "the game's seed; the same seed and map give the same walks", "12345")
  .option("--starcraft <folder>", "your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addOption(new Option("--limit <frames>", "frames a walk may take before it is given up").default("10000").hideHelp())
  .addOption(new Option("--engine <where>", "the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)").hideHelp())
  .addHelpText("after", `
The game walks the unit from each start location to every other, as a player's unit would go when sent there, and
each walk is timed. Prints a table with the starts as rows and columns: the pixels walked and the seconds it took at
Fastest, then the shortest and longest of them beside the straight line, and any walk that did not arrive (no ground
between two starts is an island map). The engine and your copy of StarCraft are needed, as for scmjs map trace.
Exits 2 when the game could not start.`)
  .action(async (file: string, o: { json?: boolean; unit: string; seed: string; limit: string; starcraft?: string; engine?: string }) => {
    const unit = unitByName(o.unit);
    const { input, doc } = await openForEdit(file);
    const game = await gameMap(doc, input.path, input.name);
    if (game.converted && !o.json) print(pc.dim(`${input.name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War is run instead`));
    const r = await runRush(game.path, { unit, seed: whole(o.seed, "seed"), limit: whole(o.limit, "limit", 1), starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line) });
    if (o.json) print(JSON.stringify(rushJson(input.name, r), null, 2));
    else print("", ...printRush(input.name, r));
  });

map.command("preview").description("a picture of the map in the terminal, or as a PNG, with your copy of the game's graphics").argument("<map>").addOption(json)
  .option("--out <picture.png>", "write a PNG instead; - for standard output")
  .option("--scale <n>", `pixels a tile: ${PNG_SCALES.join(", ")} in a PNG (4 by default); in the terminal a pixel is half a character`)
  .option("--width <columns>", "the terminal picture's width in characters (as wide as the terminal by default)")
  .option("--no-units", "the terrain alone: no units, resources or start locations")
  .addOption(new Option("--units", "units, resources and start locations on the picture (the default)").hideHelp())
  .option("--blocks", "colour blocks, even in kitty or iTerm2, which can show the picture itself")
  .option("--starcraft <folder>", "your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addHelpText("after", `
The terrain is drawn with the map's tileset as your copy of StarCraft has it, Remastered or 1.16.1; nothing of the
game is fetched or kept. Over it: a dot a unit in its owner's colour, sized as the unit is placed, mineral fields
and geysers in their own colours, and start locations framed (numbered in the terminal). In the terminal each
character is two pixels, in 24-bit colour where the terminal says it has it, else the nearest of 256.
  scmjs map preview ridge.scx
  scmjs map preview ridge.scx --out ridge.png --scale 8`)
  .action(async (file: string, o: { json?: boolean; out?: string; scale?: string; width?: string; units?: boolean; blocks?: boolean; starcraft?: string }) => {
    const piped = o.out === STDIO;
    if (piped && o.json) throw new CliError("--json and the picture both want standard output", "Write the PNG to a file with --out, or leave --json off.", 2);
    const { input, doc } = await openForEdit(file);
    const { report, lines } = await previewMap(input, doc, o);
    if (o.json) print(JSON.stringify(report, null, 2));
    else say(piped, ...lines);
  });

map.command("play").description("a lobby on the play page with this map, and its invite link to send around").argument("<map>").addOption(json)
  .addOption(new Option("--play <url>", "the play page's address (SCMJS_PLAY_URL)").hideHelp())
  .addHelpText("after", `
Opens scmjs.dev/play in your browser with the map and asks it for a lobby; the page is the host, and the link it
reports is printed here. The page asks you to sign in to scmjs.dev when you are not (opening a lobby needs an
account; joining one does not), and for the game's files the first time. The people you send the link to need
their own StarCraft files and no account. Waits up to five minutes for the page.`)
  .action(async (file: string, o: { json?: boolean; play?: string }) => {
    const input = await readInput(file);
    expectKind(input, "map");
    const r = await playInLobby(input, { play: o.play, live: o.json ? undefined : (line) => print(line) });
    if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
    if (!r.link) throw new CliError(r.error ?? "The page opened no lobby", "Invite Players on the play page opens one by hand.");
  });

map.command("diff").description("what changed between two maps, or since a git revision").argument("<a>").argument("[b]", "the other map; none with --rev").addOption(json)
  .option("--all", "list every item; by default a long list is cut at 20")
  .option("--rev <revision>", "compare the map as git has it at this revision (HEAD, HEAD~1, a branch, a tag) with the file as it is")
  .option("--picture", "draw the maps with the changes marked, with your copy of the game's graphics (as map preview)")
  .option("--out <picture.png>", "with --picture: write a PNG instead; - for standard output")
  .option("--side-by-side", "with --picture: the first map, the changes and the second map in one picture")
  .option("--scale <n>", `with --picture: pixels a tile, ${PNG_SCALES.join(", ")} in a PNG (4 by default)`)
  .option("--width <columns>", "with --picture: the terminal picture's width in characters")
  .option("--blocks", "with --picture: colour blocks, even in kitty or iTerm2")
  .option("--starcraft <folder>", "with --picture: your installation of StarCraft (SCMJS_STARCRAFT)")
  .addHelpText("after", `
Exits 1 when the maps differ, 0 when they are the same, like diff.
  scmjs map diff old.scx new.scx
  scmjs map diff --rev HEAD~1 maps/ridge.scx     # what the last commit changed in the map
  scmjs map diff old.scx new.scx --picture --out diff.png --side-by-side`)
  .action(async (a: string, b: string | undefined, o: { json?: boolean; all?: boolean; rev?: string; picture?: boolean; out?: string; sideBySide?: boolean; scale?: string; width?: string; blocks?: boolean; starcraft?: string }) => {
    if (o.rev ? b !== undefined : b === undefined) throw new CliError(o.rev ? "--rev compares one map with its earlier version: give the map alone" : "Two maps to compare, or one with --rev <revision>", null, 2);
    const picture = !!o.picture || o.out !== undefined || !!o.sideBySide;
    const pictureOnly = (["scale", "width", "blocks", "starcraft"] as const).find((k) => o[k] !== undefined);
    if (!picture && pictureOnly) throw new CliError(`--${pictureOnly} is the picture's: add --picture`, null, 2);
    const piped = o.out === STDIO;
    if (piped && o.json) throw new CliError("--json and the picture both want standard output", "Write the PNG to a file with --out, or leave --json off.", 2);
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

map.command("fetch").description("search scmscx.com, the community's map database, and download a map").argument("[words...]", "what to search for: a map's name, words in its description, a file name").addOption(json)
  .option("--limit <n>", `how many of the best matches to list, 1 to ${MAX_LIMIT}`, String(DEFAULT_LIMIT))
  .option("--id <id>", "download this map: its id from the list, or its address on the site")
  .option("--first", "download the best match for the words")
  .option("--out <path>", "the file to write, or a folder to write it in (the site's file name); - for standard output")
  .option("--force", "overwrite a file that is there")
  .option("--open", "open the map in scmJS once it is downloaded, as scmjs map open does")
  .addHelpText("after", `
The maps come from scmscx.com (${SCMSCX}), where people have shared StarCraft maps for years; they are their
makers', and the site's. The list shows the best matches with their size, tileset, players, downloads and id; --id
or --first downloads one, named as the site names the file, into this folder or --out. The file is opened as the
editor opens it before it is written, so what arrives is a map. Exits 1 when nothing matched or the site did not
answer (within 10 seconds), 2 when the file is there already (--force overwrites it).
  scmjs map fetch lost temple
  scmjs map fetch --id B8V7fdyj --out maps/
  scmjs map fetch lost temple --first --open
  scmjs map fetch fastest --first --out - | scmjs map info -`)
  .action(async (words: string[], o: { json?: boolean; limit?: string; id?: string; first?: boolean; out?: string; force?: boolean; open?: boolean }) => {
    const text = words.join(" ").trim();
    if (o.id && text) throw new CliError("--id downloads one map: give the id or the words, not both", null, 2);
    if (!o.id && !text) throw new CliError("What to search for, or --id <id>", "scmjs map fetch lost temple", 2);
    const download = !!(o.id || o.first);
    if (!download && (o.out || o.force || o.open)) throw new CliError("--out, --force and --open are for a download", "Add --first for the best match, or --id <id> from the list.", 2);
    const piped = download && o.out === STDIO;
    if (piped && o.json) throw new CliError("--json and the map both want standard output", "Write the map to a file with --out, or leave --json off.", 2);
    if (piped && o.open) throw new CliError("--open needs the map in a file", "Leave --out - off, or name a file or folder.", 2);
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
      if (!best) { if (!o.json) say(piped, pc.dim(`Nothing on scmscx.com matches "${text}"`)); process.exitCode = 1; return; }
      id = best.id;
    }
    const r = await fetchMap(site, id, { out: o.out, force: o.force });
    if (o.json) print(JSON.stringify(fetchJson(r), null, 2));
    else say(piped, ...printFetched(r));
    if (o.open) await openInScmjs({ path: r.written.path, name: r.report.file.name, bytes: new Uint8Array(await readFile(r.written.path)), kind: "map" }, {});
  });
map.command("share").description("a link to the map on scmjs.dev: a copy anyone can open, or --edit to edit it together").argument("<map>", "the map, or - for standard input").addOption(json)
  .option("--name <name>", "the map's name on your account and in the link; the scenario's name by default")
  .option("--note <text>", "a note for this revision, as My Maps shows it")
  .option("--edit", "a link to edit the map together (Account ▸ Share this Map…), not a copy")
  .option("--keep <how long>", "with --edit: keep it open day, week, month or forever after its last edit; by default it is open until everyone leaves")
  .option("--new", "store it as a new map even when your account has one with this file name")
  .option("--no-picture", "upload no picture for the link's card")
  .option("--starcraft <folder>", "your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addHelpText("after", `
Needs a scmjs.dev account: scmjs login. A copy link stores the map on your account (My Maps) as a new map, or as a
new revision of the map there with the same file name, and links that revision: whoever opens it gets a copy in
their editor. --edit opens the map for editing together instead; whoever opens that link edits it with you.
  scmjs map share ridge.scx
  scmjs map share ridge.scx --edit --keep week`)
  .action(async (path: string, o: { json?: boolean; name?: string; note?: string; edit?: boolean; keep?: string; new?: boolean; picture?: boolean; starcraft?: string }) => {
    const input = await readInput(path);
    expectKind(input, "map");
    const r = await shareMap(input, await loadMapInput(input), o);
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printShare(r)));
  });

const replay = program.command("replay").description("read and open replays").helpGroup("Maps and replays:");
replay.command("info").description("who played, on what map, for how long, at what APM").argument("<replays...>").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, replayInfo));
replay.command("map").description("the map the replay was played on, written out as a map file").argument("<replay>").addOption(json)
  .option("--out <map>", "the file to write (.scx, .scm or .chk); the replay's name with .scx by default; - for standard output")
  .option("--force", "overwrite a file that is there")
  .addHelpText("after", `
A replay carries the map the game loaded, so the map is there whole whether or not you still have the file. It is
written as the game had it: a bare .chk, or an archive like a new map's. Opens in the editor like any map.
  scmjs replay map game.rep                      # game.scx beside it
  scmjs replay map game.rep --out - | scmjs map info -`)
  .action(async (file: string, o: { json?: boolean; out?: string; force?: boolean }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const out = o.out ?? mapFileFor(input.path === STDIO ? "stdin.rep" : input.path);
    const piped = out === STDIO;
    if (piped && o.json) throw new CliError("--json and the map both want standard output", "Write the map to a file with --out, or leave --json off.", 2);
    if (!piped && existsSync(out) && !o.force) throw new CliError(`${out} is there already`, "--force overwrites it, --out names another file.", 2);
    const r = await writeReplayMap(await loadReplayInput(input), out);
    if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
    say(piped, `${mark.ok} ${pc.bold(gameText(r.name) || pc.italic("Untitled"))}: ${r.width} × ${r.height}${dot}from ${input.name}${dot}written to ${outName(r.written)}${dot}${size(r.written.bytes)}`);
  });
replay.command("share").description("a link to the replay on scmjs.dev, which anyone opens to watch it in the editor").argument("<replay>", "the replay, or - for standard input").addOption(json)
  .option("--note <text>", "a note, as My Maps shows it")
  .option("--no-picture", "upload no map picture for the link's card")
  .option("--starcraft <folder>", "your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addHelpText("after", `
Needs a scmjs.dev account: scmjs login. The replay is stored on your account (My Maps ▸ Replays, up to 8 MB each,
counted with your maps) and linked; whoever opens the link watches it in the editor's replay viewer. The link's
card shows the map's picture when your copy of the game is here to draw it.
  scmjs replay share game.rep`)
  .action(async (path: string, o: { json?: boolean; note?: string; picture?: boolean; starcraft?: string }) => {
    const input = await readInput(path);
    expectKind(input, "replay");
    const r = await shareReplay(input, await loadReplayInput(input), o);
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printReplayShare(r)));
  });
replay.command("open").description("watch a replay in the scmJS app, or the editor in your browser").argument("<replay>")
  .option("--browser", "the editor in the browser, even with the app installed")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL)").hideHelp())
  .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "replay"); await openInScmjs(input, o); });
replay.command("watch").description("play a replay in the terminal: the minimap, each player's figures, the chat").argument("<replay>").addOption(json)
  .option("--speed <x>", "how fast, against the game's Fastest (24 frames a second)", "8")
  .option("--from <m:ss>", "start the game here")
  .option("--size <WxH>", "the picture's size in characters; as much of the terminal as the map fills by default")
  .option("--every <frames>", "frames between lines when the output is not a terminal", "1440")
  .option("--starcraft <folder>", "your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addOption(new Option("--engine <where>", "the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)").hideHelp())
  .addHelpText("after", `
The game is the play page's engine, fetched once (about 25 MB) and kept; the game's own files come from your copy of
StarCraft, Remastered or 1.16.1. The replay plays as the game plays it, drawn as a minimap: a dot a unit in its
player's colour, buildings as blocks, resources dim. Keys: space pauses, + and - change the speed, q stops. Into a
pipe or a file it prints a line per minute of game instead (--every), or JSON lines with --json.`)
  .action(async (file: string, o: { json?: boolean; speed: string; from?: string; size?: string; every: string; starcraft?: string; engine?: string }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const replay = await loadReplayInput(input);
    const speed = Number(o.speed);
    if (!(speed > 0 && speed <= 64)) throw new CliError(`--speed takes a number from 0.25 to 64, not "${o.speed}"`, null, 2);
    const every = Number(o.every);
    if (!Number.isInteger(every) || every < 1) throw new CliError(`--every takes a number of frames, not "${o.every}"`, null, 2);
    let size: { cols: number; rows: number } | undefined;
    if (o.size) { const m = /^(\d+)x(\d+)$/i.exec(o.size); if (!m || Number(m[1]) < 8 || Number(m[2]) < 4) throw new CliError(`--size takes WxH in characters, 8x4 or more, not "${o.size}"`, null, 2); size = { cols: Number(m[1]), rows: Number(m[2]) }; }
    const r = await watchReplay(input, replay, { speed, from: o.from ? parseClock(o.from) : undefined, size, every, json: !!o.json, starcraft: o.starcraft, engine: o.engine });
    if (!o.json) print(watchSummary(input, r));
  });

const plugin = program.command("plugin").description("start, check and run a plugin for the editor").helpGroup("Plugins and bots:");
plugin.command("new").description("a plugin to start from, in a new folder").argument("[name]", "the plugin's name, such as \"Base Check\"")
  .option("--dir <folder>", "the folder to write it in (default plugin-<id>)")
  .action((name: string | undefined, o: { dir?: string }) => {
    const made = newPlugin({ name, dir: o.dir });
    const rel = relative(process.cwd(), made.dir) || ".";
    print(`${mark.ok} ${pc.bold(name ?? rel)} written in ${pc.cyan(rel)}${dot}${plural(made.files.length, "file")}`, "",
      pc.dim("  Next:"), `    cd ${rel.includes(" ") ? JSON.stringify(rel) : rel}`, "    npm install", `    npm start            ${pc.dim("the editor with your plugin, reloaded each time you save")}`, "",
      pc.dim("  plugin.ts is the plugin; plugin.json describes it. Guide: https://docs.scmjs.dev/plugins/"));
  });
plugin.command("check").description("what the editor would make of the plugin")
  .argument("[folder]", "the plugin's folder", ".").addOption(json)
  .option("--all", "list notes too, not only errors and warnings")
  .option("--strict", "fail on warnings as well as errors")
  .addHelpText("after", `\nExits 1 when the editor would not load it (or on warnings, with --strict): fit for a CI step.`)
  .action((folder: string, o: { json?: boolean; all?: boolean; strict?: boolean }) => {
    const c: PluginCheck = checkPlugin(folder);
    if (c.issues.some((i) => i.level === "error" || (o.strict && i.level === "warn"))) process.exitCode = 1;
    print(...(o.json ? [JSON.stringify(c, null, 2)] : printPluginCheck(c, !!o.all)));
  });
plugin.command("dev").description("the editor with your plugin, reloaded on every save")
  .argument("[folder]", "the plugin's folder", ".")
  .option("--port <port>", "the port to serve it on; the editor remembers the plugin by it", "5310")
  .option("--no-open", "do not open the editor; print its address instead")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL), such as a local one").hideHelp())
  .addHelpText("after", `\nBuilds it first when plugin.json names a "build" and package.json has a build script.`)
  .action(async (folder: string, o: { port: string; open: boolean; editor?: string }) => {
    const port = Number(o.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError(`--port ${o.port} is not a port`, null, 2);
    await devPlugin({ dir: folder, port, open: o.open, editor: o.editor });
  });

const bot = program.command("bot").description("build a BWAPI bot for scmjs.dev/play (Docker)").helpGroup("Plugins and bots:")
  .addHelpText("after", () => `
Run these in your bot's folder. The toolchain is a Docker image, downloaded the first time.
A built bot is added on the play page: Options → Community bots → Add a bot from a file…

${pc.dim(`Guide: ${BOT_GUIDE}`)}`);
bot.command("new").description("a bot to start from, in this folder")
  .action(async () => { await runBot(["new"]); });
bot.command("init").description("scmbot.json from the bot's Visual Studio project").argument("[project]", "the .vcxproj, when the folder has several")
  .action(async (project?: string) => { await runBot(project ? ["init", project] : ["init"]); });
bot.command("build").description("out/<key>.scmbot, to add on the play page")
  .action(async () => { await runBot(["build"]); });
bot.command("update").description("the newest toolchain, the one the play page expects")
  .action(async () => { await updateBot(); });
bot.command("run").description("play the bot against the game's computers on a map, with no page").argument("<bot>", "a .scmbot file").argument("<map>").addOption(json)
  .option("--race <race>", "the bot's race: zerg, terran, protoss or random", "random")
  .option("--opponents <races>", "the game's computers, a race each (zerg,terran)", "zerg")
  .option("--seed <n>", "the game's seed; the same seed, bot and map give the same game")
  .option("--frames <n>", "stop after this many frames when nobody has won (24 a second)", "50000")
  .option("--every <n>", "frames between progress lines; 0 for none", "1000")
  .option("--data <folder>", "a folder the bot keeps its files in between games")
  .option("--starcraft <folder>", "your installation of StarCraft (SCMJS_STARCRAFT); found in the usual places otherwise")
  .addOption(new Option("--engine <where>", "the play page's address, or a folder holding the engine (SCMJS_PLAY_URL)").hideHelp())
  .addHelpText("after", `
The game is the play page's engine, fetched once (about 25 MB) and kept; the game's own files come from your copy
of StarCraft, Remastered or 1.16.1. Prints what the bot says and each side's purse and supply as it plays, then who
won. Exits 1 when the bot printed errors, 2 when the game could not start.`)
  .action(async (botFile: string, map: string, o: { json?: boolean; race: string; opponents: string; seed?: string; frames: string; every: string; data?: string; starcraft?: string; engine?: string }) => {
    const r = await runBotGame(botFile, map, {
      race: o.race, opponents: o.opponents.split(",").map((s) => s.trim()).filter(Boolean), seed: o.seed === undefined ? undefined : Number(o.seed), frames: Number(o.frames), every: Number(o.every),
      data: o.data, starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line),
    });
    if (o.json) print(JSON.stringify({ bot: botFile, map, ...r }, null, 2));
    if (r.exitCode) process.exitCode = r.exitCode;
  });

// A scmjs.dev account. Hidden from the overview, which is held to 23 lines: `map share` (under `map …`) and the
// doctor's scmjs.dev row say `scmjs login`, and `scmjs help account` lists it all.
const signIn = async (o: { provider?: string }) => {
  const r = await login({ provider: o.provider, say: (page, provider) => print(`${mark.info} Signing in with ${provider} in your browser`, pc.dim(`  If nothing opens, go to ${page}`)) });
  print(`${mark.ok} Signed in to ${serverLabel(r.server)} as ${pc.bold(r.account.name ?? "(no name)")}`, pc.dim(`  The session is kept in ${r.file}; scmjs logout ends it.`));
};
const signOut = async () => {
  const r = await logout();
  if (!r.was) { print(`${mark.info} Not signed in`); return; }
  print(`${mark.ok} Signed out of ${serverLabel(r.was.server)}${r.was.name ? ` (${r.was.name})` : ""}`, r.told ? null : pc.dim(`  The server could not be reached to end the session there; ${r.file} is deleted.`));
};
const providerOption = () => new Option("--provider <name>", `the sign-in to use: ${PROVIDERS.join(", ")}`).default("discord");
const account = program.command("account", { hidden: true }).description("your scmjs.dev account: sign in, see it, sign out")
  .addHelpText("after", `
The sign-in opens Discord in your browser, as the editor's does (--provider google or battlenet for the others). The
session is kept in your configuration folder (~/.config/scmjs/session.json; SCMJS_SESSION names another file), and
scmjs logout ends it. scmjs login and scmjs logout are the same as account login and account logout.`);
account.command("show", { isDefault: true }).description("who you are, the storage you use and the maps you are sharing").addOption(json)
  .action(async (o: { json?: boolean }) => {
    const r = await accountReport();
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printAccount(r)));
  });
account.command("login").description("sign in to scmjs.dev in your browser").addOption(providerOption()).action(signIn);
account.command("logout").description("end the session and delete its file").action(signOut);
program.command("login", { hidden: true }).description("sign in to scmjs.dev in your browser (scmjs account login)").addOption(providerOption()).action(signIn);
program.command("logout", { hidden: true }).description("sign out of scmjs.dev (scmjs account logout)").action(signOut);

program.command("completion", { hidden: true }).description("a completion script for your shell").argument("<shell>", SHELLS.join("|"))
  .addHelpText("after", `
  eval "$(scmjs completion bash)"                        # in ~/.bashrc
  scmjs completion zsh > ~/.zsh/completions/_scmjs       # a folder on $fpath
  scmjs completion fish > ~/.config/fish/completions/scmjs.fish`)
  .action((shell: string) => {
    if (!(SHELLS as readonly string[]).includes(shell)) throw new CliError(`${shell} is not a shell this knows`, `One of ${SHELLS.join(", ")}.`, 2);
    process.stdout.write(completionScript(program, shell as Shell));
  });

// Hidden from the overview, which holds 23 lines (banner.ts); `scmjs help init`, `map --help` and docs/cli.md name it.
program.command("init", { hidden: true }).description("a folder of maps set up for git and GitHub: maps diff as text, a check on each push, a README")
  .argument("[folder]", "the folder the maps are in", ".").addOption(json)
  .option("--print", "print what would be written, to paste by hand, and write nothing")
  .option("--git", "git init the folder when it is in no git repository (never done without it)")
  .option("--force", "replace a README.md or workflow that is there, and set a git setting that holds another value")
  .addHelpText("after", `
Writes what is not there yet:
  .gitattributes              *.scx, *.scm and *.chk read through scmjs map dump by git diff
  .gitignore                  *.bak, the copy the desktop app's Save keeps
  .github/workflows/maps.yml  map check on every push and pull request (and map build --check for maps with a
                              TrigScript script), with this version of scmjs pinned
  README.md                   the maps, and the commands to check, dump and diff them
and, in the git repository, git config diff.scmjs.textconv, .xfuncname and .cachetextconv, which are per clone.
.gitattributes and .gitignore get only the lines they lack; nothing else that is there is changed without --force.
Exits 2 when there is no such folder.`)
  .action(async (folder: string, o: { json?: boolean; print?: boolean; git?: boolean; force?: boolean }) => {
    const r = await initFolder(folder, { print: !!o.print, git: !!o.git, force: !!o.force });
    if (o.json) print(JSON.stringify({ ...r, files: r.files.map(({ content, ...f }) => (o.print ? { ...f, content } : f)) }, null, 2));
    else if (o.print) process.stdout.write(printRecipe(r));
    else print(...printInit(r));
  });
map.addHelpText("after", `
scmjs init [folder] sets a folder of maps up for git and GitHub: git diff shows a map's changes as text, a workflow
checks the maps on every push, and a README lists them (scmjs help init).`);

program.command("doctor").description("what this computer has for each command").helpGroup("This tool:").addOption(json)
  .addHelpText("after", `
TypeScript (map build, a .ts plugin), Docker (bot new|build), a copy of StarCraft and the game engine's runners (bot
run, replay watch, map trace|cost), the desktop app (map open), whether Claude Code has scmjs mcp, and whether npm has
a newer scmjs; then the commands this computer can run now. Nothing is changed. Exits 1 only when Node is too old.`)
  .action(async (o: { json?: boolean }) => {
    const r = await doctorReport();
    print(...(o.json ? [JSON.stringify(doctorJson(r), null, 2)] : printDoctor(r)));
    if (r.blocked) process.exitCode = 1;
  });

program.command("mcp").description("these commands as an MCP server, for AI tools").helpGroup("This tool:")
  .addHelpText("after", `
Speaks the Model Context Protocol on standard input and output, so an AI tool that runs on this computer (Claude
Code, Cursor, VS Code, …) can read, check, search, compare and change maps with the same code these commands use:
map_info, map_check, map_dump, map_find, map_diff, map_triggers_export|import, map_strings_export|import|prune,
map_set, map_resize, map_new, map_build, map_run, map_preview (the picture itself), map_trace, map_cost, replay_info,
replay_map and doctor. map_preview, map_trace and map_cost need a copy of StarCraft here, as the commands do; doctor
says whether there is one. Paths are files on this
computer, relative to the folder the tool started it in. Claude Code, in your maps folder:
  claude mcp add scmjs -- npx -y @scm-js/cli mcp
Anything else takes the same thing as JSON:
  { "mcpServers": { "scmjs": { "command": "npx", "args": ["-y", "@scm-js/cli", "mcp"] } } }`)
  .action(async () => { await serveStdio(); });

program.command("about").description("this version, any newer one, and links").helpGroup("This tool:").addOption(json)
  .action(async (o: { json?: boolean }) => {
    const r = await aboutReport();
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printAbout(r)));
  });

// tests/cli.test.ts imports the program to read its help; only the command runs it.
if (!process.env.VITEST) {
  try {
    // `scmjs` on its own is a request for the overview, not a mistake.
    if (process.argv.length <= 2) program.outputHelp();
    else await program.parseAsync();
  } catch (e) {
    if (e instanceof CliError) { fail(e); process.exitCode = e.exitCode; }
    else { process.stderr.write(`${mark.error} ${pc.red("Something went wrong")}: ${e instanceof Error ? e.stack ?? e.message : e}\n${pc.dim("  Please report it: https://github.com/scm-js/scm-js/issues")}\n`); process.exitCode = 1; }
  }
}
