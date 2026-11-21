/**
 * `scmjs map diff a.scx b.scx --picture`: the two maps drawn as `map preview` draws them, with what changed marked,
 * so a review of a map shows where it changed and not only what.
 *
 * The change picture is the second map's terrain, the unchanged ground darkened, every tile whose id differs tinted
 * magenta and the tiles only one of the maps has (a resize) striped; over it the units added (green), removed (red)
 * and moved or edited (yellow, with a frame where a moved unit was and a line from it), the locations that changed as outlines, and
 * the map's landmarks — start locations, mineral fields, geysers — as `map preview` draws them, in greys where its
 * colours would read as a change. Both maps are drawn at one scale on a canvas the size of the larger, so
 * `a | changes | b` line up side by side.
 *
 * The top half is pure, as preview.ts's is: two maps and the decoded graphics in, RGBA and counts out
 * (`changePicture`, `sideBySide`), for the MCP server or a test. The command is at the end.
 */
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import type { OpenedMap } from "../../src/editor/mapFile";
import { unitGeometry } from "../../src/editor/units";
import type { UnitsDat } from "../../src/formats/dat/dat";
import { tilesetIndex, type Scenario } from "../../src/formats/chk/scenario";
import { ANYWHERE_INDEX, type LocationRecord } from "../../src/formats/chk/sections/objects";
import { MEGATILE_PX } from "../../src/formats/tileset/decode";
import { anyChange, diffChanges, TILE_KIND, type Change, type DiffChanges, type DiffCounts, type TileBox, type UnitDifference } from "../../src/editor/compare";
import { writeOutput, type Written } from "./exchange";
import { STDIO, type Input } from "./files";
import { openGameFiles, type GameFiles } from "./gamefiles";
import { asciiShades, halfBlocks, inlineImage, sgr, type Depth, type InlineProtocol } from "./paint";
import { encodePng } from "./png";
import {
  DEFAULT_PNG_SCALE, drawMarks, loadGraphics, mapPicture, placeMarks, PNG_SCALES, resizePicture, terminalInfo, terminalWidth, terrainPicture, tilesetOf,
  type GameGraphics, type Mark, type Picture, type TerminalInfo,
} from "./preview";
import { msg, t, translate } from "./i18n";
import { CliError, columns, dot, mark, num, pc, size } from "./ui";

/* ── What changed, without graphics: src/editor/compare.ts, which the editor draws from too ── */

export { anyChange, diffChanges, MOVE_RADIUS, unitChanges } from "../../src/editor/compare";
export type { DiffChanges, DiffCounts, LocationDifference as LocationChange, TileBox, UnitDifference as UnitChange } from "../../src/editor/compare";
type UnitChange = UnitDifference;
/** A tile on the canvas, as the comparison names it. */
export const TILE = TILE_KIND;
/** Slot 63 is Anywhere, the whole map: it changes with every resize and says nothing drawn round the edge. */
const ANYWHERE = ANYWHERE_INDEX;
/** A location's box, the right way round. */
const boxOf = (l: LocationRecord) => ({ left: Math.min(l.left, l.right), top: Math.min(l.top, l.bottom), right: Math.max(l.left, l.right), bottom: Math.max(l.top, l.bottom) });


/* ── The pictures ───────────────────────────────────────────── */

export const ADDED_COLOR = "#2ee65a";
export const REMOVED_COLOR = "#ff3b3b";
export const MOVED_COLOR = "#ffd21f";
export const TILE_COLOR = "#ff2bd6";
/** The stripes over tiles only one map has. */
export const RESIZED_COLOR = "#ffffff";
/** A geyser and a start location kept, on the change picture (preview's green, a slot's colour, would read as a change). */
export const GEYSER_LANDMARK = "#a3adb8";
export const START_LANDMARK = "#e6e6e6";
/** Between pictures side by side. */
export const GAP_COLOR = "#4a4a4a";
/** Where neither map has a tile. */
export const PAD_COLOR = "#141414";
/** How bright the ground that did not change is kept, so what did stands out. */
const DIM = 0.6;

type Rgb = [number, number, number];
const rgbOf = (hex: string): Rgb => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

/** A change drawn over the picture, in picture pixels (`x1`, `y1` exclusive). */
export interface ChangeMark {
  kind: "unit" | "location";
  change: Change | "moved";
  color: string;
  x0: number; y0: number; x1: number; y1: number;
  /** A location's outline width; a unit's box is filled. */
  outline?: number;
  /** A moved unit: from where it was to where it is, picture pixels. */
  line?: [number, number, number, number];
  /** A moved unit: the box it had, drawn as a frame. */
  was?: { x0: number; y0: number; x1: number; y1: number };
}

export interface ChangePicture {
  picture: Picture;
  /** Picture pixels a tile. */
  scale: number;
  /** The landmarks, as preview's marks: start locations (numbered in the terminal), mineral fields, geysers. */
  marks: Mark[];
  changes: ChangeMark[];
  diff: DiffChanges;
}

export interface DiffPictureOptions {
  /** Pixels a tile, one of `PNG_SCALES`; or */
  scale?: number;
  /** the picture's width in pixels, the height following the canvas's shape. */
  width?: number;
  /** How near a removed and an added unit must be to be one unit moved, map pixels. */
  radius?: number;
}

const scn = (m: OpenedMap | Scenario): Scenario => ("scenario" in m ? m.scenario : m);
const scaleFor = (perTile: number): number => PNG_SCALES.find((s) => s >= perTile) ?? 32;

function blank(width: number, height: number, hex = PAD_COLOR): Picture {
  const pixels = new Uint8Array(width * height * 4), [r, g, b] = rgbOf(hex);
  for (let at = 0; at < pixels.length; at += 4) { pixels[at] = r; pixels[at + 1] = g; pixels[at + 2] = b; pixels[at + 3] = 255; }
  return { width, height, pixels };
}

/** `src` copied onto `dst` with its top left at (x, y), cut to `dst`. */
function blit(dst: Picture, src: Picture, x: number, y: number): void {
  const w = Math.min(src.width, dst.width - x);
  if (w <= 0) return;
  for (let row = 0; row < src.height && y + row < dst.height; row++) {
    dst.pixels.set(src.pixels.subarray(row * src.width * 4, (row * src.width + w) * 4), ((y + row) * dst.width + x) * 4);
  }
}

function put(pic: Picture, x: number, y: number, [r, g, b]: Rgb, a = 1): void {
  if (x < 0 || y < 0 || x >= pic.width || y >= pic.height) return;
  const at = (y * pic.width + x) * 4, p = pic.pixels;
  p[at] = Math.round(p[at] * (1 - a) + r * a); p[at + 1] = Math.round(p[at + 1] * (1 - a) + g * a); p[at + 2] = Math.round(p[at + 2] * (1 - a) + b * a);
}

/** The terrain canvas at a whole scale: the second map's ground, the first's where only it has tiles, the changes tinted. */
function changeTerrain(a: Scenario, b: Scenario, d: DiffChanges, graphics: GameGraphics, s: number): Picture {
  const canvas = blank(d.width * s, d.height * s);
  blit(canvas, terrainPicture(b, graphics.tileset, s), 0, 0);
  if (a.width > b.width || a.height > b.height) {
    const ta = terrainPicture(a, graphics.tileset, s);
    for (let ty = 0; ty < a.height; ty++) {
      for (let tx = 0; tx < a.width; tx++) {
        if (d.tiles[ty * d.width + tx] !== TILE.aOnly) continue;
        for (let y = 0; y < s; y++) {
          const from = ((ty * s + y) * ta.width + tx * s) * 4;
          canvas.pixels.set(ta.pixels.subarray(from, from + s * 4), ((ty * s + y) * canvas.width + tx * s) * 4);
        }
      }
    }
  }
  const tint = rgbOf(TILE_COLOR), stripe = rgbOf(RESIZED_COLOR), black: Rgb = [0, 0, 0];
  const band = Math.max(2, s >> 1);
  for (let ty = 0; ty < d.height; ty++) {
    for (let tx = 0; tx < d.width; tx++) {
      const v = d.tiles[ty * d.width + tx];
      if (v === TILE.neither) continue;
      for (let y = ty * s; y < (ty + 1) * s; y++) {
        for (let x = tx * s; x < (tx + 1) * s; x++) {
          if (v === TILE.same) put(canvas, x, y, black, 1 - DIM);
          else if (v === TILE.changed) put(canvas, x, y, tint, 0.6);
          else put(canvas, x, y, Math.floor((x + y) / band) % 2 ? stripe : black, Math.floor((x + y) / band) % 2 ? 0.55 : 1 - DIM);
        }
      }
    }
  }
  return canvas;
}

/** The least a changed unit's box is each way, in map pixels: two tiles, so a marine is not lost on a large map. */
const CHANGE_MIN = 2 * MEGATILE_PX;

/** A changed unit's box on the picture: its placement size, at least `CHANGE_MIN`, centred on it and inside the picture. */
function unitBox(units: UnitsDat | null, unitId: number, x: number, y: number, factor: number, pic: Picture) {
  const g = unitGeometry(units, unitId);
  const w = Math.max(1, Math.round(Math.max(g.placeW, CHANGE_MIN) * factor)), h = Math.max(1, Math.round(Math.max(g.placeH, CHANGE_MIN) * factor));
  const x0 = Math.max(0, Math.min(pic.width - 1, Math.round(x * factor - w / 2))), y0 = Math.max(0, Math.min(pic.height - 1, Math.round(y * factor - h / 2)));
  return { x0, y0, x1: Math.min(pic.width, x0 + w), y1: Math.min(pic.height, y0 + h) };
}

/** Where each change goes on a picture of `factor` picture pixels a map pixel. */
function placeChanges(d: DiffChanges, units: UnitsDat | null, factor: number, pic: Picture): ChangeMark[] {
  const out: ChangeMark[] = [];
  const thin = Math.max(1, Math.round((factor * MEGATILE_PX) / 8));
  for (const l of d.locations) {
    if (l.index === ANYWHERE) continue;
    const rect = (r: LocationRecord, change: ChangeMark["change"], color: string): ChangeMark => {
      const bx = boxOf(r);
      const x0 = Math.max(0, Math.min(pic.width - 1, Math.round(bx.left * factor))), y0 = Math.max(0, Math.min(pic.height - 1, Math.round(bx.top * factor)));
      return { kind: "location", change, color, x0, y0, x1: Math.min(pic.width, Math.max(x0 + 1, Math.round(bx.right * factor))), y1: Math.min(pic.height, Math.max(y0 + 1, Math.round(bx.bottom * factor))), outline: thin };
    };
    if (l.change === "removed") out.push(rect(l.a!, "removed", REMOVED_COLOR));
    else if (l.change === "added") out.push(rect(l.b!, "added", ADDED_COLOR));
    else {
      // Where it was, in red, under where it is, in yellow.
      if (JSON.stringify(boxOf(l.a!)) !== JSON.stringify(boxOf(l.b!))) out.push(rect(l.a!, "removed", REMOVED_COLOR));
      out.push(rect(l.b!, "changed", MOVED_COLOR));
    }
  }
  // Removed under changed under moved under added: what is new on top.
  const order: Record<UnitChange["change"], number> = { removed: 0, changed: 1, moved: 2, added: 3 };
  const color: Record<UnitChange["change"], string> = { removed: REMOVED_COLOR, changed: MOVED_COLOR, moved: MOVED_COLOR, added: ADDED_COLOR };
  for (const u of [...d.units].sort((p, q) => order[p.change] - order[q.change])) {
    const box = unitBox(units, u.unitId, u.x, u.y, factor, pic);
    const c: ChangeMark = { kind: "unit", change: u.change, color: color[u.change], ...box };
    if (u.from) {
      // From the middle of the box it would have had to the middle of this one.
      const was = unitBox(units, u.unitId, u.from.x, u.from.y, factor, pic), mid = (p: number, q: number) => Math.floor((p + q - 1) / 2);
      c.line = [mid(was.x0, was.x1), mid(was.y0, was.y1), mid(box.x0, box.x1), mid(box.y0, box.y1)];
      c.was = was;
    }
    out.push(c);
  }
  return out;
}

/** The changes painted in: outlines for locations, a line for a moved unit, a filled box with a dark edge for a unit. */
export function drawChanges(pic: Picture, changes: ChangeMark[], scale: number): void {
  const dark: Rgb = [0, 0, 0];
  const lineWidth = Math.max(1, Math.round(scale / 8));
  for (const m of changes) {
    const c = rgbOf(m.color);
    if (m.kind === "location") {
      const t = m.outline ?? 1;
      for (let y = m.y0; y < m.y1; y++) {
        for (let x = m.x0; x < m.x1; x++) {
          if (x - m.x0 < t || m.x1 - 1 - x < t || y - m.y0 < t || m.y1 - 1 - y < t) put(pic, x, y, c, 0.9);
        }
      }
      continue;
    }
    if (m.was) {
      const f = m.was;
      for (let y = f.y0; y < f.y1; y++) for (let x = f.x0; x < f.x1; x++) {
        if (x - f.x0 < lineWidth || f.x1 - 1 - x < lineWidth || y - f.y0 < lineWidth || f.y1 - 1 - y < lineWidth) put(pic, x, y, c, 0.9);
      }
    }
    if (m.line) {
      const [x0, y0, x1, y1] = m.line;
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
      const half = lineWidth >> 1;
      for (let i = 0; i <= steps; i++) {
        const x = Math.round(x0 + ((x1 - x0) * i) / steps), y = Math.round(y0 + ((y1 - y0) * i) / steps);
        for (let dy = -half; dy < lineWidth - half; dy++) for (let dx = -half; dx < lineWidth - half; dx++) put(pic, x + dx, y + dy, c, 0.9);
      }
    }
    const w = m.x1 - m.x0, h = m.y1 - m.y0;
    if (w >= 4 && h >= 4) {
      // A dark edge round it, so a green box on green ground still shows.
      for (let x = m.x0 - 1; x <= m.x1; x++) { put(pic, x, m.y0 - 1, dark, 0.8); put(pic, x, m.y1, dark, 0.8); }
      for (let y = m.y0; y < m.y1; y++) { put(pic, m.x0 - 1, y, dark, 0.8); put(pic, m.x1, y, dark, 0.8); }
    }
    for (let y = m.y0; y < m.y1; y++) for (let x = m.x0; x < m.x1; x++) put(pic, x, y, c, 0.9);
  }
}

/**
 * The change picture: the second map's terrain with the changes marked (see the top of the file), at a PNG scale or
 * fitted to a width. Both maps must have one tileset — the graphics are drawn with — or tile ids mean nothing to each
 * other; `sideBySide` draws maps of two tilesets.
 */
export function changePicture(a: OpenedMap | Scenario, b: OpenedMap | Scenario, graphics: GameGraphics, options: DiffPictureOptions = {}): ChangePicture {
  const sa = scn(a), sb = scn(b);
  if (tilesetIndex(sa) !== tilesetIndex(sb)) throw new Error(`changePicture: the maps' tilesets differ (${tilesetOf(sa)}, ${tilesetOf(sb)})`);
  const d = diffChanges(sa, sb, options.radius);
  let picture: Picture;
  if (options.width !== undefined) {
    const width = Math.max(1, Math.round(options.width));
    picture = resizePicture(changeTerrain(sa, sb, d, graphics, scaleFor(width / d.width)), width, Math.max(1, Math.round((width * d.height) / d.width)));
  } else {
    const s = options.scale ?? DEFAULT_PNG_SCALE;
    if (!(PNG_SCALES as readonly number[]).includes(s)) throw new Error(`changePicture: scale ${s} is not one of ${PNG_SCALES.join(", ")}`);
    picture = changeTerrain(sa, sb, d, graphics, s);
  }
  const scale = picture.width / d.width, factor = scale / MEGATILE_PX;
  // Start locations and geysers in greys here: a slot's red, green or yellow, and preview's green for a geyser,
  // would read as removed, added or moved.
  const marks = placeMarks({ ...sb, units: d.kept }, graphics.units, factor, picture.width, picture.height)
    .filter((m) => m.kind === "start" || m.kind === "mineral" || m.kind === "geyser")
    .map((m) => (m.kind === "geyser" ? { ...m, color: GEYSER_LANDMARK } : m.kind === "start" ? { ...m, color: START_LANDMARK } : m));
  drawMarks(picture, marks);
  const changes = placeChanges(d, graphics.units, factor, picture);
  drawChanges(picture, changes, scale);
  return { picture, scale, marks, changes, diff: d };
}

/** One map as `map preview` draws it, on a canvas of `width × height` tiles at `scale` pixels a tile (or fitted to `columns`). */
function panel(map: Scenario, graphics: GameGraphics, canvasW: number, canvasH: number, o: { scale?: number; width?: number }): { picture: Picture; marks: Mark[] } {
  const scale = o.width !== undefined ? o.width / canvasW : (o.scale ?? DEFAULT_PNG_SCALE);
  const drawn = o.width !== undefined ? mapPicture(map, graphics, { width: Math.max(1, Math.round(map.width * scale)) }) : mapPicture(map, graphics, { scale });
  const out = blank(o.width !== undefined ? Math.round(o.width) : canvasW * scale, o.width !== undefined ? Math.max(1, Math.round((o.width * canvasH) / canvasW)) : canvasH * scale);
  blit(out, drawn.picture, 0, 0);
  return { picture: out, marks: drawn.marks };
}

export interface SideBySide {
  picture: Picture;
  /** Every panel's marks, moved to where the panel is. */
  marks: Mark[];
  /** Where each panel starts, in pixels, and how wide it is. */
  panels: { name: "a" | "changes" | "b"; x: number; width: number }[];
  /** The change picture when there is one (the maps share a tileset). */
  change: ChangePicture | null;
  scale: number;
}

/**
 * `a | changes | b` in one picture, `gap` pixels apart; maps of two tilesets as `a | b` alone. `graphics.b` is the
 * second map's (the same object as `graphics.a` when they share a tileset).
 */
export function sideBySide(a: OpenedMap | Scenario, b: OpenedMap | Scenario, graphics: { a: GameGraphics; b: GameGraphics }, options: DiffPictureOptions & { gap?: number } = {}): SideBySide {
  const sa = scn(a), sb = scn(b);
  const width = Math.max(sa.width, sb.width), height = Math.max(sa.height, sb.height);
  const change = tilesetIndex(sa) === tilesetIndex(sb) ? changePicture(sa, sb, graphics.b, options) : null;
  const pa = panel(sa, graphics.a, width, height, options), pb = panel(sb, graphics.b, width, height, options);
  const parts: { name: SideBySide["panels"][number]["name"]; picture: Picture; marks: Mark[] }[] = [
    { name: "a", ...pa }, ...(change ? [{ name: "changes" as const, picture: change.picture, marks: change.marks }] : []), { name: "b", ...pb },
  ];
  const gap = options.gap ?? Math.min(32, Math.max(4, 2 * (options.scale ?? 2)));
  const total = parts.reduce((n, p) => n + p.picture.width, 0) + gap * (parts.length - 1);
  const out = blank(total, Math.max(...parts.map((p) => p.picture.height)), GAP_COLOR);
  const marks: Mark[] = [], panels: SideBySide["panels"] = [];
  let x = 0;
  for (const p of parts) {
    blit(out, p.picture, x, 0);
    for (const m of p.marks) marks.push({ ...m, x0: m.x0 + x, x1: m.x1 + x });
    panels.push({ name: p.name, x, width: p.picture.width });
    x += p.picture.width + gap;
  }
  return { picture: out, marks, panels, change, scale: pa.picture.width / width };
}

/* ── The terminal ───────────────────────────────────────────── */

/** ASCII's letters for what changed: none of them is one of the ground's shades. */
export const ASCII_CHANGE = { added: "A", removed: "R", moved: "M", changed: "M", tile: "x", resized: "/", location: "#" } as const;

/**
 * For `asciiShades`: a character in each cell (two pixel rows) of the change picture that holds a change — a unit's
 * letter over a location's `#` over a changed tile's `x` over a resized one's `/` — offset `dx` columns into a picture
 * `width` wide (side by side).
 */
export function asciiOverlay(cp: ChangePicture, width = cp.picture.width, dx = 0): Map<number, { ch: string; color: string }> {
  const out = new Map<number, { ch: string; color: string }>();
  const { picture: pic, scale, diff: d } = cp;
  const cell = (x: number, y: number) => Math.floor(y / 2) * width + x + dx;
  for (let y = 0; y < pic.height; y++) {
    const ty0 = Math.floor(y / scale), ty1 = Math.min(d.height, Math.max(ty0 + 1, Math.ceil((y + 1) / scale)));
    for (let x = 0; x < pic.width; x++) {
      const tx0 = Math.floor(x / scale), tx1 = Math.min(d.width, Math.max(tx0 + 1, Math.ceil((x + 1) / scale)));
      let found: "tile" | "resized" | null = null;
      for (let ty = ty0; ty < ty1 && found !== "tile"; ty++) {
        for (let tx = tx0; tx < tx1; tx++) {
          const v = d.tiles[ty * d.width + tx];
          if (v === TILE.changed) { found = "tile"; break; }
          if (v === TILE.aOnly || v === TILE.bOnly) found = "resized";
        }
      }
      const at = cell(x, y), had = out.get(at);
      if (found === "tile" && had?.ch !== ASCII_CHANGE.tile) out.set(at, { ch: ASCII_CHANGE.tile, color: TILE_COLOR });
      else if (found === "resized" && !had) out.set(at, { ch: ASCII_CHANGE.resized, color: RESIZED_COLOR });
    }
  }
  for (const m of cp.changes) {
    if (m.kind !== "location") continue;
    for (let y = m.y0; y < m.y1; y++) for (let x = m.x0; x < m.x1; x++) {
      if (x === m.x0 || x === m.x1 - 1 || y === m.y0 || y === m.y1 - 1) out.set(cell(x, y), { ch: ASCII_CHANGE.location, color: m.color });
    }
  }
  for (const m of cp.changes) {
    if (m.kind !== "unit") continue;
    for (let y = m.y0; y < m.y1; y++) for (let x = m.x0; x < m.x1; x++) out.set(cell(x, y), { ch: ASCII_CHANGE[m.change as keyof typeof ASCII_CHANGE], color: m.color });
  }
  return out;
}

/**
 * The key under the picture: `+3 units  −1 units  ~2 units moved  ~40 tiles  ~1 locations`, each with its colour or
 * letter. `tiles: false` leaves the tiles out (maps of two tilesets, whose ids mean nothing to each other).
 */
export function diffLegend(c: DiffCounts, depth: Depth, unicode: boolean, ascii: boolean, tiles = true): string {
  if (!anyChange(c)) return t("nothing changed");
  const minus = unicode ? "−" : "-";
  const swatch = (hex: string, letter: string, text: string) =>
    ascii ? (depth === "none" ? `${letter} ${text}` : `\x1b[${sgr(38, rgbOf(hex), depth)}m${letter}\x1b[39m ${text}`)
      : depth === "none" ? text : `\x1b[${sgr(38, rgbOf(hex), depth)}m${unicode ? "■" : "#"}\x1b[39m ${text}`;
  const moved = c.unitsMoved + c.unitsChanged;
  const parts = [
    swatch(ADDED_COLOR, ASCII_CHANGE.added, t("{sign}{n, plural, one {# unit} other {# units}}", { sign: "+", n: c.unitsAdded })),
    swatch(REMOVED_COLOR, ASCII_CHANGE.removed, t("{sign}{n, plural, one {# unit} other {# units}}", { sign: minus, n: c.unitsRemoved })),
    ...(moved ? [swatch(MOVED_COLOR, ASCII_CHANGE.moved, !c.unitsChanged ? t("~{n, plural, one {# unit} other {# units}} moved", { n: moved }) : !c.unitsMoved ? t("~{n, plural, one {# unit} other {# units}} edited", { n: moved }) : t("~{n, plural, one {# unit} other {# units}} moved or edited", { n: moved }))] : []),
    ...(tiles ? [swatch(TILE_COLOR, ASCII_CHANGE.tile, t("~{n, plural, one {# tile} other {# tiles}}", { n: c.tiles }))] : []),
    ...(tiles && c.resized ? [swatch(RESIZED_COLOR, ASCII_CHANGE.resized, t("{n, plural, one {# tile} other {# tiles}} in one map only", { n: c.resized }))] : []),
    swatch(MOVED_COLOR, ASCII_CHANGE.location, t("~{n, plural, one {# location} other {# locations}}", { n: c.locations })),
  ];
  return parts.join("  ");
}

/* ── The command ─────────────────────────────────────────────── */

export interface DiffPictureCommandOptions {
  out?: string;
  scale?: string;
  width?: string;
  sideBySide?: boolean;
  blocks?: boolean;
  json?: boolean;
  starcraft?: string;
}

export type DiffPictureForm = "png" | "blocks" | "ascii" | InlineProtocol;

export interface DiffPictureReport {
  a: string;
  b: string;
  /** The canvas, in tiles: the larger map each way. */
  size: { width: number; height: number };
  tilesets: { a: string; b: string };
  /** What was drawn: the change picture, or `a | changes | b` (`a | b` for two tilesets). */
  layout: "changes" | "side-by-side";
  picture: { form: DiffPictureForm; width: number; height: number; scale: number; columns?: number; rows?: number; depth?: Depth };
  counts: DiffCounts;
  /** In tiles: the tiles whose ids differ, and everything marked. */
  bounds: { tiles: TileBox | null; all: TileBox | null };
  /** The copy of the game the ground was drawn with; null when there was none and it was drawn plain. */
  copy: { folder: string; kind: "remastered" | "classic"; label: string } | null;
  note?: string;
  out?: Written;
  ms: { copy: number; draw: number; total: number };
}

/** Columns a picture of three side by side needs at the least before the terminal shows the changes alone. */
export const MIN_PANEL = 32;
/** Columns between pictures side by side in the terminal. */
const TERM_GAP = 2;

const number = (value: string | undefined, name: string, ok: (n: number) => boolean, hint: string): number | undefined => {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || !ok(n)) throw new CliError(t("--{name} takes {hint}, not \"{value}\"", { name, hint, value }), null, 2);
  return n;
};

/**
 * The copy of the game, or null when none is named and none is found: the picture is then drawn with plain ground
 * (`plainShade`), so a computer without the game — a CI runner — still shows where a map changed.
 */
async function gameFilesOrNone(named: string | undefined): Promise<GameFiles | null> {
  if (named) return openGameFiles(named);
  try { return await openGameFiles(undefined); } catch (e) {
    if (e instanceof CliError && e.message === t("No copy of StarCraft was found on this computer.")) return null;
    throw e;
  }
}

/** The ground's words when no copy of the game was found. */
export const PLAIN_GROUND = msg("no copy of StarCraft here, so the ground is plain greys");

/**
 * `scmjs map diff a b --picture`: the copy of the game opened (plain ground without one), the tilesets read, the change picture (or the three
 * side by side) drawn and written as a PNG (`--out`), sent to the terminal, or described (`--json`).
 */
export async function diffPicture(
  x: { input: Input; doc: OpenedMap }, y: { input: Input; doc: OpenedMap }, o: DiffPictureCommandOptions,
  term: TerminalInfo = terminalInfo(), stdout: Writable = process.stdout,
): Promise<{ report: DiffPictureReport; lines: string[] }> {
  const t0 = performance.now();
  const sa = x.doc.scenario, sb = y.doc.scenario;
  const png = o.out !== undefined;
  if (png && o.width !== undefined) throw new CliError(t("--width is the terminal picture's; a PNG's size is --scale pixels a tile"), null, 2);
  if (o.width !== undefined && o.scale !== undefined) throw new CliError(t("--width or --scale, not both"), null, 2);
  const scale = number(o.scale, "scale", png ? (n) => (PNG_SCALES as readonly number[]).includes(n) : (n) => n > 0 && n <= 32, png ? PNG_SCALES.join(", ") : t("a number of pixels a tile, above 0 and up to 32"));
  const width = number(o.width, "width", (n) => Number.isInteger(n) && n >= 8, t("a number of columns, 8 or more"));

  const files = await gameFilesOrNone(o.starcraft);
  const same = tilesetIndex(sa) === tilesetIndex(sb);
  const plain: GameGraphics = { tileset: null, units: null };
  const ga = files ? await loadGraphics(sa, files) : plain;
  const gb = !files ? plain : same ? ga : await loadGraphics(sb, files);
  const t1 = performance.now();

  const W = Math.max(sa.width, sb.width), H = Math.max(sa.height, sb.height);
  const d = diffChanges(sa, sb);
  const note = same ? undefined : t("The maps' tilesets differ ({a}, {b}): drawn side by side, with nothing marked", { a: tilesetOf(sa), b: tilesetOf(sb) });
  const base = {
    a: x.input.name, b: y.input.name, size: { width: W, height: H }, tilesets: { a: tilesetOf(sa), b: tilesetOf(sb) },
    counts: d.counts, bounds: d.bounds, copy: files ? { folder: files.folder, kind: files.kind, label: files.label } : null, ...(note ? { note } : {}),
  };
  const ms = () => ({ copy: Math.round(t1 - t0), draw: Math.round(performance.now() - t1), total: Math.round(performance.now() - t0) });
  const arrow = term.unicode ? "→" : "->";
  const title = `${pc.bold(x.input.name)} ${pc.dim(arrow)} ${pc.bold(y.input.name)}  ${pc.dim(`${num(W)} × ${num(H)}${dot}${same ? tilesetOf(sb) : `${tilesetOf(sa)}, ${tilesetOf(sb)}`}${dot}${files ? files.label : t("plain ground")}`)}`;
  const noteLines = note ? [pc.yellow(note)] : [];
  // (The PNG's closing line says it; the terminal's pictures say it under the title.)
  const plainLines = files ? [] : [pc.dim(t("No copy of StarCraft here, so the ground is plain greys: --starcraft names a copy"))];

  if (png) {
    const s = scale ?? DEFAULT_PNG_SCALE;
    const layout = o.sideBySide || !same ? "side-by-side" : "changes";
    const pic = layout === "changes" ? changePicture(sa, sb, gb, { scale: s }).picture : sideBySide(sa, sb, { a: ga, b: gb }, { scale: s }).picture;
    const bytes = encodePng(pic.pixels, pic.width, pic.height);
    const out = await writeOutput(bytes, o.out!, stdout);
    const report: DiffPictureReport = { ...base, layout, picture: { form: "png", width: pic.width, height: pic.height, scale: s }, out, ms: ms() };
    return { report, lines: [
      `${mark.ok} ${pc.bold(x.input.name)} ${pc.dim(arrow)} ${pc.bold(y.input.name)}: ${t("{width} × {height} PNG, {n, plural, one {# pixel} other {# pixels}} a tile", { width: pic.width, height: pic.height, n: s })}${layout === "side-by-side" ? `, ${same ? `a | ${t("changes")} | b` : "a | b"}` : ""}${dot}${t("written to {where}", { where: out.path === STDIO ? t("standard output") : pc.cyan(out.path) })}${dot}${size(out.bytes)}`,
      ...noteLines,
      diffLegend(d.counts, term.depth, term.unicode, false, same),
      pc.dim(`  ${files ? t("drawn from {copy} in {folder}", { copy: files.label, folder: files.folder }) : t("drawn without the game: {why}", { why: translate(PLAIN_GROUND) })}${dot}${(report.ms.total / 1000).toFixed(1)} s`),
    ] };
  }

  // The terminal: three pictures side by side where asked and there is room (two, always, for two tilesets), else the
  // change picture alone.
  const panels = same ? 3 : 2;
  const room = term.columns - 1 - TERM_GAP * (panels - 1);
  const perPanel = width ?? (scale ? Math.max(1, Math.round(W * scale)) : terminalWidth(W, H, Math.floor(room / panels) + 1));
  const wide = !same || (!!o.sideBySide && (width !== undefined || scale !== undefined || perPanel >= MIN_PANEL));
  const narrowNote = o.sideBySide && same && !wide ? [pc.dim(t("Too narrow for three pictures side by side ({n} columns): the changes alone", { n: term.columns }))] : [];
  const legend = (ascii: boolean) => diffLegend(d.counts, term.depth, term.unicode, ascii, same);

  const inline = !o.blocks && !o.json ? term.inline : null;
  if (inline) {
    const columns = width ?? Math.max(8, term.columns - 1);
    const s = scale && (PNG_SCALES as readonly number[]).includes(scale) ? scale : scaleFor((columns * 8) / (W * (wide ? panels : 1)));
    const pic = wide ? sideBySide(sa, sb, { a: ga, b: gb }, { scale: s }).picture : changePicture(sa, sb, gb, { scale: s }).picture;
    const report: DiffPictureReport = { ...base, layout: wide ? "side-by-side" : "changes", picture: { form: inline, width: pic.width, height: pic.height, scale: s, columns }, ms: ms() };
    return { report, lines: [title, ...noteLines, ...plainLines, inlineImage(encodePng(pic.pixels, pic.width, pic.height), inline, columns), legend(false)] };
  }

  const form: DiffPictureForm = term.unicode && term.depth !== "none" ? "blocks" : "ascii";
  let pic: Picture, marks: Mark[], overlay: Map<number, { ch: string; color: string }> | undefined, header: string[] = [], picScale: number;
  if (wide) {
    const sbs = sideBySide(sa, sb, { a: ga, b: gb }, { width: perPanel, gap: TERM_GAP });
    pic = sbs.picture; marks = sbs.marks; picScale = sbs.scale;
    const changes = sbs.panels.find((p) => p.name === "changes");
    if (form === "ascii" && sbs.change && changes) overlay = asciiOverlay(sbs.change, pic.width, changes.x);
    const label = (p: SideBySide["panels"][number], last: boolean) => {
      let text = p.name === "a" ? x.input.name : p.name === "b" ? y.input.name : t("changes");
      if (columns(text) > p.width) { let cut = ""; for (const ch of text) { if (columns(cut + ch) > Math.max(1, p.width - 1)) break; cut += ch; } text = `${cut}…`; }
      return pc.bold(text) + (last ? "" : " ".repeat(Math.max(0, p.width - columns(text)) + TERM_GAP));
    };
    header = [sbs.panels.map((p, i) => label(p, i === sbs.panels.length - 1)).join("")];
  } else {
    const columns = terminalWidth(W, H, term.columns, { width, scale });
    const cp = changePicture(sa, sb, gb, { width: columns });
    pic = cp.picture; marks = cp.marks; picScale = cp.scale;
    if (form === "ascii") overlay = asciiOverlay(cp);
  }
  const drawn = form === "blocks" ? halfBlocks(pic, marks, term.depth as Exclude<Depth, "none">) : asciiShades(pic, marks, term.depth, overlay);
  const report: DiffPictureReport = {
    ...base, layout: wide ? "side-by-side" : "changes",
    picture: { form, width: pic.width, height: pic.height, scale: Number(picScale.toFixed(3)), columns: pic.width, rows: drawn.length, depth: term.depth }, ms: ms(),
  };
  return { report, lines: o.json ? [] : [title, ...noteLines, ...plainLines, ...narrowNote, ...header, ...drawn, legend(form === "ascii")] };
}
