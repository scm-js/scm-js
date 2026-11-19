/** The `scmjs mod` commands: commander's side of cli/src/mod/. */
import { relative } from "node:path";
import { Command, Option } from "commander";
import { expectKind, readInput, STDIO } from "./files";
import { FORMATS } from "./report";
import { checkModSource, printModCheck } from "./mod/check";
import { diffModSources, printModDiff } from "./mod/diff";
import { modInfo, printModInfo } from "./mod/info";
import { newMod, parseTables } from "./mod/new";
import { checkModAndMap, gameFilesOrNull, openMod, slowLine } from "./mod/open";
import { sourceHash } from "./mod/hash";
import { writeModHeader } from "./mod/header";
import { checkPackOut, MOD_COMPRESSIONS, packMod, readModFolder, type ModCompression } from "./mod/pack";
import { pageRace, playBotOf, playOnPage, playSet } from "./mod/play";
import { unpackMod } from "./mod/unpack";
import { shownPath } from "./mod/source";
import { t } from "./i18n";
import { CliError, dot, mark, num, pc, print, rows, size, printErr } from "./ui";
import { fail, say } from "./cmdkit";
import { mapTestAction } from "./gamecmd";
import { jsonOption, starcraftOption, outOption, forceOption, engineOption, playOption, raiseExitCode } from "./options";

export function addModCommands(program: Command): void {
  const json = jsonOption();
  const underMod = () => starcraftOption(t("your installation of StarCraft (SCMJS_STARCRAFT), whose files are under the mod; found in the usual places otherwise"));

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
        if (asJson) results.push({ file: path, path, error: e.message }); else fail(e);
        raiseExitCode(e.exitCode);
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
    .addOption(underMod())
    .action(async (paths: string[], o: { json?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      await eachMod(paths, !!o.json, async (path) => {
        // (a mod of hundreds of megabytes takes seconds to read and hash: said on standard error after a moment)
        const done = slowLine(pc.dim(t("Reading {mod} and working out its hash…", { mod: path })));
        try { const source = await openMod(path, base); const r = modInfo(source, await sourceHash(source)); return { data: { file: path, ...r }, lines: printModInfo(r) }; } finally { done(); }
      });
    });

  modCmd.command("unpack").description(t("a mod as a folder of text and pictures, to edit and keep in git")).argument("<mod>", t("a folder, an .mpq, a mod's .exe or a .zip")).argument("<folder>", t("the folder to write")).addOption(json)
    .option("--palette <name>", t("the tileset whose palette the GRPs are drawn with"), "jungle")
    .addOption(underMod())
    .addHelpText("after", "\n" + t(`Each table, string table, iscript, AI script, overlay and .graft file is written as text, and each GRP as a PNG
sheet, only when that text or picture packs back into the same bytes; anything else is kept as it is under files/,
and mod.json says which and why. Sounds, maps and every other file are copied as they are, plugins and FireGraft
files too (never run). The names beside the tables and in the AI script come from the mod's own string tables, else
your copy of the game's. A folder an earlier unpack wrote is refused, since your edits are there: --force replaces
it whole (its dot files, such as .git, are kept).`))
    .addOption(forceOption(t("replace a mod folder that is there")))
    .action(async (path: string, dir: string, o: { json?: boolean; palette: string; starcraft?: string; force?: boolean }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const source = await openMod(path, base);
      const r = await unpackMod(source, dir, { base, palette: o.palette, force: o.force });
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
    .addOption(outOption("file", t("the MPQ to write (<folder>.mpq beside the folder by default); - for standard output")))
    .option("--folder <out>", t("write the files loose in the game's paths instead (for samase, or the play page)"))
    .option("--compression <method>", t("{methods} for every file", { methods: MOD_COMPRESSIONS.join(", ") }), "zlib")
    .addOption(underMod())
    .addHelpText("after", "\n" + t(`Every file under the folder's tables/, strings/, iscript/, ai/, overlays/, graphics/, sounds/, grafts/, maps/ and
files/ goes in, at the game's path mod.json and its own path say. The same folder gives the same bytes every time. A
PNG that is no longer in its palette's colours is brought to the nearest, and a sound that is not a WAV is converted
with ffmpeg. MPQDraft makes a self-executing mod from the MPQ; Chaoslauncher and FireGraft load it as it is.`))
    .action(async (dir: string, o: { json?: boolean; out?: string; folder?: string; compression: string; starcraft?: string }) => {
      if (!(MOD_COMPRESSIONS as readonly string[]).includes(o.compression)) throw new CliError(t("--compression takes {methods}, not \"{value}\"", { methods: MOD_COMPRESSIONS.join(", "), value: o.compression }), null, 2);
      checkPackOut(o);
      const r = await packModFolder(dir, { out: o.out, folder: o.folder, compression: o.compression as ModCompression, starcraft: o.starcraft });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      say(r.path === STDIO, ...printPacked(r));
    });

  /** Opens a folder mod unpack or mod new wrote, and packs it (`--out -`: the MPQ to standard output). */
  async function packModFolder(dir: string, o: { out?: string; folder?: string; compression: ModCompression; starcraft?: string }) {
    const manifest = await readModFolder(dir);
    return packMod(dir, manifest, { out: o.out, folder: o.folder, compression: o.compression, base: await gameFilesOrNull(o.starcraft), stdout: process.stdout });
  }

  function printPacked(r: Awaited<ReturnType<typeof packMod>>): string[] {
    return [
      `${mark.ok} ${pc.bold(r.path === STDIO ? t("standard output") : shownPath(r.path))}: ${t("{n, plural, one {# file} other {# files}}", { n: r.members })}${r.compression ? `${dot}${r.compression}` : `${dot}${t("loose")}`}${dot}${size(r.bytes)}`,
      ...r.converted.map((c) => `  ${pc.dim(t("{file} converted to a WAV", { file: c }))}`),
      ...r.quantised.map((q) => `${mark.warn} ${t("{file}: {pixels, plural, one {# pixel} other {# pixels}} in {colours, plural, one {# colour} other {# colours}} not in the palette, brought to the nearest", { file: q.file, pixels: q.pixels, colours: q.colours })}`),
      ...(r.left.length ? [pc.dim(`  ${t("Left out (not in a mod's folders): {list}", { list: `${r.left.slice(0, 6).join(", ")}${r.left.length > 6 ? " …" : ""}` })}`)] : []),
    ];
  }

  modCmd.command("check").description(t("mistakes across the tables: pictures, scripts, sounds and references that are not there")).argument("<mods...>").addOption(json)
    .option("--all", t("list every finding; by default a long list is cut at 40"))
    .addOption(underMod())
    .addHelpText("after", "\n" + t(`Errors: a reference past its table (a unit's weapon, flingy, sprite or image), a string past its string table, an
image with no GRP, an image whose iscript entry is missing, a button set or requirement for something that is not
there. Warnings: a weapon or iscript entry the mod added that nothing uses, a sound row with no file, two tables in
different extended layouts, units with the same name. What the mod leaves as the game had it is not judged.
Exits 1 when there is an error.`))
    .action(async (paths: string[], o: { json?: boolean; all?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      await eachMod(paths, !!o.json, async (path) => {
        const r = await checkModSource(await openMod(path, base), base);
        if (r.failed) raiseExitCode(1);
        return { data: { file: path, ...r }, lines: printModCheck(r, { all: !!o.all }) };
      });
    });

  modCmd.command("diff").description(t("what changed between two mods, or what one changes in the game, as a changelog")).argument("<a>", t("a mod: a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).argument("[b]", t("the other mod; with none, the game against <a>")).addOption(json)
    .option("--all", t("list every change; by default each kind is cut at 30"))
    .addOption(underMod())
    .addHelpText("after", "\n" + t("With two mods, exits 1 when they differ and 0 when they are the same, as map diff does; with one, 0 (what it changes in the game is the answer, not a difference found)."))
    .action(async (a: string, b: string | undefined, o: { json?: boolean; all?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const r = await diffModSources(await openMod(a, base), b ? await openMod(b, base) : null, base);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : printModDiff(r, { all: !!o.all })));
      if (b && !r.same) raiseExitCode(1);
    });

  modCmd.command("new").description(t("an empty mod folder: mod.json and a README")).argument("<folder>").addOption(json)
    .option("--name <name>", t("the mod's name (the folder's by default)"))
    .option("--tables <names>", t("start from the game's own tables, as text from your copy of the game: units,weapons,… or all"))
    .addOption(forceOption(t("replace a mod folder that is there")))
    .addOption(underMod())
    .action(async (dir: string, o: { json?: boolean; name?: string; tables?: string; force?: boolean; starcraft?: string }) => {
      const tables = o.tables === undefined ? undefined : parseTables(o.tables);
      const r = await newMod(dir, o.name, { force: o.force, tables, base: tables ? await gameFilesOrNull(o.starcraft) : null });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(`${mark.ok} ${t("{name}: {files} in {folder}", { name: pc.bold(r.name), files: r.files.join(", "), folder: pc.cyan(relative(process.cwd(), r.dir) || ".") })}`, pc.dim(`  ${tables ? t("Edit the tables' text, then scmjs mod pack {folder}; more of the game's files go under files/ at their paths.", { folder: dir }) : t("Put the game's files you change under files/ at their paths, start from the game's tables with --tables units,weapons, or from a mod: scmjs mod unpack <mod> {folder}", { folder: dir })}`));
    });

  modCmd.command("build").description(t("check the folder, then pack it; a check error stops it")).argument("<folder>").addOption(json)
    .addOption(outOption("file", t("the MPQ to write (<folder>.mpq beside the folder by default); - for standard output")))
    .option("--folder <out>", t("write the files loose in the game's paths instead"))
    .option("--compression <method>", t("{methods} for every file", { methods: MOD_COMPRESSIONS.join(", ") }), "zlib")
    .option("--ignore-errors", t("pack even when the check finds errors"))
    .addOption(new Option("--force").hideHelp())
    .addOption(underMod())
    .action(async (dir: string, o: { json?: boolean; out?: string; folder?: string; compression: string; ignoreErrors?: boolean; force?: boolean; starcraft?: string }) => {
      if (!(MOD_COMPRESSIONS as readonly string[]).includes(o.compression)) throw new CliError(t("--compression takes {methods}, not \"{value}\"", { methods: MOD_COMPRESSIONS.join(", "), value: o.compression }), null, 2);
      checkPackOut(o);
      const piped = o.out === STDIO;
      const base = await gameFilesOrNull(o.starcraft);
      await readModFolder(dir);
      const check = await checkModSource(await openMod(dir, base), base);
      // (--force is the old spelling of --ignore-errors, kept for scripts.)
      if (check.failed && !o.ignoreErrors && !o.force) {
        if (o.json) print(JSON.stringify({ check, packed: null }, null, 2)); else say(piped, ...printModCheck(check), "", `${mark.error} ${t("Not packed: the check found {n, plural, one {# error} other {# errors}}", { n: check.errors })} ${pc.dim(t("(--ignore-errors packs anyway)"))}`);
        process.exitCode = 1;
        return;
      }
      const packed = await packModFolder(dir, { out: o.out, folder: o.folder, compression: o.compression as ModCompression, starcraft: o.starcraft });
      if (o.json) { print(JSON.stringify({ check, packed }, null, 2)); return; }
      say(piped, ...printModCheck(check), ...printPacked(packed));
    });

  modCmd.command("play").description(t("play the mod on the play page in your browser")).argument("<mod>", t("a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).addOption(json)
    .option("--map <file>", t("start this map with the mod (otherwise the page offers its maps)"))
    .option("--bot <bot>", t("a bot for the other side: a .scmbot file, or a bot of the play page by its key (cosmonarchy-example, mcrave, ualbertabot, example)"))
    .option("--race <race>", t("the bot's race: zerg, terran, protoss or random, or a race the mod's mod.json declares, by its name or number"))
    .option("--start", t("with --bot, start the game at once instead of showing the setup screen"))
    .addOption(underMod())
    .addOption(playOption())
    .addHelpText("after", "\n" + t(`Opens scmjs.dev/play in your browser and hands it every file of the mod, its plugins and FireGraft files with them,
and the mod's hash, which the page works out again from the same files. The page keeps the files that differ from
your copy of the game. Nothing is uploaded: the page keeps the mod in your browser. A mod with plugins or a
FireGraft project is opened with ?lift=live, where they run. Waits up to five minutes for the page.`) + "\n\n" + t(`With --bot the map is on the setup screen with the bot in the row beside yours, saying whether it was made for the mod
(scmjs mod header --bot), plays vanilla data, or was made for another; press Start Game, or give --start. A mod with
plugins plays the map with its own settings, as the runners do. A bot of the play page needs a scmjs.dev account (the
page asks you to sign in); your own .scmbot file does not, and the page keeps it as Options → Add a bot from a file…
does.`) + "\n\n" + t(`BROWSER=none opens no browser: the command prints the page's address and waits for it to be opened. With --json the
address goes to standard error, and the result to standard output once the page has taken the mod.`))
    .action(async (path: string, o: { json?: boolean; map?: string; bot?: string; race?: string; start?: boolean; starcraft?: string; play?: string }) => {
      if (o.bot && !o.map) throw new CliError(t("--bot needs --map: the bot plays on a map."), null, 2);
      if (o.race && !o.bot) throw new CliError(t("--race is the bot's: use it with --bot."), null, 2);
      if (o.start && !o.bot) throw new CliError(t("--start is for a game with a bot: use it with --bot (a map alone always starts at once)."), null, 2);
      const bot = o.bot ? playBotOf(o.bot) : null;
      const base = await gameFilesOrNull(o.starcraft);
      const source = await openMod(path, base);
      // (A race the mod declares in its mod.json is taken by its name or number.)
      const botRace = o.race ? pageRace(o.race, source.races) : undefined;
      const set = await playSet(source);
      const map = o.map ? await readInput(o.map) : null;
      if (map) expectKind(map, "map");
      if (!o.json) print(`${pc.bold(set.name)}: ${t("{n, plural, one {# file} other {# files}} to hand over", { n: set.total.files })}${set.plugins + set.firegraft ? pc.dim(` ${t("(and {n, plural, one {# plugin or FireGraft file} other {# plugins and FireGraft files}})", { n: set.plugins + set.firegraft })}`) : ""}${dot}${size(set.total.bytes)}${dot}${pc.dim(t("hash {hash}", { hash: set.hash }))}`);
      // (with --json, standard output is the JSON alone: the address and the page's words go to standard error)
      const r = await playOnPage(set, { map: map && { name: map.name, bytes: map.bytes }, bot, botRace, start: o.start, play: o.play, live: o.json ? (line) => printErr(line) : (line) => print(line) });
      if (o.json) { print(JSON.stringify({ name: set.name, hash: set.hash, withoutPlugins: set.withoutPlugins, files: set.files.map((f) => ({ path: f.path, bytes: f.bytes.length })), ...r }, null, 2)); }
      else if (r.error) throw new CliError(t("The play page said: {error}", { error: r.error }), null, 1);
      else print(`${mark.ok} ${r.shown ? (r.bot ? t("On the play page's setup screen: press Start Game") : t("On the play page's setup screen")) : t("Playing on the play page")}`, ...(r.bot ? rows([[t("Bot"), r.bot]]) : []));
      if (r.error) process.exitCode = 1;
    });

  modCmd.command("header").description(t("the mod's units, weapons, upgrades and techs by name, for a bot made for it (C++ and JSON)")).argument("<mod>", t("a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).addOption(json)
    .addOption(outOption("folder", t("where the files go (the working folder by default)")))
    .option("--namespace <name>", t("the C++ namespace, and the files' name (the mod's name made an identifier by default)"))
    .option("--bot", t("--out is a bot's folder: its scmbot.json gains the mod, which the bot file then carries"))
    .option("--js", t("for a JavaScript bot: <Mod>.mjs in place of the C++ header"))
    .addOption(underMod())
    .addHelpText("after", "\n" + t(`Writes <Mod>.h, C++ for a BWAPI bot built with scmbot (Cosmonarchy_BW::UnitTypes::Terran_Mason is a
BWAPI::UnitType, Ids::Units::Terran_Mason the number), and <Mod>.ids.json, the same for other languages. Every name
in the mod's tables is there, as the editor shows it. Both carry the mod's name and hash; with --bot, scmjs bot build
writes them into the .scmbot file, and the runners say whether the game is the mod the bot was made for.`) + "\n\n" + t(`With --js, <Mod>.mjs in place of the header: the same ids as a JavaScript module (UnitTypes.Terran_Mason). A
JavaScript bot is given the mod's names and its name and hash at run time anyway; the module is for an editor's
completion, and for ids pinned to one version of the mod.`))
    .action(async (path: string, o: { json?: boolean; out?: string; namespace?: string; bot?: boolean; js?: boolean; starcraft?: string }) => {
      const base = await gameFilesOrNull(o.starcraft);
      const r = await writeModHeader(await openMod(path, base), base, { out: o.out, namespace: o.namespace, bot: o.bot, js: o.js });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      print(`${mark.ok} ${pc.bold(r.mod.name)}: ${t("{units} units, {weapons} weapons, {upgrades} upgrades, {techs} techs named", { units: num(r.counts.units), weapons: num(r.counts.weapons), upgrades: num(r.counts.upgrades), techs: num(r.counts.techs) })}${dot}${pc.dim(t("hash {hash}", { hash: r.mod.hash }))}`,
        ...rows([
          [o.js ? t("Module") : t("Header"), pc.cyan(shownPath(r.files.header))],
          [t("Ids"), pc.cyan(shownPath(r.files.ids))],
          [t("Bot"), r.files.scmbot ? t("{file} now names the mod: build the bot again", { file: shownPath(r.files.scmbot) }) : null],
          [t("From the game"), r.fromGame.length ? t("the names of {list}: the mod has not got them", { list: r.fromGame.join(", ") }) : null],
        ]));
    });

  modCmd.command("test").description(t("map test with the mod laid over the game")).argument("<mod>", t("a mod: a folder, an .mpq, a mod's .exe, a .zip, or a folder mod unpack wrote")).argument("<map>", t("the map whose tests run")).argument("[tests...]", t("tests files (JSON); <map>.tests.json beside the map by default")).addOption(json)
    .option("--format <kind>", `${FORMATS.join(", ")}`, "text")
    .addOption(outOption("folder", t("where the replays of failing scenarios go (<map>.tests/ beside the map)")))
    .option("--frames <n>", t("frames a scenario runs when it does not say (24 a second)"), "2400")
    .option("--seed <n>", t("the game's seed when a scenario does not say"), "1")
    .option("--only <name>", t("play only the scenario of this name; give it again for another"), (v: string, before?: string[]) => [...(before ?? []), v])
    .option("--show", t("under each scenario, what its game did: how it ended, the lines shown, the triggers that fired"))
    .option("--all", t("with --show, every line shown and trigger fired; long lists are cut otherwise"))
    .option("--save", t("write the scenarios read from standard input into <map>.tests.json, one of the same name replaced"))
    .option("-u, --update", t("a scenario driven by a replay: write what the game gives now into the expectations that no longer hold"))
    .addOption(underMod())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`The same as scmjs map test <map> --mod <mod>: each scenario played in the game with the mod's files over the game's.
Needs a game engine whose runners take a mod.`))
    .action(async (path: string, file: string, tests: string[], o: Parameters<typeof mapTestAction>[2]) => { await checkModAndMap(path, file); await mapTestAction(file, tests, { ...o, mod: path }); });
}
