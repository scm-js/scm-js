/**
 * `npm run docs:reference`: rewrites the generated blocks of the two reference documents
 * from the editor's own tables — `docs/triggers.md` from the trigger definitions,
 * `docs/chk-format.md` from the section registry, the codecs' flag tables and the byte
 * layouts in `scripts/lib/chk-reference.mjs` — and the files that go with the CHK
 * reference: its pictures (`docs/images/isom-*.svg`, `chk-references.svg`, drawn by
 * `scripts/lib/chk-diagrams.mjs`) and its Kaitai Struct description (`docs/chk.ksy`,
 * `scripts/lib/chk-kaitai.mjs`). `--check` changes nothing and exits 1 when any of them
 * is out of date, which is what their tests also assert.
 *
 *   node scripts/reference-docs.mjs
 *   node scripts/reference-docs.mjs --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/load-ts.mjs";
import { fillReference as fillTriggers } from "./lib/trigger-reference.mjs";
import { fillReference as fillChk } from "./lib/chk-reference.mjs";
import { chkDiagrams } from "./lib/chk-diagrams.mjs";
import { chkKaitai } from "./lib/chk-kaitai.mjs";

const root = resolve(import.meta.dirname, "..");
// Dynamic, so the hooks above are in place before Node resolves the TypeScript.
const load = (file) => import(pathToFileURL(join(root, "src", file)).href);

const chkDefs = async () => ({
  ...(await load("formats/chk/sections/registry.ts")),
  ...(await load("formats/chk/create.ts")),
  ...(await load("formats/chk/scenario.ts")),
  ...(await load("formats/chk/sections/objects.ts")),
  ...(await load("formats/chk/sections/players.ts")),
  ...(await load("formats/chk/sections/cuwp.ts")),
  ...(await load("formats/chk/sections/settings.ts")),
  ...(await load("data/players.ts")),
  ...(await load("data/tilesets.ts")),
  ...(await load("data/units.ts")),
  ...(await load("data/isomTables.ts")),
  ...(await load("formats/chk/sections/strings.ts")),
  ...(await load("formats/chk/sections/vcod.ts")),
  ...(await load("editor/textColors.ts")),
});

const DOCUMENTS = [
  { file: "docs/triggers.md", fill: fillTriggers, defs: () => load("data/triggerDefs.ts") },
  { file: "docs/chk-format.md", fill: fillChk, defs: chkDefs },
];

const check = process.argv.includes("--check");
let failed = false;
for (const doc of DOCUMENTS) {
  const path = join(root, doc.file);
  const before = readFileSync(path, "utf8");
  const { text, missing, unknown } = doc.fill(before, await doc.defs());
  for (const key of missing) console.error(`${doc.file} has no block for "${key}" — add <!-- generated: ${key} --><!-- /generated --> where it belongs`);
  for (const key of unknown) console.error(`${doc.file} names a block the tables do not have: "${key}"`);
  if (missing.length || unknown.length) failed = true;
  if (text === before) {
    console.log(`${doc.file}: up to date.`);
  } else if (check) {
    console.error(`${doc.file} is out of date: run npm run docs:reference`);
    failed = true;
  } else {
    writeFileSync(path, text);
    console.log(`${doc.file}: updated.`);
  }
}

// The files beside the CHK reference: written whole, compared whole.
const defs = await chkDefs();
const files = new Map([...chkDiagrams(), ["docs/chk.ksy", chkKaitai({ ...defs, ...(await load("data/triggerDefs.ts")) })]]);
for (const [file, content] of files) {
  const path = join(root, file);
  let before = null;
  try { before = readFileSync(path, "utf8"); } catch { /* not written yet */ }
  if (before === content) {
    console.log(`${file}: up to date.`);
  } else if (check) {
    console.error(`${file} is out of date: run npm run docs:reference`);
    failed = true;
  } else {
    writeFileSync(path, content);
    console.log(`${file}: updated.`);
  }
}
process.exit(failed ? 1 : 0);
