import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { pluginFileTypesAtom } from "../src/atoms/pluginAtoms";
import { folderReadsAtom } from "../src/atoms/uiAtoms";
import { logEntries, resetLogForTests } from "../src/editor/log";
import { handFilesToPlugins, pickerFileTypes, takeDroppedFolders } from "../src/plugins/fileTypes";
import { directoryHandleFiles, entryFiles, entryPaths, folderInputFiles, handleFinder, readFound, type DirectoryHandleLike, type EntryLike, type FileHandleLike } from "../src/plugins/folders";
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

/**
 * What the made entries and handles were asked: `File`s, and the most asked for at once; the
 * names an entry's `file()` and a handle's `getFile()` were asked for, and how many times a
 * handle's directory was listed.
 */
const asked = { files: 0, inFlight: 0, most: 0, byEntry: [] as string[], byHandle: [] as string[], listed: 0 };
const resetAsked = () => Object.assign(asked, { files: 0, inFlight: 0, most: 0, byEntry: [], byHandle: [], listed: 0 });
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
  if (isFile(node)) return { isFile: true, isDirectory: false, name, file: (ok, fail) => { asked.byEntry.push(name); if (name === fails) fail?.(new Error(`${name} could not be read`)); else void later(node).then(ok); } };
  return {
    isFile: false, isDirectory: true, name,
    createReader: () => {
      const children = Object.entries(node).map(([n, v]) => entryOf(n, v, piece, fails));
      return { readEntries: (ok) => ok(children.splice(0, piece)) };
    },
  };
}

/**
 * What `showDirectoryPicker()` resolves with, and a drop's `getAsFileSystemHandle()`, made.
 * `fails` names a file whose `getFile()` fails, or a directory that cannot be listed.
 */
function handleOf(name: string, node: Tree, fails?: string): DirectoryHandleLike {
  return {
    kind: "directory", name,
    async *values() {
      asked.listed++;
      if (name === fails) throw new DOMException(`${name} could not be listed`, "NotReadableError");
      for (const [n, v] of Object.entries(node)) {
        yield isFile(v)
          ? ({ kind: "file", name: n, getFile: () => { asked.byHandle.push(n); return n === fails ? Promise.reject(new DOMException(`${n} could not be read`, "NotReadableError")) : later(v); } } satisfies FileHandleLike)
          : handleOf(n, v, fails);
      }
    },
  };
}

const MOD: Tree = { arr: { "units.dat": file("units.dat"), "weapons.dat": file("weapons.dat") }, rez: { "unitnames.tbl": file("unitnames.tbl") }, "readme.txt": file("readme.txt") };
const MOD_PATHS = ["My Mod/arr/units.dat", "My Mod/arr/weapons.dat", "My Mod/readme.txt", "My Mod/rez/unitnames.tbl"];
const paths = (files: FolderFile[]) => files.map((f) => f.path);

/**
 * The same mod as a drop's entry lists it, with what a browser keeps back from a handle:
 * a file among others (`desktop.ini`), a file type (`config.ini`), and a whole directory
 * (`~backup`) with the ordinary file in it. Its `File`s are its own, so a file handed
 * over says which of the two it was read from; `MOD` is what the handle lists.
 */
const WHOLE_MOD: Tree = {
  arr: { "units.dat": file("units.dat"), "desktop.ini": file("desktop.ini"), "weapons.dat": file("weapons.dat") },
  rez: { "unitnames.tbl": file("unitnames.tbl") },
  samase: { "config.ini": file("config.ini") },
  "~backup": { "old.dat": file("old.dat") },
  "readme.txt": file("readme.txt"),
};
const WHOLE_MOD_PATHS = ["My Mod/arr/desktop.ini", "My Mod/arr/units.dat", "My Mod/arr/weapons.dat", "My Mod/readme.txt", "My Mod/rez/unitnames.tbl", "My Mod/samase/config.ini", "My Mod/~backup/old.dat"];
/** The file at a path of a made folder (the folder's own name first). */
const fileAt = (tree: Tree, path: string): File => path.split("/").slice(1).reduce<Tree | File>((node, name) => (node as Tree)[name], tree) as File;

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

  it("are found under a handle by path, a directory listed once and only when a file in it is asked for", async () => {
    resetAsked();
    const find = handleFinder(handleOf("My Mod", MOD));
    expect(asked.listed).toBe(0);
    const found = await Promise.all(["My Mod/arr/units.dat", "My Mod/arr/weapons.dat", "My Mod/arr/desktop.ini", "My Mod/~backup/old/x.dat", "Other/readme.txt", "My Mod"].map(find));
    expect(found.map((f) => f?.name ?? null)).toEqual(["units.dat", "weapons.dat", null, null, null, null]);
    // `My Mod` and `arr`; `rez` was not asked about, and a directory the handle lacks is not a listing.
    expect(asked.listed).toBe(2);
    expect((await find("My Mod/arr/units.dat"))?.kind).toBe("file");
    expect(asked.listed).toBe(2);
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

  /** A drop of one folder: its entry, and what `getAsFileSystemHandle()` answers. */
  const dropOf = (entry: EntryLike, handle: () => Promise<DirectoryHandleLike | null>) => ({ items: [{ kind: "file", webkitGetAsEntry: () => entry, getAsFileSystemHandle: handle }] });
  /** A plugin that opens every folder, and what it was handed. */
  const opener = () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    const got: FolderFile[][] = [];
    const offered: string[][] = [];
    api.ui.fileType({ name: "Mods", extensions: [], acceptsFolder: (p) => { offered.push([...p]); return true; }, openFolder: (files) => { got.push(files); } });
    return { store, got, offered };
  };

  it("hands over every file its entry lists: by the handle where the handle has it, by the entry where the browser keeps it back", async () => {
    resetLogForTests();
    resetAsked();
    const { store, got, offered } = opener();
    await takeDroppedFolders(store, dropOf(entryOf("My Mod", WHOLE_MOD), async () => handleOf("My Mod", MOD))).done;
    // Asked about, and handed, the entry's list, in its sorted order.
    expect(offered).toEqual([WHOLE_MOD_PATHS]);
    expect(paths(got[0])).toEqual(WHOLE_MOD_PATHS);
    // What the handle lists came from the handle; the rest, a whole kept-back directory among it, from the entry.
    const keptBack = ["My Mod/arr/desktop.ini", "My Mod/samase/config.ini", "My Mod/~backup/old.dat"];
    for (const { path, file: handed } of got[0]) expect(handed, path).toBe(fileAt(keptBack.includes(path) ? WHOLE_MOD : MOD, path));
    expect([...asked.byHandle].sort()).toEqual(["readme.txt", "unitnames.tbl", "units.dat", "weapons.dat"]);
    expect([...asked.byEntry].sort()).toEqual(["config.ini", "desktop.ini", "old.dat"]);
    // The handle's directories are listed once each, and only those with a file to read: `My Mod`, `arr`, `rez`.
    expect(asked.listed).toBe(3);
    expect(store.get(folderReadsAtom)).toEqual([]);
    const line = logEntries().find((e) => e.message === "Read the dropped folder My Mod");
    expect(line?.data).toEqual({ files: 7, byHandle: 4, byEntry: 3, firstByEntry: "My Mod/arr/desktop.ini" });
    expect(logEntries().some((e) => e.level === "warn" || e.level === "error")).toBe(false);
  });

  it("leaves out a file only its handle lists: the entry says what the folder holds", async () => {
    resetAsked();
    const { store, got } = opener();
    await takeDroppedFolders(store, dropOf(entryOf("My Mod", MOD), async () => handleOf("My Mod", { ...MOD, "late.txt": file("late.txt"), more: { "x.dat": file("x.dat") } }))).done;
    expect(paths(got[0])).toEqual(MOD_PATHS);
    expect(asked.byEntry).toEqual([]);
    expect(asked.byHandle.length).toBe(4);
  });

  it("asks nothing of its handle, and for no File, when no plugin takes it", async () => {
    resetAsked();
    const store = createStore();
    const api = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    let offered: string[] = [];
    api.ui.fileType({ name: "Pictures", extensions: [], acceptsFolder: (p) => { offered = [...p]; return false; }, openFolder: () => {} });
    await takeDroppedFolders(store, dropOf(entryOf("My Mod", WHOLE_MOD), async () => handleOf("My Mod", MOD))).done;
    expect(offered).toEqual(WHOLE_MOD_PATHS);
    expect(asked).toMatchObject({ files: 0, byEntry: [], byHandle: [], listed: 0 });
  });

  it("is read whole by its entry when the drop gives no handle, or one that is refused or cannot be listed", async () => {
    const noHandle = { items: [{ kind: "file", webkitGetAsEntry: () => entryOf("My Mod", WHOLE_MOD) }] };
    const refused = dropOf(entryOf("My Mod", WHOLE_MOD), () => Promise.reject(new DOMException("no", "NotAllowedError")));
    const none = dropOf(entryOf("My Mod", WHOLE_MOD), async () => null);
    // `fails` names the handle's own folder: its first listing throws.
    const unlistable = dropOf(entryOf("My Mod", WHOLE_MOD), async () => handleOf("My Mod", MOD, "My Mod"));
    for (const [made, warns] of [[noHandle, 0], [refused, 0], [none, 0], [unlistable, 1]] as const) {
      resetLogForTests();
      resetAsked();
      const { store, got } = opener();
      await takeDroppedFolders(store, made).done;
      expect(paths(got[0])).toEqual(WHOLE_MOD_PATHS);
      for (const { path, file: handed } of got[0]) expect(handed, path).toBe(fileAt(WHOLE_MOD, path));
      expect(asked.byEntry.length).toBe(7);
      expect(asked.byHandle).toEqual([]);
      // Said once, however many files the failing handle did not read.
      expect(logEntries().filter((e) => e.level === "warn").length).toBe(warns);
      expect(store.get(folderReadsAtom)).toEqual([]);
    }
  });

  it("reads by its entry what its handle fails at: one file, or one directory and what is under it", async () => {
    for (const [fails, viaEntry] of [["units.dat", ["units.dat"]], ["arr", ["units.dat", "weapons.dat"]]] as const) {
      resetLogForTests();
      resetAsked();
      const { store, got } = opener();
      await takeDroppedFolders(store, dropOf(entryOf("My Mod", MOD), async () => handleOf("My Mod", MOD, fails))).done;
      expect(paths(got[0])).toEqual(MOD_PATHS);
      expect([...asked.byEntry].sort()).toEqual(viaEntry);
      const warned = logEntries().filter((e) => e.level === "warn");
      expect(warned.length).toBe(1);
      expect(warned[0].message).toContain(fails === "arr" ? "Reading My Mod/arr of a dropped folder by its handle failed" : "Reading My Mod/arr/units.dat of a dropped folder by its handle failed");
    }
  });

  it("says what failed when neither its handle nor its entry can read a file, and when the entry cannot read one the handle lacks", async () => {
    // `units.dat`: the handle has it and fails, then the entry fails too. `desktop.ini`: only the entry lists it, and it fails.
    for (const fails of ["units.dat", "desktop.ini"]) {
      resetLogForTests();
      const { store, got } = opener();
      await takeDroppedFolders(store, dropOf(entryOf("My Mod", WHOLE_MOD, 2, fails), async () => handleOf("My Mod", MOD, fails))).done;
      expect(got).toEqual([]);
      expect(store.get(folderReadsAtom)).toEqual([]);
      expect(logEntries().some((e) => e.level === "error" && e.message.startsWith("Reading the dropped folder My Mod failed") && e.message.includes(`${fails} could not be read`))).toBe(true);
    }
  });

  it("counts every file in the status bar: the entry's count found, then each one read by either route", async () => {
    const { store, got } = opener();
    const seen: [number, number | null][] = [];
    const unsub = store.sub(folderReadsAtom, () => { for (const r of store.get(folderReadsAtom)) seen.push([r.found, r.read]); });
    // Slow enough for the cell's 150 ms writes to show the count as it stands at the end of each step.
    const slow = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
    const entry = entryOf("My Mod", WHOLE_MOD);
    const handle = handleOf("My Mod", MOD);
    const held: DirectoryHandleLike = { ...handle, async *values() { await slow(200); yield* handle.values(); } };
    await takeDroppedFolders(store, dropOf(entry, async () => { await slow(200); return held; })).done;
    unsub();
    expect(got[0].length).toBe(7);
    // Never a count of the handle's four files: seven found, and nothing but seven to read.
    expect(seen.some(([found, read]) => found === 7 && read === null)).toBe(true);
    expect(seen.every(([found]) => found === 0 || found === 7)).toBe(true);
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
