#!/usr/bin/env node
/**
 * Extract the unit data and graphics from a StarCraft install into public/.
 *
 *     node scripts/extract-units.mjs [--out public] [archive.mpq ...]
 *
 * Mirrors the part of the MPQ tree that leads from a unit type to its picture:
 *
 *   arr/units.dat, arr/flingy.dat, arr/sprites.dat, arr/images.dat, arr/images.tbl
 *   arr/weapons.dat, arr/upgrades.dat, arr/techdata.dat     defaults the settings dialogs show
 *   game/tunit.pcx                                          team colour rows
 *   scripts/iscript.bin                                     animation bytecode
 *   unit/**\/*.grp, unit/**\/*.lo?                           the graphics and overlay positions
 *
 * Which GRPs ship is decided by a reachability walk over the iscripts in
 * `src/gamedata/extract.ts` — the same code the browser and the desktop build run — so
 * this script only finds the archives, writes the files and reports. Brood War's archive is
 * required: its units.dat is the layout the decoder expects.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openArchives, parseArgs, readMember } from "./lib/archives.mjs";
// Node strips the types itself (v22.18+ / v23.6+); the module imports only iscript.ts for exactly this reason.
import { ExtractError, extractUnits } from "../src/gamedata/extract.ts";

const { outDir, archives: paths } = parseArgs(process.argv.slice(2), "public");
const { archives, problems } = openArchives(paths);

let result;
try {
  result = extractUnits((member) => readMember(archives, member));
} catch (err) {
  if (err instanceof ExtractError) {
    console.error(`${err.message} (archives: ${paths.join(", ")})`);
    process.exit(1);
  }
  throw err;
}
const { files, manifest } = result;

for (const [path, data] of files) {
  const target = join(outDir, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

console.log(`Read ${archives.length} archive(s):`);
for (const a of archives) console.log(`  ${a.path}`);
console.log(`Wrote ${files.size} file(s) to ${outDir} (${manifest.images.length} images → ${manifest.grps.length} GRPs, ${manifest.overlays.length} overlay files)`);
if (manifest.missing.length) console.log(`Missing: ${manifest.missing.join(", ")}`);
for (const p of problems) console.error(`warning: ${p}`);
process.exitCode = manifest.missing.length === 0 ? 0 : 1;
