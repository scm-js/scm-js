/**
 * Where File System Access handles are kept between sessions. A `FileSystemFileHandle`
 * (or directory handle) is structured-cloneable, so IndexedDB can hold it and hand it back
 * after a reload — that is what lets Open Recent reopen a map from disk and Test Map
 * remember the game's Maps folder. The browser still asks for permission again on the
 * first use after a reload (`queryPermission` / `requestPermission` on the handle), and
 * Firefox and Safari have no handles to keep, so every caller treats a `null` as "ask
 * again". One object store, keyed by a string the caller chooses; a memory `Map` stands in
 * when there is no IndexedDB (tests, a browser with site data blocked).
 */

const DB_NAME = "scmjs";
const STORE = "handles";
const VERSION = 1;

/** The part of a handle every caller relies on; the DOM lib lacks the permission methods. */
export interface StoredHandle {
  readonly kind: "file" | "directory";
  readonly name: string;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

const memory = new Map<string, unknown>();

function hasIdb(): boolean {
  return typeof indexedDB !== "undefined";
}

/** Whether handles can outlive the page here — false means every stored handle is session-only. */
export function handleStorePersists(): boolean {
  return hasIdb();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB refused to open"));
    req.onblocked = () => reject(new Error("IndexedDB is blocked"));
  });
}

function request<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    tx.oncomplete = () => db.close();
    tx.onabort = () => { db.close(); reject(tx.error ?? new Error("IndexedDB transaction aborted")); };
  }));
}

/** Keep a handle under `key`; a failure (quota, a browser that refuses to clone it) is swallowed — the handle simply will not come back next time. */
export async function storeHandle(key: string, handle: unknown): Promise<boolean> {
  if (!hasIdb()) { memory.set(key, handle); return false; }
  try {
    await request("readwrite", (s) => s.put(handle, key));
    return true;
  } catch {
    memory.set(key, handle);
    return false;
  }
}

export async function loadHandle<T = unknown>(key: string): Promise<T | null> {
  if (memory.has(key)) return memory.get(key) as T;
  if (!hasIdb()) return null;
  try {
    return ((await request("readonly", (s) => s.get(key))) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function removeHandle(key: string): Promise<void> {
  memory.delete(key);
  if (!hasIdb()) return;
  try {
    await request("readwrite", (s) => s.delete(key));
  } catch {
    // Nothing to do: the entry stays until the site data is cleared.
  }
}

/** Every stored key, for a sweep. */
export async function storedHandleKeys(): Promise<string[]> {
  const keys = new Set<string>(memory.keys());
  if (hasIdb()) {
    try {
      for (const k of await request("readonly", (s) => s.getAllKeys())) keys.add(String(k));
    } catch {
      // Unreadable store: report what memory has.
    }
  }
  return [...keys];
}

/** Forget every handle (Preferences ▸ Clear browser data). */
export async function clearHandles(): Promise<void> {
  memory.clear();
  if (!hasIdb()) return;
  try {
    await request("readwrite", (s) => s.clear());
  } catch {
    // Same as above.
  }
}

/**
 * Ask the browser to let the page use a stored handle again: granted straight away when
 * it remembers, else a prompt. False when refused or the handle has no permission methods
 * to ask (then the operation itself will say).
 */
export async function ensurePermission(handle: StoredHandle, mode: "read" | "readwrite"): Promise<boolean> {
  try {
    if (!handle.queryPermission) return true;
    let state = await handle.queryPermission({ mode });
    if (state === "prompt" && handle.requestPermission) state = await handle.requestPermission({ mode });
    return state === "granted";
  } catch {
    return false;
  }
}
