/** Links to the play page and scmjs.dev: `map play`, `map share` and `scmjs share`. */
import { Command, Option } from "commander";
import { expectKind, loadMapInput, loadReplayInput, readInput, type Input } from "./files";
import { playInLobby } from "./open";
import { KEEP, keepMap, printShare, shareMap } from "./share";
import { checkShareOptions, printSharedFile, shareFile, type SharedFile, type ShareFilesOptions } from "./sharefiles";
import { t } from "./i18n";
import { CliError, print, printErr } from "./ui";
import { fail, copyShared, sharedLines } from "./cmdkit";
import { jsonOption, starcraftOption, playOption, qrOption, copyOption, noLinkOption, raiseExitCode } from "./options";

export function addMapPlayCommand(map: Command): void {
  const json = jsonOption();
  map.command("play").description(t("a lobby on the play page with this map, and its invite link to send around")).argument("<map>").addOption(json)
    .addOption(playOption())
    .addOption(qrOption())
    .addHelpText("after", "\n" + t(`Opens scmjs.dev/play in your browser with the map and asks it for a lobby; the page is the host, and the link it
reports is printed here. The page asks you to sign in to scmjs.dev when you are not (opening a lobby needs an
account; joining one does not), and for the game's files the first time. The people you send the link to need
their own StarCraft files and no account. Waits up to five minutes for the page.`))
    .action(async (file: string, o: { json?: boolean; play?: string; qr?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      // With --json, standard output is the JSON alone: the hand-over's words go to standard error.
      const r = await playInLobby(input, { play: o.play, qr: o.qr, live: o.json ? undefined : (line) => print(line), say: o.json ? (...lines) => printErr(...lines) : undefined });
      if (o.json) { print(JSON.stringify({ file: input.name, ...r }, null, 2)); return; }
      if (!r.link) throw new CliError(r.error ?? t("The page opened no lobby"), t("Invite Players on the play page opens one by hand."));
    });
}

export function addMapShareCommand(map: Command): void {
  const json = jsonOption();
  map.command("share").description(t("a link to the map on scmjs.dev: a copy anyone can open, or --edit to edit it together")).argument("<map>", t("the map, or - for standard input")).addOption(json)
    .option("--name <name>", t("the map's name on your account and in the link; the scenario's name by default"))
    .option("--note <text>", t("a note for this revision, as My Maps shows it"))
    .option("--edit", t("a link to edit the map together (Account ▸ Share this Map…), not a copy"))
    .addOption(new Option("--keep <how long>", t("with --edit: keep it open this long after its last edit; by default it is open until everyone leaves")).choices(Object.keys(KEEP)))
    .option("--new", t("store it as a new map even when your account has one with this file name"))
    .option("--no-picture", t("upload no picture for the link's card"))
    .addOption(starcraftOption(t("your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise")))
    .addOption(qrOption()).addOption(copyOption()).addOption(noLinkOption())
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. A copy link stores the map on your account (My Maps) as a new map, or as a
new revision of the map there with the same file name, and links that revision: whoever opens it gets a copy in
their editor. --edit opens the map for editing together instead; whoever opens that link edits it with you.`) + `
  scmjs map share ridge.scx
  scmjs map share ridge.scx --edit --keep week
  scmjs map share ridge.scx --no-link`)
    .action(async (path: string, o: ShareFilesOptions & { json?: boolean }) => {
      const input = await readInput(path);
      expectKind(input, "map");
      checkShareOptions([input], o);
      const map = await loadMapInput(input);
      const r = o.link === false ? await keepMap(input, map, o) : await shareMap(input, map, o);
      print(...(o.json ? [JSON.stringify(r, null, 2)] : sharedLines(printShare(r), r.link, o.qr)));
      if (o.copy) await copyShared([r.link]);
    });
}

export function addShareCommand(program: Command): void {
  const json = jsonOption();
  program.command("share").description(t("a link on scmjs.dev to each map or replay")).helpGroup(t("Maps and replays:"))
    .argument("<files...>", t("maps and replays, or - for standard input")).addOption(json)
    .option("--name <name>", t("a map's name on your account and in the link; the scenario's name by default"))
    .option("--edit", t("a map: a link to edit it together, not a copy"))
    .addOption(new Option("--keep <how long>", t("with --edit: keep it open this long after its last edit")).choices(Object.keys(KEEP)))
    .option("--new", t("a map: store it as a new map even when your account has one with this file name"))
    .option("--at <time>", t("a replay: the moment the link opens at, m:ss, h:mm:ss or seconds"))
    .option("--play [player]", t("a replay: whoever opens the link plays on as this player (a slot or a name); with no player they choose"))
    .option("--note <text>", t("a note, as My Maps shows it"))
    .option("--no-picture", t("upload no picture for the link's card"))
    .addOption(starcraftOption(t("your installation of StarCraft, for the picture (SCMJS_STARCRAFT); found in the usual places otherwise")))
    .addOption(qrOption()).addOption(copyOption()).addOption(noLinkOption())
    .addHelpText("after", "\n" + t(`Needs a scmjs.dev account: scmjs login. Each map is shared as scmjs map share shares it and each replay as scmjs
replay share does: a link for each file, first in the file's lines. --name, --edit, --keep and --new are for maps,
--at and --play for replays; one given with no file of its kind is refused. --copy puts the links on the clipboard;
--no-link keeps the files on your account and makes no link.`) + `
  scmjs share ridge.scx
  scmjs share game.rep --at 6:42 --play 2 --copy
  scmjs share maps/*.scx --no-link`)
    .action(async (paths: string[], o: ShareFilesOptions & { json?: boolean }) => {
      const inputs: Input[] = [];
      for (const path of paths) { const input = await readInput(path); expectKind(input, "map", "replay"); inputs.push(input); }
      checkShareOptions(inputs, o);
      const done: (SharedFile | { file: string; error: string })[] = [];
      let printed = false;
      for (const input of inputs) {
        try {
          const r = await shareFile(input, input.kind === "map" ? await loadMapInput(input) : await loadReplayInput(input), o);
          done.push(r);
          if (!o.json) { if (printed) print(""); print(...sharedLines(printSharedFile(r), r.link, o.qr)); printed = true; }
        } catch (e) {
          if (!(e instanceof CliError)) throw e;
          done.push({ file: input.path, error: e.message });
          fail(e);
          raiseExitCode(e.exitCode);
        }
      }
      if (o.json) print(JSON.stringify(done.length === 1 ? done[0] : done, null, 2));
      if (o.copy) await copyShared(done.map((r) => ("link" in r ? r.link : null)));
    });
}
