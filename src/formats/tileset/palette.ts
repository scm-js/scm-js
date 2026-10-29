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
  const group = tileGroupOf(id);
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
