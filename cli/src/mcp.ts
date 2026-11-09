/**
 * `scmjs mcp`: the map commands as a Model Context Protocol server on standard input and output, so an AI tool
 * (Claude Code, Cursor, VS Code, anything that speaks MCP) can read, check, search, compare and change maps the
 * way the terminal does — the same functions the commands call, with the result as text for the model and the
 * command's `--json` shape beside it. The client starts this as a child process and talks JSON-RPC over the pipe, and
 * every write goes to a file the client named. The map tools never touch the network; `map_trace`, `map_cost` and `map_coverage` fetch
 * the game engine from the play page the first time, as their commands do, and `doctor` asks npm for a newer scmjs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { CallToolResult, ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import { z } from "zod";
import { VERSION } from "./about";
import { buildMap, loadTypeScript, printBuild } from "./build";
import { LAYOUTS, nameFromFile, NEW_VERSIONS, parseSize, parseTileset, writeNewMap, type NewMapVersion } from "./create";
import { diffMaps, printDiff, revisionInput } from "./diff";
import { doctorJson, doctorReport, printDoctor } from "./doctor";
import { dumpMap, printDump } from "./dump";
import { ANCHORS, ENCODINGS, parseAnchor, pruneStrings, resizeMap, setHeader, VERSIONS } from "./edit";
import { exportStrings, exportTriggers, importStrings, importTriggers, writeBack, writeOutput } from "./exchange";
import { optimizeJson, optimizeMap, printOptimize } from "./optimize";
import { balanceJson, printBalance, runBalance } from "./balance";
import { parseRaces } from "./ladder";
import { expectKind, loadMapInput, loadReplayInput, readInput, type Input } from "./files";
import { findInMap, KINDS, parseKinds, printHits } from "./find";
import { baselineLine, issueLine, mapReport, printIssues, printMapInfo } from "./map";
import { mapKey, matchBaseline, readBaseline } from "./baseline";
import { coverageJson, coverageScenario, printCoverage, runCoverage } from "./coverage";
import { printReplayInfo, replayReport } from "./replay";
import { buildOrders, replayNamer } from "./replaymod";
import { mapFileFor, writeReplayMap } from "./replaymap";
import { openGameFiles } from "./gamefiles";
import { analyzeLayout, layoutLines, layoutPicture, layoutReport, loadLayoutFiles } from "./analyze";
import { encodePng } from "./png";
import { DEFAULT_PNG_SCALE, loadGraphics, previewPng, tilesetOf } from "./preview";
import { printRun, runOnMap } from "./run";
import { costJson, gameMap, printCost, printTrace, removeGameMap, runMapInGame, traceJson, type MapRunOptions } from "./trace";
import { checkModSource, printModCheck } from "./mod/check";
import { diffModSources, printModDiff } from "./mod/diff";
import { modInfo, printModInfo } from "./mod/info";
import { newMod } from "./mod/new";
import { gameFilesOrNull, openMod } from "./mod/open";
import { sourceHash } from "./mod/hash";
import { MOD_COMPRESSIONS, packMod, readModFolder, type ModCompression } from "./mod/pack";
import { unpackMod } from "./mod/unpack";
import { writeModHeader } from "./mod/header";
import { modOverlay } from "./mod/overlay";
import { pageRace, playBotOf, playOnPage, playSet } from "./mod/play";
import { CliError, pc, visible } from "./ui";

/** Where a tool's words go while the server runs: standard error, since standard output is the protocol. */
export const STDERR = (line: string) => process.stderr.write(`${line}\n`);

const path = z.string().describe("the map file: .scm, .scx or .chk, a path on this computer");
const out = z.string().optional().describe("write the result to this file instead of over the map");

/** The result as the model reads it: text lines (without colour), and the command's JSON shape beside them. */
function ok(lines: string[] | string, data?: unknown): CallToolResult {
  const text = typeof lines === "string" ? lines : lines.map(visible).join("\n");
  return { content: [{ type: "text", text }], ...(data === undefined ? {} : { structuredContent: toJson(data) as Record<string, unknown> }) };
}
/** Failures are results the model can read, not protocol errors: the command's message and its hint. */
function failed(e: unknown): CallToolResult {
  const text = e instanceof CliError ? `${e.message}${e.hint ? `\n${e.hint}` : ""}` : e instanceof Error ? e.message : String(e);
  return { isError: true, content: [{ type: "text", text }] };
}
/** JSON as `--json` prints it: typed arrays and maps become plain values. */
const toJson = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (x instanceof Uint8Array ? [...x] : x instanceof Map ? Object.fromEntries(x) : x)));

async function openMap(file: string): Promise<{ input: Input; doc: Awaited<ReturnType<typeof loadMapInput>> }> {
  const input = await readInput(file);
  expectKind(input, "map");
  return { input, doc: await loadMapInput(input) };
}
/** A path for the model: relative when it is under the working directory, else as it is. */
export function shown(path: string): string { const r = relative(process.cwd(), path); return r && !r.startsWith("..") ? r : path; }
const written = (w: { path: string; bytes: number }) => `Written to ${shown(w.path)} (${w.bytes} bytes)`;

/**
 * `-` is standard input or output to the commands, and both are the protocol here: a tool reading `-` would eat the
 * client's messages, one writing to it would put a map in the middle of them. Every path argument is checked.
 */
function noPipe(...paths: (string | undefined)[]): void {
  if (paths.includes("-")) throw new CliError("`-` (standard input or output) is not a file here: the server speaks the protocol on it.", "Name a file on this computer.", 2);
}

type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;
/** Runs `fn` as a tool: its lines become the result, a CliError the error text. */
const tool = <T>(fn: (args: T, extra: Extra) => Promise<CallToolResult>) => async (args: T, extra: Extra): Promise<CallToolResult> => {
  try {
    const a = args as { path?: string; out?: string; a?: string; b?: string; paths?: string[] };
    noPipe(a.path, a.out, a.a, a.b, ...(a.paths ?? []));
    return await fn(args, extra);
  } catch (e) { return failed(e); }
};

/**
 * The longest run each game tool takes: ten minutes of play, a few seconds of running. A trace's result is a line
 * per trigger; a cost's carries five numbers a frame (about 150 KB of structured data at the cap), which is as much
 * as a model should be handed in one result.
 */
export const MAX_FRAMES = { trace: 24 * 60 * 10, cost: 24 * 60 * 10 } as const;
/** The run the commands make by default (`--frames 2400`): 100 seconds of play. */
const FRAMES = 2400;
/** Columns for a trigger's text in the trace and cost tables: wider than a terminal, since nobody wraps them. */
const WIDTH = 140;

/**
 * Where the game tools' engine and weigher come from when not from the play page and beside the command: for tests,
 * which hand the server a staged folder and a stand-in. A person sets `SCMJS_PLAY_URL` in the client's settings instead.
 */
export interface McpOptions { engine?: string; weigh?: string }

/** What the client is told once, with the tool list: how the tools fit together. */
export const INSTRUCTIONS = `scmJS: StarCraft: Brood War maps on this computer. Paths are files here, relative to the working directory. Start with map_info or map_dump to see what a map holds; map_check is Check Map (errors and warnings, as the editor's). Triggers and strings travel as text: map_triggers_export gives the trigger window's text form (https://docs.scmjs.dev/triggers/), which map_triggers_import takes back; strings are "<number><TAB><text>" lines. Tools that change a map write over it unless given "out"; they never renumber strings. Map text is never translated. map_preview shows the map as a picture, map_analyze reads a melee map's layout (starts, naturals, walks between starts, chokes) in a second, map_trace and map_cost run it in the game itself, and map_coverage counts which triggers fired over many replays; these need a copy of StarCraft on this computer, and doctor says whether one is there and what to install if not. replay_map writes the map a replay was played on. map_optimize makes a map smaller without changing what the game plays (a dry run unless told to write); map_balance plays games on a melee map with the person's own bots to see whether its start locations are fair, which takes minutes. Mods: mod_info says what a mod is, mod_unpack writes it as a folder of text and PNG sheets the person or you can edit, mod_check lints it, mod_diff reads two as a changelog (or one against the game), mod_pack makes the MPQ back, mod_new starts an empty one, mod_header writes a mod's ids by name for a bot made for it, and mod_play hands a mod (with a map and a bot) to the play page in the person's browser. map_trace and map_cost take a mod too.`;

/**
 * The server with every tool registered, and their names; `connect` it to a transport (stdio for the command, in
 * memory for tests).
 */
export function createMcpServer(options: McpOptions = {}): { server: McpServer; tools: string[] } {
  const server = new McpServer({ name: "scmjs", version: VERSION }, { instructions: INSTRUCTIONS });
  const tools: string[] = [];
  const reg: typeof server.registerTool = (name, config, cb) => { tools.push(name); return server.registerTool(name, config, cb); };

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
    const r = mapReport(input, doc);
    const listed = (list: typeof r.issues) => list.filter((i) => all || i.level !== "info");
    if (!baseline) return ok([`${input.name}  ${issueLine(r.issues)}`, ...printIssues(r.issues, !!all)], { file: input.path, name: r.name, issues: listed(r.issues), failed: r.issues.some((i) => i.level === "error") });
    const known = readBaseline(baseline);
    const m = matchBaseline(known.maps[mapKey(baseline, input.path)], r.issues, doc.scenario);
    const fresh = listed(m.fresh);
    const counts = { file: baseline, suppressed: listed(m.suppressed).length, fixed: m.fixed.length, new: fresh.length, fixedFindings: m.fixed.map(({ level, where, text }) => ({ level, where, text })) };
    return ok([`${input.name}  ${baselineLine(fresh, counts)}`, ...printIssues(fresh, !!all)], { file: input.path, name: r.name, issues: fresh, failed: fresh.some((i) => i.level === "error"), baseline: counts });
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
    inputSchema: { text: z.string().describe("what to look for"), paths: z.array(path).min(1), kinds: z.array(z.string()).optional(), matchCase: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, tool(async ({ text, paths, kinds, matchCase }) => {
    const which = parseKinds(kinds?.join(","));
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
    inputSchema: { path, write: z.boolean().optional().describe("write the result (over the map, or to out); a dry run otherwise"), stripEditor: z.boolean().optional(), compression: z.enum(["pkware", "zlib"]).optional(), keep: z.array(z.string()).optional().describe("archive members to keep though nothing names them; a name ending in \\ keeps a folder"), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, write, stripEditor, compression, keep, out: to }) => {
    const input = await readInput(file);
    expectKind(input, "map");
    const r = await optimizeMap(input.bytes, input.name, { stripEditor, compression, keep });
    const w = write && r.after < r.before ? await writeOutput(r.bytes, to ?? input.path) : null;
    return ok([...printOptimize(r, { dryRun: !write, written: w ? shown(w.path) : null, all: true }), ...(w ? [written(w)] : [])], optimizeJson(r, { dryRun: !write, written: w }));
  }));

  reg("map_set", {
    title: "Map properties",
    description: `Scenario ▸ Map Properties: set the map's name, description, revision (${VERSIONS.join(", ")}) or text encoding (${ENCODINGS.join(", ")}); what is given is set, the rest left. <03> and the like in a name are the game's colour codes.`,
    inputSchema: { path, name: z.string().optional(), description: z.string().optional(), revision: z.string().optional(), encoding: z.string().optional(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, name, description, revision, encoding, out: to }) => {
    if (name === undefined && description === undefined && revision === undefined && encoding === undefined) throw new CliError("Nothing to set", "name, description, revision or encoding, any of them.", 2);
    const { input, doc } = await openMap(file);
    const changes = setHeader(doc, { name, description, version: revision, encoding });
    const w = changes.length || to ? await writeBack(doc, input.path, to ?? null) : null;
    const lines = changes.length ? changes.map((c) => `${c.field}: ${c.from || "(none)"} → ${c.to || "(none)"}`) : [`${input.name}: nothing changed`];
    return ok(w ? [...lines, written(w)] : lines, { changes, written: w });
  }));

  reg("map_resize", {
    title: "Resize the map",
    description: `Scenario ▸ Resize: the map to another size (width and height each 64, 96, 128, 192 or 256), the old map kept under the anchor (${Object.keys(ANCHORS).filter((k) => k !== "centre").join(", ")}); what falls outside is dropped, locations pulled inside unless \`clamp\` is false.`,
    inputSchema: { path, size: z.string().describe("WxH, such as 128x96"), anchor: z.string().optional(), clamp: z.boolean().optional(), out },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, size: spec, anchor, clamp, out: to }) => {
    const { width, height } = parseSize(spec);
    const { input, doc } = await openMap(file);
    const r = resizeMap(doc, { width, height, anchor: parseAnchor(anchor ?? "center"), clampLocations: clamp ?? true });
    const w = await writeBack(doc, input.path, to ?? null);
    const dropped = [r.unitsDropped && `${r.unitsDropped} units`, r.spritesDropped && `${r.spritesDropped} sprites`, r.doodadsDropped && `${r.doodadsDropped} doodads`].filter(Boolean).join(", ");
    return ok([`${input.name}: ${r.from.width} × ${r.from.height} → ${r.to.width} × ${r.to.height}${dropped ? `, ${dropped} dropped` : ""}${r.locationsClamped ? `, ${r.locationsClamped} locations pulled inside` : ""}`, written(w)], { ...r, written: w });
  }));

  reg("map_new", {
    title: "A new map",
    description: `A new map as File ▸ New makes it: flat ground, start locations for players 1 to \`players\` laid out in a ${LAYOUTS.join(" or ")}, the other slots closed, written to \`path\` (.scx, .scm or .chk). Tilesets: badlands, platform, install, ashworld, jungle, desert, ice, twilight. Revision ${NEW_VERSIONS.join(" or ")}. Refuses a file that is there unless \`force\`.`,
    inputSchema: { path, size: z.string().optional().describe("WxH, 128x128 by default"), tileset: z.string().optional(), name: z.string().optional(), description: z.string().optional(), players: z.number().int().min(0).max(8).optional(), layout: z.string().optional(), revision: z.string().optional(), force: z.boolean().optional() },
  }, tool(async ({ path: file, size: spec, tileset, name, description, players, layout, revision, force }) => {
    const { width, height } = parseSize(spec ?? "128x128");
    const rev = revision ?? "broodwar", lay = layout ?? "ring";
    if (!(NEW_VERSIONS as readonly string[]).includes(rev)) throw new CliError(`revision takes ${NEW_VERSIONS.join(" or ")}, not "${rev}"`, null, 2);
    if (!(LAYOUTS as readonly string[]).includes(lay)) throw new CliError(`layout takes ${LAYOUTS.join(" or ")}, not "${lay}"`, null, 2);
    if (existsSync(file) && !force) throw new CliError(`${file} is there already`, "force overwrites it.", 2);
    const r = await writeNewMap(file, { width, height, tileset: parseTileset(tileset ?? "badlands"), name: name ?? nameFromFile(file), description: description ?? "", version: rev as NewMapVersion, players: players ?? 0, layout: lay as (typeof LAYOUTS)[number] });
    return ok([`${shown(r.path)}: ${r.width} × ${r.height}, ${r.tileset}, ${r.version}${r.starts ? `, ${r.starts} start locations` : ""} (${r.bytes} bytes)`], r);
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
    description: "Run an editor plugin, or a script written like one (a file exporting activate(api)), over the map with the plugin API and no editor: a folder with plugin.json, a plugin.ts/.js file, github:owner/repo or a URL. `command` runs one of its commands after it starts. `dryRun` says what would change and writes nothing. The plugin runs with this computer's privileges.",
    inputSchema: { plugin: z.string(), path, command: z.string().optional(), args: z.array(z.string()).optional(), out, dryRun: z.boolean().optional() },
    annotations: { destructiveHint: true, openWorldHint: true },
  }, tool(async ({ plugin, path: file, command, args, out: to, dryRun }) => {
    const { input, doc } = await openMap(file);
    const r = await runOnMap(doc, input.path, input.bytes, plugin, { command, args, out: to ?? null, dryRun: !!dryRun });
    return ok(printRun(input.name, r, { events: true, dryRun: !!dryRun }), { file: input.name, ...r });
  }));

  /** The game tools' arguments: the map, how long, the seed, the copy of the game. */
  const game = (most: number) => ({
    path,
    frames: z.number().int().min(1).max(most).optional().describe(`frames to run, 24 a second: ${FRAMES.toLocaleString("en")} (100 seconds of play) by default, at most ${most.toLocaleString("en")}; the game may end sooner`),
    seed: z.number().int().min(0).optional().describe("the game's seed, 1 by default; the same seed and map give the same run"),
    starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, when doctor did not find one in the usual places"),
    all: z.boolean().optional().describe("list every trigger; a long list is cut otherwise (the data has them all)"),
    mod: z.string().optional().describe("lay a mod over the game (the command's --mod): a mod folder, an .mpq, a mod's .exe or .zip; needs a play page whose engine takes a mod"),
  });
  /**
   * Runs the map in the game for one of the two taps: the copy the game is handed, the runner's live lines to standard
   * error (standard output is the protocol), its progress as the client's progress notifications when it asked for them.
   */
  const play = async (what: "trace" | "cost", a: { path: string; frames?: number; seed?: number; starcraft?: string; mod?: string }, extra: Extra) => {
    noPipe(a.mod);
    const { input, doc } = await openMap(a.path);
    const target = await gameMap(doc, input.path, input.name);
    const overlay = a.mod ? modOverlay(a.mod, () => gameFilesOrNull(a.starcraft)) : null;
    const frames = a.frames ?? FRAMES;
    const token = extra._meta?.progressToken;
    const o: MapRunOptions = {
      frames, every: 600, seed: a.seed ?? 1, starcraft: a.starcraft, engine: options.engine, weigh: options.weigh,
      live: (line) => STDERR(visible(line)),
      onProgress: token === undefined ? undefined : (l) => void extra.sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: l.frame, total: frames, message: `frame ${l.frame} of ${frames}` } }).catch(() => {}),
      // The client cancelling the request stops the game, rather than leaving the runner to play on unheard.
      signal: extra.signal,
      mod: overlay ?? undefined,
    };
    const r = await runMapInGame(target.path, what, o).finally(() => overlay?.remove());
    const note = target.converted ? [pc.dim(`${input.name} is in the StarCraft 1.00 form, which the engine does not run: a copy converted to Brood War was run instead`)] : [];
    return { input, doc, r, note };
  };
  const needs = "Needs a copy of StarCraft (Remastered or 1.16.1) on this computer and the game engine, which is fetched from the play page the first time (about 25 MB to download) into the cache; doctor says whether both are there. Takes a few seconds for the default run.";

  reg("map_trace", {
    title: "Run the triggers in the game",
    description: `Run the map in the game itself (scmjs map trace) as Use Map Settings, the person's seat idle and the computers as the map has them, for a number of frames, and report each trigger: how often it fired, the first and last frame, whose it is; then the triggers that never fired, each with the condition that said no last. Nobody plays, so a trigger waiting on a player's move will not fire. The rows as data, with every copy of a trigger the game held. ${needs}`,
    inputSchema: game(MAX_FRAMES.trace),
    annotations: { readOnlyHint: true },
  }, tool(async (a, extra) => {
    const { input, doc, r, note } = await play("trace", a, extra);
    return ok([...note, ...printTrace(input.name, doc.scenario, r, { all: !!a.all, width: WIDTH })], traceJson(input.name, doc.scenario, r));
  }));

  reg("map_cost", {
    title: "What the triggers cost a frame",
    description: `Run the map in the game as map_trace does and weigh every trigger the game passes and every condition and action it runs as StarCraft: Remastered charges for them (scmjs map cost): milliseconds a frame on average where the triggers ran and at the most, against what a frame can carry (smooth to about 15 ms), then the costliest triggers. The frame-by-frame series as data. ${needs}`,
    inputSchema: game(MAX_FRAMES.cost),
    annotations: { readOnlyHint: true },
  }, tool(async (a, extra) => {
    const { input, doc, r, note } = await play("cost", a, extra);
    return ok([...note, ...printCost(input.name, doc.scenario, r, { all: !!a.all, width: WIDTH })], costJson(input.name, r));
  }));

  reg("map_coverage", {
    title: "Which triggers fired in many games",
    description: `Play each replay's game on the map in the game itself, as map_trace plays a replay, and count every trigger's firings over all of them (scmjs map coverage): for each trigger the games it fired in, how often in all and when first, then the triggers a player owned that never fired in any game, each with the condition that said no last. Replays are files or folders (sub-folders too); only Use Map Settings games of this map count (the same map, or one with the same name and size; \`force\` takes others). \`tests\` counts the map's tests (map.tests.json beside it) as games too. A game whose commands parted from the map counts only what fired before that, and the result says so. ${needs.replace(" Takes a few seconds for the default run.", "")} A replay takes about as many seconds as it has minutes of play, a few at once.`,
    inputSchema: {
      path,
      replays: z.array(z.string()).describe("replay files (.rep) or folders of them; a tests file (.json) counts its scenarios"),
      tests: z.boolean().optional().describe("count the games of the map's tests (<map>.tests.json beside it) too"),
      force: z.boolean().optional().describe("take replays played on another map too"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, when doctor did not find one in the usual places"),
      all: z.boolean().optional().describe("list every trigger, those no player in the games owned too"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, replays, tests, force, starcraft, all }, extra) => {
    noPipe(...replays);
    const { input, doc } = await openMap(file);
    const r = await runCoverage(input, doc, replays, { tests, force, starcraft, engine: options.engine, signal: extra.signal }, (line) => STDERR(visible(line)));
    const scn = await coverageScenario(input);
    return ok(printCoverage(r, scn, { all: !!all, width: WIDTH }), coverageJson(r, scn));
  }));

  reg("map_balance", {
    title: "Is the map fair to every start",
    description: `Play games on a melee map (scmjs map balance) with the person's own BWAPI bots: one bot against the game's computer, or two bots both ways round, a seed a round. The game deals the start locations, so each game's replay is played back to read which start each side had and when one first lost a unit to the other. Per start location: games, wins, the win rate beside what the sides' own records predict, average length and first contact, the walk to the other starts, the main's minerals and gas; then a verdict. Takes minutes (a game is 10 to 60 seconds, several at once). ${needs.replace(" Takes a few seconds for the default run.", "")}`,
    inputSchema: {
      path,
      bots: z.array(z.string()).min(1).max(2).describe("one or two .scmbot files on this computer; a race after a colon: mybot.scmbot:p"),
      races: z.string().optional().describe("the races a side plays when it has none of its own: letters of z, t, p and r, r (random) by default"),
      games: z.number().int().min(1).max(50).optional().describe("rounds, a seed each: 8 by default"),
      frames: z.number().int().min(1000).max(50000).optional().describe("stop a game nobody has won after this many frames, 30,000 by default"),
      parallel: z.number().int().min(1).max(8).optional().describe("games at once"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, when doctor did not find one in the usual places"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async (a) => {
    const { input, doc } = await openMap(a.path);
    const races = parseRaces(a.races ?? "r");
    const playMap = await gameMap(doc, input.path, input.name), rushMap = await gameMap(doc, input.path, input.name);
    try {
      const r = await runBalance(input.name, input.path, doc, {
        bots: a.bots, races, seeds: Array.from({ length: a.games ?? 8 }, (_, k) => k + 1), frames: a.frames ?? 30000, parallel: a.parallel,
        starcraft: a.starcraft, engine: options.engine, play: playMap.path, rushPlay: rushMap.path, live: (line) => STDERR(visible(line)),
      });
      return ok(printBalance(r), balanceJson(r));
    } finally { removeGameMap(playMap.path); removeGameMap(rushMap.path); }
  }));

  reg("doctor", {
    title: "What this computer has",
    description: "What this computer has of what the tools need beyond Node (scmjs doctor): whether a copy of StarCraft and the game engine are there, which map_trace and map_cost need, TypeScript for map_build, and whether npm has a newer scmjs; for each thing missing, what the person can install or set. Call it before map_trace or map_cost, or when one fails, to know what to tell the person. Changes nothing.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(async () => {
    const r = await doctorReport();
    return ok(printDoctor(r), doctorJson(r));
  }));

  reg("replay_info", {
    title: "What a replay holds",
    description: "Who played a replay (.rep), their races, colours, teams and APM, on which map, for how long, when, and at what speed, as `scmjs replay info` prints it, and the mod it was played with when the replay says (`mod`: the data set's name, hash and link, the plugins that ran; null for the game itself). `builds` adds what each player ordered (units, buildings, upgrades, technologies) by name with their cost. A mod's replay names them only with `mod`, the mod's folder (or .mpq, .exe, .zip), which is refused when its data set's hash is not the replay's; without it the orders are ids.",
    inputSchema: {
      path: z.string().describe("the replay file (.rep)"),
      builds: z.boolean().optional().describe("also list what each player ordered, by name, with its cost"),
      mod: z.string().optional().describe("the mod the replay was played with, for its names and costs: a folder, an .mpq, a mod's .exe or .zip"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, for the game's costs and the files under a mod; found in the usual places otherwise"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, builds, mod, starcraft }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const rep = await loadReplayInput(input);
    const r = replayReport(input, rep);
    const warnings: string[] = [];
    if (mod || builds) {
      const names = await replayNamer(rep, input.name, { mod, starcraft, costs: !!builds, warn: (line) => warnings.push(line) });
      r.names = names.from;
      if (builds) r.builds = buildOrders(rep, names);
    }
    return ok([...warnings, ...printReplayInfo(r)], r);
  }));

  reg("map_preview", {
    title: "A picture of the map",
    description: "The map as a picture (scmjs map preview): the terrain drawn with the game's own tileset graphics, read from the person's copy of StarCraft, with a dot for every unit in its owner's colour, mineral fields and geysers in theirs, and the start locations framed. The result is a PNG image, plus the picture's facts as text and data. `scale` is pixels a tile, 1 to 8 (4 by default: a 128 × 128 map is 512 px); `marks: false` draws the terrain alone. Needs a copy of StarCraft (Remastered or 1.16.1) on this computer; doctor says whether one is there.",
    inputSchema: {
      path,
      scale: z.number().int().min(1).max(8).optional().describe("pixels a tile: 1, 2, 4 or 8 (4 by default)"),
      marks: z.boolean().optional().describe("units, resources and start locations over the terrain (the default); false for the terrain alone"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, when doctor did not find one in the usual places"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, scale, marks, starcraft }) => {
    const s = scale ?? DEFAULT_PNG_SCALE;
    if (![1, 2, 4, 8].includes(s)) throw new CliError(`scale takes 1, 2, 4 or 8, not ${s}`, null, 2);
    const { input, doc } = await openMap(file);
    const t0 = performance.now();
    const files = await openGameFiles(starcraft);
    const graphics = await loadGraphics(doc.scenario, files);
    const drawn = previewPng(doc, graphics, { scale: s, marks: marks !== false });
    const facts = { file: input.name, name: mapReport(input, doc).name, size: { width: doc.scenario.width, height: doc.scenario.height }, tileset: tilesetOf(doc.scenario), picture: { width: drawn.picture.width, height: drawn.picture.height, scale: s, bytes: drawn.png.length }, drawn: drawn.counts, ms: Math.round(performance.now() - t0) };
    const text = `${input.name}: ${facts.size.width} × ${facts.size.height}, ${facts.tileset}, drawn at ${s} px a tile (${facts.picture.width} × ${facts.picture.height}); ${facts.drawn.starts} start locations, ${facts.drawn.units} units, ${facts.drawn.buildings} buildings, ${facts.drawn.minerals} mineral fields, ${facts.drawn.geysers} geysers`;
    return { content: [{ type: "image", data: Buffer.from(drawn.png).toString("base64"), mimeType: "image/png" }, { type: "text", text }], structuredContent: facts };
  }));

  reg("map_analyze", {
    title: "A melee map's layout",
    description: "A melee map's layout without running the game (scmjs map analyze): each start location's place, its main's fields and geysers, its natural (the nearest other base on foot) with the ground and straight-line distance, the ground walk between every pair of starts beside the straight line (tiles, and seconds for a Zergling, Marine and Zealot), the narrowest passage on each walk and on each main's way out, the walkable, buildable and high-ground shares, and verdicts (a ✔/▲/ℹ line each, with the rule's threshold in the docs). Walks are over the tileset's walkable minitiles with buildings and resources in the way; they agree with the game's own walks (map rush) within a few percent. With `picture`, also a PNG: the map with the walks in white, the walks to the naturals in yellow, naturals circled in the player's colour, each way out boxed in orange and other narrow points in red. Needs a copy of StarCraft (Remastered or 1.16.1) on this computer for the tileset; doctor says whether one is there.",
    inputSchema: {
      path,
      all: z.boolean().optional().describe("every pair of starts and every base in the text, not only the shortest and longest pair on a map of five starts or more"),
      picture: z.boolean().optional().describe("also return the map as a PNG with the walks, naturals and narrow points drawn on it"),
      scale: z.number().int().min(1).max(8).optional().describe("the picture's pixels a tile: 1, 2, 4 or 8 (4 by default)"),
      starcraft: z.string().optional().describe("the folder of the person's StarCraft installation, when doctor did not find one in the usual places"),
    },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, all, picture, scale, starcraft }) => {
    const s = scale ?? DEFAULT_PNG_SCALE;
    if (![1, 2, 4, 8].includes(s)) throw new CliError(`scale takes 1, 2, 4 or 8, not ${s}`, null, 2);
    const { input, doc } = await openMap(file);
    const t0 = performance.now();
    const files = await openGameFiles(starcraft, "Which ground is walkable comes from the person's installation's tileset");
    const layoutFiles = await loadLayoutFiles(doc.scenario, files);
    const t1 = performance.now();
    const layout = analyzeLayout(doc.scenario, layoutFiles);
    const report = layoutReport(input, doc.scenario, files, layout, { copy: Math.round(t1 - t0), analyze: Math.round(performance.now() - t1), total: Math.round(performance.now() - t0) });
    const result = ok(layoutLines(report, files, !!all), report);
    if (picture) {
      const pic = layoutPicture(doc, layoutFiles, layout, s);
      result.content.unshift({ type: "image", data: Buffer.from(encodePng(pic.pixels, pic.width, pic.height)).toString("base64"), mimeType: "image/png" });
    }
    return result;
  }));

  reg("replay_map", {
    title: "The map a replay was played on",
    description: "Write out the map a replay (.rep) was played on, which the replay carries whole (scmjs replay map): to `out` (.scx, .scm or .chk), or beside the replay with its name and .scx. The map's sounds and other files are not in a replay, only the scenario. Refuses a file that is there unless `force`.",
    inputSchema: { path: z.string().describe("the replay file (.rep)"), out: z.string().optional().describe("the map file to write; the replay's name with .scx, beside it, by default"), force: z.boolean().optional() },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: to, force }) => {
    const input = await readInput(file);
    expectKind(input, "replay");
    const out = to ?? mapFileFor(input.path);
    if (existsSync(out) && !force) throw new CliError(`${out} is there already`, "force overwrites it, out names another file.", 2);
    const r = await writeReplayMap(await loadReplayInput(input), out);
    return ok([`${r.name || "Untitled"}: ${r.width} × ${r.height}, from ${input.name}`, written(r.written)], { file: input.name, ...r });
  }));

  // ── Mods ──
  const modPath = z.string().describe("the mod: a folder of its files, an .mpq, a mod's self-executing .exe, a .zip, or a folder mod_unpack wrote");
  const starcraft = z.string().optional().describe("the folder of the person's StarCraft installation, whose files are under the mod; found in the usual places otherwise");

  reg("mod_info", {
    title: "What a mod is",
    description: "A StarCraft mod's name, files and sizes by kind (tables, scripts, pictures, sounds, terrain, strings, AI), which tables are wider than the game's and in which layout (DatExtend's expanded .dat, GPTP's .datex), the plugins and FireGraft files it carries (never run), the game it is for, and its hash (`hash`: the name the play page and a replay know the mod by, over every file it provides, its plugins and its FireGraft project; `withoutPlugins`: the same without the plugins, what a page that runs none of them presents), as `scmjs mod info` prints it.",
    inputSchema: { path: modPath, starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, starcraft: sc }) => {
    const source = await openMod(file, await gameFilesOrNull(sc));
    const r = modInfo(source, await sourceHash(source));
    return ok(printModInfo(r), r);
  }));

  reg("mod_check", {
    title: "Check a mod",
    description: "The lints across a mod's tables, strings, scripts and files (scmjs mod check): references past their tables, strings past their string table, images with no GRP or no iscript entry, button sets and requirements for things that are not there (errors); weapons and iscript entries the mod added that nothing uses, sound rows with no file, mixed extended layouts, units with one name (warnings). Each finding has where and why; `failed` is true when there is an error. What the mod leaves as the game had it is not judged.",
    inputSchema: { path: modPath, all: z.boolean().optional().describe("list every finding in the text; the data always has them all"), starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ path: file, all, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await checkModSource(await openMod(file, base), base);
    return ok(printModCheck(r, { all: !!all }), r);
  }));

  reg("mod_diff", {
    title: "What changed between two mods",
    description: "A changelog between two mods (scmjs mod diff), or with only `a`, between the game and the mod (everything the mod changes): table fields by name (\"Terran Marine: ground weapon damage 6 → 7\"), entries added, string table entries, iscript animations changed, and pictures, sounds and other files counted. Needs a copy of StarCraft for the one-mod form.",
    inputSchema: { a: modPath, b: z.string().optional().describe("the other mod; without it, the game against `a`"), all: z.boolean().optional().describe("list every change in the text"), starcraft },
    annotations: { readOnlyHint: true },
  }, tool(async ({ a, b, all, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await diffModSources(await openMod(a, base), b ? await openMod(b, base) : null, base);
    return ok(printModDiff(r, { all: !!all }), r);
  }));

  reg("mod_unpack", {
    title: "A mod as a folder of text",
    description: "Write a mod as a folder of text and pictures (scmjs mod unpack): tables as PyDAT text in tables/, string tables in strings/, iscript in iscript/, the AI scripts in ai/aiscript.txt, overlays in overlays/, .graft files in grafts/, GRPs as PNG sheets in graphics/, sounds in sounds/, everything else under files/, and mod.json. A text or picture is kept only when it packs back into the same bytes; mod.json says which files were kept as bytes and why. Edit the texts, then mod_pack. Refuses a folder that is there and is not an earlier unpack.",
    inputSchema: { path: modPath, out: z.string().describe("the folder to write"), palette: z.string().optional().describe("the tileset whose palette the GRPs are drawn with (jungle by default)"), starcraft },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: dir, palette, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await unpackMod(await openMod(file, base), dir, { base, palette });
    const lines = [`${r.name}: ${r.members} files → ${shown(r.dir)}`, ...Object.entries(r.forms).map(([k, n]) => `  ${k}: ${n}`), ...r.kept.map((k) => `  kept as bytes, ${k.count}: ${k.why}`), ...r.notes];
    const { manifest: _m, ...data } = r;
    return ok(lines, data);
  }));

  reg("mod_pack", {
    title: "A mod folder back into an MPQ",
    description: "Pack a folder mod_unpack or mod_new wrote (scmjs mod pack): an MPQ the launchers load (MPQDraft, Chaoslauncher, FireGraft), or with `folder` the files loose in the game's paths (samase, the play page). The same folder gives the same bytes. Overwrites `out`.",
    inputSchema: {
      path: z.string().describe("the mod folder (with mod.json)"),
      out: z.string().optional().describe("the MPQ to write; <folder>.mpq beside the folder by default"),
      folder: z.string().optional().describe("write the files loose under this folder instead of an MPQ"),
      compression: z.enum(MOD_COMPRESSIONS as [ModCompression, ...ModCompression[]]).optional().describe("zlib (the default), pkware or none"),
      starcraft,
    },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: dir, out: to, folder, compression, starcraft: sc }) => {
    noPipe(folder);
    const manifest = await readModFolder(dir);
    const r = await packMod(dir, manifest, { out: to, folder, compression, base: await gameFilesOrNull(sc) });
    return ok([`Written ${shown(r.path)}: ${r.members} files, ${r.bytes} bytes${r.compression ? `, ${r.compression}` : ", loose"}`, ...r.quantised.map((q) => `${q.file}: ${q.pixels} pixels brought to the palette`), ...(r.left.length ? [`Left out: ${r.left.join(", ")}`] : [])], r);
  }));

  reg("mod_header", {
    title: "A mod's ids by name, for a bot",
    description: "Write a mod's units, weapons, upgrades and techs by name for a BWAPI bot made for it (scmjs mod header): <Mod>.h, C++ for a bot built with scmbot (Cosmonarchy_BW::UnitTypes::Terran_Mason is a BWAPI::UnitType), and <Mod>.ids.json, the same ids for other languages, both carrying the mod's name and hash. With `bot`, `out` is a bot's folder (it has scmbot.json) and its scmbot.json gains the mod, which `scmjs bot build` (Docker) writes into the .scmbot file; the runners and the play page then say the bot was made for that mod. Overwrites the two files in `out`.",
    inputSchema: {
      path: modPath,
      out: z.string().optional().describe("the folder the files go in (the working directory by default); with `bot`, the bot's folder"),
      namespace: z.string().optional().describe("the C++ namespace and the files' name (the mod's name made an identifier by default)"),
      bot: z.boolean().optional().describe("`out` is a bot's folder: write the mod into its scmbot.json"),
      starcraft,
    },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: file, out: to, namespace, bot, starcraft: sc }) => {
    const base = await gameFilesOrNull(sc);
    const r = await writeModHeader(await openMod(file, base), base, { out: to, namespace, bot });
    return ok([
      `${r.mod.name}: ${r.counts.units} units, ${r.counts.weapons} weapons, ${r.counts.upgrades} upgrades, ${r.counts.techs} techs named · hash ${r.mod.hash}`,
      `Header: ${shown(r.files.header)}`, `Ids: ${shown(r.files.ids)}`,
      ...(r.files.scmbot ? [`Bot: ${shown(r.files.scmbot)} now names the mod: build the bot again (scmjs bot build)`] : []),
      ...(r.fromGame.length ? [`From the game: the names of ${r.fromGame.join(", ")} (the mod has not got them)`] : []),
    ], r);
  }));

  reg("mod_play", {
    title: "Play a mod on the play page",
    description: "Hand a mod to the play page in the person's browser (scmjs mod play): a page on this computer's loopback address opens scmjs.dev/play and gives it every file of the mod (nothing is uploaded; the page keeps the mod in the browser), with `map` the map, and with `bot` a bot for the other side — a .scmbot file, or a bot of the play page by its key (cosmonarchy-example, mcrave, ualbertabot, example), at `race`. With a bot the map is on the page's setup screen with the bot's row filled, saying whether it was made for the mod, and the person presses Start Game (`start` starts at once). Opens the person's browser, then waits for the page: returns the loopback link (to open by hand if no browser opened) and what the page said (ready, shown, started, the bot's row), or says the page was not reached. A bot of the play page needs the person signed in to scmjs.dev; the page asks. The first hand-over of a large mod takes minutes (Cosmonarchy: about two).",
    inputSchema: {
      path: modPath,
      map: z.string().optional().describe("the map to play: .scm or .scx; without it the page shows its maps"),
      bot: z.string().optional().describe("a .scmbot file on this computer, or a play page bot's key; needs `map`"),
      race: z.enum(["zerg", "terran", "protoss", "random"]).optional().describe("the bot's race where the map leaves it open"),
      start: z.boolean().optional().describe("with `bot`, start the game at once instead of showing the setup screen"),
      wait: z.number().int().min(10).max(900).optional().describe("seconds to wait for the page, 300 by default"),
      starcraft,
    },
    annotations: { openWorldHint: true },
  }, tool(async ({ path: file, map: mapFile, bot, race, start, wait, starcraft: sc }) => {
    noPipe(mapFile, bot);
    if (bot && !mapFile) throw new CliError("`bot` needs `map`: the bot plays on a map.", null, 2);
    const playBot = bot ? playBotOf(bot) : null;
    const set = await playSet(await openMod(file, await gameFilesOrNull(sc)));
    const map = mapFile ? await readInput(mapFile) : null;
    if (map) expectKind(map, "map");
    let link = "";
    const lines: string[] = [];
    try {
      const r = await playOnPage(set, {
        map: map && { name: map.name, bytes: map.bytes }, bot: playBot, botRace: race ? pageRace(race) : undefined, start,
        live: (line) => { lines.push(visible(line)); STDERR(visible(line)); }, onAddress: (a) => { link = a; }, timeout: (wait ?? 300) * 1000,
      });
      const said = r.said.map((m) => m.type);
      const head = r.error ? `The play page said: ${r.error}` : r.shown ? `${set.name} is on the play page's setup screen${r.bot ? `, the bot's row: ${r.bot}. The person presses Start Game.` : "."}` : `${set.name} is playing on the play page${r.bot ? `, against ${r.bot}` : ""}.`;
      const data = { link, name: set.name, hash: set.hash, withoutPlugins: set.withoutPlugins, files: set.total.files, started: r.started, shown: r.shown, error: r.error, bot: r.bot, said };
      return { ...ok([head, `Hand-over page: ${link}`, `The page said: ${said.join(", ") || "nothing"}`], data), ...(r.error ? { isError: true } : {}) };
    } catch (e) {
      if (e instanceof CliError && link) throw new CliError(`${e.message}. The hand-over page was ${link}; the person can open it in a browser while the tool waits, or call mod_play again.`, e.hint, e.exitCode);
      throw e;
    }
  }));

  reg("mod_new", {
    title: "A new mod folder",
    description: "Start an empty mod folder (scmjs mod new): mod.json and a README. Put the game's files the mod changes under files/ at their paths, or the texts under tables/, strings/ and the rest, then mod_pack. Refuses a folder that is there and not empty.",
    inputSchema: { path: z.string().describe("the folder to make"), name: z.string().optional().describe("the mod's name (the folder's by default)") },
    annotations: { destructiveHint: true },
  }, tool(async ({ path: dir, name }) => {
    const r = await newMod(dir, name);
    return ok([`${r.name}: ${r.files.join(", ")} in ${shown(r.dir)}`], r);
  }));

  return { server, tools };
}

/** The server over standard input and output, for `scmjs mcp`; returns when the client closes the pipe. */
export async function serveStdio(): Promise<void> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  // Standard output is the protocol from here on: anything the editor's code or a plugin would print goes to stderr.
  for (const k of ["log", "info", "debug", "warn", "error"] as const) console[k] = (...a: unknown[]) => STDERR(a.map(String).join(" "));
  const { server, tools } = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  STDERR(`scmjs ${VERSION}: MCP server on stdio, ${tools.length} tools, working directory ${process.cwd()}`);
  // The transport reads stdin but does not close on its end, so the client going away is watched here: the server is
  // closed and the command returns (else Node would exit on an unsettled await with code 13).
  await new Promise<void>((resolve) => { process.stdin.once("end", resolve); server.server.onclose = resolve; });
  await server.close();
}
