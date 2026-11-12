/**
 * A mod's hash as the command line shows and matches it: `@scm-js/mod`'s identity of the mod (`ModDescription.identity`:
 * every game file it lays, its FireGraft project and every module of its code), with what a replay tagged by an
 * earlier rule may name it by — the hash by the rule before 2026-11-11 (`beforeCode`), the hashes while an operating
 * system's files had lines (`older`), and the game files alone (what `scmjs` called a mod's data set before the plugins
 * and the project had lines). Nothing of the person's copy of the game is in any of them.
 */
import type { Archive } from "mopaq";
import { folderOf, gameName, hashLines, hashLinesAsWere, isPluginFile, openLayer, sha256Hex } from "@scm-js/mod";
import type { ModSource } from "./source";

export interface SourceHash {
  hash: string;
  /** The hash without the lines of the mod's code: what a game that runs none of it presents. */
  withoutPlugins: string;
  /** The hash by the rule before 2026-11-11, where it is neither of those two; null otherwise. */
  beforeCode: string | null;
  /** The hashes while an operating system's files had lines (until 2026-11-09), where the mod has such files; null otherwise. */
  older: { hash: string; withoutPlugins: string | null; left: string[] } | null;
  /** The hash's lines but the code's (the game files' and the FireGraft project's), sorted. */
  lines: string[];
  /** Lines of each kind. */
  files: number;
  plugins: number;
  firegraft: number;
  /** The game files that could not be read (by game name): left out. */
  unreadable: string[];
  /** The hash over the game files alone: what `scmjs` called a mod's data set before the plugins and the project had lines. */
  gameFilesOnly: string;
  /** That hash as it was while an operating system's files had lines; null when the mod has none. */
  gameFilesOnlyWere: string | null;
  /** The lines of the operating system's files where a file of the mod's would be (by game name): what `older` counted. */
  systemLines: string[];
}

/**
 * The lines `name<TAB>sha256` of the operating system's files the older hash counted (`identity.older.files`, by game
 * name: loose where a game file would be, or members of the mod's archives), read where they are — a loose one first,
 * as the later layer wins, else the last archive that holds it. They have no line in the hash; until 2026-11-09 they
 * had, and a replay tagged then counted them. (`@scm-js/mod` gives their names and the hashes they made, not their
 * bytes: the earlier forms below need the lines.)
 */
export async function systemLines(source: ModSource): Promise<string[]> {
  const d = source.description, tree = source.tree, names = d?.identity.older?.files ?? [];
  if (!d || !tree || !names.length) return [];
  const root = d.layers.find((l) => l.kind === "folder")?.path ?? folderOf(d.layers.find((l) => l.kind === "archive")?.path ?? "");
  const loose = new Map(d.left.filter((l) => l.why === "system" && (!root || l.path.startsWith(`${root}/`))).map((l) => [gameName(root ? l.path.slice(root.length + 1) : l.path), l.path]));
  const archives: Archive[] = [];
  for (const l of [...d.layers].reverse()) if (l.kind === "archive") { try { archives.push(await openLayer(tree, l)); } catch { /* not read then either */ } }
  const lines: string[] = [];
  for (const name of names) {
    let bytes: Uint8Array | null = null;
    const path = loose.get(name);
    if (path) { try { bytes = await tree.read(path); } catch { bytes = null; } }
    for (const a of archives) { if (bytes) break; try { bytes = a.fileInfo(name) ? a.readFile(name) : null; } catch { bytes = null; } }
    if (bytes) lines.push(`${name}\t${await sha256Hex(bytes)}`);
  }
  return lines;
}

/** The mod's hash, its hash without its code, the earlier forms, and what went into them. */
export async function sourceHash(source: ModSource): Promise<SourceHash> {
  const d = source.description;
  if (!d) throw new Error(`${source.name} was not read as a mod`);
  const id = d.identity;
  const gameLines = id.lines.filter((l) => !/\.fgp\t/.test(l));
  // (the lines of the operating system's files the older hash had, for the earlier forms below)
  const system = id.older ? await systemLines(source) : [];
  return {
    hash: id.hash, withoutPlugins: id.withoutPlugins, beforeCode: id.beforeCode ?? null,
    older: id.older ? { hash: id.older.hash, withoutPlugins: id.older.withoutPlugins ?? null, left: id.older.files } : null,
    lines: id.lines, files: gameLines.length, plugins: Object.keys(id.plugins).length, firegraft: id.lines.length - gameLines.length,
    unreadable: d.unreadable, gameFilesOnly: await hashLines(gameLines),
    gameFilesOnlyWere: system.length ? await hashLinesAsWere([...gameLines, ...system]) : null, systemLines: system,
  };
}

/** How many of the mod's code modules are plugins a loader loads (not the libraries they map). */
export const pluginCount = (source: ModSource) => source.code.filter((c) => c.role !== "library" && (c.role !== undefined || isPluginFile(c.name))).length;
