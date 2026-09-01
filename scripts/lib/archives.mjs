/**
 * Shared helpers for the extraction scripts: find the StarCraft MPQs (in fixtures/data/,
 * an explicit --from directory, $SCM_DATA_DIR, or a normal install) and read a file from
 * whichever archive has it last.
 */
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Archive } from "mopaq";

export const root = resolve(import.meta.dirname, "..", "..");

/** Environment variables that may point at a directory holding the archives. */
const ENV_DIRS = ["SCM_DATA_DIR", "STARCRAFT_DIR"];

/** The archives an install is expected to hold, in the order the game applies them. */
const KNOWN = /^(stardat|broodat|patch_rt)\.mpq$/i;

/** StarDat.mpq first, BrooDat.mpq second, anything else (patch_rt.mpq…) after — later archives win. */
const order = (n) => (/^stardat/i.test(n) ? 0 : /^broodat/i.test(n) ? 1 : 2);

/**
 * Directories searched for the archives, in priority order: the environment, the
 * project's own fixtures/data/, then the usual install locations for this platform
 * (including the Windows drives a WSL session sees under /mnt).
 */
export function searchDirs() {
  const dirs = [];
  for (const name of ENV_DIRS) if (process.env[name]) dirs.push(resolve(process.env[name]));
  dirs.push(join(root, "fixtures", "data"));
  if (process.platform === "win32") {
    dirs.push("C:\\Program Files (x86)\\StarCraft", "C:\\Program Files\\StarCraft");
  } else if (process.platform === "darwin") {
    dirs.push("/Applications/StarCraft");
  }
  dirs.push(join(homedir(), "StarCraft"));
  for (const drive of ["c", "d"]) {
    dirs.push(`/mnt/${drive}/Program Files (x86)/StarCraft`, `/mnt/${drive}/Program Files/StarCraft`);
  }
  return dirs;
}

/**
 * The archives in one directory, ordered. `all` (used for fixtures/data/ and an explicit
 * --from, which the user curated) takes every .mpq; otherwise only the three the game
 * ships, so scanning an install does not drag in Music.mpq and friends.
 */
export function archivesIn(dir, { all = false } = {}) {
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => (all ? n.toLowerCase().endsWith(".mpq") : KNOWN.test(n)))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((n) => join(dir, n));
}

/** The first searched directory that has any archives, or [] when there are none. */
export function defaultArchives() {
  const fixtures = join(root, "fixtures", "data");
  for (const dir of searchDirs()) {
    const found = archivesIn(dir, { all: dir === fixtures });
    if (found.length > 0) return found;
  }
  return [];
}

/** The message printed when no archives turned up anywhere. */
export function noArchivesMessage() {
  return [
    "No StarCraft archives found. Put StarDat.mpq and BrooDat.mpq in fixtures/data/,",
    "pass --from <StarCraft install dir>, set $SCM_DATA_DIR, or pass archive paths directly.",
    "Searched:",
    ...searchDirs().map((d) => `  ${d}`),
  ].join("\n");
}

/**
 * Parse `--out <dir>`, `--from <dir>` and positional archive paths. Falls back to the
 * searched directories when no archives are given; exits with a message when there are none.
 */
export function parseArgs(argv, defaultOut) {
  const value = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outDir = resolve(root, value("--out") ?? defaultOut);
  const from = value("--from");
  const consumed = new Set();
  for (const flag of ["--out", "--from"]) {
    const i = argv.indexOf(flag);
    if (i >= 0) consumed.add(i + 1);
  }
  const explicit = argv.filter((a, i) => !a.startsWith("--") && !consumed.has(i)).map((p) => resolve(p));

  let archives = explicit;
  if (archives.length === 0 && from) {
    archives = archivesIn(resolve(from), { all: true });
    if (archives.length === 0) {
      console.error(`No .mpq files in ${resolve(from)}`);
      process.exit(1);
    }
  }
  if (archives.length === 0) archives = defaultArchives();
  if (archives.length === 0) {
    console.error(noArchivesMessage());
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
