#!/usr/bin/env node
/**
 * Extract tileset graphics from a StarCraft install into public/tileset/.
 *
 * Put StarDat.mpq (and BrooDat.mpq for the Brood War tilesets) in fixtures/data/, then:
 *
 *     node scripts/extract-tilesets.mjs [--out public/tileset] [extra.mpq ...]
 *
 * Later archives win, so BrooDat's copies override StarDat's. Besides the terrain files
 * this also copies each tileset's colour remap tables (`tileset\<name>\ofire.pcx` …) to
 * `<name>.ofire.pcx` etc. (the unit renderer draws fire and sparks through them), its
 * doodad placement table `tileset\<name>\dddata.bin` to `<name>.dddata.bin`, and the
 * shared `rez\stat_txt.tbl` (doodad category names) to `stat_txt.tbl`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openArchives, parseArgs, readMember } from "./lib/archives.mjs";

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const REQUIRED = ["cv5", "vf4", "vr4", "wpe"];
const OPTIONAL = ["vx4", "vx4ex"];
/** Effect remap tables, `tileset\<name>\<table>.pcx`, written as `<name>.<table>.pcx`. */
const REMAPS = ["ofire", "gfire", "bfire", "bexpl"];
/** Per-tileset files under `tileset\<name>\`, written as `<name>.<file>`. */
const SUBFILES = ["dddata.bin"];
/** Files shared by every tileset, written under their own name. */
const SHARED = [["rez\\stat_txt.tbl", "stat_txt.tbl"]];

const { outDir, archives: paths } = parseArgs(process.argv.slice(2), "public/tileset");
const { archives, problems } = openArchives(paths);

mkdirSync(outDir, { recursive: true });

const extracted = new Map();
for (const name of TILESETS) {
  for (const ext of [...REQUIRED, ...OPTIONAL]) {
    const data = readMember(archives, `tileset\\${name}.${ext}`);
    if (data) extracted.set(`${name}.${ext}`, data);
  }
  for (const table of REMAPS) {
    const data = readMember(archives, `tileset\\${name}\\${table}.pcx`);
    if (data) extracted.set(`${name}.${table}.pcx`, data);
  }
  for (const file of SUBFILES) {
    const data = readMember(archives, `tileset\\${name}\\${file}`);
    if (data) extracted.set(`${name}.${file}`, data);
  }
}
for (const [member, file] of SHARED) {
  const data = readMember(archives, member);
  if (data) extracted.set(file, data);
}

for (const [file, data] of extracted) {
  writeFileSync(join(outDir, file), data);
}

const manifest = {};
for (const name of TILESETS) {
  const have = [...REQUIRED, ...OPTIONAL, ...REMAPS.map((t) => `${t}.pcx`), ...SUBFILES].filter((ext) => extracted.has(`${name}.${ext}`));
  const complete = REQUIRED.every((ext) => have.includes(ext)) && (have.includes("vx4") || have.includes("vx4ex"));
  manifest[name] = { complete, files: have };
}
manifest.shared = SHARED.map(([, file]) => file).filter((file) => extracted.has(file));
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const ready = TILESETS.filter((n) => manifest[n].complete);
const missing = TILESETS.filter((n) => !manifest[n].complete);

console.log(`Read ${archives.length} archive(s):`);
for (const a of archives) console.log(`  ${a.path}`);
console.log(`Wrote ${extracted.size} file(s) to ${outDir}`);
console.log(`Complete tilesets: ${ready.join(", ") || "(none)"}`);
if (missing.length) console.log(`Incomplete: ${missing.join(", ")}`);
for (const p of problems) console.error(`warning: ${p}`);
process.exitCode = ready.length > 0 ? 0 : 1;
