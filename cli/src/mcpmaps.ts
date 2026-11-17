/** The MCP tools that read and change a map: what `scmjs map` does, a tool per command. */
import { z } from "zod";
import { buildMap, loadTypeScript, printBuild } from "./build";
import { LAYOUTS, nameFromFile, NEW_VERSIONS, parseMapSize, parseTileset, writeNewMap, type NewMapVersion } from "./create";
import { diffMaps, printDiff, revisionInput } from "./diff";
import { dumpMap, printDump } from "./dump";
import { ANCHORS, ENCODINGS, parseAnchor, pruneStrings, VERSIONS, resizeAndWrite } from "./edit";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack, writeOutput } from "./exchange";
import { optimizeJson, optimizeMap, printOptimize } from "./optimize";
import { expectKind, loadMapInput, readInput, openMap } from "./files";
import { findInMap, KINDS, parseKinds, printHits } from "./find";
import { mapReport, printMapInfo, checkMap } from "./map";
import { readBaseline } from "./baseline";
import { printRun, runOnMap } from "./run";
import { EDIT_ARGUMENT, editMap, parseEdits, printEdits } from "./mapedit";
import { listLocations, listUnits, printLocations, printUnits, UNIT_ROWS, areaOf } from "./objects";
import { DOODAD_ROWS, GRID_COLUMNS, listDoodads, listTerrain, printDoodads, printTerrain } from "./terrain";
import { anySettings, listSettings, printSettings, SETTING_GROUPS, SETTINGS, type MapSettings, setMap } from "./settings";
import { GEN_PLAYERS, GEN_STYLES, GEN_SYMMETRIES } from "./generate";
import { printGenerated, runGenerate } from "./generatecmd";
import { CliError, nearPath } from "./ui";
import { refuseOverwrite } from "./options";
import { path, out, ok, written, noPipe, tool, starcraftArg, type Reg } from "./mcpkit";

export function addMapTools(reg: Reg): void {
  reg("map_info", {
    title: "What a map holds",
    description: "A map's name, size, tileset, revision, players, units, resources, triggers, locations, strings and its Check Map line, as `scmjs map info` prints it; the full statistics and findings as structured data.",
    inputSchema: { path },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file }) => {
    const { input, doc } = await openMap(file);
    const r = mapReport(input, doc);
    return ok(printMapInfo(r), r);
  }));

  reg("map_check", {
    title: "Check Map",
    description: "Check Map as the editor runs it: errors, then warnings, each with where it is; notes too with `all`. `failed` is true when there is an error. With `baseline`, a file `scmjs map check --write-baseline` wrote, only the findings it does not hold are listed and can fail the map; `baseline` in the data says how many were known and how many are fixed since.",
    inputSchema: { path, all: z.boolean().optional().describe("list notes as well as errors and warnings"), baseline: z.string().optional().describe("a baseline file (.scmjs-baseline.json): list only the findings it does not hold") },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, all, baseline }) => {
    noPipe(baseline);
    const { input, doc } = await openMap(file);
    const c = checkMap(input, doc, { all, baseline: baseline ? { file: baseline, known: readBaseline(baseline), writing: false } : null });
    return ok(c.lines, c.data);
  }));

  reg("map_dump", {
    title: "The whole map as text",
    description: "Everything the map holds as one text: header, players, forces, every unit and location, the triggers and briefing in the trigger window's text form, every string, the archive's other files and the sections (what `scmjs map dump` prints). The best first look at a map; large for a big map.",
    inputSchema: { path },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file }) => {
    const { input, doc } = await openMap(file);
    return ok(printDump(dumpMap(doc, input.name), doc.scenario));
  }));

  reg("map_find", {
    title: "Find in maps",
    description: `Edit ▸ Find over one or more maps: units, locations, sprites and doodads whose name holds the text, strings and triggers whose text does; a number matches an id, slot or index too. \`kinds\` narrows it to any of ${KINDS.join(", ")}.`,
    inputSchema: { text: z.string().describe("what to look for"), paths: z.array(path).min(1), kinds: z.array(z.string()).optional(), in: z.array(z.string()).optional().describe("the command's --in: the same as kinds"), matchCase: z.boolean().optional(), case: z.boolean().optional().describe("the command's --case: the same as matchCase") },
    annotations: { readOnlyHint: true },
  }, tool(async ({ text, paths, kinds, in: within, matchCase, case: caseToo }) => {
    const which = parseKinds((kinds ?? within)?.join(","));
    matchCase ??= caseToo;
    const lines: string[] = [], data: unknown[] = [];
    for (const file of paths) {
      const { input, doc } = await openMap(file);
      const hits = findInMap(doc, input.name, text, which, !!matchCase);
      data.push({ file: input.name, matches: hits.length, hits: hits.map(({ file: _f, ...h }) => h) });
      if (hits.length) lines.push(`${input.name}  ${hits.length} ${hits.length === 1 ? "match" : "matches"}`, ...printHits(hits), "");
    }
    return ok(lines.length ? lines : [`Nothing in ${paths.length === 1 ? "the map" : `${paths.length} maps`} matches "${text}"`], { matches: data });
  }));

  reg("map_diff", {
    title: "What changed between two maps",
    description: "What changed between two maps, in the map maker's terms (header, players, units, locations, triggers, strings, archive members, sections), as `scmjs map diff` prints it. Give `b`, or `rev` to compare the map with its version at a git revision (HEAD, HEAD~1, a branch, a tag).",
    inputSchema: { a: path, b: path.optional(), rev: z.string().optional().describe("a git revision to compare `a` against, instead of `b`"), all: z.boolean().optional().describe("list every item; a long list is cut at 20 otherwise") },
    annotations: { readOnlyHint: true },
  }, tool(async ({ a, b, rev, all }) => {
    if (rev ? b !== undefined : b === undefined) throw new CliError(rev ? "rev compares one map with its earlier version: give a alone" : "Two maps to compare, or one with rev", null, 2);
    const fromRev = async () => { const input = revisionInput(rev!, a); expectKind(input, "map"); return { input, doc: await loadMapInput(input) }; };
    const [x, y] = await Promise.all([rev ? fromRev() : openMap(a), openMap(rev ? a : b!)]);
    const d = diffMaps({ name: x.input.name, doc: x.doc }, { name: y.input.name, doc: y.doc });
    return ok(printDiff(d, !!all), d);
  }));

  reg("map_triggers_export", {
    title: "Triggers as text",
    description: "The map's triggers (or its mission briefing) in the trigger window's text form, the one map_triggers_import takes back: one block per trigger with its players, conditions and actions. Edit the text and import it to change the map's triggers.",
    inputSchema: { path, briefing: z.boolean().optional().describe("the mission briefing's triggers instead") },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, briefing }) => {
    const { doc } = await openMap(file);
    const r = exportTriggers(doc, null, !!briefing);
    return ok(r.text!, { count: r.count });
  }));

  reg("map_triggers_import", {
    title: "Triggers from text",
    description: "Replace the map's triggers (or briefing) with the given text, in the form map_triggers_export gives, or add them after the map's own with `append`. Text the map cannot resolve (a location or unit name it does not have) fails with its line, and nothing is written.",
    inputSchema: { path, text: z.string().describe("the triggers, in the trigger window's text form"), append: z.boolean().optional(), briefing: z.boolean().optional(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, text, append, briefing, out: to }) => {
    const { input, doc } = await openMap(file);
    const r = importTriggers(doc, "triggers.txt", new TextEncoder().encode(text), { briefing: !!briefing, append: !!append });
    const w = await writeBack(doc, input.path, to ?? null);
    return ok([`${input.name}: ${r.before} → ${r.after} triggers${append ? ` (${r.read} added)` : ""}`, written(w)], { ...r, written: w });
  }));

  reg("map_strings_export", {
    title: "Strings as text",
    description: "Every string in the map as `<number><TAB><text>` lines, colour codes written <XX>. Triggers, locations and names refer to strings by number, so the numbers matter.",
    inputSchema: { path },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file }) => {
    const { doc } = await openMap(file);
    const r = exportStrings(doc);
    return ok(r.text, { count: r.count });
  }));

  reg("map_strings_import", {
    title: "Strings from text",
    description: "Set the map's strings from `<number><TAB><text>` lines: the numbered strings are set in place, lines past the end are added, nothing is renumbered. Give only the lines to change, if you like.",
    inputSchema: { path, text: z.string(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, text, out: to }) => {
    const { input, doc } = await openMap(file);
    const r = importStrings(doc, "strings.txt", text);
    const w = await writeBack(doc, input.path, to ?? null);
    return ok([`${input.name}: ${r.replaced} strings replaced, ${r.added} added, ${r.unchanged} unchanged`, written(w)], { ...r, written: w });
  }));

  reg("map_strings_prune", {
    title: "Drop unused strings",
    description: "Blank the strings nothing in the map refers to (the editor's Delete Unused), without renumbering; `dryRun` lists them and writes nothing.",
    inputSchema: { path, dryRun: z.boolean().optional(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, dryRun, out: to }) => {
    const { input, doc } = await openMap(file);
    const removed = pruneStrings(doc, { dryRun: !!dryRun });
    const w = removed.length && !dryRun ? await writeBack(doc, input.path, to ?? null) : null;
    const lines = removed.length ? [`${input.name}: ${removed.length} unused string${removed.length === 1 ? "" : "s"}${dryRun ? " would be dropped" : " dropped"}`, ...removed.map((r) => `  ${r.index}  ${r.text.replace(/\s+/g, " ")}`)] : [`${input.name}: every string is referred to`];
    return ok(w ? [...lines, written(w)] : lines, { removed, dryRun: !!dryRun, written: w });
  }));

  reg("map_optimize", {
    title: "Make a map smaller",
    description: "The map made smaller without changing what the game plays (scmjs map optimize): sounds nothing plays or lists, the sound list's entries for files the map lacks, other archive members nothing names, strings nothing refers to, then every member compressed again (PKWARE, which every version of the game opens, unless `compression` says zlib, which only Remastered opens). With `stripEditor` also the sections only editors read (ISOM, TILE, DD2, the sound list, switch names): the map plays the same but is harder to edit. TrigScript, Magenta and build files, the game's own members and sounds stored with ADPCM are kept; a built map keeps its scenario, an EUD map its strings. A dry run unless `write` is true: the steps, the bytes each saves and every removal.",
    inputSchema: { path, write: z.boolean().optional().describe("write the result (over the map, or to out); a dry run otherwise"), dryRun: z.boolean().optional().describe("the command's --dry-run: true is the dry run (the default here), false writes"), stripEditor: z.boolean().optional(), compression: z.enum(["pkware", "zlib"]).optional(), keep: z.array(z.string()).optional().describe("archive members to keep though nothing names them; a name ending in \\ keeps a folder"), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, write: writeIt, dryRun, stripEditor, compression, keep, out: to }) => {
    if (writeIt !== undefined && dryRun !== undefined && writeIt === dryRun) throw new CliError("write and dryRun say opposite things: give one of them", null, 2);
    const write = writeIt ?? (dryRun === undefined ? false : !dryRun);
    const input = await readInput(file);
    expectKind(input, "map");
    const r = await optimizeMap(input.bytes, input.name, { stripEditor, compression, keep });
    const w = write && r.after < r.before ? await writeOutput(r.bytes, to ?? input.path) : null;
    return ok([...printOptimize(r, { dryRun: !write, written: w ? nearPath(w.path) : null, all: true }), ...(w ? [written(w)] : [])], optimizeJson(r, { dryRun: !write, written: w }));
  }));

  reg("map_set", {
    title: "Map properties and settings",
    description: [
      `Set a map's properties and the Scenario menu's settings (scmjs map set); what is given is set, the rest left. Scenario ▸ Map Properties: name, description, revision (${VERSIONS.join(", ")}) or text encoding (${ENCODINGS.join(", ")}); <03> and the like in a name are the game's colour codes. And any of these lists, each entry naming what it changes and giving only the fields to change:`,
      "- players: Player Settings and Player Colors. player (1 to 12), then type, race, color (a name, a number, or [r, g, b] for a Remastered custom colour) and force (1 to 4); colour and force are for players 1 to 8.",
      "- forces: Force Settings. force (1 to 4), then name, players (moved into the force), allied, alliedVictory, sharedVision, randomStart.",
      "- units: Unit Settings. unit (a name or units.dat id), then name (a name of the map's own), hitPoints, shields, armor, buildTime (frames, 24 a second), mineralCost, gasCost, weapons [{ weapon, damage, bonus }], and available: who may build it, [{ player: 1 to 12 or \"default\", value: true, false or \"default\" }].",
      "- upgrades: Upgrade Settings. upgrade, then mineralCost, gasCost, timeCost and the factor each grows by a level (mineralFactor, gasFactor, timeFactor), and levels: [{ player: 1 to 12 or \"default\", start, max }], the level a player starts at and may reach.",
      "- techs: Technology Settings. tech, then mineralCost, gasCost, researchTime, energyCost, and state: [{ player: 1 to 12 or \"default\", available, researched }].",
      "- switches: [{ switch: 1 to 256, name }].",
      "A number for a unit, upgrade or technology takes it off the game's own numbers (useDefault: true puts it back); the rest of its row is then filled in from the game's tables, so those settings need a copy of StarCraft on this computer, and names, availability, levels, players, forces and switches need none. Every name is checked before anything is set: one the map or the game does not have fails with its place (units[1]) and nothing is written. The answer lists each setting that changed with its value before and after; map_settings reads them. `dryRun` writes nothing.",
    ].join("\n"),
    inputSchema: { path, name: z.string().optional(), description: z.string().optional(), revision: z.string().optional(), encoding: z.string().optional(), ...SETTINGS, out, dryRun: z.boolean().optional().describe("say what would change and write nothing"), starcraft: starcraftArg },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, name, description, revision, encoding, out: to, dryRun, starcraft, ...given }) => {
    const settings = given as MapSettings;
    if (name === undefined && description === undefined && revision === undefined && encoding === undefined && !anySettings(settings)) throw new CliError("Nothing to set", `name, description, revision, encoding, or any of ${SETTING_GROUPS.join(", ")}.`, 2);
    const opened = await openMap(file);
    const { input } = opened;
    const { changes, set, changed, written: w } = await setMap(opened, { name, description, revision, encoding, settings: anySettings(settings) ? settings : null, starcraft, out: to ?? null, dryRun });
    const lines = changed
      ? [...changes.map((c) => `${c.field}: ${c.from || "(none)"} → ${c.to || "(none)"}`), ...(set?.changes ?? []).map((c) => `${c.subject} ${c.field}: ${c.from || "(none)"} → ${c.to || "(none)"}`)]
      : [`${input.name}: nothing changed`];
    return ok(w ? [...lines, written(w)] : dryRun && changed ? [...lines, "Not written (dryRun)."] : lines, { changes, ...(set ? { settings: set.changes, game: set.game } : {}), dryRun: !!dryRun, written: w });
  }));

  reg("map_settings", {
    title: "The map's players, forces and settings",
    description: "The Scenario menu's settings as the map has them (scmjs map settings): the twelve players (type, race, colour, force), the four forces (name, players, allied, allied victory, shared vision, random start), then the unit types, upgrades and technologies the map changes from the game's, each with what it sets, and the switches it names. A row on \"the game's numbers\" keeps the game's hit points, costs and times. With `unit`, `upgrade` or `tech`, that one row alone, changed or not, with the game's own numbers beside the map's when a copy of StarCraft is on this computer. The rows as data, with every player's availability, levels and state. map_set changes them.",
    inputSchema: { path, unit: z.union([z.string(), z.number().int().min(0)]).optional().describe("this unit type alone: a name or a units.dat id"), upgrade: z.union([z.string(), z.number().int().min(0)]).optional(), tech: z.union([z.string(), z.number().int().min(0)]).optional(), starcraft: starcraftArg },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, unit, upgrade, tech, starcraft }) => {
    const { input, doc } = await openMap(file);
    const r = await listSettings(doc, input.name, { unit, upgrade, tech, starcraft });
    return ok(printSettings(input.name, r), r);
  }));

  reg("map_resize", {
    title: "Resize the map",
    description: `Scenario ▸ Resize: the map to another size (width and height each 64, 96, 128, 192 or 256), the old map kept under the anchor (${Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ")}); what falls outside is dropped, locations pulled inside unless \`clamp\` is false.`,
    inputSchema: { path, size: z.string().describe("WxH, such as 128x96"), anchor: z.string().optional(), clamp: z.boolean().optional(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, size: spec, anchor, clamp, out: to }) => {
    const { width, height } = parseMapSize(spec);
    const opened = await openMap(file);
    const { input } = opened;
    const { result: r, written: w } = await resizeAndWrite(opened, { width, height, anchor: parseAnchor(anchor ?? "center"), clamp: clamp ?? true, out: to ?? null });
    const dropped = [r.unitsDropped && `${r.unitsDropped} units`, r.spritesDropped && `${r.spritesDropped} sprites`, r.doodadsDropped && `${r.doodadsDropped} doodads`].filter(Boolean).join(", ");
    return ok([`${input.name}: ${r.from.width} × ${r.from.height} → ${r.to.width} × ${r.to.height}${dropped ? `, ${dropped} dropped` : ""}${r.locationsClamped ? `, ${r.locationsClamped} locations pulled inside` : ""}`, written(w!)], { ...r, written: w });
  }));

  reg("map_new", {
    title: "A new map",
    description: `A new map as File ▸ New makes it: flat ground, start locations for players 1 to \`players\` laid out in a ${LAYOUTS.join(" or ")}, the other slots closed, written to \`path\` (.scx, .scm or .chk). Tilesets: badlands, platform, install, ashworld, jungle, desert, ice, twilight. Revision ${NEW_VERSIONS.join(" or ")}. Refuses a file that is there unless \`force\`.`,
    inputSchema: { path, size: z.string().optional().describe("WxH, 128x128 by default"), tileset: z.string().optional(), name: z.string().optional(), description: z.string().optional(), players: z.number().int().min(0).max(8).optional(), layout: z.string().optional(), revision: z.string().optional(), force: z.boolean().optional() },
  }, tool(async ({ path: file, size: spec, tileset, name, description, players, layout, revision, force }) => {
    const { width, height } = parseMapSize(spec ?? "128x128");
    const rev = revision ?? "broodwar", lay = layout ?? "ring";
    if (!(NEW_VERSIONS as readonly string[]).includes(rev)) throw new CliError(`revision takes ${NEW_VERSIONS.join(" or ")}, not "${rev}"`, null, 2);
    if (!(LAYOUTS as readonly string[]).includes(lay)) throw new CliError(`layout takes ${LAYOUTS.join(" or ")}, not "${lay}"`, null, 2);
    refuseOverwrite(file, force, "force overwrites it.");
    const r = await writeNewMap(file, { width, height, tileset: parseTileset(tileset ?? "badlands"), name: name ?? nameFromFile(file), description: description ?? "", version: rev as NewMapVersion, players: players ?? 0, layout: lay as (typeof LAYOUTS)[number] });
    return ok([`${nearPath(r.path)}: ${r.width} × ${r.height}, ${r.tileset}, ${r.version}${r.starts ? `, ${r.starts} start locations` : ""} (${r.bytes} bytes)`], r);
  }));

  reg("map_build", {
    title: "Build a TrigScript map",
    description: "Apply the map's TrigScript script and build its programs into the file, as Save does in the editor; `check` compiles (and tests, with `test`) and writes nothing. Needs TypeScript installed on this computer. Compile errors and failing tests come back as text, and nothing is written then.",
    inputSchema: { path, out, check: z.boolean().optional(), test: z.boolean().optional() },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: to, check, test }) => {
    const { input, doc } = await openMap(file);
    const r = await buildMap(doc, input.path, await loadTypeScript(), { check: !!check, test: !!test, out: to ?? null });
    return { ...ok(printBuild(input.name, r), { file: input.name, ...r }), ...(r.ok ? {} : { isError: true }) };
  }));

  reg("map_run", {
    title: "Run a plugin over the map",
    description: "Run an editor plugin, or a script written like one (a file exporting activate(api)), over the map with the plugin API and no editor: a folder with plugin.json, a plugin.ts/.js file, github:owner/repo or a URL. `command` runs one of its commands after it starts. `dryRun` says what would change and writes nothing. With a copy of StarCraft on this computer the plugin has the game's data as in the editor (the map's tileset, so terrain by type, the isometric brush and doodads work, and the unit tables); the data's `game` says which copy, or null when it ran with none, and then those parts of the API do nothing and say so. The plugin runs with this computer's privileges. For terrain, doodads, units and locations map_edit needs no script.",
    inputSchema: { plugin: z.string(), path, command: z.string().optional(), args: z.array(z.string()).optional(), arg: z.array(z.string()).optional().describe("the command's --arg: the same as args"), out, dryRun: z.boolean().optional(), starcraft: starcraftArg, game: z.boolean().optional().describe("false runs with no game data (the command's --no-game)") },
    annotations: { destructiveHint: true, openWorldHint: true },
  }, tool(async ({ plugin, path: file, command, args, arg, out: to, dryRun, starcraft, game }) => {
    if ((args ?? arg) && !command) throw new CliError("args are for `command`: name the command they go to", null, 2);
    if (starcraft && game === false) throw new CliError("`starcraft` names a copy of the game and `game: false` runs without one: give one of them", null, 2);
    const { input, doc } = await openMap(file);
    const r = await runOnMap(doc, input.path, input.bytes, plugin, { command, args: args ?? arg, out: to ?? null, dryRun: !!dryRun, game: game === false ? undefined : starcraft ?? true });
    return ok(printRun(input.name, r, { events: true, dryRun: !!dryRun }), { file: input.name, ...r });
  }));

  const unitArg = z.union([z.string(), z.number().int().min(0)]);
  const locationArg = z.union([z.string(), z.number().int().min(1)]);
  const rectArg = z.strictObject({ left: z.number().int().min(0), top: z.number().int().min(0), right: z.number().int().min(0), bottom: z.number().int().min(0) });
  const tilesArg = z.strictObject({ x0: z.number().int().min(0), y0: z.number().int().min(0), x1: z.number().int().min(0), y1: z.number().int().min(0) });

  const areaArgs = {
    location: locationArg.optional().describe("only this location's area: its name, or its number as map_locations lists it"),
    rect: rectArg.optional().describe("only this rectangle, in pixels; right and bottom are just outside it"),
    tiles: tilesArg.optional().describe("only this rectangle, in tiles; x1 and y1 are just outside it"),
  };

  reg("map_terrain", {
    title: "The map's terrain",
    description: `The map's terrain (scmjs map terrain): the terrains of its tileset, a row each with the letter the grid draws it with, its name and id (map_edit's paint_terrain takes either), its height (0 low, 1 mid, 2 high: a cliff forms between two heights), whether buildings go on it and how many tiles it covers; then the map, or the area asked for, as a grid of characters, the terrain most of each cell is, lower case for low ground, with # for the edge between two terrains (a cliff or a shore). The grid is kept to ${GRID_COLUMNS} columns unless \`cell\` says how many tiles a character is (1 is a character a tile). Call it before painting, to learn the terrains' names and see the lie of the land. Needs a copy of StarCraft on this computer for the tileset; doctor says whether one is there.`,
    inputSchema: { path, ...areaArgs, cell: z.number().int().min(1).max(32).optional().describe("tiles a character of the grid"), grid: z.boolean().optional().describe("false for the table alone"), starcraft: starcraftArg },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, cell, grid, starcraft, ...area }) => {
    const { input, doc } = await openMap(file);
    const r = await listTerrain(doc, input.name, { area: areaOf(area), cell, starcraft });
    return ok(printTerrain(input.name, r, { grid: grid !== false }), r);
  }));

  reg("map_doodads", {
    title: "The map's doodads, and the doodads to place",
    description: `The doodads on the map, a row each (scmjs map doodads): its index (its place in the file, from 0, which map_edit's remove_doodads takes), its name and id, its top-left tile and its size in tiles; then the tileset's categories. With \`category\` (a category's name, or "ramp" for the ramps) or \`palette\`, also the doodads that can be placed, each with its size and the ground StarEdit lets it go on. A doodad has no name of its own: it is its category and its id ("Jungle #180"). An area keeps the placed doodads whose centre is inside it. The text is cut at ${DOODAD_ROWS} rows unless \`all\`; the data has every row. Needs a copy of StarCraft on this computer for the tileset.`,
    inputSchema: { path, category: z.string().optional().describe("only this category's doodads, placed and to place; \"ramp\" for the ramps"), palette: z.boolean().optional().describe("list every doodad the tileset has to place"), ...areaArgs, all: z.boolean().optional().describe("every row in the text"), starcraft: starcraftArg },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, category, palette, all, starcraft, ...area }) => {
    const { input, doc } = await openMap(file);
    const r = await listDoodads(doc, input.name, { area: areaOf(area), category, palette: !!palette, starcraft });
    return ok(printDoodads(input.name, r, !!all), r);
  }));

  reg("map_generate", {
    title: "A melee map from a seed",
    description: `A new symmetric melee map (scmjs map generate), written to \`path\`: a main on high ground for each player with one ramp down to a natural, free bases where there is room, and a middle of low ground with mesas, lakes and patches of the tileset's other ground, every player's bases the same, mirrored or turned with the map. The ground is laid with the editor's isometric brush and the ramps are the tileset's own. Before the file is written the map passes Check Map and every start is walked to every other; a layout that fails is thrown away and the next tried. Players: ${GEN_PLAYERS.join(", ")}. Tilesets: badlands, platform, ashworld, jungle (the default), desert, ice, twilight. Symmetry: ${GEN_SYMMETRIES.join(", ")}. Style: ${GEN_STYLES.join(" or ")} (an open middle, or one narrowed by more high ground). The same seed and options give the same map; without a seed, a new one each time. The answer has each player's resources and the ground distances between the starts. Refuses a file that is there unless \`force\`. Needs a copy of StarCraft on this computer for the tileset. The start for "make me a map"; map_edit changes it from there.`,
    inputSchema: {
      path, players: z.number().int().min(2).max(8).optional(), size: z.string().optional().describe("WxH, each 96, 128, 192 or 256; 128x128 by default (192x192 for 8 players)"), tileset: z.string().optional(),
      seed: z.number().int().min(0).max(0xffffffff).optional(), symmetry: z.string().optional(), style: z.string().optional(), name: z.string().optional().describe("the map's name; the file's by default"), force: z.boolean().optional(), starcraft: starcraftArg,
    },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, players, size: spec, tileset, seed, symmetry, style, name, force, starcraft }) => {
    refuseOverwrite(file, force, "force overwrites it.");
    const { report } = await runGenerate(file, { players: players === undefined ? undefined : String(players), size: spec, tileset, seed: seed === undefined ? undefined : String(seed), symmetry, style, starcraft }, name ?? nameFromFile(file));
    return ok(printGenerated(report, nearPath(report.path)), report);
  }));

  reg("map_units", {
    title: "The map's units",
    description: `The units placed on the map, a row each (scmjs map units): its index (its place in the file, from 0, which map_edit takes), type, player (1 to 12; 12 is neutral), position in pixels and in tiles, and the properties its record sets (resources, hit points, shields and energy in percent, hangar, and the states cloaked, burrowed, lifted, hallucinated, invincible). The filters narrow the list and all of them must hold; a unit is inside an area when its centre is. The text is cut at ${UNIT_ROWS} rows unless \`all\`; the data has every row that matched.`,
    inputSchema: {
      path,
      unit: unitArg.optional().describe("only this type: a name (\"Terran Marine\", \"Zergling\") or a units.dat id"),
      player: z.number().int().min(1).max(12).optional().describe("only this player's units; 12 is neutral"),
      location: locationArg.optional().describe("only units inside this location: its name, or its number as map_locations lists it"),
      rect: rectArg.optional().describe("only units inside this rectangle, in pixels; right and bottom are just outside it"),
      tiles: tilesArg.optional().describe("only units inside this rectangle, in tiles; x1 and y1 are just outside it"),
      all: z.boolean().optional().describe("every row in the text"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, unit, player, location, rect, tiles, all }) => {
    const { input, doc } = await openMap(file);
    const r = listUnits(doc, input.name, { unit, player, location, rect, tiles });
    return ok(printUnits(input.name, r, !!all), r);
  }));

  reg("map_locations", {
    title: "The map's locations",
    description: "The map's locations, a row each (scmjs map locations): its number as triggers, map_dump and map_diff count it (from 1, which map_edit takes, as it takes the name), its name, its box in pixels (right and bottom are just outside it), the tiles the box touches, and how many units have their centre inside. Anywhere is listed and cannot be changed. `index` in the data is the slot in the file, the number less one.",
    inputSchema: { path },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file }) => {
    const { input, doc } = await openMap(file);
    const r = listLocations(doc, input.name);
    return ok(printLocations(input.name, r), r);
  }));

  reg("map_edit", {
    title: "Change terrain, doodads, units, locations, sprites and fog",
    description: [
      "Apply a list of edits to a map's terrain, doodads, units, locations, sprites and fog as one step (scmjs map edit). All of them are applied or none: when one cannot be done nothing is written, and the error names it by its place in the list (edits[2] is the third) with what is wrong. Each edit is an object with `op` and its fields:",
      "- paint_terrain: terrain (a name or id, as map_terrain lists them) and an area (the whole map without one), painted with the editor's isometric brush, so the edge forms on its own: a cliff where the height changes, a shore beside water. A plateau is high ground painted on low ground; a lake is water. shape is \"rect\" or \"ellipse\" (the ellipse inside the area). cover (0 to 1) paints that share of the area in patches about grain tiles across (8 by default), placed by seed: random-looking ground, the same for the same seed. symmetry repeats the stroke at its images: h (left and right), v (top and bottom), hv, rot180, and on a square map rot90, diag, adiag.",
      "- place_doodad: doodad and tileX, tileY, its top-left tile. doodad is an id, a name (\"Jungle #180\"), a category's name for any one of its doodads, or \"ramp\" for whichever of the tileset's ramps fits. Refused where StarEdit would refuse it (a doodad goes on the ground it is drawn for, a ramp only on the cliff shape it was drawn for) unless within says how many tiles around to look for a place one fits (for a ramp: paint the cliff, then place \"ramp\" within 6 or so of its edge) or force places it regardless.",
      "- scatter_doodads: doodad (a category scatters a mix), an area, and count or density (the share of the area's tiles to cover, 0.1 by default), each put where it fits, placed by seed. Fewer are placed when no more fit.",
      "- remove_doodads: indices (as map_doodads lists them) or where {doodad, an area}; the ground under them comes back.",
      "- place_unit: unit, player, a position, and any unit properties. snap puts a building on the building grid (give it for every building, resource and start location); check refuses a position the editor would refuse (unwalkable or unbuildable ground, a unit in the way).",
      "- move_units: units, then a position (for one unit) or dx, dy in pixels (for any number).",
      "- update_units: units, then player (the new owner) and any unit properties; only what is given changes.",
      "- remove_units: units.",
      "- add_location: name, and rect or tiles.",
      "- edit_location: location, then name (the new one), rect or tiles.",
      "- remove_locations: locations, a list.",
      "- place_sprite: sprite (a sprites.dat id: a picture only) or unit (a unit drawn as a sprite, which the game makes a unit of: a door, a trap), then player (1 when left out), a position, flipped, disabled (a unit sprite that starts disabled).",
      "- remove_sprites: indices (the sprites in the order map_dump lists them, from 0) or where {sprite, unit, player, an area}.",
      "- set_fog: players (a list of 1 to 8), mode (\"fog\" hides the area at the start, \"clear\" shows it), and an area (the whole map without one).",
      "A unit type is a name (\"Terran Marine\", \"Zergling\") or a units.dat id. A player is 1 to 12; 12 is neutral. A position is x, y in pixels or tileX, tileY (the centre of that tile). An area is one of rect {left, top, right, bottom} in pixels, tiles {x0, y0, x1, y1} or location; right, bottom, x1 and y1 are just outside it, and a unit is inside when its centre is. A location is its name, or its number as map_locations lists it. Units are named by `indices` (as map_units lists them, counted before this call, so a removal earlier in the list does not shift them) or by `where` {unit, player, an area}: all must hold, and matching nothing is not an error. Unit properties: hitPoints, shields, energy (percent), resources (a mineral field's or geyser's amount), hangar (interceptors or scarabs aboard), and the states cloaked, burrowed, lifted (a Terran building in the air), hallucinated, invincible (true or false).",
      "The answer lists what each edit did, with the index a placed unit, sprite or doodad got and the number a new location got, then the change as map_diff reports it. Terrain and doodad edits, snap and check read the tileset and the unit tables from the person's copy of StarCraft, and fail with what to do when there is none (doctor says whether one is there); a list without them needs no copy, and a position is then taken as given. Painting terrain does not move what stands on it: look with map_preview (or editor_picture) and run map_check afterwards. `dryRun` says what would change and writes nothing.",
    ].join("\n"),
    inputSchema: { path, edits: z.array(EDIT_ARGUMENT).min(1).describe("the edits, applied in order"), out, dryRun: z.boolean().optional().describe("say what would change and write nothing"), all: z.boolean().optional().describe("list every edit and every change in the text; long lists are cut otherwise"), starcraft: starcraftArg },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, edits, out: to, dryRun, all, starcraft }) => {
    // Each edit held to the fields of its kind, before anything is opened.
    const list = parseEdits(edits);
    const { input, doc } = await openMap(file);
    const r = await editMap(input, doc, list, { out: to ?? null, dryRun: !!dryRun, starcraft });
    return ok(printEdits(input.name, r, { dryRun: !!dryRun, all: !!all }), { file: input.name, ...r, dryRun: !!dryRun });
  }));
}
