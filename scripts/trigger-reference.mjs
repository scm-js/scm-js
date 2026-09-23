/**
 * `npm run docs:triggers`: rewrites the generated blocks of `docs/triggers.md` from the
 * editor's trigger tables. `--check` changes nothing and exits 1 when the document is out
 * of date, which is what `tests/triggerReference.test.ts` also asserts.
 *
 *   node scripts/trigger-reference.mjs            # bring the document up to date
 *   node scripts/trigger-reference.mjs --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/load-ts.mjs";
import { fillReference } from "./lib/trigger-reference.mjs";

const root = resolve(import.meta.dirname, "..");
const file = join(root, "docs/triggers.md");
// Dynamic, so the hooks above are in place before Node resolves the TypeScript.
const defs = await import(pathToFileURL(join(root, "src/data/triggerDefs.ts")).href);

const before = readFileSync(file, "utf8");
const { text, missing, unknown } = fillReference(before, defs);
for (const key of missing) console.error(`docs/triggers.md has no block for "${key}" — add a page with <!-- generated: ${key} --><!-- /generated -->`);
for (const key of unknown) console.error(`docs/triggers.md names a block the tables do not have: "${key}"`);

if (process.argv.includes("--check")) {
  if (text !== before) console.error("docs/triggers.md is out of date: run npm run docs:triggers");
  process.exit(text !== before || missing.length || unknown.length ? 1 : 0);
}
if (text !== before) writeFileSync(file, text);
console.log(`docs/triggers.md: ${text === before ? "up to date" : "updated"}${missing.length || unknown.length ? " (with problems above)" : ""}.`);
process.exit(missing.length || unknown.length ? 1 : 0);
