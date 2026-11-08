/**
 * A map remembers the data set it was made with: an archive member `scmjs\dataset.json`
 * (`{ id, name, hash, url? }`, through the archive extras every plugin's members ride in)
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
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { openDialogAtom } from "../atoms/uiAtoms";
import { isDefaultProfile, isProfileId } from "../gamedata/profiles";
import { currentAssetSource, type AssetSource } from "../gamedata/source";
import { listStoredCopies, profileOf } from "../gamedata/store";

type Store = ReturnType<typeof getDefaultStore>;

/** The member's name in the map's archive. */
export const DATASET_MEMBER = "scmjs\\dataset.json";

/** What the member says. */
export interface MapDataSet {
  id: string;
  name: string;
  /** A digest of the data set's files (`overCopy.ts#filesHash`); empty when none was known. */
  hash: string;
  /** Where the data set's makers publish it, when the data set says. */
  url?: string;
}

/** The member a source would write, or null for the game's own data (nothing is written then). */
export function dataSetOf(source: AssetSource | null): MapDataSet | null {
  if (!source || source.kind === "none" || isDefaultProfile(source.profile.id)) return null;
  const hash = source.stored?.hash ?? source.reader?.hash ?? "";
  const url = source.profile.url ?? source.stored?.profile?.url;
  return { id: source.profile.id, name: source.profile.name, hash, ...(url ? { url } : {}) };
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
    return {
      id,
      name: typeof name === "string" && name.trim() ? name.trim() : id,
      hash: typeof hash === "string" ? hash : "",
      ...(typeof url === "string" && /^https?:\/\/\S+$/i.test(url.trim()) ? { url: url.trim() } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Before a save: put the data set in use into the map's extras when it is not the game's
 * own and the map does not already say exactly that. True when the extras changed (bytes
 * built before this are stale).
 */
export function stampDataSet(store: Store): boolean {
  const set = dataSetOf(store.get(gameDataSourceAtom) ?? currentAssetSource());
  if (!set) return false;
  const extras = store.get(archiveExtrasAtom);
  const was = readDataSet(extras);
  if (was && was.id === set.id && was.name === set.name && was.hash === set.hash && was.url === set.url) return false;
  const next = new Map(extras);
  for (const name of next.keys()) if (name.toLowerCase() === DATASET_MEMBER) next.delete(name);
  next.set(DATASET_MEMBER, encodeDataSet(set));
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
  if ((current?.profile.id ?? "") === set.id) return;
  const installed = (await listStoredCopies().catch(() => [])).some((c) => profileOf(c).id === set.id);
  store.set(openDialogAtom, "mapDataSet", { ...set, installed });
}
