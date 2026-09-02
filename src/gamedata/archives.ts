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

/** A `ReadMember` over the archives: the last one that has the member answers. */
export function readerFor(archives: OpenedArchive[]): ReadMember {
  return (member) => {
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
