/** Maps in git: `map diff`, `map log`, `map blame` and `map merge`. */
import { Command } from "commander";
import { diffMaps, printDiff, revisionInput } from "./diff";
import { mapLog, printLog } from "./maplog";
import { BLAME_KINDS, blameMap, printBlame, printBlameItem, type BlameKind } from "./blame";
import { asMap, printMerge, runMerge, stagedInputs, type Side } from "./merge";
import { diffPicture } from "./diffpicture";
import { expectKind, loadMapInput, readInput, STDIO, openMap } from "./files";
import { PNG_SCALES } from "./preview";
import { t } from "./i18n";
import { CliError, print } from "./ui";
import { say } from "./cmdkit";
import { jsonOption, starcraftOption, outOption, mapOutOption, dryRunOption, refuseJsonOnPipe } from "./options";

export function addMapGitCommands(map: Command): void {
  const json = jsonOption();
  map.command("diff").description(t("what changed between two maps, or since a git revision")).argument("<a>", t("a map; with --rev, the map whose earlier version it is compared with")).argument("[b]", t("the other map; none with --rev")).addOption(json)
    .option("--all", t("list every item; by default a long list is cut at 20"))
    .option("--rev <revision>", t("compare the map as git has it at this revision (HEAD, HEAD~1, a branch, a tag) with the file as it is"))
    .option("--picture", t("draw the maps with the changes marked, with your copy of the game's graphics (as map preview)"))
    .addOption(outOption("picture.png", t("with --picture: write a PNG instead; - for standard output")))
    .option("--side-by-side", t("with --picture: the first map, the changes and the second map in one picture"))
    .option("--scale <n>", t("with --picture: pixels a tile, {scales} in a PNG (4 by default)", { scales: PNG_SCALES.join(", ") }))
    .option("--width <columns>", t("with --picture: the terminal picture's width in characters"))
    .option("--blocks", t("with --picture: colour blocks, even in kitty or iTerm2"))
    .addOption(starcraftOption(t("with --picture: your installation of StarCraft (SCMJS_STARCRAFT)")))
    .addHelpText("after", "\n" + t(`Exits 1 when the maps differ, 0 when they are the same, like diff.`) + `
  scmjs map diff old.scx new.scx
  scmjs map diff --rev HEAD~1 maps/ridge.scx     # ${t("what the last commit changed in the map")}
  scmjs map diff old.scx new.scx --picture --out diff.png --side-by-side`)
    .action(async (a: string, b: string | undefined, o: { json?: boolean; all?: boolean; rev?: string; picture?: boolean; out?: string; sideBySide?: boolean; scale?: string; width?: string; blocks?: boolean; starcraft?: string }) => {
      if (o.rev ? b !== undefined : b === undefined) throw new CliError(o.rev ? t("--rev compares one map with its earlier version: give the map alone") : t("Two maps to compare, or one with --rev <revision>"), null, 2);
      const picture = !!o.picture || o.out !== undefined || !!o.sideBySide;
      const pictureOnly = (["scale", "width", "blocks", "starcraft"] as const).find((k) => o[k] !== undefined);
      if (!picture && pictureOnly) throw new CliError(t("--{flag} is the picture's: add --picture", { flag: pictureOnly }), null, 2);
      const piped = o.out === STDIO;
      refuseJsonOnPipe(piped, o.json, "picture");
      const fromRev = async () => { const input = revisionInput(o.rev!, a); expectKind(input, "map"); return { input, doc: await loadMapInput(input) }; };
      const [x, y] = await Promise.all([o.rev ? fromRev() : openMap(a), openMap(o.rev ? a : b!)]);
      const d = diffMaps({ name: x.input.name, doc: x.doc }, { name: y.input.name, doc: y.doc });
      if (picture) {
        const { report, lines } = await diffPicture(x, y, o);
        if (o.json) print(JSON.stringify({ ...d, picture: report }, null, 2));
        else say(piped, ...lines);
      } else print(...(o.json ? [JSON.stringify(d, null, 2)] : printDiff(d, !!o.all)));
      if (!d.same) process.exitCode = 1;
    });

  map.command("log").description(t("the map's history in git, each commit's changes in the map's terms")).argument("<map>").addOption(json)
    .option("--rev <revision>", t("the history up to this revision, or a range A..B (HEAD by default)"))
    .option("-n, --max-count <n>", t("the newest n commits only"))
    .addHelpText("after", "\n" + t(`One entry per commit that changed the file: hash, date, author, subject, and what changed in
the map, as map diff would say it between the commit's version and its parent's.`) + `
  scmjs map log maps/ridge.scx
  scmjs map log maps/ridge.scx -n 5
  scmjs map log maps/ridge.scx --rev main..HEAD     # ${t("what this branch did to the map")}`)
    .action(async (file: string, o: { json?: boolean; rev?: string; maxCount?: string }) => {
      const limit = o.maxCount === undefined ? undefined : Number(o.maxCount);
      if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) throw new CliError(t("-n takes a number of commits, not {value}", { value: String(o.maxCount) }), null, 2);
      const log = await mapLog(file, { rev: o.rev, limit });
      print(...(o.json ? [JSON.stringify(log, null, 2)] : printLog(log)));
    });

  map.command("blame").description(t("the commit that last changed each trigger, location, string, unit or setting")).argument("<map>").addOption(json)
    .option("--triggers", t("the triggers (the default, when the map has any)"))
    .option("--locations", t("the locations"))
    .option("--strings", t("the strings"))
    .option("--units", t("the units, a row for each kind and owner"))
    .option("--settings", t("the name, size, players, forces, terrain, unit and tech settings, and the archive's files"))
    .option("--trigger <n>", t("one trigger, by its number in the list, with its whole text"))
    .option("--location <name>", t("one location, by name or by its number as triggers count them (from 1)"))
    .option("--string <n>", t("one string, by number"))
    .option("--rev <revision>", t("the map as this revision has it (the file as it is by default), or a range A..B"))
    .addHelpText("after", "\n" + t(`Like git blame, a row per thing in the map instead of per line: the commit, author and date
that last changed it. A trigger that only moved in the list has not changed. Without --rev
the file is read as it is, and what is not committed yet says so.`) + `
  scmjs map blame maps/ridge.scx
  scmjs map blame maps/ridge.scx --locations --strings
  scmjs map blame maps/ridge.scx --trigger 4`)
    .action(async (file: string, o: { json?: boolean; rev?: string; trigger?: string; location?: string; string?: string } & Partial<Record<BlameKind, boolean>>) => {
      const one = (["trigger", "location", "string"] as const).filter((k) => o[k] !== undefined);
      if (one.length > 1) throw new CliError(t("--{a} or --{b}, one at a time", { a: one[0], b: one[1] }), null, 2);
      const number = (v: string | undefined, what: string) => {
        if (v === undefined) return undefined;
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) throw new CliError(t("--{flag} takes a number from 1, not {value}", { flag: what, value: v }), null, 2);
        return n;
      };
      const trigger = number(o.trigger, "trigger"), str = number(o.string, "string");
      let kinds: BlameKind[] = BLAME_KINDS.filter((k) => o[k]);
      if (one.length) kinds = [one[0] === "trigger" ? "triggers" : one[0] === "location" ? "locations" : "strings"];
      const fallback = !kinds.length;
      if (fallback) kinds = ["triggers", "settings"];
      const b = await blameMap(file, kinds, { rev: o.rev, trigger });
      // With no choice: the triggers, or the settings for a map with none (a melee map).
      if (fallback) { if (b.kinds.triggers!.length) delete b.kinds.settings; else delete b.kinds.triggers; }
      if (one.length) {
        const kind = kinds[0];
        const rows = b.kinds[kind]!;
        const want = one[0] === "location" ? o.location! : String(trigger ?? str);
        const at = one[0] === "location"
          ? rows.findIndex((r) => r.label.toLowerCase() === want.toLowerCase() || `#${r.number}` === want || String(r.number) === want)
          : rows.findIndex((r) => r.label === want);
        if (at < 0) {
          const what = one[0] === "trigger" ? t("trigger") : one[0] === "location" ? t("location") : t("string");
          throw new CliError(b.rev ? t("{file} has no {kind} {name} at {rev}", { file: b.path, kind: what, name: want, rev: b.rev }) : t("{file} has no {kind} {name}", { file: b.path, kind: what, name: want }), t("scmjs map blame \"{file}\" --{kind} lists them.", { file, kind }), 2);
        }
        const row = rows[at];
        if (o.json) { print(JSON.stringify({ file: b.file, path: b.path, rev: b.rev, kind, ...row, ...(kind === "triggers" ? { textForm: b.detail } : {}) }, null, 2)); return; }
        print(...printBlameItem(b, kind, row, one[0] === "trigger" ? t("Trigger {label}", { label: row.label }) : one[0] === "location" ? t("Location {label}", { label: row.label }) : t("String {label}", { label: row.label })));
        return;
      }
      print(...(o.json ? [JSON.stringify(b, null, 2)] : printBlame(b)));
    });

  map.command("merge").description(t("merge two versions of a map with their common ancestor, as git's merge driver")).argument("<base>", t("the common ancestor; with no other map, the map git stopped on")).argument("[ours]", t("your version, written over with the result unless --out")).argument("[theirs]", t("the version merged into yours")).addOption(json)
    .addOption(mapOutOption(t("write the merged map here instead of over <ours>; - for standard output")))
    .option("--ours", t("settle each conflict with ours's version"))
    .option("--theirs", t("settle each conflict with theirs's version"))
    .option("--name <path>", t("the map's name in what is said (git gives it as %P)"))
    .addOption(dryRunOption(t("say what would merge, and write nothing")))
    .addHelpText("after", "\n" + t(`Part by part: what one side changed is taken, what both changed is merged finer (terrain by tile, units by
instance, triggers in order, settings by field) or is a conflict. With no conflicts the merged map is written over
<ours> (or to --out); with conflicts nothing is written and the command exits 1, unless --ours or --theirs settles
them. scmjs init sets it up as git's merge driver:`) + `
  git config merge.scmjs.driver "scmjs map merge %O %A %B --out %A --name %P"
  scmjs map merge base.scx mine.scx theirs.scx --out merged.scx
  scmjs map merge maps/ridge.scx --ours     # ${t("after git merge stopped on it: the three versions from git")}`)
    .action(async (a: string, b: string | undefined, c: string | undefined, o: { json?: boolean; out?: string; ours?: boolean; theirs?: boolean; name?: string; dryRun?: boolean }) => {
      if (o.ours && o.theirs) throw new CliError(t("--ours or --theirs, not both"), null, 2);
      if (b !== undefined && c === undefined) throw new CliError(t("Three maps (base, ours, theirs), or one that git merge stopped on"), null, 2);
      const staged = b === undefined;
      const inputs = staged ? stagedInputs(a) : { base: asMap(await readInput(a)), ours: asMap(await readInput(b!)), theirs: asMap(await readInput(c!)) };
      const piped = o.out === STDIO && !o.dryRun;
      refuseJsonOnPipe(piped, o.json, "map");
      const prefer: Side | null = o.ours ? "ours" : o.theirs ? "theirs" : null;
      const r = await runMerge(inputs, { prefer, name: o.name ?? null, out: o.out ?? null, dryRun: !!o.dryRun, staged });
      if (o.json) print(JSON.stringify(r, null, 2));
      else say(piped, ...printMerge(r));
      if (r.conflicts.length && !r.settled) process.exitCode = 1;
    });
}
