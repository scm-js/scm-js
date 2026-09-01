/** Player / force / colour reference data. */

export const PLAYER_COUNT = 12;

import { ColorMode, PlayerRace, PlayerType, type PlayerRgb } from "../formats/chk/sections/players";

/** OWNR controller bytes as StarEdit's Player Settings lists them, with the rest for maps that use them. */
export const PLAYER_TYPES: { value: number; label: string; hint?: string }[] = [
  { value: PlayerType.Inactive, label: "Inactive", hint: "The slot does not exist" },
  { value: PlayerType.Human, label: "Human", hint: "Open slot in the lobby" },
  { value: PlayerType.Computer, label: "Computer", hint: "AI-controlled" },
  { value: PlayerType.Rescuable, label: "Rescuable", hint: "Units join whoever reaches them" },
  { value: PlayerType.Neutral, label: "Neutral", hint: "Owned by no one; players 9–12 are usually this" },
  { value: PlayerType.ComputerGame, label: "Computer (game)", hint: "Set by the game once it starts; rarely stored" },
  { value: PlayerType.Occupied, label: "Occupied", hint: "Set by the game for a joined human; rarely stored" },
  { value: PlayerType.ComputerUnused, label: "Computer (unused)" },
  { value: PlayerType.Closed, label: "Closed", hint: "Lobby slot closed" },
  { value: PlayerType.Observer, label: "Observer" },
];

/** SIDE race bytes, in StarEdit's order. */
export const PLAYER_RACES: { value: number; label: string }[] = [
  { value: PlayerRace.Zerg, label: "Zerg" },
  { value: PlayerRace.Terran, label: "Terran" },
  { value: PlayerRace.Protoss, label: "Protoss" },
  { value: PlayerRace.UserSelectable, label: "User Selectable" },
  { value: PlayerRace.Random, label: "Random" },
  { value: PlayerRace.Independent, label: "Independent" },
  { value: PlayerRace.Neutral, label: "Neutral" },
  { value: PlayerRace.Inactive, label: "Inactive" },
];

export const playerTypeLabel = (v: number) => PLAYER_TYPES.find((t) => t.value === v)?.label ?? `Type ${v}`;
export const playerRaceLabel = (v: number) => PLAYER_RACES.find((r) => r.value === v)?.label ?? `Race ${v}`;

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

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");

export function rgbToHex(rgb: readonly [number, number, number]): string {
  return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * The colour to show for a slot in the chrome: a Remastered custom RGB when the slot is
 * set to one, else its palette entry. (The viewport's team-colour remap only knows the
 * palette; a custom colour is previewed in swatches, not on the sprites.)
 */
export function displayColorHex(colors: readonly number[] | null | undefined, rgb: PlayerRgb | null | undefined, owner: number): string {
  if (rgb && owner < 8 && rgb.mode[owner] === ColorMode.Custom) return rgbToHex(rgb.rgb[owner]);
  return playerColorHex(colors, owner);
}

/** Player groups selectable in triggers. */
export const TRIGGER_PLAYER_GROUPS = [
  "Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6", "Player 7", "Player 8",
  "Player 9", "Player 10", "Player 11", "Player 12",
  "Current Player", "Foes", "Allies", "Neutral Players", "All Players",
  "Force 1", "Force 2", "Force 3", "Force 4",
  "Non Allied Victory Players",
];
