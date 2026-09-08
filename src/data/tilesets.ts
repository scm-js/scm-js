import { msg } from "../i18n";
/** StarCraft tileset reference data. */

export type TilesetId =
  | "badlands"
  | "platform"
  | "install"
  | "ashworld"
  | "jungle"
  | "desert"
  | "ice"
  | "twilight";

/**
 * One ISOM terrain type: its id is the CV5 `index` of the flat left/right group pair
 * that draws it, and the value the ISOM section stores for it.
 */
export interface TerrainName {
  id: number;
  name: string;
}

export interface TilesetInfo {
  id: TilesetId;
  name: string;
  /** Representative ground colour used for placeholder rendering. */
  color: string;
  /** Slightly darker accent used for grid / minimap. */
  accent: string;
  /**
   * The tileset's terrain types, in the order StarEdit's palette lists them. Ids are
   * not in palette order (Badlands numbers High Dirt 3 and Mud 4, and shows Mud first).
   */
  terrain: TerrainName[];
  /** ISOM id of the terrain a brand new map is filled with. */
  defaultIsom: number;
}

export const TILESETS: TilesetInfo[] = [
  {
    id: "badlands",
    name: msg("Badlands"),
    color: "#5a4a34",
    accent: "#3e3323",
    terrain: [
      { id: 2, name: msg("Dirt") }, { id: 4, name: msg("Mud") }, { id: 3, name: msg("High Dirt") }, { id: 5, name: msg("Water") },
      { id: 6, name: msg("Grass") }, { id: 7, name: msg("High Grass") }, { id: 18, name: msg("Structure") }, { id: 14, name: msg("Asphalt") },
      { id: 15, name: msg("Rocky Ground") },
    ],
    defaultIsom: 2,
  },
  {
    id: "platform",
    name: msg("Space Platform"),
    color: "#3b4250",
    accent: "#262b36",
    terrain: [
      { id: 2, name: msg("Space") }, { id: 8, name: msg("Low Platform") }, { id: 9, name: msg("Rusty Pit") }, { id: 3, name: msg("Platform") },
      { id: 11, name: msg("Dark Platform") }, { id: 4, name: msg("Plating") }, { id: 7, name: msg("Solar Array") }, { id: 5, name: msg("High Platform") },
      { id: 6, name: msg("High Plating") }, { id: 10, name: msg("Elevated Catwalk") },
    ],
    defaultIsom: 3,
  },
  {
    id: "install",
    name: msg("Installation"),
    color: "#4a4d5c",
    accent: "#30333f",
    terrain: [
      { id: 2, name: msg("Substructure") }, { id: 3, name: msg("Floor") }, { id: 6, name: msg("Roof") }, { id: 4, name: msg("Substructure Plating") },
      { id: 5, name: msg("Plating") }, { id: 8, name: msg("Substructure Panels") }, { id: 7, name: msg("Bottomless Pit") },
    ],
    defaultIsom: 3,
  },
  {
    id: "ashworld",
    name: msg("Ashworld"),
    color: "#4d3a34",
    accent: "#2f2320",
    terrain: [
      { id: 8, name: msg("Magma") }, { id: 2, name: msg("Dirt") }, { id: 3, name: msg("Lava") }, { id: 6, name: msg("Shale") },
      { id: 9, name: msg("Broken Rock") }, { id: 4, name: msg("High Dirt") }, { id: 5, name: msg("High Lava") }, { id: 7, name: msg("High Shale") },
    ],
    defaultIsom: 2,
  },
  {
    id: "jungle",
    name: msg("Jungle World"),
    color: "#3c5a37",
    accent: "#263d24",
    terrain: [
      { id: 5, name: msg("Water") }, { id: 2, name: msg("Dirt") }, { id: 4, name: msg("Mud") }, { id: 8, name: msg("Jungle") },
      { id: 15, name: msg("Rocky Ground") }, { id: 11, name: msg("Ruins") }, { id: 9, name: msg("Raised Jungle") }, { id: 16, name: msg("Temple") },
      { id: 3, name: msg("High Dirt") }, { id: 10, name: msg("High Jungle") }, { id: 12, name: msg("High Ruins") }, { id: 13, name: msg("High Raised Jungle") },
      { id: 17, name: msg("High Temple") },
    ],
    defaultIsom: 8,
  },
  {
    id: "desert",
    name: msg("Desert"),
    color: "#7a6642",
    accent: "#55462c",
    terrain: [
      { id: 5, name: msg("Tar") }, { id: 2, name: msg("Dirt") }, { id: 4, name: msg("Dried Mud") }, { id: 8, name: msg("Sand Dunes") },
      { id: 15, name: msg("Rocky Ground") }, { id: 11, name: msg("Crags") }, { id: 9, name: msg("Sandy Sunken Pit") }, { id: 16, name: msg("Compound") },
      { id: 3, name: msg("High Dirt") }, { id: 10, name: msg("High Sand Dunes") }, { id: 12, name: msg("High Crags") }, { id: 13, name: msg("High Sandy Sunken Pit") },
      { id: 17, name: msg("High Compound") },
    ],
    defaultIsom: 2,
  },
  {
    id: "ice",
    name: msg("Ice"),
    color: "#6f8592",
    accent: "#4a5c67",
    terrain: [
      { id: 5, name: msg("Ice") }, { id: 2, name: msg("Snow") }, { id: 4, name: msg("Moguls") }, { id: 8, name: msg("Dirt") },
      { id: 15, name: msg("Rocky Snow") }, { id: 11, name: msg("Grass") }, { id: 9, name: msg("Water") }, { id: 16, name: msg("Outpost") },
      { id: 3, name: msg("High Snow") }, { id: 10, name: msg("High Dirt") }, { id: 12, name: msg("High Grass") }, { id: 13, name: msg("High Water") },
      { id: 17, name: msg("High Outpost") },
    ],
    defaultIsom: 2,
  },
  {
    id: "twilight",
    name: msg("Twilight"),
    color: "#4b4560",
    accent: "#302b40",
    terrain: [
      { id: 5, name: msg("Water") }, { id: 2, name: msg("Dirt") }, { id: 4, name: msg("Mud") }, { id: 8, name: msg("Crushed Rock") },
      { id: 15, name: msg("Crevices") }, { id: 11, name: msg("Flagstones") }, { id: 9, name: msg("Sunken Ground") }, { id: 16, name: msg("Basilica") },
      { id: 3, name: msg("High Dirt") }, { id: 10, name: msg("High Crushed Rock") }, { id: 12, name: msg("High Flagstones") }, { id: 13, name: msg("High Sunken Ground") },
      { id: 17, name: msg("High Basilica") },
    ],
    defaultIsom: 2,
  },
];

export const TILESET_BY_ID: Record<TilesetId, TilesetInfo> = Object.fromEntries(
  TILESETS.map((t) => [t.id, t]),
) as Record<TilesetId, TilesetInfo>;

/** Display name of an ISOM terrain id, or a generic label for ids the palette does not list. */
export function terrainName(info: TilesetInfo, id: number): string {
  return info.terrain.find((t) => t.id === id)?.name ?? `Terrain ${id}`;
}

export const MAP_SIZES = [64, 96, 128, 192, 256] as const;
