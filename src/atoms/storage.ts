/**
 * The editor's one corner of browser storage: every key it writes starts with `scmjs.`
 * (`scmjs.prefs`, `scmjs.grid`, `scmjs.plugins`, `scmjs.plugin-manifests`, and
 * `scmjs.plugin.<id>.…` for whatever a plugin keeps through `api.storage`).
 *
 * `localStorage` can be unavailable — a sandboxed frame, tests, a browser set to block site
 * data, where even *reading* the property throws — so `browserStorage()` falls back to a
 * module-level memory `Storage`. Everything here works either way; `storagePersists()` says
 * which one is in use, for the chrome to be honest about it.
 */

/** Every key the editor writes begins with this. */
export const STORAGE_PREFIX = "scmjs.";

const memory = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return memory.size; },
  clear: () => memory.clear(),
  getItem: (k) => memory.get(k) ?? null,
  key: (i) => [...memory.keys()][i] ?? null,
  removeItem: (k) => { memory.delete(k); },
  setItem: (k, v) => { memory.set(k, v); },
};

/** `localStorage` when it works, else a memory stand-in that lives as long as the tab. */
export function browserStorage(): Storage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Access itself can throw (storage disabled); fall through.
  }
  return memoryStorage;
}

/** False when the fallback is in use, i.e. nothing written survives a reload. */
export function storagePersists(): boolean {
  return browserStorage() !== memoryStorage;
}

/** The editor's keys, sorted — anything else in the origin's storage is left alone. */
export function storedKeys(): string[] {
  const store = browserStorage();
  const keys: string[] = [];
  try {
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(STORAGE_PREFIX)) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys.sort();
}

/** Rough size of one entry in bytes (UTF-16 code units of key + value), for the UI. */
export function storedSize(key: string): number {
  try {
    return (key.length + (browserStorage().getItem(key)?.length ?? 0)) * 2;
  } catch {
    return 0;
  }
}

/**
 * Remove every `scmjs.` key and return the ones removed. Atoms holding the same values are
 * *not* reset — `clearStoredDataAtom` in `preferencesAtoms.ts` does both.
 */
export function clearStoredData(): string[] {
  const store = browserStorage();
  const keys = storedKeys();
  for (const key of keys) {
    try {
      store.removeItem(key);
    } catch {
      // Ignore a key we cannot remove; the rest still go.
    }
  }
  return keys;
}
