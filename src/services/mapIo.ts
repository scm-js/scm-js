import type { LoadedDocument } from "../atoms/documentAtoms";
import { openMapBytes } from "../editor/mapFile";
import { desktopBridge } from "../gamedata/desktop";
import { diskHandle } from "./diskFiles";
import { t, msg } from "../i18n";

export type { MapFormat } from "../editor/save";
export { writeMapBytes, type WriteOptions } from "../editor/mapFile";

export const MAP_FILE_ACCEPT = ".scm,.scx,.chk";

/**
 * A file the browser lets the editor write back to: the File System Access API's
 * `FileSystemFileHandle`, typed here because the shipped DOM lib lacks its permission
 * methods. Chromium browsers (and Electron) hand one out from the open picker, the save
 * picker and a drop; Firefox and Safari have none, so Save there is a download.
 */
export interface MapFileHandle {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | Uint8Array): Promise<void>; close(): Promise<void> }>;
  queryPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

/** Read a picked or dropped file into a parsed document (`openMapBytes`, with the handle Save writes back to). */
export async function openMapFile(file: File, handle: MapFileHandle | null = null): Promise<LoadedDocument> {
  return { ...await openMapBytes(new Uint8Array(await file.arrayBuffer()), file.name), handle };
}

export interface PickedMapFile {
  file: File;
  /** Set when the browser can write the file back later. */
  handle: MapFileHandle | null;
}

const MAP_TYPES = [{ description: msg("StarCraft scenario"), accept: { "application/octet-stream": [".scm", ".scx", ".chk"] } }];
/** Lets the browser remember the directory between the open and save pickers. */
const PICKER_ID = "scmjs-maps";

/**
 * Show a file picker, falling back to a hidden input where the API is unavailable. `extra`
 * are the kinds of file plugins open (`plugins/fileTypes.ts`): with any, the picker's first
 * choice is everything the editor opens, maps and those together.
 */
export async function pickMapFile(extra: readonly { description: string; extensions: string[] }[] = []): Promise<PickedMapFile | null> {
  // The desktop build opens through its own dialog, which gives the path Save needs for its `.bak`.
  const bridge = desktopBridge();
  if (bridge) {
    const picked = await bridge.files.openDialog();
    return picked && { file: new File([picked.bytes as unknown as BlobPart], picked.name), handle: diskHandle(picked.path) };
  }
  const picker = (window as unknown as { showOpenFilePicker?: ShowOpenFilePicker }).showOpenFilePicker;
  if (picker) {
    try {
      const types = extra.length === 0 ? MAP_TYPES : [
        { description: t("Everything the editor opens"), accept: { "application/octet-stream": [...MAP_TYPES[0].accept["application/octet-stream"], ...extra.flatMap((e) => e.extensions)] } },
        ...MAP_TYPES,
        ...extra.map((e) => ({ description: e.description, accept: { "application/octet-stream": e.extensions } })),
      ];
      const [handle] = await picker({ types, multiple: false, id: PICKER_ID });
      return { file: await handle.getFile(), handle };
    } catch (err) {
      if (isAbort(err)) return null;
      // Fall through to the input element on any other failure.
    }
  }

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = [MAP_FILE_ACCEPT, ...extra.flatMap((e) => e.extensions)].join(",");
    input.addEventListener("change", () => { const file = input.files?.[0]; resolve(file ? { file, handle: null } : null); }, { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

/**
 * The writable handle behind a drop, when the browser gives one. Must be *called* inside
 * the drop handler — the transfer's items are only readable during the event — though the
 * promise can be awaited later.
 */
export function droppedHandle(transfer: DataTransfer): Promise<MapFileHandle | null> {
  // The desktop build keeps the dropped file's path instead (`services/diskFiles.ts`).
  const bridge = desktopBridge();
  const dropped = transfer.files?.[0];
  if (bridge) return dropped ? bridge.files.pathOf(dropped).then((path) => (path ? diskHandle(path) : null), () => null) : Promise.resolve(null);
  const item = transfer.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?(): Promise<{ kind: string } | null> }) | undefined;
  if (!item?.getAsFileSystemHandle) return Promise.resolve(null);
  try {
    // A synthetic drop (a test's DataTransfer) can leave the promise pending for ever; the open must not wait on it.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    const handle = item.getAsFileSystemHandle().then(
      (h) => (h && h.kind === "file" ? (h as unknown as MapFileHandle) : null),
      () => null,
    );
    return Promise.race([handle, timeout]);
  } catch {
    return Promise.resolve(null);
  }
}

/** Whether this browser can ask where to put a file (else a save is a download). */
export function canPickSaveLocation(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

/** How a write reached the disk. */
export type SaveRoute =
  /** Written straight into the file the handle names, no dialog. */
  | "file"
  /** The browser's save dialog chose the place; the handle is the new file. */
  | "picker"
  /** A download: the browser put it wherever it puts downloads. */
  | "download";

export interface SaveOutcome {
  route: SaveRoute;
  /** The name the file ended up with (the picker may have changed it). */
  fileName: string;
  /** A handle to write back to next time, when the route gives one. */
  handle: MapFileHandle | null;
}

/**
 * Called with the file a write is about to replace, before a byte of it changes — Save's
 * `.bak` and the browser's previous versions. Its failure never stops the write.
 */
export type BeforeOverwrite = (existing: File, handle: MapFileHandle) => Promise<void>;

/** Whether a name is a map file's — what the desktop build saves through its own dialog. */
export function isMapFileName(name: string): boolean {
  return /\.(scm|scx|chk)$/i.test(name);
}

/**
 * Write bytes to disk: straight into `handle` when there is one and the browser allows
 * it, else through the save dialog where supported, else as a download. Null when the
 * user dismissed the dialog. `before` hears the file being replaced, when the route
 * writes over one that has something in it (never a download).
 */
export async function saveBytes(bytes: Uint8Array, fileName: string, handle: MapFileHandle | null = null, before?: BeforeOverwrite): Promise<SaveOutcome | null> {
  return saveBlob(new Blob([bytes as unknown as BlobPart], { type: "application/octet-stream" }), fileName, handle, before);
}

/** The same, for something already assembled as a blob (an exported PNG). */
export async function saveBlob(blob: Blob, fileName: string, handle: MapFileHandle | null = null, before?: BeforeOverwrite): Promise<SaveOutcome | null> {
  if (handle && await writeThrough(handle, blob, before)) return { route: "file", fileName: handle.name, handle };

  // The desktop build saves a map through its own dialog, for the path (`services/diskFiles.ts`).
  const bridge = desktopBridge();
  if (bridge && isMapFileName(fileName)) {
    const chosen = await bridge.files.saveDialog(fileName);
    const picked = chosen && diskHandle(chosen.path);
    if (!picked) return null;
    await tellBefore(picked, before);
    const writable = await picked.createWritable();
    await writable.write(blob);
    await writable.close();
    return { route: "picker", fileName: picked.name, handle: picked };
  }

  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const picked = await picker({ suggestedName: fileName, types: pickerTypes(fileName), id: PICKER_ID });
      await tellBefore(picked, before);
      const writable = await picked.createWritable();
      await writable.write(blob);
      await writable.close();
      return { route: "picker", fileName: picked.name, handle: picked };
    } catch (err) {
      if (isAbort(err)) return null;
      // Anything else — a browser that has the picker but refuses this call — falls back to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { route: "download", fileName, handle: null };
}

/** Write into an existing handle, asking for write permission first; false when that is refused or the write fails. */
async function writeThrough(handle: MapFileHandle, blob: Blob, before?: BeforeOverwrite): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      let state = await handle.queryPermission({ mode: "readwrite" });
      if (state === "prompt" && handle.requestPermission) state = await handle.requestPermission({ mode: "readwrite" });
      if (state !== "granted") return false;
    }
    await tellBefore(handle, before);
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

/** Hand `before` what `handle` holds now; an empty or unreadable file (one the picker just made) is nothing to keep. */
async function tellBefore(handle: MapFileHandle, before?: BeforeOverwrite): Promise<void> {
  if (!before) return;
  let existing: File;
  try {
    existing = await handle.getFile();
  } catch {
    return;
  }
  if (existing.size === 0) return;
  try {
    await before(existing, handle);
  } catch {
    // Keeping the old file is a courtesy; the save goes on.
  }
}

function pickerTypes(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase();
  if (ext === "scm" || ext === "scx" || ext === "chk") return MAP_TYPES;
  if (ext === "png") return [{ description: t("PNG image"), accept: { "image/png": [".png"] } }];
  return undefined;
}

function isAbort(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

/* The File System Access API is not in the shipped DOM lib yet. */
type ShowOpenFilePicker = (options?: {
  types?: { description?: string; accept: Record<string, string[]> }[];
  multiple?: boolean;
  id?: string;
}) => Promise<MapFileHandle[]>;

type ShowSaveFilePicker = (options?: {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
  id?: string;
}) => Promise<MapFileHandle>;
