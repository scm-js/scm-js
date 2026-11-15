/**
 * Names `@scm-js/core` exported for a mod's hash and its self-executing exe before reading a mod became `@scm-js/mod`'s,
 * kept with their signatures so code written against them keeps working. Each is a thin layer over the package: the
 * same inputs give the hash the package's rule gives those lines. New code reads a mod with `readMod` and takes its
 * `identity`.
 */
import {
  exeArchive as packageExeArchive, gameFileLine, gameName as packageGameName, hashLines, hashLinesAsWere, isSystemFile, pluginLine as packagePluginLine,
  firegraftLine as packageFiregraftLine, leafOf, sha256Hex,
  type ExeArchive as PackageExeArchive,
} from "@scm-js/mod";

/**
 * A path as the game names it: backslashes, lower case, no leading backslash (`arr\units.dat`), as this library has
 * always given it. (`@scm-js/mod`'s own `gameName` keeps a leading backslash: storm finds a member by its stored name.)
 */
export const gameName = (path: string): string => packageGameName(path).replace(/^\\+/, "");

/** @deprecated A file by name and SHA-256: give `readMod` the mod's files and read `identity` instead. */
export interface Digest { name: string; sha256: string }

/** @deprecated What `modHashOfDigests` takes: use `readMod` and its `identity`. */
export interface ModHashInput {
  files: readonly Digest[];
  /** Plugins carried as files (`.qdp`, `.bwl`). */
  plugins?: readonly Digest[];
  /** FireGraft's files; only the project (`.fgp`) has a line. */
  firegraft?: readonly Digest[];
}

/** @deprecated What `modHashOfDigests` gives: use `ModDescription.identity`. */
export interface ModHash {
  hash: string;
  withoutPlugins: string;
  /** The lines without the plugins' (sorted). */
  lines: string[];
  /** The plugins' lines (sorted). */
  pluginLines: string[];
  /** There when an operating system's files were among the digests: the hashes while they had lines, and their names. */
  older?: { hash: string; withoutPlugins: string; left: string[] };
}

const lineName = (l: string) => l.slice(0, l.indexOf("\t"));
const byName = (a: string, b: string) => (lineName(a) < lineName(b) ? -1 : lineName(a) > lineName(b) ? 1 : 0);

/** A module of the mod's code's line, `plugins\<file name>`, lower case: from a path too (its file name is taken). */
export const pluginLine = (name: string, sha256: string): string => packagePluginLine(leafOf(name), sha256);
/** The FireGraft project's line, `<file name>`, lower case: from a path too (its file name is taken). */
export const firegraftLine = (name: string, sha256: string): string => packageFiregraftLine(leafOf(name), sha256);

/** @deprecated Whether a file is FireGraft's project: `/\.fgp$/i`. */
export const isFiregraftProject = (name: string): boolean => /\.fgp$/i.test(name);

/** @deprecated A game file's line, `name<TAB>sha256` by its game name: `ModDescription.identity.lines` holds them. */
export const gameLine = (name: string, sha256: string): string => gameFileLine(gameName(name), sha256);

/**
 * @deprecated Use `readMod` and its `identity`, which also has lines for a patcher's own plugins and the libraries a
 * mod's plugins load. The hash of these files by `@scm-js/mod`'s lines: game files by game name (the last given wins),
 * plugins (`.qdp`, `.bwl`) and the FireGraft project once by file name (the first wins); an operating system's files
 * have no line, and `older` says what the hashes were with them.
 */
export async function modHashOfDigests(input: ModHashInput): Promise<ModHash> {
  const game = new Map<string, { sha256: string; system: boolean }>();
  for (const f of input.files) game.set(gameName(f.name), { sha256: f.sha256, system: isSystemFile(f.name) });
  const once = (list: readonly Digest[], keep: (name: string) => boolean, line: (leaf: string, sha: string) => string) => {
    const seen = new Set<string>(), out: { line: string; system: boolean }[] = [];
    for (const f of list) {
      const leaf = leafOf(f.name);
      if (!keep(f.name) || seen.has(leaf.toLowerCase())) continue;
      seen.add(leaf.toLowerCase());
      out.push({ line: line(leaf, f.sha256), system: isSystemFile(f.name) });
    }
    return out;
  };
  const were = [...[...game].map(([name, f]) => ({ line: gameFileLine(name, f.sha256), system: f.system })), ...once(input.firegraft ?? [], isFiregraftProject, firegraftLine)];
  const pluginsWere = once(input.plugins ?? [], (n) => /\.(qdp|bwl)$/i.test(n), pluginLine);
  const lines = were.filter((l) => !l.system).map((l) => l.line).sort(byName);
  const pluginLines = pluginsWere.filter((l) => !l.system).map((l) => l.line).sort(byName);
  const left = [...were, ...pluginsWere].filter((l) => l.system).map((l) => lineName(l.line)).sort();
  return {
    hash: await hashLines([...lines, ...pluginLines]), withoutPlugins: await hashLines(lines), lines, pluginLines,
    ...(left.length ? { older: { hash: await hashLinesAsWere([...were, ...pluginsWere].map((l) => l.line)), withoutPlugins: await hashLinesAsWere(were.map((l) => l.line)), left } } : {}),
  };
}

type Named = { name: string; bytes: Uint8Array };
const digests = async (list: readonly Named[] = []) => { const out: Digest[] = []; for (const f of list) out.push({ name: f.name, sha256: await sha256Hex(f.bytes) }); return out; };

/** @deprecated `modHashOfDigests` from the files' bytes: use `readMod` and its `identity`. */
export async function modHash(input: { files: readonly Named[]; plugins?: readonly Named[]; firegraft?: readonly Named[] }): Promise<ModHash> {
  return modHashOfDigests({ files: await digests(input.files), plugins: await digests(input.plugins), firegraft: await digests(input.firegraft) });
}

/** @deprecated The hash of game files alone (no code): `hashLines` over their lines, or `readMod(…).identity` for a mod. */
export async function dataSetHashOfDigests(files: readonly Digest[]): Promise<string> {
  return (await modHashOfDigests({ files })).hash;
}

/** @deprecated `dataSetHashOfDigests` from the files' bytes. */
export async function dataSetHash(files: readonly Named[]): Promise<string> {
  return dataSetHashOfDigests(await digests(files));
}

/**
 * The archive in a self-executing exe, as `@scm-js/mod` reads it, with the two fields this library gave before:
 * `kind` (`form` in the package's words) and `archive` (the exe's bytes from the archive's header on).
 */
export interface ExeArchive extends PackageExeArchive {
  /** @deprecated Use `form`: `"firegraft"` for FireGraft's patcher, `"sempq"` for any other exe with an archive. */
  kind: "sempq" | "firegraft";
  /**
   * @deprecated Open `bytes` at `at` (`Archive.open(bytes, { offset: at })`): an archive whose tables lie before its
   * header cannot be opened from this slice.
   */
  archive: Uint8Array;
}

/** `@scm-js/mod`'s `exeArchive`, with `kind` and `archive` beside its own fields. Throws its `PatcherError`. */
export function exeArchive(b: Uint8Array): ExeArchive | null {
  const found = packageExeArchive(b);
  return found && { ...found, kind: found.form === "firegraft-patcher" ? "firegraft" : "sempq", archive: found.bytes.subarray(found.at) };
}
