/**
 * `scmjs map build <map>`: a map's TrigScript script applied and its programs built into the file, as Save does in
 * the editor — without the editor. The compiler is the TrigScript plugin's own, at the version the editor ships
 * (`plugins/trigscript/`, vendored at its tag), bundled into the command; so a map built here is the map the editor
 * at this version would have saved. The steps are the editor's, in its order (`services/mapBuild.ts`):
 *
 *   1. compile the script against the map's names (`compileScript`) — and run its tests when asked;
 *   2. write the `trigger()` records into the trigger list as the script's block, with the files and manifest the
 *      editor keeps beside them (`script.ts#buildScript`), so the map opens in the editor as applied;
 *   3. with programs, lay them into the scenario (`buildOwnMap`) and pack the built file around the source
 *      (`packBuiltMap`), so the editor restores the map it was and the game plays the build.
 *
 * TypeScript is the compiler's front end and ten megabytes, so it is not bundled: it is found where the map's project
 * keeps it, next to this command, or installed globally, and named when it is missing (`loadTypeScript`).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as TS from "typescript";
import type { OpenedMap } from "../../src/editor/mapFile";
import type { Scenario } from "../../src/formats/chk/scenario";
import { PlayerType, FORCE_SLOTS } from "../../src/formats/chk/sections/players";
import { START_LOCATION, UNIT_TYPE_COUNT } from "../../src/data/units";
import { applyTriggers, readTriggers } from "../../src/editor/triggers";
import { locationName, usedLocations } from "../../src/editor/locations";
import { forceName, internString, readUnitSettings, unitCustomName } from "../../src/editor/settings";
import { readSwitchNames } from "../../src/editor/switches";
import { soundList } from "../../src/editor/sounds";
import { buildChk, defaultSaveOptions, keptExtras, planSave } from "../../src/editor/save";
import { packBuiltMap } from "../../src/editor/mapBuild";
import type { CompileResult, ScriptDiagnostic } from "../../plugins/trigscript/compiler/compiler";
import type { ScriptNames } from "../../plugins/trigscript/compiler/names";
import type { VorbisEncoder } from "../../plugins/trigscript/compiler/vorbis";
import type { TestWorld } from "../../plugins/trigscript/compiler/testing";
import type { ScriptSettings } from "../../plugins/trigscript/script";
import { outputFormat, writeBack, writeOutput } from "./exchange";
import { STDIO, toStdout } from "./files";
import { CliError, dot, mark, pc, plural, size } from "./ui";

/**
 * The plugin's modules, loaded when a build asks for them. `plugins/` is vendored by `npm run vendor:plugins`
 * (predev, prebuild, and `scripts/build-cli.mjs`) and is not in the repository, so the rest of the command — and
 * the tests of it — load without them; the bundle inlines these imports.
 */
async function trigscript() {
  try {
    const [compiler, names, libraries, backend, vorbis, script, version] = await Promise.all([
      import("../../plugins/trigscript/compiler/compiler"),
      import("../../plugins/trigscript/compiler/names"),
      import("../../plugins/trigscript/compiler/libraries"),
      import("../../plugins/trigscript/compiler/backend/build"),
      import("../../plugins/trigscript/compiler/vorbis"),
      import("../../plugins/trigscript/script"),
      import("../../plugins/trigscript/version"),
    ]);
    return { ...compiler, ...names, ...libraries, ...backend, ...vorbis, ...script, TRIGSCRIPT_VERSION: version.VERSION };
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== "ERR_MODULE_NOT_FOUND") throw e;
    throw new CliError("The TrigScript compiler is not in this build of scmjs.", "In a clone, npm run vendor:plugins fetches the plugins the editor ships, then build the command again.");
  }
}
type TrigScript = Awaited<ReturnType<typeof trigscript>>;

/** TypeScript, found on this computer. */
export interface TypeScriptModule {
  ts: typeof TS;
  /** `lib/typescript.js`, where it was found. */
  path: string;
  version: string;
  /** The standard library's declarations the script is checked against (`lib.es2023.d.ts` and what it references). */
  lib: string;
}

/** What TrigScript's own tests build the standard library from (`bundle/lib.mjs`). */
const LIB_ENTRY = "lib.es2023.d.ts";

/**
 * TypeScript from the map's project (`from`, the working directory), else from beside this command (a clone, or a
 * global install next to a global TypeScript), else from npm's global folder. A CliError, with the install line,
 * when there is none.
 */
export async function loadTypeScript(from = process.cwd()): Promise<TypeScriptModule> {
  const path = findTypeScript(from);
  if (!path) {
    throw new CliError("TrigScript compiles with TypeScript, and none is installed here.", "npm install typescript in the map's project, or npm install -g typescript, then build again.");
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: typeof TS } & typeof TS;
  const ts = mod.default ?? mod;
  if (typeof ts.createSourceFile !== "function") throw new CliError(`${path} is not TypeScript.`);
  return { ts, path, version: ts.version, lib: libText(dirname(path)) };
}

/** Where `typescript` is: the working directory's project, beside the command, then the global folder; null when nowhere. */
export function findTypeScript(from: string): string | null {
  const tries: (() => string)[] = [
    () => createRequire(join(resolve(from), "package.json")).resolve("typescript"),
    () => createRequire(import.meta.url).resolve("typescript"),
    () => {
      const root = execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], shell: process.platform === "win32" }).trim();
      return createRequire(join(root, "package.json")).resolve("typescript");
    },
  ];
  for (const t of tries) {
    try { return t(); } catch { /* the next place */ }
  }
  return null;
}

/** The standard library as the plugin concatenates it (`bundle/lib.mjs#defaultLib`), from this TypeScript's `lib/`. */
function libText(dir: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  const walk = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const text = readFileSync(join(dir, name), "utf8");
    for (const m of text.matchAll(/\/\/\/ <reference lib="([^"]+)" \/>/g)) walk(`lib.${m[1]}.d.ts`);
    parts.push(`// ── ${name} ──\n${text.replace(/\/\/\/ <reference[^\n]*\n/g, "")}`);
  };
  walk(LIB_ENTRY);
  return parts.join("\n");
}

/**
 * The Ogg Vorbis encoder a build needs for a clip of two seconds or more: the project's own copy of
 * wasm-media-encoders when it has one, else this TrigScript release's `dist/vorbis.wasm` from the CDN.
 */
export async function loadVorbis(from = process.cwd()): Promise<VorbisEncoder> {
  const { vorbisEncoder, TRIGSCRIPT_VERSION } = await trigscript();
  for (let dir = resolve(from); ; dir = dirname(dir)) {
    const wasm = join(dir, "node_modules", "wasm-media-encoders", "wasm", "ogg.wasm");
    if (existsSync(wasm)) return vorbisEncoder(readFileSync(wasm));
    if (dirname(dir) === dir) break;
  }
  const url = `https://cdn.jsdelivr.net/gh/scm-js/plugin-trigscript@v${TRIGSCRIPT_VERSION}/dist/vorbis.wasm`;
  const hint = "Connect to the network, or npm install wasm-media-encoders in the map's project.";
  let r: Response;
  try {
    r = await fetch(url);
  } catch (e) {
    throw new CliError(`The script plays a sound of two seconds or more, and the Ogg Vorbis encoder could not be fetched from ${url} (${e instanceof Error ? e.message : e}).`, hint);
  }
  if (!r.ok) throw new CliError(`The script plays a sound of two seconds or more, and the Ogg Vorbis encoder could not be fetched from ${url} (${r.status}).`, hint);
  return vorbisEncoder(await r.arrayBuffer());
}

/** Magenta's member (`plugins/trigscript/service.ts#MAGENTA_MEMBER`): a map it has triggers in. */
const MAGENTA_MEMBER = "magenta\\magenta.json";
const memberKey = (name: string) => name.replace(/\//g, "\\").toLowerCase();

/** The identifiers the script uses for the map's things, from the scenario — what the plugin reads off the editor's API. */
export async function mapNames(scn: Scenario, extras: ReadonlyMap<string, Uint8Array>): Promise<ScriptNames> {
  const { scriptNames } = await trigscript();
  return scriptNames({
    forceNames: Array.from({ length: FORCE_SLOTS }, (_, f) => forceName(scn, f) || null),
    locations: usedLocations(scn).map((index) => ({ index, name: locationName(scn, index) })),
    switchNames: readSwitchNames(scn),
    unitCustomName: (id) => unitCustomName(scn, id) || null,
    sounds: soundList(scn, extras).map((w) => ({ stringIndex: w.stringIndex, path: w.path })),
  });
}

/**
 * The world the script's tests start from (`service.ts#world`): the placed units, the locations as boxes, who plays
 * and in which force, the Create Unit with Properties slots, and the script's settings. A unit type's hit points
 * and shields are the map's own where it sets them; the game's defaults are in units.dat, which the command line
 * does not have.
 */
export function testWorld(scn: Scenario, settings: ScriptSettings): TestWorld {
  const unitStats: NonNullable<TestWorld["unitStats"]> = {};
  const own = scn.unitSettings ? readUnitSettings(scn).settings : null;
  if (own) for (let id = 0; id < UNIT_TYPE_COUNT; id++) if (own.useDefault[id] === 0) unitStats[id] = { hp: Math.floor(own.hitPoints[id] / 256), shields: own.shields[id] };
  const part = (max: number, percent: number, valid: boolean) => (valid ? Math.max(1, Math.ceil((max * Math.min(100, percent)) / 100)) : max);
  const units = scn.units.filter((u) => u.unitId !== START_LOCATION).map((u) => {
    const t = unitStats[u.unitId] ?? {};
    const hp = t.hp ?? 1, shields = t.shields ?? 0;
    return {
      type: u.unitId, owner: u.owner, x: u.x, y: u.y,
      maxHp: hp, hp: part(hp, u.hitPointsPercent, (u.validStates & 2) !== 0),
      maxShields: shields, shields: shields ? part(shields, u.shieldPercent, (u.validStates & 4) !== 0) : 0,
      resources: u.resourceAmount,
      ...((u.validStates & 64) !== 0 ? { cloaked: (u.stateFlags & 1) !== 0, burrowed: (u.stateFlags & 2) !== 0, hallucinated: (u.stateFlags & 8) !== 0, invincible: (u.stateFlags & 16) !== 0 } : {}),
    };
  });
  const locations: NonNullable<TestWorld["locations"]> = {};
  scn.locations.forEach((l, i) => { if (l.right > l.left || l.bottom > l.top) locations[i + 1] = { left: l.left, top: l.top, right: l.right, bottom: l.bottom }; });
  const types = scn.playerTypes.slice(0, 8);
  const players = types.flatMap((type, slot) => (type === PlayerType.Human || type === PlayerType.Computer ? [slot] : []));
  const computers = types.flatMap((type, slot) => (type === PlayerType.Computer ? [slot] : []));
  const forces = Object.fromEntries(scn.forces.playerForce.slice(0, 8).map((force, slot) => [slot, force]));
  const properties = (scn.cuwp ?? []).map((c) => {
    const state = (bit: number) => ((c.validProperties & bit) !== 0 ? (c.stateFlags & bit) !== 0 : undefined);
    return {
      hpPercent: c.validFields & 2 ? c.hitPointsPercent : undefined, shieldPercent: c.validFields & 4 ? c.shieldsPercent : undefined,
      energyPercent: c.validFields & 8 ? c.energyPercent : undefined, resources: c.validFields & 16 ? c.resources : undefined,
      cloaked: state(1), burrowed: state(2), hallucinated: state(8), invincible: state(16),
    };
  });
  return { units, locations, ...(players.length ? { players, forces, computers } : {}), unitStats, properties, heapCells: settings.heapCells, stackDepth: settings.stackDepth };
}

export interface BuildOptions {
  /** Compile (and test, with `test`) and write nothing. */
  check?: boolean;
  /** Run the script's tests before the build; a failing one refuses it. The map's own setting can ask for this too. */
  test?: boolean;
  /** Where the built map goes; null writes over the input. */
  out?: string | null;
  /** The Ogg Vorbis encoder, when a clip needs one (`loadVorbis` by default). */
  vorbis?: () => Promise<VorbisEncoder>;
}

export interface TestFailure { name: string; message: string; file?: string; line?: number }

export interface BuildOutcome {
  /** The script compiled, its tests passed (where run), and — unless `check` — the map was written. */
  ok: boolean;
  typescript: string;
  trigscript: string;
  /** TypeScript's, the compiler's, or the script's own when it threw as it ran; empty when it compiled. */
  diagnostics: ScriptDiagnostic[];
  /** The tests' results, when they ran; null when they were not asked for. */
  tests: { passed: number; failed: number; skipped: number; failures: TestFailure[] } | null;
  /** How many tests the script has, run or not. */
  testCount: number;
  /** The `trigger()` records the script compiles to. */
  triggerCount: number;
  /** The script's block in the trigger list after the build (0-based start), once it was applied. */
  block: { start: number; count: number } | null;
  /** `program()`s built into the map; a map with any needs StarCraft: Remastered. */
  programs: number;
  /** Clips the build put in the archive. */
  sounds: number;
  /** TrigScript's build log, and what the map maker should hear beyond it. */
  log: string[];
  warnings: string[];
  written: { path: string; bytes: number } | null;
}

/**
 * Build the map: the script applied, the programs laid in, the file written (unless `check`). Throws a CliError for
 * what cannot go on — no script, no TypeScript, a block edited by hand, a refused build; a script that does not
 * compile or whose tests fail is an outcome with `ok: false`, not an error, so the caller prints the lines.
 */
export async function buildMap(doc: OpenedMap, inputPath: string, typescript: TypeScriptModule, options: BuildOptions = {}): Promise<BuildOutcome> {
  const { compileScript, libraryImports, buildOwnMap, isRefused, finishSounds, buildScript, librarySources, readLibraries, readSettings, scriptState, TRIGSCRIPT_VERSION }: TrigScript = await trigscript();
  const scn = doc.scenario;
  const extras: ReadonlyMap<string, Uint8Array> = doc.extras;
  const list = readTriggers(scn);
  const state = scriptState(list, extras);
  if (!state.files) throw new CliError(`${doc.fileName} has no TrigScript script.`, "Triggers ▸ TrigScript… in the editor writes one into the map; docs.scmjs.dev/trigscript is the guide.");
  if ([...extras.keys()].some((k) => memberKey(k) === MAGENTA_MEMBER)) {
    throw new CliError(`${doc.fileName} has Magenta's triggers in it, which the command line does not build yet.`, "Save the map from the editor, where Magenta builds them with TrigScript.");
  }
  if (state.stale) {
    throw new CliError("The script's triggers were edited or removed outside the script, so it was not applied.", "Open the map in the editor: Triggers ▸ TrigScript… and Apply chooses what becomes of them.");
  }
  const settings = readSettings(extras);
  // The libraries the script imports: the map's own copies (a plugin's offer of one is the editor's business).
  const all = readLibraries(extras);
  const { used } = libraryImports(Object.values(state.files), librarySources(all));
  const libraries = Object.fromEntries(used.filter((id) => all[id]).map((id) => [id, all[id]]));
  const missing = used.filter((id) => !all[id]);
  if (missing.length) throw new CliError(`The script imports the ${missing.length === 1 ? "library" : "libraries"} ${missing.join(", ")}, and the map keeps no copy.`, "Apply the script in the editor once, with the plugin that provides it running: the map then keeps a copy.");

  const runTests = !!options.test || settings.testsGuardBuild;
  const compiled = compileScript(typescript.ts, state.files, await mapNames(scn, extras), {
    lib: typescript.lib,
    ...(Object.keys(libraries).length ? { libraries: librarySources(libraries) } : {}),
    sounds: !options.check,
    ...(runTests ? { tests: { world: testWorld(scn, settings) } } : {}),
  });
  const outcome: BuildOutcome = {
    ok: compiled.ok, typescript: typescript.version, trigscript: TRIGSCRIPT_VERSION, diagnostics: compiled.diagnostics,
    tests: null, testCount: compiled.tests?.list.filter((t) => t.kind === "test").length ?? 0,
    triggerCount: compiled.triggers.length, block: null, programs: compiled.ir.length, sounds: 0, log: [], warnings: [], written: null,
  };
  if (!compiled.ok) return outcome;
  if (runTests && compiled.tests) {
    const results = compiled.tests.results;
    const failed = results.filter((t) => t.status === "failed");
    outcome.tests = {
      passed: results.filter((t) => t.status === "passed").length, failed: failed.length, skipped: results.filter((t) => t.status === "skipped").length,
      failures: failed.map((t) => ({ name: t.id.replace(/^.*?::/, ""), message: t.message ?? "failed", ...(t.at ? { file: t.at.file, line: t.at.line } : {}) })),
    };
    if (failed.length) { outcome.ok = false; return outcome; }
  }
  if (options.check) return outcome;

  // The clips the script plays: an Ogg Vorbis one is encoded now (`finishSounds`), the others have their bytes.
  if (compiled.sounds.some((s) => s.vorbis)) finishSounds(compiled.sounds, await (options.vorbis ?? loadVorbis)());
  outcome.sounds = compiled.sounds.length;

  // The script's block into the list, with its files, manifest and sounds among the members — the editor's Apply.
  const plan = buildScript(list, extras, state.files, compiled as CompileResult, (text) => internString(scn, text), { libraries });
  applyTriggers(scn, plan.list);
  doc.extras = plan.extras;
  outcome.block = { start: plan.block.start, count: plan.block.count };

  if (compiled.ir.length === 0) {
    outcome.written = await writeBack(doc, inputPath, options.out ?? null);
    return outcome;
  }
  // Programs: the build lays them into the scenario as Save would write it, and the file keeps the source beside.
  const path = toStdout(inputPath, options.out) ? STDIO : options.out ?? inputPath;
  const format = outputFormat(doc, inputPath, options.out ?? null);
  if (format === "chk") throw new CliError("A bare .chk has nowhere to keep the map beside what TrigScript makes of it.", "Write an .scx instead: --out map.scx.");
  const saveOptions = { ...defaultSaveOptions(scn, doc.origin ?? null, path === STDIO ? doc.fileName : path), format };
  const savePlan = planSave(scn, doc.extras, saveOptions, doc.stored ?? null);
  const sourceChk = buildChk(savePlan);
  const own = buildOwnMap({ chk: sourceChk, compiled: { ir: compiled.ir, strings: compiled.strings, input: compiled.input, triggers: [] }, settings: { heapCells: settings.heapCells, stackDepth: settings.stackDepth } });
  if (isRefused(own)) throw new CliError(`The programs were not built: TrigScript does not take this yet (${own.refused}).`);
  outcome.log = own.lines;
  outcome.warnings = own.warnings;
  const kept = savePlan.stored?.kept ? savePlan.stored.members : null;
  const bytes = await packBuiltMap({ sourceChk, extras: keptExtras(savePlan, doc.extras), stored: kept, built: own.chk, steps: [{ id: "trigscript/build", label: "TrigScript" }], options: saveOptions });
  outcome.written = await writeOutput(bytes, path);
  return outcome;
}

/** The outcome as lines: the diagnostics or the failing tests first, then one line that says what was done. */
export function printBuild(name: string, r: BuildOutcome): string[] {
  const lines: string[] = [];
  const refused = (why: string) => { lines.push("", `${mark.error} ${pc.bold(name)}: ${why}${dot}nothing written`); return lines; };
  if (r.diagnostics.length) {
    for (const d of r.diagnostics) lines.push(`${pc.cyan(d.file)}:${d.line}:${d.column} ${pc.red("error")} ${d.message.split("\n").join("\n    ")}`);
    return refused(`${plural(r.diagnostics.length, "error")} in the script`);
  }
  if (r.tests?.failed) {
    for (const f of r.tests.failures) lines.push(`${mark.error} ${f.name}${f.file ? pc.dim(`  ${f.file}:${f.line}`) : ""}`, `    ${f.message}`);
    return refused(`${plural(r.tests.failed, "test")} failed, ${r.tests.passed} passed`);
  }
  for (const w of r.warnings) lines.push(`${mark.warn} ${w}`);
  const block = r.block && r.block.count ? pc.dim(` → #${r.block.start + 1}–#${r.block.start + r.block.count}`) : "";
  const parts = [
    `${plural(r.triggerCount, "trigger")}${block}`,
    r.programs ? `${plural(r.programs, "program")} ${pc.dim("(Remastered)")}` : null,
    r.sounds ? plural(r.sounds, "sound") : null,
    r.tests ? `${plural(r.tests.passed, "test")} passed${r.tests.skipped ? pc.dim(`, ${r.tests.skipped} skipped`) : ""}` : r.testCount ? pc.dim(`${plural(r.testCount, "test")} not run`) : null,
    r.written ? `written to ${pc.cyan(r.written.path)}${dot}${size(r.written.bytes)}` : "compiles, nothing written",
  ].filter((p): p is string => !!p);
  lines.push(`${mark.ok} ${pc.bold(name)}: ${parts.join(dot)}${pc.dim(`  TrigScript ${r.trigscript}, TypeScript ${r.typescript}`)}`);
  return lines;
}
