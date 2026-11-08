/**
 * Opening a mod for the `mod` commands: what the person named, and the game's own files beside it when a copy of
 * StarCraft is here (the mod's files are laid over the game's, as the game reads them). A mod folder is packed in
 * memory first, so every command reads the same files `mod pack` would write.
 */
import { findGameCopy } from "../engine";
import { archiveFiles, storageFiles, type GameFiles } from "../gamefiles";
import { CliError } from "../ui";
import { packFolder } from "./pack";
import { openModSource, type ModSource } from "./source";

/**
 * The copy of the game named (`--starcraft`, `SCMJS_STARCRAFT`), else the first in the usual places, else null: the
 * mod commands work without one and say what they could not look at.
 */
export async function gameFilesOrNull(named: string | undefined): Promise<GameFiles | null> {
  let copy: ReturnType<typeof findGameCopy>;
  try { copy = findGameCopy(named); } catch (e) { if (named) throw e; if (e instanceof CliError) return null; throw e; }
  return copy.kind === "remastered" ? storageFiles(copy.folder) : archiveFiles(copy.folder);
}

/** The mod at `path`, a mod folder packed in memory with the game's files at hand. */
export async function openMod(path: string, base: GameFiles | null): Promise<ModSource> {
  return openModSource(path, async (dir, manifest) => (await packFolder(dir, manifest, { base })).source);
}
