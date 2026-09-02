#!/usr/bin/env node
/**
 * Extract tileset graphics from a StarCraft install into public/tileset/.
 *
 * Put StarDat.mpq (and BrooDat.mpq for the Brood War tilesets) in fixtures/data/, then:
 *
 *     node scripts/extract-tilesets.mjs [--out public/tileset] [extra.mpq ...]
 *
 * Later archives win, so BrooDat's copies override StarDat's. What comes out — the five
 * terrain files per tileset, the colour remap tables, the doodad placement table and the
 * shared `stat_txt.tbl` — is decided by `src/gamedata/extract.ts`, which the browser and
 * the desktop build run too; this script only finds the archives and writes the files.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openArchives, parseArgs, readMember } from "./lib/archives.mjs";
// Node strips the types itself (v22.18+ / v23.6+); the module imports only iscript.ts for exactly this reason.
import { extractTilesets } from "../src/gamedata/extract.ts";

const { outDir, archives: paths } = parseArgs(process.argv.slice(2), "public/tileset");
const { archives, problems } = openArchives(paths);

const { files, complete, incomplete } = extractTilesets((member) => readMember(archives, member));

for (const [path, data] of files) {
  // Paths come back under `tileset/`; this script's --out already names that directory.
  const target = join(outDir, path.replace(/^tileset\//, ""));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
}

console.log(`Read ${archives.length} archive(s):`);
for (const a of archives) console.log(`  ${a.path}`);
console.log(`Wrote ${files.size} file(s) to ${outDir}`);
console.log(`Complete tilesets: ${complete.join(", ") || "(none)"}`);
if (incomplete.length) console.log(`Incomplete: ${incomplete.join(", ")}`);
for (const p of problems) console.error(`warning: ${p}`);
process.exitCode = complete.length > 0 ? 0 : 1;
