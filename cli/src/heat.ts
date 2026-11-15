/**
 * `scmjs map heatmap`'s pure half: what the replay runner said about each game (`--events`), the replays matched to the
 * map, the events chosen (deaths, kills, buildings or walking; a player; up to a time), counted per tile, spread into a
 * smooth field and drawn as a heat ramp over the map's picture. No game, no files: events and pictures in, numbers and
 * pixels out. The command (running the replays, the cache, the terminal) is heatmap.ts.
 */
import { MEGATILE_PX } from "../../src/formats/tileset/decode";
import { plainText } from "../../src/editor/textColors";
import { t } from "./i18n";
import type { Picture } from "./preview";

/* ── A game's events, as the runner sends them and the cache keeps them ──────── */

/** What the heat is of. */
export const HEAT_WHAT = ["deaths", "kills", "buildings", "paths"] as const;
export type HeatWhat = (typeof HEAT_WHAT)[number];

/** The form of the runner's event lines this reads (scm-sim's `EVENTS_VERSION`). */
export const EVENTS_VERSION = 1;

export interface EventPlayer { slot: number; name: string; race: string; type: number }

/** One replay's events, flat: what `--events` sent, kept in the cache by the replay's hash. */
export interface GameEvents {
  version: number;
  map: { name: string; width: number; height: number; tileset: string };
  /** The replay's length in frames. */
  frames: number;
  players: EventPlayer[];
  /** Six numbers a death: frame, unit type, owner, x, y (map pixels), the killer (−1 none). */
  deaths: number[];
  /** Five numbers a building placed: frame, unit type, owner, x, y. */
  built: number[];
  /** A sample after another: frame, n, then n × (x, y, owner, class: 1 worker, 2 army). */
  walks: number[];
  end: { frame: number; ended: boolean; by: string | null; unmatched: number; ms: number };
}

export interface RunnerEventLine {
  kind: "death" | "built" | "walk";
  frame: number;
  unit?: number;
  player?: number;
  x?: number;
  y?: number;
  by?: number | null;
  units?: number[];
}

export function emptyEvents(start: { map: GameEvents["map"]; frames: number; players: EventPlayer[]; events?: number }): GameEvents {
  return { version: start.events ?? EVENTS_VERSION, map: start.map, frames: start.frames, players: start.players, deaths: [], built: [], walks: [], end: { frame: 0, ended: false, by: null, unmatched: 0, ms: 0 } };
}

/** A runner line taken into the game's events. */
export function takeEvent(ev: GameEvents, l: RunnerEventLine): void {
  if (l.kind === "death") ev.deaths.push(l.frame, l.unit!, l.player!, l.x!, l.y!, l.by ?? -1);
  else if (l.kind === "built") ev.built.push(l.frame, l.unit!, l.player!, l.x!, l.y!);
  else if (l.kind === "walk" && l.units?.length) ev.walks.push(l.frame, l.units.length / 4, ...l.units);
}

/* ── Which replays were played on this map ──────────────────── */

export interface MapIdentity { hash: string; name: string; width: number; height: number }
export type MatchKind = "same" | "name" | "forced";

/** A map's name as two maps are compared: colour codes out, spaces folded, case ignored. */
export const sameName = (a: string, b: string): boolean => fold(a) === fold(b);
const fold = (s: string) => plainText(s).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Whether a replay was played on the map: the same scenario (the replay carries the game's own copy of it, so the
 * bytes are the map's when it is the same file), else the same name and size (another version of the map), else not —
 * unless `force`. The reason is the replay's map, for the line that says it was left out.
 */
export function matchReplay(map: MapIdentity, rep: MapIdentity, force = false): { match: MatchKind | null; reason: string } {
  if (map.hash === rep.hash) return { match: "same", reason: "" };
  const sized = map.width === rep.width && map.height === rep.height;
  if (sized && sameName(map.name, rep.name)) return { match: "name", reason: "" };
  if (force) return { match: "forced", reason: "" };
  const what = `${plainText(rep.name).trim() || t("a map with no name")} (${rep.width} × ${rep.height})`;
  return { match: null, reason: sized ? t("played on {map}", { map: what }) : t("played on {map}, another size", { map: what }) };
}

/* ── The events chosen ──────────────────────────────────────── */

/** Deaths that are no loss in a fight: a Reaver's Scarab, a Nuclear Missile, Disruption Web and Dark Swarm running out. */
export const NOT_A_LOSS = new Set([85, 14, 105, 202]);
const ARMY = 2;

export interface HeatFilter {
  what: HeatWhat;
  /** A player: their number (1–8), or a name as the replays have it. */
  player?: number | string;
  /** Frames: only what happened by then. */
  until?: number;
  /** The map's size in tiles: a point off it (a replay of a bigger map) is not counted, only told (`outside`). */
  bounds?: { width: number; height: number };
}

/** The game's player number (0–7) a `--player` means in one game, or null when the game has no such player. */
export function ownerIn(game: GameEvents, player: number | string): number | null {
  if (typeof player === "number") return game.players.some((p) => p.slot === player - 1) ? player - 1 : null;
  const p = game.players.find((q) => sameName(q.name, player));
  return p ? p.slot : null;
}

export interface HeatPoints {
  /** x, y in map pixels, two numbers a point. */
  points: number[];
  /** Points by unit type (deaths, kills, buildings). */
  units: Map<number, number>;
  /** Per game: how many points it gave, and whether the player was in it. */
  games: { count: number; player: boolean }[];
  /** Points that fell off the map (`bounds`), not counted anywhere else. */
  outside: number;
}

/** The events of every game that the filter takes, as points on the map. */
export function heatPoints(games: GameEvents[], f: HeatFilter): HeatPoints {
  const points: number[] = [], units = new Map<number, number>(), per: HeatPoints["games"] = [];
  const until = f.until ?? Infinity;
  let outside = 0;
  const off = (x: number, y: number) => !!f.bounds && (x < 0 || y < 0 || x >= f.bounds.width * MEGATILE_PX || y >= f.bounds.height * MEGATILE_PX);
  const add = (unit: number | null, x: number, y: number) => {
    if (off(x, y)) { outside++; return; }
    points.push(x, y);
    if (unit !== null) units.set(unit, (units.get(unit) ?? 0) + 1);
  };
  for (const g of games) {
    const owner = f.player === undefined ? null : ownerIn(g, f.player);
    if (f.player !== undefined && owner === null) { per.push({ count: 0, player: false }); continue; }
    const before = points.length;
    if (f.what === "deaths" || f.what === "kills") {
      for (let i = 0; i < g.deaths.length; i += 6) {
        const [frame, unit, who, x, y, by] = g.deaths.slice(i, i + 6);
        if (frame > until || NOT_A_LOSS.has(unit)) continue;
        if (f.what === "deaths" ? owner !== null && who !== owner : by < 0 || by === who || (owner !== null && by !== owner)) continue;
        add(unit, x, y);
      }
    } else if (f.what === "buildings") {
      for (let i = 0; i < g.built.length; i += 5) {
        const [frame, unit, who, x, y] = g.built.slice(i, i + 5);
        if (frame > until || (owner !== null && who !== owner)) continue;
        add(unit, x, y);
      }
    } else {
      // Army units only: workers going between minerals and their base would outshine everything else.
      for (let i = 0; i < g.walks.length;) {
        const frame = g.walks[i], n = g.walks[i + 1];
        if (frame <= until) {
          for (let k = 0, at = i + 2; k < n; k++, at += 4) {
            if (g.walks[at + 3] !== ARMY || (owner !== null && g.walks[at + 2] !== owner)) continue;
            add(null, g.walks[at], g.walks[at + 1]);
          }
        }
        i += 2 + n * 4;
      }
    }
    per.push({ count: (points.length - before) / 2, player: true });
  }
  return { points, units, games: per, outside };
}

/** Points counted per tile, the busiest first: `[x, y, n]` in tiles, ties in reading order. Points off the map are left out. */
export function tileCounts(points: readonly number[], mapW: number, mapH: number): [number, number, number][] {
  const counts = new Map<number, number>();
  for (let i = 0; i < points.length; i += 2) {
    const tx = Math.floor(points[i] / MEGATILE_PX), ty = Math.floor(points[i + 1] / MEGATILE_PX);
    if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) continue;
    const k = ty * mapW + tx;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]): [number, number, number] => [k % mapW, Math.floor(k / mapW), n]).sort((a, b) => b[2] - a[2] || a[1] - b[1] || a[0] - b[0]);
}

/* ── The field ──────────────────────────────────────────────── */

/** Cells a tile of the field: a quarter tile (8 map pixels), whatever size the picture is. */
export const CELLS_PER_TILE = 4;
/** How far a point spreads, in tiles (the Gaussian's sigma): a fight covers a few tiles; buildings and walking less. */
export const SPREAD: Record<HeatWhat, number> = { deaths: 1.5, kills: 1.5, buildings: 1, paths: 1 };

export interface HeatField {
  width: number;
  height: number;
  /** Per cell, row by row: the points near it, each spread as a Gaussian of `SPREAD` tiles. */
  values: Float32Array;
  /** What the ramp's top is: a high percentile of the cells that have any heat, so one hot spot does not leave the rest dark. */
  top: number;
}

/** A separable Gaussian blur of `values` (`w × h`), `sigma` cells, in place. */
export function blur(values: Float32Array, w: number, h: number, sigma: number): void {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let k = -r; k <= r; k++) { kernel[k + r] = Math.exp(-(k * k) / (2 * sigma * sigma)); sum += kernel[k + r]; }
  for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
  const tmp = new Float32Array(values.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) v += values[y * w + xx] * kernel[k + r]; }
      tmp[y * w + x] = v;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) v += tmp[yy * w + x] * kernel[k + r]; }
      values[y * w + x] = v;
    }
  }
}

/** The points as a field over the map, `CELLS_PER_TILE` cells a tile, spread `spread` tiles. */
export function heatField(points: readonly number[], mapW: number, mapH: number, spread: number): HeatField {
  const width = mapW * CELLS_PER_TILE, height = mapH * CELLS_PER_TILE, cell = MEGATILE_PX / CELLS_PER_TILE;
  const values = new Float32Array(width * height);
  for (let i = 0; i < points.length; i += 2) {
    const cx = Math.floor(points[i] / cell), cy = Math.floor(points[i + 1] / cell);
    if (cx >= 0 && cy >= 0 && cx < width && cy < height) values[cy * width + cx]++;
  }
  if (points.length) blur(values, width, height, spread * CELLS_PER_TILE);
  const warm = Array.from(values).filter((v) => v > 1e-4).sort((a, b) => a - b);
  const top = warm.length ? warm[Math.min(warm.length - 1, Math.floor(warm.length * 0.995))] : 0;
  return { width, height, values, top };
}

/** The field at a picture point (fractions of a cell), bilinear, as 0–1 of its top (capped at 1). */
export function fieldAt(f: HeatField, cx: number, cy: number): number {
  if (f.top <= 0) return 0;
  const x0 = Math.max(0, Math.min(f.width - 1, Math.floor(cx - 0.5))), y0 = Math.max(0, Math.min(f.height - 1, Math.floor(cy - 0.5)));
  const x1 = Math.min(f.width - 1, x0 + 1), y1 = Math.min(f.height - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, cx - 0.5 - x0)), fy = Math.max(0, Math.min(1, cy - 0.5 - y0));
  const v = f.values;
  const top = v[y0 * f.width + x0] * (1 - fx) + v[y0 * f.width + x1] * fx;
  const bottom = v[y1 * f.width + x0] * (1 - fx) + v[y1 * f.width + x1] * fx;
  return Math.min(1, (top * (1 - fy) + bottom * fy) / f.top);
}

/* ── The ramp and the picture ───────────────────────────────── */

type Rgb = [number, number, number];

/** The heat ramp, cool to hot: magma's stops (dark violet, red, orange, pale yellow). */
export const RAMP: { at: number; color: Rgb }[] = [
  { at: 0, color: [59, 15, 112] },
  { at: 0.25, color: [140, 41, 129] },
  { at: 0.5, color: [222, 73, 104] },
  { at: 0.75, color: [254, 159, 109] },
  { at: 1, color: [252, 253, 191] },
];
/** Below this share of the top nothing is drawn: the ground shows as it is. */
export const HEAT_FLOOR = 0.03;

/** The ramp's colour at `t` (0–1) and how much of it covers the ground. */
export function heatColor(t: number): { color: Rgb; alpha: number } {
  const v = Math.max(0, Math.min(1, t));
  let k = 1;
  while (k < RAMP.length - 1 && RAMP[k].at < v) k++;
  const a = RAMP[k - 1], b = RAMP[k], f = (v - a.at) / (b.at - a.at);
  const color: Rgb = [0, 1, 2].map((i) => Math.round(a.color[i] + (b.color[i] - a.color[i]) * f)) as Rgb;
  // Faint at the edge of the heat, solid at its middle.
  const alpha = v < HEAT_FLOOR ? 0 : Math.min(0.92, 0.35 + 0.65 * Math.sqrt(v));
  return { color, alpha };
}

/** How bright the ground stays under the heat, in grey, so no colour of the tileset reads as heat. */
export const GROUND = 0.5;

/** The terrain in grey, darkened: what the heat is drawn over. In place. */
export function greyGround(pic: Picture, bright = GROUND): void {
  const p = pic.pixels;
  for (let i = 0; i < p.length; i += 4) {
    const l = Math.round((0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) * bright);
    p[i] = p[i + 1] = p[i + 2] = l;
  }
}

/**
 * The field drawn over a picture of the map (`scale` picture pixels a tile), each pixel taking the ramp's colour at
 * the field's value there. In place.
 */
export function drawHeat(pic: Picture, field: HeatField, scale: number): void {
  const p = pic.pixels, per = CELLS_PER_TILE / scale;
  for (let y = 0; y < pic.height; y++) {
    for (let x = 0; x < pic.width; x++) {
      const t = fieldAt(field, (x + 0.5) * per, (y + 0.5) * per);
      if (t < HEAT_FLOOR) continue;
      const { color, alpha } = heatColor(t);
      const at = (y * pic.width + x) * 4;
      for (let i = 0; i < 3; i++) p[at + i] = Math.round(p[at + i] * (1 - alpha) + color[i] * alpha);
    }
  }
}

/** The ramp as a strip of `cells` colours, cool to hot, for the legend. */
export const rampStrip = (cells: number): Rgb[] => Array.from({ length: cells }, (_, i) => heatColor(HEAT_FLOOR + ((1 - HEAT_FLOOR) * (i + 0.5)) / cells).color);
