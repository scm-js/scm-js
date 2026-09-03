import { Archive, Creator, MpqError, type CompressionMethod } from "mopaq";

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

export interface SaveOptions {
  /**
   * Extra archive members to carry across, name → bytes. Typically the non-scenario
   * files read out of the map that was opened.
   */
  extras?: Map<string, Uint8Array>;
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
  const creator = new Creator({
    sectorSize: options.sectorSize ?? STAREDIT_SECTOR_SIZE,
    listfile: options.listfile ?? true,
    listfileCompress: method || "zlib",
  });
  creator.addFile(SCENARIO_PATH, chk, { compress: method, encrypt });
  for (const [name, data] of options.extras ?? []) {
    if (normalize(name) === normalize(SCENARIO_PATH)) continue;
    // StarEdit's own extras are encrypted with the offset-adjusted key; any reader takes both.
    creator.addFile(name, data, { compress: method, encrypt, adjustKey: encrypt });
  }
  return creator.writeAsync();
}

/**
 * Pull every listed member except scenario.chk out of an opened archive. A member that
 * cannot be read (a compression this build has no decoder for, a corrupt sector) is
 * skipped rather than fatal — and named in `problems`, since Save writes the archive from
 * what was read and the member would be gone from the file.
 */
export async function readExtras(archive: Archive, files: string[] | null, problems?: string[]): Promise<Map<string, Uint8Array>> {
  const extras = new Map<string, Uint8Array>();
  if (!files) return extras;
  for (const name of files) {
    const key = normalize(name);
    if (key === normalize(SCENARIO_PATH) || key === "(listfile)") continue;
    try {
      extras.set(name, await archive.readFileAsync(name));
    } catch (err) {
      problems?.push(`Archive member ${name} could not be read (${err instanceof Error ? err.message : String(err)}); it will not be in a saved copy.`);
    }
  }
  return extras;
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
