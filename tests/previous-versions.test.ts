/**
 * Save keeping the file it replaces: the writer hands over the old file before a byte of it
 * changes, only when there is something to keep; Save asks for it only with the preference
 * on; the browser's copies are trimmed per file name and in total. Node has no IndexedDB
 * and no desktop bridge, so the kept versions here are the memory stand-in's.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupMap } from "../desktop/backup";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { loadDocumentAtom } from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { DEFAULT_PREFERENCES, preferencesAtom } from "../src/atoms/preferencesAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { DEFAULT_SAVE_OPTIONS } from "../src/editor/save";
import { saveDocument, type SaveWriter } from "../src/hooks/useMapFileActions";
import { saveBytes, type MapFileHandle } from "../src/services/mapIo";
import { KEEP_PER_FILE, KEEP_TOTAL, listPrevious, loadPrevious, overLimits, removePrevious, storePrevious } from "../src/services/previousVersions";

afterEach(async () => {
  for (const v of await listPrevious()) await removePrevious(v.key);
});

/** A handle over bytes in memory that logs what happens to it, in order. */
function fakeHandle(name: string, contents: Uint8Array) {
  const events: string[] = [];
  let data = contents;
  const handle: MapFileHandle = {
    name,
    getFile: async () => { events.push("read"); return new File([data as unknown as BlobPart], name); },
    createWritable: async () => {
      events.push("open-for-write");
      return {
        write: async (b: Blob | Uint8Array) => { data = b instanceof Blob ? new Uint8Array(await b.arrayBuffer()) : b; events.push("write"); },
        close: async () => { events.push("close"); },
      };
    },
  };
  return { handle, events, now: () => data };
}

describe("the writer", () => {
  it("hands over the file it replaces before opening it for writing", async () => {
    const f = fakeHandle("a.scx", new Uint8Array([9, 9, 9]));
    const seen: number[][] = [];
    const out = await saveBytes(new Uint8Array([1]), "a.scx", f.handle, async (old) => { f.events.push("before"); seen.push([...new Uint8Array(await old.arrayBuffer())]); });
    expect(out?.route).toBe("file");
    expect(seen).toEqual([[9, 9, 9]]);
    expect(f.events).toEqual(["read", "before", "open-for-write", "write", "close"]);
    expect([...f.now()]).toEqual([1]);
  });

  it("keeps nothing of an empty file, and a failing keeper does not stop the save", async () => {
    const empty = fakeHandle("b.scx", new Uint8Array());
    let called = false;
    await saveBytes(new Uint8Array([1]), "b.scx", empty.handle, async () => { called = true; });
    expect(called).toBe(false);

    const full = fakeHandle("c.scx", new Uint8Array([5]));
    const out = await saveBytes(new Uint8Array([2]), "c.scx", full.handle, async () => { throw new Error("disk full"); });
    expect(out?.route).toBe("file");
    expect([...full.now()]).toEqual([2]);
  });
});

describe("Save", () => {
  function openStore() {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 16, era: 0, name: "p" }), extras: new Map(), fileName: "p.scx" });
    store.set(mapModifiedAtom, true);
    return store;
  }
  const replacing: SaveWriter = async (_bytes, fileName, handle, before) => {
    await before?.(new File([new Uint8Array([7, 7])], fileName));
    return { route: "file", fileName, handle };
  };

  it("keeps the replaced file in the browser's storage and says so once", async () => {
    const store = openStore();
    const req = { fileName: "p.scx", handle: null, options: DEFAULT_SAVE_OPTIONS, copy: false };
    expect(await saveDocument(store, req, replacing)).toBe(true);
    const [kept] = await listPrevious();
    expect(kept).toMatchObject({ fileName: "p.scx", size: 2 });
    expect([...(await loadPrevious(kept.key))!.bytes]).toEqual([7, 7]);
    expect(store.get(toastsAtom).at(-1)?.detail).toMatch(/Previous Versions/);
  });

  it("asks for nothing with the preference off", async () => {
    const store = openStore();
    store.set(preferencesAtom, { ...DEFAULT_PREFERENCES, save: { ...DEFAULT_PREFERENCES.save, backup: false } });
    let before: unknown = "unset";
    await saveDocument(store, { fileName: "p.scx", handle: null, options: DEFAULT_SAVE_OPTIONS, copy: false }, async (_b, fileName, handle, b) => { before = b; return { route: "file", fileName, handle }; });
    expect(before).toBeUndefined();
    expect(await listPrevious()).toHaveLength(0);
  });
});

describe("the limits", () => {
  it(`keeps the last ${KEEP_PER_FILE} of each file name`, async () => {
    for (let i = 0; i < KEEP_PER_FILE + 2; i++) await storePrevious(new File([new Uint8Array([i])], "m.scx"), 1000 + i);
    await storePrevious(new File([new Uint8Array([1])], "other.scx"), 500);
    const left = await listPrevious();
    expect(left.filter((v) => v.fileName === "m.scx").map((v) => v.at)).toEqual([1004, 1003, 1002]);
    expect(left.some((v) => v.fileName === "other.scx")).toBe(true);
  });

  it("drops the oldest past the total count or size", () => {
    const many = Array.from({ length: KEEP_TOTAL + 2 }, (_, i) => ({ key: `k${i}`, fileName: `f${i}.scx`, at: i, modified: 0, size: 1 }));
    expect(overLimits(many).sort()).toEqual(["k0", "k1"]);
    const big = [{ key: "old", fileName: "a.scx", at: 1, modified: 0, size: 200 * 1024 * 1024 }, { key: "new", fileName: "b.scx", at: 2, modified: 0, size: 100 * 1024 * 1024 }];
    expect(overLimits(big)).toEqual(["old"]);
  });
});

describe("the desktop's .bak", () => {
  it("copies a map file beside itself, replacing an older .bak", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-bak-"));
    const map = join(dir, "Lagoon.SCX");
    writeFileSync(map, "one");
    expect(backupMap(map)).toEqual({ ok: true, path: `${map}.bak` });
    writeFileSync(map, "two");
    backupMap(map);
    expect(readFileSync(`${map}.bak`, "utf8")).toBe("two");
  });

  it("copies nothing that is not an existing map file", () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-bak-"));
    const other = join(dir, "notes.txt");
    writeFileSync(other, "x");
    expect(backupMap(other).ok).toBe(false);
    expect(existsSync(`${other}.bak`)).toBe(false);
    expect(backupMap(join(dir, "missing.scm")).ok).toBe(false);
    expect(backupMap(dir + ".scx").ok).toBe(false);
  });
});
