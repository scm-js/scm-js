#!/usr/bin/env node
/**
 * Extract tileset graphics from a StarCraft install into public/tileset/.
 *
 * Put StarDat.mpq (and BrooDat.mpq for the Brood War tilesets) in fixtures/data/, then:
 *
 *     node scripts/extract-tilesets.mjs [--out public/tileset] [extra.mpq ...]
 *
 * Later archives win, so BrooDat's copies override StarDat's.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Archive } from "mopaq";

const TILESETS = ["badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight"];
const REQUIRED = ["cv5", "vf4", "vr4", "wpe"];
const OPTIONAL = ["vx4", "vx4ex"];

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const outIndex = args.indexOf("--out");
const outDir = resolve(root, outIndex >= 0 ? args[outIndex + 1] : "public/tileset");
const explicit = args.filter((a, i) => a !== "--out" && i !== outIndex + 1 && !a.startsWith("--"));

function defaultArchives() {
  const dir = join(root, "fixtures", "data");
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  // StarDat first so BrooDat overrides it.
  const order = (n) => (/^stardat/i.test(n) ? 0 : /^broodat/i.test(n) ? 1 : 2);
  return names
    .filter((n) => n.toLowerCase().endsWith(".mpq"))
    .sort((a, b) => order(a) - order(b))
    .map((n) => join(dir, n));
}

const archives = explicit.length > 0 ? explicit.map((p) => resolve(p)) : defaultArchives();

if (archives.length === 0) {
  console.error("No MPQ archives found. Put StarDat.mpq / BrooDat.mpq in fixtures/data/, or pass paths as arguments.");
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const extracted = new Map();
const problems = [];

for (const path of archives) {
  let archive;
  try {
    archive = Archive.open(new Uint8Array(readFileSync(path)));
  } catch (err) {
    problems.push(`${path}: ${err.message}`);
    continue;
  }

  for (const name of TILESETS) {
    for (const ext of [...REQUIRED, ...OPTIONAL]) {
      const member = `tileset\\${name}.${ext}`;
      let data;
      try {
        data = archive.readFile(member);
      } catch {
        continue; // absent in this archive, which is normal and expected
      }
      extracted.set(`${name}.${ext}`, data);
    }
  }
}

for (const [file, data] of extracted) {
  writeFileSync(join(outDir, file), data);
}

const manifest = {};
for (const name of TILESETS) {
  const have = [...REQUIRED, ...OPTIONAL].filter((ext) => extracted.has(`${name}.${ext}`));
  const complete = REQUIRED.every((ext) => have.includes(ext)) && (have.includes("vx4") || have.includes("vx4ex"));
  manifest[name] = { complete, files: have };
}
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const ready = TILESETS.filter((n) => manifest[n].complete);
const missing = TILESETS.filter((n) => !manifest[n].complete);

console.log(`Read ${archives.length} archive(s):`);
for (const a of archives) console.log(`  ${a}`);
console.log(`Wrote ${extracted.size} file(s) to ${outDir}`);
console.log(`Complete tilesets: ${ready.join(", ") || "(none)"}`);
if (missing.length) console.log(`Incomplete: ${missing.join(", ")}`);
for (const p of problems) console.error(`warning: ${p}`);
process.exitCode = ready.length > 0 ? 0 : 1;
