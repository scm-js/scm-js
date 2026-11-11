/**
 * Opening a mod for the `mod` commands: what the person named, and the game's own files beside it when a copy of
 * StarCraft is here (the mod's files are laid over the game's, as the game reads them). A mod folder is packed in
 * memory first, so every command reads the same files `mod pack` would write.
 */
import { readFile, stat } from "node:fs/promises";
import { Archive } from "mopaq";
import { isMpq } from "../../../src/formats/mod/sources";
import { t } from "../i18n";
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

/** Whether `path` is a map file: a `.chk`, or an archive holding a scenario. */
async function isMapFile(path: string): Promise<boolean> {
  let bytes: Uint8Array;
  try { if (!(await stat(path)).isFile()) return false; bytes = new Uint8Array(await readFile(path)); } catch { return false; }
  if (/\.chk$/i.test(path) && !isMpq(bytes)) return true;
  if (!isMpq(bytes)) return false;
  try { return !!Archive.open(bytes).fileInfo("staredit\\scenario.chk"); } catch { return false; }
}

/**
 * `mod test <mod> <map>` with the two the wrong way round, or a folder where the map goes: said before anything is
 * read as what it is not.
 */
export async function checkModAndMap(mod: string, map: string): Promise<void> {
  if (await isMapFile(map)) return;
  if (await isMapFile(mod)) throw new CliError(t("{file} is a mod, not a map: the mod comes first.", { file: map }), "scmjs mod test <mod> <map>", 2);
  let dir = false;
  try { dir = (await stat(map)).isDirectory(); } catch { /* said where the map is read */ }
  if (dir) throw new CliError(t("{folder} is a folder, not a map.", { folder: map }), "scmjs mod test <mod> <map>", 2);
}
