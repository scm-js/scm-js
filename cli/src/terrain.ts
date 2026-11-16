/**
 * Terrain and doodads for a program: what `scmjs map terrain` and `scmjs map doodads` list, and what the terrain and
 * doodad edits of `scmjs map edit` (`mapedit.ts`) lay. All of it goes through the editor's plugin host with the
 * person's own copy of the game behind it (`run.ts#giveHostGame`): the terrain types are the tileset's, the brush is
 * the editor's isometric one, so a cliff or a shore forms where two terrains meet, and a doodad goes where StarEdit's
 * rule lets it.
 *
 * Coordinates are tiles. A diamond of the isometric lattice is four tiles wide and two high, centred on the corner
 * of tile (2x, y), so an area is painted to the nearest diamond and its edge is the brush's, not the rectangle's.
 */
import type { OpenedMap } from "../../src/editor/mapFile";
import { t } from "./i18n";
import { areaRect, tileRect, TILE, type Area, type TileRect } from "./objects";
import { giveHostGame, openHost, type EditTransaction, type HostGame, type PluginApi } from "./run";
import { CliError, dot, mark, num, pc, table } from "./ui";

export type TerrainType = ReturnType<PluginApi["terrain"]["types"]>[number];
export type DoodadInfo = NonNullable<ReturnType<PluginApi["palette"]["doodadInfo"]>>;
type Diamond = ReturnType<PluginApi["terrain"]["diamondAt"]>;

/** The symmetries a stroke can be repeated under, by the editor's names for them (Tools ▸ Symmetry). */
export const SYMMETRIES = ["h", "v", "hv", "rot180", "rot90", "diag", "adiag"] as const;
export type Symmetry = (typeof SYMMETRIES)[number];
export const SHAPES = ["rect", "ellipse"] as const;
export type Shape = (typeof SHAPES)[number];

/* ── The game behind the host ───────────────────────────────── */

/**
 * The person's copy of the game given to the host for `doc`, with the map's tileset in memory: what every function
 * here needs first. None on this computer, or a copy without the map's tileset, is an error that says what to do.
 */
export async function needTileset(doc: OpenedMap, starcraft: string | undefined, why = t("Terrain and doodads are read and laid with your own installation's tileset")): Promise<HostGame> {
  const game = await giveHostGame(doc, starcraft);
  if (!game) throw new CliError(t("No copy of StarCraft was found on this computer."), t("{why}: name its folder with --starcraft (or SCMJS_STARCRAFT).", { why }), 2);
  if (!game.tileset) throw new CliError(t("{copy} in {folder} has no tileset for this map.", { copy: game.label, folder: game.folder }), t("The copy may be incomplete; name another with --starcraft."));
  return game;
}

/* ── Names ──────────────────────────────────────────────────── */

const sameText = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The terrain a name or an id means: the id `map terrain` lists, the name whole (any case), or a part of it that
 * only one terrain has. Anything else is an error that lists the tileset's terrains.
 */
export function terrainOf(api: PluginApi, ref: string | number): TerrainType {
  const types = api.terrain.types();
  const have = () => t("This tileset has {list}.", { list: types.map((x) => x.name).join(", ") });
  const text = String(ref).trim();
  if (/^\d+$/.test(text)) {
    const byId = types.find((x) => x.id === Number(text));
    if (byId) return byId;
    throw new CliError(t("There is no terrain {id} in this tileset", { id: text }), have());
  }
  const exact = types.filter((x) => sameText(x.name, text));
  const found = exact.length ? exact : types.filter((x) => x.name.toLowerCase().includes(text.toLowerCase()));
  if (found.length === 1) return found[0];
  if (found.length > 1) throw new CliError(t("\"{name}\" is {list}: say which", { name: text, list: found.map((x) => x.name).join(", ") }));
  throw new CliError(t("No terrain is called \"{name}\"", { name: text }), have());
}

/**
 * The doodads a name or an id means, any of which will do: one doodad by its id or its name ("Jungle #180"), every
 * doodad of a category by the category's name, every ramp of the tileset by "ramp". An error lists the categories.
 */
export function doodadsOf(api: PluginApi, ref: string | number): DoodadInfo[] {
  const categories = api.palette.doodadCategories();
  const have = () => t("This tileset's categories are {list}; scmjs map doodads --palette lists the doodads of each.", { list: categories.map((c) => c.name).join(", ") });
  const text = String(ref).trim();
  if (/^\d+$/.test(text)) {
    const one = api.palette.doodadInfo(Number(text));
    if (one) return [one];
    throw new CliError(t("There is no doodad {id} in this tileset", { id: text }), have());
  }
  if (/^ramps?$/i.test(text)) {
    const ramps = categories.flatMap((c) => c.doodads).filter((d) => d.ramp);
    if (ramps.length) return ramps;
    throw new CliError(t("This tileset has no ramps"), have());
  }
  const all = categories.flatMap((c) => c.doodads);
  const named = all.find((d) => sameText(d.name, text));
  if (named) return [named];
  const exact = categories.filter((c) => sameText(c.name, text));
  const found = exact.length ? exact : categories.filter((c) => c.name.toLowerCase().includes(text.toLowerCase()));
  if (found.length === 1) return found[0].doodads;
  if (found.length > 1) throw new CliError(t("\"{name}\" is {list}: say which", { name: text, list: found.map((c) => c.name).join(", ") }));
  throw new CliError(t("No doodad or category is called \"{name}\"", { name: text }), have());
}

/** The ground a doodad is drawn for, in a few words: "Dirt", "High Dirt and cliff pieces". */
export function groundFor(api: PluginApi, doodad: DoodadInfo): string {
  const types = api.terrain.types();
  const groups = [...new Set(doodad.required.filter((g) => g > 0).map((g) => g & ~1))];
  const flat = groups.map((g) => types.find((x) => x.group === g)).filter((x): x is TerrainType => !!x);
  const names = [...new Set(flat.map((x) => x.name))];
  if (flat.length < groups.length) names.push(t("cliff or shore pieces"));
  return names.length ? names.join(", ") : t("any ground");
}

/* ── Chance, from a seed ────────────────────────────────────── */

/** Numbers from 0 up to 1 that are the same for the same seed (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A number from 0 up to 1 for a lattice point, the same for the same seed. */
function latticeValue(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1)) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise over the map's tiles: values of a lattice `grain` tiles apart, eased between its points. */
function noise(seed: number, grain: number): (x: number, y: number) => number {
  const ease = (v: number) => v * v * (3 - 2 * v);
  return (x, y) => {
    const gx = x / grain, gy = y / grain;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = ease(gx - x0), fy = ease(gy - y0);
    const top = latticeValue(seed, x0, y0) * (1 - fx) + latticeValue(seed, x0 + 1, y0) * fx;
    const bottom = latticeValue(seed, x0, y0 + 1) * (1 - fx) + latticeValue(seed, x0 + 1, y0 + 1) * fx;
    return top * (1 - fy) + bottom * fy;
  };
}

/* ── Painting ───────────────────────────────────────────────── */

export interface Stroke {
  shape?: Shape;
  /** The share of the area to paint, in patches (0 to 1); the whole area without it. */
  cover?: number;
  /** How large a patch is, about, in tiles. */
  grain?: number;
  seed?: number;
  symmetry?: Symmetry;
}

/**
 * The diamonds a stroke paints: those of the area (`cells`), of the ellipse inside it, or the `cover` share of them
 * where the noise is highest, which makes patches about `grain` tiles across; then their images under the symmetry.
 */
export function strokeDiamonds(api: PluginApi, tx: EditTransaction, cells: TileRect, stroke: Stroke): Diamond[] {
  let diamonds = api.terrain.diamondsIn(cells);
  if (stroke.shape === "ellipse") {
    const mx = (cells.x0 + cells.x1) / 2, my = (cells.y0 + cells.y1) / 2;
    const rx = (cells.x1 - cells.x0) / 2, ry = (cells.y1 - cells.y0) / 2;
    diamonds = diamonds.filter((d) => ((d.x * 2 - mx) / rx) ** 2 + ((d.y - my) / ry) ** 2 <= 1);
  }
  if (stroke.cover !== undefined && stroke.cover < 1) {
    const value = noise(stroke.seed ?? 1, Math.max(2, stroke.grain ?? 8));
    const ranked = diamonds.map((d) => ({ d, v: value(d.x * 2, d.y) })).sort((a, b) => b.v - a.v);
    diamonds = ranked.slice(0, Math.round(ranked.length * stroke.cover)).map((r) => r.d);
  }
  if (!stroke.symmetry) return diamonds;
  if (!api.terrain.symmetryAvailable(stroke.symmetry)) throw new CliError(t("The symmetry {mode} needs a square map, and this one is {w} × {h}", { mode: stroke.symmetry, w: tx.width, h: tx.height }), t("h, v, hv and rot180 work on any map."));
  const before = api.terrain.symmetry();
  api.terrain.setSymmetry(stroke.symmetry);
  try {
    const seen = new Set<string>();
    const out: Diamond[] = [];
    for (const d of diamonds) {
      // A diamond is centred on pixel (64x, 32y); its images are the diamonds under that pixel's images.
      for (const p of tx.mirrorPoint(d.x * 64, d.y * 32)) {
        const image = api.terrain.diamondAt(p.x, p.y);
        const key = `${image.x},${image.y}`;
        if (seen.has(key) || !api.terrain.isDiamond(image)) continue;
        seen.add(key);
        out.push(image);
      }
    }
    return out;
  } finally {
    api.terrain.setSymmetry(before);
  }
}

export interface Painted { terrain: string; id: number; height: number; diamonds: number; refused: number; tiles: number }

/**
 * Paint `type` on the diamonds with the isometric brush, one diamond a touch. A diamond the tileset cannot join to
 * its neighbours is refused by the brush and counted; the tiles counted are those that are different afterwards.
 */
export function paintDiamonds(tx: EditTransaction, type: TerrainType, diamonds: readonly Diamond[]): Painted {
  const tiles = (tx.scenario as OpenedMap["scenario"]).tiles;
  const before = tiles.slice();
  let refused = 0;
  for (const d of diamonds) if (!tx.paintIsom(d, type.id, 1)) refused++;
  let changed = 0;
  for (let i = 0; i < tiles.length; i++) if (tiles[i] !== before[i]) changed++;
  return { terrain: type.name, id: type.id, height: type.height, diamonds: diamonds.length - refused, refused, tiles: changed };
}

/* ── Doodads ────────────────────────────────────────────────── */

export interface PlacedDoodad { id: number; name: string; tileX: number; tileY: number; width: number; height: number }

/** Whether StarEdit's rule lets the doodad go with its top-left tile there. */
const fits = (api: PluginApi, doodad: DoodadInfo, x: number, y: number) => api.query.doodadPlacement(doodad.id, x, y)?.ok === true;

/**
 * Place one of `choices` with its top-left tile at (x, y), or at the nearest tile within `within` tiles where one
 * fits; null when none fits there. `force` places the first choice at (x, y) whatever is under it. The choices are
 * tried in the order `random` puts them in, so a category is not always its first doodad.
 */
export function placeOneDoodad(api: PluginApi, tx: EditTransaction, choices: readonly DoodadInfo[], x: number, y: number, o: { within?: number; force?: boolean; random: () => number }): (PlacedDoodad & { index: number }) | null {
  const put = (doodad: DoodadInfo, px: number, py: number) => {
    const index = tx.placeDoodad(doodad.id, px, py);
    return index < 0 ? null : { index, id: doodad.id, name: doodad.name, tileX: px, tileY: py, width: doodad.width, height: doodad.height };
  };
  if (o.force) return put(choices[0], x, y);
  const order = [...choices];
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(o.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const reach = o.within ?? 0;
  const spots: { x: number; y: number; far: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) spots.push({ x: x + dx, y: y + dy, far: dx * dx + dy * dy });
  spots.sort((a, b) => a.far - b.far);
  for (const spot of spots) {
    if (spot.x < 0 || spot.y < 0) continue;
    for (const doodad of order) {
      if (spot.x + doodad.width > tx.width || spot.y + doodad.height > tx.height) continue;
      if (fits(api, doodad, spot.x, spot.y)) return put(doodad, spot.x, spot.y);
    }
  }
  return null;
}

/**
 * Scatter doodads of `choices` over the area: `count` of them, or as many as cover the `density` share of its tiles,
 * each where the rule lets it go and inside the area whole. Spots are tried at random from the seed until the count
 * is reached or twenty tries a doodad have gone by, so a crowded or unfit area gets fewer.
 */
export function scatterDoodads(api: PluginApi, tx: EditTransaction, choices: readonly DoodadInfo[], cells: TileRect, o: { count?: number; density?: number; random: () => number }): (PlacedDoodad & { index: number })[] {
  const area = (cells.x1 - cells.x0) * (cells.y1 - cells.y0);
  const average = choices.reduce((sum, d) => sum + d.width * d.height, 0) / choices.length;
  const want = o.count ?? Math.max(1, Math.round((area * (o.density ?? 0.1)) / average));
  const placed: (PlacedDoodad & { index: number })[] = [];
  for (let tries = want * 20; tries > 0 && placed.length < want; tries--) {
    const doodad = choices[Math.floor(o.random() * choices.length)];
    const roomX = cells.x1 - cells.x0 - doodad.width, roomY = cells.y1 - cells.y0 - doodad.height;
    if (roomX < 0 || roomY < 0) continue;
    const x = cells.x0 + Math.floor(o.random() * (roomX + 1)), y = cells.y0 + Math.floor(o.random() * (roomY + 1));
    if (!fits(api, doodad, x, y)) continue;
    const index = tx.placeDoodad(doodad.id, x, y);
    if (index >= 0) placed.push({ index, id: doodad.id, name: doodad.name, tileX: x, tileY: y, width: doodad.width, height: doodad.height });
  }
  return placed;
}

/* ── Listing the terrain ────────────────────────────────────── */

export interface TerrainRow { id: number; name: string; height: number; buildable: boolean; tiles: number; share: number; letter: string }

export interface TerrainListing {
  file: string;
  tileset: string;
  width: number;
  height: number;
  /** Whether the map has the isometric lattice the brush paints on; without it terrain cannot be painted by type. */
  isometric: boolean;
  /** The copy of the game the tileset was read from. */
  game: string;
  /** The tileset's terrains, with how much of the map (or of the area asked for) each covers. */
  terrains: TerrainRow[];
  /** Tiles that are the edge between two terrains, a cliff or a shore (`#` in the grid). */
  edges: number;
  /** Tiles of a doodad the lattice gives no terrain (`*`), and tiles that are none of these (`?`). */
  doodads: number;
  unknown: number;
  /** The area as text, a character a cell of `cell` × `cell` tiles: the letter of the terrain most of the cell is. */
  grid: { x0: number; y0: number; x1: number; y1: number; cell: number; rows: string[]; legend: Record<string, string> };
}

/** What a tile is when it is no terrain's: an edge, a doodad's, or none of these; and the grid's character for each. */
const EDGE = -2, DOODAD = -3, UNKNOWN = -1;
const MARKS: Record<number, string> = { [EDGE]: "#", [DOODAD]: "*", [UNKNOWN]: "?" };

/** Columns the grid is kept to unless a cell size is asked for. */
export const GRID_COLUMNS = 64;

/** A letter a terrain: one of its name, lower case for low ground and upper case above it, no two alike. */
function letters(types: readonly TerrainType[]): Map<number, string> {
  const taken = new Set<string>();
  const out = new Map<number, string>();
  for (const type of types) {
    const base = type.name.replace(/^(High|Raised|Low)\s+/gi, "").replace(/[^a-z]/gi, "");
    const cased = (c: string) => (type.height > 0 ? c.toUpperCase() : c.toLowerCase());
    const pick = [...base, ...type.name.replace(/[^a-z]/gi, ""), ..."abcdefghijklmnopqrstuvwxyz"].map(cased).find((c) => !taken.has(c)) ?? [..."0123456789"].find((c) => !taken.has(c)) ?? "?";
    taken.add(pick);
    out.set(type.id, pick);
  }
  return out;
}

/**
 * The map's terrain: the tileset's terrains with the tiles each covers in the area (the whole map without one), and
 * the area as a grid of letters. `cell` is tiles a character; left out, the grid is kept to `GRID_COLUMNS` columns.
 */
export async function listTerrain(doc: OpenedMap, file: string, o: { area?: Area; cell?: number; starcraft?: string } = {}): Promise<TerrainListing> {
  const game = await needTileset(doc, o.starcraft);
  const host = openHost(doc, "map terrain");
  try {
    const { api } = host;
    const scn = doc.scenario;
    const box = o.area ? areaRect(scn, o.area) : null;
    const cells = box ? tileRect(box) : { x0: 0, y0: 0, x1: scn.width, y1: scn.height };
    const types = api.terrain.types();
    const letter = letters(types);
    const counts = new Map<number, number>();
    const at = new Int32Array((cells.x1 - cells.x0) * (cells.y1 - cells.y0));
    for (let y = cells.y0; y < cells.y1; y++) {
      for (let x = cells.x0; x < cells.x1; x++) {
        // A tile that is no flat ground and that the lattice does not place: what kind of tile it is instead.
        const kind = () => api.terrain.tileInfo(scn.tiles[y * scn.width + x])?.kind;
        const id = api.terrain.terrainAt(x, y) ?? (kind() === "edge" ? EDGE : kind() === "doodad" ? DOODAD : UNKNOWN);
        at[(y - cells.y0) * (cells.x1 - cells.x0) + (x - cells.x0)] = id;
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    const total = at.length;
    const cell = Math.max(1, Math.floor(o.cell ?? Math.ceil((cells.x1 - cells.x0) / GRID_COLUMNS)));
    const rows: string[] = [];
    const used = new Set<number>();
    for (let y = cells.y0; y < cells.y1; y += cell) {
      let row = "";
      for (let x = cells.x0; x < cells.x1; x += cell) {
        const votes = new Map<number, number>();
        for (let dy = 0; dy < cell && y + dy < cells.y1; dy++) for (let dx = 0; dx < cell && x + dx < cells.x1; dx++) {
          const id = at[(y + dy - cells.y0) * (cells.x1 - cells.x0) + (x + dx - cells.x0)];
          votes.set(id, (votes.get(id) ?? 0) + 1);
        }
        let best = -1, most = 0;
        for (const [id, n] of votes) if (n > most) { best = id; most = n; }
        used.add(best);
        row += MARKS[best] ?? letter.get(best) ?? "?";
      }
      rows.push(row);
    }
    return {
      file, tileset: api.tileset.name(), width: scn.width, height: scn.height, isometric: api.terrain.hasIsom(), game: game.label,
      terrains: types.map((x) => ({ id: x.id, name: x.name, height: x.height, buildable: x.buildable, tiles: counts.get(x.id) ?? 0, share: total ? (counts.get(x.id) ?? 0) / total : 0, letter: letter.get(x.id) ?? "?" })),
      edges: counts.get(EDGE) ?? 0, doodads: counts.get(DOODAD) ?? 0, unknown: counts.get(UNKNOWN) ?? 0,
      grid: {
        ...cells, cell, rows,
        legend: {
          ...Object.fromEntries(types.filter((x) => used.has(x.id)).map((x) => [letter.get(x.id) ?? "?", x.name])),
          ...(used.has(EDGE) ? { "#": "the edge between two terrains: a cliff or a shore" } : {}),
          ...(used.has(DOODAD) ? { "*": "a doodad" } : {}),
          ...(used.has(UNKNOWN) ? { "?": "a tile of no terrain the tileset names" } : {}),
        },
      },
    };
  } finally {
    host.dispose();
  }
}

/** A height by the editor's words for it (the Terrain palette's Low, Mid, High). */
const HEIGHTS = () => [t("low"), t("mid"), t("high")];

/** The listing as lines: the terrains as a table, then the grid with its tile numbers and what each letter is. */
export function printTerrain(name: string, r: TerrainListing, { grid = true } = {}): string[] {
  const heights = HEIGHTS();
  const lines = [`${pc.bold(name)}  ${r.width} × ${r.height}${dot}${r.tileset}${r.isometric ? "" : `${dot}${pc.yellow(t("no isometric lattice: terrain cannot be painted by type until the editor rebuilds it"))}`}`];
  lines.push(...table([
    [t("letter"), t("terrain"), t("id"), t("height"), t("buildable"), t("tiles"), t("share")].map((h) => pc.dim(h)),
    ...r.terrains.map((x) => [x.letter, x.name, String(x.id), heights[x.height] ?? String(x.height), x.buildable ? t("yes") : t("no"), num(x.tiles), x.tiles ? `${Math.max(1, Math.round(x.share * 100))}%` : pc.dim("0")]),
  ], 2));
  const others = [
    r.edges ? `# ${t("{n, plural, one {# tile} other {# tiles}} of an edge between two terrains (a cliff or a shore)", { n: r.edges })}` : null,
    r.doodads ? `* ${t("{n, plural, one {# tile} other {# tiles}} of a doodad", { n: r.doodads })}` : null,
    r.unknown ? `? ${t("{n, plural, one {# tile} other {# tiles}} of no terrain the tileset names", { n: r.unknown })}` : null,
  ].filter((l): l is string => l !== null);
  for (const line of others) lines.push(pc.dim(`  ${line}`));
  if (!grid) return lines;
  const g = r.grid;
  const label = (n: number) => String(n).padStart(String(g.y1).length);
  // A ruler over the columns: the tile number every ten characters.
  let ruler = "";
  for (let c = 0; c < g.rows[0]?.length; c += 10) ruler = ruler.padEnd(c) + String(g.x0 + c * g.cell);
  lines.push("", pc.dim(`  ${g.cell === 1 ? t("Tiles {x0},{y0} to {x1},{y1}, a character a tile", { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1 }) : t("Tiles {x0},{y0} to {x1},{y1}, a character every {cell} tiles", { x0: g.x0, y0: g.y0, x1: g.x1, y1: g.y1, cell: g.cell })}`));
  lines.push(pc.dim(`  ${" ".repeat(label(0).length)} ${ruler}`));
  g.rows.forEach((row, i) => lines.push(`  ${pc.dim(label(g.y0 + i * g.cell))} ${row}`));
  return lines;
}

/* ── Listing the doodads ────────────────────────────────────── */

export interface DoodadRow extends PlacedDoodad { index: number; category: string | null; ramp: boolean }
export interface PaletteDoodad { id: number; name: string; width: number; height: number; ramp: boolean; ground: string }

export interface DoodadListing {
  file: string;
  tileset: string;
  game: string;
  total: number;
  /** The doodads on the map (in the area, of the category, when asked for), with the index each has in the file. */
  doodads: DoodadRow[];
  /** The tileset's categories, with how many doodads each has. */
  categories: { name: string; count: number; ramps: number }[];
  /** The doodads that can be placed, when asked for: those of one category, or of all. */
  palette: (PaletteDoodad & { category: string })[] | null;
}

/** Rows listed before the rest is cut (`--all` lists them). */
export const DOODAD_ROWS = 40;

/**
 * The map's doodads as rows, and the tileset's doodads that can be placed: `category` narrows both to one category
 * (or to the ramps, with "ramp"), `palette` asks for the placeable ones, an area keeps the placed ones whose centre
 * is inside it.
 */
export async function listDoodads(doc: OpenedMap, file: string, o: { area?: Area; category?: string; palette?: boolean; starcraft?: string } = {}): Promise<DoodadListing> {
  const game = await needTileset(doc, o.starcraft);
  const host = openHost(doc, "map doodads");
  try {
    const { api } = host;
    const scn = doc.scenario;
    const categories = api.palette.doodadCategories();
    const only = o.category === undefined ? null : new Set(doodadsOf(api, o.category).map((d) => d.id));
    const box = o.area ? areaRect(scn, o.area) : null;
    const doodads: DoodadRow[] = [];
    scn.doodads.forEach((d, index) => {
      if (only && !only.has(d.doodadId)) return;
      if (box && !(d.x >= box.left && d.x < box.right && d.y >= box.top && d.y < box.bottom)) return;
      const info = api.palette.doodadInfo(d.doodadId);
      const width = info?.width ?? 1, height = info?.height ?? 1;
      doodads.push({ index, id: d.doodadId, name: info?.name ?? t("doodad {id}", { id: d.doodadId }), category: info?.category ?? null, ramp: info?.ramp ?? false, tileX: Math.round(d.x / TILE - width / 2), tileY: Math.round(d.y / TILE - height / 2), width, height });
    });
    const palette = o.palette || only
      ? categories.flatMap((c) => c.doodads.filter((d) => !only || only.has(d.id)).map((d) => ({ category: c.name, id: d.id, name: d.name, width: d.width, height: d.height, ramp: d.ramp, ground: groundFor(api, d) })))
      : null;
    return {
      file, tileset: api.tileset.name(), game: game.label, total: scn.doodads.length, doodads,
      categories: categories.map((c) => ({ name: c.name, count: c.doodads.length, ramps: c.doodads.filter((d) => d.ramp).length })),
      palette,
    };
  } finally {
    host.dispose();
  }
}

/** The listing as lines: the placed doodads, then the categories, or the doodads of the palette asked for. */
export function printDoodads(name: string, r: DoodadListing, all = false): string[] {
  const head = r.doodads.length === r.total
    ? t("{n, plural, one {# doodad} other {# doodads}}", { n: r.total })
    : t("{matched} of {n, plural, one {# doodad} other {# doodads}}", { matched: num(r.doodads.length), n: r.total });
  const lines = [`${pc.bold(name)}  ${head}${dot}${r.tileset}`];
  const shown = all ? r.doodads : r.doodads.slice(0, DOODAD_ROWS);
  if (shown.length) {
    lines.push(...table([
      [t("index"), t("doodad"), t("id"), t("tile"), t("size")].map((h) => pc.dim(h)),
      ...shown.map((d) => [String(d.index), d.ramp ? `${d.name} ${pc.dim(t("(ramp)"))}` : d.name, String(d.id), `${d.tileX},${d.tileY}`, `${d.width} × ${d.height}`]),
    ], 2));
  }
  if (r.doodads.length > shown.length) lines.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(r.doodads.length - shown.length) })}`));
  if (r.palette) {
    const rows = all ? r.palette : r.palette.slice(0, DOODAD_ROWS);
    lines.push("", `${mark.info} ${t("{n, plural, one {# doodad} other {# doodads}} to place", { n: r.palette.length })}`);
    lines.push(...table([
      [t("id"), t("doodad"), t("size"), t("goes on")].map((h) => pc.dim(h)),
      ...rows.map((d) => [String(d.id), d.ramp ? `${d.name} ${pc.dim(t("(ramp)"))}` : d.name, `${d.width} × ${d.height}`, d.ground]),
    ], 2));
    if (r.palette.length > rows.length) lines.push(pc.dim(`  ${t("… and {n} more (--all lists them)", { n: num(r.palette.length - rows.length) })}`));
  } else {
    lines.push("", pc.dim(`  ${t("The tileset's categories:")} ${r.categories.map((c) => `${c.name} (${c.count}${c.ramps ? `, ${t("{n, plural, one {# ramp} other {# ramps}}", { n: c.ramps })}` : ""})`).join(", ")}`));
  }
  return lines;
}
