/**
 * The MPQ side of extraction: open StarDat.mpq / BrooDat.mpq (/ patch_rt.mpq) with mopaq
 * and answer `ReadMember` over them, later archives winning as they do in the game. Works
 * in Node and the browser alike; the Node scripts have their own copy of this in
 * `scripts/lib/archives.mjs` because they also find the files on disk.
 */
import { Archive } from "mopaq";
import type { ReadMember } from "./extract";

export interface OpenedArchive {
  name: string;
  archive: Archive;
}

/** The names the game ships, in the order it applies them. */
const KNOWN = /^(stardat|broodat|patch_rt)\.mpq$/i;
const order = (n: string) => (/^stardat/i.test(n) ? 0 : /^broodat/i.test(n) ? 1 : 2);

/** True for a file name the game's own archives carry. */
export function isGameArchive(name: string): boolean {
  return KNOWN.test(name.split(/[\\/]/).pop() ?? "");
}

/** StarDat first, BrooDat second, anything else after. */
export function sortArchives<T extends { name: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => order(a.name) - order(b.name) || a.name.localeCompare(b.name));
}

/**
 * The sizes of the StarDat.mpq and BrooDat.mpq in Blizzard's free StarEdit download (2019), which no installation's
 * archives have (1.16.1's are 63,511,342 and 24,499,671 bytes). The download holds the whole game — with its
 * `patch_rt.mpq` laid over, every file a 1.16.1 installation's — so nothing inside tells it apart; its sizes do,
 * it being one fixed package. A copy made from it says so in its stamp (`staredit`), and the site's play page
 * shows replays from such a copy but starts no game: the editor's download is for editing and watching, and
 * playing needs StarCraft installed (the user's rule, 2026-10-15).
 */
const STAREDIT_SIZES: Record<string, number> = { "stardat.mpq": 66_927_148, "broodat.mpq": 21_786_162 };

/** True when the archives are the StarEdit download's: both of its two, at their sizes. */
export function isStarEditDownload(archives: readonly { name: string; size: number }[]): boolean {
  const named = new Map(archives.map((a) => [(a.name.split(/[\\/]/).pop() ?? "").toLowerCase(), a.size]));
  return Object.entries(STAREDIT_SIZES).every(([name, size]) => named.get(name) === size);
}

/** Open each archive that opens; the ones that do not are reported, not thrown. */
export function openArchives(inputs: { name: string; bytes: Uint8Array }[]): { archives: OpenedArchive[]; problems: string[] } {
  const archives: OpenedArchive[] = [];
  const problems: string[] = [];
  for (const { name, bytes } of sortArchives(inputs)) {
    try {
      archives.push({ name, archive: Archive.open(bytes) });
    } catch (err) {
      problems.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { archives, problems };
}

/** A member path as the overlay keys it: lower case, backslashes, no leading separator. */
export const memberKey = (path: string) => path.replaceAll("/", "\\").replace(/^\\+/, "").toLowerCase();

/**
 * A `ReadMember` over the archives: the last one that has the member answers. `overlay`
 * is loose files by member path (`arr\units.dat`, in any case or slash), read before any
 * archive — how a mod that ships its data as a folder over the game's archives is layered,
 * the way its loader layers it.
 */
export function readerFor(archives: OpenedArchive[], overlay?: ReadonlyMap<string, Uint8Array>): ReadMember {
  return (member) => {
    if (overlay) {
      const hit = overlay.get(memberKey(member));
      if (hit) return hit;
    }
    for (let i = archives.length - 1; i >= 0; i--) {
      try {
        return archives[i].archive.readFile(member);
      } catch {
        // absent in this archive, which is normal and expected
      }
    }
    return null;
  };
}
