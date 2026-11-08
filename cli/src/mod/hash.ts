/**
 * A mod's hash as the command line works it out: core's `modHashOfDigests` (`src/formats/mod/hash.ts`, the play page's
 * rule) over every file the opened mod lays over the game, the plugins it carries as files and its FireGraft project.
 * A file at a time, the bytes let go after each. Nothing of the person's copy of the game is in it.
 */
import { modHashOfDigests, type Digest, type ModHash } from "../../../src/formats/mod/hash";
import { fileDigest } from "../../../src/formats/mod/sources";
import type { ModSource } from "./source";

export interface SourceHash extends ModHash {
  /** Lines of each kind. */
  files: number;
  plugins: number;
  firegraft: number;
  /** The game files that could not be read (by game name): left out, as the play page leaves them. */
  unreadable: string[];
  /** The hash over the game files alone: what `scmjs` called a mod's data set before the plugins and the project had lines. */
  gameFilesOnly: string;
}

/** The mod's hash, its hash without plugins, and what went into them. */
export async function sourceHash(source: ModSource): Promise<SourceHash> {
  const files: Digest[] = [], plugins: Digest[] = [], firegraft: Digest[] = [], unreadable: string[] = [];
  for (const [name, f] of source.files) {
    let bytes: Uint8Array;
    try { bytes = await f.read(); } catch { unreadable.push(name); continue; }
    files.push({ name, sha256: await fileDigest(bytes) });
  }
  // (A plugin inside the mod's archive is not loaded by the play page, so it is not a line; one carried as a file is.)
  for (const p of source.plugins) if (!p.member) plugins.push({ name: p.name, sha256: await fileDigest(await p.read()) });
  for (const p of source.firegraft) if (/\.fgp$/i.test(p.name)) firegraft.push({ name: p.name, sha256: await fileDigest(await p.read()) });
  const hash = await modHashOfDigests({ files, plugins, firegraft });
  const onlyGame = await modHashOfDigests({ files });
  return { ...hash, files: files.length, plugins: hash.pluginLines.length, firegraft: hash.lines.length - files.length, unreadable, gameFilesOnly: onlyGame.hash };
}
