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
    name: "Badlands",
    color: "#5a4a34",
    accent: "#3e3323",
    terrain: [
      { id: 2, name: "Dirt" }, { id: 4, name: "Mud" }, { id: 3, name: "High Dirt" }, { id: 5, name: "Water" },
      { id: 6, name: "Grass" }, { id: 7, name: "High Grass" }, { id: 18, name: "Structure" }, { id: 14, name: "Asphalt" },
      { id: 15, name: "Rocky Ground" },
    ],
    defaultIsom: 2,
  },
  {
    id: "platform",
    name: "Space Platform",
    color: "#3b4250",
    accent: "#262b36",
    terrain: [
      { id: 2, name: "Space" }, { id: 8, name: "Low Platform" }, { id: 9, name: "Rusty Pit" }, { id: 3, name: "Platform" },
      { id: 11, name: "Dark Platform" }, { id: 4, name: "Plating" }, { id: 7, name: "Solar Array" }, { id: 5, name: "High Platform" },
      { id: 6, name: "High Plating" }, { id: 10, name: "Elevated Catwalk" },
    ],
    defaultIsom: 3,
  },
  {
    id: "install",
    name: "Installation",
    color: "#4a4d5c",
    accent: "#30333f",
    terrain: [
      { id: 2, name: "Substructure" }, { id: 3, name: "Floor" }, { id: 6, name: "Roof" }, { id: 4, name: "Substructure Plating" },
      { id: 5, name: "Plating" }, { id: 8, name: "Substructure Panels" }, { id: 7, name: "Bottomless Pit" },
    ],
    defaultIsom: 3,
  },
  {
    id: "ashworld",
    name: "Ashworld",
    color: "#4d3a34",
    accent: "#2f2320",
    terrain: [
      { id: 8, name: "Magma" }, { id: 2, name: "Dirt" }, { id: 3, name: "Lava" }, { id: 6, name: "Shale" },
      { id: 9, name: "Broken Rock" }, { id: 4, name: "High Dirt" }, { id: 5, name: "High Lava" }, { id: 7, name: "High Shale" },
    ],
    defaultIsom: 2,
  },
  {
    id: "jungle",
    name: "Jungle World",
    color: "#3c5a37",
    accent: "#263d24",
    terrain: [
      { id: 5, name: "Water" }, { id: 2, name: "Dirt" }, { id: 4, name: "Mud" }, { id: 8, name: "Jungle" },
      { id: 15, name: "Rocky Ground" }, { id: 11, name: "Ruins" }, { id: 9, name: "Raised Jungle" }, { id: 16, name: "Temple" },
      { id: 3, name: "High Dirt" }, { id: 10, name: "High Jungle" }, { id: 12, name: "High Ruins" }, { id: 13, name: "High Raised Jungle" },
      { id: 17, name: "High Temple" },
    ],
    defaultIsom: 8,
  },
  {
    id: "desert",
    name: "Desert",
    color: "#7a6642",
    accent: "#55462c",
    terrain: [
      { id: 5, name: "Tar" }, { id: 2, name: "Dirt" }, { id: 4, name: "Dried Mud" }, { id: 8, name: "Sand Dunes" },
      { id: 15, name: "Rocky Ground" }, { id: 11, name: "Crags" }, { id: 9, name: "Sandy Sunken Pit" }, { id: 16, name: "Compound" },
      { id: 3, name: "High Dirt" }, { id: 10, name: "High Sand Dunes" }, { id: 12, name: "High Crags" }, { id: 13, name: "High Sandy Sunken Pit" },
      { id: 17, name: "High Compound" },
    ],
    defaultIsom: 2,
  },
  {
    id: "ice",
    name: "Ice",
    color: "#6f8592",
    accent: "#4a5c67",
    terrain: [
      { id: 5, name: "Ice" }, { id: 2, name: "Snow" }, { id: 4, name: "Moguls" }, { id: 8, name: "Dirt" },
      { id: 15, name: "Rocky Snow" }, { id: 11, name: "Grass" }, { id: 9, name: "Water" }, { id: 16, name: "Outpost" },
      { id: 3, name: "High Snow" }, { id: 10, name: "High Dirt" }, { id: 12, name: "High Grass" }, { id: 13, name: "High Water" },
      { id: 17, name: "High Outpost" },
    ],
    defaultIsom: 2,
  },
  {
    id: "twilight",
    name: "Twilight",
    color: "#4b4560",
    accent: "#302b40",
    terrain: [
      { id: 5, name: "Water" }, { id: 2, name: "Dirt" }, { id: 4, name: "Mud" }, { id: 8, name: "Crushed Rock" },
      { id: 15, name: "Crevices" }, { id: 11, name: "Flagstones" }, { id: 9, name: "Sunken Ground" }, { id: 16, name: "Basilica" },
      { id: 3, name: "High Dirt" }, { id: 10, name: "High Crushed Rock" }, { id: 12, name: "High Flagstones" }, { id: 13, name: "High Sunken Ground" },
      { id: 17, name: "High Basilica" },
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

export const DOODAD_CATEGORIES = [
  "Rocks & Boulders",
  "Vegetation",
  "Ruins & Structures",
  "Craters & Pits",
  "Cliff Decorations",
  "Water Features",
  "Bones & Remains",
  "Machinery",
  "Lights & Beacons",
  "Miscellaneous",
];
