import { atom } from "jotai";
import type { AssetSource } from "../gamedata/source";

/**
 * The session's game data source as the chrome sees it (`gamedata/source.ts` is the
 * truth; `useGameData` mirrors it here), and a counter the tileset / unit hooks watch so
 * an install from Help ▸ Game Data… makes the viewport ask for the graphics again.
 */
export const gameDataSourceAtom = atom<AssetSource | null>(null);
export const gameDataRevisionAtom = atom(0);
