/**
 * Where the recovery copies of modified maps are kept: the `recovery` store of the editor's
 * IndexedDB database (`services/handleStore.ts`), one record per map per session, holding
 * the scenario as CHK bytes plus what the archive carried beside it — enough to open the
 * map again as it was, file handle included where the browser lets one be stored.
 *
 * Each page holds a Web Lock named after its session for as long as it lives, so a start
 * can tell the copies of a session that ended (offered back) from those of another tab or
 * window still running (left alone). A memory map stands in when there is no IndexedDB,
 * which makes the copies last only as long as the page — tests, and a browser with site
 * data blocked.
 */
import type { Getter } from "jotai";
import type { MemberInfo, StoredMembers } from "../formats/mpq/scm";
import type { SaveOptions } from "../editor/save";
import type { BuiltBy } from "../editor/mapBuild";
import type { MapFileHandle } from "./mapIo";
import type { OpenDocumentInfo } from "../plugins/api";
import { frontDocument, type ParkedDocument } from "../atoms/documentAtoms";
import { serializeScenario } from "../formats/chk/scenario";
import { recoveryKey, type RecoveryOwner } from "../editor/recovery";
import { handleStorePersists, idbRequest, RECOVERY_STORE } from "./handleStore";

/** One stored copy. */
export interface RecoveryRecord extends RecoveryOwner {
  key: string;
  /** The map's id in its session (not meaningful in any other). */
  docId: number;
  /** The scenario's name, as the tab showed it. */
  name: string;
  fileName: string | null;
  width: number;
  height: number;
  tileset: string;
  /** Bytes held: the CHK and the archive's other files. */
  size: number;
  chk: Uint8Array;
  extras: Map<string, Uint8Array>;
  stored: StoredMembers | null;
  origin: MemberInfo | null;
  builtBy: BuiltBy[] | null;
  saveOptions: SaveOptions | null;
  /** The file to save back to, when the browser could store it; null otherwise. */
  handle: MapFileHandle | null;
}

/** The copy's description without its bytes, for lists. */
export type RecoveryEntry = Omit<RecoveryRecord, "chk" | "extras" | "stored">;

/** A map bigger than this (CHK plus the other files) is not copied; the log says so once. */
export const MAX_COPY_BYTES = 64 * 1024 * 1024;

/** This page's session. Copies are keyed by it, and its lock says it is still running. */
export const SESSION: string = typeof crypto !== "undefined" && "randomUUID" in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const LOCK_PREFIX = "scmjs.session:";

interface LockManagerLike {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
  query(): Promise<{ held?: { name?: string }[] }>;
}

function locks(): LockManagerLike | null {
  const nav = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { locks?: LockManagerLike });
  return nav?.locks ?? null;
}

let holding = false;

/** Hold this session's lock until the page goes away. Once per page; nothing happens without Web Locks. */
export function holdSessionLock(): void {
  const lm = locks();
  if (holding || !lm) return;
  holding = true;
  void lm.request(LOCK_PREFIX + SESSION, () => new Promise<never>(() => {})).catch(() => { holding = false; });
}

/** The sessions running now in any tab or window of this origin; null when the browser cannot say. */
export async function liveSessions(): Promise<Set<string> | null> {
  const lm = locks();
  if (!lm) return null;
  try {
    const { held = [] } = await lm.query();
    return new Set(held.map((l) => l.name ?? "").filter((n) => n.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
  } catch {
    return null;
  }
}

/* ── The store ──────────────────────────────────────────── */

const memory = new Map<string, RecoveryRecord>();

/** Whether the copies outlive the page here. */
export function recoveryPersists(): boolean {
  return handleStorePersists();
}

/**
 * Write a copy. A handle the browser refuses to store is dropped and the copy written
 * without it. Throws when the copy could not be written at all (quota, storage blocked).
 */
export async function putCopy(record: RecoveryRecord): Promise<void> {
  if (!recoveryPersists()) { memory.set(record.key, record); return; }
  try {
    await idbRequest(RECOVERY_STORE, "readwrite", (s) => s.put(record, record.key));
  } catch (err) {
    if (!record.handle || !(err instanceof DOMException && err.name === "DataCloneError")) throw err;
    await idbRequest(RECOVERY_STORE, "readwrite", (s) => s.put({ ...record, handle: null }, record.key));
  }
}

export async function removeCopy(key: string): Promise<void> {
  memory.delete(key);
  if (!recoveryPersists()) return;
  try {
    await idbRequest(RECOVERY_STORE, "readwrite", (s) => s.delete(key));
  } catch {
    // It stays until the site data is cleared, and is offered back at the next start.
  }
}

/** Every copy, from every session. Empty when the store cannot be read. */
export async function listCopies(): Promise<RecoveryRecord[]> {
  const out = [...memory.values()];
  if (!recoveryPersists()) return out;
  try {
    out.push(...(await idbRequest(RECOVERY_STORE, "readonly", (s) => s.getAll())) as RecoveryRecord[]);
  } catch {
    // Unreadable: report what memory has.
  }
  return out;
}

/** One copy by key, or null. */
export async function loadCopy(key: string): Promise<RecoveryRecord | null> {
  if (memory.has(key)) return memory.get(key)!;
  if (!recoveryPersists()) return null;
  try {
    return ((await idbRequest(RECOVERY_STORE, "readonly", (s) => s.get(key))) as RecoveryRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

/** A copy without its bytes. */
export function entryOf(record: RecoveryRecord): RecoveryEntry {
  const { chk: _chk, extras: _extras, stored: _stored, ...entry } = record;
  return entry;
}

/* ── Making a copy ──────────────────────────────────────── */

/**
 * The copy of one open map: the one in front read from the registers, a parked one from its
 * record. Built synchronously, so the bytes are the map as it is at this moment whatever
 * happens while the write is waiting on IndexedDB. Null for an id that is not open.
 */
export function copyOf(get: Getter, info: OpenDocumentInfo, parked: ParkedDocument | null): RecoveryRecord | null {
  const doc = parked ?? frontDocument(get);
  if (!doc) return null;
  const chk = serializeScenario(doc.scenario);
  // The Map object is the document's; its entries are replaced, never written into.
  const extras = new Map(doc.extras);
  let size = chk.length;
  for (const bytes of extras.values()) size += bytes.length;
  return {
    key: recoveryKey(SESSION, info.id), session: SESSION, docId: info.id, at: Date.now(),
    name: info.name, fileName: doc.fileName, width: doc.scenario.width, height: doc.scenario.height, tileset: info.tileset, size,
    chk, extras, stored: doc.stored, origin: doc.origin, builtBy: doc.builtBy, saveOptions: doc.saveOptions, handle: doc.handle,
  };
}
