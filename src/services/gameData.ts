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
import { viewFlagsAtom } from "../atoms/editorAtoms";
import { gameDataProfileAtom, gameDataRevisionAtom, gameDataSourceAtom, keepRacesAtom } from "../atoms/gameDataAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { releaseAllTilesets, retryTilesetParts } from "../formats/tileset/load";
import { resetUnitAssets, retryFailedParts } from "../formats/units/load";
import { clearFrameCache } from "../formats/units/sprites";
import { installDataSet, InstallError, installFromRemastered, type GameDataFiles, type InstallProgress, type RemasteredFolder, type RemasteredOptions } from "../gamedata/install";
import { DEFAULT_PROFILE, isDefaultProfile, isProfileId, racesOf, takesRaces, type GameDataProfile } from "../gamedata/profiles";
import { normalizeRaces, raceCandidates, type DataSetRace } from "@scm-js/mod";
import { storedPathOf } from "../gamedata/paths";
import { REMASTERED_PROFILE } from "../gamedata/profiles";
import { adoptStoredCopy, currentAssetSource, readContext, readFrom, resetAssetSource, resolveAssetSource, setAssetSource, type AssetSource, type DataSetReader } from "../gamedata/source";
import { clearStoredCopy, listStoredCopies, profileOf } from "../gamedata/store";
import { relayBlankTerrain } from "../hooks/useMapFileActions";
import { clearComposedImages } from "../plugins/graphics";
import { t } from "../i18n";
import { count, gameDataOf } from "./usage";

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
  const before = gameDataOf(store.get(gameDataSourceAtom));
  if (before !== gameDataOf(next)) count("gamedata", { data: gameDataOf(next), was: before });
  if (switched) dropDecodedData();
  retryFailedParts();
  retryTilesetParts();
  store.set(gameDataSourceAtom, next);
  store.set(gameDataRevisionAtom, (n) => n + 1);
  void relayBlankTerrain(store);
}

/**
 * Turn View ▸ Remastered Graphics on, now and for later sessions. Called when a copy has
 * just been made from a Remastered installation: someone who pointed the editor at
 * Remastered and then saw the 1.16 pictures would not go looking for a menu item, and the
 * copy they just waited for is mostly those pictures. Only ever at that moment — the
 * option is the user's from then on, and unticking it (or the preference) stays unticked.
 */
export function turnOnRemasteredGraphics(store: Store): void {
  if (!store.get(preferencesAtom).hdGraphics) store.set(preferencesAtom, { ...store.get(preferencesAtom), hdGraphics: true });
  if (!store.get(viewFlagsAtom).hdGraphics) store.set(viewFlagsAtom, { ...store.get(viewFlagsAtom), hdGraphics: true });
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
  if (!isProfileId(id)) throw new InstallError(t("\"{id}\" is not a data set id.", { id }));
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
  keepGivenRaces(store, profile);
  const before = store.get(gameDataSourceAtom);
  store.set(gameDataProfileAtom, { profile: profileOf(copy).id });
  const next = adoptStoredCopy(copy);
  adoptSource(store, next, !sameFiles(before, next) || before?.kind === "stored");
  return next;
}

/**
 * Install a StarCraft: Remastered installation as a data set beside the game's own and
 * switch to it — the route for someone who already has the 1.16 files and wants the tiles
 * Remastered added.
 */
export async function installRemasteredInto(store: Store, folder: RemasteredFolder, progress?: InstallProgress, options?: RemasteredOptions): Promise<AssetSource> {
  const copy = await installFromRemastered(folder, progress, REMASTERED_PROFILE, options);
  const before = store.get(gameDataSourceAtom);
  store.set(gameDataProfileAtom, { profile: profileOf(copy).id });
  const next = adoptStoredCopy(copy);
  turnOnRemasteredGraphics(store);
  adoptSource(store, next, !sameFiles(before, next) || before?.kind === "stored");
  return next;
}

/**
 * Draw from a data set that is a function in memory (`source.ts#DataSetReader`): every file
 * is asked of `read` first and the rest come from the source in use now (or, when that is
 * itself such a function, from what it lays over). Nothing is stored and the choice is not
 * remembered: a reload, or a switch to another data set, leaves it.
 */
export function attachReaderDataSet(store: Store, profile: GameDataProfile, read: DataSetReader["read"], hash?: string): AssetSource {
  // (Races the profile brings are kept for its id; without any, those kept before for the id come back.)
  keepGivenRaces(store, profile);
  const before = store.get(gameDataSourceAtom) ?? currentAssetSource();
  const base = before?.kind === "reader" ? before.reader?.base ?? null : before;
  const next: AssetSource = {
    kind: "reader",
    profile: { id: profile.id, name: profile.name.trim() || profile.id, ...(profile.url ? { url: profile.url } : {}) },
    label: t("Read from {name} in memory, over {base}", { name: profile.name.trim() || profile.id, base: base?.profile.name ?? DEFAULT_PROFILE.name }),
    tried: [],
    reader: { read, base, ...(hash ? { hash } : {}) },
  };
  setAssetSource(next);
  adoptSource(store, next, true);
  return next;
}

/** Keep the races a profile handed in declares, for its id; a profile with none leaves what was kept. */
function keepGivenRaces(store: Store, profile: GameDataProfile): void {
  const races = normalizeRaces(profile.races);
  if (races.length) store.set(keepRacesAtom, { id: profile.id, races });
}

/**
 * Declare the races a data set adds (`races`, normalized; empty forgets them), for the set in
 * use or the set `id`, kept with the id so they outlive a new release and a re-attach. When
 * the set is the one in use its source is replaced by one whose profile carries them, which
 * the `"gameData"` event and every panel reading the source see. Null for the game's own
 * sets (nothing is kept) and for a set not in use (kept for when it is).
 */
export function setDataSetRaces(store: Store, races: readonly DataSetRace[], id?: string): AssetSource | null {
  const current = store.get(gameDataSourceAtom) ?? currentAssetSource();
  const target = id ?? current?.profile.id ?? DEFAULT_PROFILE.id;
  // (Keeping them redraws the set in use with them.)
  if (!store.set(keepRacesAtom, { id: target, races })) return null;
  if (!current || current.profile.id !== target) return null;
  return store.get(gameDataSourceAtom) ?? currentAssetSource();
}

/** The letters a race's own files may go by: every letter but the game's (z, t, p and the neutral n). */
const RACE_LETTERS = [..."abcdefghijklmnopqrstuvwxyz"].filter((c) => !"ztpn".includes(c));

/**
 * What the data set in use suggests about races it adds (`api.gameData.raceCandidates`):
 * the strings its `rez\network.tbl` has past the game's own table (the one under a set in
 * memory, where there is one, else the length 1.16.1's has) and the letters with a
 * `game\<x>console.pcx` or `rez\statbtn<x>.bin` of the set's own, less the names and letters
 * already declared for it. Hints for a person to confirm, never names to fill in. Empty
 * for the game's own sets. A set in memory is asked through its function alone; a stored
 * copy holds only what the extraction kept, which is none of these files.
 */
export async function dataSetRaceCandidates(store: Store): Promise<{ names: string[]; letters: string[] }> {
  const source = store.get(gameDataSourceAtom) ?? currentAssetSource();
  if (!source || source.kind === "none" || !takesRaces(source.profile.id)) return { names: [], letters: [] };
  const reader = source.kind === "reader" ? source.reader ?? null : null;
  const own = async (member: string): Promise<Uint8Array | null> => {
    const path = storedPathOf(member);
    try {
      if (source.kind === "reader") return reader ? (await reader.read(path, readContext(reader, path))) ?? null : null;
      return await readFrom(source, path);
    } catch {
      return null;
    }
  };
  const network = await own("rez\\network.tbl");
  const gameNetwork = reader?.base ? await readFrom(reader.base, storedPathOf("rez\\network.tbl")).catch(() => null) : null;
  const paths: string[] = [];
  for (const x of RACE_LETTERS) {
    for (const member of [`game\\${x}console.pcx`, `rez\\statbtn${x}.bin`]) if (await own(member)) paths.push(member);
  }
  const found = raceCandidates({ network, gameNetwork, paths });
  const declared = racesOf(source.profile);
  const names = new Set(declared.map((r) => r.name.toLowerCase())), letters = new Set(declared.map((r) => r.letter).filter(Boolean));
  return {
    names: [...new Set(found.names.map((n) => n.name))].filter((n) => !names.has(n.toLowerCase())),
    letters: found.letters.filter((l) => !letters.has(l)),
  };
}

/**
 * Give the data set in memory in use a new hash, or none — what a map saved now and Test
 * Map hand on — without reading anything again: the files did not change, or their change
 * was already drawn (`reloadDataSet`), and only their digest arrived later. The source is
 * replaced by one with the new hash (the `"gameData"` event fires); nothing decoded is
 * dropped. Null, and nothing changes, when the source in use is not a data set in memory.
 */
export function rehashDataSet(store: Store, hash: string | null): AssetSource | null {
  const current = store.get(gameDataSourceAtom) ?? currentAssetSource();
  if (current?.kind !== "reader" || !current.reader) return null;
  if ((current.reader.hash ?? null) === (hash || null)) return current;
  const next: AssetSource = { ...current, reader: { read: current.reader.read, base: current.reader.base, ...(hash ? { hash } : {}) } };
  setAssetSource(next);
  store.set(gameDataSourceAtom, next);
  return next;
}

/**
 * Drop everything decoded and draw again from the same source — after the files behind a
 * data set in memory changed. The tables, tilesets and pictures are read afresh.
 */
export function reloadDataSet(store: Store): void {
  const current = store.get(gameDataSourceAtom) ?? currentAssetSource();
  if (!current) return;
  adoptSource(store, current, true);
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
