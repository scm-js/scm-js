import { Archive, Creator, MpqError } from "mopaq";

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

export interface LoadedMap {
  chk: Uint8Array;
  /** Absent when the file was a bare .chk. */
  archive: Archive | null;
  /** Files listed in the archive, when it carries a (listfile). */
  files: string[] | null;
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
    return { chk: bytes, archive: null, files: null };
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

  return { chk, archive, files };
}

export interface SaveOptions {
  /**
   * Extra archive members to carry across, name → bytes. Typically the non-scenario
   * files read out of the map that was opened.
   */
  extras?: Map<string, Uint8Array>;
}

/**
 * Wrap scenario bytes back into a .scx/.scm archive.
 *
 * scenario.chk goes in uncompressed on purpose: pre-1.16 StarCraft builds only
 * understand a subset of MPQ compressions, and an uncompressed map opens everywhere.
 */
export async function saveMap(chk: Uint8Array, options: SaveOptions = {}): Promise<Uint8Array> {
  const creator = new Creator();
  creator.addFile(SCENARIO_PATH, chk, { compress: false });
  for (const [name, data] of options.extras ?? []) {
    if (normalize(name) === normalize(SCENARIO_PATH)) continue;
    creator.addFile(name, data, { compress: false });
  }
  return creator.writeAsync();
}

/** Pull every listed member except scenario.chk out of an opened archive. */
export async function readExtras(archive: Archive, files: string[] | null): Promise<Map<string, Uint8Array>> {
  const extras = new Map<string, Uint8Array>();
  if (!files) return extras;
  for (const name of files) {
    const key = normalize(name);
    if (key === normalize(SCENARIO_PATH) || key === "(listfile)") continue;
    try {
      extras.set(name, await archive.readFileAsync(name));
    } catch {
      // A member we cannot decompress is better skipped than fatal.
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
