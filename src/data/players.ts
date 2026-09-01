/** Player / force / colour reference data. */

export const PLAYER_COUNT = 12;

export type Controller = "unused" | "human" | "computer" | "rescuable" | "neutral";
export type Race = "zerg" | "terran" | "protoss" | "userSelect" | "random" | "inactive";

export const CONTROLLERS: { id: Controller; label: string }[] = [
  { id: "unused", label: "Unused" },
  { id: "human", label: "Human (Open Slot)" },
  { id: "computer", label: "Computer" },
  { id: "rescuable", label: "Rescuable" },
  { id: "neutral", label: "Neutral" },
];

export const RACES: { id: Race; label: string }[] = [
  { id: "zerg", label: "Zerg" },
  { id: "terran", label: "Terran" },
  { id: "protoss", label: "Protoss" },
  { id: "userSelect", label: "User Selectable" },
  { id: "random", label: "Random" },
  { id: "inactive", label: "Inactive" },
];

export interface PlayerColor {
  id: number;
  name: string;
  hex: string;
}

/** The classic StarCraft player colour table (COLR indices). */
export const PLAYER_COLORS: PlayerColor[] = [
  { id: 0, name: "Red", hex: "#f40404" },
  { id: 1, name: "Blue", hex: "#0c48cc" },
  { id: 2, name: "Teal", hex: "#2cb494" },
  { id: 3, name: "Purple", hex: "#88409c" },
  { id: 4, name: "Orange", hex: "#f88c14" },
  { id: 5, name: "Brown", hex: "#703014" },
  { id: 6, name: "White", hex: "#cce0d0" },
  { id: 7, name: "Yellow", hex: "#fcfc38" },
  { id: 8, name: "Green", hex: "#088008" },
  { id: 9, name: "Pale Yellow", hex: "#fcfc7c" },
  { id: 10, name: "Tan", hex: "#ecc4b0" },
  { id: 11, name: "Dark Aqua", hex: "#4068d4" },
  { id: 12, name: "Pale Green", hex: "#74a47c" },
  { id: 13, name: "Bluish Grey", hex: "#9090b8" },
  { id: 14, name: "Pale Yellow II", hex: "#fcfc7c" },
  { id: 15, name: "Cyan", hex: "#00e4fc" },
  { id: 16, name: "Pink", hex: "#ffc4e4" },
  { id: 17, name: "Olive", hex: "#787800" },
  { id: 18, name: "Lime", hex: "#d2f53c" },
  { id: 19, name: "Navy", hex: "#0000e6" },
  { id: 20, name: "Dark Green", hex: "#006400" },
  { id: 21, name: "Black", hex: "#141414" },
];

/**
 * The colour a player's units are drawn in: the map's COLR choice for the eight playable
 * slots, the fixed table entries for players 9–12. Out-of-range (Remastered custom)
 * indices fall back to the slot's default so nothing ever renders colourless.
 */
export function playerColorIndex(colors: readonly number[] | null | undefined, owner: number): number {
  const c = owner < 8 ? (colors?.[owner] ?? owner) : owner;
  return c >= 0 && c < PLAYER_COLORS.length ? c : owner & 15;
}

export function playerColorHex(colors: readonly number[] | null | undefined, owner: number): string {
  return PLAYER_COLORS[playerColorIndex(colors, owner)].hex;
}

export interface PlayerSlot {
  id: number;
  controller: Controller;
  race: Race;
  colorId: number;
  force: number; // 0..3
}

export function defaultPlayers(): PlayerSlot[] {
  return Array.from({ length: PLAYER_COUNT }, (_, i) => ({
    id: i,
    controller: i < 8 ? "human" : i === 11 ? "neutral" : "unused",
    race: i < 8 ? "userSelect" : "inactive",
    colorId: i,
    force: i < 4 ? 0 : i < 8 ? 1 : 0,
  }));
}

export interface ForceInfo {
  id: number;
  name: string;
  randomStart: boolean;
  allies: boolean;
  alliedVictory: boolean;
  sharedVision: boolean;
}

export function defaultForces(): ForceInfo[] {
  return [0, 1, 2, 3].map((i) => ({
    id: i,
    name: `Force ${i + 1}`,
    randomStart: true,
    allies: i < 2,
    alliedVictory: i < 2,
    sharedVision: false,
  }));
}

/** Player groups selectable in triggers. */
export const TRIGGER_PLAYER_GROUPS = [
  "Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6", "Player 7", "Player 8",
  "Player 9", "Player 10", "Player 11", "Player 12",
  "Current Player", "Foes", "Allies", "Neutral Players", "All Players",
  "Force 1", "Force 2", "Force 3", "Force 4",
  "Non Allied Victory Players",
];
