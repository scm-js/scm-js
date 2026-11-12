/**
 * A data set's mod as the extraction's worker reads it: a picked folder told into the game's own archives and the mod
 * (`pickedDataSet`), and the mod's files for `ExtractRequest.mod` (`dataSetMod`). Kept apart from `install.ts`, which
 * is on the editor's start, so `@scm-js/mod` is loaded only when a data set is added or installed.
 */
import { gameCopyFiles, isModJsonPath, leafOf, readModJson, type DataSetRace } from "@scm-js/mod";
import { isGameArchive } from "./archives";
import type { ExtractRequest } from "./extract.worker";
import type { GameDataFiles, InstallBytes } from "./install";

const pathOf = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;

/**
 * A picked folder as a data set's files: the game's own archives where the folder holds a copy of the game (a folder
 * with `StarDat.mpq` in it), and everything picked as the mod, read in the worker by `@scm-js/mod` (which leaves that
 * copy out); and the races the folder's `mod.json` declares (`[]` for none, no such file, or one that is not JSON), by
 * the package's rule for which `mod.json` is the mod's (in the folder picked or one folder down). It is no game file
 * and does not change the set's hash.
 */
export async function pickedDataSet(files: readonly File[]): Promise<{ input: GameDataFiles; races: DataSetRace[] }> {
  const paths = files.map(pathOf);
  const copy = gameCopyFiles(paths);
  const archives = files.filter((f, i) => copy.has(paths[i]) && isGameArchive(f.name)).map((f) => ({ name: f.name, data: f as InstallBytes }));
  const first = (p: string) => (p.includes("/") ? p.slice(0, p.indexOf("/")) : "");
  const top = paths.length && paths.every((p) => first(p) && first(p) === first(paths[0])) ? first(paths[0]) : "";
  const json = files.map((f, i) => ({ f, path: paths[i] })).filter((x) => isModJsonPath(x.path, top)).sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0];
  let races: DataSetRace[] = [];
  if (json) { try { races = readModJson(await json.f.text())?.races ?? []; } catch { races = []; } }
  return { input: { archives, picked: { name: top || "mod", files: files.map((f, i) => ({ path: paths[i], data: f as InstallBytes })) } }, races };
}

const blobOf = (data: InstallBytes): Blob | ArrayBuffer => (data instanceof Blob ? data : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer));

/**
 * The mod of a data set as the worker reads it (`ExtractRequest.mod`): what was picked as it was picked, or the mod's
 * archives, loose files and code laid out in the game's paths — the archives at the top, each loose file at its member
 * path, a plugin or library under `plugins/`, a FireGraft file under `firegraft/`.
 */
export function dataSetMod(name: string, input: GameDataFiles): NonNullable<ExtractRequest["mod"]> | undefined {
  if (input.picked) return { name: input.picked.name, files: input.picked.files.map((f) => ({ path: f.path, data: blobOf(f.data) })) };
  const files: { path: string; data: Blob | ArrayBuffer }[] = [];
  for (const a of input.archives) if (!isGameArchive(a.name)) files.push({ path: leafOf(a.name), data: blobOf(a.data) });
  for (const f of input.files ?? []) files.push({ path: f.path.replaceAll("\\", "/").replace(/^\/+/, ""), data: blobOf(f.data) });
  for (const c of input.code ?? []) {
    const leaf = leafOf(c.path);
    files.push({ path: /\.(fgp|fgd)$/i.test(leaf) ? `firegraft/${leaf}` : `plugins/${leaf}`, data: blobOf(c.data) });
  }
  return files.length ? { name, files, layout: "game" } : undefined;
}

