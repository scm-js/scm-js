/**
 * A map remembers the data set it was made with: an archive member `scmjs\dataset.json`
 * (`{ id, name, hash, url?, races? }`, through the archive extras every plugin's members ride in)
 * written when the map is saved while a data set other than the game's own is in use, and
 * kept as it is otherwise — a map made for a mod and touched up without it still says what
 * it was made for. The game and other editors ignore the member.
 *
 * On opening a map whose member names a data set other than the one in use, the editor
 * asks once: switch to it when it is installed here, or say where its makers publish it
 * when it is not. Nothing is ever fetched from that address.
 */
import type { getDefaultStore } from "jotai";
import { archiveExtrasAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom, keepRacesAtom } from "../atoms/gameDataAtoms";
import { openDialogAtom } from "../atoms/uiAtoms";
import { isDefaultProfile, isProfileId, keptRaces } from "../gamedata/profiles";
import { normalizeRaces, type DataSetRace } from "@scm-js/mod";
import { sameRaces } from "../formats/mod/races";
import { currentAssetSource, type AssetSource } from "../gamedata/source";
import { listStoredCopies, profileOf } from "../gamedata/store";

type Store = ReturnType<typeof getDefaultStore>;

/** The member's name in the map's archive. */
export const DATASET_MEMBER = "scmjs\\dataset.json";

/** What the member says. */
export interface MapDataSet {
  id: string;
  name: string;
  /** The data set's hash (`overCopy.ts#dataSetHashOf`, core's `modHashOfDigests`: the mod's hash); empty when none was known. */
  hash: string;
  /** Where the data set's makers publish it, when the data set says. */
  url?: string;
  /** The races the data set adds to the game's own, when it declares them (absent otherwise). */
  races?: DataSetRace[];
}

/** The member a source would write, or null for the game's own data (nothing is written then). */
export function dataSetOf(source: AssetSource | null): MapDataSet | null {
  if (!source || source.kind === "none" || isDefaultProfile(source.profile.id)) return null;
  const hash = source.stored?.hash ?? source.reader?.hash ?? "";
  const url = source.profile.url ?? source.stored?.profile?.url;
  const races = normalizeRaces(source.profile.races);
  return { id: source.profile.id, name: source.profile.name, hash, ...(url ? { url } : {}), ...(races.length ? { races } : {}) };
}

export function encodeDataSet(set: MapDataSet): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(set, null, 2) + "\n");
}

/** The member of a map's extras, or null when it has none or it is not one this can read. */
export function readDataSet(extras: ReadonlyMap<string, Uint8Array>): MapDataSet | null {
  let data: Uint8Array | undefined;
  for (const [name, bytes] of extras) if (name.toLowerCase() === DATASET_MEMBER) data = bytes;
  if (!data) return null;
  try {
    const raw: unknown = JSON.parse(new TextDecoder().decode(data));
    if (!raw || typeof raw !== "object") return null;
    const { id, name, hash, url } = raw as Record<string, unknown>;
    if (!isProfileId(id)) return null;
    // (A table that is no table, or rows that are no races, read as none: the rest of the member stands.)
    const races = normalizeRaces((raw as Record<string, unknown>).races);
    return {
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : id,
      hash: typeof hash === "string" ? hash : "",
      ...(typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim()) ? { url: url.trim() } : {}),
      ...(races.length ? { races } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * `extras` with the member `set` says (the map's own member replaced when it says something
 * else); `extras` itself when there is no set (the game's own data) or the map already says
 * exactly that.
 */
export function withDataSet<T extends ReadonlyMap<string, Uint8Array>>(extras: T, set: MapDataSet | null): T | Map<string, Uint8Array> {
  if (!set) return extras;
  const was = readDataSet(extras);
  if (was && was.id === set.id && was.name === set.name && was.hash === set.hash && was.url === set.url && sameRaces(was.races ?? [], set.races ?? [])) return extras;
  const next = new Map(extras);
  for (const name of next.keys()) if (name.toLowerCase() === DATASET_MEMBER) next.delete(name);
  next.set(DATASET_MEMBER, encodeDataSet(set));
  return next;
}

/**
 * The extras a map leaves the editor with — Export, Test Map, a share, My Maps — when it is
 * not Save: the document's, with the data set in use stamped in when it is not the game's
 * own. The document itself is left as it is (Save is what writes the member into it).
 */
export function outgoingExtras(store: Store, extras: Map<string, Uint8Array>): Map<string, Uint8Array> {
  return withDataSet(extras, dataSetOf(store.get(gameDataSourceAtom) ?? currentAssetSource()));
}

/**
 * Before a save: put the data set in use into the map's extras when it is not the game's
 * own and the map does not already say exactly that. True when the extras changed (bytes
 * built before this are stale).
 */
export function stampDataSet(store: Store): boolean {
  const extras = store.get(archiveExtrasAtom);
  const next = outgoingExtras(store, extras);
  if (next === extras) return false;
  store.set(archiveExtrasAtom, next);
  return true;
}

/**
 * After a map opened: when it names a data set other than the one in use, ask whether to
 * switch (installed here) or say where to get it (not installed). Quiet otherwise.
 */
export async function offerMapDataSet(store: Store, extras: ReadonlyMap<string, Uint8Array>): Promise<void> {
  const set = readDataSet(extras);
  if (!set) return;
  const current = store.get(gameDataSourceAtom) ?? currentAssetSource();
  adoptMapRaces(store, set, current);
  if ((current?.profile.id ?? "") === set.id) return;
  const installed = (await listStoredCopies().catch(() => [])).some((c) => profileOf(c).id === set.id);
  store.set(openDialogAtom, "mapDataSet", { ...set, installed });
}

/**
 * The races a map's member declares for its data set, kept for that set only when it is the
 * set in use and nothing was declared for it here (declared here, even as none, they
 * stand). A map is someone else's file: it names no races for a set that is not loaded, and
 * its member itself is kept and written back as it is either way.
 */
export function adoptMapRaces(store: Store, set: MapDataSet, current: AssetSource | null): void {
  if (!set.races?.length || current?.profile.id !== set.id || keptRaces(set.id) !== null) return;
  store.set(keepRacesAtom, { id: set.id, races: set.races });
}
