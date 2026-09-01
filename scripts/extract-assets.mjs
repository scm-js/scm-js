#!/usr/bin/env node
/**
 * Extract everything the editor needs from a StarCraft installation into public/.
 *
 * The game data is Blizzard's and is not redistributable, so it is not in this repo —
 * a clone has to generate it once from archives you are entitled to use:
 *
 *     npm run extract                          # fixtures/data/, $SCM_DATA_DIR, or an install
 *     npm run extract -- --from "/mnt/c/Program Files (x86)/StarCraft"
 *     npm run extract -- path/to/StarDat.mpq path/to/BrooDat.mpq
 *
 * This is a front end for scripts/extract-tilesets.mjs and scripts/extract-units.mjs; run
 * either directly to redo just that half. `--check` reports what is on disk without
 * touching the archives (`--warn` downgrades a failed check to a warning, which is how
 * the predev/prebuild hooks use it).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultArchives, archivesIn, noArchivesMessage, root } from "./lib/archives.mjs";

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
/** Tables the unit renderer cannot start without; the GRPs themselves are listed in unit/manifest.json. */
const TABLES = ["arr/units.dat", "arr/weapons.dat", "arr/flingy.dat", "arr/sprites.dat", "arr/images.dat", "arr/images.tbl", "game/tunit.pcx", "scripts/iscript.bin"];

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const publicDir = join(root, "public");

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
};
/** MPQ member paths in the manifests keep the game's backslashes; the files on disk do not. */
const asset = (...parts) => join(publicDir, ...parts.map((p) => p.replaceAll("\\", "/")));

/** What is on disk: which tilesets rasterise, whether the unit tables and GRPs are there. */
function status() {
  const tilesets = readJson(asset("tileset", "manifest.json"));
  const units = readJson(asset("unit", "manifest.json"));
  const ready = tilesets ? TILESETS.filter((n) => tilesets[n]?.complete) : [];
  const tables = TABLES.filter((t) => existsSync(asset(t)));
  const grps = units ? units.grps.filter((p) => existsSync(asset("unit", p))) : [];
  return {
    tilesets: { ready, total: TILESETS.length },
    units: { tables: tables.length, grps: grps.length, want: units ? units.grps.length : 0 },
    complete: ready.length === TILESETS.length && tables.length === TABLES.length && units !== null && grps.length === units.grps.length,
  };
}

function report(s) {
  console.log(`Tilesets: ${s.tilesets.ready.length}/${s.tilesets.total} complete in public/tileset/`);
  console.log(`Units:    ${s.units.tables}/${TABLES.length} tables, ${s.units.grps}${s.units.want ? `/${s.units.want}` : ""} GRPs in public/`);
}

if (has("--check")) {
  const s = status();
  report(s);
  if (s.complete) {
    console.log("Game data is in place.");
  } else {
    const how = defaultArchives().length > 0 ? "Run `npm run extract` to generate it." : noArchivesMessage();
    console[has("--warn") ? "warn" : "error"](`Game data is incomplete — the editor will fall back to flat colours and marker units.\n${how}`);
    if (!has("--warn")) process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}

// Resolve the archives once here so both halves report the same source and a missing
// install fails before the first (slow) extraction rather than between the two.
const fromIndex = argv.indexOf("--from");
const from = fromIndex >= 0 ? argv[fromIndex + 1] : undefined;
const explicit = argv.filter((a, i) => !a.startsWith("--") && i !== fromIndex + 1);
let archives = explicit;
if (archives.length === 0 && from) {
  archives = archivesIn(from, { all: true });
  if (archives.length === 0) {
    console.error(`No .mpq files in ${from}`);
    process.exit(1);
  }
}
if (archives.length === 0) archives = defaultArchives();
if (archives.length === 0) {
  console.error(noArchivesMessage());
  process.exit(1);
}

console.log(`Extracting from:\n${archives.map((a) => `  ${a}`).join("\n")}\n`);
for (const script of ["extract-tilesets.mjs", "extract-units.mjs"]) {
  console.log(`--- ${script} ---`);
  const run = spawnSync(process.execPath, [join(root, "scripts", script), ...archives], { stdio: "inherit" });
  if (run.status !== 0) {
    console.error(`\n${script} failed (exit ${run.status}).`);
    process.exit(run.status ?? 1);
  }
  console.log();
}

const s = status();
report(s);
console.log(s.complete ? "Game data is in place." : "Game data is still incomplete; see the warnings above.");
process.exitCode = s.complete ? 0 : 1;
