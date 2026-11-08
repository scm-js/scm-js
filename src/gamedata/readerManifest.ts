/**
 * `unit/manifest.json` for a data set that is a function in memory (`source.ts`, `reader`
 * sources): the copy underneath's manifest, with what the reader's own files change about
 * it worked out by asking the reader, so a plugin need not write one. Two things in it
 * depend on the files rather than on the extraction's walk:
 *
 *   - `datex`: a table the reader has as GPTP's `.datex` (a whole number of entries) is read
 *     as one, and one it has as `.dat` no longer is — the extraction's own rule
 *     (`extract.ts#datexOf`: the `.datex` wins when there are both);
 *   - `optional`: the unit names and command card pictures (`UNIT_EXTRA_FILES`) the reader
 *     brings are listed, so the loaders ask for them.
 *
 * The rest (`grps`, `images`, `hd`) is the copy's: the loaders fetch a picture by its path
 * whatever the list says, and a reader set draws no Remastered sprites.
 *
 * Loaded on demand by `source.ts`, only when a reader is attached.
 */
import { assetPath, DATEX_TABLES, UNIT_EXTRA_FILES, type UnitManifest } from "./extract";
import { datShape } from "../formats/dat/table";

/** Asks the reader for one file by its stored path; null when it leaves the file to the set underneath. */
export type AskReader = (path: string) => Promise<Uint8Array | null | undefined>;

/**
 * The manifest a reader set is drawn with: `base` (the copy underneath's, null when it has
 * none) with `datex` and `optional` as the reader's files make them.
 */
export async function readerUnitManifest(base: Partial<UnitManifest> | null, ask: AskReader): Promise<Partial<UnitManifest>> {
  const out: Partial<UnitManifest> = { ...base };
  const datex = new Set(Array.isArray(base?.datex) ? base.datex : []);
  const optional = new Set(Array.isArray(base?.optional) ? base.optional : []);
  await Promise.all(DATEX_TABLES.map(async (table) => {
    const extended = await ask(`arr/${table}.datex`).catch(() => null);
    if (extended && extended.length > 0 && datShape(table, extended.length, `${table}.datex`)) { datex.add(table); return; }
    const plain = await ask(`arr/${table}.dat`).catch(() => null);
    if (plain && plain.length > 0) datex.delete(table);
  }));
  await Promise.all(UNIT_EXTRA_FILES.map(async (member) => {
    const path = assetPath(member);
    const data = await ask(path).catch(() => null);
    if (data && data.length > 0) optional.add(path);
  }));
  if (datex.size > 0) out.datex = [...datex].sort();
  else delete out.datex;
  if (optional.size > 0) out.optional = [...optional].sort();
  else delete out.optional;
  return out;
}

/** The manifest's bytes from the copy's, parsed leniently (a copy without one, or a broken one, is `null`). */
export function parseManifest(bytes: Uint8Array | null): Partial<UnitManifest> | null {
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<UnitManifest>) : null;
  } catch {
    return null;
  }
}
