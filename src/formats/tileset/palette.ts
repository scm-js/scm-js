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
import { groupBuildable, groupHeight, megatileForTile, TileFlag, type Cv5Group, type Tileset } from "./decode";

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

/** Every group with at least one drawable megatile, in group order. */
export function tileGroups(tileset: Tileset, names: readonly TerrainName[]): TileGroupInfo[] {
  const nameOf = new Map(names.map((n) => [n.id, n.name]));
  const out: TileGroupInfo[] = [];
  for (let g = 0; g < tileset.groups.length; g++) {
    const cv5 = tileset.groups[g];
    const slots: number[] = [];
    for (let s = 0; s < 16; s++) {
      const m = cv5.megatiles[s];
      if (m !== 0 && m < tileset.megatileCount) slots.push(s);
    }
    if (slots.length === 0) continue;

    let kind: GroupKind = "other";
    let label = "Unlisted";
    if (cv5.index === DOODAD_INDEX) {
      kind = "doodad";
      label = "Doodad";
    } else if (isFlatPair(tileset, g & ~1)) {
      kind = "terrain";
      label = `${nameOf.get(cv5.index) ?? `Terrain ${cv5.index}`} ${g % 2 === 0 ? "L" : "R"}`;
    } else if (cv5.index >= 2) {
      kind = "edge";
      label = `Edge set ${cv5.index}`;
    }
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

const HEIGHT_LABEL = ["Low", "Mid", "High"] as const;

export function heightLabel(height: 0 | 1 | 2): string {
  return HEIGHT_LABEL[height];
}

/** Everything the properties panel shows about one MTXM id. */
export function tileInfo(tileset: Tileset, names: readonly TerrainName[], id: number): TileInfo {
  const group = id >> 4;
  const slot = id & 0xf;
  const cv5 = tileset.groups[group];
  // Megatile 0 is the null megatile: it "resolves", but there is nothing there.
  const resolved = megatileForTile(tileset, id);
  const megatile = resolved > 0 ? resolved : -1;

  let kind: GroupKind = "other";
  let label = "Unlisted";
  if (cv5) {
    if (cv5.index === DOODAD_INDEX) {
      kind = "doodad";
      label = "Doodad";
    } else if (isFlatPair(tileset, group & ~1)) {
      kind = "terrain";
      label = names.find((n) => n.id === cv5.index)?.name ?? `Terrain ${cv5.index}`;
    } else if (cv5.index >= 2) {
      kind = "edge";
      label = `Edge set ${cv5.index}`;
    }
  }

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
    height: cv5 ? groupHeight(cv5) : 0,
    buildable: cv5 ? groupBuildable(cv5) && megatile >= 0 : false,
    walkable,
  };
}

/** `0x1234`-style hex for a tile id, the way other editors print them. */
export function hexTile(id: number): string {
  return `0x${id.toString(16).toUpperCase().padStart(4, "0")}`;
}
