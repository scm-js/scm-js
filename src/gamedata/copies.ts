/**
 * What kind of thing a stored copy is, for the places that list them (the Game Data page,
 * and the site's own indicator, which reads the same stamps without this code — keep
 * `site/header.js` in step). The stamp's `from` is what tells them apart: the Blizzard
 * download records its address, a copy from archives their names, a Remastered one the
 * game's name and build — and `staredit`, the download's archives picked by hand.
 */
import { isDefaultProfile, isRemasteredOrigin, REMASTERED_PROFILE } from "./profiles";
import { profileOf, type StoredStamp } from "./store";

/**
 * - `download`: Blizzard's free StarEdit package, which is enough to edit with and to watch replays from;
 * - `classic`: the archives of somebody's own 1.16 installation;
 * - `remastered`: somebody's own StarCraft: Remastered installation;
 * - `mod`: a data set installed beside the game's.
 */
export type CopyKind = "download" | "classic" | "remastered" | "mod";

export function copyKind(copy: Pick<StoredStamp, "from" | "profile" | "staredit">): CopyKind {
  const profile = profileOf(copy as StoredStamp);
  if (isRemasteredOrigin(copy.from) || profile.id === REMASTERED_PROFILE.id) return "remastered";
  if (!isDefaultProfile(profile.id)) return "mod";
  return copy.staredit || /^https?:\/\//i.test(copy.from) ? "download" : "classic";
}

/** Whether any of the copies came from the person's own game rather than the free download. */
export function ownGame(copies: readonly Pick<StoredStamp, "from" | "profile" | "staredit">[]): boolean {
  return copies.some((c) => { const k = copyKind(c); return k === "classic" || k === "remastered"; });
}
