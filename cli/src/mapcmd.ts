/** The `scmjs map` commands that read a map or make one: info, check, open, new, generate, dump, find and fetch. */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, relative } from "node:path";
import { Command, Option } from "commander";
import { VERSION } from "./about";
import { printRush, runRush, rushJson } from "./rush";
import { LAYOUTS, MAP_EXTENSIONS, nameFromFile, parseMapSize, parseTileset, writeNewMap } from "./create";
import { dumpMap, printDump } from "./dump";
import { mapText, parseRevision, VERSIONS } from "./edit";
import { expectKind, loadMapInput, readInput, STDIO, openMap } from "./files";
import { findInMap, hitJson, KINDS, parseKinds, printHits } from "./find";
import { DEFAULT_LIMIT, fetchJson, fetchMap, mapIdFrom, MAX_LIMIT, parseLimit, printFetched, printSearch, searchJson, searchMaps } from "./fetch";
import { issueLine, type MapReport, checkMap } from "./map";
import { BASELINE_FILE, readBaseline, writeBaseline, type BaselineEntry } from "./baseline";
import { openBrowser, openInScmjs } from "./open";
import { isWebAddress, openWebLink } from "./weblink";
import { openLink } from "./link";
import { atExit } from "./lifecycle";
import { SCMSCX, scmscx } from "./scmscx";
import { githubAnnotations, junitXml, sarifJson, type CheckReport, type Unread } from "./report";
import { printGenerated, runGenerate, type GenerateFlags } from "./generatecmd";
import { GEN_PLAYERS, GEN_STYLES, GEN_SYMMETRIES } from "./generate";
import { t, translate } from "./i18n";
import { CliError, dot, gameText, mark, num, pc, print, size, table, nearPath } from "./ui";
import { eachFile, say } from "./cmdkit";
import { mapInfo } from "./infocmd";
import { jsonOption, starcraftOption, outOption, forceOption, engineOption, editorUrlOption, formatOption, raiseExitCode, refuseJsonOnPipe, refuseOverwrite, reportFormat } from "./options";

export function addMapCommands(map: Command): void {
  const json = jsonOption();
  map.command("info").description(t("a map's size, players, units, triggers and its check")).argument("<maps...>").addOption(json)
    .option("--table", t("one row per map, for a folder of them"))
    .action(async (files: string[], o: { json?: boolean; table?: boolean }) => {
      if (o.table && o.json) throw new CliError(t("--table and --json are two forms of the same report: take one"), null, 2);
      if (!o.table) { await eachFile(files, !!o.json, mapInfo); return; }
      const reports = (await eachFile(files, true, mapInfo, true, true)).filter((r): r is MapReport & { rawName: string } => !!r && !("error" in (r as object))).map((r) => ({ ...r, name: r.rawName }));
      if (!reports.length) return;
      print(...table([
        [t("File"), t("Name"), t("Size"), t("Tileset"), t("Version"), t("Players"), t("Units"), t("Triggers"), t("Check")].map((h) => pc.dim(h)),
        ...reports.map((r) => [r.file.name, gameText(r.name) || pc.italic(t("Untitled")), `${r.width} × ${r.height}`, translate(r.tileset), translate(r.version), String(r.usedSlots.length), num(r.statistics.units.total), num(r.statistics.triggers.count), issueLine(r.issues)]),
      ], 0));
    });
  map.command("check").description(t("Check Map, as the editor's: errors, then warnings"))
    .argument("<maps...>").addOption(json)
    .option("--all", t("list notes too, not only errors and warnings"))
    .option("--strict", t("fail on warnings as well as errors"))
    .addOption(formatOption())
    .option("--baseline [file]", t("report and fail only on findings the file does not hold ({file} by default)", { file: BASELINE_FILE }))
    .option("--write-baseline [file]", t("write the maps' findings now as the baseline, and fail on none"))
    .addHelpText("after", t(`
Exits 1 when a map has errors (or warnings, with --strict): fit for a CI step. In a GitHub workflow,
  - run: npx @scm-js/cli map check maps/*.scx --strict --format github
puts each finding on the pull request itself.

A map with many old findings can still be held to that: --write-baseline keeps today's findings in
{file}, and --baseline then fails only on new ones and counts the ones fixed since.
  scmjs map check maps/*.scx --write-baseline
  scmjs map check maps/*.scx --baseline --strict --format github`, { file: BASELINE_FILE }))
    .action(async (files: string[], o: { json?: boolean; all?: boolean; strict?: boolean; format: string; baseline?: string | true; writeBaseline?: string | true }) => {
      const format = reportFormat(o);
      const machine = format !== "text" && format !== "json";
      // An optional value takes the next word, so `--baseline a.scx b.scx` would read a.scx as the baseline: a map is a map.
      const fileOf = (v: string | true | undefined) => { if (typeof v === "string" && /\.(scm|scx|chk)$/i.test(v)) { files.unshift(v); return true; } return v; };
      const asked = fileOf(o.baseline), writing = fileOf(o.writeBaseline);
      const baselineFile = writing !== undefined ? (typeof writing === "string" ? writing : typeof asked === "string" ? asked : BASELINE_FILE) : asked !== undefined ? (typeof asked === "string" ? asked : BASELINE_FILE) : null;
      if (baselineFile && files.includes(STDIO)) throw new CliError(t("A baseline keeps each map by its path: name the map's file rather than standard input."), null, 2);
      const known = baselineFile && (asked !== undefined || existsSync(baselineFile)) ? readBaseline(baselineFile) : null;
      const now: Record<string, BaselineEntry[]> = {};
      const reports = await eachFile(files, format === "json" || machine, async (input) => {
        expectKind(input, "map");
        const doc = await loadMapInput(input);
        const c = checkMap(input, doc, { all: o.all, strict: o.strict, baseline: baselineFile ? { file: baselineFile, known, writing: writing !== undefined } : null });
        if (c.entries) now[c.key] = c.entries;
        if (c.data.failed) raiseExitCode(1);
        return { data: c.data, lines: c.lines };
      }, false, machine) as { issues?: unknown[] }[];
      // Nothing written when no map could be read: the file would only lose what it held.
      if (writing !== undefined && baselineFile && Object.keys(now).length) {
        writeBaseline(baselineFile, known, now);
        const written = Object.values(now).reduce((n, l) => n + l.length, 0);
        if (format === "text") print("", `${mark.ok} ${t("{findings, plural, one {# finding} other {# findings}} of {maps, plural, one {# map} other {# maps}} written to {file}", { findings: written, maps: Object.keys(now).length, file: pc.cyan(baselineFile) })}${dot}${pc.dim(t("a check with --baseline fails only on others"))}`);
      }
      const unread = (reports as unknown[]).filter((r): r is Unread => !!r && typeof r === "object" && "error" in r);
      if (machine) {
        const ok = reports.filter((r): r is CheckReport => !!r && !("error" in r));
        if (format === "github") print(...githubAnnotations(ok, unread));
        else process.stdout.write(format === "junit" ? junitXml(ok, unread) : sarifJson(ok, VERSION, unread));
        return;
      }
      if (format === "text" && writing === undefined && files.length > 1) {
        const ok = reports.filter((r): r is CheckReport => !!r && !("error" in r));
        if (!ok.length) return;
        const bad = ok.filter((r) => r.failed).length;
        const b = known ? ok.reduce((n, r) => { const x = (r as CheckReport & { baseline?: { suppressed: number; fixed: number } }).baseline; return { suppressed: n.suppressed + (x?.suppressed ?? 0), fixed: n.fixed + (x?.fixed ?? 0) }; }, { suppressed: 0, fixed: 0 }) : null;
        const known_ = b && (b.suppressed || b.fixed) ? pc.dim(`${dot}${t("{n, plural, one {# known finding} other {# known findings}} left out", { n: b.suppressed })}${b.fixed ? t(", {n} fixed since the baseline", { n: num(b.fixed) }) : ""}`) : "";
        // Counted over the maps that were read; the ones that could not be are said apart.
        const notRead = files.length > ok.length ? `${dot}${pc.yellow(t("{n, plural, one {# file} other {# files}} not read", { n: files.length - ok.length }))}` : "";
        print("", (bad ? `${mark.error} ${t("{bad, plural, one {# map} other {# maps}} of {total} failed the check", { bad, total: ok.length })}` : `${mark.ok} ${t("{n, plural, one {# map} other {# maps}} checked, none failed", { n: ok.length })}`) + known_ + notRead);
      }
    });
  map.command("open").description(t("open a map in the scmJS app, or the editor in your browser")).argument("<map>")
    .option("--browser", t("the editor in the browser, even with the app installed"))
    .option("--live", t("keep the map linked to the editor in your browser: commands change it there, one undo step each"))
    .addOption(editorUrlOption())
    .action(async (file: string, o: { browser?: boolean; live?: boolean; editor?: string }) => {
      if (o.live && file === STDIO) throw new CliError(t("--live links a file on disk, not standard input"), t("Name the map."), 2);
      if (isWebAddress(file)) {
        if (o.live) throw new CliError(t("--live links a file on disk, not a link"), t("scmjs library get downloads it; then link that file."), 2);
        openWebLink(file, ["map", "share"], openBrowser);
        print(`${mark.ok} ${t("Opening {link} in your browser", { link: pc.cyan(file) })}`);
        return;
      }
      const input = await readInput(file);
      expectKind(input, "map");
      if (!o.live) { await openInScmjs(input, o); return; }
      // The link lasts as long as this command: it serves the page between scmjs and the editor (link.ts).
      const owner = await openLink(file, input.bytes, { editor: o.editor, say: print });
      const off = atExit(() => owner.end(t("scmjs stopped")));
      print(
        `${mark.ok} ${t("{name} is linked to the editor", { name: pc.bold(owner.name) })}`,
        pc.dim(`  ${t("scmjs commands and AI tools on this computer now change it there, one undo step each.")}`),
        pc.dim(`  ${t("Save in the editor writes {path}. Ctrl+C here, or closing the map there, ends the link.", { path: file })}`),
      );
      owner.onSave((bytes) => print(`${mark.ok} ${t("Saved from the editor")}${dot}${size(bytes)}`));
      const reason = await new Promise<string>((done) => owner.onEnd(done));
      off();
      print(`${mark.info} ${t("The link has ended: {reason}", { reason })}`);
    });

  map.command("new").description(t("a new map: flat ground, start locations laid out, the file written")).argument("<map>", t("the file to write: .scx, .scm or .chk (.scx added to a name without one); - for standard output")).addOption(json)
    .option("--size <WxH>", t("width and height, each 64, 96, 128, 192 or 256"), "128x128")
    .option("--tileset <name>", t("badlands, platform, install, ashworld, jungle, desert, ice or twilight"), "badlands")
    .option("--name <text>", t("the map's name; the file's by default"))
    .option("--description <text>", t("the map's description"), "")
    .option("--players <n>", t("start locations for players 1 to n, as Auto-place lays them; the other slots closed"), "0")
    .option("--layout <how>", t("{layouts}: how the start locations are laid out (ring by default; needs --players)", { layouts: LAYOUTS.join(t(" or ")) }))
    // Not --version: that is the program's own flag, and commander answers it wherever it appears.
    .option("--revision <which>", t("the file's revision: {versions}", { versions: VERSIONS.join(", ") }), "broodwar")
    .addOption(forceOption())
    .addHelpText("after", t(`
The map File ▸ New makes: flat ground, eight open slots (or n, with --players) and nothing else. Without the game's
graphics the ground is written by its ids, as the editor does without game data, and opens as it should. The same
arguments give the same file. Exits 2 when the file is there (--force overwrites it) or an option is not one.`))
    .action(async (given: string, o: { json?: boolean; size: string; tileset: string; name?: string; description: string; players: string; layout?: string; revision: string; force?: boolean }) => {
      const { width, height } = parseMapSize(o.size);
      const tileset = parseTileset(o.tileset);
      const revision = parseRevision(o.revision);
      const layout = o.layout?.toLowerCase() ?? "ring";
      if (!(LAYOUTS as readonly string[]).includes(layout)) throw new CliError(t("--layout takes {values}, not \"{value}\"", { values: LAYOUTS.join(t(" or ")), value: String(o.layout) }), null, 2);
      const players = Number(o.players);
      if (!/^\s*\d+\s*$/.test(o.players) || !Number.isInteger(players) || players < 0 || players > 8) throw new CliError(t("--players takes 0 to 8, not \"{value}\"", { value: o.players }), null, 2);
      if (o.layout !== undefined && !players) throw new CliError(t("--layout lays out start locations, and there are none without --players"), t("Add --players <n>."), 2);
      const piped = given === STDIO;
      // A map's extension, or none (then the revision's); anything else is refused rather than written under it.
      const ext = extname(given);
      if (!piped && ext && !/^\.(scm|scx|chk)$/i.test(ext)) throw new CliError(t("{file} is not a map's name: a map is .scx, .scm or .chk", { file: given }), null, 2);
      const file = piped || ext ? given : `${given}.${MAP_EXTENSIONS[revision]}`;
      refuseJsonOnPipe(piped, o.json, "newMap");
      if (!piped) refuseOverwrite(file, o.force, t("--force overwrites it."));
      const r = await writeNewMap(file, { width, height, tileset, name: o.name !== undefined ? mapText(o.name) : piped ? "Untitled Scenario" : nameFromFile(file), description: mapText(o.description), version: revision, players, layout: layout as (typeof LAYOUTS)[number] });
      if (o.json) { print(JSON.stringify({ file, ...r }, null, 2)); return; }
      say(piped, `${mark.ok} ${pc.bold(piped ? t("standard output") : relative(process.cwd(), r.path) || r.path)}: ${r.width} × ${r.height}${dot}${translate(r.tileset)}${dot}${translate(r.version)}${r.starts ? `${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: r.starts })}` : ""}${dot}${size(r.bytes)}`,
        r.starts ? null : pc.dim(`  ${t("No start locations yet, so Check Map finds an error for each open slot; --players <n> lays them out for n players and closes the other slots.")}`));
    });

  map.command("generate").description(t("a symmetric melee map from a seed, laid with your copy of the game's tileset")).argument("<map>", t("the file to write: .scx, .scm or .chk")).addOption(json)
    .option("--players <n>", `${GEN_PLAYERS.join(", ")}`, "2")
    .option("--size <WxH>", t("width and height, each 96, 128, 192 or 256 (128x128; 192x192 for 8 players)"))
    .option("--tileset <name>", t("badlands, platform, ashworld, jungle, desert, ice or twilight"), "jungle")
    .option("--seed <n>", t("the same seed and options give the same map (a new one each time without)"))
    .option("--symmetry <how>", `${GEN_SYMMETRIES.join(", ")}`)
    .option("--style <how>", t("{styles}: an open middle, or one narrowed by more high ground", { styles: GEN_STYLES.join(t(" or ")) }), "open")
    .option("--name <text>", t("the map's name; the file's by default"))
    .option("--rush", t("then walk a unit between the starts in the game, as scmjs map rush does"))
    .addOption(starcraftOption())
    .addOption(forceOption())
    .addOption(new Option("--tilesets <folder>", t("a folder of extracted tilesets (<name>.cv5, <name>.dddata.bin, …) instead of the game")).hideHelp())
    .addOption(engineOption())
    .addHelpText("after", t(`
A main on high ground for each player with one ramp down to a natural, free bases where there is room, and a middle of
low ground with mesas, lakes and patches of the tileset's other ground. Every player's bases are the same, mirrored or
turned with the map. The ground is laid with the editor's isometric brush and the ramps are the tileset's own, so the
graphics come from your copy of StarCraft (Remastered or 1.16.1), as for scmjs map preview. Before the file is written
the map passes Check Map and every start is walked to every other over the walkable ground; a layout that fails is
thrown away and the next one tried. Exits 1 when none passes, 2 when an option is not one.
  scmjs map generate duel.scx --seed 7
  scmjs map generate four.scx --players 4 --tileset badlands --style chokes`))
    .action(async (file: string, o: GenerateFlags & { json?: boolean; rush?: boolean; force?: boolean; engine?: string }) => {
      const piped = file === STDIO;
      refuseJsonOnPipe(piped, o.json, "newMap");
      if (piped && o.rush) throw new CliError(t("--rush walks the map in the game, which needs it in a file"), t("Name a file to write."), 2);
      if (!piped) refuseOverwrite(file, o.force, t("--force overwrites it."));
      const name = o.name !== undefined ? mapText(o.name) : piped ? "Generated" : nameFromFile(file);
      const { report } = await runGenerate(file, o, name);
      // Four and eight players have one layout whatever --symmetry asks: said, so the option is not taken in silence.
      if (o.symmetry !== undefined && (report.players === 4 || report.players === 8)) process.stderr.write(`${mark.info} ${t("--symmetry {asked}: four and eight players are always mirrored both ways, since no tileset has the ramp a quarter turn would need", { asked: o.symmetry })}\n`);
      if (!o.json) say(piped, ...printGenerated(report, piped ? t("standard output") : nearPath(report.path)));
      if (!o.rush) { if (o.json) print(JSON.stringify(report, null, 2)); return; }
      if (!o.json) print("");
      const rush = await runRush(file, { starcraft: o.starcraft, engine: o.engine, live: o.json ? undefined : (line) => print(line) });
      if (o.json) print(JSON.stringify({ ...report, rush: rushJson(file, rush) }, null, 2));
      else print("", ...printRush(relative(process.cwd(), file) || file, rush));
    });

  map.command("dump").description(t("the whole map as text, for git diff and grep")).argument("<map>").addOption(json)
    .addHelpText("after", t(`
Everything the map holds, in one stable text form: the header, players, every unit and location, the triggers in the
trigger window's text, the strings, the archive's other files and the sections. To have git show a map's changes as
this text (git diff, git log -p, git show), once in the repository:
  git config diff.scmjs.textconv "scmjs map dump"
  git config diff.scmjs.xfuncname "^## .*"
  printf '*.scx diff=scmjs\\n*.scm diff=scmjs\\n*.chk diff=scmjs\\n' >> .gitattributes`))
    .action(async (file: string, o: { json?: boolean }) => {
      const { input, doc } = await openMap(file);
      const d = dumpMap(doc, input.path);
      if (o.json) print(JSON.stringify(d, null, 2));
      else process.stdout.write(printDump(d, doc.scenario));
    });

  map.command("find").description(t("search units, locations, strings and triggers across maps")).argument("<text>", t("what to look for; a number matches an id, slot or index too")).argument("<maps...>", t("the maps to search (.scm .scx .chk); - reads one from standard input")).addOption(json)
    .option("--in <kinds>", t("which of {kinds} to search, with commas between (or --in again); all by default", { kinds: KINDS.join(", ") }), (v: string, prev?: string) => (prev ? `${prev},${v}` : v))
    .option("--case", t("match case"))
    .addHelpText("after", t(`
Edit ▸ Find over any number of maps: a unit, location, sprite or doodad whose name holds the text, a string or a
trigger whose text does. Prints what matched and where. Exits 1 when nothing matched in any map, like grep.`))
    .action(async (text: string, files: string[], o: { json?: boolean; in?: string; case?: boolean }) => {
      const kinds = parseKinds(o.in);
      let found = 0, read = 0;
      await eachFile(files, !!o.json, async (input) => {
        expectKind(input, "map");
        const hits = findInMap(await loadMapInput(input), input.name, text, kinds, !!o.case);
        found += hits.length;
        read++;
        return { data: { file: input.path, matches: hits.length, hits: hits.map(hitJson) }, lines: hits.length ? [`${pc.bold(input.name)}  ${pc.dim(t("{n, plural, one {# match} other {# matches}}", { n: hits.length }))}`, ...printHits(hits)] : [] };
      }, false);
      // Counted over the maps read: one that could not be was said on its own line.
      if (!found) { if (!o.json && read) print(pc.dim(t("Nothing in {n, plural, one {# map} other {# maps}} matches \"{text}\"", { n: read, text }))); raiseExitCode(1); }
    });
}

export function addMapFetchCommand(map: Command): void {
  const json = jsonOption();
  map.command("fetch").description(t("search scmscx.com, the community's map database, and download a map")).argument("[words...]", t("what to search for: a map's name, words in its description, a file name")).addOption(json)
    .option("--limit <n>", t("how many of the best matches to list, 1 to {max}", { max: MAX_LIMIT }), String(DEFAULT_LIMIT))
    .option("--id <id>", t("download this map: its id from the list, or its address on the site"))
    .option("--first", t("download the best match for the words"))
    .addOption(outOption("path", t("the file to write, or a folder to write it in (the site's file name); - for standard output")))
    .addOption(forceOption())
    .option("--open", t("open the map in scmJS once it is downloaded, as scmjs map open does"))
    .addHelpText("after", "\n" + t(`The maps come from scmscx.com ({site}), where people have shared StarCraft maps for years; they are their
makers', and the site's. The list shows the best matches with their size, tileset, players, downloads and id; --id
or --first downloads one, named as the site names the file, into this folder or --out. The file is opened as the
editor opens it before it is written, so what arrives is a map. Exits 1 when nothing matched or the site did not
answer (within 10 seconds), 2 when the file is there already (--force overwrites it).`, { site: SCMSCX }) + `
  scmjs map fetch lost temple
  scmjs map fetch --id B8V7fdyj --out maps/
  scmjs map fetch lost temple --first --open
  scmjs map fetch fastest --first --out - | scmjs map info -`)
    .action(async (words: string[], o: { json?: boolean; limit?: string; id?: string; first?: boolean; out?: string; force?: boolean; open?: boolean }) => {
      const text = words.join(" ").trim();
      if (o.id && text) throw new CliError(t("--id downloads one map: give the id or the words, not both"), null, 2);
      if (!o.id && !text) throw new CliError(t("What to search for, or --id <id>"), "scmjs map fetch lost temple", 2);
      const download = !!(o.id || o.first);
      if (!download && (o.out || o.force || o.open)) throw new CliError(t("--out, --force and --open are for a download"), t("Add --first for the best match, or --id <id> from the list."), 2);
      const piped = download && o.out === STDIO;
      refuseJsonOnPipe(piped, o.json, "map");
      if (piped && o.open) throw new CliError(t("--open needs the map in a file"), t("Leave --out - off, or name a file or folder."), 2);
      const site = scmscx();
      if (!download) {
        const r = await searchMaps(site, text, parseLimit(o.limit));
        print(...(o.json ? [JSON.stringify(searchJson(r), null, 2)] : printSearch(r)));
        if (!r.maps.length) process.exitCode = 1;
        return;
      }
      let id = o.id ? mapIdFrom(o.id) : null;
      if (!id) {
        const best = (await site.search(text)).rows[0];
        if (!best) { if (!o.json) say(piped, pc.dim(t("Nothing on scmscx.com matches \"{words}\"", { words: text }))); process.exitCode = 1; return; }
        id = best.id;
      }
      const r = await fetchMap(site, id, { out: o.out, force: o.force });
      if (o.json) print(JSON.stringify(fetchJson(r), null, 2));
      else say(piped, ...printFetched(r));
      if (o.open) await openInScmjs({ path: r.written.path, name: r.report.file.name, bytes: new Uint8Array(await readFile(r.written.path)), kind: "map" }, {});
    });
}
