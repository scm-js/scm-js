import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { DEFAULT_PROFILE, racesTableWith } from "../gamedata/profiles";
import { currentAssetSource, setAssetSource, type AssetSource } from "../gamedata/source";
import type { DataSetRace } from "@scm-js/mod";
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
 * The races the data set in use declares (empty for the game's own): its source's profile carries them, so a
 * component reading this repaints when they are declared (`services/gameData.ts#setDataSetRaces` replaces the source).
 */
export const dataSetRacesAtom = atom<readonly DataSetRace[]>((get) => get(gameDataSourceAtom)?.profile.races ?? []);

/**
 * The races declared for each data set, by id (`gamedata/profiles.ts#RACES_KEY`), persisted
 * under `scmjs.dataSetRaces` — written out here so `tests/storage.test.ts` finds it. The
 * source reads the key itself (`racesOf`), since it runs outside the store; `keepRacesAtom`
 * is the one writer. Preferences ▸ Storage clears it through this atom and then
 * `refreshDataSetRacesAtom`, so the names go at once.
 */
export const keptRacesAtom = atomWithStorage<Record<string, DataSetRace[]>>("scmjs.dataSetRaces", {}, mergedStorage<Record<string, DataSetRace[]>>({}), { getOnInit: true });

/**
 * The session's source again with its profile's races as kept now, and the panels told (the
 * `"gameData"` event): after the kept table changed. The source in use, or null before one.
 */
export const refreshDataSetRacesAtom = atom(null, (get, set): AssetSource | null => {
  const current = get(gameDataSourceAtom) ?? currentAssetSource();
  if (!current) return null;
  // (`setAssetSource` gives the source its profile with the races now kept.)
  const next: AssetSource = { ...current };
  setAssetSource(next);
  set(gameDataSourceAtom, next);
  return next;
});

/**
 * Keep `races` for the data set `id` (normalized; an empty table is kept as "none"), and
 * redraw with them when that set is in use. False, and nothing kept, for the game's own sets.
 */
export const keepRacesAtom = atom(null, (get, set, keep: { id: string; races: readonly DataSetRace[] }): boolean => {
  const table = racesTableWith(keep.id, keep.races);
  if (!table) return false;
  set(keptRacesAtom, table);
  if ((get(gameDataSourceAtom) ?? currentAssetSource())?.profile.id === keep.id) set(refreshDataSetRacesAtom);
  return true;
});

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
