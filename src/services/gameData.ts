/**
 * The store-level half of Help ▸ Game Data… and of `api.gameData`: making a source the
 * session's, switching between data sets, installing and removing one. The dialog and the
 * plugin host both go through here, so a switch made by either drops the same caches and
 * bumps the same revision.
 *
 * A *switch* is the one operation the rest of the editor was not built for: every
 * decoded tileset, table, GRP and frame in memory describes the files the source served
 * before, and the ids they are keyed by mean something else in the new set. So a switch
 * clears the lot (`resetUnitAssets`, `releaseAllTilesets`, `clearFrameCache`,
 * `clearComposedImages`), resolves the chain again, and bumps `gameDataRevisionAtom`,
 * on which `useTileset` / `useUnitAssets` reload and the viewport repaints. An *install*
 * of the game's own data over none is the gentler case the dialog always had: nothing in
 * memory is wrong, only missing, so the failed parts are retried and the rest kept.
 */
import type { getDefaultStore } from "jotai";
import { gameDataProfileAtom, gameDataRevisionAtom, gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { releaseAllTilesets, retryTilesetParts } from "../formats/tileset/load";
import { resetUnitAssets, retryFailedParts } from "../formats/units/load";
import { clearFrameCache } from "../formats/units/sprites";
import { installDataSet, InstallError, type GameDataFiles, type InstallProgress } from "../gamedata/install";
import { DEFAULT_PROFILE, isDefaultProfile, isProfileId, type GameDataProfile } from "../gamedata/profiles";
import { adoptStoredCopy, resetAssetSource, resolveAssetSource, type AssetSource } from "../gamedata/source";
import { clearStoredCopy, listStoredCopies, profileOf } from "../gamedata/store";
import { relayBlankTerrain } from "../hooks/useMapFileActions";
import { clearComposedImages } from "../plugins/graphics";

type Store = ReturnType<typeof getDefaultStore>;

/** Whether two sources serve the same files: same data set, same kind — a repaint is enough between them. */
export const sameFiles = (a: AssetSource | null, b: AssetSource) => a !== null && a.kind === b.kind && a.profile.id === b.profile.id;

/**
 * Make `next` the session's source. `switched` says the files behind the ids changed
 * (another data set, or a copy replaced), in which case everything decoded goes; otherwise
 * only what failed is asked for again. Either way the hooks are bumped and the blank
 * startup map is laid again with real variations.
 */
export function adoptSource(store: Store, next: AssetSource, switched: boolean): void {
  if (switched) dropDecodedData();
  retryFailedParts();
  retryTilesetParts();
  store.set(gameDataSourceAtom, next);
  store.set(gameDataRevisionAtom, (n) => n + 1);
  void relayBlankTerrain(store);
}

/** Forget every decoded tileset, table, GRP and picture: the source now serves different files. */
export function dropDecodedData(): void {
  resetUnitAssets();
  releaseAllTilesets();
  clearFrameCache();
  clearComposedImages();
}

/** Every data set with a copy here, the game's own first (whether or not it has a copy). */
export async function listDataSets(): Promise<GameDataProfile[]> {
  const copies = await listStoredCopies();
  const others = copies.map(profileOf).filter((p) => !isDefaultProfile(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [DEFAULT_PROFILE, ...others];
}

/**
 * Switch to the data set `id`: remember the choice, run the chain again and adopt what it
 * answers. A set with no copy falls back to the game's own (the chain says so in `tried`).
 */
export async function switchDataSet(store: Store, id: string): Promise<AssetSource> {
  if (!isProfileId(id)) throw new InstallError(`"${id}" is not a data set id.`);
  const before = store.get(gameDataSourceAtom);
  store.set(gameDataProfileAtom, { profile: id });
  resetAssetSource();
  const next = await resolveAssetSource();
  adoptSource(store, next, !sameFiles(before, next));
  return next;
}

/**
 * Install a data set from its files and switch to it. Installing under the game's own id
 * replaces the game's copy, which the dialog's ordinary routes also do.
 */
export async function installDataSetInto(store: Store, profile: GameDataProfile, input: GameDataFiles, progress?: InstallProgress): Promise<AssetSource> {
  const copy = await installDataSet(profile, input, progress);
  const before = store.get(gameDataSourceAtom);
  store.set(gameDataProfileAtom, { profile: profileOf(copy).id });
  const next = adoptStoredCopy(copy);
  adoptSource(store, next, !sameFiles(before, next) || before?.kind === "stored");
  return next;
}

/**
 * Remove a data set's copy. When it was the one in use the chain runs again — the game's
 * own answers, or nothing does and the dialog asks. Returns whether there was a copy.
 */
export async function removeDataSet(store: Store, id: string): Promise<boolean> {
  const copies = await listStoredCopies();
  const had = copies.some((c) => profileOf(c).id === id);
  await clearStoredCopy(id);
  const current = store.get(gameDataSourceAtom);
  if (current?.profile.id === id || store.get(gameDataProfileAtom).profile === id) {
    store.set(gameDataProfileAtom, { profile: DEFAULT_PROFILE.id });
    resetAssetSource();
    const next = await resolveAssetSource(undefined, { search: false });
    adoptSource(store, next, true);
  }
  return had;
}
