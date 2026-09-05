import { Archive, Creator, MpqError, type CompressionMethod, type HashEntry, type StoredMember } from "mopaq";

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
    throw new MapLoadError(`Not a readable MPQ archive: ${describe(err)}`, { cause: err });
  }

  let chk: Uint8Array;
  try {
    chk = await archive.readFileAsync(SCENARIO_PATH);
  } catch (err) {
    throw new MapLoadError(
      `Archive has no readable ${SCENARIO_PATH} (${describe(err)}). Protected maps often strip or corrupt it.`,
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
   * Members carried as stored (`readMembers`). Forces `sectorSize` to theirs and lays the
   * hash table out over the one they came from.
   */
  stored?: StoredMembers | null;
  /**
   * How every member is compressed. `pkware` is what StarEdit writes and the one method
   * every StarCraft build reads; `zlib` is smaller but needs 1.16.1 or Remastered; `none`
   * (the default) is readable by anything that opens an MPQ at all.
   */
  compress?: ArchiveCompression;
  /** Encrypt the members as StarEdit does — a Storm feature every build reads. Default off. */
  encrypt?: boolean;
  /** Sector size; StarEdit's 4096 by default. */
  sectorSize?: number;
  /** Write a (listfile) naming the members (default on). The game never reads it. */
  listfile?: boolean;
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
  const stored = options.stored && options.stored.members.length > 0 ? options.stored : null;
  const creator = new Creator({
    sectorSize: stored ? stored.sectorSize : options.sectorSize ?? STAREDIT_SECTOR_SIZE,
    listfile: options.listfile ?? true,
    listfileCompress: method || "zlib",
    ...(stored ? { hashTable: stored.hashTable } : {}),
  });
  for (const m of stored?.members ?? []) creator.addStored(m);
  creator.addFile(SCENARIO_PATH, chk, { compress: method, encrypt });
  for (const [name, data] of options.extras ?? []) {
    if (normalize(name) === normalize(SCENARIO_PATH)) continue;
    // StarEdit's own extras are encrypted with the offset-adjusted key; any reader takes both.
    creator.addFile(name, data, { compress: method, encrypt, adjustKey: encrypt });
  }
  return creator.writeAsync();
}

/** The sector size a save with these stored members has to use, else the caller's choice. */
export function requiredSectorSize(stored: StoredMembers | null | undefined, wanted: number): number {
  return stored && stored.members.length > 0 ? stored.sectorSize : wanted;
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
export async function readMembers(archive: Archive, files: string[] | null, hints: Iterable<string> = [], problems?: string[]): Promise<ArchiveMembers> {
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
  for (const name of names) {
    const slot = archive.slotOf(name);
    if (slot === null || taken.has(slot)) continue; // a listed name the archive lacks, or one already read under another spelling
    taken.add(slot);
    try {
      extras.set(name, await archive.readFileAsync(name));
    } catch (err) {
      unreadable.push(name);
      keepStored.add(slot);
      problems?.push(`Archive member ${name} could not be read (${err instanceof Error ? err.message : String(err)}); it is kept in a saved copy as it is.`);
    }
  }

  const members = archive.members().filter((m) => !taken.has(m.slot) || keepStored.has(m.slot));
  const stored: StoredMembers | null = members.length === 0 ? null : { hashTable: archive.hashEntries(), sectorSize: archive.sectorSize, members, unreadable };
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
