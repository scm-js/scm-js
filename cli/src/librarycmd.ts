/**
 * The `scmjs library` commands: commander's side of library.ts, kept here so main.ts adds them with one call. What
 * a command says goes to standard output, or standard error when the file or the JSON takes standard output.
 */
import { type Command, Option } from "commander";
import { writeOutput } from "./exchange";
import { STDIO } from "./files";
import { t } from "./i18n";
import {
  confirmed, getFromLibrary, libraryReport, noteRevision, planRemoval, planUnlink, printGot, printLibrary, removalLines, removeFromLibrary,
  renameMap, storageLine, unlink, unlinkLines, type LibraryPart,
} from "./library";
import { mark, pc, print, printErr } from "./ui";
import { parseWhole } from "./values";
import { jsonOption, outOption, forceOption, dryRunOption, refuseJsonOnPipe, refuseOverwrite } from "./options";

export function addLibraryCommands(program: Command, group: string): void {
  const json = jsonOption;
  const revision = () => new Option("--revision <n>", t("a map's revision by its number; the newest by default"));
  const rev = (v: string | undefined) => (v === undefined ? undefined : parseWhole(v, "revision", 1));
  const library = program.command("library").description(t("your maps and replays on scmjs.dev")).helpGroup(group)
    .addHelpText("after", "\n" + t(`Name a map or replay by a link to it, its id (the 8 characters in the list), a map's name or file name, or a
replay's file name. library get also downloads anyone's map or replay link, without signing in.`) + `
  scmjs library                                  # ${t("everything, with the links")}
  scmjs library get "Fighting Spirit" --revision 2
  scmjs library get https://scmjs.dev/replay/…   # ${t("anyone's replay link")}
  scmjs library unlink https://scmjs.dev/editor/map/…`);

  const list = (only?: LibraryPart) => async (o: { json?: boolean }) => {
    const r = await libraryReport({ only });
    print(...(o.json ? [JSON.stringify(r, null, 2)] : printLibrary(r)));
  };
  library.command("list", { isDefault: true, hidden: true }).description(t("everything the account keeps")).addOption(json()).action(list());
  library.command("maps").description(t("your maps: revisions, size, links and how often each was opened")).addOption(json()).action(list("maps"));
  library.command("replays").description(t("your replays: the map, players, length and their links")).addOption(json()).action(list("replays"));
  library.command("shared").description(t("the maps you are sharing for editing, with their links")).addOption(json()).action(list("shared"));

  library.command("get").description(t("download a map or replay from your account, or from anyone's link")).argument("<what>", t("a link, an id, or a name"))
    .addOption(outOption("file", t("the file to write; the server's file name in this folder by default; - for standard output")))
    .addOption(revision()).addOption(forceOption()).addOption(json())
    .action(async (what: string, o: { out?: string; revision?: string; force?: boolean; json?: boolean }) => {
      const out = o.out;
      refuseJsonOnPipe(out === STDIO, o.json, "file");
      const g = await getFromLibrary(what, { revision: rev(o.revision) });
      const path = out ?? g.fileName;
      if (path !== STDIO) refuseOverwrite(path, o.force, t("--force overwrites it, --out names another file."));
      const w = await writeOutput(g.bytes, path);
      const { bytes: _b, ...facts } = g;
      if (o.json) { print(JSON.stringify({ ...facts, bytes: g.bytes.length, written: w }, null, 2)); return; }
      const where = w.path === STDIO ? t("standard output") : w.live ? t("the editor, as one undo step") : pc.cyan(w.path);
      const line = `${mark.ok} ${printGot(g, where)[0]}`;
      if (w.path === STDIO) printErr(line); else print(line);
    });

  /** Says what goes, asks (or takes --yes), and makes it so; --dry-run stops after saying. */
  const destroy = async <P>(o: { yes?: boolean; dryRun?: boolean; json?: boolean }, plan: P, words: string[], question: string, act: () => Promise<string[]>) => {
    if (o.json && o.dryRun) { print(JSON.stringify({ plan, done: false }, null, 2)); return; }
    (o.json ? printErr : print)(...words);
    if (o.dryRun) { print(pc.dim(t("Nothing was changed (--dry-run)."))); return; }
    if (!(await confirmed(question, { yes: o.yes }))) { (o.json ? printErr : print)(t("Nothing was changed.")); process.exitCode = 1; return; }
    const lines = await act();
    if (o.json) print(JSON.stringify({ plan, done: true }, null, 2)); else print(...lines);
  };
  const askOptions = (cmd: Command) => cmd.option("-y, --yes", t("do it without asking (needed where there is no terminal to ask on)"))
    .addOption(dryRunOption(t("say what would go, and change nothing"))).addOption(json());

  askOptions(library.command("rm").description(t("delete a map, one of its revisions, or a replay, with their links")).argument("<what>", t("a link, an id, or a name")).addOption(revision()))
    .action(async (what: string, o: { revision?: string; yes?: boolean; dryRun?: boolean; json?: boolean }) => {
      const plan = await planRemoval(what, { revision: rev(o.revision) });
      await destroy(o, plan, removalLines(plan), t("Delete it?"), async () => {
        const r = await removeFromLibrary(plan);
        const what = plan.kind === "revision" ? t("revision {n} of {name}", { n: plan.revision!, name: plan.name }) : plan.name;
        return [`${mark.ok} ${t("Deleted {what}", { what })}`, storageLine(r.storage)].filter((l): l is string => !!l);
      });
    });

  askOptions(library.command("unlink").description(t("make one link stop working: a copy link, a replay's, or a map shared for editing")).argument("<link>", t("the link")))
    .action(async (url: string, o: { yes?: boolean; dryRun?: boolean; json?: boolean }) => {
      const plan = await planUnlink(url);
      await destroy(o, plan, unlinkLines(plan), plan.kind === "shared" ? t("Stop sharing it?") : t("Remove the link?"), async () => {
        await unlink(plan);
        return [`${mark.ok} ${plan.kind === "shared" ? t("No longer shared for editing") : t("The link no longer works")}`];
      });
    });

  library.command("rename").description(t("give a map on your account another name")).argument("<map>", t("a link, an id, or a name")).argument("<name>", t("the new name")).addOption(json())
    .action(async (what: string, name: string, o: { json?: boolean }) => {
      const r = await renameMap(what, name);
      print(o.json ? JSON.stringify(r, null, 2) : `${mark.ok} ${t("{was} is now called {name}", { was: r.was, name: pc.bold(r.name) })}`);
    });

  library.command("note").description(t("the note on a map's revision, as My Maps shows it")).argument("<map>", t("a link, an id, or a name")).argument("<note>", t("the note; \"\" clears it"))
    .addOption(revision()).addOption(json())
    .action(async (what: string, note: string, o: { revision?: string; json?: boolean }) => {
      const r = await noteRevision(what, note, { revision: rev(o.revision) });
      print(o.json ? JSON.stringify(r, null, 2) : `${mark.ok} ${t("Revision {n} of {name}: {note}", { n: r.revision, name: pc.bold(r.name), note: r.note || pc.dim(t("no note")) })}`);
    });
}
