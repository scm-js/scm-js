/**
 * scmjs: StarCraft: Brood War maps, replays and bots from the command line. One command, a noun for each kind of
 * thing (`map`, `replay`, `plugin`, `bot`), the editor's own code underneath (docs/cli.md, .claude/internals/cli.md).
 */
import { relative } from "node:path";
import { Command, CommanderError, Help, Option, type HelpContext } from "commander";
import { VERSION } from "./about";
import { rootHelp } from "./banner";
import { setLinkLabel } from "./link";
import { chooseLocale, msg, setLocale, t, translate, unknownLanguage } from "./i18n";
import { commanderError, helpExtras, helpTitle } from "./commanderText";
import { CliError, columns, mark, pc } from "./ui";
import { fail } from "./cmdkit";
import { addInfoCommand } from "./infocmd";
import { addMapCommands, addMapFetchCommand } from "./mapcmd";
import { addMapChangeCommands } from "./mapchangecmd";
import { addGameCommands } from "./gamecmd";
import { addMapPlayCommand, addMapShareCommand, addShareCommand } from "./sharecmd";
import { addMapGitCommands } from "./mapgitcmd";
import { addReplayCommands } from "./replaycmd";
import { addModCommands } from "./modcmd";
import { addPluginCommands } from "./plugincmd";
import { addAccountCommands } from "./accountcmd";
import { addToolCommands } from "./toolcmd";
import { editDistance } from "./words";
export { typedOptions } from "./gamecmd";

/** The widest a command's term in the overview may be, so its description stays beside it (banner.ts fits 80 columns). */
const TERM_WIDTH = 28;

// Output piped into something that stops reading (`| head`): stop quietly with 0, as other commands do, not with a stack.
for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (e: NodeJS.ErrnoException) => { if (e.code === "EPIPE") process.exit(0); else throw e; });
}

/**
 * commander's Command with scmjs's rules: every mistake in the command line itself (an unknown option or command, a
 * missing argument, a value not among the choices) exits 2, as the commands' own checks of their values do; asking
 * for nothing (`scmjs map`, `scmjs --lang ko`) is a request for the help, on standard output with 0 — commander puts
 * it on standard error and exits 1; and a mistyped command is compared with the hidden commands too (`about`, `lsp`).
 */
class ScmjsCommand extends Command {
  override createCommand(name?: string): Command { return new ScmjsCommand(name); }
  override error(message: string, options?: { code?: string; exitCode?: number }): never {
    return super.error(message, { ...options, exitCode: 2 });
  }
  override help(context?: HelpContext): never;
  override help(cb?: (str: string) => string): never;
  override help(context?: HelpContext | ((str: string) => string)): never {
    return typeof context === "function" ? super.help(context) : super.help(context?.error ? undefined : context);
  }
  /** Called by commander for a word that is none of this command's. */
  unknownCommand(): never { return this.unknownName(this.args[0]); }
  unknownName(name: string): never {
    const near = similarNames(name, this.commands.map((c) => c.name()));
    return this.error(`error: unknown command '${name}'${near.length ? `\n(Did you mean ${near.length > 1 ? `one of ${near.join(", ")}` : near[0]}?)` : ""}`, { code: "commander.unknownCommand" });
  }
}

/** The names closest to a mistyped one (two edits at most, as commander's own suggestion), best first. */
export function similarNames(word: string, names: string[]): string[] {
  let best = 3;
  const found: string[] = [];
  for (const name of new Set(names)) {
    if (name.length <= 1) continue;
    const n = editDistance(word, name, true);
    // A short word two edits away from a short name is any word: keep what is nearer than half the name.
    if (n > 2 || (name.length - n) / name.length <= 0.4) continue;
    if (n < best) { best = n; found.length = 0; }
    if (n === best) found.push(name);
  }
  return found.sort();
}

/**
 * The program: its commands, their options and their help, in the language set last (`setLocale`) — the descriptions
 * are made here, so the language is chosen before this runs (below, and `tests/cli-i18n.test.ts` builds one in Korean).
 */
export function buildProgram(): Command {
  const program = new ScmjsCommand("scmjs")
    .description(t("StarCraft: Brood War maps, replays, plugins and bots from the command line"))
    .version(VERSION, "-v, --version", t("print the version"))
    // The program's options stop at the command, so `map check x.scx -v` is not the version (finishProgram gives
    // every command --lang and --no-color, which work in any place).
    .enablePositionalOptions()
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
      // A noun's commands in the order of its groups (finishProgram), the groups in the order of their first command.
      visibleCommands: (cmd) => Help.prototype.visibleCommands.call(new Help(), cmd).map((c, i) => [c, i] as const).sort(([a, i], [b, j]) => (GROUP_RANK.get(a) ?? 0) - (GROUP_RANK.get(b) ?? 0) || i - j).map(([c]) => c),
      groupItems<T extends Command | Option>(unsorted: T[], visible: T[], groupOf: (item: T) => string) { return Help.prototype.groupItems.call(this, unsorted[0] instanceof Command ? visible : unsorted, visible, groupOf as (item: Command | Option) => string) as Map<string, T[]>; },
      subcommandTerm: (cmd) => {
        const subs = cmd.commands.filter((c) => !(c as unknown as { _hidden?: boolean })._hidden).map((c) => c.name());
        // A command that runs as well as having commands of its own (`map test <map>`, `map test record`) shows its usage.
        if (!subs.length || (cmd as unknown as { _actionHandler?: unknown })._actionHandler) return new Help().subcommandTerm(cmd).replace(" [options]", "");
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

  // `scmjs help map diff` is a command of its own, made by finishProgram for every noun.
  program.helpCommand(false);

  addInfoCommand(program);

  const map = program.command("map").description(t("read, check and open maps")).helpGroup(t("Maps and replays:"));
  addMapCommands(map);
  addMapChangeCommands(map);
  addGameCommands(map);
  addMapPlayCommand(map);
  addMapGitCommands(map);
  addMapFetchCommand(map);
  addMapShareCommand(map);
  addReplayCommands(program);
  addShareCommand(program);
  addModCommands(program);
  addPluginCommands(program);
  addAccountCommands(program);
  addToolCommands(program, map);
  finishProgram(program);
  // A change to a map linked to the editor is named there by the command that made it (link.ts).
  program.hook("preAction", (_program, action) => {
    const names: string[] = [];
    for (let c: Command | null = action; c && c.parent; c = c.parent) names.unshift(c.name());
    setLinkLabel(`scmjs ${names.join(" ")}`);
  });
  return program;
}

/**
 * A noun's commands in groups, by task as the guide's chapters have them. One table for the whole noun, so a command
 * keeps its own block; `tests/cli.test.ts` fails on a `map` command in no group.
 */
export const COMMAND_GROUPS: Record<string, [heading: string, names: string[]][]> = {
  map: [
    [msg("Looking inside a map:"), ["info", "check", "dump", "find", "preview", "sounds", "analyze"]],
    [msg("Making a map:"), ["new", "generate", "fetch"]],
    [msg("Changing a map:"), ["set", "settings", "resize", "units", "locations", "terrain", "doodads", "edit", "triggers", "strings", "optimize", "unpack", "pack", "build", "run"]],
    [msg("Maps in git:"), ["diff", "log", "blame", "merge"]],
    [msg("Running a map in the game:"), ["trace", "cost", "test", "coverage", "rush", "balance", "heatmap"]],
    [msg("Sharing:"), ["open", "play", "share"]],
  ],
  mod: [
    [msg("Looking inside a mod:"), ["info", "check", "diff"]],
    [msg("Making a mod:"), ["new", "unpack", "pack", "build"]],
    [msg("In the game:"), ["play", "test", "header"]],
  ],
};
/** Where a command stands in its noun's help, by COMMAND_GROUPS. */
const GROUP_RANK = new WeakMap<Command, number>();

/** The words that run a command: `scmjs map info`. */
const commandPath = (cmd: Command): string => (cmd.parent ? `${commandPath(cmd.parent)} ${cmd.name()}` : cmd.name());

/**
 * What every command gets once they are all defined: the global options in any place (the program's stop at the
 * command), the hint after a mistake naming that command's own help, `help` under every noun, and the groups.
 */
function finishProgram(program: Command): void {
  const all = (c: Command): Command[] => [c, ...c.commands.flatMap(all)];
  for (const [noun, groups] of Object.entries(COMMAND_GROUPS)) {
    const cmd = program.commands.find((c) => c.name() === noun);
    if (!cmd) continue;
    let rank = 0;
    for (const [heading, names] of groups) {
      for (const name of names) {
        const sub = cmd.commands.find((c) => c.name() === name);
        if (sub) { sub.helpGroup(translate(heading)); GROUP_RANK.set(sub, ++rank); }
      }
    }
  }
  for (const cmd of all(program)) {
    if (cmd !== program) {
      // Read from the arguments before the program is built (chooseLocale, picocolors); here so commander takes them.
      cmd.addOption(new Option("--no-color").hideHelp());
      cmd.addOption(new Option("--lang <code>").choices(["en", "ko"]).hideHelp());
      const runs = !!(cmd as unknown as { _actionHandler?: unknown })._actionHandler;
      cmd.showHelpAfterError(pc.dim(cmd.commands.length && !runs ? t("({command} --help lists its commands)", { command: commandPath(cmd) }) : t("({command} --help lists its options)", { command: commandPath(cmd) })));
    }
    // `help` under every noun: `scmjs help map diff`, `scmjs map help diff`, the help of the command named.
    if (cmd.commands.length && !(cmd as unknown as { _actionHandler?: unknown })._actionHandler) {
      cmd.helpCommand(false);
      const help = cmd.command("help", { hidden: true }).description(t("show help for a command")).argument("[command...]")
        .action((path: string[]) => {
          let at = cmd as ScmjsCommand;
          for (const word of path) {
            const next = at.commands.find((c) => c.name() === word && c.name() !== "help");
            if (!next) at.unknownName(word);
            at = next as ScmjsCommand;
          }
          at.help();
        });
      help.helpOption(false).addOption(new Option("--no-color").hideHelp()).addOption(new Option("--lang <code>").choices(["en", "ko"]).hideHelp());
    }
  }
}

// The language is fixed before the program is built, from the arguments and the environment (cli/src/i18n.ts). Tests
// build theirs in English unless they set one.
if (!process.env.VITEST) setLocale(chooseLocale(process.argv.slice(2)));
export const program = buildProgram();

/** The file-system errors that are an ordinary mistake (a name, a folder, a permission), not a fault to report. */
const FILE_ERRORS = new Set(["ENOENT", "EISDIR", "ENOTDIR", "EACCES", "EPERM", "EEXIST", "ENOSPC", "EROFS", "EMFILE", "ENFILE"]);

/**
 * A file-system error no command caught, said as one line naming the path and what is wrong with it: exit 2 (the
 * work could not start), 1 for a disk that filled during a write. Null for anything else.
 */
export function fileProblem(e: unknown): CliError | null {
  const errno = (x: unknown) => (x && typeof x === "object" && typeof (x as NodeJS.ErrnoException).code === "string" && FILE_ERRORS.has((x as NodeJS.ErrnoException).code!) ? (x as NodeJS.ErrnoException) : null);
  const err = errno(e) ?? errno((e as { cause?: unknown } | null)?.cause);
  if (!err) return null;
  const at = err.path ? relative(process.cwd(), err.path) : "";
  const path = !at || at.startsWith("..") || /^[a-z]:/i.test(at) ? (err.path ?? "") : at;
  switch (err.code) {
    case "ENOENT": return new CliError(path ? t("No such file or folder: {path}", { path }) : t("A file or folder is not there"), null, 2);
    case "EISDIR": return new CliError(path ? t("{path} is a folder, not a file", { path }) : t("A folder was given where a file is wanted"), null, 2);
    case "ENOTDIR": return new CliError(path ? t("{path} is not a folder: a part of it is a file", { path }) : t("A file was given where a folder is wanted"), null, 2);
    case "EACCES": case "EPERM": return new CliError(path ? t("{path} cannot be used: permission denied", { path }) : t("Permission denied"), null, 2);
    case "EEXIST": return new CliError(path ? t("{path} is there already", { path }) : t("A file is there already"), null, 2);
    case "EROFS": return new CliError(path ? t("{path} is on a disk that cannot be written", { path }) : t("The disk cannot be written"), null, 2);
    case "ENOSPC": return new CliError(path ? t("The disk is full: {path} was not written whole", { path }) : t("The disk is full"), null, 1);
    default: return new CliError(t("Too many files are open at once"), t("Close some programs, or raise the limit (ulimit -n), and try again."), 2);
  }
}

/** Runs the command line on its arguments. Not a top-level await: the single executable's bundle is CommonJS. */
export async function run(args: string[] = process.argv.slice(2), prog: Command = program): Promise<void> {
  const language = unknownLanguage(args);
  if (language) process.stderr.write(`${mark.warn} ${t("SCMJS_LANG={value} is not a language this speaks (en, ko): English it is", { value: language })}\n`);
  try {
    // `scmjs` on its own is a request for the overview, not a mistake.
    if (!args.length) prog.outputHelp();
    else await prog.parseAsync(args, { from: "user" });
  } catch (e) {
    const known = e instanceof CliError ? e : fileProblem(e);
    if (known) {
      fail(known);
      if (process.env.SCMJS_DEBUG && !(e instanceof CliError) && e instanceof Error) process.stderr.write(pc.dim(`${e.stack}\n`));
      process.exitCode = known.exitCode;
    } else if ((e as NodeJS.ErrnoException | null)?.code === "EPIPE") process.exitCode = 0;
    else if (e instanceof CommanderError) process.exitCode = e.exitCode;
    else { process.stderr.write(`${mark.error} ${pc.red(t("Something went wrong"))}: ${e instanceof Error ? e.stack ?? e.message : e}\n${pc.dim(`  ${t("Please report it: {url}", { url: "https://github.com/scm-js/scm-js/issues" })}`)}\n`); process.exitCode = 1; }
  }
}

// tests/cli.test.ts imports the program to read its help; only the command runs it.
if (!process.env.VITEST) void run();
