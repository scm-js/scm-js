/**
 * What Save keeps of a file before writing over it (`Preferences.save.backup`). The desktop
 * app copies it to `<name>.bak` beside the file; a browser cannot make a
 * file beside another, so it keeps the bytes in the `previous` store of the editor's
 * IndexedDB database instead, the last `KEEP_PER_FILE` per file name, and File ▸ Previous
 * Versions… lists them. The desktop falls back to the browser's way when it cannot find
 * the file's path.
 *
 * Only ever the bytes that were on disk: nothing here reads the open map.
 */
import { desktopBridge } from "../gamedata/desktop";
import { isDiskHandle } from "./diskFiles";
import { handleStorePersists, idbRequest, PREVIOUS_STORE } from "./handleStore";

/** One kept version. */
export interface PreviousVersion {
  key: string;
  /** The file's name (not a path: a handle has none). */
  fileName: string;
  /** When the save that replaced it happened. */
  at: number;
  /** The file's own modification time, as the browser reported it. */
  modified: number;
  size: number;
  bytes: Uint8Array;
}

export type PreviousEntry = Omit<PreviousVersion, "bytes">;

/** What keeping the old file came to, for the Save notice. */
export type KeptPrevious =
  | { kind: "bak"; path: string }
  /** `bakFailed`: the desktop app tried a `.bak` first, and why it could not. */
  | { kind: "stored"; fileName: string; bakFailed?: string }
  | { kind: "failed"; message: string };

/** The versions kept of one file name; older ones go. */
export const KEEP_PER_FILE = 3;
/** Across every file: the oldest go first past either limit. */
export const KEEP_TOTAL = 30;
export const KEEP_TOTAL_BYTES = 256 * 1024 * 1024;

const memory = new Map<string, PreviousVersion>();

async function all(): Promise<PreviousVersion[]> {
  const out = [...memory.values()];
  if (!handleStorePersists()) return out;
  try {
    out.push(...(await idbRequest(PREVIOUS_STORE, "readonly", (s) => s.getAll())) as PreviousVersion[]);
  } catch {
    // Unreadable: what memory has.
  }
  return out;
}

async function put(v: PreviousVersion): Promise<void> {
  if (!handleStorePersists()) { memory.set(v.key, v); return; }
  await idbRequest(PREVIOUS_STORE, "readwrite", (s) => s.put(v, v.key));
}

/** Throw one version away. */
export async function removePrevious(key: string): Promise<void> {
  memory.delete(key);
  if (!handleStorePersists()) return;
  try {
    await idbRequest(PREVIOUS_STORE, "readwrite", (s) => s.delete(key));
  } catch {
    // It stays until the site data is cleared.
  }
}

/** Every kept version, newest first, without the bytes. */
export async function listPrevious(): Promise<PreviousEntry[]> {
  return (await all()).sort((a, b) => b.at - a.at).map(({ bytes: _bytes, ...entry }) => entry);
}

/** One version with its bytes, or null. */
export async function loadPrevious(key: string): Promise<PreviousVersion | null> {
  if (memory.has(key)) return memory.get(key)!;
  if (!handleStorePersists()) return null;
  try {
    return ((await idbRequest(PREVIOUS_STORE, "readonly", (s) => s.get(key))) as PreviousVersion | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * The versions past the limits: beyond `KEEP_PER_FILE` of a name, then the oldest until the
 * rest fit `KEEP_TOTAL` and `KEEP_TOTAL_BYTES`. Pure, for the tests.
 */
export function overLimits(versions: readonly PreviousEntry[]): string[] {
  const newest = [...versions].sort((a, b) => b.at - a.at);
  const perName = new Map<string, number>();
  const kept: PreviousEntry[] = [];
  const drop: string[] = [];
  for (const v of newest) {
    const n = (perName.get(v.fileName) ?? 0) + 1;
    perName.set(v.fileName, n);
    if (n > KEEP_PER_FILE) drop.push(v.key);
    else kept.push(v);
  }
  let bytes = 0;
  kept.forEach((v, i) => {
    bytes += v.size;
    if (i >= KEEP_TOTAL || bytes > KEEP_TOTAL_BYTES) drop.push(v.key);
  });
  return drop;
}

/** Keep `existing` in the browser's storage and trim to the limits. Throws when it could not be written. */
export async function storePrevious(existing: File, now = Date.now()): Promise<void> {
  const bytes = new Uint8Array(await existing.arrayBuffer());
  const version: PreviousVersion = { key: `${existing.name}:${now}`, fileName: existing.name, at: now, modified: existing.lastModified, size: bytes.length, bytes };
  await put(version);
  for (const key of overLimits(await listPrevious())) await removePrevious(key);
}

/**
 * Keep the file a save is about to replace: `<path>.bak` in the desktop app when the handle
 * knows its path (`services/diskFiles.ts`), the browser's storage otherwise — and when the
 * `.bak` could not be written, with the reason, so the Save notice and the log can say why.
 * Never throws; what happened is the answer.
 */
export async function keepPrevious(existing: File, handle?: unknown): Promise<KeptPrevious> {
  const bridge = desktopBridge();
  let reason: string | undefined;
  if (bridge && isDiskHandle(handle)) {
    const r = await bridge.files.backup(handle.path).catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }));
    if (r.ok) return { kind: "bak", path: r.path };
    reason = r.message;
  }
  try {
    await storePrevious(existing);
    return { kind: "stored", fileName: existing.name, ...(reason ? { bakFailed: reason } : {}) };
  } catch (err) {
    return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}
