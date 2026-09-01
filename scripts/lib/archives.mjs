/**
 * Shared helpers for the extraction scripts: find the StarCraft MPQs in fixtures/data/
 * (or take explicit paths) and read a file from whichever archive has it last.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Archive } from "mopaq";

export const root = resolve(import.meta.dirname, "..", "..");

/** StarDat.mpq first, BrooDat.mpq second, anything else after — later archives win. */
export function defaultArchives() {
  const dir = join(root, "fixtures", "data");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const order = (n) => (/^stardat/i.test(n) ? 0 : /^broodat/i.test(n) ? 1 : 2);
  return names
    .filter((n) => n.toLowerCase().endsWith(".mpq"))
    .sort((a, b) => order(a) - order(b))
    .map((n) => join(dir, n));
}

/**
 * Parse `--out <dir>` plus positional archive paths. Falls back to fixtures/data/ when
 * no archives are given; exits with a message when there are none at all.
 */
export function parseArgs(argv, defaultOut) {
  const outIndex = argv.indexOf("--out");
  const outDir = resolve(root, outIndex >= 0 ? argv[outIndex + 1] : defaultOut);
  const explicit = argv.filter((a, i) => a !== "--out" && i !== outIndex + 1 && !a.startsWith("--"));
  const archives = explicit.length > 0 ? explicit.map((p) => resolve(p)) : defaultArchives();
  if (archives.length === 0) {
    console.error("No MPQ archives found. Put StarDat.mpq / BrooDat.mpq in fixtures/data/, or pass paths as arguments.");
    process.exit(1);
  }
  return { outDir, archives };
}

/** Open every archive that opens; problems are returned rather than thrown. */
export function openArchives(paths) {
  const archives = [];
  const problems = [];
  for (const path of paths) {
    try {
      archives.push({ path, archive: Archive.open(new Uint8Array(readFileSync(path))) });
    } catch (err) {
      problems.push(`${path}: ${err.message}`);
    }
  }
  return { archives, problems };
}

/** The member from the last archive that has it, or null. */
export function readMember(archives, member) {
  for (let i = archives.length - 1; i >= 0; i--) {
    try {
      return archives[i].archive.readFile(member);
    } catch {
      // absent in this archive, which is normal and expected
    }
  }
  return null;
}
