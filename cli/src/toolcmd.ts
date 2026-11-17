/** The tool's own commands: completion, init, doctor, mcp, lsp and about. */
import { Argument, Command } from "commander";
import { aboutReport, printAbout } from "./about";
import { completionScript, SHELLS, type Shell } from "./completion";
import { doctorJson, doctorReport, printDoctor } from "./doctor";
import { initFolder, printInit, printRecipe } from "./init";
import { createMcpServer, serveStdio } from "./mcp";
import { serveLsp } from "./lsp";
import { setLocale, t } from "./i18n";
import { CliError, columns, print } from "./ui";
import { jsonOption, forceOption } from "./options";


export function addToolCommands(program: Command, map: Command): void {
  const json = jsonOption();
  program.command("completion", { hidden: true }).description(t("a completion script for your shell")).addArgument(new Argument("<shell>", t("the shell")).choices(SHELLS))
    .addHelpText("after", `
  eval "$(scmjs completion bash)"                        # ${t("in ~/.bashrc")}
  scmjs completion zsh > ~/.zsh/completions/_scmjs       # ${t("a folder on $fpath")}
  scmjs completion fish > ~/.config/fish/completions/scmjs.fish`)
    .action((shell: string) => {
      if (!(SHELLS as readonly string[]).includes(shell)) throw new CliError(t("{shell} is not a shell this knows", { shell }), t("One of {list}.", { list: SHELLS.join(", ") }), 2);
      process.stdout.write(completionScript(program, shell as Shell));
    });

  // Hidden from the overview, which holds 23 lines (banner.ts); `scmjs help init`, `map --help` and docs/cli.md name it.
  program.command("init", { hidden: true }).description(t("set a folder of maps up for git and GitHub")).helpGroup(t("Maps and replays:"))
    .argument("[folder]", t("the folder the maps are in"), ".").addOption(json)
    .option("--print", t("print what would be written, to paste by hand, and write nothing"))
    .option("--git", t("git init the folder when it is in no git repository (never done without it)"))
    .addOption(forceOption(t("replace a README.md or workflow that is there, and set a git setting that holds another value")))
    .addHelpText("after", "\n" + t(`Writes what is not there yet:
  .gitattributes              *.scx, *.scm and *.chk read through scmjs map dump by git diff, and merged through
                              scmjs map merge by git merge
  .gitignore                  *.bak, the copy the desktop app's Save keeps, and *.tests/ and *.clips/, what a failed
                              map test leaves beside the map
  .github/workflows/maps.yml  map check on every push and pull request (and map build --check for maps with a
                              TrigScript script), with this version of scmjs pinned; a folder set up after another
                              is added to the maps it checks
  README.md                   the maps, and the commands to check, dump and diff them
and, in the git repository, git config diff.scmjs.textconv, .xfuncname and .cachetextconv, and merge.scmjs.name and
.driver, which are per clone. .gitattributes and .gitignore get only the lines they lack; nothing else that is there
is changed without --force. Says which maps fail the check now. Exits 2 when there is no such folder, or when its maps
are all in folders below it (--force sets it up anyway).`))
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
    .option("--folder <folder>", t("the folder the tools work in, when the AI tool starts the server somewhere else"))
    .option("--allow-outside", t("let the tools read and write files outside this folder, and read scmjs.dev links"))
    // The tools' names from the server itself, so the list is never short of one; made only when the help is shown.
    .addHelpText("after", () => "\n" + t(`Speaks the Model Context Protocol on standard input and output, so an AI tool that runs on this computer (Claude
Code, Cursor, VS Code, …) can read, check, search, compare and change maps with the same code these commands use.
Each tool is a command, with its options as arguments by the same names:`) + "\n" + wrapWords(createMcpServer().tools.join(", "), 116, "  ") + "\n" + t(`The tools that run the game or draw it (map_preview, map_analyze, map_trace, map_cost, map_coverage, map_balance) need a
copy of StarCraft here, as the commands do; doctor says whether there is one. The account tools (account_info, library_…,
share, replay_sync) use the session scmjs login keeps, and share, replay_sync, library_unlink and library_remove first
say what they would do and act only when called again with confirm. Paths are files in the folder the tool started the
server in, or the one --folder names, and a path outside it is refused unless the server was started with
--allow-outside. Claude Desktop installs it as an extension: the scmjs-mcp-….mcpb files on the release page.
Claude Code, in your maps folder:`) + `
  claude mcp add scmjs -- npx -y @scm-js/cli mcp
${t("Anything else takes the same thing as JSON:")}
  { "mcpServers": { "scmjs": { "command": "npx", "args": ["-y", "@scm-js/cli", "mcp", "--folder", "<your maps folder>"] } } }`)
    // English whatever the language: the tools' descriptions and results are read by the model, not shown.
    .action(async (o: { allowOutside?: boolean; folder?: string }) => { setLocale("en"); await serveStdio({ allowOutside: !!o.allowOutside, folder: o.folder }); });

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
    .action(async (o: { map?: string }) => {
      // Typed at a terminal, it would wait for an editor's messages and say nothing.
      if (process.stdin.isTTY) throw new CliError(t("scmjs lsp is a language server: a text editor starts it and speaks to it on standard input and output"), t("scmjs help lsp says how; docs.scmjs.dev/cli has the setup for each editor."), 2);
      setLocale("en");
      await serveLsp({ map: o.map });
    });

  // Hidden from the overview, which holds 23 lines (banner.ts): the mod noun took its line.
  program.command("about", { hidden: true }).description(t("this version, any newer one, and links")).helpGroup(t("This tool:")).addOption(json)
    .action(async (o: { json?: boolean }) => {
      const r = await aboutReport();
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printAbout(r)));
    });
}

/** `text` broken at spaces into lines of at most `width` columns, each after `indent`. */
function wrapWords(text: string, width: number, indent = ""): string {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && columns(indent + line + " " + word) > width) { lines.push(indent + line); line = word; } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(indent + line);
  return lines.join("\n");
}
