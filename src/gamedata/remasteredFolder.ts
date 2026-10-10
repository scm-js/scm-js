/**
 * Recognising a StarCraft: Remastered installation folder and reading from a pick of one.
 * Apart from `remastered.ts` on purpose: that module runs the extraction and brings it
 * along, and this half is what the dialog and the install routes need on the main thread
 * just to tell what kind of folder they were handed.
 */
import type { BlobLike, StorageSource } from "kascade";

/** The file at the top of every installation the launcher made; its presence is how a folder is recognised. */
export const BUILD_INFO = ".build.info";

/** One file of a folder pick: its path from the picked folder's parent, as `webkitRelativePath` gives it. */
export interface PickedFile {
  path: string;
  file: BlobLike;
}

/**
 * The installation folder among a folder pick's paths: where `.build.info` is. A pick of
 * the folder itself puts it one level down (`StarCraft/.build.info`); null when the pick
 * holds none.
 */
export function installRootOf(paths: readonly string[]): string | null {
  let best: string | null = null;
  for (const path of paths) {
    const normal = path.replaceAll("\\", "/");
    if (normal !== BUILD_INFO && !normal.endsWith(`/${BUILD_INFO}`)) continue;
    const root = normal.slice(0, normal.length - BUILD_INFO.length);
    if (best === null || root.length < best.length) best = root;
  }
  return best;
}

/**
 * A `kascade` source over the files of a folder pick — what a browser without a folder
 * picker of its own hands over (`<input webkitdirectory>`): every file of the folder as a
 * `File`, which is a handle rather than the bytes, so a range of a multi-gigabyte data
 * file is read without the rest. Null when the pick is not an installation.
 */
export function pickedFilesSource(files: readonly PickedFile[]): StorageSource | null {
  const root = installRootOf(files.map((f) => f.path));
  if (root === null) return null;
  const byPath = new Map<string, BlobLike>();
  for (const { path, file } of files) {
    const normal = path.replaceAll("\\", "/");
    if (normal.startsWith(root)) byPath.set(normal.slice(root.length), file);
  }
  return {
    async read(path, offset, length) {
      const file = byPath.get(path);
      if (!file) throw new Error(`no such file: ${path}`);
      const part = offset === undefined ? file : file.slice(offset, length === undefined ? undefined : offset + length);
      return new Uint8Array(await part.arrayBuffer());
    },
    async list(path) {
      const prefix = path.replace(/\/+$/, "") + "/";
      const names: string[] = [];
      for (const name of byPath.keys()) {
        if (name.startsWith(prefix) && !name.slice(prefix.length).includes("/")) names.push(name.slice(prefix.length));
      }
      return names;
    },
  };
}
