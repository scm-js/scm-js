/**
 * Where the mod-format suites find their real files. Nothing here is committed: the game's archives are the person's
 * own (`fixtures/data/StarDat.mpq` + `BrooDat.mpq`), and a mod's files are read from wherever `SCMJS_COSMONARCHY`
 * points (the root of Cosmonarchy's public download: `release/mpq/…`, `gptp/…`, `cmbw-root-tree/…`). Without them the
 * suites that need them skip; CI has neither.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Archive } from "mopaq";
import { decodeTblFile } from "../../src/formats/dat/tblFile";

const root = resolve(import.meta.dirname, "../..");
const DATA = join(root, "fixtures/data");
export const haveGameArchives = existsSync(join(DATA, "StarDat.mpq")) && existsSync(join(DATA, "BrooDat.mpq"));

let archives: Archive[] | null = null;

/** A member of the game's archives (BrooDat over StarDat, as the game layers them), or null. */
export function gameFile(name: string): Uint8Array | null {
  archives ??= ["StarDat.mpq", "BrooDat.mpq"].map((n) => Archive.open(new Uint8Array(readFileSync(join(DATA, n)))));
  for (let i = archives.length - 1; i >= 0; i--) {
    try { return archives[i].readFile(name); } catch { /* not in this one */ }
  }
  return null;
}

/** Every `unit\…` path images.tbl names (the GRPs and `.lo?` files the game's images use). */
export function gameImagePaths(): string[] {
  const names = decodeTblFile(gameFile("arr\\images.tbl")!).strings.map((s) => s.replace(/\0+$/, ""));
  return [...new Set(names)].map((p) => `unit\\${p}`);
}

const cosmonarchyRoot = process.env.SCMJS_COSMONARCHY ?? "";
export const haveCosmonarchy = !!cosmonarchyRoot && existsSync(join(cosmonarchyRoot, "release/mpq/arr/units.datex"));

/** A file of the Cosmonarchy download, by its path under the download's root. */
export function cosmonarchyFile(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(cosmonarchyRoot, path)));
}

export function cosmonarchyPath(path: string): string {
  return join(cosmonarchyRoot, path);
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
