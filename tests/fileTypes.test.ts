import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { pluginFileTypesAtom } from "../src/atoms/pluginAtoms";
import { handFilesToPlugins, pickerFileTypes, takeDroppedFolders } from "../src/plugins/fileTypes";
import { directoryHandleFiles, entryFiles, folderInputFiles, type DirectoryHandleLike, type EntryLike, type FileHandleLike } from "../src/plugins/folders";
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

/** What a drop's `webkitGetAsEntry()` gives, made: a reader that hands a folder over two entries at a time, as Chromium does in pieces. */
function entryOf(name: string, node: Tree | File): EntryLike {
  if (isFile(node)) return { isFile: true, isDirectory: false, name, file: (ok) => ok(node) };
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      const children = Object.entries(node).map(([n, v]) => entryOf(n, v));
      return { readEntries: (ok) => ok(children.splice(0, 2)) };
    },
  };
}

/** What `showDirectoryPicker()` resolves with, made. */
function handleOf(name: string, node: Tree): DirectoryHandleLike {
  return {
    kind: "directory", name,
    async *values() {
      for (const [n, v] of Object.entries(node)) yield isFile(v) ? ({ kind: "file", name: n, getFile: async () => v } satisfies FileHandleLike) : handleOf(n, v);
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

  it("come from ui.pickFiles({ directory: true }): the folder picker, nothing on cancel", async () => {
    const g = globalThis as unknown as { window?: unknown; document?: unknown };
    const had = { window: g.window, document: g.document };
    let answer: () => Promise<DirectoryHandleLike> = async () => handleOf("My Mod", MOD);
    g.document = {};
    g.window = { showDirectoryPicker: () => answer() };
    try {
      const api = createPluginApi(createStore(), { id: "p", name: "P", source: "s" }, new Contributions());
      const picked = await api.ui.pickFiles({ directory: true });
      expect(paths(picked)).toEqual(MOD_PATHS);
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
