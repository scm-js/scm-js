/**
 * Writes the maps of `tests/maps/` from `tests/support/testMaps.ts` — the committed maps
 * the test suites open where there is no game data. Run it after changing that file.
 *
 *   node scripts/test-maps.mjs      (npm run test:maps)
 *
 * Needs nothing but the repository: the maps are built from the editor's own code.
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import "./lib/load-ts.mjs";

const root = resolve(import.meta.dirname, "..");
const out = join(root, "tests", "maps");
const { testMaps, buildTestMap } = await import(pathToFileURL(join(root, "tests", "support", "testMaps.ts")).href);

mkdirSync(out, { recursive: true });
const maps = testMaps();
// A map this file no longer makes goes; anything else in the folder is left alone.
for (const file of readdirSync(out)) if (/\.(scx|scm)$/i.test(file) && !maps.some((m) => m.name === file)) rmSync(join(out, file));
for (const map of maps) {
  const bytes = await buildTestMap(map);
  writeFileSync(join(out, map.name), bytes);
  console.log(`${map.name.padEnd(16)} ${String(bytes.length).padStart(7)} bytes`);
}
