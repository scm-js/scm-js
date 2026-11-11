/**
 * `scmjs map analyze`: a melee map's layout in a second, with no game run — where each start is, its main and its
 * natural, the ground walk between every pair of starts beside the straight line, the narrowest passages on those
 * walks and each main's way out, what share of the map is walkable, buildable and high ground, and a few plain verdicts.
 *
 * The ground is the tileset's minitile flags from the player's copy of the game (as `map preview` reads them), with
 * buildings and resources standing on it (walk.ts). A walk is the shortest octile path over minitiles a small unit
 * fits on; `map rush` is the game's own walk, and the two agree within a few percent (docs/cli.md).
 *
 * The top half is pure (a scenario and the decoded files in, a report out), so a test or the MCP server can call
 * `analyzeLayout` without the terminal; the picture is `map preview`'s with the walks drawn over it.
 */
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { displayColorHex } from "../../src/data/players";
import { START_LOCATION } from "../../src/data/units";
import type { OpenedMap } from "../../src/editor/mapFile";
import { DEFAULT_GAS, DEFAULT_MINERALS, MINERAL_FIELD_IDS, UnitUsed, unitGeometry, VESPENE_GEYSER, type UnitGeometry } from "../../src/editor/units";
import { scenarioName, type Scenario } from "../../src/formats/chk/scenario";
import type { UnitsDat } from "../../src/formats/dat/dat";
import { walkSpeed, type SpeedTables } from "../../src/formats/dat/speed";
import { groupBuildable, megatileForTile, tileGroupOf, type Tileset } from "../../src/formats/tileset/decode";
import { mainResources, startPlaces, type MainResources } from "./balance";
import { GEYSER, MINERAL, TILE } from "./bases";
import { writeOutput, type Written } from "./exchange";
import { STDIO, type Input } from "./files";
import { openGameFiles, readSpeedTables, readTileset, readUnitsDat, type GameFiles } from "./gamefiles";
import { encodePng } from "./png";
import { DEFAULT_PNG_SCALE, mapPicture, PNG_SCALES, tilesetOf, type Picture } from "./preview";
import { msg, t, translate } from "./i18n";
import { CliError, dot, gameText, mark, num, pc, size, table } from "./ui";
import {
  blockBoxes, CELL_PX, CELLS_PER_TILE, clearance, distancesFrom, distancesWithin, groundFromTiles, narrowestOn, nearestCell, openCells,
  passableCells, pathTo, stepsToPx, UNIT_RADIUS, withoutSpecks, type Ground, type PixelBox,
} from "./walk";

/* ── The rules, in one place (docs/cli.md says them in words) ──────────── */

/** Distances that should match may differ by this share and still read as fair: `map generate`'s own tolerance. */
export const FAIR_WITHIN = 0.08;
/** A start's natural this many tiles farther or nearer than the starts' median (by ground) is named. */
export const NATURAL_TILES = 5;
/** A main's way out this many tiles wider or narrower than the starts' median is named. */
export const WAY_OUT_TILES = 1;
/** A passage narrower than this, in tiles, on a walk between two mains is named: a Dragoon or a tank barely gets through. */
export const CHOKE_NARROW = 2;
/** The ground's height around a main is counted within this many tiles of the start location. */
export const AROUND_TILES = 12;
/** A main with this many points more or less raised ground (mid or high) around it than the starts' median is named. */
export const HIGH_POINTS = 15;
/** Resources within this many tiles of each other are one base, when the walk between them is short too. */
export const BASE_LINK = 12;
/** The walk between two resources of one base is at most the straight line and this many tiles. */
export const BASE_DETOUR = 6;
/** Fields holding fewer minerals than this are a wall, not a base. */
export const WALL_MINERALS = 100;
/** Unwalkable patches standing alone and smaller than this many tiles in area are walked round, not a passage's wall. */
export const ROCK_TILES = 16;
/** The ends of a walk left out when looking for its narrowest point, in tiles: a start's own ground is not a choke. */
const END_TILES = 3;
/** A narrow point this near a main's way out is that way out. */
const SAME_PLACE_TILES = 4;
/** A town hall's half height in cells: where a hall fits beside a base's resources. */
const HALL_CLEARANCE = 6;

/** The units whose walking time is given, as people rush with them. */
export const TIMED_UNITS = [{ id: 37, name: "Zergling" }, { id: 0, name: "Marine" }, { id: 65, name: "Zealot" }] as const;
/** A frame at Fastest, in seconds. */
const FRAME_S = 0.042;

/* ── The report ────────────────────────────────────────────────── */

export interface TilePoint { x: number; y: number }
export interface UnitSpeed { id: number; name: string; pixelsPerFrame: number }

export interface Base {
  /** Where its resources are, on average, in tiles. */
  at: TilePoint;
  /** Where a town hall fits beside them (the open ground nearest their middle), in tiles; null when nowhere near. */
  hall: TilePoint | null;
  fields: number; minerals: number; geysers: number; gas: number;
  /** The player (1–8) whose main this is, or null. */
  mainOf: number | null;
}

export interface Natural {
  /** Index into `bases`. */
  base: number;
  at: TilePoint;
  /** Tiles from the start location: walked, and in a straight line. */
  ground: number;
  air: number;
  fields: number; minerals: number; geysers: number; gas: number;
  /** Other players whose nearest base this is too. */
  sharedWith: number[];
}

export interface Narrow {
  /** Tiles across. */
  width: number;
  at: TilePoint;
  /** The player whose way out this is, when it is one. */
  wayOutOf?: number;
}

export interface StartLayout {
  player: number;
  /** Pixels, as the map has it. */
  x: number; y: number;
  tile: TilePoint;
  clock: number;
  /** "top left", "bottom", "middle", … */
  side: string;
  level: "low" | "mid" | "high";
  main: MainResources;
  natural: Natural | null;
  /** The main's way out: the narrowest point on the walk from the start to its natural (its ramp, as a rule). */
  wayOut: Narrow | null;
  /** Walkable ground within `AROUND_TILES` of the start: percent at each height. */
  around: { radius: number; high: number; mid: number; low: number };
}

export interface PairLayout {
  /** Players, 1–8. */
  a: number; b: number;
  /** Tiles walked; null when no ground joins them. */
  ground: number | null;
  /** Tiles in a straight line. */
  air: number;
  /** Ground over air. */
  ratio: number | null;
  /** Seconds at Fastest for each timed unit, by name; null without the speeds. */
  seconds: Record<string, number> | null;
  /** The narrowest passage on the walk. */
  narrowest: Narrow | null;
}

export interface TerrainShare {
  /** Percent of the map's minitiles. */
  walkable: number;
  unwalkable: number;
  /** Percent of the map's tiles. */
  buildable: number;
  /** Percent of the walkable ground at each height. */
  high: number; mid: number; low: number;
}

export type VerdictLevel = "ok" | "warn" | "info";
export interface Verdict { level: VerdictLevel; text: string }

export interface Layout {
  size: { width: number; height: number };
  grid: { cellPixels: number; unitRadius: number };
  starts: StartLayout[];
  pairs: PairLayout[];
  /** Of the pairs joined by ground. */
  shortest: PairLayout | null;
  longest: PairLayout | null;
  /** (longest − shortest) / shortest; null with fewer than two joined pairs. */
  spread: number | null;
  /** The largest difference between starts' k-th nearest walks (each start's walks to the others, nearest first); null for two starts. */
  rankSpread: { spread: number; rank: number; near: number; far: number } | null;
  terrain: TerrainShare;
  bases: Base[];
  /** Cells taken out of the ground by what stands on it. */
  blocking: { buildings: number; resources: number };
  speeds: UnitSpeed[];
  verdicts: Verdict[];
  /** The walks, as cells (for the picture): every pair's, then every main's to its natural. */
  paths: { pairs: number[][]; naturals: (number[] | null)[] };
}

/* ── Pure helpers, tested on their own ─────────────────────────── */

/** Where a point is: thirds of the map each way, "top left", "top", "middle", … */
export function sideOf(x: number, y: number, width: number, height: number): string {
  const col = x < width / 3 ? "left" : x >= (2 * width) / 3 ? "right" : "";
  const row = y < height / 3 ? "top" : y >= (2 * height) / 3 ? "bottom" : "";
  return [row, col].filter(Boolean).join(" ") || "middle";
}

/** (longest − shortest) / shortest of a list of distances; null with fewer than two. */
export function spreadOf(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  return lo > 0 ? (hi - lo) / lo : null;
}

/**
 * Each start's walks to the others, nearest first, compared rank by rank across the starts: the largest spread, which
 * rank it is (1 = the nearest opponent), and the starts (indices) nearest and farthest at it. Null for two starts, whose
 * one pair has nothing to be compared with, or when a start is cut off.
 */
export function rankSpread(matrix: readonly (readonly (number | null)[])[]): { spread: number; rank: number; near: number; far: number } | null {
  const n = matrix.length;
  if (n < 3) return null;
  const sorted = matrix.map((row, i) => row.filter((d, k) => k !== i && d !== null).sort((a, b) => a! - b!) as number[]);
  if (sorted.some((r) => r.length !== n - 1)) return null;
  let best: { spread: number; rank: number; near: number; far: number } | null = null;
  for (let k = 0; k < n - 1; k++) {
    let near = 0, far = 0;
    sorted.forEach((r, i) => { if (r[k] < sorted[near][k]) near = i; if (r[k] > sorted[far][k]) far = i; });
    const spread = (sorted[far][k] - sorted[near][k]) / sorted[near][k];
    if (!best || spread > best.spread) best = { spread, rank: k + 1, near, far };
  }
  return best;
}

export interface Resource { kind: "mineral" | "geyser"; x: number; y: number; amount: number }

/**
 * The map's resources grouped into bases: two resources within `BASE_LINK` tiles of each other are one base when
 * `near(a, b)` agrees too (the command asks the ground: a short walk between them, not round a cliff — so a main and a
 * natural just below it stay two bases). Fields under `WALL_MINERALS` are walls and left out. A group of fewer than
 * three fields and no geyser is not a base.
 */
export function clusterResources(resources: readonly Resource[], near: (a: number, b: number) => boolean = () => true): Resource[][] {
  const kept = resources.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === "geyser" || r.amount >= WALL_MINERALS);
  const parent = kept.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let a = 0; a < kept.length; a++) for (let b = a + 1; b < kept.length; b++) {
    const ra = kept[a].r, rb = kept[b].r;
    if (find(a) === find(b) || Math.hypot(ra.x - rb.x, ra.y - rb.y) > BASE_LINK * TILE) continue;
    if (near(kept[a].i, kept[b].i)) parent[find(a)] = find(b);
  }
  const groups = new Map<number, Resource[]>();
  kept.forEach(({ r }, k) => { const g = find(k); if (!groups.has(g)) groups.set(g, []); groups.get(g)!.push(r); });
  return [...groups.values()].filter((group) => group.some((r) => r.kind === "geyser") || group.length >= 3);
}

/** Every unit (and unit sprite) that stands in the way: buildings and resources, in pixel boxes; units that move do not. */
export function blockers(scn: Scenario, units: UnitsDat | null): { boxes: PixelBox[]; resource: boolean[] } {
  const boxes: PixelBox[] = [], resource: boolean[] = [];
  const minerals = new Set<number>(MINERAL_FIELD_IDS);
  const fallback = (id: number): UnitGeometry | null => {
    const s = id === VESPENE_GEYSER ? GEYSER : minerals.has(id) ? MINERAL : null;
    return s ? { building: true, flyer: false, placeW: s.w * TILE, placeH: s.h * TILE, left: (s.w * TILE) / 2, up: (s.h * TILE) / 2, right: (s.w * TILE) / 2 - 1, down: (s.h * TILE) / 2 - 1 } : null;
  };
  const add = (id: number, x: number, y: number) => {
    if (id === START_LOCATION) return;
    const g = units ? unitGeometry(units, id) : fallback(id);
    if (!g || !g.building || g.flyer) return;
    boxes.push({ left: x - g.left, top: y - g.up, right: x + g.right + 1, bottom: y + g.down + 1 });
    resource.push(id === VESPENE_GEYSER || minerals.has(id));
  };
  for (const u of scn.units) add(u.unitId, u.x, u.y);
  // A doodad's unit (a door, a trap) is a unit in the game; a pure sprite is only a picture.
  for (const s of scn.sprites) if (!(s.flags & 0x1000)) add(s.spriteId, s.x, s.y);
  return { boxes, resource };
}

/** The ground of a map with its tileset: the flags of every tile's megatile, and what stands on it. */
export function mapGround(scn: Scenario, tileset: Tileset, units: UnitsDat | null): { ground: Ground; blocking: Layout["blocking"] } {
  const ground = groundFromTiles(scn.width, scn.height, scn.tiles, (id) => {
    const mega = megatileForTile(tileset, id);
    return mega < 0 ? null : tileset.megatileFlags.subarray(mega * 16, mega * 16 + 16);
  });
  const { boxes, resource } = blockers(scn, units);
  const blocking = { buildings: 0, resources: 0 };
  for (const r of resource) blocking[r ? "resources" : "buildings"]++;
  blockBoxes(ground, boxes);
  return { ground, blocking };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const tileOf = (cell: number, w: number): TilePoint => ({ x: Math.floor((cell % w) / CELLS_PER_TILE), y: Math.floor(Math.floor(cell / w) / CELLS_PER_TILE) });

/* ── The analysis ─────────────────────────────────────────────── */

export interface LayoutFiles { tileset: Tileset; units: UnitsDat | null; speeds: SpeedTables | null }

/**
 * Everything the report says about a map, from its scenario and the game's files. Throws a CliError (exit 2) for a map
 * with fewer than two start locations.
 */
export function analyzeLayout(scn: Scenario, files: LayoutFiles): Layout {
  const places = startPlaces({ scenario: scn });
  if (places.length < 2) throw new CliError(t("The map has {n, plural, one {# start location} other {# start locations}}: map analyze compares starts, and needs two or more.", { n: places.length }), t("A melee map has a start location for every player (the Start Location unit in the editor)."), 2);
  const { ground, blocking } = mapGround(scn, files.tileset, files.units);
  const { w, h } = ground;
  const open = openCells(ground);
  const clear = clearance(open, w, h);
  const passable = passableCells(clear);
  // The walls of a passage: everything closed, but for a patch standing alone and under `ROCK_TILES` tiles in area (a
  // rock, a doodad, a geyser or a few fields in the open), which a unit walks round on either side.
  const walls = withoutSpecks(open, w, h, ROCK_TILES * CELLS_PER_TILE * CELLS_PER_TILE);
  const cellAt = (px: number, py: number) => nearestCell(passable, w, h, px / CELL_PX, py / CELL_PX);
  const startCells = places.map((p) => cellAt(p.x, p.y));
  const fields = startCells.map((c) => distancesFrom(passable, w, h, c));
  const groundTiles = (i: number, cell: number): number | null => (cell >= 0 && fields[i][cell] >= 0 ? round1(stepsToPx(fields[i][cell]) / TILE) : null);
  const skip = END_TILES * CELLS_PER_TILE;

  // Bases: the resources grouped; a main is the base nearest a start location within balance's 12 tiles.
  const resources: Resource[] = [];
  const minerals = new Set<number>(MINERAL_FIELD_IDS);
  for (const u of scn.units) {
    const mineral = minerals.has(u.unitId);
    if (!mineral && u.unitId !== VESPENE_GEYSER) continue;
    resources.push({ kind: mineral ? "mineral" : "geyser", x: u.x, y: u.y, amount: u.validStates & UnitUsed.Resources ? u.resourceAmount : mineral ? DEFAULT_MINERALS : DEFAULT_GAS });
  }
  // Two resources are of one base when a unit walks between them about as directly as the straight line.
  const fronts = resources.map((r) => nearestCell(open, w, h, r.x / CELL_PX, r.y / CELL_PX, 3 * CELLS_PER_TILE));
  const reach = new Map<number, Map<number, number>>();
  const near = (a: number, b: number) => {
    if (fronts[a] < 0 || fronts[b] < 0) return false;
    const straight = Math.hypot(resources[a].x - resources[b].x, resources[a].y - resources[b].y);
    if (!reach.has(a)) reach.set(a, distancesWithin(open, w, h, fronts[a], ((BASE_LINK + BASE_DETOUR) * TILE / CELL_PX) * 5));
    const d = reach.get(a)!.get(fronts[b]);
    return d !== undefined && stepsToPx(d) <= straight + BASE_DETOUR * TILE;
  };
  const bases: (Base & { hallCell: number; cx: number; cy: number })[] = clusterResources(resources, near).map((group) => {
    const cx = group.reduce((t, r) => t + r.x, 0) / group.length, cy = group.reduce((t, r) => t + r.y, 0) / group.length;
    const hallCell = nearestWhere(w, h, cx / CELL_PX, cy / CELL_PX, 12 * CELLS_PER_TILE, (i) => passable[i] === 1 && clear[i] >= HALL_CLEARANCE);
    const of = (k: Resource["kind"]) => group.filter((r) => r.kind === k);
    return {
      at: { x: Math.floor(cx / TILE), y: Math.floor(cy / TILE) }, hall: hallCell >= 0 ? tileOf(hallCell, w) : null, hallCell, cx, cy,
      fields: of("mineral").length, minerals: of("mineral").reduce((t, r) => t + r.amount, 0), geysers: of("geyser").length, gas: of("geyser").reduce((t, r) => t + r.amount, 0), mainOf: null as number | null,
    };
  });
  // A start's main: the bases whose middle is within balance's 12 tiles of it (the nearest start's, where two are).
  for (const b of bases) {
    let dist = 12 * TILE;
    for (const p of places) { const d = Math.hypot(p.x - b.cx, p.y - b.cy); if (d <= dist) { dist = d; b.mainOf = p.player; } }
  }

  // Each start's natural: the base nearest on foot that is nobody's main.
  const mains = mainResources({ scenario: scn }, places);
  const naturalOf = places.map((_, i) => {
    let best = -1, bestD = Infinity;
    bases.forEach((b, k) => {
      if (b.mainOf !== null || b.hallCell < 0) return;
      const d = fields[i][b.hallCell];
      if (d >= 0 && d < bestD) { bestD = d; best = k; }
    });
    return best;
  });
  const naturalPaths = places.map((_, i) => (naturalOf[i] >= 0 ? pathTo(fields[i], passable, w, h, bases[naturalOf[i]].hallCell) : null));
  const ramps: (Narrow & { cell: number } | null)[] = naturalPaths.map((path) => {
    const n = path ? narrowestOn(path, walls, w, h, skip) : null;
    return n ? { width: round1(n.width / CELLS_PER_TILE), at: tileOf(n.cell, w), cell: n.cell } : null;
  });

  const starts: StartLayout[] = places.map((p, i) => {
    const k = naturalOf[i], b = k >= 0 ? bases[k] : null;
    const cell = startCells[i] >= 0 ? startCells[i] : Math.floor(p.y / CELL_PX) * w + Math.floor(p.x / CELL_PX);
    const levels = [0, 0, 0];
    const cx = p.x / CELL_PX, cy = p.y / CELL_PX, r = AROUND_TILES * CELLS_PER_TILE;
    for (let y = Math.max(0, Math.floor(cy - r)); y < Math.min(h, Math.ceil(cy + r)); y++) {
      for (let x = Math.max(0, Math.floor(cx - r)); x < Math.min(w, Math.ceil(cx + r)); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 > r * r || !ground.walkable[y * w + x]) continue;
        levels[ground.level[y * w + x]]++;
      }
    }
    const walkable = levels[0] + levels[1] + levels[2];
    const ramp = ramps[i];
    return {
      player: p.player, x: p.x, y: p.y, tile: { x: Math.floor(p.x / TILE), y: Math.floor(p.y / TILE) }, clock: p.clock,
      side: sideOf(p.x / TILE, p.y / TILE, scn.width, scn.height), level: (["low", "mid", "high"] as const)[ground.level[cell] ?? 0],
      main: mains[i],
      natural: b ? {
        base: k, at: b.hall ?? b.at, ground: groundTiles(i, b.hallCell)!, air: round1(Math.hypot(b.hallCell % w * CELL_PX + 4 - p.x, Math.floor(b.hallCell / w) * CELL_PX + 4 - p.y) / TILE),
        fields: b.fields, minerals: b.minerals, geysers: b.geysers, gas: b.gas,
        sharedWith: places.filter((_, j) => j !== i && naturalOf[j] === k).map((q) => q.player),
      } : null,
      wayOut: ramp ? { width: ramp.width, at: ramp.at } : null,
      around: { radius: AROUND_TILES, high: pct(levels[2], walkable), mid: pct(levels[1], walkable), low: pct(levels[0], walkable) },
    };
  });

  // Every pair: the walk, the straight line, the narrowest passage on the way.
  const speeds: UnitSpeed[] = files.speeds ? TIMED_UNITS.map((u) => ({ id: u.id, name: u.name, pixelsPerFrame: walkSpeed(files.speeds!, u.id) ?? 0 })).filter((s) => s.pixelsPerFrame > 0) : [];
  const pairs: PairLayout[] = [], pairPaths: number[][] = [];
  const matrix: (number | null)[][] = places.map(() => places.map(() => null));
  for (let i = 0; i < places.length; i++) {
    for (let j = i + 1; j < places.length; j++) {
      const a = places[i], b = places[j];
      const air = round1(Math.hypot(a.x - b.x, a.y - b.y) / TILE);
      const steps = startCells[j] >= 0 ? fields[i][startCells[j]] : -1;
      const path = steps >= 0 ? pathTo(fields[i], passable, w, h, startCells[j]) : [];
      pairPaths.push(path);
      const px = steps >= 0 ? stepsToPx(steps) : null;
      matrix[i][j] = matrix[j][i] = px;
      const n = path.length ? narrowestOn(path, walls, w, h, skip) : null;
      let narrowest: Narrow | null = null;
      if (n) {
        const at = tileOf(n.cell, w);
        const near = [i, j].find((k) => ramps[k] && Math.hypot(ramps[k]!.at.x - at.x, ramps[k]!.at.y - at.y) <= SAME_PLACE_TILES);
        narrowest = { width: round1(n.width / CELLS_PER_TILE), at, ...(near !== undefined ? { wayOutOf: places[near].player } : {}) };
      }
      pairs.push({
        a: a.player, b: b.player, ground: px === null ? null : round1(px / TILE), air, ratio: px === null || !air ? null : Math.round((px / TILE / air) * 100) / 100,
        seconds: px === null || !speeds.length ? null : Object.fromEntries(speeds.map((s) => [s.name, round1((px / s.pixelsPerFrame) * FRAME_S)])),
        narrowest,
      });
    }
  }
  const joined = pairs.filter((p) => p.ground !== null).sort((x, y) => x.ground! - y.ground!);
  const shortest = joined[0] ?? null, longest = joined.at(-1) ?? null;
  const spread = spreadOf(joined.map((p) => p.ground!));
  const ranks = rankSpread(matrix);

  // The map as a whole.
  let walkable = 0;
  const levels = [0, 0, 0];
  for (let i = 0; i < w * h; i++) if (ground.walkable[i]) { walkable++; levels[ground.level[i]]++; }
  let buildable = 0;
  for (let t = 0; t < scn.width * scn.height; t++) {
    const id = scn.tiles[t] ?? 0, group = files.tileset.groups[tileGroupOf(id)];
    if (group && groupBuildable(group) && megatileForTile(files.tileset, id) > 0) buildable++;
  }
  const terrain: TerrainShare = {
    walkable: pct(walkable, w * h), unwalkable: Math.round((100 - pct(walkable, w * h)) * 10) / 10, buildable: pct(buildable, scn.width * scn.height),
    high: pct(levels[2], walkable), mid: pct(levels[1], walkable), low: pct(levels[0], walkable),
  };

  const layout: Layout = {
    size: { width: scn.width, height: scn.height }, grid: { cellPixels: CELL_PX, unitRadius: UNIT_RADIUS },
    starts, pairs, shortest, longest, spread, rankSpread: ranks, terrain,
    bases: bases.map(({ hallCell: _c, cx: _x, cy: _y, ...b }) => b), blocking, speeds, verdicts: [],
    paths: { pairs: pairPaths, naturals: naturalPaths },
  };
  layout.verdicts = verdictsOf(layout);
  return layout;
}

/** The cell nearest (x, y) by rings, within `reach` cells, that `ok` accepts; −1 when none does. */
function nearestWhere(w: number, h: number, x: number, y: number, reach: number, ok: (cell: number) => boolean): number {
  const cx = Math.min(w - 1, Math.max(0, Math.floor(x))), cy = Math.min(h - 1, Math.max(0, Math.floor(y)));
  for (let r = 0; r <= reach; r++) {
    let best = -1, bestD = Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h || !ok(ny * w + nx)) continue;
      if (dx * dx + dy * dy < bestD) { bestD = dx * dx + dy * dy; best = ny * w + nx; }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/* ── The verdicts ─────────────────────────────────────────────── */

const listed = (xs: readonly (string | number)[]) => (xs.length < 2 ? String(xs[0] ?? "") : t("{list} and {last}", { list: xs.slice(0, -1).join(", "), last: String(xs.at(-1)) }));
const starts = (players: readonly number[]) => t("{n, plural, one {start} other {starts}} {list}", { n: players.length, list: listed(players) });
const tilesText = (n: number) => (Math.round(n * 10) === 10 ? t("{n} tile", { n: num(1) }) : t("{n} tiles", { n: num(Math.round(n * 10) / 10) }));
/** "the starts' middle", or "start 3's": what a start was compared with. */
const comparedWith = (other: number | null, player: () => number) => (other === null ? t("the starts' middle") : t("start {n}'s", { n: player() }));
const percent = (f: number) => `${Math.round(f * 100)}%`;

/** The middle value (the mean of the two middle ones for an even count). */
export function medianOf(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * The values `limit` or more from the others: with two, the larger against the smaller (`other` its index); with more,
 * each against the median (`other` null). `by` is signed, `against` what it was compared with.
 */
export function apartFrom(values: readonly number[], limit: number): { index: number; by: number; against: number; other: number | null }[] {
  if (values.length < 2) return [];
  if (values.length === 2) {
    const hi = values[0] >= values[1] ? 0 : 1, lo = 1 - hi;
    return values[hi] - values[lo] >= limit ? [{ index: hi, by: values[hi] - values[lo], against: values[lo], other: lo }] : [];
  }
  const median = medianOf(values);
  return values.flatMap((v, index) => (Math.abs(v - median) >= limit ? [{ index, by: v - median, against: median, other: null }] : []));
}

/** The value most starts have, and the starts that differ from it. */
function oddOnes<T>(values: readonly T[], players: readonly number[]): { usual: T; odd: number[] } {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { usual, odd: players.filter((_, i) => values[i] !== usual) };
}

/** The verdict lines: facts, each with its number, warned when past the rule documented for it. */
export function verdictsOf(l: Layout): Verdict[] {
  const out: Verdict[] = [];
  const ok = (text: string) => out.push({ level: "ok", text }), warn = (text: string) => out.push({ level: "warn", text }), info = (text: string) => out.push({ level: "info", text });
  const players = l.starts.map((s) => s.player);

  // Ground between the starts.
  const apart = l.pairs.filter((p) => p.ground === null);
  if (l.terrain.walkable === 0) warn(t("No ground on the map is walkable: its tiles are blank or all cliff and water."));
  else if (apart.length === l.pairs.length) warn(t("No two starts are joined by ground: an island map, played by air or drop."));
  else if (apart.length) warn(t("No ground joins {pairs}.", { pairs: listed(apart.map((p) => t("{a} and {b}", { a: p.a, b: p.b }))) }));
  if (l.shortest && l.longest && apart.length < l.pairs.length) {
    if (l.pairs.length === 1) info(t("One pair of starts: {tiles} by ground, {ratio}× the straight line.", { tiles: tilesText(l.shortest.ground!), ratio: String(l.shortest.ratio) }));
    else if (l.spread !== null && l.spread <= FAIR_WITHIN) ok(t("Ground distances between starts within {spread} of each other ({lo} to {hi} tiles).", { spread: percent(l.spread), lo: num(Math.round(l.shortest.ground!)), hi: num(Math.round(l.longest.ground!)) }));
    else if (l.rankSpread && l.rankSpread.spread <= FAIR_WITHIN) ok(t("Every start's walks to its opponents match the others', nearest to farthest, within {spread}; near and far pairs differ by {apart}.", { spread: percent(l.rankSpread.spread), apart: percent(l.spread ?? 0) }));
    else if (l.rankSpread) {
      const r = l.rankSpread, near = l.starts[r.near], far = l.starts[r.far];
      const nth = r.rank === 1 ? t("nearest opponent") : t("{rank, select, 2 {second} 3 {third} 4 {fourth} 5 {fifth} 6 {sixth} 7 {seventh} other {{rank}th}} nearest opponent", { rank: r.rank });
      const d = (i: number) => l.pairs.filter((p) => (p.a === l.starts[i].player || p.b === l.starts[i].player) && p.ground !== null).map((p) => p.ground!).sort((a, b) => a - b)[r.rank - 1];
      warn(t("Start {far}'s {nth} is {spread} farther than start {near}'s ({farTiles} against {nearTiles} tiles).", { far: far.player, nth, spread: percent(r.spread), near: near.player, farTiles: num(Math.round(d(r.far))), nearTiles: num(Math.round(d(r.near))) }));
    } else if (l.spread !== null) warn(t("Ground distances between starts differ by {spread} ({lo} to {hi} tiles).", { spread: percent(l.spread), lo: num(Math.round(l.shortest.ground!)), hi: num(Math.round(l.longest.ground!)) }));
  }

  // Mains.
  const empty = l.starts.filter((s) => !s.main.fields).map((s) => s.player);
  if (empty.length) warn(t("No mineral fields within 12 tiles of {starts}.", { starts: starts(empty) }));
  else {
    const f = oddOnes(l.starts.map((s) => s.main.fields), players);
    for (const p of f.odd) warn(t("Start {p}'s main has {n, plural, one {# mineral field} other {# mineral fields}}, the others {usual}.", { p, n: l.starts.find((s) => s.player === p)!.main.fields, usual: num(f.usual) }));
    const g = oddOnes(l.starts.map((s) => s.main.geysers), players);
    for (const p of g.odd) warn(t("Start {p}'s main has {n, plural, one {# geyser} other {# geysers}}, the others {usual}.", { p, n: l.starts.find((s) => s.player === p)!.main.geysers, usual: num(g.usual) }));
    const m = oddOnes(l.starts.map((s) => s.main.minerals + s.main.gas), players);
    if (!f.odd.length && !g.odd.length) {
      if (m.odd.length) for (const p of m.odd) { const s = l.starts.find((x) => x.player === p)!; warn(t("Start {p}'s main holds {minerals} minerals and {gas} gas, unlike the others.", { p, minerals: num(s.main.minerals), gas: num(s.main.gas) })); }
      else ok(t("Every main has {fields, plural, one {# mineral field} other {# mineral fields}} and {geysers, plural, one {# geyser} other {# geysers}}, {minerals} minerals and {gas} gas.", { fields: l.starts[0].main.fields, geysers: l.starts[0].main.geysers, minerals: num(l.starts[0].main.minerals), gas: num(l.starts[0].main.gas) }));
    }
  }

  // Naturals.
  const none = l.starts.filter((s) => !s.natural).map((s) => s.player);
  if (none.length === l.starts.length) info(t("No start has a natural: there is no other base to walk to."));
  else {
    if (none.length) warn(t("{n, plural, one {Start {list} has} other {Starts {list} have}} no natural: no other base can be walked to.", { n: none.length, list: listed(none) }));
    const seen = new Set<number>();
    for (const s of l.starts) {
      if (!s.natural?.sharedWith.length || seen.has(s.natural.base)) continue;
      seen.add(s.natural.base);
      warn(t("Starts {list} have the same nearest base at ({x}, {y}) for a natural.", { list: listed([s.player, ...s.natural.sharedWith].sort((a, b) => a - b)), x: s.natural.at.x, y: s.natural.at.y }));
    }
    const with_ = l.starts.filter((s) => s.natural);
    if (with_.length >= 2) {
      const odd = apartFrom(with_.map((s) => s.natural!.ground), NATURAL_TILES);
      for (const o of odd) {
        const s = with_[o.index];
        warn(t("Start {p}'s natural is {by} tiles {way, select, farther {farther} other {nearer}} than {other} ({tiles} against {against} by ground).", { p: s.player, by: num(Math.round(Math.abs(o.by))), way: o.by > 0 ? "farther" : "nearer", other: comparedWith(o.other, () => with_[o.other!].player), tiles: num(Math.round(s.natural!.ground)), against: num(Math.round(o.against)) }));
      }
      const ds = with_.map((s) => s.natural!.ground);
      const [lo, hi] = [Math.round(Math.min(...ds)), Math.round(Math.max(...ds))];
      if (!odd.length) ok(lo === hi ? t("Naturals {n} tiles from their mains by ground.", { n: num(lo) }) : t("Naturals {lo} to {hi} tiles from their mains by ground.", { lo: num(lo), hi: num(hi) }));
      const gasless = with_.filter((s) => !s.natural!.geysers).map((s) => s.player);
      if (gasless.length === with_.length) info(t("No natural has gas."));
      else for (const p of gasless) warn(t("Start {p} has no gas at its natural.", { p }));
    }
  }

  // The way from each main to its natural, and chokes between mains.
  const ramps = l.starts.filter((s) => s.wayOut);
  if (ramps.length >= 2) {
    const widths = ramps.map((s) => s.wayOut!.width);
    const odd = apartFrom(widths, WAY_OUT_TILES);
    for (const o of odd) {
      const s = ramps[o.index];
      warn(t("Start {p}'s way out is {width} at its narrowest, {other} {against}.", { p: s.player, width: tilesText(s.wayOut!.width), other: comparedWith(o.other, () => ramps[o.other!].player), against: tilesText(o.against) }));
    }
    const lo = Math.min(...widths), hi = Math.max(...widths);
    if (!odd.length) ok(lo === hi ? t("Every main's way out is {width} at its narrowest.", { width: tilesText(lo) }) : t("Every main's way out is {lo} to {hi} at its narrowest.", { lo: num(lo), hi: tilesText(hi) }));
  }
  for (const p of l.pairs) {
    if (!p.narrowest || p.narrowest.width >= CHOKE_NARROW) continue;
    warn(p.narrowest.wayOutOf
      ? t("A {width}-tile choke between starts {a} and {b} at ({x}, {y}), start {of}'s way out.", { width: num(p.narrowest.width), a: p.a, b: p.b, x: p.narrowest.at.x, y: p.narrowest.at.y, of: p.narrowest.wayOutOf })
      : t("A {width}-tile choke between starts {a} and {b} at ({x}, {y}).", { width: num(p.narrowest.width), a: p.a, b: p.b, x: p.narrowest.at.x, y: p.narrowest.at.y }));
  }

  // Raised ground round the mains (mid or high: a tileset's "high" terrain is its middle level in some).
  const raised = l.starts.map((s) => s.around.high + s.around.mid);
  for (const o of apartFrom(raised, HIGH_POINTS)) {
    const s = l.starts[o.index];
    warn(t("Start {p} has {raised}% raised ground (mid or high) within {around} tiles of it, {other} {against}%.", { p: s.player, raised: Math.round(raised[o.index]), around: AROUND_TILES, other: o.other === null ? t("the starts' middle") : t("start {n}", { n: l.starts[o.other].player }), against: Math.round(o.against) }));
  }
  return out;
}

/* ── The picture ──────────────────────────────────────────────── */

/** The colours over the map: the walks between starts, the walks to the naturals, the narrowest points, the ways out. */
export const PICTURE_COLORS = { pair: "#ffffff", natural: "#ffd75f", choke: "#ff3b30", wayOut: "#ff9f0a" } as const;

const rgbOf = (hex: string): [number, number, number] => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function blend(pic: Picture, x: number, y: number, [r, g, b]: [number, number, number], a: number): void {
  if (x < 0 || y < 0 || x >= pic.width || y >= pic.height) return;
  const at = (y * pic.width + x) * 4;
  pic.pixels[at] = Math.round(pic.pixels[at] * (1 - a) + r * a);
  pic.pixels[at + 1] = Math.round(pic.pixels[at + 1] * (1 - a) + g * a);
  pic.pixels[at + 2] = Math.round(pic.pixels[at + 2] * (1 - a) + b * a);
}

/** A walk drawn cell by cell, each cell the pixels it covers at `scale` pixels a tile (at least one). */
export function drawPath(pic: Picture, path: readonly number[], cellsWide: number, scale: number, color: string, alpha = 0.85): void {
  const c = rgbOf(color), per = scale / CELLS_PER_TILE, side = Math.max(1, Math.round(per));
  const done = new Set<number>();
  for (const cell of path) {
    const x0 = Math.floor((cell % cellsWide) * per), y0 = Math.floor(Math.floor(cell / cellsWide) * per);
    for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) {
      const k = y * pic.width + x;
      if (done.has(k)) continue;
      done.add(k);
      blend(pic, x, y, c, alpha);
    }
  }
}

/** A circle's outline round a point in tiles, `radius` tiles, `thickness` pixels. */
export function drawRing(pic: Picture, at: { x: number; y: number }, radius: number, scale: number, color: string, thickness = Math.max(1, Math.round(scale / 4))): void {
  const c = rgbOf(color), cx = at.x * scale, cy = at.y * scale, r = radius * scale;
  for (let y = Math.floor(cy - r - thickness); y <= Math.ceil(cy + r + thickness); y++) {
    for (let x = Math.floor(cx - r - thickness); x <= Math.ceil(cx + r + thickness); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (Math.abs(d - r) <= thickness / 2) blend(pic, x, y, c, 1);
    }
  }
}

/** A square's outline round a point in tiles, `half` tiles from its middle to a side, `thickness` pixels. */
export function drawSquare(pic: Picture, at: { x: number; y: number }, half: number, scale: number, color: string, thickness = Math.max(1, Math.round(scale / 4))): void {
  const c = rgbOf(color);
  const x0 = Math.round((at.x - half) * scale), y0 = Math.round((at.y - half) * scale), x1 = Math.round((at.x + half) * scale), y1 = Math.round((at.y + half) * scale);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (x - x0 < thickness || x1 - 1 - x < thickness || y - y0 < thickness || y1 - 1 - y < thickness) blend(pic, x, y, c, 1);
  }
}

/** The map as `map preview` draws it, with the walks, the narrowest points, the ways out and the naturals over it. */
export function layoutPicture(map: OpenedMap | Scenario, files: LayoutFiles, l: Layout, scale = DEFAULT_PNG_SCALE): Picture {
  const scn = "scenario" in map ? map.scenario : map;
  const { picture } = mapPicture(scn, { tileset: files.tileset, units: files.units }, { scale });
  const cellsWide = scn.width * CELLS_PER_TILE;
  for (const p of l.paths.naturals) if (p) drawPath(picture, p, cellsWide, scale, PICTURE_COLORS.natural);
  for (const p of l.paths.pairs) drawPath(picture, p, cellsWide, scale, PICTURE_COLORS.pair);
  const thick = Math.max(1, Math.round(scale / 4)), mid = (t: TilePoint) => ({ x: t.x + 0.5, y: t.y + 0.5 });
  for (const s of l.starts) {
    if (s.natural) drawRing(picture, mid(s.natural.at), 4, scale, playerColor(scn, s.player), thick + 1);
    if (s.wayOut) drawSquare(picture, mid(s.wayOut.at), Math.max(1.5, s.wayOut.width / 2 + 0.5), scale, PICTURE_COLORS.wayOut, thick);
  }
  for (const p of l.pairs) {
    if (p.narrowest && !p.narrowest.wayOutOf) drawSquare(picture, mid(p.narrowest.at), Math.max(1.5, p.narrowest.width / 2 + 0.5), scale, PICTURE_COLORS.choke, thick);
  }
  return picture;
}

/** A player's (1–8) colour as the map gives it, the start locations' frames' colour in the preview. */
const playerColor = (scn: Scenario, player: number): string => displayColorHex(scn.playerColors, scn.playerRgb, player - 1);

/* ── The command ─────────────────────────────────────────────── */

export interface AnalyzeOptions { json?: boolean; picture?: string; scale?: string; starcraft?: string; all?: boolean }

export interface AnalyzeReport extends Omit<Layout, "paths"> {
  file: string;
  name: string;
  tileset: string;
  copy: { folder: string; kind: "remastered" | "classic"; label: string };
  picture?: { width: number; height: number; scale: number } & Written;
  ms: { copy: number; analyze: number; total: number };
}

/** The game's files the analysis reads, out of the copy: the map's tileset, units.dat and what the speeds come from. */
export async function loadLayoutFiles(scn: Scenario, files: GameFiles): Promise<LayoutFiles> {
  const [tileset, units] = await Promise.all([readTileset(files, tilesetOf(scn)), readUnitsDat(files)]);
  return { tileset, units, speeds: await readSpeedTables(files, units) };
}

/** The report: the layout without its walks' cells, with the file, the map's name and where the game's files came from. */
export function layoutReport(input: Pick<Input, "path" | "name">, scn: Scenario, files: Pick<GameFiles, "folder" | "kind" | "label">, layout: Layout, ms: AnalyzeReport["ms"]): AnalyzeReport {
  const { paths: _paths, ...rest } = layout;
  return {
    file: input.path, name: gameText(scenarioName(scn) ?? "") || input.name, tileset: tilesetOf(scn),
    copy: { folder: files.folder, kind: files.kind, label: files.label }, ...rest, ms,
  };
}

/**
 * `scmjs map analyze`: the copy of the game opened, the map's ground read and analysed, the report's lines, and the
 * picture written when `--picture` names a file (`-` for standard output, the words then on standard error).
 */
export async function analyzeMap(input: Input, map: OpenedMap, o: AnalyzeOptions, stdout: Writable = process.stdout): Promise<{ report: AnalyzeReport; lines: string[] }> {
  const t0 = performance.now();
  const scn = map.scenario;
  if (o.scale !== undefined && o.picture === undefined) throw new CliError(t("--scale is the picture's: give --picture a file to write too"), null, 2);
  const scale = o.scale === undefined ? DEFAULT_PNG_SCALE : Number(o.scale);
  if (!(PNG_SCALES as readonly number[]).includes(scale)) throw new CliError(t("--scale takes {scales}, not \"{value}\"", { scales: PNG_SCALES.join(", "), value: String(o.scale) }), null, 2);
  const count = startPlaces(map).length;
  if (count < 2) throw new CliError(t("{name} has {n, plural, one {# start location} other {# start locations}}: map analyze compares starts, and needs two or more.", { name: input.name, n: count }), t("A melee map has a start location for every player (the Start Location unit in the editor)."), 2);

  const files = await openGameFiles(o.starcraft, t("Which ground is walkable comes from your installation's tileset"));
  const layoutFiles = await loadLayoutFiles(scn, files);
  const t1 = performance.now();
  const layout = analyzeLayout(scn, layoutFiles);
  const t2 = performance.now();
  const report = layoutReport(input, scn, files, layout, { copy: Math.round(t1 - t0), analyze: Math.round(t2 - t1), total: 0 });
  if (o.picture !== undefined) {
    const pic = layoutPicture(map, layoutFiles, layout, scale);
    const written = await writeOutput(encodePng(pic.pixels, pic.width, pic.height), o.picture, stdout);
    report.picture = { width: pic.width, height: pic.height, scale, ...written };
  }
  report.ms.total = Math.round(performance.now() - t0);
  return { report, lines: o.json ? [] : layoutLines(report, files, !!o.all) };
}

/* ── The words ────────────────────────────────────────────────── */

const MARK: Record<VerdictLevel, string> = { ok: mark.ok, warn: mark.warn, info: mark.info };
const t0f = (n: number) => num(Math.round(n));
/** "9 fields + gas", "7 fields, no gas", "15 fields + 2 gas", "a geyser alone", "no resources". */
export const resourcesText = (fields: number, geysers: number) => (!fields && !geysers ? t("no resources") : !fields
  ? t("{n, plural, one {a geyser alone} other {# geysers alone}}", { n: geysers })
  : geysers === 0 ? t("{n, plural, one {# field} other {# fields}}, no gas", { n: fields })
    : geysers === 1 ? t("{n, plural, one {# field} other {# fields}} + gas", { n: fields })
      : t("{n, plural, one {# field} other {# fields}} + {geysers} gas", { n: fields, geysers }));
/** Where a start is (`sideOf`) and its ground's level, as the report says them; the JSON keeps the English words. */
const PLACE_WORDS = [msg("top left"), msg("top"), msg("top right"), msg("left"), msg("middle"), msg("right"), msg("bottom left"), msg("bottom"), msg("bottom right"), msg("low"), msg("mid"), msg("high")];
const placeWord = (word: string) => (PLACE_WORDS.includes(word) ? translate(word) : word);
/** The units the walks are timed for, as the table's heads say them (the JSON keys stay English). */
const UNIT_WORDS = [msg("Zergling"), msg("Marine"), msg("Zealot")];
const unitWord = (name: string) => (UNIT_WORDS.includes(name) ? translate(name) : name);

/** The report as the terminal shows it. */
export function layoutLines(r: AnalyzeReport, files: Pick<GameFiles, "label">, all = false): string[] {
  const out: string[] = [];
  const warned = r.verdicts.some((v) => v.level === "warn");
  out.push(`${warned ? mark.warn : mark.ok} ${pc.bold(r.name)}  ${pc.dim(`${num(r.size.width)} × ${num(r.size.height)}${dot}${r.tileset}${dot}${t("{n, plural, one {# start location} other {# start locations}}", { n: r.starts.length })}${dot}${t("{n, plural, one {# base} other {# bases}}", { n: r.bases.length })}${dot}${files.label}${dot}${(r.ms.total / 1000).toFixed(1)} s`)}`);

  out.push("", ...table([
    [t("Start"), t("Main"), t("Natural"), "", t("Way out"), t("Height")].map((c) => pc.dim(c)),
    ...r.starts.map((s) => [
      `${s.player} ${pc.dim(t("{side}, {clock} o'clock", { side: placeWord(s.side), clock: s.clock }))}`,
      resourcesText(s.main.fields, s.main.geysers),
      s.natural ? `${t0f(s.natural.ground)} ${pc.dim(t("(air {air})", { air: t0f(s.natural.air) }))}` : pc.yellow(t("none")),
      s.natural ? `${resourcesText(s.natural.fields, s.natural.geysers)}${s.natural.sharedWith.length ? pc.dim(t(", also {list}'s", { list: listed(s.natural.sharedWith) })) : ""}` : "",
      s.wayOut ? `${num(s.wayOut.width)} ${pc.dim(t("at {x}, {y}", { x: s.wayOut.at.x, y: s.wayOut.at.y }))}` : "–",
      `${t("on {level}", { level: placeWord(s.level) })}${pc.dim(s.around.high ? t(", raised {raised}% (high {high}%)", { raised: Math.round(s.around.high + s.around.mid), high: Math.round(s.around.high) }) : t(", raised {raised}%", { raised: Math.round(s.around.high + s.around.mid) }))}`,
    ]),
  ], 2));

  // The walks: a table of every pair when there are few (or --all), else the matrix and the extremes.
  const speedNames = r.speeds.map((s) => s.name);
  const pairRow = (p: PairLayout) => [
    `${p.a} ↔ ${p.b}`, p.ground === null ? pc.yellow(t("no ground")) : t("{n} tiles", { n: t0f(p.ground) }), pc.dim(t("air {air}", { air: t0f(p.air) })), p.ratio === null ? "" : `${p.ratio.toFixed(2)}×`,
    ...speedNames.map((n) => (p.seconds ? `${p.seconds[n].toFixed(1)} s` : "")),
    p.narrowest ? `${num(p.narrowest.width)} ${pc.dim(p.narrowest.wayOutOf ? t("at {x}, {y}, {of}'s way out", { x: p.narrowest.at.x, y: p.narrowest.at.y, of: p.narrowest.wayOutOf }) : t("at {x}, {y}", { x: p.narrowest.at.x, y: p.narrowest.at.y }))}` : "",
  ];
  const head = [t("Pair"), t("Ground"), "", t("Ratio"), ...speedNames.map(unitWord), t("Narrowest")].map((c) => pc.dim(c));
  if (all || r.pairs.length <= 6) out.push("", ...table([head, ...r.pairs.map(pairRow)], 2));
  else {
    const players = r.starts.map((s) => s.player);
    const cell = (a: number, b: number) => { if (a === b) return "–"; const p = r.pairs.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a))!; return p.ground === null ? "·" : t0f(p.ground); };
    out.push("", pc.dim(`  ${t("Tiles by ground")}`), ...table([["", ...players.map(String)].map((c) => pc.dim(c)), ...players.map((a) => [pc.dim(String(a)), ...players.map((b) => cell(a, b))])], 2));
    out.push("", ...table([head, ...[r.shortest, r.longest].filter((p): p is PairLayout => !!p).map(pairRow)], 2));
  }
  if (r.spread !== null && r.shortest && r.longest && r.pairs.length > 1) {
    out.push(pc.dim(`  ${t("Shortest {a} ↔ {b}, longest {c} ↔ {d}: {spread} apart", { a: r.shortest.a, b: r.shortest.b, c: r.longest.a, d: r.longest.b, spread: percent(r.spread) })}${r.speeds.length ? "" : dot + t("no walking speeds (the copy's units.dat, flingy.dat or iscript.bin could not be read), so tiles only")}`));
  } else if (!r.speeds.length) out.push(pc.dim(`  ${t("No walking speeds (the copy's units.dat, flingy.dat or iscript.bin could not be read), so tiles only")}`));

  const g = r.terrain;
  out.push("", `  ${pc.dim(t("Terrain"))}  ${t("walkable {n}%", { n: g.walkable })} ${pc.dim(t("(high {high}%, mid {mid}%, low {low}%)", { high: g.high, mid: g.mid, low: g.low }))}${dot}${t("buildable {n}%", { n: g.buildable })}${dot}${t("unwalkable {n}%", { n: g.unwalkable })}`);
  if (r.blocking.buildings) out.push(`  ${t("Standing {n, plural, one {# building} other {# buildings}} in the way, besides the resources", { n: r.blocking.buildings })}`);

  if (all && r.bases.length) {
    out.push("", ...table([
      [t("Base"), t("Fields"), t("Minerals"), t("Geysers"), t("Gas"), ""].map((c) => pc.dim(c)),
      ...r.bases.map((b) => [`(${b.at.x}, ${b.at.y})`, String(b.fields), num(b.minerals), String(b.geysers), num(b.gas), b.mainOf ? pc.dim(t("start {n}'s main", { n: b.mainOf })) : r.starts.some((s) => s.natural && r.bases[s.natural.base] === b) ? pc.dim(t("natural of {list}", { list: listed(r.starts.filter((s) => s.natural && r.bases[s.natural.base] === b).map((s) => s.player)) })) : ""]),
    ], 2));
  }

  out.push("", ...r.verdicts.map((v) => `${MARK[v.level]} ${v.text}`));
  if (r.picture) out.push("", pc.dim(`  ${t("Picture: {width} × {height} PNG, {scale, plural, one {# pixel} other {# pixels}} a tile, written to {path}", { width: r.picture.width, height: r.picture.height, scale: r.picture.scale, path: r.picture.path === STDIO ? t("standard output") : r.picture.path })}${dot}${size(r.picture.bytes)}`));
  return out;
}
