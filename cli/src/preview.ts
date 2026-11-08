/**
 * `scmjs map preview`: a picture of a map, drawn with the game's own tileset graphics from the player's copy of the
 * game (gamefiles.ts), with the units, resources and start locations over it.
 *
 * The top half is pure — a map and the decoded graphics in, RGBA pixels and the marks drawn out, then PNG bytes — so
 * anything that wants the picture (the MCP server, a test) calls `mapPicture` / `previewPng` without the terminal.
 * The terminal's forms (colour half blocks, ASCII shades, an inline image) are paint.ts; the command is at the end.
 *
 * Terrain is drawn megatile by megatile into a plain buffer as `formats/tileset/preview.ts` does for the New Scenario
 * dialog, each megatile reduced once to the scale asked (`32 / scale` source pixels averaged per output pixel) and
 * reused. Marks are the game's minimap dots: a box of the unit's placement size from units.dat in its owner's colour,
 * at least a pixel; mineral fields and geysers in their own colours; start locations as a framed box in the slot's
 * colour, numbered in the terminal.
 */
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { displayColorHex } from "../../src/data/players";
import { TILESETS } from "../../src/data/tilesets";
import { START_LOCATION } from "../../src/data/units";
import type { OpenedMap } from "../../src/editor/mapFile";
import { MINERAL_FIELD_IDS, unitGeometry, VESPENE_GEYSER } from "../../src/editor/units";
import type { UnitsDat } from "../../src/formats/dat/dat";
import { scenarioName, tilesetIndex, type Scenario } from "../../src/formats/chk/scenario";
import { drawMegatile, megatileForTile, MEGATILE_PX, type Tileset } from "../../src/formats/tileset/decode";
import { writeOutput, type Written } from "./exchange";
import { STDIO, type Input } from "./files";
import { openGameFiles, readTileset, readUnitsDat, type GameFiles } from "./gamefiles";
import { asciiShades, halfBlocks, inlineImage, inlineProtocol, legendLine, type Depth, type InlineProtocol } from "./paint";
import { encodePng } from "./png";
import { CliError, dot, gameText, mark, num, pc, plural, size, truecolor, unicode } from "./ui";

/** RGBA, `width × height × 4` bytes, row by row. */
export interface Picture { width: number; height: number; pixels: Uint8Array }

/** The pixels a tile a PNG can have: the megatile's 32 halved until it is one. */
export const PNG_SCALES = [1, 2, 4, 8, 16, 32] as const;
export const DEFAULT_PNG_SCALE = 4;

/** What the picture is drawn with, read from the copy of the game. */
export interface GameGraphics {
  /** The tileset's graphics; null draws the ground plain (`plainBlock`), for a computer without the game. */
  tileset: Tileset | null;
  /** For the units' sizes; without it each unit is a tile. */
  units: UnitsDat | null;
}

export type MarkKind = "start" | "building" | "unit" | "mineral" | "geyser";

/** Something drawn over the terrain: a box in picture pixels (`x1`, `y1` exclusive), its colour, and for a start location its number. */
export interface Mark { kind: MarkKind; owner: number; color: string; x0: number; y0: number; x1: number; y1: number; label?: string }

export interface MarkCounts { starts: number; buildings: number; units: number; minerals: number; geysers: number }

export interface MapPicture {
  picture: Picture;
  /** Picture pixels a tile (a fraction where the picture was fitted to a width). */
  scale: number;
  marks: Mark[];
  counts: MarkCounts;
}

export interface PictureOptions {
  /** Pixels a tile, one of `PNG_SCALES`; or */
  scale?: number;
  /** the picture's width in pixels, the height following the map's shape. */
  width?: number;
  /** Units, resources and start locations over the terrain (the default). */
  marks?: boolean;
}

export const MINERAL_COLOR = "#5fd7ff";
export const GEYSER_COLOR = "#3ddc84";
const VOID: [number, number, number] = [0, 0, 0];

/**
 * A tile's colour without the game's graphics: a grey for its tile group (the id's top twelve bits), the same for every
 * tile of a group, so cliffs, ramps, water and doodads read as patches of their own. Used where no copy of the game is
 * (a CI runner): `map diff --picture` still shows where a map changed.
 */
export function plainShade(tile: number): [number, number, number] {
  if (!tile) return VOID;
  let h = Math.imul((tile >>> 4) ^ 0x9e37, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) ^ (h >>> 16);
  const v = 80 + ((h >>> 0) % 40);
  return [v, v, Math.min(255, v + 10)];
}

/** The terrain alone at `scale` pixels a tile (one of `PNG_SCALES`); an id with no megatile is black, as the editor draws it. */
export function terrainPicture(scn: Scenario, tileset: Tileset | null, scale: number): Picture {
  if (!(PNG_SCALES as readonly number[]).includes(scale)) throw new Error(`terrainPicture: scale ${scale} is not one of ${PNG_SCALES.join(", ")}`);
  const width = scn.width * scale, height = scn.height * scale;
  const pixels = new Uint8Array(width * height * 4);
  if (!tileset) {
    for (let ty = 0; ty < scn.height; ty++) {
      for (let tx = 0; tx < scn.width; tx++) {
        const [r, g, b] = plainShade(scn.tiles[ty * scn.width + tx] ?? 0);
        for (let y = 0; y < scale; y++) {
          for (let x = 0, o = ((ty * scale + y) * width + tx * scale) * 4; x < scale; x++, o += 4) { pixels[o] = r; pixels[o + 1] = g; pixels[o + 2] = b; pixels[o + 3] = 255; }
        }
      }
    }
    return { width, height, pixels };
  }
  const step = MEGATILE_PX / scale;
  const blocks = new Map<number, Uint8Array>();
  const whole = new Uint8Array(MEGATILE_PX * MEGATILE_PX * 4);
  const blockOf = (megatile: number): Uint8Array => {
    let block = blocks.get(megatile);
    if (block) return block;
    drawMegatile(tileset, megatile, whole, MEGATILE_PX, 0, 0);
    block = new Uint8Array(scale * scale * 4);
    const n = step * step;
    for (let by = 0; by < scale; by++) {
      for (let bx = 0; bx < scale; bx++) {
        let r = 0, g = 0, b = 0;
        for (let y = by * step; y < (by + 1) * step; y++) {
          for (let x = bx * step, at = (y * MEGATILE_PX + x) * 4; x < (bx + 1) * step; x++, at += 4) { r += whole[at]; g += whole[at + 1]; b += whole[at + 2]; }
        }
        const o = (by * scale + bx) * 4;
        block[o] = Math.round(r / n); block[o + 1] = Math.round(g / n); block[o + 2] = Math.round(b / n); block[o + 3] = 255;
      }
    }
    blocks.set(megatile, block);
    return block;
  };
  for (let ty = 0; ty < scn.height; ty++) {
    for (let tx = 0; tx < scn.width; tx++) {
      const megatile = megatileForTile(tileset, scn.tiles[ty * scn.width + tx] ?? 0);
      const block = megatile < 0 ? null : blockOf(megatile);
      for (let y = 0; y < scale; y++) {
        const o = ((ty * scale + y) * width + tx * scale) * 4;
        if (block) pixels.set(block.subarray(y * scale * 4, (y + 1) * scale * 4), o);
        else for (let x = 0; x < scale; x++) { pixels[o + x * 4] = VOID[0]; pixels[o + x * 4 + 1] = VOID[1]; pixels[o + x * 4 + 2] = VOID[2]; pixels[o + x * 4 + 3] = 255; }
      }
    }
  }
  return { width, height, pixels };
}

/** For each output index along one axis, the source indices it covers and how much of each. */
function spans(from: number, to: number): { first: number; weights: number[] }[] {
  const ratio = from / to;
  return Array.from({ length: to }, (_, i) => {
    const s0 = i * ratio, s1 = (i + 1) * ratio;
    const first = Math.floor(s0), weights: number[] = [];
    for (let s = first; s < Math.min(from, Math.ceil(s1)); s++) weights.push((Math.min(s + 1, s1) - Math.max(s, s0)) / ratio);
    return { first, weights };
  });
}

/** The picture at another size, each output pixel the average of the area it covers (for reducing; it also enlarges). */
export function resizePicture(src: Picture, width: number, height: number): Picture {
  if (src.width === width && src.height === height) return src;
  const xs = spans(src.width, width), ys = spans(src.height, height);
  const mid = new Float32Array(width * src.height * 3);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < width; x++) {
      const { first, weights } = xs[x];
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < weights.length; k++) { const at = (y * src.width + first + k) * 4, w = weights[k]; r += src.pixels[at] * w; g += src.pixels[at + 1] * w; b += src.pixels[at + 2] * w; }
      const o = (y * width + x) * 3;
      mid[o] = r; mid[o + 1] = g; mid[o + 2] = b;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const { first, weights } = ys[y];
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0;
      for (let k = 0; k < weights.length; k++) { const at = ((first + k) * width + x) * 3, w = weights[k]; r += mid[at] * w; g += mid[at + 1] * w; b += mid[at + 2] * w; }
      const o = (y * width + x) * 4;
      pixels[o] = Math.round(r); pixels[o + 1] = Math.round(g); pixels[o + 2] = Math.round(b); pixels[o + 3] = 255;
    }
  }
  return { width, height, pixels };
}

const MINERALS = new Set<number>(MINERAL_FIELD_IDS);
/** Bigger first, so a small unit beside a building stays in sight; start locations last, over everything. */
const ORDER: Record<MarkKind, number> = { mineral: 0, geyser: 0, building: 1, unit: 2, start: 3 };

/**
 * Where each unit goes on a picture of `factor` picture pixels a map pixel: its placement box (units.dat) centred on
 * it, at least a pixel, inside the picture. Start locations are boxes of their own size (a command centre's).
 */
export function placeMarks(scn: Scenario, units: UnitsDat | null, factor: number, width: number, height: number): Mark[] {
  const out: (Mark & { area: number })[] = [];
  for (const u of scn.units) {
    const g = unitGeometry(units, u.unitId);
    const kind: MarkKind = u.unitId === START_LOCATION ? "start" : MINERALS.has(u.unitId) ? "mineral" : u.unitId === VESPENE_GEYSER ? "geyser" : g.building ? "building" : "unit";
    const pw = Math.max(1, Math.round(g.placeW * factor)), ph = Math.max(1, Math.round(g.placeH * factor));
    const x0 = Math.max(0, Math.min(width - 1, Math.round(u.x * factor - pw / 2)));
    const y0 = Math.max(0, Math.min(height - 1, Math.round(u.y * factor - ph / 2)));
    const color = kind === "mineral" ? MINERAL_COLOR : kind === "geyser" ? GEYSER_COLOR : displayColorHex(scn.playerColors, scn.playerRgb, u.owner);
    out.push({ kind, owner: u.owner, color, x0, y0, x1: Math.min(width, x0 + pw), y1: Math.min(height, y0 + ph), area: pw * ph, ...(kind === "start" ? { label: String((u.owner + 1) % 10) } : {}) });
  }
  out.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || b.area - a.area);
  return out.map(({ area: _area, ...m }) => m);
}

export function countMarks(marks: Mark[]): MarkCounts {
  const c: MarkCounts = { starts: 0, buildings: 0, units: 0, minerals: 0, geysers: 0 };
  for (const m of marks) c[m.kind === "start" ? "starts" : m.kind === "building" ? "buildings" : m.kind === "unit" ? "units" : m.kind === "mineral" ? "minerals" : "geysers"]++;
  return c;
}

const rgbOf = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/**
 * The marks painted in: a unit's box solid; a start location's framed and its inside tinted where it is big enough
 * to have an inside (four pixels or more each way), solid otherwise.
 */
export function drawMarks(pic: Picture, marks: Mark[]): void {
  const { width, pixels } = pic;
  const put = (x: number, y: number, [r, g, b]: [number, number, number], a = 1) => {
    const at = (y * width + x) * 4;
    pixels[at] = Math.round(pixels[at] * (1 - a) + r * a);
    pixels[at + 1] = Math.round(pixels[at + 1] * (1 - a) + g * a);
    pixels[at + 2] = Math.round(pixels[at + 2] * (1 - a) + b * a);
    pixels[at + 3] = 255;
  };
  for (const m of marks) {
    const c = rgbOf(m.color);
    const w = m.x1 - m.x0, h = m.y1 - m.y0;
    const framed = m.kind === "start" && w >= 4 && h >= 4;
    const edge = framed ? Math.max(1, Math.round(Math.min(w, h) / 8)) : 0;
    for (let y = m.y0; y < m.y1; y++) {
      for (let x = m.x0; x < m.x1; x++) {
        const inside = framed && x - m.x0 >= edge && m.x1 - 1 - x >= edge && y - m.y0 >= edge && m.y1 - 1 - y >= edge;
        put(x, y, c, inside ? 0.3 : 1);
      }
    }
  }
}

/** The smallest PNG scale with at least `perTile` pixels a tile (32 at most). */
const scaleFor = (perTile: number): number => PNG_SCALES.find((s) => s >= perTile) ?? 32;

/**
 * The map's picture: the terrain at a PNG scale, or fitted to a width (drawn at the next scale up and reduced), then
 * the marks. Pure: the map and the graphics in, pixels out.
 */
export function mapPicture(map: OpenedMap | Scenario, graphics: GameGraphics, options: PictureOptions = {}): MapPicture {
  const scn = "scenario" in map ? map.scenario : map;
  let picture: Picture;
  if (options.width !== undefined) {
    const width = Math.max(1, Math.round(options.width));
    const height = Math.max(1, Math.round((width * scn.height) / scn.width));
    picture = resizePicture(terrainPicture(scn, graphics.tileset, scaleFor(width / scn.width)), width, height);
  } else {
    picture = terrainPicture(scn, graphics.tileset, options.scale ?? DEFAULT_PNG_SCALE);
  }
  const scale = picture.width / scn.width;
  const marks = options.marks === false ? [] : placeMarks(scn, graphics.units, scale / MEGATILE_PX, picture.width, picture.height);
  drawMarks(picture, marks);
  return { picture, scale, marks, counts: countMarks(marks) };
}

/** The map as PNG bytes at `scale` pixels a tile — what `--out` writes, and what a tool returning an image wants. */
export function previewPng(map: OpenedMap | Scenario, graphics: GameGraphics, options: PictureOptions = {}): { png: Uint8Array } & MapPicture {
  const drawn = mapPicture(map, graphics, options);
  return { png: encodePng(drawn.picture.pixels, drawn.picture.width, drawn.picture.height), ...drawn };
}

/** The tileset's name (`jungle`) for a map. */
export const tilesetOf = (scn: Scenario): string => TILESETS[tilesetIndex(scn)]?.id ?? "badlands";

/** The graphics a map's picture needs, out of the copy of the game: its tileset only, and units.dat. */
export async function loadGraphics(scn: Scenario, files: GameFiles): Promise<GameGraphics> {
  const [tileset, units] = await Promise.all([readTileset(files, tilesetOf(scn)), readUnitsDat(files)]);
  return { tileset, units };
}

/* ── The command ─────────────────────────────────────────────── */

export type PreviewForm = "png" | "blocks" | "ascii" | InlineProtocol;

export interface PreviewOptions {
  out?: string;
  scale?: string;
  width?: string;
  units?: boolean;
  blocks?: boolean;
  json?: boolean;
  starcraft?: string;
}

export interface PreviewReport {
  file: string;
  name: string;
  size: { width: number; height: number };
  tileset: string;
  copy: { folder: string; kind: "remastered" | "classic"; label: string };
  picture: { form: PreviewForm; width: number; height: number; scale: number; columns?: number; rows?: number; depth?: Depth };
  drawn: MarkCounts;
  out?: Written;
  ms: { copy: number; draw: number; total: number };
}

/** Where the terminal is: its columns, what colour it takes, whether it can draw a picture itself. */
export interface TerminalInfo { columns: number; depth: Depth; unicode: boolean; inline: InlineProtocol | null }

export function terminalInfo(stream: { isTTY?: boolean; columns?: number } = process.stdout, env = process.env): TerminalInfo {
  return {
    columns: stream.isTTY && stream.columns ? stream.columns : 80,
    depth: truecolor ? "truecolor" : pc.isColorSupported ? "256" : "none",
    unicode,
    inline: inlineProtocol(env, !!stream.isTTY),
  };
}

/**
 * The picture's width in the terminal, in columns (a column is one picture pixel wide; a row two high): `--width`,
 * else `--scale` pixels a tile, else what fits the terminal — within its columns, at most two a tile, and no taller
 * in rows than half as many as it is wide in columns, so a tall map does not run off the screen.
 */
export function terminalWidth(mapW: number, mapH: number, columns: number, o: { width?: number; scale?: number } = {}): number {
  if (o.width) return Math.max(1, Math.round(o.width));
  if (o.scale) return Math.max(1, Math.round(mapW * o.scale));
  const room = Math.max(8, columns - 1);
  return Math.max(1, Math.floor(Math.min(room, mapW * 2, (room * mapW) / mapH)));
}

const positive = (value: string | undefined, name: string, check: (n: number) => boolean, hint: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !check(n)) throw new CliError(`--${name} takes ${hint}, not "${value}"`, null, 2);
  return n;
};

/**
 * `scmjs map preview`: the copy of the game opened, the map's tileset read, the picture drawn and written as a PNG
 * (`--out`), sent to the terminal, or described (`--json`). `say` is where the command's own words go (standard error
 * while the PNG takes standard output).
 */
export async function previewMap(input: Input, map: OpenedMap, o: PreviewOptions, term: TerminalInfo = terminalInfo(), stdout: Writable = process.stdout): Promise<{ report: PreviewReport; lines: string[] }> {
  const t0 = performance.now();
  const scn = map.scenario;
  const png = o.out !== undefined;
  if (png && o.width !== undefined) throw new CliError("--width is the terminal picture's; a PNG's size is --scale pixels a tile", null, 2);
  if (o.width !== undefined && o.scale !== undefined) throw new CliError("--width or --scale, not both", null, 2);
  const scale = positive(o.scale, "scale", png ? (n) => (PNG_SCALES as readonly number[]).includes(n) : (n) => n > 0 && n <= 32, png ? PNG_SCALES.join(", ") : "a number of pixels a tile, above 0 and up to 32");
  const width = positive(o.width, "width", (n) => Number.isInteger(n) && n >= 8, "a number of columns, 8 or more");
  const marks = o.units !== false;

  const files = await openGameFiles(o.starcraft);
  const graphics = await loadGraphics(scn, files);
  const t1 = performance.now();

  const base = {
    file: input.path, name: gameText(scenarioName(scn) ?? "") || input.name, size: { width: scn.width, height: scn.height }, tileset: tilesetOf(scn),
    copy: { folder: files.folder, kind: files.kind, label: files.label },
  };
  const ms = (t2: number) => ({ copy: Math.round(t1 - t0), draw: Math.round(t2 - t1), total: Math.round(performance.now() - t0) });

  if (png) {
    const drawn = previewPng(map, graphics, { scale: scale ?? DEFAULT_PNG_SCALE, marks });
    const out = await writeOutput(drawn.png, o.out!, stdout);
    const report: PreviewReport = { ...base, picture: { form: "png", width: drawn.picture.width, height: drawn.picture.height, scale: drawn.scale }, drawn: drawn.counts, out, ms: ms(performance.now()) };
    return { report, lines: [
      `${mark.ok} ${pc.bold(report.name)}: ${drawn.picture.width} × ${drawn.picture.height} PNG, ${plural(drawn.scale, "pixel")} a tile, ${report.tileset}${marks ? `${dot}${drawnText(drawn.counts)}` : ""}${dot}written to ${out.path === STDIO ? "standard output" : pc.cyan(out.path)}${dot}${size(out.bytes)}`,
      pc.dim(`  drawn from ${files.label} in ${files.folder}${dot}${(report.ms.total / 1000).toFixed(1)} s`),
    ] };
  }

  // The terminal: the picture itself where the terminal can show one, else colour blocks, else shades.
  const inline = !o.blocks && !o.json ? term.inline : null;
  if (inline) {
    const columns = width ?? Math.max(8, term.columns - 1);
    const drawn = previewPng(map, graphics, { scale: scale && (PNG_SCALES as readonly number[]).includes(scale) ? scale : scaleFor((columns * 8) / scn.width), marks });
    const report: PreviewReport = { ...base, picture: { form: inline, width: drawn.picture.width, height: drawn.picture.height, scale: drawn.scale, columns }, drawn: drawn.counts, ms: ms(performance.now()) };
    return { report, lines: [title(report, files), inlineImage(drawn.png, inline, columns), ...(drawn.marks.length ? [legendLine(drawn.marks, term.depth, term.unicode)] : [])] };
  }
  const columns = terminalWidth(scn.width, scn.height, term.columns, { width, scale });
  const drawn = mapPicture(map, graphics, { width: columns, marks });
  const form: PreviewForm = term.unicode && term.depth !== "none" ? "blocks" : "ascii";
  const picture = form === "blocks" ? halfBlocks(drawn.picture, drawn.marks, term.depth as Exclude<Depth, "none">) : asciiShades(drawn.picture, drawn.marks, term.depth);
  const report: PreviewReport = {
    ...base, picture: { form, width: drawn.picture.width, height: drawn.picture.height, scale: Number(drawn.scale.toFixed(3)), columns, rows: picture.length, depth: term.depth },
    drawn: drawn.counts, ms: ms(performance.now()),
  };
  return { report, lines: o.json ? [] : [title(report, files), ...picture, ...(drawn.marks.length ? [legendLine(drawn.marks, term.depth, term.unicode)] : [])] };
}

function drawnText(c: MarkCounts): string {
  const resources = c.minerals + c.geysers;
  return [plural(c.starts, "start location"), plural(c.units + c.buildings, "unit"), plural(resources, "resource")].join(", ");
}

function title(r: PreviewReport, files: GameFiles): string {
  return `${pc.bold(r.name)}  ${pc.dim(`${num(r.size.width)} × ${num(r.size.height)}${dot}${r.tileset}${dot}${files.label}`)}`;
}
