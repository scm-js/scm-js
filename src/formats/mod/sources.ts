/**
 * What a mod comes in, opened without running anything: the game's paths inside a folder (at its root or a folder
 * down), an MPQ, a self-executing exe with an MPQ appended, or a zip of any of these. Pure (no DOM, no Node): the
 * command line and any page share it.
 *
 * - **A zip**: its central directory read, the "stored" and "deflate" members inflated with the platform's own
 *   `DecompressionStream("deflate-raw")`. No zip64 and no encryption; such a zip is refused in words.
 * - **MPQDraft's self-executing MPQ** (SEMPQ): a small Windows program with the archive appended at a 512-byte boundary
 *   after the program, where storm looks for one.
 * - **FireGraft's patcher** ("FG Patcher"): the program, then an overlay whose offset the program keeps in its own
 *   header (the u32 at 0x18): `"PEGF"`, u32 count, u32 1, then for each plugin u32 id, u32 size, u32 0 and that many
 *   bytes of the plugin, one after the other; then the archive at a 512-byte boundary after the last plugin, where
 *   storm finds it — its tables may lie before its header. The plugins are found and named, never run.
 *
 * Nothing of an exe is run.
 */

/** The game's own top folders: a mod's files sit under these. */
export const GAME_FOLDERS = ["arr", "rez", "scripts", "unit", "tileset", "sound", "game", "font", "dlgs", "glue", "triggers", "portrait", "music", "cursor", "local", "parallax", "smk", "maps", "anim", "hd2", "sd", "templates", "staredit", "campaign", "datreq", "samase", "lua", "config"];

/** A path as the game names it: backslashes, lower case (`arr\units.dat`). Two paths are one file when these agree. */
export const gameName = (path: string): string => path.replace(/\//g, "\\").replace(/^\\+/, "").toLowerCase();

/**
 * Files an operating system or its file manager leaves in folders, and into the archives and zips made of them: never
 * the game's, so never a mod's. Told by name alone, any case — the last part of a path, or a folder on the way to it:
 *
 * - `desktop.ini`: Windows Explorer's settings for a folder (its view, its icon);
 * - `Thumbs.db`, `ehthumbs.db`, `ehthumbs_vista.db`: Explorer's and Media Center's caches of thumbnails;
 * - `.DS_Store`: the macOS Finder's settings for a folder; `Icon\r`: a folder's own icon there;
 * - `._<name>`: the AppleDouble half of a file, which macOS writes beside it on a disk that is not its own and into
 *   every zip it makes; `__MACOSX/`: the folder those zips keep them in;
 * - `.directory`: KDE's settings for a folder.
 *
 * A mod's hash has no line for one (`hash.ts`), and what reads a mod leaves them out of its files. Why it matters:
 * the same folder is not handed over alike by every route. A browser's folder handle (the folder picker, a dropped
 * folder read through its handle) never hands over `desktop.ini` or `Thumbs.db`: Chromium's
 * `FileSystemAccessManagerImpl::IsSafePathComponent` refuses the names `base::IsReservedNameOnWindows` lists, on every
 * system. A drop read through its entries, an `<input webkitdirectory>` and the command line hand them over. With
 * these files in the hash a mod was named by how its folder had been read.
 *
 * Only names that are certain never to be a game file are here. A handle hides more than these (`.lnk`, `.url` and
 * `.scf` files, Windows' device names such as `aux.wav`, names that begin or end with a space, a dot or `~`, and on
 * Windows, by Chromium's table of file types, every `.ini`, `.cfg`, `.dll` and `.manifest`): those may be a mod's own
 * files, so they keep their lines, and a route that cannot read one has a mod short of that file and says so with
 * another hash.
 */
export const SYSTEM_FILES = {
  /** File names, lower case. */
  names: ["desktop.ini", "thumbs.db", "ehthumbs.db", "ehthumbs_vista.db", ".ds_store", "icon\r", ".directory"],
  /** What a file name starts with. */
  prefixes: ["._"],
  /** Folder names, lower case: everything under one. */
  folders: ["__macosx"],
} as const;

/** Whether a path (either slash, any case) is one of `SYSTEM_FILES`: by its file name, or by a folder it is under. */
export function isSystemFile(path: string): boolean {
  const parts = path.toLowerCase().split(/[\\/]/).filter(Boolean);
  const leaf = parts.pop() ?? "";
  return (SYSTEM_FILES.names as readonly string[]).includes(leaf)
    || SYSTEM_FILES.prefixes.some((p) => leaf.startsWith(p))
    || parts.some((folder) => (SYSTEM_FILES.folders as readonly string[]).includes(folder));
}

/** The game's own archives, by file name (lower case): what a 1.16.1 installation holds beside its program. */
export const GAME_ARCHIVES = ["stardat.mpq", "broodat.mpq", "patch_rt.mpq", "starcraft.mpq", "broodwar.mpq"] as const;

/**
 * The files among `paths` (forward slashes) that are a copy of the game's own and so no part of a mod: in every folder
 * that holds a `StarDat.mpq`, that folder's `GAME_ARCHIVES` and every file under its `Maps` folder.
 *
 * A copy of the game in what was handed over is not the mod. A person hands over a folder that holds the mod's release
 * and, beside it, the whole game the mod runs on (Cosmonarchy's download: `Release/` and `Starcraft/`); laid as layers
 * of the mod, the game's archives became "the mod's" files, and in Windows' folder order `StarDat.mpq` came last and
 * carried original StarCraft's tables and iscript over Brood War's. A copy's `Maps` folder is the person's maps folder:
nothing under it is a mod's (Cosmonarchy's copy keeps campaigns at `Maps/CMBW-Root/CMBW-maps/campaign/…`, and
`campaign` is one of the game's folders, so they were taken for a mod's root). Apply it to each list a walk is given (a folder's
 * files, a zip's members), never to a single file the person names: some old mods ship as a replaced `patch_rt.mpq`.
 * The same rule is in the play page and the Mod Editor plugin: change them together.
 */
export function gameCopyFiles(paths: readonly string[]): Set<string> {
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
  const leaf = (p: string) => p.slice(p.lastIndexOf("/") + 1).toLowerCase();
  const copies = new Set(paths.filter((p) => leaf(p) === "stardat.mpq").map((p) => dir(p).toLowerCase()));
  const out = new Set<string>();
  if (!copies.size) return out;
  for (const p of paths) {
    if (copies.has(dir(p).toLowerCase()) && (GAME_ARCHIVES as readonly string[]).includes(leaf(p))) { out.add(p); continue; }
    for (const c of copies) if (p.toLowerCase().startsWith(c ? `${c}/maps/` : "maps/")) { out.add(p); break; }
  }
  return out;
}

/**
 * The folder of a set of paths the game's paths start in: the one that holds `arr/`, else the one holding the most
 * files under the game's folders, the shallower on a tie; "" is the root. Paths use forward slashes. At any depth, as
 * the play page looks (a zip's `Mod 1.2/mpq/arr/…`); a game folder's name deeper in a root (`unit/terran/unit/`)
 * scores fewer files than the root itself, so it does not win.
 */
export function modRoot(paths: readonly string[]): string {
  const score = new Map<string, number>(), hasArr = new Set<string>();
  for (const p of paths) {
    const parts = p.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const folder = parts[i].toLowerCase();
      if (!GAME_FOLDERS.includes(folder) || folder === "maps") continue;
      const root = parts.slice(0, i).join("/");
      score.set(root, (score.get(root) ?? 0) + 1);
      if (folder === "arr") hasArr.add(root);
    }
  }
  const best = (list: string[]) => list.sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0) || a.split("/").length - b.split("/").length)[0];
  return best([...hasArr]) ?? best([...score.keys()]) ?? "";
}

/** Why what was handed over cannot be read as a mod, in words. */
export class ModSourceError extends Error {}

const MPQ_MAGIC = 0x1a51504d; // "MPQ\x1A"
const MPQ_USER = 0x1b51504d; // "MPQ\x1B", a user-data header that says where the archive is
const PEGF = 0x46474550; // "PEGF", FireGraft's patcher overlay
/** Where FireGraft's patcher keeps its overlay's offset: the u32 at 0x18 of its own header, which its program reads. */
const OVERLAY_AT = 0x18;
/** The overlay's second word in every patcher seen (five, two builds of the program): its form. */
const OVERLAY_FORM = 1;

const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);

/**
 * Whether an archive header storm would read starts at `at`. A version 0 header's own size is not believed (patchers
 * write 0xFFFFFFFF there), so it is told by its tables: their positions, the header's plus theirs modulo 2^32, must
 * fall inside the file. A later version's size and format are the known ones.
 */
function mpqHeaderAt(b: Uint8Array, at: number): boolean {
  if (at < 0 || at + 32 > b.length) return false;
  const v = view(b);
  if (v.getUint32(at, true) !== MPQ_MAGIC) return false;
  const size = v.getUint32(at + 4, true), version = v.getUint16(at + 12, true);
  if (version === 0) return (at + v.getUint32(at + 16, true)) % 0x100000000 < b.length && (at + v.getUint32(at + 20, true)) % 0x100000000 < b.length;
  return size >= 32 && size <= 0xd0 && version <= 3;
}

function findMpq(b: Uint8Array, from: number): number {
  for (let at = Math.max(0, from); at + 32 <= b.length; at++) if (b[at] === 0x4d && b[at + 1] === 0x50 && b[at + 2] === 0x51 && b[at + 3] === 0x1a && mpqHeaderAt(b, at)) return at;
  return -1;
}

/** Where a Windows program's own bytes end (after its last section), or null when the bytes are no program. */
export function programEnd(b: Uint8Array): number | null {
  if (b.length < 64 || b[0] !== 0x4d || b[1] !== 0x5a) return null;
  const v = view(b), pe = v.getUint32(0x3c, true);
  if (pe + 24 > b.length || v.getUint32(pe, true) !== 0x00004550) return null;
  const sections = v.getUint16(pe + 6, true), optional = v.getUint16(pe + 20, true), table = pe + 24 + optional;
  let end = table + sections * 40;
  for (let i = 0; i < sections; i++) {
    const s = table + i * 40;
    if (s + 40 > b.length) return null;
    const raw = v.getUint32(s + 16, true), at = v.getUint32(s + 20, true);
    if (raw && at + raw > end) end = at + raw;
  }
  return Math.min(end, b.length);
}

/**
 * The name a Windows library gives itself in its export directory (`GPTP.qdp`), or null when it has none or the bytes
 * are no library. An MPQDraft plugin exports `GetMPQDraftPlugin`, so it has one.
 */
export function libraryName(b: Uint8Array): string | null {
  try {
    if (b.length < 64 || b[0] !== 0x4d || b[1] !== 0x5a) return null;
    const v = view(b), pe = v.getUint32(0x3c, true);
    if (pe + 24 > b.length || v.getUint32(pe, true) !== 0x00004550) return null;
    const optional = pe + 24, wide = v.getUint16(optional, true) === 0x20b;
    if (v.getUint32(optional + (wide ? 108 : 92), true) < 1) return null;
    const exports = v.getUint32(optional + (wide ? 112 : 96), true);
    if (!exports) return null;
    const sections = v.getUint16(pe + 6, true), table = optional + v.getUint16(pe + 20, true);
    const offset = (rva: number): number | null => {
      for (let i = 0; i < sections; i++) {
        const s = table + i * 40, va = v.getUint32(s + 12, true), raw = v.getUint32(s + 16, true), at = v.getUint32(s + 20, true);
        if (rva >= va && rva < va + raw) return at + rva - va;
      }
      return null;
    };
    const dir = offset(exports);
    const name = dir === null || dir + 16 > b.length ? null : offset(v.getUint32(dir + 12, true));
    if (name === null) return null;
    let end = name;
    while (end < b.length && end - name < 260 && b[end] !== 0) end++;
    const text = String.fromCharCode(...b.subarray(name, end));
    return /^[\x20-\x7e]+$/.test(text) ? text : null;
  } catch { return null; }
}

/** A plugin a FireGraft patcher's overlay carries, as the patcher loads it. */
export interface PatcherPlugin {
  /** The id the overlay gives it: the plugin's own MPQDraft id (GPTP's is 0x1B4D69B6; some are four letters, `EUDE`). */
  id: number;
  /** Where its bytes start in the exe, and how many. */
  at: number;
  size: number;
  /** The name its export directory gives (`GPTP.qdp`), or null. */
  name: string | null;
  /** Its bytes (a view into the exe's). */
  bytes: Uint8Array;
}

export interface ExeArchive {
  /**
   * The whole exe. Its archive is opened as `Archive.open(bytes, { offset: at })`: the archive's tables may lie before
   * its header (positions are the header's plus theirs modulo 2^32), which a slice from the header on cannot reach.
   */
  bytes: Uint8Array;
  /** Where in the exe the archive's header is. */
  at: number;
  kind: "sempq" | "firegraft";
  /** The plugins FireGraft's patcher carries, in the order it loads them (none for a SEMPQ). Never run. */
  plugins: PatcherPlugin[];
}

/** A patcher's overlay in a form not read here, or one that does not hold together. `what` says how, in a few words. */
export class PatcherError extends ModSourceError {
  readonly what: string;
  constructor(what: string) { super(`Its patcher overlay is in a form not read here: ${what}.`); this.what = what; }
}

/** FireGraft's patcher overlay: its plugins and where they end. Null when the exe has none. Throws `PatcherError`. */
function patcherOverlay(b: Uint8Array, end: number): { plugins: PatcherPlugin[]; after: number } | null {
  const v = view(b);
  // Where the program reads it: its header's word at 0x18. Else at the program's end or a little after (some linkers pad).
  let at = -1;
  const said = v.getUint32(OVERLAY_AT, true);
  if (said >= end && said + 12 <= b.length && v.getUint32(said, true) === PEGF) at = said;
  else for (let p = end; p + 12 <= b.length && p < end + 4096; p++) if (v.getUint32(p, true) === PEGF) { at = p; break; }
  if (at < 0) return null;
  const count = v.getUint32(at + 4, true), form = v.getUint32(at + 8, true);
  if (form !== OVERLAY_FORM) throw new PatcherError(`form ${form} at byte ${at}, where only form ${OVERLAY_FORM} is known`);
  if (count > 256) throw new PatcherError(`${count} plugins said at byte ${at}, which is no number a patcher writes`);
  const plugins: PatcherPlugin[] = [];
  let p = at + 12;
  for (let i = 0; i < count; i++) {
    if (p + 12 > b.length) throw new PatcherError(`${count} plugins said, and the file ends after ${i}`);
    const id = v.getUint32(p, true), size = v.getUint32(p + 4, true), zero = v.getUint32(p + 8, true);
    const from = p + 12;
    if (zero !== 0) throw new PatcherError(`plugin ${i + 1}'s third word (at byte ${p + 8}) is ${zero}, where every patcher seen has 0`);
    if (from + size > b.length) throw new PatcherError(`plugin ${i + 1} is said to be ${size} bytes, and the file ends ${b.length - from} bytes after its start`);
    const bytes = b.subarray(from, from + size);
    if (size < 2 || bytes[0] !== 0x4d || bytes[1] !== 0x5a) throw new PatcherError(`plugin ${i + 1} (at byte ${from}) is no Windows library`);
    plugins.push({ id, at: from, size, name: libraryName(bytes), bytes });
    p = from + size;
  }
  return { plugins, after: p };
}

/**
 * The mod archive inside a self-executing exe, or null when the exe holds none (a program only). A FireGraft patcher's
 * overlay is read as its program reads it and its archive looked for after the plugins; a SEMPQ's archive at 512-byte
 * boundaries after the program, then anywhere after it. Throws `PatcherError` for a patcher overlay not read here, or
 * one with no archive after it.
 */
export function exeArchive(b: Uint8Array): ExeArchive | null {
  const end = programEnd(b);
  if (end === null) return null;
  const v = view(b);
  const overlay = patcherOverlay(b, end);
  if (overlay) {
    // (storm looks at 512-byte boundaries; the archive's tables may come first, between the plugins and its header)
    let mpq = -1;
    for (let at = Math.ceil(overlay.after / 512) * 512; at + 32 <= b.length; at += 512) if (mpqHeaderAt(b, at)) { mpq = at; break; }
    if (mpq < 0) mpq = findMpq(b, overlay.after);
    if (mpq < 0) throw new PatcherError(`no archive after its ${overlay.plugins.length === 1 ? "plugin" : `${overlay.plugins.length} plugins`}`);
    return { bytes: b, at: mpq, kind: "firegraft", plugins: overlay.plugins };
  }
  for (let at = Math.ceil(end / 512) * 512; at + 32 <= b.length; at += 512) {
    const word = v.getUint32(at, true);
    if (word === MPQ_USER && at + 12 <= b.length) {
      const real = at + v.getUint32(at + 8, true);
      if (mpqHeaderAt(b, real)) return { bytes: b, at: real, kind: "sempq", plugins: [] };
    }
    if (mpqHeaderAt(b, at)) return { bytes: b, at, kind: "sempq", plugins: [] };
  }
  const any = findMpq(b, end);
  return any < 0 ? null : { bytes: b, at: any, kind: "sempq", plugins: [] };
}

/** An MPQ from its first byte (a mod's `.mpq`). */
export const isMpq = (b: Uint8Array): boolean => b.length >= 32 && (view(b).getUint32(0, true) === MPQ_MAGIC || view(b).getUint32(0, true) === MPQ_USER);
/** A zip, by its first member's local header (or an empty zip's end record). */
export const isZip = (b: Uint8Array): boolean => b.length >= 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5);
/** A Windows program. */
export const isExe = (b: Uint8Array): boolean => programEnd(b) !== null;

export interface ZipMember {
  /** The member's path in the zip, forward slashes. */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

/** The files of a zip (folders left out), read lazily. */
export function readZip(b: Uint8Array): ZipMember[] {
  const v = view(b);
  let eocd = -1;
  for (let at = b.length - 22; at >= Math.max(0, b.length - 22 - 0xffff); at--) if (v.getUint32(at, true) === 0x06054b50) { eocd = at; break; }
  if (eocd < 0) throw new ModSourceError("The zip's directory is not at its end: it may be cut short.");
  const count = v.getUint16(eocd + 10, true), dirAt = v.getUint32(eocd + 16, true);
  if (count === 0xffff || dirAt === 0xffffffff) throw new ModSourceError("The zip is in the large-zip form (zip64), which is not read here: unzip it and name the folder.");
  const out: ZipMember[] = [];
  let at = dirAt;
  for (let i = 0; i < count; i++) {
    if (at + 46 > b.length || v.getUint32(at, true) !== 0x02014b50) throw new ModSourceError("The zip's directory is damaged.");
    const flags = v.getUint16(at + 8, true), method = v.getUint16(at + 10, true);
    const packed = v.getUint32(at + 20, true), size = v.getUint32(at + 24, true);
    const nameLength = v.getUint16(at + 28, true), extra = v.getUint16(at + 30, true), comment = v.getUint16(at + 32, true);
    const local = v.getUint32(at + 42, true);
    const raw = b.subarray(at + 46, at + 46 + nameLength);
    const path = ((flags & 0x800) ? new TextDecoder().decode(raw) : String.fromCharCode(...raw)).replace(/\\/g, "/");
    at += 46 + nameLength + extra + comment;
    if (path.endsWith("/")) continue;
    if (flags & 1) throw new ModSourceError(`${path} is encrypted in the zip; encrypted zips are not read.`);
    if (method !== 0 && method !== 8) throw new ModSourceError(`${path} is packed in a way not read here (method ${method}); only stored and deflated members are.`);
    out.push({
      path, size,
      read: async () => {
        if (local + 30 > b.length || v.getUint32(local, true) !== 0x04034b50) throw new ModSourceError(`${path}: its place in the zip is damaged.`);
        const from = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
        const data = b.subarray(from, from + packed);
        if (method === 0) return data.slice();
        const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        if (bytes.length !== size) throw new ModSourceError(`${path}: inflated to ${bytes.length} bytes, the zip says ${size}.`);
        return bytes;
      },
    });
  }
  return out;
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (bytes: Uint8Array) => hex(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>));

/**
 * The hash of game files alone, by the mod hash's rule (`hash.ts`): a line `name<TAB>sha256` a file (the game's name,
 * lower case with backslashes), sorted by name, joined with newlines, hashed again; the first sixteen hex digits. An
 * operating system's files (`isSystemFile`) have no line. A mod's hash also has lines for its plugins and FireGraft
 * project: `modHash` / `modHashOfDigests` in `hash.ts`; for a mod without either the two agree.
 */
export async function dataSetHash(files: readonly { name: string; bytes: Uint8Array }[]): Promise<string> {
  const digests: { name: string; sha256: string }[] = [];
  for (const f of files) digests.push({ name: f.name, sha256: await fileDigest(f.bytes) });
  return dataSetHashOfDigests(digests);
}

/** One file's SHA-256 in hex, as `dataSetHash` takes it: for a caller that hashes a file at a time and lets the bytes go. */
export const fileDigest = (bytes: Uint8Array): Promise<string> => sha256(bytes);

/** `dataSetHash` from each file's `fileDigest` rather than its bytes: the same rule, the same hash. */
export async function dataSetHashOfDigests(files: readonly { name: string; sha256: string }[]): Promise<string> {
  const lines = files.filter((f) => !isSystemFile(f.name)).map((f) => ({ name: gameName(f.name), sha256: f.sha256 })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)).map((f) => `${f.name}\t${f.sha256}`);
  return (await sha256(new TextEncoder().encode(lines.join("\n")))).slice(0, 16);
}
