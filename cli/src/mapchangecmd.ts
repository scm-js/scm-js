/**
 * The `scmjs map` commands that change a map: its properties and settings, size, objects, triggers and strings, its
 * archive as a folder, and the TrigScript build and plugins run over it.
 */
import { relative } from "node:path";
import { Command, Option } from "commander";
import { listMembers, MANIFEST_FILE, packMap, unpackMap } from "./archive";
import { START_LOCATION, unitName } from "../../src/data/units";
import { buildMap, loadTypeScript, printBuild, readScript } from "./build";
import { importScript, lookUpApi, printScriptImport, scriptFilesFrom, scriptFilesWanted, scriptHeader, scriptText, writeScriptFiles } from "./script";
import { parseMapSize } from "./create";
import { ANCHORS, parseAnchor, pruneStrings, VERSIONS, ENCODINGS, resizeAndWrite } from "./edit";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack, writeOutput, type Written } from "./exchange";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { formatOf } from "../../src/editor/save";
import { COMPRESSIONS, optimizeJson, optimizeMap, printOptimize, type Compression } from "./optimize";
import { expectKind, readInput, readTextArg, STDIO, writeFileMade, openMap } from "./files";
import { printRun, runOnMap } from "./run";
import { editMap, parseEdits, printEdits } from "./mapedit";
import { listLocations, listUnits, printLocations, printUnits, UNIT_ROWS, type Area, type UnitFilter, areaOf } from "./objects";
import { DOODAD_ROWS, GRID_COLUMNS, listDoodads, listTerrain, printDoodads, printTerrain } from "./terrain";
import { listSettings, parseSettings, printSettingChanges, printSettings, type MapSettings, setMap } from "./settings";
import { exportSounds, printSounds, readSounds } from "./sounds";
import { editInEditor, type EditKind, type EditOutcome } from "./texteditor";
import { t, translate } from "./i18n";
import { CliError, columns, dot, mark, num, padColumns, pc, print, size } from "./ui";
import { parseWhole } from "./values";
import { piping, say, outName, note } from "./cmdkit";
import { jsonOption, starcraftOption, outOption, mapOutOption, forceOption, dryRunOption, refuseBothFromStdin, refuseJsonOnPipe } from "./options";

export function addMapChangeCommands(map: Command): void {
  const json = jsonOption();
  /** `--out` for text: the file, or stdout when there is none (or `-`). */
  async function emit(text: string, out: string | undefined, said: string): Promise<void> {
    if (!out || out === STDIO) { process.stdout.write(text); return; }
    await writeFileMade(out, text);
    print(`${mark.ok} ${said} ${pc.dim("→")} ${pc.cyan(out)}`);
  }

  /** "3 triggers", or "3 briefing triggers". */
  const triggerCount = (n: number, briefing?: boolean) => (briefing ? t("{n, plural, one {# briefing trigger} other {# briefing triggers}}", { n }) : t("{n, plural, one {# trigger} other {# triggers}}", { n }));

  /**
   * `map triggers edit` / `map strings edit`: the text in the editor, imported when it closes, the map written back as
   * `import` writes it. Standard input cannot be edited: the editor needs the terminal.
   */
  async function editCommand(kind: EditKind, file: string, o: { editor?: string; out?: string; briefing?: boolean; json?: boolean }): Promise<void> {
    if (file === STDIO) throw new CliError(t("map {kind} edit needs a map file, not standard input", { kind }), t("The editor takes the terminal; name the file, or use export and import in a pipe."), 2);
    if (o.out === STDIO) throw new CliError(t("--out - is for a pipe; edit writes a file"), null, 2);
    if (o.editor !== undefined && !o.editor.trim()) throw new CliError(t("--editor needs a command"), t("Such as: --editor \"code --wait\", --editor nano."), 2);
    // vi with no terminal waits for keys that never come: with nothing named, a pipe or a script is refused instead.
    const named = [o.editor, process.env.VISUAL, process.env.EDITOR].some((v) => v && v.trim());
    if (!named && process.platform !== "win32" && !(process.stdin.isTTY && process.stdout.isTTY)) throw new CliError(t("map {kind} edit opens vi, which needs a terminal, and this has none", { kind }), t("Name an editor with --editor or EDITOR, or use map {kind} export and import in a script.", { kind }), 2);
    const { input, doc } = await openMap(file);
    let w: Written | null = null;
    const r: EditOutcome = await editInEditor(doc, input.path, kind, {
      editor: o.editor, briefing: o.briefing,
      onWait: (path) => { if (process.stderr.isTTY) process.stderr.write(pc.dim(`${t("Waiting for your editor to close {path}…", { path })}\n`)); },
      write: async () => { w = await writeBack(doc, input.path, o.out ?? null); },
    });
    // --out names a file the next step reads: it is written, changed or not.
    if (!r.changed && o.out) w = await writeBack(doc, input.path, o.out);
    const written = w as Written | null;
    if (o.json) {
      print(JSON.stringify({ file: input.path, changed: r.changed, ...(r.changed ? (r.kind === "triggers" ? { triggers: r.triggers } : { strings: r.strings }) : {}), written }, null, 2));
      return;
    }
    if (!r.changed) { print(`${mark.info} ${pc.bold(input.name)}: ${t("nothing changed")}${written ? `${dot}${t("written to {out}", { out: outName(written) })}` : ""}`); return; }
    const what = r.kind === "triggers"
      ? `${triggerCount(r.triggers.before, o.briefing)} ${pc.dim("→")} ${triggerCount(r.triggers.after, o.briefing)}`
      : t("{n, plural, one {# string} other {# strings}} replaced, {added} added", { n: r.strings.replaced, added: r.strings.added });
    print(`${mark.ok} ${pc.bold(input.name)}: ${what}${dot}${t("written to {out}", { out: outName(written!) })}${dot}${size(written!.bytes)}`);
  }

  map.command("set").description(t("the map's name, description, revision or text encoding, and its player, force, unit, upgrade and technology settings")).argument("<map>").addOption(json)
    .option("--name <text>", t("the map's name"))
    .option("--description <text>", t("the map's description"))
    .option("--revision <which>", t("the file's revision: {versions}", { versions: VERSIONS.join(", ") }))
    .option("--encoding <id>", t("the text encoding: {encodings}", { encodings: ENCODINGS.join(", ") }))
    .option("--settings <file>", t("players, forces, units, upgrades, techs and switches to set, as JSON; - reads it from standard input"))
    .addOption(mapOutOption())
    .addOption(dryRunOption())
    .addOption(starcraftOption(t("your installation of StarCraft, for a unit's, upgrade's or technology's numbers (SCMJS_STARCRAFT); found in the usual places otherwise")))
    .addHelpText("after", t(`
Scenario ▸ Map Properties from the terminal: what is given is set, the rest is left. Nothing is written when nothing
changed. A revision change does what the editor's does (the string table's form, the colour section the revision
needs); the encoding is how the map's text is written for 1.16.1, where Remastered reads UTF-8.

--settings takes the Scenario menu's other dialogs as a JSON object with any of these lists:
  players   player (1 to 12), then type (Human, Computer, Rescuable, Neutral, …), race (Zerg, Terran, Protoss,
            User Selectable, Random, …), color (a name such as Red, a number, or [r, g, b]), force (1 to 4)
  forces    force (1 to 4), then name, players (to move into it), allied, alliedVictory, sharedVision, randomStart
  units     unit (a name or id), then name, hitPoints, shields, armor, buildTime, mineralCost, gasCost,
            weapons [{ weapon, damage, bonus }], available [{ player, value }], useDefault
  upgrades  upgrade (a name or id), then mineralCost, mineralFactor, gasCost, gasFactor, timeCost, timeFactor,
            levels [{ player, start, max, useDefault }], useDefault
  techs     tech (a name or id), then mineralCost, gasCost, researchTime, energyCost,
            state [{ player, available, researched, useDefault }], useDefault
  switches  switch (1 to 256), name
In available, levels and state a player is 1 to 12, or "default" for the column the players follow until they are
given a value of their own; available's value is true, false, or "default" to follow that column again.
Only what is given changes; scmjs map settings lists what the map has. A number for a unit, upgrade or technology
takes it off the game's own numbers, and the rest of its row is filled in from your copy of StarCraft, so those
settings need one. A name the map or the game does not have stops everything: nothing is written.
  scmjs map set ridge.scx --name "Hold the Ridge"
  scmjs map set ridge.scx --settings settings.json --dry-run`))
    .action(async (file: string, o: { json?: boolean; name?: string; description?: string; revision?: string; encoding?: string; settings?: string; out?: string; dryRun?: boolean; starcraft?: string }) => {
      if (o.name === undefined && o.description === undefined && o.revision === undefined && o.encoding === undefined && o.settings === undefined) throw new CliError(t("Nothing to set"), t("--name, --description, --revision, --encoding or --settings, any of them."), 2);
      refuseBothFromStdin(file, o.settings, "settings");
      let settings: MapSettings | null = null;
      if (o.settings !== undefined) {
        const text = new TextDecoder().decode(await readTextArg(o.settings));
        let value: unknown;
        try { value = JSON.parse(text); } catch (e) { throw new CliError(t("{file} is not JSON: {reason}", { file: o.settings === STDIO ? t("standard input") : o.settings, reason: e instanceof Error ? e.message : String(e) }), null, 2); }
        settings = parseSettings(value);
      }
      const opened = await openMap(file);
      const { input } = opened;
      const piped = piping(input, o);
      // A pipe always gets the map, changed or not, so the next step has one.
      const { changes, set, changed, written: w, asciiOnly } = await setMap(opened, { name: o.name, description: o.description, revision: o.revision, encoding: o.encoding, settings, starcraft: o.starcraft, out: o.out ?? null, dryRun: o.dryRun, always: piped });
      if (o.json) { print(JSON.stringify({ file: input.path, changes, ...(set ? { settings: set.changes, game: set.game } : {}), ...(asciiOnly ? { encoding: "plain ASCII text, the same in every encoding" } : {}), dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      const note = asciiOnly ? `${mark.info} ${t("The map's text is plain ASCII, the same in every encoding, so the encoding has nothing to change")}` : null;
      const where = w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : o.dryRun && changed ? pc.dim(` ${t("(--dry-run: nothing written)")}`) : "";
      if (!changed) { say(piped, note, `${mark.ok} ${pc.bold(input.name)}: ${t("nothing changed")}${where}`); return; }
      const said = [
        ...changes.map((c) => `${translate(c.field)} ${pc.red(c.from || pc.dim(t("(none)")))} ${pc.dim("→")} ${pc.green(c.to || pc.dim(t("(none)")))}`),
        ...(set?.changes.length ? [t("{n, plural, one {# setting} other {# settings}} changed", { n: set.changes.length })] : []),
      ];
      say(piped, note, ...(set ? printSettingChanges(set.changes) : []), `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${said.join(dot)}${where}`);
    });

  map.command("resize").description(t("Scenario ▸ Resize: the map to another size, anchored")).argument("<map>").addOption(json)
    .requiredOption("--size <WxH>", t("the new width and height, each 64, 96, 128, 192 or 256"))
    .option("--anchor <where>", t("{anchors}: which part of the map stays", { anchors: Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ") }), "center")
    .option("--no-clamp", t("leave locations that hang past the new edge where the shift put them"))
    .option("--all", t("list everything dropped; by default a long list is cut at 20"))
    .addOption(mapOutOption())
    .addOption(dryRunOption())
    .addHelpText("after", t(`
The map is moved under the anchor; what falls outside is dropped (units, sprites, doodads) or pulled inside
(locations, unless --no-clamp), and new ground is the tileset's base terrain. Says what was dropped.`))
    .action(async (file: string, o: { json?: boolean; size: string; anchor: string; clamp: boolean; all?: boolean; out?: string; dryRun?: boolean }) => {
      const { width, height } = parseMapSize(o.size);
      const anchor = parseAnchor(o.anchor);
      const opened = await openMap(file);
      const { input } = opened;
      const piped = piping(input, o);
      const { result: r, written: w } = await resizeAndWrite(opened, { width, height, anchor, clamp: o.clamp, out: o.out ?? null, dryRun: o.dryRun });
      if (o.json) { print(JSON.stringify({ file: input.path, ...r, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      const dropped = [r.unitsDropped && t("{n, plural, one {# unit} other {# units}}", { n: r.unitsDropped }), r.spritesDropped && t("{n, plural, one {# sprite} other {# sprites}}", { n: r.spritesDropped }), r.doodadsDropped && t("{n, plural, one {# doodad} other {# doodads}}", { n: r.doodadsDropped })].filter(Boolean).join(", ");
      const where = w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : pc.dim(` ${t("(--dry-run: nothing written)")}`);
      // Start locations are always named; the rest of the list is cut at 20 unless --all.
      const starts = r.dropped.filter((d) => d.kind === "unit" && d.name === unitName(START_LOCATION));
      const limit = o.all ? Infinity : 20;
      const thing = (d: { kind: string; name: string; owner: number; x: number; y: number }) => `  ${pc.dim(d.kind === "unit" ? t("unit") : d.kind === "sprite" ? t("sprite") : t("doodad"))}  ${d.name}  ${pc.dim(`${d.owner === 11 ? t("Neutral") : t("Player {n}", { n: d.owner + 1 })} · ${d.x},${d.y}`)}`;
      const rest = r.dropped.filter((d) => !starts.includes(d));
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${r.from.width} × ${r.from.height} ${pc.dim("→")} ${r.to.width} × ${r.to.height}${dropped ? `${dot}${pc.yellow(t("{list} dropped", { list: dropped }))}` : ""}${r.locationsClamped ? `${dot}${t("{n, plural, one {# location} other {# locations}} pulled inside", { n: r.locationsClamped })}` : ""}${where}`,
        ...starts.map((d) => `${mark.warn} ${t("The start location of {player} is dropped", { player: t("Player {n}", { n: d.owner + 1 }) })} ${pc.dim(`(${d.x},${d.y})`)}`),
        ...rest.slice(0, limit).map(thing),
        ...(rest.length > limit ? [pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(rest.length - limit) })}`)] : []),
        r.collapsed.length ? `${mark.warn} ${t("Pulled inside with no width or height left: {list}", { list: r.collapsed.join(", ") })}` : null,
        r.outside.length ? `${mark.warn} ${t("Left past the map's edge (--no-clamp): {list}", { list: r.outside.join(", ") })}` : null);
    });

  map.command("edit").description(t("apply a list of edits to the map's units, locations, sprites, fog, terrain and doodads, all or none")).argument("<map>", t("the map to change; - reads it from standard input")).addOption(json)
    .requiredOption("--edits <file>", t("the edits: a JSON list, or an object with the list as \"edits\"; - reads it from standard input"))
    .addOption(mapOutOption())
    .addOption(dryRunOption(t("say what would change, as map diff does, and write nothing")))
    .option("--all", t("list every edit and every change; by default a long list is cut"))
    .addOption(starcraftOption(t("your installation of StarCraft, for terrain and doodads (SCMJS_STARCRAFT); found in the usual places otherwise")))
    .addHelpText("after", t(`
Each edit is an object with an "op" and its fields:
  place_unit        unit, player, x, y (or tileX, tileY), and any of the properties below; snap (a building on
                    the building grid), check (refuse a position the editor would refuse)
  move_units        indices or where, then x, y (one unit) or dx, dy (any number)
  update_units      indices or where, then player, hitPoints, shields, energy (percent), resources, hangar,
                    cloaked, burrowed, lifted, hallucinated, invincible
  remove_units      indices or where
  add_location      name, and rect {left, top, right, bottom} in pixels or tiles {x0, y0, x1, y1}
  edit_location     location (a name or number), then name, rect or tiles
  remove_locations  locations (names or numbers)
  place_sprite      sprite (a sprites.dat id) or unit, then player, x, y (or tileX, tileY), flipped, disabled
  remove_sprites    indices or where {sprite, unit, player, rect, tiles, location}
  set_fog           players (1 to 8), mode fog or clear, and rect, tiles or location (the whole map without one)
  paint_terrain     terrain (a name or id, as scmjs map terrain lists them), and rect, tiles or location (the whole
                    map without one); shape rect or ellipse; cover (0 to 1: that share of the area, in patches),
                    grain (a patch's size in tiles), seed; symmetry h, v, hv, rot180, rot90, diag or adiag
  place_doodad      doodad (an id or name, a category for any of its doodads, or "ramp"), tileX, tileY (its top-left
                    tile); within (tiles to look around for a place it fits), force, seed
  scatter_doodads   doodad, and rect, tiles or location; count or density (0 to 1), seed
  remove_doodads    indices or where {doodad, rect, tiles, location}
A unit is a name ("Terran Marine", "Zergling") or a units.dat id, a player 1 to 12 (12 is neutral). indices are the
ones scmjs map units lists, as the map was before the edits; where is {unit, player, rect, tiles, location}, all of
which must hold. The edits are applied together: when one cannot be done, nothing is written and the error names it
by its place in the list, from 0. A unit's position is taken as given unless the edit says snap or check.

Terrain is painted with the editor's isometric brush, so a cliff or a shore forms where two terrains meet, and a
doodad goes where StarEdit would let it. Those edits, and snap and check, read your own copy of StarCraft: the
tileset and the unit tables. A list without them needs no copy.`))
    .action(async (file: string, o: { json?: boolean; edits: string; out?: string; dryRun?: boolean; all?: boolean; starcraft?: string }) => {
      refuseBothFromStdin(file, o.edits, "edits");
      const text = new TextDecoder().decode(await readTextArg(o.edits));
      let value: unknown;
      try { value = JSON.parse(text); } catch (e) { throw new CliError(t("{file} is not JSON: {reason}", { file: o.edits === STDIO ? t("standard input") : o.edits, reason: e instanceof Error ? e.message : String(e) }), null, 2); }
      const edits = parseEdits(value);
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const r = await editMap(input, doc, edits, { out: o.out ?? null, dryRun: !!o.dryRun, starcraft: o.starcraft });
      if (o.json) print(JSON.stringify({ file: input.path, ...r, dryRun: !!o.dryRun }, null, 2));
      else say(piped, ...printEdits(input.name, r, { dryRun: !!o.dryRun, all: !!o.all }));
    });

  /** `--rect` and `--tiles`: four whole numbers with commas between. */
  const fourOf = (value: string, option: string): [number, number, number, number] => {
    const parts = value.split(",").map((v) => v.trim());
    if (parts.length !== 4 || !parts.every((v) => /^\d+$/.test(v))) throw new CliError(t("{option} takes four whole numbers with commas between, not \"{value}\"", { option, value }), null, 2);
    return parts.map(Number) as [number, number, number, number];
  };
  const rectOf = (value: string) => { const [left, top, right, bottom] = fourOf(value, "--rect"); return { left, top, right, bottom }; };
  const tilesOf = (value: string) => { const [x0, y0, x1, y1] = fourOf(value, "--tiles"); return { x0, y0, x1, y1 }; };
  map.command("units").description(t("the map's units with their index, type, player and position, all or some")).argument("<map>", t("the map; - reads it from standard input")).addOption(json)
    .option("--unit <name>", t("only this type: a name (\"Terran Marine\", Zergling) or a units.dat id"))
    .option("--player <n>", t("only this player's, 1 to 12 (12 is neutral)"))
    .option("--location <name>", t("only those inside this location, by name or number"))
    .option("--rect <l,t,r,b>", t("only those inside this rectangle, in pixels"))
    .option("--tiles <x0,y0,x1,y1>", t("only those inside this rectangle, in tiles"))
    .option("--all", t("list every unit; by default a long list is cut at {n}", { n: UNIT_ROWS }))
    .addHelpText("after", t(`
A row a unit: its index (its place in the file, from 0, which scmjs map edit takes), type, player, position in
pixels and in tiles, and the properties its record sets. The filters narrow the list and all of them must hold; a
unit is inside an area when its centre is.`))
    .action(async (file: string, o: { json?: boolean; unit?: string; player?: string; location?: string; rect?: string; tiles?: string; all?: boolean }) => {
      const filter: UnitFilter = {};
      if (o.unit !== undefined) filter.unit = o.unit;
      if (o.player !== undefined) {
        filter.player = parseWhole(o.player, "player", 1);
        if (filter.player > 12) throw new CliError(t("--player is 1 to 12 (12 is neutral), not {value}", { value: o.player }), null, 2);
      }
      if (o.location !== undefined) filter.location = o.location;
      if (o.rect !== undefined) filter.rect = rectOf(o.rect);
      if (o.tiles !== undefined) filter.tiles = tilesOf(o.tiles);
      const { input, doc } = await openMap(file);
      const r = listUnits(doc, input.path, filter);
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(...printUnits(input.name, r, !!o.all));
    });

  map.command("locations").description(t("the map's locations with their number, name, bounds and the units inside")).argument("<map>", t("the map; - reads it from standard input")).addOption(json)
    .addHelpText("after", t(`
A row a location: its number as triggers count it (which scmjs map edit takes, as it takes the name), its name, its
box in pixels and the tiles the box touches, and how many units have their centre inside.`))
    .action(async (file: string, o: { json?: boolean }) => {
      const { input, doc } = await openMap(file);
      const r = listLocations(doc, input.path);
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(...printLocations(input.name, r));
    });

  map.command("settings").description(t("the map's players and forces, and the unit, upgrade and technology settings it changes")).argument("<map>", t("the map; - reads it from standard input")).addOption(json)
    .option("--unit <name>", t("this unit type alone, changed or not, with the game's own numbers beside it"))
    .option("--upgrade <name>", t("this upgrade alone"))
    .option("--tech <name>", t("this technology alone"))
    .addOption(starcraftOption())
    .option("--no-game", t("do not read the game's own numbers"))
    .addHelpText("after", t(`
The Scenario menu's settings: the twelve players (type, race, colour, force), the four forces, then the unit types,
upgrades and technologies the map changes from the game's, each with what it sets, and the switches it names. A row
on "the game's numbers" keeps the game's hit points, costs and times. --unit, --upgrade and --tech show one row
whether the map changes it or not, and read the game's own numbers from your copy of StarCraft when one is there.
scmjs map set --settings sets them.`))
    .action(async (file: string, o: { json?: boolean; unit?: string; upgrade?: string; tech?: string; starcraft?: string; game?: boolean }) => {
      const { input, doc } = await openMap(file);
      const r = await listSettings(doc, input.path, { unit: o.unit, upgrade: o.upgrade, tech: o.tech, starcraft: o.starcraft, game: o.game });
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(...printSettings(input.name, r));
    });

  /** `--rect`, `--tiles` and `--location` as an area; undefined when none was given. */
  const areaGiven = (o: { location?: string; rect?: string; tiles?: string }): Area | undefined => areaOf({ location: o.location, rect: o.rect === undefined ? undefined : rectOf(o.rect), tiles: o.tiles === undefined ? undefined : tilesOf(o.tiles) });
  map.command("terrain").description(t("the map's terrain: the tileset's terrains, how much of the map each covers, and the map as a grid of letters")).argument("<map>", t("the map; - reads it from standard input")).addOption(json)
    .option("--location <name>", t("only this location's area, by name or number"))
    .option("--rect <l,t,r,b>", t("only this rectangle, in pixels"))
    .option("--tiles <x0,y0,x1,y1>", t("only this rectangle, in tiles"))
    .option("--cell <n>", t("tiles a character of the grid; by default as many as keep it to {n} columns", { n: GRID_COLUMNS }))
    .option("--no-grid", t("the table alone"))
    .addOption(starcraftOption())
    .addHelpText("after", t(`
A row a terrain of the map's tileset: the letter the grid draws it with, its name and id (scmjs map edit's
paint_terrain takes either), its height (low, mid, high: a cliff forms between two heights), whether buildings
go on it, and the tiles it covers. Then the map, or the area asked for, as a grid: a character a cell, the terrain
most of the cell is, lower case for low ground. A tile under a cliff, a shore or a doodad counts as the terrain the
isometric lattice gives it. The terrains are read from your own copy of StarCraft.`))
    .action(async (file: string, o: { json?: boolean; location?: string; rect?: string; tiles?: string; cell?: string; grid?: boolean; starcraft?: string }) => {
      const cell = o.cell === undefined ? undefined : parseWhole(o.cell, "cell", 1);
      const area = areaGiven(o);
      const { input, doc } = await openMap(file);
      const r = await listTerrain(doc, input.path, { area, cell, starcraft: o.starcraft });
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(...printTerrain(input.name, r, { grid: o.grid !== false }));
    });

  map.command("doodads").description(t("the map's doodads with their index, and the doodads the tileset has to place")).argument("<map>", t("the map; - reads it from standard input")).addOption(json)
    .option("--category <name>", t("only this category's doodads, placed and to place; \"ramp\" for the ramps"))
    .option("--palette", t("list every doodad the tileset has to place, with its size and the ground it goes on"))
    .option("--location <name>", t("only those inside this location, by name or number"))
    .option("--rect <l,t,r,b>", t("only those inside this rectangle, in pixels"))
    .option("--tiles <x0,y0,x1,y1>", t("only those inside this rectangle, in tiles"))
    .option("--all", t("list every row; by default a long list is cut at {n}", { n: DOODAD_ROWS }))
    .addOption(starcraftOption())
    .addHelpText("after", t(`
A row a doodad on the map: its index (its place in the file, from 0, which scmjs map edit's remove_doodads takes),
its name and id, its top-left tile and its size in tiles. Then the tileset's categories; with --category or
--palette, the doodads that can be placed, each with the ground StarEdit lets it go on. A doodad has no name of
its own: it is its category and its id. The doodads are read from your own copy of StarCraft.`))
    .action(async (file: string, o: { json?: boolean; category?: string; palette?: boolean; location?: string; rect?: string; tiles?: string; all?: boolean; starcraft?: string }) => {
      const area = areaGiven(o);
      const { input, doc } = await openMap(file);
      const r = await listDoodads(doc, input.path, { area, category: o.category, palette: !!o.palette, starcraft: o.starcraft });
      if (o.json) print(JSON.stringify(r, null, 2));
      else print(...printDoodads(input.name, r, !!o.all));
    });

  const triggers = map.command("triggers").description(t("a map's triggers as a text or .trg file, and back"))
    .addHelpText("after", t(`
The text form is the trigger window's (docs.scmjs.dev/triggers); a .trg holds the raw records, as SCMDraft trades
them. Text in a file beside the map can be diffed and edited, and imported back.`));
  triggers.command("export").description(t("the triggers as text (to stdout), or as .trg with --out x.trg")).argument("<map>")
    .addOption(outOption("file", t("write to this file instead of stdout; .trg writes the raw records")))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .action(async (file: string, o: { out?: string; briefing?: boolean }) => {
      const { doc } = await openMap(file);
      const r = exportTriggers(doc, o.out ?? null, !!o.briefing);
      if (r.bytes) { await writeFileMade(o.out!, r.bytes); print(`${mark.ok} ${triggerCount(r.count, o.briefing)} ${pc.dim("→")} ${pc.cyan(o.out!)}`); }
      else await emit(r.text!, o.out, triggerCount(r.count, o.briefing));
    });
  triggers.command("import").description(t("replace the map's triggers with a text or .trg file's")).argument("<map>", t("the map to change; - reads it from standard input")).argument("<file>", t("the triggers: text, or .trg; - reads text from standard input")).addOption(json)
    .addOption(mapOutOption())
    .option("--append", t("add the file's triggers after the map's own instead of replacing them"))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .option("--allow-empty", t("take a file with no triggers in it, which leaves the map with none"))
    .addOption(dryRunOption())
    .action(async (file: string, from: string, o: { json?: boolean; out?: string; append?: boolean; briefing?: boolean; allowEmpty?: boolean; dryRun?: boolean }) => {
      refuseBothFromStdin(file, from, "triggers");
      const bytes = await readTextArg(from);
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const r = importTriggers(doc, from === STDIO ? "stdin.txt" : from, bytes, { briefing: !!o.briefing, append: !!o.append, allowEmpty: !!o.allowEmpty });
      const w = o.dryRun ? null : await writeBack(doc, input.path, o.out ?? null);
      if (o.json) { print(JSON.stringify({ file: input.path, briefing: !!o.briefing, ...r, added: o.append ? r.read : undefined, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      const counts = `${triggerCount(r.before, o.briefing)} ${pc.dim("→")} ${triggerCount(r.after, o.briefing)}${o.append ? pc.dim(t(" ({n} added)", { n: r.read })) : ""}`;
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${counts}${w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : pc.dim(` ${t("(--dry-run: nothing written)")}`)}`);
    });
  const editorOption = () => new Option("--editor <command>", t("the editor to open, such as \"code --wait\"; VISUAL or EDITOR otherwise, else vi (Notepad on Windows)"));
  triggers.command("edit").description(t("the triggers as text in your editor, imported when you close it")).argument("<map>").addOption(json)
    .addOption(editorOption())
    .addOption(mapOutOption(t("write the result here instead of over the map")))
    .option("--briefing", t("the mission briefing's triggers instead"))
    .addHelpText("after", t(`
Writes the text export to a file of its own, opens it in your editor and waits for the editor to close. Saved with
changes, the text is imported as triggers import reads it and the map is written; unchanged, nothing is written.
Text that does not read is kept, and the error says where, so the edit is not lost. A graphical editor has to wait
for its window to close: code --wait, subl -w, gedit -s.`))
    .action((file: string, o: { editor?: string; out?: string; briefing?: boolean; json?: boolean }) => editCommand("triggers", file, o));

  const strings = map.command("strings").description(t("a map's strings as a text file, and back"))
    .addHelpText("after", t(`
One line per string: its number, a tab, its text. Colour codes are written <XX>. Importing sets the numbered
strings in place and adds any past the end; nothing is renumbered, since triggers and locations hold the numbers.`));
  strings.command("export").description(t("the strings as <number><TAB><text> lines (to stdout)")).argument("<map>")
    .addOption(outOption("file", t("write to this file instead of stdout")))
    .action(async (file: string, o: { out?: string }) => {
      const { doc } = await openMap(file);
      const r = exportStrings(doc);
      await emit(r.text, o.out, t("{n, plural, one {# string} other {# strings}}", { n: r.count }));
    });
  strings.command("import").description(t("set the map's strings from such a file")).argument("<map>", t("the map to change; - reads it from standard input")).argument("<file>", t("the strings file; - reads it from standard input")).addOption(json)
    .addOption(mapOutOption())
    .addOption(dryRunOption())
    .action(async (file: string, from: string, o: { json?: boolean; out?: string; dryRun?: boolean }) => {
      refuseBothFromStdin(file, from, "strings");
      const text = new TextDecoder().decode(await readTextArg(from));
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const r = importStrings(doc, from === STDIO ? "stdin.txt" : from, text);
      const w = o.dryRun ? null : await writeBack(doc, input.path, o.out ?? null);
      if (o.json) { print(JSON.stringify({ file: input.path, ...r, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${t("{n, plural, one {# string} other {# strings}} replaced, {added} added, {unchanged} unchanged", { n: r.replaced, added: r.added, unchanged: r.unchanged })}${w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : pc.dim(` ${t("(--dry-run: nothing written)")}`)}`);
    });
  strings.command("edit").description(t("the strings in your editor, imported when you close it")).argument("<map>").addOption(json)
    .addOption(editorOption())
    .addOption(mapOutOption(t("write the result here instead of over the map")))
    .addHelpText("after", t(`
As strings import: a line changed sets that string, a line past the end adds one, and a line taken out leaves the
string as it was (strings prune drops the unused ones).`))
    .action((file: string, o: { editor?: string; out?: string; json?: boolean }) => editCommand("strings", file, o));

  strings.command("prune").description(t("drop the strings nothing in the map refers to")).argument("<map>").addOption(json)
    .addOption(dryRunOption(t("list them and write nothing")))
    .option("--all", t("list every string dropped; by default a long list is cut at 20"))
    .addOption(mapOutOption())
    .addHelpText("after", t(`
The editor's Delete Unused: a string no trigger, location, name, force, sound or setting refers to is blanked. Nothing
is renumbered, so what the triggers hold stays right; blank slots at the end of the table are dropped.`))
    .action(async (file: string, o: { json?: boolean; dryRun?: boolean; all?: boolean; out?: string }) => {
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const removed = pruneStrings(doc, { dryRun: !!o.dryRun });
      // --out or a pipe always gets the map: the next step reads it.
      const w = (removed.length || piped || o.out) && !o.dryRun ? await writeBack(doc, input.path, o.out ?? null) : null;
      if (o.json) { print(JSON.stringify({ file: input.path, removed, dryRun: !!o.dryRun, written: w }, null, 2)); return; }
      if (!removed.length) { say(piped, `${mark.ok} ${pc.bold(input.name)}: ${t("every string is referred to")}${w ? `${dot}${t("written to {out}", { out: outName(w) })}` : ""}`); return; }
      const limit = o.all ? Infinity : 20;
      const show = (s: string) => { const p = s.replace(/\s+/g, " "); return p.length > 70 ? `${p.slice(0, 67)}…` : p; };
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(input.name)}: ${o.dryRun ? t("{n, plural, one {# unused string} other {# unused strings}} would be dropped", { n: removed.length }) : t("{n, plural, one {# unused string} other {# unused strings}} dropped", { n: removed.length })}${w ? `${dot}${t("written to {out}", { out: outName(w) })}${dot}${size(w.bytes)}` : ""}`,
        ...removed.slice(0, limit).map((r) => `  ${pc.dim(String(r.index).padStart(4))}  ${show(r.text)}`),
        ...(removed.length > limit ? [pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(removed.length - limit) })}`)] : []));
    });

  map.command("optimize").description(t("the map made smaller without changing what the game plays")).argument("<map>").addOption(json)
    .addOption(dryRunOption(t("say what would go and what each step saves; write nothing")))
    .option("--strip-editor", t("also drop the sections only editors read (ISOM, TILE, DD2, the sound list, switch names…)"))
    .option("--compression <method>", t("pkware (every version of the game) or zlib (Remastered only); default pkware, or the smaller for a zlib map"))
    .option("--keep <member>", t("an archive member to keep though nothing names it, once per member; a name ending in \\ keeps a folder"), (v: string, list: string[] = []) => [...list, v])
    .option("--all", t("list everything removed; by default a long list is cut at 20"))
    .addOption(mapOutOption())
    .addHelpText("after", t(`
In order: sounds no trigger or briefing plays and the sound list does not name, the sound list's entries for files
the map lacks, any other archive member nothing names, the strings nothing refers to, and every member compressed
again. A table says what each step saved. Kept whatever refers to them: TrigScript, Magenta and build files
(trigscript\\, magenta\\, scmjs\\), members with no name, and sounds stored with the game's own ADPCM compression,
which nothing the editor writes beats. A built map keeps its scenario as built, and a map whose triggers write to
the game's memory (EUD) keeps its strings.

--strip-editor also drops ISOM, TILE, DD2, IVER, IVE2, IOWN, UPUS, SWNM and WAV, which the game never reads: the map
plays the same, but an editor opening it has no isometric terrain, no doodads to select, no sound list and no
switch names. Keep the original to go on editing.
  scmjs map optimize "My Map.scx" --dry-run
  scmjs map optimize "My Map.scx" --out "My Map (small).scx" --strip-editor`))
    .action(async (file: string, o: { json?: boolean; dryRun?: boolean; stripEditor?: boolean; compression?: string; keep?: string[]; all?: boolean; out?: string }) => {
      const compression = o.compression?.toLowerCase();
      if (compression !== undefined && !(COMPRESSIONS as readonly string[]).includes(compression)) throw new CliError(t("--compression takes {values}, not \"{value}\"", { values: COMPRESSIONS.join(t(" or ")), value: o.compression! }), null, 2);
      const input = await readInput(file);
      expectKind(input, "map");
      const piped = piping(input, o);
      const bare = !looksLikeMpq(input.bytes);
      if (o.out && o.out !== STDIO && (formatOf(o.out) === "chk") !== bare) throw new CliError(t("map optimize writes the map in its own form: {how}", { how: bare ? t("a bare scenario stays a .chk") : t("an archive stays a .scx or .scm") }), t("Name an output of the same kind, or convert with the editor first."), 2);
      const r = await optimizeMap(input.bytes, input.name, { stripEditor: !!o.stripEditor, compression: compression as Compression | undefined, keep: o.keep });
      // Smaller is written; a compression asked for is written even when larger (it is what the file is for). A map
      // that cannot be made smaller still goes where --out or a pipe wants one, as it was: the next step reads it.
      const result = r.after < r.before || (compression !== undefined && !bare) ? r.bytes : null;
      const w = o.dryRun ? null : result ? await writeOutput(result, o.out ?? input.path) : o.out || piped ? await writeOutput(input.bytes, o.out ?? STDIO) : null;
      if (o.json) { print(JSON.stringify(optimizeJson(r, { file: input.path, dryRun: !!o.dryRun, written: w, changed: !!result }), null, 2)); return; }
      say(piped, ...printOptimize(r, { dryRun: !!o.dryRun, written: w ? outName(w) : null, all: !!o.all, asked: result !== null && r.after >= r.before, copied: !!w && !result }));
    });

  map.command("unpack").description(t("a map's archive as a folder: the scenario, its sounds, scripts and other files")).argument("<map>").addOption(json)
    .addOption(outOption("folder", t("the folder to write; by default one named after the map, beside it")))
    .option("--list", t("list the archive's members and write nothing"))
    .option("--text", t("the scenario as a folder of text files (scenario/), for git, instead of staredit/scenario.chk"))
    .addHelpText("after", t(`
Each member becomes a file at its archive path (staredit/scenario.chk, staredit/wav/…, trigscript/…), and
{manifest} records the map's name, how it was stored and the members without a name, so that scmjs map pack
puts the archive back together as it was.

With --text the scenario is written as text instead: scenario/map.json (size, tileset, players, forces),
terrain.txt, units.tsv, locations.tsv, strings.txt, triggers.txt and the rest, and the sections the editor does
not model as bytes under scenario/sections/. Edit the text and scmjs map pack builds the map from it; an
untouched folder packs back into the same scenario, byte for byte. The scenario/ folder is replaced each time.`, { manifest: MANIFEST_FILE }))
    .addOption(forceOption(t("replace an unpack of another map, or files changed or added since the unpack")))
    .action(async (file: string, o: { json?: boolean; out?: string; list?: boolean; text?: boolean; force?: boolean }) => {
      if (o.out === STDIO) throw new CliError(t("map unpack writes a folder, so --out - cannot be standard output"), t("Name a folder, or use --list to see the members."), 2);
      if (o.list && o.text) throw new CliError(t("--list writes nothing, so --text has nothing to do"), t("Leave one of them off."), 2);
      const input = await readInput(file);
      expectKind(input, "map");
      if (o.list) {
        const r = await listMembers(input.bytes);
        if (o.json) { print(JSON.stringify({ file: input.path, ...r }, null, 2)); return; }
        const width = Math.max(...r.members.map((m) => m.name.length));
        print(`${pc.bold(input.name)}${dot}${t("{n, plural, one {# member} other {# members}}", { n: r.members.length })}${r.listfile ? "" : dot + pc.yellow(t("no file list"))}`, ...r.members.map((m) => `  ${(m.kind === "stored" ? pc.dim(m.name) : m.name).padEnd(width + (m.kind === "stored" ? 9 : 0))}  ${pc.dim(size(m.bytes).padStart(8))}`), ...r.problems.map((p) => `${mark.warn} ${p}`));
        return;
      }
      const base = input.path === STDIO ? "stdin" : input.path;
      const dir = o.out ?? base.replace(/\.(scm|scx|chk)$/i, "") + (/\.(scm|scx|chk)$/i.test(base) ? "" : "-unpacked");
      const r = await unpackMap(input.bytes, input.name, dir, { text: !!o.text, force: !!o.force });
      if (o.json) { print(JSON.stringify({ file: input.path, dir, files: r.files, bytes: r.bytes, stored: r.stored, manifest: r.manifest, text: r.text }, null, 2)); return; }
      const text = r.text;
      const sections = (names: string[]) => names.map((n) => n.trim()).join(" ");
      // The three labels line up, whatever the language: padded to the widest.
      const labels = [t("Scenario as text"), t("Bytes kept beside"), t("Kept as bytes")];
      const width = Math.max(...labels.map(columns));
      const label = (i: number) => pc.dim(padColumns(labels[i], width));
      print(`${mark.ok} ${pc.bold(input.name)}: ${t("{n, plural, one {# file} other {# files}}", { n: r.files })}${r.stored ? pc.dim(t(" ({n} without a name)", { n: r.stored })) : ""}${dot}${size(r.bytes)}${dot}${pc.dim("→")} ${pc.cyan(relative(process.cwd(), r.dir) || ".")}`,
        ...(text ? [
          `  ${label(0)}  ${t("{n, plural, one {# section} other {# sections}}", { n: text.text.length + text.layout.length + text.records.length })}${dot}${t("{size} in {n, plural, one {# file} other {# files}}", { size: size(text.size), n: text.files })}`,
          ...(text.layout.length || text.records.length ? [`  ${label(1)}  ${sections([...text.layout, ...text.records])} ${pc.dim(t("(used while their text is unchanged)"))}`] : []),
          ...(text.bytes.length ? [`  ${label(2)}  ${text.bytes.map((b) => `${b.name.trim()}${pc.dim(` (${b.why})`)}`).join(", ")}`] : []),
        ] : []),
        ...r.manifest.problems.map((p) => `${mark.warn} ${p}`));
    });
  map.command("pack").description(t("the folder scmjs map unpack wrote, back into a map file")).argument("<folder>").addOption(json)
    .addOption(mapOutOption(t("the file to write; by default the name {manifest} records, beside the folder; - for standard output", { manifest: MANIFEST_FILE })))
    .option("--compression <method>", t("none, pkware or zlib for every member, instead of how the map was stored"))
    .addOption(dryRunOption(t("build the map and check it opens, and write nothing")))
    .addHelpText("after", t(`
Every file in the folder goes in: the ones {manifest} names at their archive paths, and any added since at the
path they have in the folder. The archive is compressed and encrypted as the map was, and written without a file list
when the map had none. A folder map unpack --text wrote has its scenario built from the text in scenario/. The packed
file is opened as a map before it is written.`, { manifest: MANIFEST_FILE }))
    .action(async (dir: string, o: { json?: boolean; out?: string; compression?: string; dryRun?: boolean }) => {
      if (o.compression && !["none", "pkware", "zlib"].includes(o.compression.toLowerCase())) throw new CliError(t("--compression takes none, pkware or zlib, not \"{value}\"", { value: o.compression }), null, 2);
      const piped = o.out === STDIO && !o.dryRun;
      refuseJsonOnPipe(piped, o.json, "map");
      const r = await packMap(dir, { out: o.out ?? null, compression: o.compression?.toLowerCase() as "none" | "pkware" | "zlib" | undefined, dryRun: !!o.dryRun });
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      const where = r.path === STDIO ? t("standard output") : relative(process.cwd(), r.path) || r.path;
      say(piped, `${o.dryRun ? mark.info : mark.ok} ${pc.bold(where)}: ${t("the scenario and {n, plural, one {# member} other {# members}}", { n: r.members })}${r.fromText ? pc.dim(t(" (the scenario from text)")) : ""}${r.stored ? pc.dim(t(" ({n} without a name)", { n: r.stored })) : ""}${r.added.length ? `${dot}${t("{n, plural, one {# file} other {# files}} added: {list}", { n: r.added.length, list: r.added.join(", ") })}` : ""}${dot}${r.compression}${r.encrypted ? t(", encrypted") : ""}${dot}${size(r.bytes)}${o.dryRun ? pc.dim(` ${t("(--dry-run: nothing written)")}`) : ""}`,
        r.changedSounds ? `${mark.warn} ${t("{n, plural, one {# sound was} other {# sounds were}} changed since the unpack and {n, plural, one {goes} other {go}} in as plain PCM, larger than StarEdit's compression; map optimize cannot make {n, plural, one {it} other {them}} smaller again", { n: r.changedSounds })}` : null);
    });

  const sounds = map.command("sounds").description(t("a map's sounds, listed or written out as files"))
    .addHelpText("after", t(`
The sounds are the WAV table's entries (the Sound Editor's list) and any other file in the archive that is audio.
They come out as the files that went in: a WAV plays as it is (the archive's own sound compression is undone on the
way), an Ogg is written as it is. A name in the table that the map does not carry is listed, not an error: a path
under sound\\ is one of the game's own sounds.`));
  sounds.command("list", { isDefault: true }).description(t("each sound: its slot, length, format, size and what plays it")).argument("<map>").addOption(json)
    .action(async (file: string, o: { json?: boolean }) => {
      const input = await readInput(file);
      expectKind(input, "map");
      const { report } = await readSounds(input);
      print(...(o.json ? [JSON.stringify(report, null, 2)] : printSounds(report)));
    });
  sounds.command("export").description(t("the sounds as .wav and .ogg files in a folder")).argument("<map>").addOption(json)
    .addOption(outOption("folder", t("the folder to write; by default one named after the map with -sounds, beside it")))
    .action(async (file: string, o: { json?: boolean; out?: string }) => {
      if (o.out === STDIO) throw new CliError(t("map sounds export writes a folder, so --out - cannot be standard output"), t("Name a folder; map sounds lists them."), 2);
      const input = await readInput(file);
      expectKind(input, "map");
      const base = input.path === STDIO ? "stdin" : input.path.replace(/\.(scm|scx|chk)$/i, "");
      const r = await exportSounds(input, o.out ?? `${base}-sounds`);
      if (o.json) { print(JSON.stringify(r, null, 2)); return; }
      const near = r.dir ? relative(process.cwd(), r.dir) : "";
      const where = r.dir ? `${dot}${pc.dim("→")} ${pc.cyan(near.startsWith("..") ? r.dir : near || ".")}` : "";
      print(...printSounds(r, (s) => ("file" in s && s.file ? relative(r.dir ?? "", s.file) : s.name)).map((l, i) => (i === 0 ? `${r.written ? mark.ok : mark.info} ${l}${where}` : l)));
    });

  const script = map.command("script").description(t("a map's TrigScript script as files, and back; what a script can call"))
    .addHelpText("after", t(`
A map with a script keeps its files inside it (Triggers ▸ TrigScript… in the editor). export writes them out, import
puts files in and says at once whether the script compiles, and scmjs map build then makes the map's triggers from
it. api looks up a function, a type or one of the map's own names. docs.scmjs.dev/trigscript/ is the guide.`));
  script.command("export").description(t("the script's files as text (to stdout), or as files in a folder with --out")).argument("<map>", t("the map; - reads it from standard input")).argument("[files...]", t("only these files of the script (main.ts, quests/shop.ts)")).addOption(json)
    .addOption(outOption("folder", t("write the files into this folder, at their names, instead of to stdout")))
    .action(async (file: string, wanted: string[], o: { json?: boolean; out?: string }) => {
      if (o.out === STDIO) throw new CliError(t("--out names a folder here; without it the text goes to standard output"), null, 2);
      const { input, doc } = await openMap(file);
      const r = await readScript(doc);
      const names = scriptFilesWanted(input.name, file, r, wanted);
      const written = o.out ? await writeScriptFiles(o.out, r, names) : null;
      if (o.json) { print(JSON.stringify({ file: input.path, state: r.state, block: r.block, programs: r.programs, libraries: r.libraries, trigscript: r.trigscript, files: names.map((n, i) => ({ name: n, bytes: Buffer.byteLength(r.files[n]), lines: r.files[n].split("\n").length, ...(written ? { path: written[i] } : { text: r.files[n] }) })) }, null, 2)); return; }
      // The text is the output; what it is goes beside it, on standard error, so a pipe gets the script alone.
      if (!written) { note(scriptHeader(input.name, r)); process.stdout.write(scriptText(r, names)); return; }
      print(`${mark.ok} ${scriptHeader(input.name, r)}`, ...written.map((path, i) => `  ${names[i]} ${pc.dim("→")} ${pc.cyan(relative(process.cwd(), path) || path)}`));
    });
  script.command("import").description(t("put files into the map's script and compile it; the map's triggers stay until map build")).argument("<map>", t("the map to change; - reads it from standard input")).argument("[from...]", t("script files, or folders of them; - reads main.ts from standard input")).addOption(json)
    .addOption(mapOutOption())
    .option("--remove <name>", t("take this file out of the script; give it again for another"), (v: string, before?: string[]) => [...(before ?? []), v])
    .addHelpText("after", t(`
A file goes in under its own name (src/main.ts is main.ts); a folder gives every .ts and .tsx file in it at its path
inside the folder (quests/shop.ts). Files of the script that are not named stay as they are, so one corrected file is
enough. The script starts at main.ts. The files are written whether or not they compile, and the errors come as
file:line:column. Compiling needs TypeScript 6 on this computer: npm install typescript@6. Exits 1 when the
script does not compile.`))
    .action(async (file: string, from: string[], o: { json?: boolean; out?: string; remove?: string[] }) => {
      if (!from.length && !o.remove?.length) throw new CliError(t("map script import needs the files to put in: name them, or a folder of them."), null, 2);
      if (file === STDIO && from.includes(STDIO)) throw new CliError(t("The map and the script cannot both come from standard input"), t("Name one of them as a file."), 2);
      const changes: Record<string, string | null> = await scriptFilesFrom(from);
      for (const name of o.remove ?? []) {
        if (name in changes) throw new CliError(t("{name} is both given and removed.", { name }), null, 2);
        changes[name] = null;
      }
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const r = await importScript(doc, input.path, changes, o.out ?? null);
      const { check, ...rest } = r;
      if (o.json) print(JSON.stringify({ file: input.path, ...rest, diagnostics: check?.diagnostics ?? [], triggers: check?.triggerCount ?? null, programs: check?.programs ?? null }, null, 2));
      else say(piped, ...printScriptImport(input.name, r));
      if (r.compiles === false) process.exitCode = 1;
    });
  script.command("api").description(t("look up what a script can call: a function, a type, a unit, one of the map's own names")).argument("[words...]", t("words to look for, all of which must be there; none lists every name")).addOption(json)
    .option("--map <map>", t("use this map's names: its locations, switches, sounds and units as it names them"))
    .action(async (words: string[], o: { json?: boolean; map?: string }) => {
      const opened = o.map ? await openMap(o.map) : null;
      const r = await lookUpApi(opened?.doc ?? null, opened?.input.name ?? null, words.join(" "));
      if (o.json) { print(JSON.stringify({ map: opened?.input.path ?? null, search: words.join(" ") || null, entries: r.entries, shown: r.shown, more: r.more, text: r.lines.join("\n") }, null, 2)); return; }
      print(...r.lines);
    });

  map.command("build").description(t("apply the map's TrigScript script and build its programs, as Save does")).argument("<map>").addOption(json)
    .addOption(mapOutOption(t("write the built map here instead of over the map; - for standard output")))
    .option("--check", t("compile (and test, with --test) and write nothing"))
    .option("--test", t("run the script's tests first; a failing test refuses the build"))
    .addHelpText("after", t(`
The script is the one the map keeps (Triggers ▸ TrigScript… in the editor, or scmjs map script import). Its
trigger() calls go into the trigger list and its program()s are built into the file, with the map as you edit it
kept beside them, so it opens in the editor as it was. Needs TypeScript 6 on this computer: npm install
typescript@6. Exits 1 when the script does not compile, a test fails or the build is refused; nothing is written
then.`))
    .action(async (file: string, o: { json?: boolean; out?: string; check?: boolean; test?: boolean }) => {
      const { input, doc } = await openMap(file);
      const piped = !o.check && piping(input, o);
      const typescript = await loadTypeScript();
      const r = await buildMap(doc, input.path, typescript, { check: !!o.check, test: !!o.test, out: o.out ?? null });
      if (o.json) print(JSON.stringify({ file: input.path, ...r }, null, 2));
      else say(piped, ...printBuild(input.name, r));
      if (!r.ok) process.exitCode = 1;
    });

  map.command("run").description(t("run a plugin, or a script written like one, over a map with the plugin API")).argument("<plugin>", t("a folder with plugin.json, a plugin.ts/.js file, github:owner/repo or a URL")).argument("<map>", t("the map to run it over; - reads it from standard input")).addOption(json)
    .option("--command <id>", t("after it starts, run this command of its (the id it registered)"))
    .option("--arg <value...>", t("arguments for --command"))
    .addOption(mapOutOption(t("write the changed map here instead of over the map; - for standard output")))
    .addOption(dryRunOption(t("say what would change, as map diff does, and write nothing")))
    .addOption(starcraftOption())
    .option("--no-game", t("run with no game data, as on a computer without StarCraft"))
    .addHelpText("after", t(`
The plugin gets the editor's plugin API (docs.scmjs.dev/plugins) with the map open and no editor around it: what it
would show — its status line, toasts, log — is printed here, and dialogs show nothing. A script is a file exporting
activate(api), like a plugin's entry; a .ts needs TypeScript installed. The map is written back only when the
plugin changed it. Exits 1 when the plugin does not load or throws.

With a copy of StarCraft on this computer the plugin has the game's data, as in the editor: the map's tileset
(terrain by type, the isometric brush, doodads) and the unit tables (sizes, the placement check). Without one, or
with --no-game, those parts of the API do nothing and say so.`))
    .action(async (target: string, file: string, o: { json?: boolean; command?: string; arg?: string[]; out?: string; dryRun?: boolean; starcraft?: string; game?: boolean }) => {
      if (o.starcraft && o.game === false) throw new CliError(t("--starcraft names a copy of the game and --no-game runs without one: give one of them"), null, 2);
      if (o.arg && !o.command) throw new CliError(t("--arg is for --command"), t("Name the command the arguments are for: --command <id> --arg <value>."), 2);
      const { input, doc } = await openMap(file);
      const piped = piping(input, o);
      const r = await runOnMap(doc, input.path, input.bytes, target, { command: o.command, args: o.arg, out: o.out ?? null, dryRun: !!o.dryRun, game: o.game === false ? undefined : o.starcraft ?? true, live: o.json ? undefined : (line) => say(piped, line) });
      if (o.json) print(JSON.stringify({ file: input.path, ...r }, null, 2));
      else say(piped, ...printRun(input.name, r, { dryRun: !!o.dryRun }));
    });
}
