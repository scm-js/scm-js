/** The `scmjs plugin` and `scmjs bot` commands. */
import { relative } from "node:path";
import { Command, Option } from "commander";
import { BOT_GUIDE, runBot, updateBot } from "./bot";
import { botRunValues, gameKind, ladderValues, looksLikeMapSettings, runBotGame } from "./botrun";
import { ladderJson, parseEntrants, parseRaces, printLadder, runLadder } from "./ladder";
import { gameMap, removeGameMap } from "./trace";
import { STDIO, openMap } from "./files";
import { checkPlugin, devPlugin, newPlugin, printPluginCheck, type PluginCheck } from "./plugin";
import { gameFilesOrNull } from "./mod/open";
import { modOverlay } from "./mod/overlay";
import { t } from "./i18n";
import { CliError, dot, mark, pc, print, printErr } from "./ui";

import { jsonOption, starcraftOption, outOption, forceOption, engineOption, editorUrlOption } from "./options";

export function addPluginCommands(program: Command): void {
  const json = jsonOption();
  const plugin = program.command("plugin").description(t("start, check and run a plugin for the editor")).helpGroup(t("Plugins and bots:"));
  plugin.command("new").description(t("a plugin to start from, in a new folder")).argument("[name]", t("the plugin's name, such as \"Base Check\""))
    .addOption(outOption("folder", t("the folder to write it in (default plugin-<id>)")))
    .addOption(new Option("--dir <folder>", t("the folder to write it in (default plugin-<id>)")).hideHelp())
    .option("--id <id>", t("the plugin's id: lowercase letters, digits and dashes (made from the name by default)"))
    .action((name: string | undefined, o: { out?: string; dir?: string; id?: string }) => {
      if (o.out !== undefined && o.dir !== undefined) throw new CliError(t("--out and --dir are the same option: give one"), null, 2);
      const folder = o.out ?? o.dir;
      if (folder === STDIO) throw new CliError(t("A plugin is a folder of files: --out - (standard output) cannot take it"), t("Name a folder, or leave --out off for plugin-<id>."), 2);
      const made = newPlugin({ name, dir: folder, id: o.id });
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
    .addOption(editorUrlOption(t("the editor's address (SCMJS_EDITOR_URL), such as a local one")))
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
  bot.command("run").description(t("play the bot against the game's computers on a map, with no page")).argument("<bot>", t("a .scmbot file, or a bot written in JavaScript or TypeScript (.js, .mjs, .ts)")).argument("<map>", t("a map StarCraft itself opens: a .scm or .scx")).addOption(json)
    .option("--race <race>", t("the bot's race: zerg, terran, protoss or random"), "random")
    .option("--opponents <races>", t("the game's computers, a race each (zerg,terran)"), "zerg")
    .option("--seed <n>", t("the game's seed; the same seed, bot and map give the same game"))
    .option("--frames <n>", t("stop after this many frames when nobody has won (24 a second)"), "50000")
    .option("--every <n>", t("frames between progress lines; 0 for none"), "1000")
    .option("--data <folder>", t("a folder the bot keeps its files in between games"))
    .option("--mod <mod>", t("play a mod: its files, its plugins and its FireGraft project (a mod folder, an .mpq, a mod's .exe or .zip, or the release as its makers ship it)"))
    .option("--ums", t("play the map with its own settings (the default for a mod with plugins)"))
    .option("--melee", t("play a melee game even on a mod with plugins"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`The game is the play page's engine, fetched once (about 25 MB) and kept; the game's own files come from your copy
of StarCraft, Remastered or 1.16.1. Prints what the bot says and each side's purse and supply as it plays, then who
won. Exits 1 when the bot printed errors, 2 when the game could not start.`) + "\n\n" + t(`With --mod the mod's plugins run beside the bot, and the first lines say whether the bot was made for the mod
(scmjs mod header --bot), plays vanilla data, or was made for another mod, which plays all the same.`) + "\n" + t(`--mod needs a play page whose engine runs a mod's code ("mods": 2 in its engine/current.json); with an older one
the command stops and says which version it needs.`))
    .action(async (botFile: string, map: string, o: { json?: boolean; race: string; opponents: string; seed?: string; frames: string; every: string; data?: string; mod?: string; ums?: boolean; melee?: boolean; starcraft?: string; engine?: string }) => {
      if (o.ums && o.melee) throw new CliError(t("--ums and --melee: one kind of game"), null, 2);
      // (every value read before the engine or the game is touched)
      const { race, opponents, seed, frames, every } = await botRunValues(o);
      const overlay = o.mod ? modOverlay(o.mod, () => gameFilesOrNull(o.starcraft), { code: true }) : null;
      let r;
      try {
        r = await runBotGame(botFile, map, {
          race, opponents, seed, frames, every,
          data: o.data, starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line),
          mod: overlay, game: o.ums ? "ums" : o.melee ? "melee" : undefined,
        });
      } finally { overlay?.remove(); }
      // (the mod as mod test's JSON has it, at the top: its name and hash, from what the game ran)
      if (o.json) print(JSON.stringify({ bot: botFile, map, ...(o.mod ? { mod: r.start?.code ? { name: r.start.code.name, hash: r.start.code.hash } : null } : {}), ...r }, null, 2));
      if (r.exitCode) process.exitCode = r.exitCode;
    });

  bot.command("ladder").description(t("a round robin of bots and the game's computer over maps: a table, Elo and every replay"))
    .argument("<bots...>", t("bots (.scmbot files, or .js, .mjs, .ts) and computer; a race after a colon: mybot.scmbot:p, computer:t")).addOption(json)
    .requiredOption("--maps <maps...>", t("the maps to play on"))
    .option("--races <races>", t("the races a side plays when it has none of its own: letters of z, t, p and r (random) run together, or words with commas"), "r")
    .option("--games <n>", t("games of each pairing on each map, in each race, a seed each (1, 2, 3, …)"), "1")
    .option("--seeds <list>", t("the seeds to play, comma separated, in place of --games"))
    .option("--frames <n>", t("stop a game nobody has won after this many frames (24 a second)"), "50000")
    .addOption(outOption("folder", t("where the replays and ladder.json go (default: ladder-<date>-<time> here)")))
    .addOption(forceOption(t("take out the replays and ladder.json of an earlier ladder in --out first")))
    .option("--data <folder>", t("where each bot keeps its files between games (default: the ladder's folder)"))
    .option("--parallel <n>", t("games played at once"), "1")
    .option("--timeout <seconds>", t("how long a bot may think over one frame before it counts as hung (the first frame: 5 minutes at least)"), "60")
    .option("--mod <mod>", t("play a mod: its files, its plugins and its FireGraft project (a mod folder, an .mpq, a mod's .exe or .zip, or the release as its makers ship it)"))
    .option("--ums", t("play the map with its own settings (the default for a mod with plugins)"))
    .option("--melee", t("play a melee game even on a mod with plugins"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`Every pairing plays on every map: a bot against the computer once a seed, two bots both ways round (who is first in
the lobby). Two bots are two copies of the game, one a bot, kept in step on this computer. A line as each game ends,
then the standing with Elo, each bot's time a frame, and the head-to-head. Each game's replay is saved in the
ladder's folder for scmjs replay watch. Exits 1 when a game could not be played or a bot's copy failed.`) + `

  scmjs bot ladder out/mybot.scmbot:p computer --maps "(2)Boxer.scm" --races tzp --games 3
  scmjs bot ladder a.scmbot b.scmbot c.scmbot --maps maps/*.scx --frames 30000
  scmjs bot ladder cosmo.scmbot:t other.scmbot:t --maps "(4)Exodus 1.0.scx" --mod "Cosmonarchy BW"` + "\n\n" + t(`--mod needs a play page whose engine runs a mod's code ("mods": 2 in its engine/current.json); with an older one
the command stops and says which version it needs.`))
    .action(async (specs: string[], o: { json?: boolean; maps: string[]; races: string; games: string; seeds?: string; frames: string; out?: string; force?: boolean; data?: string; parallel: string; timeout: string; mod?: string; ums?: boolean; melee?: boolean; starcraft?: string; engine?: string }) => {
      if (o.ums && o.melee) throw new CliError(t("--ums and --melee: one kind of game"), null, 2);
      const races = parseRaces(o.races);
      const { seeds, frames, parallel, timeout } = ladderValues(o);
      const entrants = parseEntrants(specs, races);
      const say = (l: string) => (o.json ? printErr(l) : print(l));
      // A map in the original 1.00 form is played as Brood War (as map trace does), so that its replays play back.
      const play = new Map<string, string>();
      const overlay = o.mod ? modOverlay(o.mod, () => gameFilesOrNull(o.starcraft), { code: true }) : null;
      // (a melee map under a mod with no plugins is played as melee: botrun.ts gameKind)
      const gameOf = new Map<string, "melee" | "ums">();
      for (const m of o.maps) {
        const { input, doc } = await openMap(m);
        const game = await gameMap(doc, input.path, input.name);
        if (game.path !== m) play.set(m, game.path);
        if (game.converted) say(pc.dim(t("{name} is an original StarCraft map: it is played converted to Brood War.", { name: input.name })));
        const kind = o.ums || o.melee ? undefined : await gameKind(looksLikeMapSettings(doc.scenario), overlay);
        if (kind) gameOf.set(m, kind);
      }
      let r;
      try {
        r = await runLadder(entrants, {
          maps: o.maps, play, races, seeds, frames, out: o.out, force: o.force, data: o.data, parallel, timeout,
          starcraft: o.starcraft, engine: o.engine, live: say, mod: overlay, game: o.ums ? "ums" : o.melee ? "melee" : undefined, gameOf,
        });
      } finally { for (const p of play.values()) removeGameMap(p); overlay?.remove(); }
      if (o.json) print(JSON.stringify(ladderJson(r), null, 2));
      else printLadder(r);
      if (r.results.some((x) => !x.end || x.end.by === "desync" || x.end.bots.some((b) => b.state === "crashed" || b.state === "failed"))) process.exitCode = 1;
    });
}
