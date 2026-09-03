import { atom } from "jotai";
import type { AssetSource } from "../gamedata/source";

/**
 * The session's game data source as the chrome sees it (`gamedata/source.ts` is the
 * truth; `useGameData` mirrors it here), and a counter the tileset / unit hooks watch so
 * an install from Help ▸ Game Data… makes the viewport ask for the graphics again.
 */
export const gameDataSourceAtom = atom<AssetSource | null>(null);
export const gameDataRevisionAtom = atom(0);

/**
 * Set while the open map's terrain was laid without the graphics: `flatTerrain` has no
 * CV5 to pick variations from, so every pair falls back to variation 0 and the map draws
 * as one megatile repeated — a regular grid of seams — the moment the tileset arrives.
 * `relayBlankTerrain` lays it again with the real variations when that happens; it holds
 * the terrain the fill used, and is cleared by any other document change.
 */
export const blankFillAtom = atom<{ terrainId: number } | null>(null);
