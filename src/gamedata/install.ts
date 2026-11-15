/**
 * Main-thread side of installing game data into the browser: hand the archives to the
 * extraction worker, relay its progress, keep the files in memory when it could not
 * store them. Two ways in, and they are the two the Game Data dialog offers: Blizzard's own
 * StarEdit package, read member by member out of the zip (`installFromZipUrl`), or the two
 * archives the user picked off their own disk (`installFromFiles`).
 *
 * A third is a *data set* of its own (`profiles.ts`): the same extraction over the game's
 * archives plus a mod laid over them (`installDataSet`), stored under the set's id rather
 * than as the game's own. What the mod is — its layers, which of its files win, its code
 * and its hash — is read in the worker by `@scm-js/mod` (`readMod`); here the game's own
 * archives are told from the mod's, and a picked folder becomes the mod's files.
 *
 * And a StarCraft: Remastered installation (`installFromRemastered`), which has no archives
 * to pick: its folder is handed to the worker and read there (`remastered.ts`).
 */
import { isGameArchive, isMemberPath, sortArchives } from "./archives";
import type { ExtractRequest, ExtractResponse } from "./extract.worker";
import { DEFAULT_PROFILE, isDefaultProfile, isProfileId, normalizeProfile, type GameDataProfile } from "./profiles";
import { BUILD_INFO, installRootOf, type PickedFile } from "./remasteredFolder";
import { forgetStoredFolders, keepInMemory, storedCopy, type StoredCopy } from "./store";
import { currentAssetSource } from "./source";
import { findMembers, httpRangeReader, readZipDirectory, readZipMember, ZipError } from "./zip";
import { t, translate } from "../i18n";
import type { ModMessage } from "@scm-js/mod";

export { isMemberPath };

export type InstallProgress = (fraction: number, label: string) => void;

export const ARCHIVE_NAMES = ["StarDat.mpq", "BrooDat.mpq"] as const;
/** The patch an installation lays over those two, and Blizzard's download carries beside them. */
const PATCH_NAME = "patch_rt.mpq";

/**
 * Blizzard's own standalone StarEdit package, which carries both archives and is offered
 * free. It is fetched through a forwarder (`github.com/scm-js/cloudflare-blizzard-forwarder`)
 * for the one reason a browser cannot go to Blizzard directly: `download.blizzard.com`
 * answers with a certificate for `*.cloudfront.net`, plain HTTP is mixed content on an
 * HTTPS page, and no route there sends `Access-Control-Allow-Origin`. The desktop build
 * uses the same address: its renderer is an ordinary page under `app://scmjs/` and enforces
 * CORS like any other, so going to Blizzard directly there would mean a download in the main
 * process and an IPC channel to carry it — for a route the disk search already covers.
 *
 * The archives inside are the trimmed StarEdit distribution, not the game's own, which
 * matters only in that they are enough. The `patch_rt.mpq` that rides beside them is laid
 * over them as an installation's is: StarDat and BrooDat alone hold the tables from before
 * the game's last balance patch (`units.dat`, `weapons.dat`, `flingy.dat`, `techdata.dat`,
 * `upgrades.dat`, `stat_txt.tbl`, `aiscript.bin`), and with it every file the game reads is
 * a 1.16.1 installation's, byte for byte — the sounds included. (Measured 2026-10-15; only
 * the fonts differ, which nothing here reads.)
 */
export const BLIZZARD_ZIP_URL = "https://gamedata.scmjs.dev/StarEdit.zip";

export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/** The game's archives among a pick or a dropped folder, or an `InstallError` naming what is missing. */
export function pickArchives(files: readonly File[]): File[] {
  const archives = sortArchives(files.filter((f) => isGameArchive(f.name)));
  const names = archives.map((f) => f.name.toLowerCase());
  const missing = ARCHIVE_NAMES.filter((n) => !names.includes(n.toLowerCase()));
  if (missing.length > 0) {
    throw new InstallError(
      archives.length === 0
        ? t("No StarCraft archives among the files picked. The editor needs {first} and {second}.", { first: ARCHIVE_NAMES[0], second: ARCHIVE_NAMES[1] })
        : t("{names} missing — the editor needs both archives.", { names: missing.join(", ") }),
    );
  }
  return archives;
}

/** 1.16.1's language module as an installation's folder names it; Windows matches the name in any case. */
const LANGUAGE_FILE = "local.dll";

/**
 * 1.16.1's language module (`Local.dll`, beside `StarCraft.exe`) among a folder's files, the
 * shallowest when there are several; undefined when the pick has none — a Remastered folder, the
 * archives picked by themselves, a trimmed copy. The name is matched whole, in any case
 * (`EditLocal.dll`, StarEdit's, is another file), as the play page picks it from a folder of its own.
 */
export function pickLanguageModule(files: readonly File[]): File | undefined {
  const depth = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).split(/[\\/]/).length;
  return files.filter((f) => f.name.toLowerCase() === LANGUAGE_FILE).sort((a, b) => depth(a) - depth(b))[0];
}

/**
 * Extract from the archives and store the result as the game's own data. Resolves with the copy's stamp.
 * A folder's `Local.dll` goes with them, for the play page (`play.ts#PLAY_LANGUAGE`).
 */
export async function installFromFiles(files: readonly File[], progress?: InstallProgress): Promise<StoredCopy> {
  const archives = pickArchives(files);
  progress?.(0, t("Reading the archives"));
  const inputs: ExtractRequest["archives"] = [];
  for (const file of archives) inputs.push({ name: file.name, bytes: await file.arrayBuffer() });
  const language = await pickLanguageModule(files)?.arrayBuffer().catch(() => undefined);
  return runWorker(inputs, archives.map((f) => f.name).join(" + "), progress, undefined, undefined, false, undefined, undefined, language);
}

/* ── Data sets ──────────────────────────────────────────── */

/** Bytes for the worker: a `File` / `Blob`, or already an array. */
export type InstallBytes = Blob | Uint8Array;

/** What a data set is made of. */
export interface GameDataFiles {
  /**
   * The archives, `StarDat.mpq` and `BrooDat.mpq` among them (a mod replaces files, it
   * does not bring the rest). The game's own (`isGameArchive`) are read first; any other is
   * the mod's, read with its loose files and its code as one mod (`@scm-js/mod`), each
   * archive at the priority its loader gives it.
   */
  archives: readonly { name: string; data: InstallBytes }[];
  /** Loose files by member path (`arr/units.dat`, `unit/terran/marine.grp`): the mod's, over every archive. */
  files?: readonly { path: string; data: InstallBytes }[];
  /** The plugins (`.qdp`, `.bwl`), the libraries they load (`.dll`) and FireGraft files the mod carries: never run, only part of its hash. */
  code?: readonly { path: string; data: InstallBytes }[];
  /**
   * A mod as it was picked, in its own folder's layout (`pickedDataSet`): every file with its path from the folder's
   * parent. Read as the mod instead of `files` and `code`, where the game's paths start found as `@scm-js/mod` finds them.
   */
  picked?: { name: string; files: readonly { path: string; data: InstallBytes }[] };
  /**
   * Lay the files over the copy of this data set (an id; the game's own is `starcraft`)
   * instead of over the game's archives, which are then not needed. Where the game's own
   * files are this build's rather than a copy (a clone that extracted them), those are used.
   */
  base?: string;
}

const bytesOf = async (data: InstallBytes): Promise<ArrayBuffer> =>
  data instanceof Uint8Array ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer) : await data.arrayBuffer();

/**
 * Extract a data set and store it under its id. The game's own archives must be among
 * `input.archives` (the same rule as `pickArchives`) unless `input.base` names a copy to lay
 * the files over instead; the mod is laid over them as its loader lays it, and its hash is
 * `@scm-js/mod`'s. Installing under the default id is `installFromFiles` with extras.
 */
export async function installDataSet(profile: GameDataProfile, input: GameDataFiles, progress?: InstallProgress): Promise<StoredCopy> {
  const normalized = normalizeProfile(profile);
  if (!normalized) throw new InstallError(t("\"{id}\" is not a usable data set id: lower-case letters, digits and hyphens, up to 40 characters.", { id: profile.id }));
  const base = input.base !== undefined ? await baseOf(input.base) : undefined;
  const games = input.archives.filter((a) => isGameArchive(a.name));
  if (!base) pickArchives(games.map((a) => new File([], a.name))); // throws naming what is missing
  progress?.(0, t("Reading the archives"));
  const archives: ExtractRequest["archives"] = [];
  for (const a of sortArchives([...games])) archives.push({ name: a.name, bytes: await bytesOf(a.data) });
  // (the mod's side, `@scm-js/mod` among it, is loaded when a data set is installed: not on the editor's start)
  const { dataSetMod } = await import("./modInput");
  const mod = dataSetMod(normalized.name || normalized.id, input);
  const from = [...archives.map((a) => a.name), ...(mod ? [mod.name] : [])].join(" + ");
  return runWorker(archives, from, progress, isDefaultProfile(normalized.id) ? undefined : normalized, undefined, false, base, mod);
}

/**
 * The copy a data set is laid over, as the worker reads it: a stored copy by its id, or —
 * for the game's own data where this build serves it — the build's address. Throws when
 * there is nothing to lay the files over.
 */
async function baseOf(id: string): Promise<NonNullable<ExtractRequest["base"]>> {
  if (!isProfileId(id)) throw new InstallError(t("\"{id}\" is not a data set id.", { id }));
  const copy = await storedCopy(id);
  if (copy?.where === "opfs") {
    // A copy made before the play set holds only the pictures its own units reach.
    if ((copy.play?.version ?? 0) < 2) console.warn(`game data: the "${id}" copy has no play set, so pictures only a new unit type uses may be missing`);
    return { profile: id };
  }
  if (copy?.where === "memory") throw new InstallError(t("The \"{id}\" data set is held for this session only, so nothing can be laid over it.", { id }));
  const source = currentAssetSource();
  if (isDefaultProfile(id) && source?.kind === "bundled" && source.base) return { url: new URL(source.base, location.href).href };
  throw new InstallError(t("There is no copy of the \"{id}\" data set to lay these files over.", { id }));
}

/**
 * Install from a zip that carries the two archives, without downloading the rest of it:
 * the zip's directory says where each member's bytes are, so only those are fetched and
 * inflated (83 MB of Blizzard's 101 MB package). The server has to answer range requests,
 * which is the forwarder's whole job.
 */
export async function installFromZipUrl(url: string, progress?: InstallProgress): Promise<StoredCopy> {
  progress?.(0, t("Reading the download"));
  const entries = await readZipDirectory(httpRangeReader(url)).catch((err) => {
    throw new InstallError(err instanceof ZipError ? err.message : t("{url} could not be read ({reason}).", { url, reason: err instanceof Error ? err.message : String(err) }));
  });

  const { found, missing } = findMembers(entries, ARCHIVE_NAMES);
  if (missing.length > 0) throw new InstallError(t("{url} does not carry {names}.", { url, names: missing.join(", ") }));

  // The download is the first half of the bar and the extraction the second, as an install
  // from loose archives has it; within the download, each member is weighted by its size.
  const patch = findMembers(entries, [PATCH_NAME]).found.get(PATCH_NAME);
  const wanted = [...ARCHIVE_NAMES.map((name) => ({ name, entry: found.get(name)! })), ...(patch ? [{ name: PATCH_NAME, entry: patch }] : [])];
  const total = wanted.reduce((n, w) => n + w.entry.compressedSize, 0);
  let doneBytes = 0;

  const inputs: ExtractRequest["archives"] = [];
  for (const { name, entry } of wanted) {
    const reader = httpRangeReader(url, {
      onProgress: (received) => progress?.(((doneBytes + received) / total) * 0.5, t("Downloading {name}", { name })),
    });
    const bytes = await readZipMember(reader, entry).catch((err) => {
      throw new InstallError(err instanceof ZipError ? err.message : t("{name} could not be read from {url} ({reason}).", { name, url, reason: err instanceof Error ? err.message : String(err) }));
    });
    doneBytes += entry.compressedSize;
    inputs.push({ name, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  }

  return runWorker(inputs, url, (f, label) => progress?.(0.5 + f * 0.5, label));
}

/* ── StarCraft: Remastered ──────────────────────────────── */

/** A Remastered installation as the user handed it over: the folder, or (no folder picker here) the files in it. */
export type RemasteredFolder = FileSystemDirectoryHandle | readonly File[];
/**
 * What a copy from Remastered may keep beyond the usual. `lighting`: the layers of its
 * sprites the play page's real-time lighting reads, about 200 MB more — left out unless
 * asked for, the editor drawing with none of them.
 */
export interface RemasteredOptions { lighting?: boolean }

/** Whether a picked folder is an installation the launcher made — it has `.build.info` at the top. */
export async function isRemasteredFolder(folder: RemasteredFolder): Promise<boolean> {
  if (Array.isArray(folder)) return installRootOf(pickedPaths(folder)) !== null;
  try {
    await (folder as FileSystemDirectoryHandle).getFileHandle(BUILD_INFO);
    return true;
  } catch {
    return false;
  }
}

const pickedPaths = (files: readonly File[]) => files.map((f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name);

/**
 * Extract from a StarCraft: Remastered installation and store the result — as the game's
 * own data, or under `profile` as a data set beside it. Nothing is copied but the files
 * the extraction asks for: the folder is read in place, a range at a time.
 */
export function installFromRemastered(folder: RemasteredFolder, progress?: InstallProgress, profile?: GameDataProfile, options: RemasteredOptions = {}): Promise<StoredCopy> {
  if (Array.isArray(folder)) {
    const paths = pickedPaths(folder);
    return installFromPickedRemastered((folder as readonly File[]).map((file, i) => ({ path: paths[i], file })), progress, profile, options);
  }
  progress?.(0, t("Opening the installation"));
  return runWorker([], "StarCraft: Remastered", progress, profile && !isDefaultProfile(profile.id) ? profile : undefined, folder as FileSystemDirectoryHandle, options.lighting);
}

/**
 * The same from a folder pick given as paths and files. A `File` loses its path in the
 * folder when it is handed from one page to another, so a page that picked the folder
 * elsewhere (`pages/install.ts`) sends the two side by side.
 */
export function installFromPickedRemastered(files: readonly PickedFile[], progress?: InstallProgress, profile?: GameDataProfile, options: RemasteredOptions = {}): Promise<StoredCopy> {
  // Only the storage itself goes to the worker: the folder's other files are of no use to it.
  const root = installRootOf(files.map((f) => f.path));
  if (root === null) return Promise.reject(new InstallError(t("That folder is not a StarCraft: Remastered installation.")));
  const picked: PickedFile[] = [];
  for (const { path, file } of files) {
    const rel = path.replaceAll("\\", "/");
    if (rel === root + BUILD_INFO || rel.startsWith(`${root}Data/`)) picked.push({ path: rel, file });
  }
  progress?.(0, t("Opening the installation"));
  return runWorker([], "StarCraft: Remastered", progress, profile && !isDefaultProfile(profile.id) ? profile : undefined, picked, options.lighting);
}

/**
 * A sentence `@scm-js/mod` handed over (the worker posts it as it is), in the reader's language: loaded when one comes.
 * A translation shows an archive's `reason` (a sentence of the package's) where the English shows `why` (the archive
 * library's text); a message without a `reason` has its `why` stand in.
 */
const modText = async (m: ModMessage) => (await import("@scm-js/mod")).renderMessage(m, (template, params) => translate(template, "why" in params && !("reason" in params) ? { ...params, reason: params.why } : params));

function runWorker(
  archives: ExtractRequest["archives"],
  from: string,
  progress?: InstallProgress,
  profile?: GameDataProfile,
  remastered?: ExtractRequest["remastered"],
  lighting = false,
  base?: ExtractRequest["base"],
  mod?: ExtractRequest["mod"],
  language?: ArrayBuffer,
): Promise<StoredCopy> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./extract.worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(new InstallError(t("The extraction worker could not start: {reason}", { reason: err instanceof Error ? err.message : String(err) })));
      return;
    }
    worker.onerror = (e) => {
      worker.terminate();
      reject(new InstallError(e.message || t("The extraction failed.")));
    };
    // The worker's words are English (its module instance has no locale) with their templates beside them.
    worker.onmessage = (e: MessageEvent<ExtractResponse>) => {
      const reply = e.data;
      if (reply.kind === "progress") {
        if (reply.mod) void modText(reply.mod).then((label) => progress?.(reply.fraction, label));
        else progress?.(reply.fraction, reply.message ? translate(reply.message.text, reply.message.params) : reply.label);
        return;
      }
      worker.terminate();
      if (reply.kind === "error") {
        if (reply.mod) void modText(reply.mod).then((text) => reject(new InstallError(text)), () => reject(new InstallError(reply.message)));
        else reject(new InstallError(reply.text ? translate(reply.text.text, reply.text.params) : reply.message));
        return;
      }
      for (const p of reply.problems) console.warn("game data:", p);
      forgetStoredFolders();
      if (reply.where === "memory") {
        keepInMemory(new Map((reply.files ?? []).map(([path, buf]) => [path, new Uint8Array(buf)])), reply.stamp, profile?.id ?? DEFAULT_PROFILE.id);
      }
      resolve({ ...reply.stamp, where: reply.where });
    };
    const req: ExtractRequest = { kind: "extract", archives, from, profile, ...(remastered ? { remastered } : {}), ...(lighting ? { lighting } : {}), ...(base ? { base } : {}), ...(mod ? { mod } : {}), ...(language ? { language } : {}) };
    worker.postMessage(req, [...archives.map((a) => a.bytes), ...(language ? [language] : [])]);
  });
}
