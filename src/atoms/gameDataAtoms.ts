import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_PROFILE } from "../gamedata/profiles";
import type { AssetSource } from "../gamedata/source";
import { mergedStorage } from "./storage";

/**
 * The session's game data source as the chrome sees it (`gamedata/source.ts` is the
 * truth; `usePreload` mirrors it here), and a counter the tileset / unit hooks watch so
 * an install from Help ▸ Game Data… makes the viewport ask for the graphics again — or,
 * after a switch to another data set, drop what they hold and ask afresh.
 */
export const gameDataSourceAtom = atom<AssetSource | null>(null);
export const gameDataRevisionAtom = atom(0);

/**
 * The data set the user chose (`gamedata/profiles.ts`), persisted under `scmjs.gameData` —
 * the literal `PROFILE_KEY` there, written out here so `tests/storage.test.ts` finds it.
 * The resolver reads the same key itself (`activeProfileId`), since it runs outside the
 * store; `services/gameData.ts#switchDataSet` is the one writer, and it re-resolves.
 */
export const gameDataProfileAtom = atomWithStorage<{ profile: string }>("scmjs.gameData", { profile: DEFAULT_PROFILE.id }, mergedStorage({ profile: DEFAULT_PROFILE.id }), { getOnInit: true });

/**
 * Set while the open map's terrain was laid without the graphics: `flatTerrain` has no
 * CV5 to pick variations from, so every pair falls back to variation 0 and the map draws
 * as one megatile repeated — a regular grid of seams — the moment the tileset arrives.
 * `relayBlankTerrain` lays it again with the real variations when that happens; it holds
 * the terrain the fill used, and is cleared by any other document change.
 */
export const blankFillAtom = atom<{ terrainId: number } | null>(null);
