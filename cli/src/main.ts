/**
 * scmjs: StarCraft: Brood War maps and replays from the command line. One command, a noun for each kind of thing
 * (`map`, `replay`), the editor's own code underneath (docs/cli.md, .claude/internals/cli.md).
 */
import { Command, Option } from "commander";
import { aboutReport, printAbout, VERSION } from "./about";
import { expectKind, loadMapInput, loadReplayInput, readInput, type Input } from "./files";
import { issueLine, mapReport, printIssues, printMapInfo } from "./map";
import { openInScmjs } from "./open";
import { printReplayInfo, replayReport } from "./replay";
import { CliError, dot, mark, pc, plural, print, rows, size } from "./ui";

const json = new Option("--json", "print JSON instead of text, for scripts");

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

const program = new Command("scmjs")
  .description("StarCraft: Brood War maps and replays from the command line")
  .version(VERSION, "-v, --version", "print the version")
  .helpOption("-h, --help", "show help for a command")
  .addOption(new Option("--no-color", "plain text, no colour (also NO_COLOR=1)"))
  .showSuggestionAfterError()
  .helpCommand("help [command]", "show help for a command")
  .configureOutput({ outputError: (text, write) => write(text.replace(/^error: /, `${mark.error} `)) })
  .showHelpAfterError(pc.dim("(scmjs --help lists the commands)"))
  .configureHelp({
    styleTitle: (s) => pc.bold(s),
    styleCommandText: (s) => pc.cyan(s),
    styleSubcommandText: (s) => pc.cyan(s),
    styleArgumentText: (s) => pc.yellow(s),
    styleOptionText: (s) => pc.green(s),
  })
  .addHelpText("after", () => `
${pc.bold("Examples:")}
  ${pc.dim("$")} scmjs info "(2)Destination.scx"       what a map or a replay holds
  ${pc.dim("$")} scmjs map check *.scx                 Check Map on every map here
  ${pc.dim("$")} scmjs replay open game.rep            watch it in the editor
  ${pc.dim("$")} scmjs about                           this version, and where things are

${pc.dim("Docs: https://docs.scmjs.dev")}`);

program.command("about").description("this version of scmjs, and where things are").addOption(json)
  .action((o: { json?: boolean }) => {
    const r = aboutReport();
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printAbout(r)));
  });

program.command("info").description("what a map, replay or bot file holds").argument("<files...>", "maps (.scm .scx .chk), replays (.rep) or bots (.scmbot)").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, async (input) => {
    const kind = expectKind(input, "map", "replay", "bot");
    return kind === "map" ? mapInfo(input) : kind === "replay" ? replayInfo(input) : botInfo(input);
  }));

const map = program.command("map").description("read, check and open maps");
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

const replay = program.command("replay").description("read and open replays");
replay.command("info").description("who played, on what map, for how long, at what APM").argument("<replays...>").addOption(json)
  .action(async (files: string[], o: { json?: boolean }) => void await eachFile(files, !!o.json, replayInfo));
replay.command("open").description("watch a replay in the scmJS app, or the editor in your browser").argument("<replay>")
  .option("--browser", "the editor in the browser, even with the app installed")
  .addOption(new Option("--editor <url>", "the editor's address (SCMJS_EDITOR_URL)").hideHelp())
  .action(async (file: string, o: { browser?: boolean; editor?: string }) => { const input = await readInput(file); expectKind(input, "replay"); await openInScmjs(input, o); });

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CliError) { fail(e); process.exitCode = e.exitCode; }
  else { process.stderr.write(`${mark.error} ${pc.red("Something went wrong")}: ${e instanceof Error ? e.stack ?? e.message : e}\n${pc.dim("  Please report it: https://github.com/scm-js/scm-js/issues")}\n`); process.exitCode = 1; }
}
