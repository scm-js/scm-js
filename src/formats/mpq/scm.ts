import { Archive, Creator, MpqError, type CompressionMethod, type HashEntry, type StoredMember } from "mopaq";
import { t } from "../../i18n";
import { entryNames, keepStoredForm, packStored, REMASTERED_ONLY_METHODS, storedFormOf, storedMethods } from "./stored";

/** Where StarCraft keeps the scenario inside the archive. */
export const SCENARIO_PATH = "staredit\\scenario.chk";

const MPQ_MAGIC = 0x1a51504d; // 'MPQ\x1a'

/** True when the buffer starts with an MPQ header (possibly at a 512-byte boundary). */
export function looksLikeMpq(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 4 <= bytes.length && at < 0x10000; at += 512) {
    if (view.getUint32(at, true) === MPQ_MAGIC) return true;
  }
  return false;
}

/** How the members of a map archive are compressed. */
export type ArchiveCompression = "none" | "zlib" | "pkware";

/** How the scenario was stored in the archive it came from — what Save offers to keep. */
export interface MemberInfo {
  /** `other` is a method this library can read but not write (bzip2, Huffman…). */
  compression: ArchiveCompression | "other";
  encrypted: boolean;
  /** Bytes the member occupies in the archive and bytes it decompresses to. */
  storedSize: number;
  size: number;
  sectorSize: number;
}

export interface LoadedMap {
  chk: Uint8Array;
  /** Absent when the file was a bare .chk. */
  archive: Archive | null;
  /** Files listed in the archive, when it carries a (listfile). */
  files: string[] | null;
  /** How scenario.chk was stored; null for a bare .chk. */
  scenarioInfo: MemberInfo | null;
}

/**
 * Read a .scm/.scx (or a bare .chk) into raw scenario bytes.
 *
 * The archive is kept so a later save can carry across the map's other files —
 * custom sounds and graphics live alongside scenario.chk and are easy to lose.
 */
export async function loadMap(bytes: Uint8Array): Promise<LoadedMap> {
  if (!looksLikeMpq(bytes)) {
    // Bare scenario.chk, which several tools hand around.
    return { chk: bytes, archive: null, files: null, scenarioInfo: null };
  }

  let archive: Archive;
  try {
    archive = await Archive.openAsync(bytes);
  } catch (err) {
    throw new MapLoadError(t("Not a readable MPQ archive: {reason}", { reason: describe(err) }), { cause: err });
  }

  let chk: Uint8Array;
  try {
    chk = await archive.readFileAsync(SCENARIO_PATH);
  } catch (err) {
    throw new MapLoadError(
      t("Archive has no readable {path} ({reason}). Protected maps often strip or corrupt it.", { path: SCENARIO_PATH, reason: describe(err) }),
      { cause: err },
    );
  }

  let files: string[] | null = null;
  try {
    files = await archive.filesAsync();
  } catch {
    files = null; // (listfile) is optional and frequently removed.
  }

  return { chk, archive, files, scenarioInfo: memberInfo(archive, SCENARIO_PATH) };
}

/** What the block table says about a member, in the editor's terms. */
export function memberInfo(archive: Archive, name: string): MemberInfo | null {
  const info = archive.fileInfo(name);
  if (!info) return null;
  const compression: MemberInfo["compression"] =
    !info.compressed || info.compression === "none" ? "none"
    : info.compression === "zlib" || info.compression === "pkware" ? info.compression
    : "other";
  return { compression, encrypted: info.encrypted, storedSize: info.compressedSize, size: info.uncompressedSize, sectorSize: archive.sectorSize };
}

/**
 * The members of the opened archive the editor could not read by name — carried across a
 * save exactly as stored, through mopaq's `addStored`, with the hash table they were found
 * in so the writer can lay the new one out over it (`readMembers`).
 */
export interface StoredMembers {
  hashTable: HashEntry[];
  /** The sector size those members were written for; the saved archive must use it. */
  sectorSize: number;
  members: StoredMember[];
  /** Named members among them, kept as stored because their bytes could not be decoded. */
  unreadable: string[];
}

export interface SaveOptions {
  /**
   * Extra archive members to carry across, name → bytes. Typically the non-scenario
   * files read out of the map that was opened.
   */
  extras?: Map<string, Uint8Array>;
  /**
   * Members only the editor reads (a built map's source). Always zlib and never encrypted,
   * whatever `compress` says: the game does not open them, so the method that keeps the
   * file small is the right one even in an archive written for an old build.
   */
  editorMembers?: Map<string, Uint8Array>;
  /**
   * Members carried as stored (`readMembers`). Forces `sectorSize` to theirs and lays the
   * hash table out over the one they came from.
   */
  stored?: StoredMembers | null;
  /**
   * How every member is compressed. `pkware` is what StarEdit writes and the one method
   * every StarCraft build reads; `zlib` is smaller but only Remastered reads it (1.16.1's
   * Storm decodes PKWARE, Huffman and ADPCM alone); `none` (the default) is readable by
   * anything that opens an MPQ at all.
   */
  compress?: ArchiveCompression;
  /** Encrypt the members as StarEdit does — a Storm feature every build reads. Default off. */
  encrypt?: boolean;
  /** Sector size; StarEdit's 4096 by default. */
  sectorSize?: number;
  /** Write a (listfile) naming the members (default on). The game never reads it. */
  listfile?: boolean;
  /**
   * The names the scenario refers to (its sounds, a script's files). When the hash table the
   * stored members pin has no room for the files written here, a stored member one of these
   * names reaches is kept and the rest are left out (`fitStored`).
   */
  referenced?: Iterable<string>;
  /**
   * Carry a member whose bytes were read from a form the writer cannot make (`keepStoredForm`: StarEdit's ADPCM
   * sounds) as it was stored, while the bytes are unchanged (default on). Off writes every member afresh.
   */
  carryStored?: boolean;
}

/** The sector size Blizzard's own maps carry. */
export const STAREDIT_SECTOR_SIZE = 4096;

/**
 * Wrap scenario bytes back into a .scx/.scm archive.
 *
 * Uncompressed by default — pre-1.16 StarCraft builds only understand a subset of MPQ
 * compressions, and an uncompressed map opens everywhere. `compress: "pkware"` is the
 * other universally readable choice, because it is what the game's own maps use.
 */
export async function saveMap(chk: Uint8Array, options: SaveOptions = {}): Promise<Uint8Array> {
  const method: CompressionMethod | false = options.compress === "zlib" || options.compress === "pkware" ? options.compress : false;
  const encrypt = options.encrypt ?? false;
  const extras = [...(options.extras ?? [])].filter(([name]) => normalize(name) !== normalize(SCENARIO_PATH));
  const fit = fitStored(options.stored ?? null, 1 + extras.length + (options.editorMembers?.size ?? 0), options.listfile ?? true, options.referenced);
  if (!fit) throw new Error(t("The archive has no room for the files this save writes: its hash table is filled by members the editor could not read."));
  const members = fit.members;
  const stored = options.stored && members.length > 0 ? options.stored : null;
  // A member read from a form the writer cannot make (StarEdit's ADPCM sounds) and handed back unchanged goes in as it
  // was stored, as long as it fits the archive being written: the same sector size, a slot in the same hash table.
  let hashTable: readonly HashEntry[] | null = stored?.hashTable ?? null;
  let sectorSize = stored ? stored.sectorSize : options.sectorSize ?? STAREDIT_SECTOR_SIZE;
  const carried: { member: StoredMember; name: string }[] = [];
  const carriedNames = new Set<string>();
  if (options.carryStored !== false) {
    for (const [name, data] of extras) {
      const form = storedFormOf(data);
      if (!form || normalize(form.name) !== normalize(name)) continue;
      // A member with zlib or bzip2 sectors goes only into an archive for Remastered, which reads them.
      if (method !== "zlib" && form.methods & REMASTERED_ONLY_METHODS) continue;
      // Laid over the source's hash table, the archive keeps its size: one too small for every file is not taken.
      if (!hashTable && form.hashTable.length > extras.length + (options.editorMembers?.size ?? 0) + 2) { hashTable = form.hashTable; sectorSize = form.member.sectorSize; }
      if (form.hashTable !== hashTable || form.member.sectorSize !== sectorSize) continue;
      carried.push({ member: form.member, name: form.name });
      carriedNames.add(name);
    }
  }
  const listfile = fit.listfile;
  const creator = new Creator({
    sectorSize,
    // With members carried, the list is written here: the writer's own names only the files it encodes.
    listfile: listfile && carried.length === 0,
    listfileCompress: method || "zlib",
    ...(hashTable ? { hashTable } : {}),
  });
  if (listfile && carried.length) {
    const names = [SCENARIO_PATH, ...extras.map(([name]) => name), ...[...(options.editorMembers ?? [])].map(([name]) => name)];
    creator.addFile("(listfile)", new TextEncoder().encode(names.join("\r\n")), { compress: method || "zlib", encrypt: true, adjustKey: true });
  }
  for (const m of members) creator.addStored(m);
  // Moved up to the archive's start round the members with no name, so they do not pin the archive's old length.
  for (const m of packStored(carried, members)) creator.addStored(m);
  creator.addFile(SCENARIO_PATH, chk, { compress: method, encrypt });
  for (const [name, data] of extras) {
    if (carriedNames.has(name)) continue;
    // StarEdit's own extras are encrypted with the offset-adjusted key; any reader takes both.
    creator.addFile(name, data, { compress: method, encrypt, adjustKey: encrypt });
  }
  for (const [name, data] of options.editorMembers ?? []) creator.addFile(name, data, { compress: "zlib", encrypt: false });
  return creator.writeAsync();
}

/** What a save carries of the stored members (`fitStored`). */
export interface StoredFit {
  /** The members carried as stored, pinned to their hash slots. */
  members: StoredMember[];
  /** Members left out: nothing names them and the hash table had no room with them in it. */
  dropped: number;
  /** Whether a `(listfile)` is written: false when one was asked for and the table has no room for it. */
  listfile: boolean;
}

/**
 * Which stored members a save carries. They are laid over the hash table they came from, which
 * keeps its size, and every file the save writes by name (`files`: the scenario, the extras,
 * the editor's members; the `(listfile)` on top) needs a free slot in it. A protector sizes
 * the table to its files and fills it with members nothing names, so on such a map there may
 * be none. The game opens a member only by a name the scenario carries, and every such name
 * was tried when the map was opened (and is tried again here, with `referenced`), so the
 * members no name reaches are never opened: when they do not fit, they are left out, and with
 * none left the archive is written afresh with a table of its own size. A member read by name
 * whose bytes could not be decoded (`unreadable`) is always kept. Last, the `(listfile)` is
 * dropped — the game never reads it. Null when even that leaves no room.
 */
export function fitStored(stored: StoredMembers | null, files: number, listfile: boolean, referenced: Iterable<string> = []): StoredFit | null {
  const all = stored?.members.filter(hasBytes) ?? [];
  if (!stored || all.length === 0) return { members: [], dropped: 0, listfile };
  const room = (kept: number) => stored.hashTable.length - kept;
  if (room(all.length) >= files + (listfile ? 1 : 0)) return { members: all, dropped: 0, listfile };
  const reached = reachedStored(stored, referenced);
  if (reached.length === 0 || room(reached.length) >= files + (listfile ? 1 : 0)) return { members: reached, dropped: all.length - reached.length, listfile };
  if (room(reached.length) >= files) return { members: reached, dropped: all.length - reached.length, listfile: false };
  return null;
}

/** The stored members a name reaches: one the scenario refers to (`referenced`), or one read by name but not decoded. */
function reachedStored(stored: StoredMembers, referenced: Iterable<string>): StoredMember[] {
  const named = [...stored.unreadable, ...referenced];
  return stored.members.filter((m) => hasBytes(m) && named.some((name) => entryNames(m.hash, name)));
}

/** The stored members no name the scenario refers to reaches (`fitStored`): how many, and their bytes. */
export function unreachableStored(stored: StoredMembers | null, referenced: Iterable<string> = []): { count: number; size: number } {
  if (!stored) return { count: 0, size: 0 };
  const reached = new Set(reachedStored(stored, referenced));
  const lost = stored.members.filter((m) => hasBytes(m) && !reached.has(m));
  return { count: lost.length, size: lost.reduce((n, m) => n + m.data.length, 0) };
}

/** The stored members without the ones no name reaches; null when none is left. */
export function withoutUnreachable(stored: StoredMembers, referenced: Iterable<string> = []): StoredMembers | null {
  const members = reachedStored(stored, referenced);
  return members.length === 0 ? null : { ...stored, members };
}

/**
 * Whether a stored member has bytes to carry. A protector's block entry pointing past the
 * end of the file came back from mopaq before 1.6.2 as an empty member at that offset, and
 * the writer padded the archive out to reach it — a save of tens of megabytes of zeros, or a
 * RangeError allocating 4 GB. Checked on save as well as open, since a recovery copy keeps
 * the members it was made with. A genuinely empty member is lost with them: it holds nothing.
 */
function hasBytes(m: StoredMember): boolean {
  return m.data.length > 0;
}

/** The sector size a save with these stored members has to use, else the caller's choice. */
export function requiredSectorSize(stored: StoredMembers | null | undefined, wanted: number): number {
  return stored && stored.members.some(hasBytes) ? stored.sectorSize : wanted;
}

export interface ArchiveMembers {
  /** Members read by name: the (listfile)'s and the ones the scenario refers to. */
  extras: Map<string, Uint8Array>;
  /** Everything else the archive holds, carried as stored; null when there is nothing. */
  stored: StoredMembers | null;
}

/**
 * Pull every member except scenario.chk out of an opened archive, by name where a name is
 * known and as stored bytes where none is.
 *
 * Names come from the (listfile) and from `hints` — the paths the scenario itself refers
 * to (its WAV table, the plugin members), probed with `fileInfo` — so a map whose listfile
 * a protector removed still gets its sounds read, listed and editable. A member with no
 * name, or one whose bytes cannot be decoded (a compression this build has no decoder for,
 * a corrupt sector), is kept as stored and written back where it was, which is the only
 * way to carry a member whose key depends on a name nobody has; `problems` gets a line
 * for the unreadable ones. Nothing the archive holds is dropped.
 */
export async function readMembers(archive: Archive, files: string[] | null, hints: Iterable<string> = [], problems?: string[], more?: (extras: ReadonlyMap<string, Uint8Array>) => Iterable<string>): Promise<ArchiveMembers> {
  const extras = new Map<string, Uint8Array>();
  const taken = new Set<number>();
  const unreadable: string[] = [];
  const scenarioSlot = archive.slotOf(SCENARIO_PATH);
  if (scenarioSlot !== null) taken.add(scenarioSlot);
  const listSlot = archive.slotOf("(listfile)");
  if (listSlot !== null) taken.add(listSlot);

  const seen = new Set<string>();
  const names = [...(files ?? []), ...hints].filter((name) => {
    const key = normalize(name);
    if (seen.has(key) || key === normalize(SCENARIO_PATH) || key === "(listfile)") return false;
    seen.add(key);
    return true;
  });
  const keepStored = new Set<number>();
  const all = archive.members();
  const hashTable = archive.hashEntries();
  const read = async (list: string[]) => {
    for (const name of list) {
      const slot = archive.slotOf(name);
      if (slot === null || taken.has(slot)) continue; // a listed name the archive lacks, or one already read under another spelling
      taken.add(slot);
      try {
        const bytes = await archive.readFileAsync(name);
        extras.set(name, bytes);
        // A sound StarEdit stored with ADPCM: remembered, so a save that does not change it can keep it as it was.
        const member = all.find((m) => m.slot === slot);
        const methods = member && hasBytes(member) ? storedMethods(member, name) : null;
        if (member && methods !== null && (methods & ~(0x02 | 0x08)) !== 0) keepStoredForm(bytes, { name, member, methods, hashTable });
      } catch (err) {
        unreadable.push(name);
        keepStored.add(slot);
        problems?.push(t("Archive member {name} could not be read ({reason}); it is kept in a saved copy as it is.", { name, reason: err instanceof Error ? err.message : String(err) }));
      }
    }
  };
  await read(names);
  // Names that only what was read can give (a manifest listing its files): one more pass.
  if (more) await read([...more(extras)].filter((name) => { const key = normalize(name); if (seen.has(key)) return false; seen.add(key); return true; }));

  const members = all.filter((m) => hasBytes(m) && (!taken.has(m.slot) || keepStored.has(m.slot)));
  const stored: StoredMembers | null = members.length === 0 ? null : { hashTable, sectorSize: archive.sectorSize, members, unreadable };
  return { extras, stored };
}

/** The members read by name alone — `readMembers(...).extras`. */
export async function readExtras(archive: Archive, files: string[] | null, problems?: string[], hints: Iterable<string> = []): Promise<Map<string, Uint8Array>> {
  return (await readMembers(archive, files, hints, problems)).extras;
}

function normalize(name: string) {
  return name.replace(/\//g, "\\").toLowerCase();
}

function describe(err: unknown) {
  if (err instanceof MpqError) return `${err.kind}${err.detail ? `: ${err.detail}` : ""}`;
  return err instanceof Error ? err.message : String(err);
}

export class MapLoadError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MapLoadError";
  }
}
