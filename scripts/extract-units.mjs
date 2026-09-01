#!/usr/bin/env node
/**
 * Extract the unit graphics and data tables from a StarCraft install into public/.
 *
 * Put StarDat.mpq and BrooDat.mpq in fixtures/data/ (BrooDat is required: its units.dat is
 * the Brood War layout the decoder expects), then:
 *
 *     node scripts/extract-units.mjs [--out public] [extra.mpq ...]
 *
 * The output mirrors the MPQ tree so the browser loader can use the game's own paths:
 *
 *     public/arr/units.dat, flingy.dat, sprites.dat, images.dat, images.tbl
 *     public/game/tunit.pcx                      team-colour remap table
 *     public/scripts/iscript.bin                 animation bytecode
 *     public/unit/<race>/<name>.grp              every GRP the 228 unit types, the 517
 *                                                sprites.dat entries and their idle
 *                                                animations can draw with
 *     public/unit/<race>/<name>.lo?              overlay positions (damage fires, smoke)
 *
 * "Can draw with" is decided by walking iscript.bin from each unit's main image through
 * the opcodes that spawn further images (shadows, glows, turrets, smoke), plus the
 * damage-overlay and geyser-smoke images the engine adds itself — the same set
 * src/formats/units/animate.ts can reach — and from every sprites.dat entry, since the
 * Sprites layer places any of them and doodad overlays (canopies, doors) are sprites no
 * unit draws. Projectile and death images only come along when a sprite points at them.
 *
 * File names are lower-cased because MPQ lookups are case-insensitive and web servers are not.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { openArchives, parseArgs, readMember } from "./lib/archives.mjs";
// Node strips the types itself (v22.18+ / v23.6+); the module has no imports for exactly this reason.
import { ANIM_COUNT_BY_TYPE, decodeIscript, IMAGE_SPAWN_OPS, Op, walkAnimation } from "../src/formats/dat/iscript.ts";

const UNIT_COUNT = 228;
const SPRITE_COUNT = 517;
const IMAGE_COUNT = 999;
const TABLES = ["arr\\units.dat", "arr\\flingy.dat", "arr\\sprites.dat", "arr\\images.dat", "arr\\images.tbl", "game\\tunit.pcx", "scripts\\iscript.bin"];
/** Images the engine creates without an opcode: damage flames/sparks/blood (450–493) and geyser smoke (430–439). */
const ENGINE_IMAGES = [...Array.from({ length: 44 }, (_, i) => 450 + i), ...Array.from({ length: 10 }, (_, i) => 430 + i)];

const { outDir, archives: paths } = parseArgs(process.argv.slice(2), "public");
const { archives, problems } = openArchives(paths);

const tables = new Map();
for (const member of TABLES) {
  const data = readMember(archives, member);
  if (!data) {
    console.error(`Missing ${member} in ${paths.join(", ")}`);
    process.exit(1);
  }
  tables.set(member, data);
}

const units = tables.get("arr\\units.dat");
if (units.length !== 19876) {
  console.error(`units.dat is ${units.length} bytes; expected the Brood War layout (19876). Is BrooDat.mpq present?`);
  process.exit(1);
}

/*
 * The walk from a unit to its picture, kept in sync with src/formats/dat/dat.ts:
 *   units.dat graphics (u8, offset 0) → flingy.dat sprite (u16, offset 0)
 *   → sprites.dat image (u16, offset 0) → images.dat grp (u32, offset 0, 1-based into images.tbl)
 * Turrets and the like are units themselves, so walking all 228 covers subunits too.
 */
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;
const flingy = tables.get("arr\\flingy.dat");
const sprites = tables.get("arr\\sprites.dat");
const images = tables.get("arr\\images.dat");
const tbl = tables.get("arr\\images.tbl");
const tblCount = u16(tbl, 0);
const tblString = (i) => {
  const at = u16(tbl, 2 + i * 2);
  let end = at;
  while (end < tbl.length && tbl[end] !== 0) end++;
  return new TextDecoder("latin1").decode(tbl.subarray(at, end));
};
const tblEntry = (index1) => (index1 > 0 && index1 <= tblCount ? tblString(index1 - 1) : null);
// images.dat fields, struct-of-arrays: grp u32 ×999, then 6 u8 columns, iscript u32, six .lo u32 columns.
const imageGrp = (i) => tblEntry(u32(images, i * 4));
const imageIscript = (i) => u32(images, IMAGE_COUNT * 10 + i * 4);
const imageLos = (i) => Array.from({ length: 6 }, (_, k) => tblEntry(u32(images, IMAGE_COUNT * (14 + k * 4) + i * 4))).filter(Boolean);

const iscript = decodeIscript(tables.get("scripts\\iscript.bin"));

const reachable = new Set();
const todo = [...ENGINE_IMAGES];
for (let unit = 0; unit < UNIT_COUNT; unit++) todo.push(u16(sprites, u16(flingy, units[unit] * 2) * 2));
// Every sprites.dat entry too: the Sprites layer places any of them as a pure sprite, and
// doodad overlays (tree canopies, Installation doors) are sprites no unit ever draws.
for (let sprite = 0; sprite < SPRITE_COUNT; sprite++) todo.push(u16(sprites, sprite * 2));
while (todo.length > 0) {
  const image = todo.pop();
  if (image >= IMAGE_COUNT || reachable.has(image)) continue;
  reachable.add(image);
  const header = iscript.headers.get(imageIscript(image));
  if (!header) continue;
  for (let anim = 0; anim < ANIM_COUNT_BY_TYPE[header.type]; anim++) {
    walkAnimation(iscript, header.id, anim, (ins) => {
      if (IMAGE_SPAWN_OPS.has(ins.op)) todo.push(ins.args[0]);
      else if (ins.op === Op.imgulnextid) todo.push(image + 1);
    });
  }
}

const grpPaths = new Set();
const loPaths = new Set();
for (const image of reachable) {
  const grp = imageGrp(image);
  if (grp) grpPaths.add(grp);
  for (const lo of imageLos(image)) loPaths.add(lo);
}

const written = [];
const missing = [];
const write = (relative, data) => {
  const target = join(outDir, relative.toLowerCase().replaceAll("\\", "/"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, data);
  written.push(relative);
};

for (const [member, data] of tables) write(member, data);
for (const rel of [...grpPaths, ...loPaths].sort()) {
  const member = `unit\\${rel}`;
  const data = readMember(archives, member);
  if (data) write(member, data);
  else missing.push(member);
}

write("unit\\manifest.json", JSON.stringify({
  images: [...reachable].sort((a, b) => a - b),
  grps: [...grpPaths].sort().map((p) => p.toLowerCase()),
  overlays: [...loPaths].sort().map((p) => p.toLowerCase()),
  missing,
}, null, 2) + "\n");

console.log(`Read ${archives.length} archive(s):`);
for (const a of archives) console.log(`  ${a.path}`);
console.log(`Wrote ${written.length} file(s) to ${outDir} (${reachable.size} images → ${grpPaths.size} GRPs, ${loPaths.size} overlay files)`);
if (missing.length) console.log(`Missing: ${missing.join(", ")}`);
for (const p of problems) console.error(`warning: ${p}`);
process.exitCode = missing.length === 0 ? 0 : 1;
