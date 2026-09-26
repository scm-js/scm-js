/**
 * The desktop build's map files by path: the main process's list of paths the user gave
 * the app, and the page's disk handle over it — end to end through Save, with a stand-in
 * bridge that calls the real `MapFiles` on a temporary folder. This is the route that makes
 * the `.bak`; the browser's handles cannot, since a `File` read through one has no path.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { MapFiles } from "../desktop/mapFiles";
import { createScenario } from "../src/formats/chk/create";
import { loadDocumentAtom } from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { DEFAULT_SAVE_OPTIONS } from "../src/editor/save";
import { saveDocument } from "../src/hooks/useMapFileActions";
import { diskHandle, isDiskHandle, pathBaseName, revivedHandle, storableHandle } from "../src/services/diskFiles";
import { loadHandle, removeHandle, storeHandle } from "../src/services/handleStore";
import { listPrevious, removePrevious } from "../src/services/previousVersions";

const global = globalThis as { scmjsDesktop?: unknown };

function folder() {
  return mkdtempSync(join(tmpdir(), "scmjs-maps-"));
}

describe("the main process's map paths", () => {
  it("reads and writes only map files the user gave the app", () => {
    const dir = folder();
    const map = join(dir, "Lagoon.scx");
    writeFileSync(map, "one");
    const files = new MapFiles(null, false);
    expect(() => files.read(map)).toThrow();
    expect(files.write(map, new Uint8Array([1])).ok).toBe(false);
    expect(files.backup(map).ok).toBe(false);
    expect(files.allow(join(dir, "notes.txt"))).toBeNull();

    expect(files.allow(map)).toBe(map);
    expect(new TextDecoder().decode(files.read(map))).toBe("one");
    expect(files.backup(map)).toEqual({ ok: true, path: `${map}.bak` });
    expect(files.write(map, new TextEncoder().encode("two"))).toEqual({ ok: true });
    expect(readFileSync(map, "utf8")).toBe("two");
    expect(readFileSync(`${map}.bak`, "utf8")).toBe("one");
  });

  it("keeps no .bak of a file that is not there yet", () => {
    const dir = folder();
    const files = new MapFiles(null, false);
    const fresh = files.allow(join(dir, "New.scx"))!;
    expect(files.backup(fresh).ok).toBe(false);
    expect(existsSync(`${fresh}.bak`)).toBe(false);
  });

  it("remembers the paths across a restart, and ignores case where the disk does", () => {
    const dir = folder();
    const list = join(dir, "map-files.json");
    const map = join(dir, "Lagoon.scx");
    new MapFiles(list, true).allow(map);
    const again = new MapFiles(list, true);
    expect(again.known(map)).toBe(true);
    expect(again.known(map.toUpperCase().replace(/\.SCX$/, ".scx"))).toBe(true);
    expect(new MapFiles(list, false).known(map.replace("Lagoon", "LAGOON"))).toBe(false);
  });
});

describe("the page's disk handle", () => {
  let files: MapFiles;
  let dir: string;
  beforeEach(() => {
    dir = folder();
    files = new MapFiles(null, false);
    global.scmjsDesktop = {
      platform: "linux",
      version: "0.0.0",
      files: {
        read: async (p: string) => files.read(p),
        write: async (p: string, b: Uint8Array) => files.write(p, b),
        backup: async (p: string) => files.backup(p),
      },
    };
  });
  afterEach(async () => {
    delete global.scmjsDesktop;
    for (const v of await listPrevious()) await removePrevious(v.key);
  });

  it("names the file from a Windows or POSIX path", () => {
    expect(pathBaseName("C:\\Users\\me\\Maps\\Lagoon.scx")).toBe("Lagoon.scx");
    expect(pathBaseName("/home/me/Lagoon.scx")).toBe("Lagoon.scx");
  });

  it("is kept in the handle store as its path and comes back as a handle", async () => {
    const h = diskHandle(join(dir, "a.scx"))!;
    expect(storableHandle(h)).toEqual({ diskPath: h.path });
    expect(isDiskHandle(revivedHandle({ diskPath: h.path }))).toBe(true);
    await storeHandle("recent:a.scx", h);
    const back = await loadHandle<{ path: string }>("recent:a.scx");
    expect(isDiskHandle(back) && back.path).toBe(h.path);
    await removeHandle("recent:a.scx");
  });

  it("saves in place and keeps the replaced file as .bak", async () => {
    const map = files.allow(join(dir, "Lagoon.scx"))!;
    writeFileSync(map, "the old map");
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 16, era: 0, name: "p" }), extras: new Map(), fileName: "Lagoon.scx" });
    store.set(mapModifiedAtom, true);
    const ok = await saveDocument(store, { fileName: "Lagoon.scx", handle: diskHandle(map), options: DEFAULT_SAVE_OPTIONS, copy: false });
    expect(ok).toBe(true);
    expect(readFileSync(`${map}.bak`, "utf8")).toBe("the old map");
    expect(readFileSync(map).subarray(0, 4).toString("latin1")).toBe("MPQ\x1a");
    expect(store.get(toastsAtom).at(-1)?.detail).toMatch(/Lagoon\.scx\.bak/);
    expect(await listPrevious()).toHaveLength(0);
  });

  it("falls back to Previous Versions with the reason when the .bak cannot be written", async () => {
    const map = files.allow(join(dir, "Lagoon.scx"))!;
    writeFileSync(map, "the old map");
    (global.scmjsDesktop as { files: { backup: unknown } }).files.backup = async () => ({ ok: false, message: "Access is denied" });
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 16, height: 16, era: 0, name: "p" }), extras: new Map(), fileName: "Lagoon.scx" });
    await saveDocument(store, { fileName: "Lagoon.scx", handle: diskHandle(map), options: DEFAULT_SAVE_OPTIONS, copy: false });
    expect(await listPrevious()).toHaveLength(1);
    const warn = store.get(toastsAtom).find((x) => x.kind === "warn");
    expect(warn?.detail).toMatch(/Access is denied\. .*Previous Versions/);
  });
});
