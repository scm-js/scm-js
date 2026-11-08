/**
 * The `scmjs map generate` command around `generate.ts`: the options read, the tileset's graphics read from the
 * player's copy of the game (as `map preview` reads them), the map written as the editor saves a new one, and the
 * summary — each player's resources, the ground distances between the starts, and how far equal pairs are apart.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { writeMapBytes } from "../../src/editor/mapFile";
import { defaultSaveOptions, formatOf, type MapFormat } from "../../src/editor/save";
import { loadTileset } from "../../src/formats/tileset/decode";
import { buildDoodadCatalogue } from "../../src/formats/tileset/doodads";
import { MAP_SIZES, TILESETS, type TilesetId } from "../../src/data/tilesets";
import { parseSize, parseTileset } from "./create";
import { writeOutput } from "./exchange";
import { STDIO } from "./files";
import { openGameFiles, readTileset } from "./gamefiles";
import {
  BALANCE_TOLERANCE, defaultSymmetry, GEN_PLAYERS, GEN_STYLES, GEN_SYMMETRIES, generateMap, LayoutError, recipeOf, resolveSymmetry, smallestSide,
  type GenerateOptions, type Generated, type GenSymmetry, type GenStyle, type Graphics,
} from "./generate";
import { msg, t, translate } from "./i18n";
import { CliError, dot, mark, num, pc, rows, size, table } from "./ui";

export interface GenerateFlags {
  players?: string;
  size?: string;
  tileset?: string;
  seed?: string;
  symmetry?: string;
  style?: string;
  name?: string;
  starcraft?: string;
  /** A folder of extracted tilesets (`<name>.cv5`, `<name>.dddata.bin`, …), as the editor's `public/tileset`; hidden. */
  tilesets?: string;
}

/** The options a command line asks for, checked; every refusal exits 2. */
export function generateOptions(f: GenerateFlags, random: () => number = Math.random): GenerateOptions {
  const players = Number(f.players ?? 2);
  if (!(GEN_PLAYERS as readonly number[]).includes(players)) throw new CliError(t("--players takes {list}, not \"{value}\"", { list: GEN_PLAYERS.join(", "), value: String(f.players) }), null, 2);
  const least = smallestSide(players);
  const { width, height } = parseSize(f.size ?? (least > 128 ? `${least}x${least}` : "128x128"));
  if (Math.min(width, height) < least) {
    throw new CliError(t("{width} × {height} is too small for {players} players", { width, height, players }), t("Each side {least} or more ({list}).", { least, list: (MAP_SIZES as readonly number[]).filter((n) => n >= least).join(", ") }), 2);
  }
  const tileset = parseTileset(f.tileset ?? "jungle");
  try { recipeOf(tileset); } catch (e) { throw new CliError((e as Error).message, t("One of {list}.", { list: TILESETS.filter((ts) => ts.id !== "install").map((ts) => ts.id).join(", ") }), 2); }
  const symmetry = (f.symmetry ?? defaultSymmetry(players, width, height)) as GenSymmetry;
  if (!(GEN_SYMMETRIES as readonly string[]).includes(symmetry)) throw new CliError(t("--symmetry takes {list}, not \"{value}\"", { list: GEN_SYMMETRIES.join(", "), value: String(f.symmetry) }), null, 2);
  const resolved = resolveSymmetry(players, symmetry, width, height);
  if ("problem" in resolved) throw new CliError(t("No {symmetry} layout here: {problem}", { symmetry, problem: resolved.problem }), null, 2);
  const style = (f.style ?? "open") as GenStyle;
  if (!(GEN_STYLES as readonly string[]).includes(style)) throw new CliError(t("--style takes {list}, not \"{value}\"", { list: GEN_STYLES.join(" or "), value: String(f.style) }), null, 2);
  let seed: number;
  if (f.seed === undefined) seed = Math.floor(random() * 1_000_000_000);
  else {
    seed = Number(f.seed);
    if (!/^\d+$/.test(f.seed.trim()) || !Number.isSafeInteger(seed) || seed > 0xffffffff) throw new CliError(t("--seed takes a whole number from 0 to 4294967295, not \"{value}\"", { value: f.seed }), null, 2);
  }
  return { width, height, players, tileset, seed, symmetry, style };
}

/** The tileset's graphics and doodads: from a folder of extracted tilesets, else from the copy of the game. */
export async function readGraphics(tileset: TilesetId, f: Pick<GenerateFlags, "starcraft" | "tilesets">): Promise<{ graphics: Graphics; from: string }> {
  if (f.tilesets) {
    const part = async (ext: string) => { try { return new Uint8Array(await readFile(join(f.tilesets!, `${tileset}.${ext}`))); } catch { return null; } };
    const [cv5, vf4, vr4, wpe, vx4, dddata] = await Promise.all(["cv5", "vf4", "vr4", "wpe", "vx4", "dddata.bin"].map(part));
    if (!cv5 || !vf4 || !vr4 || !wpe || !vx4 || !dddata) throw new CliError(t("{folder} has no complete {tileset} tileset", { folder: f.tilesets, tileset }), t("It needs the .cv5, .vf4, .vr4, .wpe, .vx4 and .dddata.bin the editor's extraction writes."), 2);
    const ts = loadTileset({ cv5, vf4, vr4, wpe, vx4, vx4Extended: false });
    return { graphics: { tileset: ts, doodads: buildDoodadCatalogue(ts, dddata, null) }, from: f.tilesets };
  }
  const files = await openGameFiles(f.starcraft, t("The ground is laid with your installation's tileset (its terrain table and its ramps)"));
  const ts = await readTileset(files, tileset);
  const dddata = await files.read(`tileset\\${tileset}\\dddata.bin`);
  if (!dddata) throw new CliError(t("{label} in {folder} has no {tileset}\\dddata.bin, where the ramps are described.", { label: files.label, folder: files.folder, tileset }), t("The copy may be incomplete; name another with --starcraft."));
  return { graphics: { tileset: ts, doodads: buildDoodadCatalogue(ts, dddata, null) }, from: `${files.label}` };
}

const SYMMETRY_WORDS: Record<string, string> = { rot180: msg("turned 180°"), h: msg("mirrored left to right"), v: msg("mirrored top to bottom"), hv: msg("mirrored both ways"), diag: msg("mirrored on the diagonal") };

/** What a generated map is, for `--json` and for the summary. */
export function generateReport(g: Generated, written: { path: string; bytes: number }, name: string, from: string) {
  const { options: o, built, measure, plan } = g;
  const tiles = (px: number) => Math.round(px / 32);
  return {
    path: written.path,
    bytes: written.bytes,
    name,
    width: o.width,
    height: o.height,
    tileset: TILESETS.find((t) => t.id === o.tileset)!.name,
    players: o.players,
    symmetry: o.symmetry,
    laidOut: translate(SYMMETRY_WORDS[plan.mode] ?? plan.mode),
    style: o.style,
    seed: o.seed,
    /** The inner seed the kept layout came from, how many were tried, and why the others were not kept. */
    layout: { attempt: g.attempt + 1, innerSeed: g.innerSeed, tried: g.tried, rejected: g.rejected },
    graphics: from,
    balanced: measure.spread <= BALANCE_TOLERANCE,
    /** The largest difference between ground distances the symmetry makes equal, as a share of the shorter. */
    spread: Math.round(measure.spread * 10000) / 10000,
    /** The same, for start to start alone and for the walks to the free bases alone. */
    startSpread: Math.round(measure.startSpread * 10000) / 10000,
    freeSpread: Math.round(measure.freeSpread * 10000) / 10000,
    /** How many pairs of walks each was measured over; 0 start to start for two players, whose one pair is its own image. */
    compared: measure.compared,
    check: { errors: measure.issues.filter((i) => i.level === "error").length, warnings: measure.issues.filter((i) => i.level === "warn").map((i) => i.text) },
    starts: measure.starts.map((s) => ({
      player: s.owner + 1,
      x: s.x, y: s.y,
      minerals: s.minerals, mineralFields: s.mineralFields, gas: s.gas, geysers: s.geysers,
      /** Pixels on foot to each player's start, by player; null where no ground joins them. */
      ground: Object.fromEntries(measure.starts.map((t, j) => [String(t.owner + 1), s.ground[j] === null ? null : Math.round(s.ground[j]!)]).filter(([p]) => p !== String(s.owner + 1))),
      air: Object.fromEntries(measure.starts.map((t, j) => [String(t.owner + 1), Math.round(s.air[j])]).filter(([p]) => p !== String(s.owner + 1))),
      /** Pixels on foot to the middle of the map, and to each free base's town hall (nearest first). */
      toMiddle: s.toMiddle === null ? null : Math.round(s.toMiddle),
      toFree: s.toFree.map(Math.round),
    })),
    bases: built.bases.map((b) => ({ kind: b.kind, player: b.owner >= 0 ? b.owner + 1 : null, x: tiles(b.hall.x * 32 + 64), y: tiles(b.hall.y * 32 + 48), mineralFields: b.minerals, minerals: b.mineralTotal, geysers: b.geysers, gas: b.gasTotal })),
    ramps: built.ramps.length,
  };
}

export type GenerateReport = ReturnType<typeof generateReport>;

/** The balance line: what was compared and how far apart it came out; only the parts that had something to compare. */
function balanceText(r: GenerateReport): string {
  const share = (n: number) => (r.balanced ? `${(n * 100).toFixed(1)}%` : pc.yellow(`${(n * 100).toFixed(1)}%`));
  const parts = [
    r.compared.starts ? t("{share} start to start", { share: share(r.startSpread) }) : null,
    r.compared.free ? t("{share} to the free bases", { share: share(r.freeSpread) }) : null,
  ].filter(Boolean);
  if (!parts.length) return t("nothing the symmetry makes equal to compare");
  return `${r.balanced ? "" : `${pc.yellow(t("unbalanced"))}: `}${t("walks the symmetry makes equal differ by {parts}", { parts: parts.join(", ") })}`;
}

/** The summary as the terminal shows it. */
export function printGenerated(r: GenerateReport, shown: string): string[] {
  const free = r.bases.filter((b) => b.kind === "free").length;
  const head = `${r.balanced ? mark.ok : mark.warn} ${pc.bold(shown)}: ${r.width} × ${r.height}${dot}${translate(r.tileset)}${dot}${t("{n, plural, one {# player} other {# players}}", { n: r.players })}${dot}${t("seed {seed}", { seed: r.seed })}${dot}${size(r.bytes)}`;
  const own = (s: GenerateReport["starts"][number]) => r.bases.filter((b) => b.player === s.player);
  const baseText = (b: GenerateReport["bases"][number] | undefined) => (b ? t("{fields} × {each} + {geysers, plural, one {# geyser} other {# geysers}}", { fields: b.mineralFields, each: num(b.minerals / Math.max(1, b.mineralFields)), geysers: b.geysers }) : "–");
  const resources = table([
    [t("Player"), t("Main"), t("Natural"), t("Minerals"), t("Gas"), t("To the middle")].map((h) => pc.dim(h)),
    ...r.starts.map((s) => [String(s.player), baseText(own(s).find((b) => b.kind === "main")), baseText(own(s).find((b) => b.kind === "natural")), num(s.minerals), num(s.gas), s.toMiddle === null ? "–" : t("{n} tiles", { n: num(Math.round(s.toMiddle / 32)) })]),
  ]);
  const players = r.starts.map((s) => s.player);
  const cell = (s: GenerateReport["starts"][number], p: number) => {
    if (p === s.player) return pc.dim("–");
    const d = s.ground[String(p)];
    return d === null ? pc.red(t("none")) : `${num(Math.round(d / 32))} ${pc.dim(`(${num(Math.round(s.air[String(p)] / 32))})`)}`;
  };
  const distances = table([["", ...players.map((p) => pc.dim(`P${p}`))], ...r.starts.map((s) => [pc.dim(`P${s.player}`), ...players.map((p) => cell(s, p))])]);
  return [
    head,
    ...rows([
      [t("Laid out"), `${r.laidOut}${dot}${r.style}${dot}${t("{n, plural, one {# ramp} other {# ramps}}", { n: r.ramps })}${free ? `${dot}${t("{n, plural, one {# free base} other {# free bases}}", { n: free })}` : ""}`],
      [t("Balance"), balanceText(r)],
      [t("Check Map"), r.check.errors ? pc.red(t("{n, plural, one {# error} other {# errors}}", { n: r.check.errors })) : r.check.warnings.length ? t("no errors, {n, plural, one {# warning} other {# warnings}}", { n: r.check.warnings.length }) : t("no errors or warnings")],
      [t("Layout"), `${r.layout.tried === 1 ? t("the first layout tried") : t("layout {attempt} of the {tried} tried", { attempt: r.layout.attempt, tried: num(r.layout.tried) })}${dot}${r.graphics}`],
    ]),
    "",
    ...resources,
    "",
    `  ${pc.dim(t("Ground distance start to start, in tiles (a straight line in brackets)"))}`,
    ...distances,
  ];
}

/** The map's file form: the name's extension, `.scx` otherwise (a map with Brood War units and terrain). */
export const generatedFormat = (path: string): MapFormat => formatOf(path) ?? "scx";

/** Generate, write, and say so. `name` is the map's own name; `path` the file (or `-`). */
export async function runGenerate(path: string, f: GenerateFlags, name: string, random: () => number = Math.random) {
  const o = generateOptions(f, random);
  const { graphics, from } = await readGraphics(o.tileset, f);
  // The map's own description: map text, English in every language.
  const description = `Generated by scmjs map generate: seed ${o.seed}, ${o.players} players, ${o.symmetry}, ${o.style}.`;
  let g: Generated;
  try { g = generateMap(o, graphics, name, description); } catch (e) {
    if (e instanceof LayoutError) throw new CliError(t("No map came out of seed {seed}: {why}", { seed: o.seed, why: e.message }), t("Another --seed, a larger --size or --style open usually lays out."));
    throw e;
  }
  const { format: _f, ...save } = defaultSaveOptions(g.built.scenario, null, path === STDIO ? null : path);
  const bytes = await writeMapBytes(g.built.scenario, { format: generatedFormat(path), options: save });
  const written = await writeOutput(bytes, path);
  return { generated: g, report: generateReport(g, written, name, from) };
}
