/** The `scmjs replay` commands. */
import { Command, Option } from "commander";
import { besideInput, expectKind, loadReplayInput, readInput, STDIO } from "./files";
import { openBrowser, openInScmjs } from "./open";
import { isWebAddress, openWebLink } from "./weblink";
import { refuseModReplay, type ReplayNameOptions } from "./replaymod";
import { checkMapOut, mapFileFor, writeReplayMap } from "./replaymap";
import { keepReplay, printReplayShare, shareReplay } from "./replayshare";
import { replaySyncCommand } from "./replaysync";
import { exportReplay, exportSummary, parseResolution, type ExportOptions } from "./export";
import { watchReplay, watchSummary, watchValues } from "./watch";
import { checkShareOptions, type ShareFilesOptions } from "./sharefiles";
import { t } from "./i18n";
import { dot, gameText, mark, pc, print, size, visible } from "./ui";
import { eachFile, say, outName, copyShared, sharedLines } from "./cmdkit";
import { replayInfo } from "./infocmd";
import { jsonOption, starcraftOption, outOption, mapOutOption, forceOption, dryRunOption, engineOption, playOption, editorUrlOption, qrOption, copyOption, noLinkOption, refuseJsonOnPipe, refuseOverwrite } from "./options";

export function addReplayCommands(program: Command): void {
  const json = jsonOption();
  const replay = program.command("replay").description(t("read and open replays")).helpGroup(t("Maps and replays:"));
  replay.command("info").description(t("who played, on what map, for how long, at what APM")).argument("<replays...>").addOption(json)
    .option("--builds", t("what each player ordered: units, buildings, upgrades and technologies, by name, with their cost"))
    .option("--mod <mod>", t("the mod the replay was played with, for its names and costs: a mod folder, an .mpq, a mod's .exe or .zip"))
    .addOption(starcraftOption(t("your installation of StarCraft (SCMJS_STARCRAFT), for the game's costs and the files under a mod; found in the usual places otherwise")))
    .addHelpText("after", "\n" + t(`A replay saved by scmJS from a game of a mod says which mod it was (the Mod line): its name, the hash of its data
set, its makers' link and the plugins that ran. --mod names the mod's folder for the names and costs of its units,
upgrades and technologies, and is refused when its data set is not the one the replay names. Without it, a mod's
replay shows ids, never the game's names for them.`) + `
  scmjs replay info game.rep --builds
  scmjs replay info game.rep --builds --mod "My Mod"`)
    .action(async (files: string[], o: { json?: boolean } & ReplayNameOptions) => void await eachFile(files, !!o.json, (input) => replayInfo(input, o)));
  replay.command("map").description(t("the map the replay was played on, written out as a map file")).argument("<replay>").addOption(json)
    .addOption(mapOutOption(t("the file to write (.scx, .scm or .chk); the replay's name with .scx by default; - for standard output")))
    .addOption(forceOption())
    .addHelpText("after", "\n" + t(`A replay carries the map the game loaded, so the map is there whole whether or not you still have the file. It is
written as the game had it: a bare .chk, or an archive like a new map's. Opens in the editor like any map.`) + `
  scmjs replay map game.rep                      # ${t("game.scx beside it")}
  scmjs replay map game.rep --out - | scmjs map info -`)
    .action(async (file: string, o: { json?: boolean; out?: string; force?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const out = o.out ?? mapFileFor(besideInput(input));
      checkMapOut(out);
      const piped = out === STDIO;
      refuseJsonOnPipe(piped, o.json, "map");
      if (!piped) refuseOverwrite(out, o.force, t("--force overwrites it, --out names another file."));
      const r = await writeReplayMap(await loadReplayInput(input), out);
      if (o.json) { print(JSON.stringify({ file: input.path, ...r }, null, 2)); return; }
      say(piped, `${mark.ok} ${pc.bold(gameText(r.name) || pc.italic(t("Untitled")))}: ${r.width} × ${r.height}${dot}${t("from {file}", { file: input.name })}${dot}${t("written to {file}", { file: outName(r.written) })}${dot}${size(r.written.bytes)}`);
    });
  replay.command("share").description(t("a link to the replay on scmjs.dev, which anyone opens to watch it in the editor")).argument("<replay>", t("the replay, or - for standard input")).addOption(json)
    .option("--at <time>", t("the moment the link opens at: m:ss, h:mm:ss or seconds of game time"))
    .option("--play [player]", t("whoever opens the link plays on as this player (a slot or a name); with no player they choose"))
    .option("--note <text>", t("a note, as My Maps shows it"))
    .option("--no-picture", t("upload no map picture for the link's card"))
    .addOption(starcraftOption(t("your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise")))
    .addOption(qrOption()).addOption(copyOption()).addOption(noLinkOption())
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. The replay is stored on your account (My Maps ▸ Replays, up to 8 MB each,
counted with your maps) and linked; whoever opens the link watches it in the editor's analysis. --at opens it at
that moment, paused; --play sends them to the play page to play on from there as that player, with their own copy
of StarCraft. The replay has one link: sharing it again at another moment stores nothing and gives that link with
the new moment. The link's card shows the map's picture when your copy of the game is here to draw it.`) + `
  scmjs replay share game.rep
  scmjs replay share game.rep --at 6:42
  scmjs replay share game.rep --at 6:42 --play Drywater --copy`)
    .action(async (path: string, o: ShareFilesOptions & { json?: boolean }) => {
      const input = await readInput(path);
      expectKind(input, "replay");
      checkShareOptions([input], o);
      const rep = await loadReplayInput(input);
      const r = o.link === false ? await keepReplay(input, rep, o) : await shareReplay(input, rep, o);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : sharedLines(printReplayShare(r), r.link, o.qr)));
      if (o.copy) await copyShared([r.link]);
    });
  replay.command("sync").description(t("your new games' replays stored on your scmjs.dev account, by themselves with --watch")).argument("[folders...]", t("the folders to look in; StarCraft's own replay folders by default")).addOption(json)
    .option("-w, --watch", t("keep running and upload each game as it is saved; Ctrl+C stops"))
    .option("--since <date>", t("replays from this date on (2026-11-01, or 7d for the last week)"))
    .option("--all", t("every replay in the folders, however old"))
    .addOption(dryRunOption(t("list what would be uploaded, and upload nothing")))
    .option("--link", t("a link for each replay too, as replay share makes"))
    .option("--no-picture", t("with --link, no map picture for the links' cards"))
    .addOption(starcraftOption(t("your installation of StarCraft, for the pictures with --link (SCMJS_STARCRAFT)")))
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. Replays the account has already are not sent again. The first sync with
an account starts from then: the replays already in the folders stay (a terminal asks first), and --since or --all
takes them. The replays are stored, not linked: replay share gives one its link later.`) + `
  scmjs replay sync --watch
  scmjs replay sync --since 2026-11-01 --dry-run`)
    .action((folders: string[], o: Parameters<typeof replaySyncCommand>[1]) => replaySyncCommand(folders, o));
  replay.command("open").description(t("watch a replay in the scmJS app, or the editor in your browser")).argument("<replay>")
    .option("--browser", t("the editor in the browser, even with the app installed"))
    .addOption(editorUrlOption())
    .action(async (file: string, o: { browser?: boolean; editor?: string }) => {
      if (isWebAddress(file)) { openWebLink(file, ["replay"], openBrowser); print(`${mark.ok} ${t("Opening {link} in your browser", { link: pc.cyan(file) })}`); return; }
      const input = await readInput(file); expectKind(input, "replay"); await openInScmjs(input, o);
    });
  replay.command("watch").description(t("play a replay in the terminal: the minimap, each player's figures, the chat")).argument("<replay>").addOption(json)
    .option("--speed <x>", t("how fast, against the game's Fastest (24 frames a second); in a terminal"), "8")
    .option("--from <m:ss>", t("start the game here"))
    .option("--cells <WxH>", t("the picture's size in characters, in a terminal; as much of it as the map fills by default"))
    .addOption(new Option("--size <WxH>").hideHelp())
    .option("--every <frames>", t("into a pipe or a file: frames between lines, 0 for none; a line a minute of the game's clock by default"))
    .addOption(starcraftOption())
    .addOption(engineOption())
    .addHelpText("after", "\n" + t(`The game is the play page's engine, fetched once and kept; the game's own files come from your copy of StarCraft,
Remastered or 1.16.1. The replay plays as the game plays it, drawn as a minimap: a dot a unit in its player's colour,
buildings as blocks, resources dim. Keys: space pauses, + and - change the speed, q stops. Into a pipe or a file it
prints a line at each minute of the game's clock instead (1:00, 2:00, …; --every for another step), every player's
figures on it, or JSON lines with --json; it then goes as fast as the game plays, and --speed and --cells, which are
for a terminal, do nothing.`))
    .action(async (file: string, o: { json?: boolean; speed: string; from?: string; cells?: string; size?: string; every?: string; starcraft?: string; engine?: string }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const replay = await loadReplayInput(input);
      refuseModReplay(replay, input.name, "replay watch");
      const r = await watchReplay(input, replay, { ...watchValues(replay, o), json: !!o.json, starcraft: o.starcraft, engine: o.engine });
      if (!o.json) print(watchSummary(input, r));
    });

  replay.command("export").description(t("the replay as a video or GIF with the game's own pictures, for sharing")).argument("<replay>").addOption(json)
    .addOption(outOption("file", t("the clip: .webm, .mp4 or .gif (the replay's name with .webm beside it by default)")))
    .option("--from <m:ss>", t("where the clip starts in the game (its start by default)"))
    .option("--to <m:ss>", t("where it ends (the game's end by default)"))
    .option("--follow <player>", t("keep the camera on a player's play: a name, or a number as replay info lists them (the first person by default)"))
    .option("--at <x,y>", t("hold the camera on this tile"))
    .option("--whole-map", t("show the whole map, scaled to fit"))
    .addOption(new Option("--all").hideHelp())
    .option("--speed <x>", t("game speed against Fastest (1 is the game's own pace)"), "1")
    .option("--resolution <WxH>", t("the clip's size in pixels, each side even (1280x720; a GIF 640x360)"))
    .addOption(new Option("--size <WxH>").hideHelp())
    .option("--fps <n>", t("pictures a second (24; a GIF 12)"))
    .addOption(starcraftOption())
    .option("--browser <path>", t("the browser to draw with (SCMJS_BROWSER); Chrome, Chromium or Edge, found in the usual places otherwise"))
    .addOption(playOption())
    .addHelpText("after", "\n" + t(`The clip is drawn by the play page's replay viewer, in a browser already on this computer (Chrome, Chromium or Edge,
started without a window), with the pictures of your own copy of StarCraft. The game is stepped picture by picture,
so the clip plays at the speed asked whatever the computer's pace. A .webm or a .gif needs nothing more; an .mp4 is
made from the .webm with ffmpeg, when it is installed. The camera follows where the player's army is and fights.`) + `
  scmjs replay export game.rep --from 4:30 --to 5:00
  scmjs replay export game.rep --out fight.mp4 --follow 2 --from 12:10 --to 12:40
  scmjs replay export game.rep --out game.gif --whole-map --speed 16`)
    .action(async (file: string, o: ExportOptions & { json?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "replay");
      const replay = await loadReplayInput(input);
      refuseModReplay(replay, input.name, "replay export");
      // (an odd side is made even, which a video needs: said, as the clip is not the size asked)
      const asked = o.resolution ?? o.size;
      if (asked) { const s = parseResolution(asked); if (s.rounded) process.stderr.write(`${mark.warn} ${t("--resolution {asked} is made {width}x{height}: a video's sides are even.", { asked, width: s.width, height: s.height })}\n`); }
      const tty = !!process.stderr.isTTY;
      let shown = 0;
      // (progress is standard error in every mode, --json too: a line in place in a terminal, else one every ten seconds or so)
      const r = await exportReplay(input, replay, o, (line, done) => {
        if (tty) process.stderr.write(`\r\x1b[2K${line}${done ? "\n" : ""}`);
        else if (done || Date.now() - shown > 10_000) { shown = Date.now(); process.stderr.write(`${visible(line)}\n`); }
      });
      if (tty) process.stderr.write("\r\x1b[2K");
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(exportSummary(r));
    });
}
