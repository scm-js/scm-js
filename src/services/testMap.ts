/**
 * Tools ▸ Test Map: hand the open map to the game. Neither StarCraft build takes a map on
 * its command line, so "test" means putting the file where the game lists it — a `scmJS`
 * folder under the game's Maps folder — and, in the desktop build, starting the game so
 * the map is one Single Player ▸ Custom Game away. A browser tab cannot start a program;
 * there the map goes into a folder the user picked once (the handle is kept in IndexedDB,
 * `services/handleStore.ts`) and, where the browser has no folder picker, downloads.
 *
 * The bytes are exactly what Save would write (the remembered save options), except that a
 * bare `.chk` becomes an `.scx`, since the game only opens archives.
 */
import type { createStore } from "jotai";
import { archiveExtrasAtom, scenarioAtom } from "../atoms/documentAtoms";
import { mapFilePathAtom, mapOriginAtom, saveOptionsAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { buildMapFile, defaultSaveOptions } from "../editor/save";
import { scenarioName } from "../formats/chk/scenario";
import { desktopBridge, type DesktopGameInfo } from "../gamedata/desktop";
import { ensurePermission, loadHandle, removeHandle, storeHandle, type StoredHandle } from "./handleStore";
import { saveBytes } from "./mapIo";

type Store = ReturnType<typeof createStore>;

/** The IndexedDB key of the browser's test folder handle. */
export const TEST_FOLDER_KEY = "testMapFolder";

export interface TestFolderHandle extends StoredHandle {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob | Uint8Array): Promise<void>; close(): Promise<void> }> }>;
}

export type TestRoute = "desktop" | "folder" | "download";

export interface TestMapOutcome {
  route: TestRoute;
  /** The file's name, or its full path when the desktop wrote it. */
  path: string;
  launched: boolean;
  /** Why the game did not start, when it was asked to. */
  message?: string;
}

/** The name the game will list: the open file's, or the scenario's, always an archive. */
export function testFileName(store: Store): string | null {
  const scn = store.get(scenarioAtom);
  if (!scn) return null;
  const path = store.get(mapFilePathAtom);
  let name = path ? path.split(/[\\/]/).pop()! : `${(scenarioName(scn) ?? "Untitled Scenario").replace(/[<>:"/\\|?*]/g, "_").replace(/[^\x20-\uffff]/g, "").trim() || "map"}.scx`;
  if (/\.chk$/i.test(name)) name = name.replace(/\.chk$/i, ".scx");
  if (!/\.(scx|scm)$/i.test(name)) name += ".scx";
  return name;
}

/** The map as the game should get it: the remembered save options, in an archive. */
export async function testMapBytes(store: Store): Promise<Uint8Array | null> {
  const scn = store.get(scenarioAtom);
  if (!scn) return null;
  const options = store.get(saveOptionsAtom) ?? defaultSaveOptions(scn, store.get(mapOriginAtom), store.get(mapFilePathAtom));
  const format = options.format === "chk" ? "scx" : options.format;
  return buildMapFile(scn, store.get(archiveExtrasAtom), { ...options, format });
}

/** Whether this browser can ask for a folder (Chromium); else the browser route is a download. */
export function canPickTestFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Ask for the folder the browser should write test maps into and remember it. Null when dismissed. */
export async function pickTestFolder(): Promise<TestFolderHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker?: (o: { id: string; mode: "readwrite" }) => Promise<TestFolderHandle> }).showDirectoryPicker;
  if (!picker) return null;
  try {
    const handle = await picker({ id: "scmjs-test-folder", mode: "readwrite" });
    await storeHandle(TEST_FOLDER_KEY, handle);
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return null;
    throw err;
  }
}

/** The remembered folder, or null. */
export function storedTestFolder(): Promise<TestFolderHandle | null> {
  return loadHandle<TestFolderHandle>(TEST_FOLDER_KEY);
}

export function forgetTestFolder(): Promise<void> {
  return removeHandle(TEST_FOLDER_KEY);
}

/** The desktop build's view of the game, or null in a browser. */
export function desktopGameInfo(store: Store): Promise<DesktopGameInfo> | null {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const dir = store.get(preferencesAtom).testMap.dir;
  return bridge.game.info(dir || undefined);
}

export interface TestMapRequest {
  /** Start the game after writing (desktop build); the preference when omitted. */
  launch?: boolean;
  /** Browser: download instead of writing into the remembered folder. */
  download?: boolean;
}

/**
 * Write the map where the game will find it. Resolves null when the browser has no folder
 * yet (the dialog should ask for one) or the user dismissed a picker; throws when the write
 * itself fails, with the reason.
 */
export async function runTestMap(store: Store, req: TestMapRequest = {}): Promise<TestMapOutcome | null> {
  const name = testFileName(store);
  const bytes = await testMapBytes(store);
  if (!name || !bytes) return null;
  const prefs = store.get(preferencesAtom);
  const bridge = desktopBridge();
  if (bridge) {
    const r = await bridge.game.test(bytes, name, { dir: prefs.testMap.dir || undefined, launch: req.launch ?? prefs.testMap.launch });
    return { route: "desktop", path: r.path, launched: r.launched, message: r.message };
  }
  if (req.download || !canPickTestFolder()) {
    const outcome = await saveBytes(bytes, name, null);
    return outcome ? { route: outcome.route === "download" ? "download" : "folder", path: outcome.fileName, launched: false } : null;
  }
  const folder = await storedTestFolder();
  if (!folder) return null;
  if (!(await ensurePermission(folder, "readwrite"))) throw new Error(`The browser did not allow writing into ${folder.name}.`);
  const file = await folder.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(bytes);
  await writable.close();
  return { route: "folder", path: `${folder.name}/${name}`, launched: false };
}
