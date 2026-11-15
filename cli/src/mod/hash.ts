/**
 * A mod's hash as the command line shows and matches it: `@scm-js/mod`'s identity of the mod (`ModDescription.identity`:
 * every game file it lays, its FireGraft project and every module of its code), with what a replay tagged by an
 * earlier rule may name it by — every hash `identity.earlier` lists (the rule before 2026-11-11, the hashes while an
 * operating system's files had lines, the game files alone, …). Nothing of the person's copy of the game is in any of
 * them; the forms that need the person's copy are `replaymod.ts#sourceHashes`'.
 */
import { isPluginFile, type EarlierHash } from "@scm-js/mod";
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
  /**
   * Every hash an earlier rule gave the same files (`identity.earlier`), each with its rule: for matching a replay or a
   * kept mod named then, never for naming the mod.
   */
  earlier: EarlierHash[];
}

/** The mod's hash, its hash without its code, the earlier forms, and what went into them. */
export async function sourceHash(source: ModSource): Promise<SourceHash> {
  const d = source.description;
  if (!d) throw new Error(`${source.name} was not read as a mod`);
  const id = d.identity;
  const firegraft = id.lines.filter((l) => /\.fgp\t/.test(l)).length;
  return {
    hash: id.hash, withoutPlugins: id.withoutPlugins, beforeCode: id.beforeCode ?? null,
    older: id.older ? { hash: id.older.hash, withoutPlugins: id.older.withoutPlugins ?? null, left: id.older.files } : null,
    lines: id.lines, files: id.lines.length - firegraft, plugins: Object.keys(id.plugins).length, firegraft,
    unreadable: d.unreadable, earlier: id.earlier ?? [],
  };
}

/** How many of the mod's code modules are plugins a loader loads (not the libraries they map). */
export const pluginCount = (source: ModSource) => source.code.filter((c) => c.role !== "library" && (c.role !== undefined || isPluginFile(c.name))).length;
