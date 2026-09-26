/**
 * The desktop build's map file handle: a path on disk behind the same `MapFileHandle`
 * shape the File System Access API hands a browser, so everything that keeps, parks,
 * saves through or remembers a handle works unchanged. Reading and writing go to the main
 * process by path (`desktop/mapFiles.ts`), and so does Save's `.bak` — which is why the
 * desktop build does not use the browser's handles for maps: a `File` read through one has
 * no path the app can find.
 *
 * A handle like this cannot be structured-cloned, so the handle store keeps
 * `{ diskPath }` for one and turns it back into a handle on the way out (`storableHandle`
 * / `revivedHandle`).
 */
import { desktopBridge } from "../gamedata/desktop";
import type { MapFileHandle } from "./mapIo";

export interface DiskMapHandle extends MapFileHandle {
  readonly kind: "file";
  /** The file's path, as the main process recorded it. */
  readonly path: string;
}

const DISK = Symbol("disk");

/** The file name at the end of a Windows or POSIX path. */
export function pathBaseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** A handle for `path`, or null outside the desktop build. */
export function diskHandle(path: string): DiskMapHandle | null {
  const bridge = desktopBridge();
  if (!bridge) return null;
  const name = pathBaseName(path);
  return {
    kind: "file",
    name,
    path,
    [DISK]: true,
    async getFile() {
      const bytes = await bridge.files.read(path);
      return new File([bytes as unknown as BlobPart], name);
    },
    async createWritable() {
      const parts: Uint8Array[] = [];
      return {
        async write(data: Blob | Uint8Array) {
          parts.push(data instanceof Uint8Array ? data : new Uint8Array(await data.arrayBuffer()));
        },
        async close() {
          const bytes = parts.length === 1 ? parts[0] : new Uint8Array(await new Blob(parts as unknown as BlobPart[]).arrayBuffer());
          const r = await bridge.files.write(path, bytes);
          if (!r.ok) throw new Error(r.message);
        },
      };
    },
  } as DiskMapHandle;
}

export function isDiskHandle(handle: unknown): handle is DiskMapHandle {
  return !!handle && typeof handle === "object" && (handle as Record<symbol, unknown>)[DISK] === true;
}

/** What the handle store keeps for a handle: `{ diskPath }` for a disk handle, the handle itself otherwise. */
export function storableHandle<T>(handle: T): T | { diskPath: string } {
  return isDiskHandle(handle) ? { diskPath: handle.path } : handle;
}

/** A stored value back as a handle: a disk handle for `{ diskPath }` (null outside the desktop build), else the value as it was. */
export function revivedHandle<T>(stored: T): T | DiskMapHandle | null {
  if (stored && typeof stored === "object" && typeof (stored as { diskPath?: unknown }).diskPath === "string") return diskHandle((stored as unknown as { diskPath: string }).diskPath);
  return stored;
}
