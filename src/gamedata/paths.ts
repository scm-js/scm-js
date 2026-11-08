/**
 * A file's two names: the **member**, as the game's archives name it (`arr\units.dat`,
 * `rez\stat_txt.tbl`, `tileset\jungle\ofire.pcx`), and its **stored path**, where the
 * extraction keeps it in a copy and the loaders ask for it (`arr/units.dat`,
 * `tileset/stat_txt.tbl`, `tileset/jungle.ofire.pcx`). Most members are their own path in
 * lower case with forward slashes; the extraction renames a few (`extract.ts`): the
 * tilesets' remap tables and doodad table, the shared string table, Remastered's terrain
 * and effect files, and its sprites by image number. The play set (`play.ts`) keeps every
 * file of its own at the member's path.
 *
 * Pure and import-free, so the worker, Node (type stripping) and the main thread share it.
 */

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
/** `tileset\<name>\<file>` the extraction writes as `tileset/<name>.<file>` (`extract.ts` REMAPS + SUBFILES). */
const RENAMED_SUBFILES = ["ofire.pcx", "gfire.pcx", "bfire.pcx", "bexpl.pcx", "dddata.bin"];

const RENAMED: Record<string, string> = {
  "rez\\stat_txt.tbl": "tileset/stat_txt.tbl",
  "hd2\\effect\\water_normal_1.dds.grp": "tileset/water_large.hd.grp",
  "hd2\\effect\\water_normal_2.dds.grp": "tileset/water_fine.hd.grp",
  "hd2\\effect\\noise.dds": "tileset/heat_noise.hd.dds",
};
const RENAMED_BACK: Record<string, string> = Object.fromEntries(Object.entries(RENAMED).map(([member, path]) => [path, member]));

/** The files the extraction writes that are no member of the game's: the two lists of what it wrote. */
const OWN_FILES = new Set(["tileset/manifest.json", "unit/manifest.json"]);

/** A member as the game's name for it: lower case, backslashes, no leading separator. */
const memberKey = (member: string) => member.trim().replaceAll("/", "\\").replace(/^\\+/, "").toLowerCase();

/** A stored path as the loaders ask for it: lower case, forward slashes, no leading separator. */
export const cleanStoredPath = (path: string) => path.trim().replaceAll("\\", "/").replace(/^\/+/, "").toLowerCase();

const pad3 = (n: string) => String(Number(n)).padStart(3, "0");

/**
 * Where the extraction stores a member in a copy — the inverse of the names `extract.ts`
 * writes: `tileset\jungle\ofire.pcx` is `tileset/jungle.ofire.pcx`, Remastered's
 * `HD2\anim\main_007.anim` is `unit/hd/main_007.anim`, and every other member is its own path
 * (the play set's `tileset\jungle\dark.pcx` too: it is kept where the game names it).
 */
export function storedPathOf(member: string): string {
  const k = memberKey(member);
  const renamed = RENAMED[k];
  if (renamed) return renamed;
  let m: RegExpMatchArray | null;
  if ((m = k.match(/^tileset\\([a-z]+)\\([^\\]+)$/)) && TILESETS.includes(m[1]) && RENAMED_SUBFILES.includes(m[2])) return `tileset/${m[1]}.${m[2]}`;
  if ((m = k.match(/^hd2\\tileset\\([a-z]+)\.dds\.vr4$/))) return `tileset/${m[1]}.hd.vr4`;
  if ((m = k.match(/^hd2\\tileset\\([a-z]+)\.tmsk$/))) return `tileset/${m[1]}.hd.tmsk`;
  if ((m = k.match(/^hd2\\tileset\\([a-z]+)_mask\.dds\.grp$/))) return `tileset/${m[1]}.hd.mask`;
  if ((m = k.match(/^hd2\\anim\\main_(\d+)\.anim$/))) return `unit/hd/main_${pad3(m[1])}.anim`;
  return k.replaceAll("\\", "/");
}

/**
 * The member a stored path holds, as the game names it (lower case, backslashes): the
 * inverse of `storedPathOf`. Null for the files the extraction writes itself
 * (`unit/manifest.json`, `tileset/manifest.json`), which are no member of the game's.
 */
export function memberOfStored(path: string): string | null {
  const p = cleanStoredPath(path);
  if (!p || OWN_FILES.has(p)) return null;
  const renamed = RENAMED_BACK[p];
  if (renamed) return renamed;
  let m: RegExpMatchArray | null;
  if ((m = p.match(/^tileset\/([a-z]+)\.hd\.vr4$/))) return `hd2\\tileset\\${m[1]}.dds.vr4`;
  if ((m = p.match(/^tileset\/([a-z]+)\.hd\.tmsk$/))) return `hd2\\tileset\\${m[1]}.tmsk`;
  if ((m = p.match(/^tileset\/([a-z]+)\.hd\.mask$/))) return `hd2\\tileset\\${m[1]}_mask.dds.grp`;
  if ((m = p.match(/^tileset\/([a-z]+)\.(.+)$/)) && TILESETS.includes(m[1]) && RENAMED_SUBFILES.includes(m[2])) return `tileset\\${m[1]}\\${m[2]}`;
  if ((m = p.match(/^unit\/hd\/main_(\d+)\.anim$/))) return `hd2\\anim\\main_${pad3(m[1])}.anim`;
  return p.replaceAll("/", "\\");
}
