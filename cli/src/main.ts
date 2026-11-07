/**
 * scmjs: StarCraft: Brood War maps, replays and bots from the command line. One command, a noun for each kind of
 * thing (`map`, `replay`, `plugin`, `bot`), the editor's own code underneath (docs/cli.md, .claude/internals/cli.md).
 */
import { readFile, writeFile } from "node:fs/promises";
import { relative } from "node:path";
import { Command, Help, Option } from "commander";
import { aboutReport, printAbout, VERSION } from "./about";
import { rootHelp } from "./banner";
import { BOT_GUIDE, runBot, updateBot } from "./bot";
import { buildMap, loadTypeScript, printBuild } from "./build";
import { completionScript, SHELLS, type Shell } from "./completion";
import { diffMaps, printDiff } from "./diff";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack } from "./exchange";
import { expectKind, loadMapInput, loadReplayInput, readInput, type Input } from "./files";
import { issueLine, mapReport, printIssues, printMapInfo } from "./map";
import { openInScmjs } from "./open";
import { checkPlugin, devPlugin, newPlugin, printPluginCheck, type PluginCheck } from "./plugin";
import { printReplayInfo, replayReport } from "./replay";
import { CliError, dot, mark, pc, plural, print, rows, size } from "./ui";

const json = new Option("--json", "print JSON instead of text, for scripts");
/** The widest a command's term in the overview may be, so its description stays beside it (banner.ts fits 80 columns). */
const TERM_WIDTH = 28;

/** Runs `fn` on each file in turn; a file that fails is said and the rest go on. JSON: one value, or a list for several. */
async function eachFile(paths: string[], asJson: boolean, fn: (input: Input) => Promise<{ data: unknown; lines: string[] }>, rule = true): Promise<unknown[]> {
  const results: unknown[] = [];
  let first = true;
  for (const path of paths) {
    try {
      const { data, lines } = await fn(await readInput(path));
      results.push(data);
      if (!asJson) { if (!first) print(...(rule ? ["", pc.dim("─".repeat(Math.min(process.stdout.columns || 60, 60))), ""] : [""])); print(...lines); }
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      if (asJson) results.push({ file: path, error: e.message });
      else { if (!first) print(""); fail(e); }
      process.exitCode = Math.max(Number(process.exitCode ?? 0), e.exitCode);
    }
    first = false;
  }
  if (asJson) print(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
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
  .helpCommand("help [command]", "show help for a command")
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
        if (next.length > TERM_WIDTH - 2 && i < subs.length - 1) return `${term}|…`;
        term = next;
      }
      return term;
    },
    // The overview has the banner (banner.ts); a command's own help is commander's.
    formatHelp: (cmd, helper) => (cmd.parent ? Help.prototype.formatHelp.call(helper, cmd, helper) : rootHelp(cmd, helper, VERSION)),
  });

program.command("info").description("what a map, replay or bot file holds").helpGroup("Maps and replays:").argument("<files...>", "maps (.scm .scx .chk), replays (.rep) or bots (.scmbot)").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, async (input) => {
    const kind = expectKind(input, "map", "replay", "bot");
    return kind === "map" ? mapInfo(input) : kind === "replay" ? replayInfo(input) : botInfo(input);
  }));

const map = program.command("map").description("read, check and open maps").helpGroup("Maps and replays:");
map.command("info").description("a map's size, players, units, triggers and its check").argument("<maps...>").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, mapInfo));
map.command("check").description("Check Map, as the editor's: errors, then warnings")
  .argument("<maps...>").addOption(json)
  .option("--all", "list notes too, not only errors and warnings")
  .option("--strict", "fail on warnings as well as errors")
  .addHelpText("after", `\nExits 1 when a map has errors (or warnings, with --strict): fit for a CI step.`)
  .action(async (files: string[], o: { json?: boolean; all?: boolean; strict?: boolean }) => {
    const reports = await eachFile(files, !!o.json, async (input) => {
      expectKind(input, "map");
      const r = mapReport(input, await loadMapInput(input));
      const failed = r.issues.some((i) => i.level === "error" || (o.strict && i.level === "warn"));
      if (failed) process.exitCode = Math.max(Number(process.exitCode ?? 0), 1);
      const lines = printIssues(r.issues, !!o.all);
      return { data: { file: r.file.name, name: r.name, issues: r.issues.filter((i) => o.all || i.level !== "info") }, lines: [`${pc.bold(input.name)}  ${issueLine(r.issues)}`, ...lines] };
    }, false) as { issues?: unknown[] }[];
    if (!o.json && files.length > 1) {
      const bad = Number(process.exitCode ?? 0) ? reports.filter((r) => (r as { issues?: { level: string }[] }).issues?.some((i) => i.level === "error" || (o.strict && i.level === "warn"))).length : 0;
      print("", bad ? `${mark.error} ${plural(bad, "map")} of ${files.length} failed the check` : `${mark.ok} ${plural(files.length, "map")} checked, none failed`);
    }
  });
map.command("open").description("open a map in the scmJS app, or the editor in your browser").argument("<map>")
  .option("--browser", "the editor in the browser, even with the app installed")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL)").hideHelp())
  .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "map"); await openInScmjs(input, o); });

/** A map read for a command that changes it: the input and the parsed document, or a CliError. */
async function openForEdit(file: string) {
  const input = await readInput(file);
  expectKind(input, "map");
  return { input, doc: await loadMapInput(input) };
}
/** `--out` for text: the file, or stdout when there is none. */
async function emit(text: string, out: string | undefined, said: string): Promise<void> {
  if (!out) { process.stdout.write(text); return; }
  await writeFile(out, text);
  print(`${mark.ok} ${said} ${pc.dim("→")} ${pc.cyan(out)}`);
}

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
  .option("--out <map>", "write the result here instead of over the map")
  .option("--append", "add the file's triggers after the map's own instead of replacing them")
  .option("--briefing", "the mission briefing's triggers instead")
  .action(async (file: string, from: string, o: { out?: string; append?: boolean; briefing?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const r = importTriggers(doc, from, new Uint8Array(await readFile(from)), { briefing: !!o.briefing, append: !!o.append });
    const w = await writeBack(doc, input.path, o.out ?? null);
    print(`${mark.ok} ${pc.bold(input.name)}: ${plural(r.before, "trigger")} ${pc.dim("→")} ${plural(r.after, "trigger")}${o.append ? pc.dim(` (${r.read} added)`) : ""}${dot}written to ${pc.cyan(w.path)}${dot}${size(w.bytes)}`);
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
  .option("--out <map>", "write the result here instead of over the map")
  .action(async (file: string, from: string, o: { out?: string }) => {
    const { input, doc } = await openForEdit(file);
    const r = importStrings(doc, from, await readFile(from, "utf8"));
    const w = await writeBack(doc, input.path, o.out ?? null);
    print(`${mark.ok} ${pc.bold(input.name)}: ${plural(r.replaced, "string")} replaced, ${r.added} added, ${r.unchanged} unchanged${dot}written to ${pc.cyan(w.path)}${dot}${size(w.bytes)}`);
  });

map.command("build").description("apply the map's TrigScript script and build its programs, as Save does").argument("<map>").addOption(json)
  .option("--out <map>", "write the built map here instead of over the map")
  .option("--check", "compile (and test, with --test) and write nothing")
  .option("--test", "run the script's tests first; a failing test refuses the build")
  .addHelpText("after", `
The script is the one the map keeps (Triggers ▸ TrigScript… in the editor). Its trigger() calls go into the trigger
list and its program()s are built into the file, with the map as you edit it kept beside them, so it opens in the
editor as it was. Needs TypeScript on this computer: npm install typescript. Exits 1 when the script does not
compile, a test fails or the build is refused; nothing is written then.`)
  .action(async (file: string, o: { json?: boolean; out?: string; check?: boolean; test?: boolean }) => {
    const { input, doc } = await openForEdit(file);
    const typescript = await loadTypeScript();
    const r = await buildMap(doc, input.path, typescript, { check: !!o.check, test: !!o.test, out: o.out ?? null });
    if (o.json) print(JSON.stringify({ file: input.name, ...r }, null, 2));
    else print(...printBuild(input.name, r));
    if (!r.ok) process.exitCode = 1;
  });

map.command("diff").description("what changed between two maps").argument("<a>").argument("<b>").addOption(json)
  .option("--all", "list every item; by default a long list is cut at 20")
  .addHelpText("after", `
Exits 1 when the maps differ, 0 when they are the same, like diff.`)
  .action(async (a: string, b: string, o: { json?: boolean; all?: boolean }) => {
    const [x, y] = await Promise.all([openForEdit(a), openForEdit(b)]);
    const d = diffMaps({ name: x.input.name, doc: x.doc }, { name: y.input.name, doc: y.doc });
    print(...(o.json ? [JSON.stringify(d, null, 2)] : printDiff(d, !!o.all)));
    if (!d.same) process.exitCode = 1;
  });

const replay = program.command("replay").description("read and open replays").helpGroup("Maps and replays:");
replay.command("info").description("who played, on what map, for how long, at what APM").argument("<replays...>").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, replayInfo));
replay.command("open").description("watch a replay in the scmJS app, or the editor in your browser").argument("<replay>")
  .option("--browser", "the editor in the browser, even with the app installed")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL)").hideHelp())
  .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "replay"); await openInScmjs(input, o); });

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

program.command("completion", { hidden: true }).description("a completion script for your shell").argument("<shell>", SHELLS.join("|"))
  .addHelpText("after", `
  eval "$(scmjs completion bash)"                        # in ~/.bashrc
  scmjs completion zsh > ~/.zsh/completions/_scmjs       # a folder on $fpath
  scmjs completion fish > ~/.config/fish/completions/scmjs.fish`)
  .action((shell: string) => {
    if (!(SHELLS as readonly string[]).includes(shell)) throw new CliError(`${shell} is not a shell this knows`, `One of ${SHELLS.join(", ")}.`, 2);
    process.stdout.write(completionScript(program, shell as Shell));
  });

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
