/**
 * A data set laid over a copy the browser already keeps, instead of over the game's
 * archives (`install.ts#installDataSet` with `base`). The mod's own files — loose files by
 * member path and any archives of its own — answer first; every member they do not have is
 * read from the copy underneath, which holds the game's files in the extracted layout
 * (`extract.ts`): mostly the member's path in lower case, a few tileset files renamed.
 *
 * Reading the copy is asynchronous and the extraction's `ReadMember` is not, so the
 * extraction is run until it asks for nothing new, as the Remastered reader does
 * (`remastered.ts`): each pass answers from what has been read, the misses are read, and
 * it goes again. A copy made with the play set (version 2 or later) has every picture
 * images.dat names; an older one has only what its own units reach, and a mod's new unit
 * drawn with a picture the game itself never shows in the editor is then missing.
 *
 * Also here, because it is decided at install and kept in the stamp: which images must be
 * drawn from their GRP even with Remastered's 2x sprites on (`hdOffImages`) — the ones
 * whose picture or images.dat row the data set changed, since the 2x sprite on file is of
 * the image as the copy underneath had it.
 *
 * Worker-side and dependency-light on purpose: no editor modules, and its words in English
 * with their templates beside them (`extract.ts#ExtractText`), translated where shown.
 */
import type { Params } from "../i18n";
import { storedPathOf } from "./paths.ts";
import { decodeDat, type DatFile } from "../formats/dat/table.ts";
import { DAT_SCHEMAS } from "../formats/dat/schema.ts";
import { dataSetHashOfDigests, fileDigest, gameName } from "../formats/mod/sources.ts";
import {
  DATEX_TABLES, EXTRA_TABLES, extractGameData, ExtractError, ICON_FILES, reportStep, SOUND_TABLES, UNIT_EXTRA_FILES, UNIT_TABLES,
  type ExtractProgress, type GameDataExtraction, type ReadMember,
} from "./extract.ts";

/** Marks a template for the catalogue (`i18n#msg`, which a worker-side module does not import; `install.ts#runWorker` translates it). */
const msg = (text: string) => text;

/** Reads one file of the copy underneath, by its path in the copy (`arr/units.dat`); null when it has none. */
export type CopyReader = (path: string) => Promise<Uint8Array | null>;

/** A member path as the overlay keys it: lower case, backslashes. */
const key = (member: string) => member.replaceAll("/", "\\").replace(/^\\+/, "").toLowerCase();

/**
 * Where the extraction stores a member in a copy (`paths.ts`), here because the worker and
 * the tests have always imported it from this module.
 */
export { storedPathOf };

export interface OverCopyExtraction {
  result: GameDataExtraction;
  /** The members the copy underneath answered (keys as `storedPathOf` takes them), for `hdOffImages`. */
  fromCopy: Set<string>;
}

/** How many files are read from the copy at once. */
const BATCH = 32;
/** Tables, then the graphics they lead to, then nothing: three passes; this is the stop. */
const MAX_PASSES = 8;

/**
 * The extraction over `top` (the data set's own files; null for a member it does not
 * have) laid over a copy read through `copy`.
 */
export async function extractOverCopy(top: ReadMember, copy: CopyReader, progress?: ExtractProgress): Promise<OverCopyExtraction> {
  const have = new Map<string, Uint8Array | null>();
  const fromCopy = new Set<string>();
  const read: (asked: Set<string>) => ReadMember = (asked) => (member) => {
    const own = top(member);
    if (own) return own;
    const k = key(member);
    if (!have.has(k)) { asked.add(member); return null; }
    return have.get(k) ?? null;
  };
  // The unit half stops at the first table it lacks, which would cost a pass a table: they are asked for up front.
  let first: string[] | null = [...UNIT_TABLES, ...EXTRA_TABLES, ...SOUND_TABLES, ...ICON_FILES, ...UNIT_EXTRA_FILES, ...DATEX_TABLES.map((t) => `arr\\${t}.datex`)].filter((m) => !top(m));
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const asked = new Set<string>(first ?? []);
    if (!first) {
      try {
        extractGameData(read(asked));
      } catch (err) {
        // A table is missing for good once nothing more can be read; until then it is only not read yet.
        if (!(err instanceof ExtractError) || asked.size === 0) throw err;
      }
    }
    first = null;
    if (asked.size === 0) break;
    const wanted = [...asked];
    for (let i = 0; i < wanted.length; i += BATCH) {
      await Promise.all(wanted.slice(i, i + BATCH).map(async (member) => {
        const data = await copy(storedPathOf(member)).catch(() => null);
        have.set(key(member), data);
        if (data) fromCopy.add(key(member));
      }));
      const counts: Params = { done: Math.min(i + BATCH, wanted.length), total: wanted.length };
      reportStep(progress, (Math.min(pass, 2) / 3 + (Math.min(i + BATCH, wanted.length) / wanted.length) / 3) * 0.8, msg("Reading the copy underneath · {done} of {total}"), counts);
    }
  }
  const result = extractGameData(read(new Set()), (f, label, m) => progress?.(0.8 + f * 0.2, label, m));
  return { result, fromCopy };
}

/** images.dat as a copy stores it (`.dat` or `.datex`, as its manifest says), or null. */
async function copyImagesDat(copy: CopyReader): Promise<DatFile | null> {
  const manifest = await copy("unit/manifest.json").then((d) => (d ? JSON.parse(new TextDecoder().decode(d)) as { datex?: string[] } : null)).catch(() => null);
  const name = manifest?.datex?.includes("images") ? "images.datex" : "images.dat";
  const data = await copy(`arr/${name}`);
  if (!data) return null;
  try {
    return decodeDat("images", data, { fileName: name });
  } catch {
    return null;
  }
}

function tblStrings(tbl: Uint8Array | null | undefined): string[] {
  if (!tbl || tbl.length < 2) return [];
  const count = tbl[0] | (tbl[1] << 8);
  const latin1 = new TextDecoder("latin1");
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = tbl[2 + i * 2] | (tbl[3 + i * 2] << 8);
    let end = at;
    while (end < tbl.length && tbl[end] !== 0) end++;
    out.push(latin1.decode(tbl.subarray(at, end)).toLowerCase().replaceAll("\\", "/"));
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The images among those with a 2x sprite in the new copy (`result.units.manifest.hd`)
 * whose picture the data set changed against the copy underneath: a row of images.dat
 * that differs (or is new), or a GRP the data set's own files answered with other bytes
 * than the copy has. Those draw from their GRP whatever View ▸ Remastered Graphics says.
 */
export async function hdOffImages(over: OverCopyExtraction, copy: CopyReader): Promise<number[]> {
  const hd = over.result.units.manifest.hd ?? [];
  if (hd.length === 0) return [];
  const files = over.result.files;
  const datex = over.result.units.manifest.datex?.includes("images");
  const imagesName = datex ? "images.datex" : "images.dat";
  const now = decodeDat("images", files.get(`arr/${imagesName}`)!, { fileName: imagesName });
  const before = await copyImagesDat(copy);
  const tblNow = tblStrings(files.get("arr/images.tbl"));
  const fields = DAT_SCHEMAS.images.fields.map((f) => f.name);
  const changedGrp = new Map<string, boolean>();
  const grpChanged = async (path: string): Promise<boolean> => {
    const k = key(`unit/${path}`);
    if (over.fromCopy.has(k)) return false;
    let known = changedGrp.get(k);
    if (known === undefined) {
      const mine = files.get(`unit/${path}`);
      const theirs = await copy(`unit/${path}`).catch(() => null);
      known = !mine || !theirs || !sameBytes(mine, theirs);
      changedGrp.set(k, known);
    }
    return known;
  };
  const off: number[] = [];
  for (const image of hd) {
    if (!before || image >= before.count || fields.some((f) => now.columns[f][image] !== before.columns[f][image])) { off.push(image); continue; }
    const path = tblNow[now.columns.grp_file[image] - 1];
    if (path && (await grpChanged(path))) off.push(image);
  }
  return off;
}

/** A member by the game's name (any case or slash), or null; sync or not. */
export type MemberBytes = (member: string) => Uint8Array | null | Promise<Uint8Array | null>;

/**
 * The data set's hash: core's `dataSetHash` — the one `scmjs mod play` hands the play page —
 * over the set's own files that differ from the base's. `names` are the members the set may
 * have (its loose files, its archives' listed members, what the extraction asked for);
 * `own` answers from the set's own files only, `base` from what they are laid over (the
 * game's archives, or the copy underneath and, where that lacks a file, the game's
 * archives when they are at hand). A file the base has byte for byte is not part of the mod
 * and not hashed; a file the base lacks is, and is listed in `unbased` (sorted): counted as
 * the set's own for want of anything to compare it with. Files are read and digested one
 * at a time. `hash` is null when nothing differs.
 */
export async function changedFiles(names: Iterable<string>, own: MemberBytes, base: MemberBytes): Promise<{ hash: string | null; unbased: string[] }> {
  const digests: { name: string; sha256: string }[] = [];
  const unbased: string[] = [];
  for (const name of new Set([...names].map(gameName))) {
    const mine = await own(name);
    if (!mine) continue;
    const theirs = await Promise.resolve(base(name)).catch(() => null);
    if (theirs && sameBytes(mine, theirs)) continue;
    if (!theirs) unbased.push(name);
    digests.push({ name, sha256: await fileDigest(mine) });
  }
  unbased.sort();
  return { hash: digests.length > 0 ? await dataSetHashOfDigests(digests) : null, unbased };
}

/** `changedFiles`' hash alone. */
export async function changedFilesHash(names: Iterable<string>, own: MemberBytes, base: MemberBytes): Promise<string | null> {
  return (await changedFiles(names, own, base)).hash;
}

/**
 * Bases read in turn: the first that has a member answers. How the hash looks past a copy
 * that lacks a file (a copy laid over another keeps only the editor's files) to the copy
 * under that, then to the game's archives when the install was handed them.
 */
export function firstOf(...bases: (MemberBytes | null | undefined)[]): MemberBytes {
  const list = bases.filter((b): b is MemberBytes => !!b);
  return async (name) => {
    for (const b of list) {
      const got = await Promise.resolve(b(name)).catch(() => null);
      if (got) return got;
    }
    return null;
  };
}
