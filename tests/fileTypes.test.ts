import { describe, expect, it, vi } from "vitest";
import { createStore } from "jotai";
import { pluginFileTypesAtom } from "../src/atoms/pluginAtoms";
import { folderReadsAtom } from "../src/atoms/uiAtoms";
import { logEntries, resetLogForTests } from "../src/editor/log";
import { handFilesToPlugins, pickerFileTypes, takeDroppedFolders } from "../src/plugins/fileTypes";
import { directoryHandleFiles, entryFiles, entryPaths, folderInputFiles, readFound, type DirectoryHandleLike, type EntryLike, type FileHandleLike } from "../src/plugins/folders";
import type { FolderFile } from "../src/plugins/api";
import { Contributions, createPluginApi } from "../src/plugins/host";

const file = (name: string) => new File([new Uint8Array(4)], name);

describe("kinds of file plugins open", () => {
  it("hands claimed files to their plugin together, and leaves the rest for the editor", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "replays", name: "Replays", source: "s" }, new Contributions());
    const got: string[][] = [];
    api.ui.fileType({ name: "StarCraft replay", extensions: ["REP"], open: (files) => { got.push(files.map((f) => f.name)); } });
    const rest = handFilesToPlugins(store, [file("a.rep"), file("Lost Temple.scx"), file("b.Rep")]);
    expect(got).toEqual([["a.rep", "b.Rep"]]);
    expect(rest.map((f) => f.name)).toEqual(["Lost Temple.scx"]);
    expect(pickerFileTypes(store)).toEqual([{ description: "StarCraft replay", extensions: [".rep"] }]);
  });

  it("never gives away the editor's own maps, keeps the first claim, and lets go when disposed", () => {
    const store = createStore();
    const a = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    const b = createPluginApi(store, { id: "b", name: "B", source: "s" }, new Contributions());
    const seen: string[] = [];
    const first = a.ui.fileType({ name: "A's", extensions: [".rep", ".scx"], open: () => { seen.push("a"); } });
    b.ui.fileType({ name: "B's", extensions: [".rep", ".bin"], open: () => { seen.push("b"); } });
    expect(store.get(pluginFileTypesAtom).map((t) => [t.plugin.id, t.extensions])).toEqual([["a", [".rep"]], ["b", [".bin"]]]);
    expect(handFilesToPlugins(store, [file("x.scx")]).length).toBe(1);
    handFilesToPlugins(store, [file("x.rep")]);
    expect(seen).toEqual(["a"]);
    first.dispose();
    expect(handFilesToPlugins(store, [file("x.rep")]).map((f) => f.name)).toEqual(["x.rep"]);
  });

  it("keeps going when a plugin's open throws", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
    api.ui.fileType({ name: "Broken", extensions: [".rep"], open: () => { throw new Error("no"); } });
    expect(handFilesToPlugins(store, [file("x.rep")])).toEqual([]);
  });
});

/* ── Folders ─────────────────────────────────────────────── */

/** A made folder: names to files, or to folders of the same shape. */
type Tree = { [name: string]: Tree | File };
const isFile = (v: Tree | File): v is File => v instanceof File;

/** What the made entries and handles were asked: `File`s, and the most asked for at once. */
const asked = { files: 0, inFlight: 0, most: 0 };
const resetAsked = () => Object.assign(asked, { files: 0, inFlight: 0, most: 0 });
/** A `File` handed over a moment later, as the browser does, counting how many are in flight. */
function later(file: File): Promise<File> {
  asked.files++;
  asked.most = Math.max(asked.most, ++asked.inFlight);
  return new Promise((ok) => setTimeout(() => { asked.inFlight--; ok(file); }, 0));
}

/**
 * What a drop's `webkitGetAsEntry()` gives, made: a reader that hands a folder over `piece`
 * entries at a time (Chromium: 100), as the browser does. `fails` names a file whose `file()` fails.
 */
function entryOf(name: string, node: Tree | File, piece = 2, fails?: string): EntryLike {
  if (isFile(node)) return { isFile: true, isDirectory: false, name, file: (ok, fail) => (name === fails ? fail?.(new Error(`${name} could not be read`)) : void later(node).then(ok)) };
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      const children = Object.entries(node).map(([n, v]) => entryOf(n, v, piece, fails));
      return { readEntries: (ok) => ok(children.splice(0, piece)) };
    },
  };
}

/** What `showDirectoryPicker()` resolves with, made. */
function handleOf(name: string, node: Tree): DirectoryHandleLike {
  return {
    kind: "directory", name,
    async *values() {
      for (const [n, v] of Object.entries(node)) yield isFile(v) ? ({ kind: "file", name: n, getFile: () => later(v) } satisfies FileHandleLike) : handleOf(n, v);
    },
  };
}

const MOD: Tree = { arr: { "units.dat": file("units.dat"), "weapons.dat": file("weapons.dat") }, rez: { "unitnames.tbl": file("unitnames.tbl") }, "readme.txt": file("readme.txt") };
const MOD_PATHS = ["My Mod/arr/units.dat", "My Mod/arr/weapons.dat", "My Mod/readme.txt", "My Mod/rez/unitnames.tbl"];
const paths = (files: FolderFile[]) => files.map((f) => f.path);

describe("a folder's files with their paths", () => {
  it("are the same from the folder picker, the folder input and a drop", async () => {
    expect(paths(await directoryHandleFiles(handleOf("My Mod", MOD)))).toEqual(MOD_PATHS);
    expect(paths(await entryFiles(entryOf("My Mod", MOD)))).toEqual(MOD_PATHS);
    const input = MOD_PATHS.map((p) => Object.assign(file(p.split("/").pop()!), { webkitRelativePath: p }));
    const picked = folderInputFiles([...input].reverse());
    expect(paths(picked)).toEqual(MOD_PATHS);
    expect(picked[0].file).toBe(input[0]);
  });

  it("keep their order and every piece of a folder handed over 100 at a time, and come many at once", async () => {
    // 250 files in one folder (three pieces), named so the walk's order is not the sorted one.
    const big: Tree = { sub: { "b.txt": file("b.txt") } };
    for (let i = 249; i >= 0; i--) big[`f${String(i).padStart(3, "0")}.dat`] = file(`f${i}.dat`);
    resetAsked();
    const files = await entryFiles(entryOf("Big", big, 100));
    expect(files.length).toBe(251);
    expect(paths(files)).toEqual([...paths(files)].sort());
    expect(files[0]).toEqual({ path: "Big/f000.dat", file: big["f000.dat"] });
    expect(files.at(-1)!.path).toBe("Big/sub/b.txt");
    // Asked for together, but never more than a bounded number at a time.
    expect(asked.files).toBe(251);
    expect(asked.most).toBeGreaterThan(1);
    expect(asked.most).toBeLessThanOrEqual(32);
  });

  it("are found by their paths without asking for a single File", async () => {
    resetAsked();
    const counts: number[] = [];
    const found = await entryPaths(entryOf("My Mod", MOD), undefined, (n) => counts.push(n));
    expect(found.map((f) => f.path)).toEqual(MOD_PATHS);
    expect(asked.files).toBe(0);
    expect(counts.at(-1)).toBe(MOD_PATHS.length);
    const reads: number[] = [];
    await readFound(found, (e) => new Promise<File>((ok, fail) => e.file!(ok, fail)), (n) => reads.push(n));
    expect(reads).toEqual([1, 2, 3, 4]);
  });

  it("come from ui.pickFiles({ directory: true }): the folder picker, nothing on cancel", async () => {
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const had = { window: g.window, document: g.document };
    let answer: () => Promise<DirectoryHandleLike> = async () => handleOf("My Mod", MOD);
    g.document = {};
    g.window = { showDirectoryPicker: () => answer() };
    try {
      const store = createStore();
      const api = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
      const picked = await api.ui.pickFiles({ directory: true });
      expect(paths(picked)).toEqual(MOD_PATHS);
      expect(store.get(folderReadsAtom)).toEqual([]);
      expect(picked.every((f) => f.file instanceof File)).toBe(true);
      answer = async () => { throw Object.assign(new Error("The user aborted a request."), { name: "AbortError" }); };
      expect(await api.ui.pickFiles({ directory: true })).toEqual([]);
    } finally {
      g.window = had.window;
      g.document = had.document;
    }
  });
});

describe("a dropped folder", () => {
  /** A made drop: a loose file, then the folder, as `DataTransfer.items` lists them. */
  const drop = () => ({
    items: [
      { kind: "file", webkitGetAsEntry: () => entryOf("a.rep", file("a.rep")) },
      { kind: "string" },
      { kind: "file", webkitGetAsEntry: () => entryOf("My Mod", MOD) },
    ],
  });

  it("reaches the first plugin that opens folders and accepts it, as its files with their paths", async () => {
    const store = createStore();
    const a = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    const b = createPluginApi(store, { id: "b", name: "B", source: "s" }, new Contributions());
    const got: [string, string[]][] = [];
    a.ui.fileType({ name: "Replays", extensions: [".rep"], open: () => {} });
    // Only folders with a picture in them: not this one.
    a.ui.fileType({ name: "Pictures", extensions: [], acceptsFolder: (p) => p.some((x) => x.endsWith(".png")), openFolder: (files) => { got.push(["a", paths(files)]); } });
    b.ui.fileType({ name: "StarCraft mod", extensions: [], acceptsFolder: (p) => p.some((x) => x.endsWith("/arr/units.dat")), openFolder: (files) => { got.push(["b", paths(files)]); } });
    // A type that only opens folders is registered, and stays out of File ▸ Open's list.
    expect(store.get(pluginFileTypesAtom).map((t) => t.spec.name)).toEqual(["Replays", "Pictures", "StarCraft mod"]);
    expect(pickerFileTypes(store).map((t) => t.description)).toEqual(["Replays"]);
    const { taken, done } = takeDroppedFolders(store, drop());
    // The folder's placeholder is the drop's second file.
    expect([...taken]).toEqual([1]);
    await done;
    expect(got).toEqual([["b", MOD_PATHS]]);
    expect(store.get(folderReadsAtom)).toEqual([]);
  });

  it("asks for no File when no plugin takes it, and says so in the status bar only while it reads", async () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    let offered: string[] = [];
    let opened = false;
    api.ui.fileType({ name: "Pictures", extensions: [], acceptsFolder: (p) => { offered = p; return false; }, openFolder: () => { opened = true; } });
    resetAsked();
    const { done } = takeDroppedFolders(store, drop());
    // At once, before anything is read.
    expect(store.get(folderReadsAtom).map((r) => [r.name, r.found, r.read])).toEqual([["My Mod", 0, null]]);
    await done;
    expect(offered).toEqual(MOD_PATHS);
    expect(opened).toBe(false);
    expect(asked.files).toBe(0);
    expect(store.get(folderReadsAtom)).toEqual([]);
  });

  it("says what failed when a file cannot be read, opens nothing and clears the status bar", async () => {
    resetLogForTests();
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    let opened = false;
    api.ui.fileType({ name: "Mods", extensions: [], openFolder: () => { opened = true; } });
    const { done } = takeDroppedFolders(store, { items: [{ kind: "file", webkitGetAsEntry: () => entryOf("My Mod", MOD, 2, "units.dat") }] });
    await done;
    expect(opened).toBe(false);
    expect(store.get(folderReadsAtom)).toEqual([]);
    expect(logEntries().some((e) => e.level === "error" && e.message.startsWith("Reading the dropped folder My Mod failed") && e.message.includes("units.dat could not be read"))).toBe(true);
  });

  it("is read by its handle where the drop gives one, and by its entry when the handle is refused", async () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    const got: string[][] = [];
    api.ui.fileType({ name: "Mods", extensions: [], openFolder: (files) => { got.push(paths(files)); } });
    const viaEntry = vi.fn();
    const entry = entryOf("My Mod", MOD);
    const watched: EntryLike = { ...entry, createReader: () => { viaEntry(); return entry.createReader!(); } };
    await takeDroppedFolders(store, { items: [{ kind: "file", webkitGetAsEntry: () => watched, getAsFileSystemHandle: async () => handleOf("My Mod", MOD) }] }).done;
    expect(got).toEqual([MOD_PATHS]);
    expect(viaEntry).not.toHaveBeenCalled();
    await takeDroppedFolders(store, { items: [{ kind: "file", webkitGetAsEntry: () => watched, getAsFileSystemHandle: () => Promise.reject(new DOMException("no", "NotAllowedError")) }] }).done;
    expect(got).toEqual([MOD_PATHS, MOD_PATHS]);
    expect(viaEntry).toHaveBeenCalled();
    expect(store.get(folderReadsAtom)).toEqual([]);
  });

  it("is left alone when no plugin opens folders", async () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    api.ui.fileType({ name: "Replays", extensions: [".rep"], open: () => {} });
    const { taken, done } = takeDroppedFolders(store, drop());
    await done;
    expect(taken.size).toBe(0);
  });
});
