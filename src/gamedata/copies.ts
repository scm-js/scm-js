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

/**
 * A copy of somebody's 1.16 files that the play page plays from without the game's own keys for
 * control groups and F2–F4: it has the play set but not the folder's `Local.dll` (`play.ts#PLAY_LANGUAGE`)
 * — made before the copy kept it, or from the archives without their folder. Never a Remastered
 * copy (that game has no such file), the download, or a copy without the play set.
 */
export function lacksLanguageModule(copy: Pick<StoredStamp, "from" | "profile" | "staredit" | "play">): boolean {
  return copyKind(copy) === "classic" && copy.play !== undefined && !copy.play.language;
}

/** Whether any of the copies came from the person's own game rather than the free download. */
export function ownGame(copies: readonly Pick<StoredStamp, "from" | "profile" | "staredit">[]): boolean {
  return copies.some((c) => { const k = copyKind(c); return k === "classic" || k === "remastered"; });
}
