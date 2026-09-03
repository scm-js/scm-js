import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { loadMap } from "../src/formats/mpq/scm";
import { archiveExtrasAtom, loadDocumentAtom, recentFilesAtom, scenarioAtom } from "../src/atoms/documentAtoms";
import { mapFileHandleAtom, mapFilePathAtom, mapModifiedAtom, mapOriginAtom, saveOptionsAtom } from "../src/atoms/editorAtoms";
import { closeDialogAtom, dialogStackAtom, statusMessageAtom, toastsAtom } from "../src/atoms/uiAtoms";
import { DEFAULT_SAVE_OPTIONS, type SaveOptions } from "../src/editor/save";
import { askDialog, saveDocument, type SaveWriter } from "../src/hooks/useMapFileActions";
import type { MapFileHandle, SaveOutcome } from "../src/services/mapIo";

const handleNamed = (name: string): MapFileHandle => ({
  name,
  getFile: () => Promise.reject(new Error("not a real file")),
  createWritable: () => Promise.reject(new Error("not a real file")),
});

/** A writer that records what it was asked and answers as told. */
function writer(answer: (fileName: string, handle: MapFileHandle | null) => SaveOutcome | null) {
  const calls: { bytes: Uint8Array; fileName: string; handle: MapFileHandle | null }[] = [];
  const write: SaveWriter = async (bytes, fileName, handle) => { calls.push({ bytes, fileName, handle }); return answer(fileName, handle); };
  return { calls, write };
}

function openStore() {
  const store = createStore();
  const scenario = createScenario({ width: 32, height: 32, era: 0, name: "flow" });
  store.set(loadDocumentAtom, { scenario, extras: new Map([["staredit\\wav\\x.wav", new Uint8Array([1, 2])]]), fileName: "flow.scx", handle: handleNamed("flow.scx") });
  store.set(mapModifiedAtom, true);
  return store;
}
const options: SaveOptions = { ...DEFAULT_SAVE_OPTIONS, compression: "pkware", encrypt: true };

describe("saveDocument", () => {
  it("writes through the handle, keeps it, remembers the options and clears the modified flag", async () => {
    const store = openStore();
    const handle = store.get(mapFileHandleAtom)!;
    const w = writer((fileName, h) => ({ route: "file", fileName, handle: h }));
    expect(await saveDocument(store, { fileName: "flow.scx", handle, options, copy: false }, w.write)).toBe(true);
    expect(w.calls).toHaveLength(1);
    expect(w.calls[0].handle).toBe(handle);
    const loaded = await loadMap(w.calls[0].bytes);
    expect(loaded.scenarioInfo).toMatchObject({ compression: "pkware", encrypted: true });
    expect(loaded.files).toContain("staredit\\wav\\x.wav");
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(mapFileHandleAtom)).toBe(handle);
    expect(store.get(saveOptionsAtom)).toBe(options);
    expect(store.get(statusMessageAtom)).toMatch(/^Saved flow\.scx/);
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "ok", title: "Saved" });
  });

  it("adopts the name and handle the save picker chose", async () => {
    const store = openStore();
    const picked = handleNamed("renamed.scm");
    const w = writer(() => ({ route: "picker", fileName: "renamed.scm", handle: picked }));
    expect(await saveDocument(store, { fileName: "flow.scm", handle: null, options: { ...options, format: "scm" }, copy: false }, w.write)).toBe(true);
    expect(store.get(mapFilePathAtom)).toBe("renamed.scm");
    expect(store.get(mapFileHandleAtom)).toBe(picked);
    expect(store.get(recentFilesAtom)[0]).toMatchObject({ name: "renamed.scm", handleKey: "recent:renamed.scm" });
  });

  it("says so when the browser could only download, and forgets the handle", async () => {
    const store = openStore();
    const w = writer((fileName) => ({ route: "download", fileName, handle: null }));
    expect(await saveDocument(store, { fileName: "flow.scx", handle: null, options, copy: false }, w.write)).toBe(true);
    expect(store.get(mapFileHandleAtom)).toBeNull();
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(statusMessageAtom)).toMatch(/^Downloaded flow\.scx/);
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "ok", title: "Downloaded" });
    expect(store.get(toastsAtom).at(-1)!.detail).toMatch(/downloads folder/);
  });

  it("leaves the document alone for a copy", async () => {
    const store = openStore();
    const handle = store.get(mapFileHandleAtom);
    const w = writer((fileName) => ({ route: "picker", fileName, handle: handleNamed(fileName) }));
    expect(await saveDocument(store, { fileName: "flow copy.scx", handle: null, options, copy: true }, w.write)).toBe(true);
    expect(store.get(mapFilePathAtom)).toBe("flow.scx");
    expect(store.get(mapFileHandleAtom)).toBe(handle);
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(saveOptionsAtom)).toBeNull();
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ title: "Copy saved" });
  });

  it("answers false, untouched, when the dialog was dismissed or the write failed", async () => {
    const store = openStore();
    const dismissed = writer(() => null);
    expect(await saveDocument(store, { fileName: "flow.scx", handle: null, options, copy: false }, dismissed.write)).toBe(false);
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(toastsAtom)).toEqual([]);

    const failing: SaveWriter = async () => { throw new Error("disk full"); };
    expect(await saveDocument(store, { fileName: "flow.scx", handle: null, options, copy: false }, failing)).toBe(false);
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "error", detail: "disk full" });
    expect(store.get(statusMessageAtom)).toMatch(/disk full/);

    store.set(scenarioAtom, null);
    expect(await saveDocument(store, { fileName: "x.scx", handle: null, options, copy: false }, dismissed.write)).toBe(false);
  });

  it("uses the bytes it is handed rather than building again", async () => {
    const store = openStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const w = writer((fileName) => ({ route: "file", fileName, handle: null }));
    await saveDocument(store, { fileName: "flow.chk", handle: null, options: { ...options, format: "chk" }, copy: false, bytes }, w.write);
    expect(w.calls[0].bytes).toBe(bytes);
  });
});

describe("askDialog", () => {
  it("resolves true when the dialog reports done and false when it is dismissed", async () => {
    const store = openStore();
    const asked = askDialog(store, "saveAs", { copy: true });
    const entry = store.get(dialogStackAtom).at(-1)!;
    expect(entry.id).toBe("saveAs");
    expect(entry.payload?.copy).toBe(true);
    const payload = entry.payload as { done: (ok: boolean) => void; taken?: boolean };
    payload.taken = true;
    payload.done(true);
    store.set(closeDialogAtom, entry.key);
    expect(await asked).toBe(true);

    const again = askDialog(store, "saveAs");
    store.set(closeDialogAtom, store.get(dialogStackAtom).at(-1)!.key);
    expect(await again).toBe(false);
  });
});

describe("document atoms", () => {
  it("carries the handle and origin in and clears them out", () => {
    const store = openStore();
    expect(store.get(mapFileHandleAtom)?.name).toBe("flow.scx");
    expect(store.get(mapOriginAtom)).toBeNull();
    store.set(saveOptionsAtom, options);
    store.set(loadDocumentAtom, { scenario: store.get(scenarioAtom)!, extras: store.get(archiveExtrasAtom), fileName: "flow.scx", handle: store.get(mapFileHandleAtom), reason: "replace" });
    expect(store.get(saveOptionsAtom)).toBe(options);
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 8, height: 8, era: 0, name: "n" }), extras: new Map(), fileName: null, reason: "new" });
    expect(store.get(saveOptionsAtom)).toBeNull();
    expect(store.get(mapFileHandleAtom)).toBeNull();
  });
});
