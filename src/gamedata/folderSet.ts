/**
 * A mod's folder as a data set in memory: the loose game files of a picked folder, by the
 * name the game's archives know each by, answered a file at a time when the editor asks
 * (`source.ts#DataSetReader`, attached with `services/gameData.ts#attachReaderDataSet`).
 * Nothing is read until then — a pick hands over `File`s, which are handles — so a folder
 * of thousands of files costs its listing and the few files the open map draws from.
 *
 * It is the quick way to *look* at a map made for a mod (`services/missingTerrain.ts`
 * offers it): nothing is installed or remembered, and nothing is worked out of the mod
 * beyond what is drawn. Archives in the folder (`.mpq`, a mod's `.exe`) are not opened
 * here; installing the mod as a data set (Help ▸ Game Data…) or the Mod Editor plugin
 * reads those.
 *
 * Pure: the files come as anything with a size and `arrayBuffer()`, so tests hand in made ones.
 */
import { GAME_FOLDERS, gameName, inDotFolder, isSystemFile, modRoot } from "@scm-js/mod";
import type { DataSetReader } from "./source";

/** One file of a picked folder: its path from the folder's parent, forward slashes (`My Mod/mpq/arr/units.dat`). */
export interface FolderPiece {
  path: string;
  file: { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> };
}

export interface FolderSet {
  /** The picked folder's own name. */
  name: string;
  /** The folder in it the game's paths start in (`@scm-js/mod`'s `modRoot`); "" for the pick's parent. */
  root: string;
  /** The loose game files by the game's name: lower case, backslashes (`tileset\jungle.cv5`). */
  files: Map<string, FolderPiece["file"]>;
  /** The archives in the folder, by file name: not read here. */
  archives: string[];
}

const isArchive = (path: string) => /\.(mpq|exe)$/i.test(path);

/**
 * A picked folder's files sorted into the game files it holds loose and the archives it holds. An operating system's
 * file (`isSystemFile`: `sound/desktop.ini`, macOS's `._units.dat`) is neither, nor a file in a tool's dot folder
 * (`inDotFolder`: `.git/`), as nowhere else that reads a mod (`@scm-js/mod`'s rules).
 */
export function folderSet(pieces: readonly FolderPiece[]): FolderSet {
  const paths = pieces.map((p) => p.path.replaceAll("\\", "/"));
  // (the picked folder's own name is no tool's folder, whatever it starts with)
  const skip = (p: string) => isSystemFile(p) || inDotFolder(p.slice(p.indexOf("/") + 1));
  const kept = paths.filter((p) => !skip(p));
  const root = modRoot(kept);
  // (no file under one of the game's folders: nothing in the folder is the game's)
  const rooted = kept.some((p) => p.toLowerCase().split("/").slice(0, -1).some((f) => f !== "maps" && GAME_FOLDERS.includes(f)));
  const under = root ? `${root}/` : "";
  const files = new Map<string, FolderPiece["file"]>();
  const archives: string[] = [];
  pieces.forEach((piece, i) => {
    const path = paths[i];
    if (skip(path)) return;
    if (isArchive(path)) { archives.push(path.split("/").pop()!); return; }
    if (!rooted || !path.startsWith(under)) return;
    const inner = path.slice(under.length);
    const top = inner.split("/")[0].toLowerCase();
    // (every file in a folder under the root, as `@scm-js/mod` lays a folder — a plugin's own `samase/`, `lua/` too — but
    // not one beside the game's folders, nor a plugin's or FireGraft's own beside them)
    if (inner.includes("/") && top !== "plugins" && top !== "firegraft") files.set(gameName(inner), piece.file);
  });
  return { name: paths[0]?.split("/")[0] ?? "", root, files, archives };
}

/** A member's size in the folder, or null when the folder has no such file. */
export function folderFileSize(set: FolderSet, member: string): number | null {
  return set.files.get(gameName(member))?.size ?? null;
}

const bytesOf = async (file: FolderPiece["file"]) => new Uint8Array(await file.arrayBuffer());

/** A classic megatile table (sixteen u16 a megatile) as the wide one (sixteen u32): the same references. */
function widenVx4(vx4: Uint8Array): Uint8Array {
  const from = new DataView(vx4.buffer, vx4.byteOffset, vx4.byteLength);
  const out = new Uint8Array(vx4.length * 2);
  const to = new DataView(out.buffer);
  for (let i = 0; i + 1 < vx4.length; i += 2) to.setUint32(i * 2, from.getUint16(i, true), true);
  return out;
}

/**
 * The function a `reader` source asks: the folder's file for the member the editor wants,
 * null for everything the folder has not got (which then comes from the data set
 * underneath).
 *
 * One case is not a plain lookup. The editor prefers a tileset's wide megatile table
 * (`.vx4ex`) and takes it from underneath when the folder has only the classic `.vx4` —
 * a table for other tiles than the folder's own group table names. So a folder with a
 * tileset's `.cv5` and `.vx4` and no `.vx4ex` answers the wide one from its own.
 */
export function folderReader(set: FolderSet): DataSetReader["read"] {
  return async (_path, context) => {
    if (!context.member) return null;
    const member = gameName(context.member);
    const file = set.files.get(member);
    if (file) return bytesOf(file);
    const wide = member.match(/^(tileset\\[^\\]+)\.vx4ex$/);
    const classic = wide && set.files.has(`${wide[1]}.cv5`) ? set.files.get(`${wide[1]}.vx4`) : undefined;
    return classic ? widenVx4(await bytesOf(classic)) : null;
  };
}
