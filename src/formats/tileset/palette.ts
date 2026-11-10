/**
 * What the terrain palettes are built from: the tileset's terrain types (for the Rect
 * brush) and a catalogue of every CV5 tile group (for the Subtile and Index brushes).
 *
 * A CV5 group is 16 megatile slots. Groups 2..~27 come in flat left/right pairs whose
 * `index` is the ISOM terrain id; the groups after them are the cliff and edge pieces
 * the ISOM brush stitches between terrains; groups with index 1 are doodads; and
 * index 0 marks slots the tileset does not use (a few still hold real graphics).
 */
import type { TerrainName } from "../../data/tilesets";
import { format, msg, translate, type Params } from "../../i18n";
import { groupBuildable, groupHeight, megatileForTile, megatileHeight, TileFlag, tileGroupOf, type Cv5Group, type Tileset } from "./decode";

/** Doodad groups mark themselves with index 1. */
const DOODAD_INDEX = 1;

export interface TerrainType extends TerrainName {
  /** Even CV5 group of the flat pair; odd columns use `group + 1`. */
  group: number;
  height: 0 | 1 | 2;
  buildable: boolean;
  /**
   * The name in the user's language, where `name` is not a string of the catalogue's: a pair
   * terrain's name is put together ("Mud (mid ground)", "Group 3672"). Shown through `terrainLabel`.
   */
  label?: string;
}

/** A terrain's name as the panels show it. */
export function terrainLabel(type: TerrainType): string {
  return type.label ?? translate(type.name);
}

/** A flat ground pair: two consecutive groups sharing an index, each with all four edges equal. */
export function isFlatPair(tileset: Tileset, group: number): boolean {
  const a = tileset.groups[group];
  const b = tileset.groups[group + 1];
  if (!a || !b || group % 2 !== 0) return false;
  if (a.index < 2 || a.index !== b.index) return false;
  const flat = (g: Cv5Group) => g.edges.left === g.edges.top && g.edges.left === g.edges.right && g.edges.left === g.edges.bottom;
  return flat(a) && flat(b);
}

/**
 * The tileset's terrain types in palette order. Names come from the reference table;
 * everything else is read off the CV5. A name whose pair is missing from the graphics
 * is dropped rather than shown as something that cannot be painted.
 */
export function terrainTypes(tileset: Tileset | null, names: readonly TerrainName[]): TerrainType[] {
  if (!tileset) return [];
  const pairs = new Map<number, number>();
  for (let g = 2; g + 1 < tileset.groups.length; g += 2) {
    if (isFlatPair(tileset, g) && !pairs.has(tileset.groups[g].index)) pairs.set(tileset.groups[g].index, g);
  }
  const out: TerrainType[] = [];
  for (const { id, name } of names) {
    const group = pairs.get(id);
    if (group === undefined) continue;
    const cv5 = tileset.groups[group];
    out.push({ id, name, group, height: groupHeight(cv5), buildable: groupBuildable(cv5) });
  }
  return out;
}

/* ── Flat ground the game's tables have no terrain for ─── */

/**
 * A terrain id at or above this names a flat pair by its even CV5 group (`PAIR_TERRAIN + group`).
 *
 * The game's flat pairs carry a terrain id in the CV5 `index`, and that id is what the palettes,
 * the Rect brush and Replace Terrain speak. A mod's tileset can hold flat ground the game never
 * had — Cosmonarchy's Jungle has 2,517 groups past the game's 1,578 — and every such group has
 * `index` 0 and no ISOM links, so it has no id of that kind and the isometric brush has nothing to
 * build a table from. These ids let the tile-laying tools (Rect, its fills, Replace Terrain) take
 * such a pair anyway; they are never written to a map and mean nothing to the isometric brush.
 */
export const PAIR_TERRAIN = 0x10000;

export const isPairTerrain = (id: number): boolean => id >= PAIR_TERRAIN;
export const pairTerrainId = (group: number): number => PAIR_TERRAIN + (group & ~1);
export const pairTerrainGroup = (id: number): number => id - PAIR_TERRAIN;

/**
 * Two consecutive groups that *could* be the halves of flat ground the CV5 does not type: both
 * `index` 0, the same slots filled with a left and a right that differ, one ground height
 * throughout, the same buildability.
 *
 * This is a shape, not a finding. Nothing in a tileset's files tells flat ground from the pieces
 * of a seam between two terrains of nearly one colour (measured: Jungle's own mud-to-dirt edge
 * groups score *better* on seam and colour-spread tests than several of its flat terrains), so a
 * pair is only offered as a terrain on evidence from elsewhere — its pictures are the game's
 * (`terrainCopies`), the open map lays it as ground (`editor/terrain.ts#laidPairs`), or the person
 * picked it.
 */
export function isLoosePair(tileset: Tileset, group: number): boolean {
  const a = tileset.groups[group];
  const b = tileset.groups[group + 1];
  if (!a || !b || group % 2 !== 0) return false;
  if (a.index !== 0 || b.index !== 0) return false;
  if (groupBuildable(a) !== groupBuildable(b)) return false;
  let height = -1;
  let halves = false;
  for (let s = 0; s < 16; s++) {
    const ma = a.megatiles[s];
    const mb = b.megatiles[s];
    if ((ma === 0) !== (mb === 0)) return false;
    if (ma === 0) continue;
    if (ma >= tileset.megatileCount || mb >= tileset.megatileCount) return false;
    const ha = megatileHeight(tileset, ma);
    if (height < 0) height = ha;
    if (ha !== height || megatileHeight(tileset, mb) !== height) return false;
    if (ma !== mb) halves = true;
  }
  // The same megatile on both sides is filler (Installation's groups 16–46 repeat megatile 1), not a left and a right.
  return height >= 0 && halves;
}

const MEGATILE_PIXELS = 32 * 32;

/** A megatile's picture as palette indices, the minitile flip bit applied. */
function megatilePixels(tileset: Tileset, megatile: number, out: Uint8Array): Uint8Array {
  for (let i = 0; i < 16; i++) {
    const ref = tileset.megatileRefs[megatile * 16 + i] ?? 0;
    const flipped = (ref & 1) === 1;
    const from = (ref >>> 1) * 64;
    const ox = (i % 4) * 8;
    const oy = (i >> 2) * 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) out[(oy + y) * 32 + ox + x] = tileset.minitiles[from + y * 8 + (flipped ? 7 - x : x)] ?? 0;
    }
  }
  return out;
}

function hashPixels(pixels: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < pixels.length; i++) h = Math.imul(h ^ pixels[i], 0x01000193);
  return h >>> 0;
}

export interface TerrainCopy {
  /** Even group of the copy. */
  group: number;
  /** Terrain id (CV5 `index`) of the game's flat pair the pictures are from, and that pair's even group. */
  source: number;
  sourceGroup: number;
}

const copiesOf = new WeakMap<Tileset, Map<number, TerrainCopy>>();

/**
 * The loose pairs whose every picture is, pixel for pixel, a picture of one of the tileset's own
 * typed flat pairs, under other flags: the same ground made different to the game — Cosmonarchy's
 * Mud on mid and on high ground is the game's Mud, megatile for megatile, with the VF4 heights
 * raised. Where several typed pairs share their pictures (Jungle and High Jungle do) the lowest
 * group is the source, and a pair that matches any of them flag for flag is not a copy but a
 * duplicate, left out: the game's own tilesets hold a few (Badlands' groups 22–42 repeat one Dirt
 * megatile), and listing those would add nothing a mapper can tell from Dirt.
 * Built once per tileset; keyed by the copy's even group.
 */
export function terrainCopies(tileset: Tileset): ReadonlyMap<number, TerrainCopy> {
  const hit = copiesOf.get(tileset);
  if (hit) return hit;
  const out = new Map<number, TerrainCopy>();
  copiesOf.set(tileset, out);
  // Pictures are compared, so a tileset decoded without them (the CV5 alone) has no copies to find.
  if (!tileset.megatileRefs || !tileset.minitiles || !tileset.megatileFlags) return out;

  // Every picture of the typed pairs, by hash; a hit is confirmed pixel by pixel.
  const sources = new Map<number, { megatile: number; group: number }[]>();
  const scratch = new Uint8Array(MEGATILE_PIXELS);
  const other = new Uint8Array(MEGATILE_PIXELS);
  for (let g = 2; g + 1 < tileset.groups.length; g += 2) {
    if (!isFlatPair(tileset, g)) continue;
    for (const half of [g, g + 1]) {
      for (const m of tileset.groups[half].megatiles) {
        if (m === 0 || m >= tileset.megatileCount) continue;
        const key = hashPixels(megatilePixels(tileset, m, scratch));
        const list = sources.get(key);
        if (list) list.push({ megatile: m, group: g });
        else sources.set(key, [{ megatile: m, group: g }]);
      }
    }
  }
  if (sources.size === 0) return out;

  const sameFlags = (a: number, b: number): boolean => {
    for (let i = 0; i < 16; i++) if (tileset.megatileFlags[a * 16 + i] !== tileset.megatileFlags[b * 16 + i]) return false;
    return true;
  };

  for (let g = 2; g + 1 < tileset.groups.length; g += 2) {
    if (!isLoosePair(tileset, g)) continue;
    // Typed pair → whether every picture so far also carries that pair's flags.
    let matches: Map<number, boolean> | null = null;
    scan: for (const half of [g, g + 1]) {
      for (const m of tileset.groups[half].megatiles) {
        if (m === 0) continue;
        megatilePixels(tileset, m, scratch);
        const here = new Map<number, boolean>();
        for (const s of sources.get(hashPixels(scratch)) ?? []) {
          if (s.megatile !== m) {
            megatilePixels(tileset, s.megatile, other);
            if (!scratch.every((p, i) => p === other[i])) continue;
          }
          const same = sameFlags(m, s.megatile) && groupBuildable(tileset.groups[half]) === groupBuildable(tileset.groups[s.group]);
          here.set(s.group, (here.get(s.group) ?? false) || same);
        }
        if (matches === null) matches = here;
        else for (const [group, same] of matches) {
          if (here.has(group)) matches.set(group, same && here.get(group)!);
          else matches.delete(group);
        }
        if (matches.size === 0) break scan;
      }
    }
    if (!matches || matches.size === 0) continue;
    if ([...matches.values()].some((same) => same)) continue; // the same ground again
    const source = Math.min(...matches.keys());
    out.set(g, { group: g, source: tileset.groups[source].index, sourceGroup: source });
  }
  return out;
}

const COPY_NAME = msg("{name} ({height, select, 0 {low} 1 {mid} other {high}} ground)");
const PAIR_NAME = msg("Group {n}");

/**
 * A loose pair as a terrain the Rect brush can lay, or null when the two groups are not one.
 * A copy of the game's ground is named after it and its height; anything else by its group.
 * The height is the megatiles' (the CV5 height bits of a mod's added groups are empty).
 */
export function pairTerrain(tileset: Tileset, names: readonly TerrainName[], group: number): TerrainType | null {
  if (!isLoosePair(tileset, group)) return null;
  const cv5 = tileset.groups[group];
  const height = megatileHeight(tileset, cv5.megatiles.find((m) => m !== 0) ?? 0);
  const copy = terrainCopies(tileset).get(group);
  const source = copy ? names.find((n) => n.id === copy.source)?.name : undefined;
  const say = (english: boolean) => source
    ? english ? format(COPY_NAME, { name: source, height }, "en") : translate(COPY_NAME, { name: translate(source), height })
    : english ? format(PAIR_NAME, { n: group }, "en") : translate(PAIR_NAME, { n: group });
  return { id: pairTerrainId(group), name: say(true), label: say(false), group, height, buildable: groupBuildable(cv5) };
}

/**
 * The flat ground the files themselves vouch for beyond the game's terrain types: the named
 * copies, in the order of the terrains they copy, low ground first.
 */
export function copiedTerrains(tileset: Tileset | null, names: readonly TerrainName[]): TerrainType[] {
  if (!tileset) return [];
  const order = new Map(names.map((n, i) => [n.id, i]));
  const out: { type: TerrainType; at: number }[] = [];
  for (const copy of terrainCopies(tileset).values()) {
    const at = order.get(copy.source);
    const type = at === undefined ? null : pairTerrain(tileset, names, copy.group);
    if (type && at !== undefined) out.push({ type, at });
  }
  return out.sort((a, b) => a.at - b.at || a.type.height - b.type.height || a.type.group - b.type.group).map((o) => o.type);
}

/** The terrain an id names on this tileset — one of the game's types or a pair — or null. */
export function terrainOf(tileset: Tileset | null, names: readonly TerrainName[], id: number): TerrainType | null {
  if (!tileset) return null;
  if (isPairTerrain(id)) return pairTerrain(tileset, names, pairTerrainGroup(id));
  return terrainTypes(tileset, names).find((t) => t.id === id) ?? null;
}

/**
 * What a flood fill of "the same terrain" compares: the CV5 `index` where a group has one, and
 * the pair itself where it has none — or every untyped group of a mod's tileset would be one terrain.
 */
export function terrainKeyOfTile(tileset: Tileset, tileId: number): number {
  const group = tileGroupOf(tileId, tileset.groups.length);
  const index = tileset.groups[group]?.index ?? -1;
  return index === 0 ? pairTerrainId(group) : index;
}

export type GroupKind = "terrain" | "edge" | "doodad" | "other";

export interface TileGroupInfo {
  group: number;
  kind: GroupKind;
  /** CV5 index: the ISOM terrain id for flat pairs, an edge-set id otherwise. */
  index: number;
  label: string;
  /** Slots that hold a real megatile, in slot order. */
  slots: number[];
}

/**
 * A group's kind and name. `label` is English: it is also the plugin API's `names.tile`,
 * which stays English like the other names there, so the panels show `tileGroupLabel`.
 * `halves` adds the L / R of a flat pair, as the palette's group list does.
 */
function describeGroup(tileset: Tileset, names: readonly TerrainName[], group: number, halves: boolean, english: boolean): { kind: GroupKind; label: string } {
  const say = (text: string, params?: Params) => (english ? format(text, params, "en") : translate(text, params));
  const cv5 = tileset.groups[group];
  if (!cv5) return { kind: "other", label: say(msg("Unlisted")) };
  if (cv5.index === DOODAD_INDEX) return { kind: "doodad", label: say(msg("Doodad")) };
  if (isFlatPair(tileset, group & ~1)) {
    const name = names.find((n) => n.id === cv5.index)?.name;
    const label = name ? (english ? name : translate(name)) : say(msg("Terrain {n}"), { n: cv5.index });
    return { kind: "terrain", label: halves ? `${label} ${group % 2 === 0 ? "L" : "R"}` : label };
  }
  if (cv5.index >= 2) return { kind: "edge", label: say(msg("Edge set {n}"), { n: cv5.index }) };
  // A pair with the game's own pictures under other flags is that ground, and says so.
  const copy = terrainCopies(tileset).get(group & ~1);
  const source = copy ? names.find((n) => n.id === copy.source)?.name : undefined;
  if (source) {
    const height = megatileHeight(tileset, tileset.groups[group & ~1].megatiles.find((m) => m !== 0) ?? 0);
    const label = say(COPY_NAME, { name: english ? source : translate(source), height });
    return { kind: "terrain", label: halves ? `${label} ${group % 2 === 0 ? "L" : "R"}` : label };
  }
  return { kind: "other", label: say(msg("Unlisted")) };
}

/** A group's name in the user's language, for the panels (`TileGroupInfo.label` / `TileInfo.label` in English); `halves` as `tileGroups` has it. */
export function tileGroupLabel(tileset: Tileset, names: readonly TerrainName[], group: number, halves = false): string {
  return describeGroup(tileset, names, group, halves, false).label;
}

/** Every group with at least one drawable megatile, in group order. */
export function tileGroups(tileset: Tileset, names: readonly TerrainName[]): TileGroupInfo[] {
  const out: TileGroupInfo[] = [];
  for (let g = 0; g < tileset.groups.length; g++) {
    const cv5 = tileset.groups[g];
    const slots: number[] = [];
    for (let s = 0; s < 16; s++) {
      const m = cv5.megatiles[s];
      if (m !== 0 && m < tileset.megatileCount) slots.push(s);
    }
    if (slots.length === 0) continue;
    const { kind, label } = describeGroup(tileset, names, g, true, true);
    out.push({ group: g, kind, index: cv5.index, label, slots });
  }
  return out;
}

export interface TileInfo {
  id: number;
  group: number;
  slot: number;
  /** VX4 megatile, or -1 when the id points at nothing drawable. */
  megatile: number;
  kind: GroupKind;
  label: string;
  height: 0 | 1 | 2;
  buildable: boolean;
  /** Walkable minitiles out of 16, from VF4. */
  walkable: number;
}

const HEIGHT_LABEL = [msg("Low"), msg("Mid"), msg("High")] as const;

/** A height in the user's language. */
export function heightLabel(height: 0 | 1 | 2): string {
  return translate(HEIGHT_LABEL[height]);
}

/** Everything the properties panel shows about one MTXM id. */
export function tileInfo(tileset: Tileset, names: readonly TerrainName[], id: number): TileInfo {
  const group = tileGroupOf(id, tileset.groups.length);
  const slot = id & 0xf;
  const cv5 = tileset.groups[group];
  // Megatile 0 is the null megatile: it "resolves", but there is nothing there.
  const resolved = megatileForTile(tileset, id);
  const megatile = resolved > 0 ? resolved : -1;
  const { kind, label } = describeGroup(tileset, names, group, false, true);

  let walkable = 0;
  if (megatile >= 0) {
    for (let i = 0; i < 16; i++) if (tileset.megatileFlags[megatile * 16 + i] & TileFlag.Walkable) walkable++;
  }

  return {
    id,
    group,
    slot,
    megatile,
    kind,
    label,
    // The game's height comes from the megatile's minitiles; without one, the group's flags say what was meant.
    height: megatile >= 0 ? megatileHeight(tileset, megatile) : cv5 ? groupHeight(cv5) : 0,
    buildable: cv5 ? groupBuildable(cv5) && megatile >= 0 : false,
    walkable,
  };
}

/** `0x1234`-style hex for a tile id, the way other editors print them. */
export function hexTile(id: number): string {
  return `0x${id.toString(16).toUpperCase().padStart(4, "0")}`;
}
