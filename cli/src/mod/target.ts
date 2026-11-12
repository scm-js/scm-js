/**
 * The folder `mod unpack` and `mod new` write: a new one, an empty one, or — with `--force` — a mod folder written
 * before, replaced whole. A mod folder is the mod's source, edited by hand, so writing over one is never silent; and
 * nothing of the earlier folder survives into the new one but its dot files and folders (`.git`, `.gitignore`), which
 * are the person's, not the mod's.
 */
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { MOD_MANIFEST, readManifest, type ModManifest } from "../../../src/formats/mod/folder";
import { t } from "../i18n";
import { CliError } from "../ui";

export interface ModTarget {
  /** The folder, resolved. */
  out: string;
  /** The manifest of the mod folder replaced (`--force`), or null. */
  earlier: ModManifest | null;
}

/** Whether `inner` is `outer` or inside it. */
export const within = (inner: string, outer: string) => { const r = relative(resolve(outer), resolve(inner)); return r === "" || (!r.startsWith("..") && !r.startsWith("/") && !/^[a-z]:/i.test(r)); };

/**
 * Makes `dir` ready to write a mod folder in: made when it is not there (its parents too), taken as it is when empty,
 * and when it holds a mod folder already, refused unless `force`, which clears it. A file, or a folder holding
 * something else, is refused either way. `source` is the mod being read, which the folder must not hold.
 */
export async function modTarget(dir: string, o: { force?: boolean; source?: string } = {}): Promise<ModTarget> {
  const out = resolve(dir);
  let entries: string[] | null = null;
  try {
    const s = await stat(out);
    if (!s.isDirectory()) throw new CliError(t("{folder} is a file, not a folder.", { folder: dir }), t("Name a folder for the mod: a new one, or an empty one."), 2);
    entries = await readdir(out);
  } catch (e) {
    if (e instanceof CliError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOTDIR") throw new CliError(t("{folder} cannot be made: a file is in its path.", { folder: dir }), t("Name a folder for the mod: a new one, or an empty one."), 2);
    if (code !== "ENOENT") throw new CliError(t("{folder} could not be read ({code}).", { folder: dir, code: code ?? String(e) }), null, 2);
  }
  if (o.source && within(o.source, out) && entries !== null) throw new CliError(t("The mod is inside {folder}, the folder to write.", { folder: dir }), t("Name another folder."), 2);
  let earlier: ModManifest | null = null;
  if (entries?.length) {
    let text: string | null = null;
    try { text = await readFile(join(out, MOD_MANIFEST), "utf8"); } catch { text = null; }
    try { earlier = text === null ? null : readManifest(text); } catch { earlier = null; }
    if (!earlier) throw new CliError(t("{folder} is there and is not a mod folder.", { folder: dir }), t("Name a new folder, or an empty one."), 2);
    if (!o.force) throw new CliError(t("{folder} is a mod folder already: writing into it would replace what you changed there.", { folder: dir }), t("--force replaces it (its dot files, such as .git, are kept); name a new folder to keep both."), 2);
    for (const name of entries) if (!name.startsWith(".")) await rm(join(out, name), { recursive: true, force: true });
  }
  try { await mkdir(out, { recursive: true }); } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    throw new CliError(code === "ENOTDIR" || code === "EEXIST" ? t("{folder} cannot be made: a file is in its path.", { folder: dir }) : t("{folder} could not be made ({code}).", { folder: dir, code: code ?? String(e) }), null, 2);
  }
  return { out, earlier };
}
