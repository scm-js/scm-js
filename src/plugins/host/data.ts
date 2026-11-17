/**
 * `api.data` and `api.gameData`: the decoded tables, the game data's source and the data sets.
 */
import { getUnitAssets, imageGrpPath, peekUnitAssets } from "../../formats/units/load";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { DEFAULT_PROFILE, isProfileId } from "../../gamedata/profiles";
import { currentAssetSource, readFrom, readUnder, resolveAssetSource, type AssetSource } from "../../gamedata/source";
import { cleanStoredPath, storedPathOf } from "../../gamedata/paths";
import { attachReaderDataSet, dataSetRaceCandidates, installDataSetInto, listDataSets, rehashDataSet, reloadDataSet, removeDataSet, setDataSetRaces, switchDataSet } from "../../services/gameData";
import { normalizeRaces } from "@scm-js/mod";
import { unitRace } from "../../formats/dat/dat";
import type { DataApi, GameDataApi, GameDataSource } from "../api";
import type { Store } from "./shared";

/** `api.data`: the decoded `.dat` tables, once they are in memory. */
export function dataApi(): DataApi {
  const assets = () => peekUnitAssets();
  return {
    ready: () => assets() !== null,
    load: async () => {
      try { await getUnitAssets(); return true; } catch { return false; }
    },
    units: () => assets()?.units ?? null,
    weapons: () => assets()?.weapons ?? null,
    upgrades: () => assets()?.upgrades ?? null,
    techs: () => assets()?.techs ?? null,
    sprites: () => assets()?.sprites ?? null,
    flingy: () => assets()?.flingy ?? null,
    images: () => assets()?.images ?? null,
    race: (unitId) => { const a = assets(); return a ? unitRace(a.units, unitId) : null; },
    imagePath: (imageId) => { const a = assets(); return a ? imageGrpPath(a, imageId) : null; },
  };
}

/** `api.gameData`: the source and the data sets, over `services/gameData.ts`. */
export function gameDataApi(store: Store): GameDataApi {
  const publish = (s: AssetSource): GameDataSource => {
    const hash = s.stored?.hash ?? s.reader?.hash;
    const base = s.stored?.base ?? s.reader?.base?.profile.id;
    return { kind: s.kind, label: s.label, profile: { ...s.profile, ...(s.profile.races ? { races: s.profile.races.map((r) => ({ ...r })) } : {}) }, desktop: s.desktop === true, ...(hash ? { hash } : {}), ...(base ? { base } : {}) };
  };
  const source = () => store.get(gameDataSourceAtom) ?? currentAssetSource();
  return {
    source: () => { const s = source(); return s ? publish(s) : null; },
    profile: () => { const p = source()?.profile ?? DEFAULT_PROFILE; return { ...p, ...(p.races ? { races: p.races.map((r) => ({ ...r })) } : {}) }; },
    profiles: listDataSets,
    install: async (profile, files, progress) => publish(await installDataSetInto(store, { id: profile.id, name: profile.name, ...(profile.url ? { url: profile.url } : {}), ...(profile.races ? { races: normalizeRaces(profile.races) } : {}) }, files, progress)),
    attach: async (profile, read, options) => {
      if (!isProfileId(profile.id)) throw new Error(`"${profile.id}" is not a data set id: lower-case letters, digits and hyphens, up to 40 characters.`);
      if (typeof read !== "function") throw new Error("gameData.attach needs a function that reads a file");
      const { races, ...rest } = profile;
      return publish(attachReaderDataSet(store, { ...rest, ...(races ? { races: normalizeRaces(races) } : {}) }, read, options?.hash));
    },
    reload: () => reloadDataSet(store),
    rehash: (hash) => {
      if (hash !== null && typeof hash !== "string") throw new Error("gameData.rehash takes a hash or null");
      const next = rehashDataSet(store, hash);
      return next ? publish(next) : null;
    },
    select: async (id) => publish(await switchDataSet(store, id)),
    remove: (id) => removeDataSet(store, id),
    read: (path, options) => readGameFile(path, options?.under === true),
    storedPath: (member) => storedPathOf(String(member)),
    races: () => (source()?.profile.races ?? []).map((r) => ({ ...r })),
    raceCandidates: () => dataSetRaceCandidates(store),
    setRaces: (races, id) => {
      if (!Array.isArray(races)) throw new Error("gameData.setRaces takes a list of races");
      if (id !== undefined && !isProfileId(id)) throw new Error(`"${String(id)}" is not a data set id: lower-case letters, digits and hyphens, up to 40 characters.`);
      const next = setDataSetRaces(store, races, id);
      return next ? publish(next) : null;
    },
  };
}

async function readGameFile(path: string, under: boolean): Promise<Uint8Array | null> {
  const clean = cleanStoredPath(path);
  if (!clean || clean.split("/").includes("..")) return null;
  // A dev server answers a missing file with its index page; `readFrom` takes that for none.
  return under ? readUnder(clean) : readFrom(await resolveAssetSource(), clean);
}
