/** StarCraft tileset reference data (UI only — no real tile data yet). */

export type TilesetId =
  | "badlands"
  | "platform"
  | "install"
  | "ashworld"
  | "jungle"
  | "desert"
  | "ice"
  | "twilight";

export interface TilesetInfo {
  id: TilesetId;
  name: string;
  /** Representative ground colour used for placeholder rendering. */
  color: string;
  /** Slightly darker accent used for grid / minimap. */
  accent: string;
  /** Default ISOM terrain groups, in the order the palettes present them. */
  terrain: string[];
  /** Terrain used to fill a brand new map. */
  defaultTerrain: string;
}

export const TILESETS: TilesetInfo[] = [
  {
    id: "badlands",
    name: "Badlands",
    color: "#5a4a34",
    accent: "#3e3323",
    terrain: ["Dirt", "Mud", "High Dirt", "Water", "Grass", "High Grass", "Structure", "Asphalt", "Rocky Ground"],
    defaultTerrain: "Dirt",
  },
  {
    id: "platform",
    name: "Space Platform",
    color: "#3b4250",
    accent: "#262b36",
    terrain: ["Space", "Low Platform", "Rusty Pit", "Platform", "Dark Platform", "Plating", "Solar Array", "High Platform", "High Plating", "Elevated Catwalk"],
    defaultTerrain: "Platform",
  },
  {
    id: "install",
    name: "Installation",
    color: "#4a4d5c",
    accent: "#30333f",
    terrain: ["Substructure", "Floor", "Roof", "Substructure Plating", "Plating", "Substructure Panels", "Bottomless Pit"],
    defaultTerrain: "Floor",
  },
  {
    id: "ashworld",
    name: "Ashworld",
    color: "#4d3a34",
    accent: "#2f2320",
    terrain: ["Magma", "Dirt", "Lava", "Shale", "Broken Rock", "High Dirt", "High Lava", "High Shale"],
    defaultTerrain: "Dirt",
  },
  {
    id: "jungle",
    name: "Jungle World",
    color: "#3c5a37",
    accent: "#263d24",
    terrain: ["Water", "Dirt", "Mud", "Jungle", "Rocky Ground", "Ruins", "Raised Jungle", "Temple", "High Dirt", "High Jungle", "High Ruins", "High Raised Jungle", "High Temple"],
    defaultTerrain: "Jungle",
  },
  {
    id: "desert",
    name: "Desert",
    color: "#7a6642",
    accent: "#55462c",
    terrain: ["Tar", "Dirt", "Dried Mud", "Sand Dunes", "Rocky Ground", "Crags", "Sandy Sunken Pit", "Compound", "High Dirt", "High Sand Dunes", "High Crags", "High Sandy Sunken Pit", "High Compound"],
    defaultTerrain: "Dirt",
  },
  {
    id: "ice",
    name: "Ice",
    color: "#6f8592",
    accent: "#4a5c67",
    terrain: ["Ice", "Snow", "Moguls", "Dirt", "Rocky Snow", "Grass", "Water", "Outpost", "High Snow", "High Dirt", "High Grass", "High Water", "High Outpost"],
    defaultTerrain: "Snow",
  },
  {
    id: "twilight",
    name: "Twilight",
    color: "#4b4560",
    accent: "#302b40",
    terrain: ["Water", "Dirt", "Mud", "Crushed Rock", "Crevices", "Flagstones", "Sunken Ground", "Basilica", "High Dirt", "High Crushed Rock", "High Flagstones", "High Sunken Ground", "High Basilica"],
    defaultTerrain: "Dirt",
  },
];

export const TILESET_BY_ID: Record<TilesetId, TilesetInfo> = Object.fromEntries(
  TILESETS.map((t) => [t.id, t]),
) as Record<TilesetId, TilesetInfo>;

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
