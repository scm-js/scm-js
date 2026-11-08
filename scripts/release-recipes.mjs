// The install recipes (packaging/: Scoop, winget, Homebrew) filled for a release, for the maintainer to publish
// (packaging/README.md): the version, today's date and each archive's SHA-256, read from the release's SHA256SUMS.
//   node scripts/release-recipes.mjs                    the version in package.json, its release's SHA256SUMS
//   node scripts/release-recipes.mjs 0.12.0 --out <folder>
//   node scripts/release-recipes.mjs --sums cli/dist/bin/SHA256SUMS --partial   a local build's, to try the recipes
//                                       (--partial: an archive not built here gets a hash of zeros)
// Writes packaging/out/v<version>/ (ignored by git) laid out as the bucket, winget-pkgs and the tap are.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fillRecipe, parseSums, recipes, recipeValues } from "./lib/recipes.mjs";

const args = process.argv.slice(2);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const version = (args[0] && !args[0].startsWith("--") ? args[0] : JSON.parse(readFileSync("package.json", "utf8")).version).replace(/^v/, "");
const out = value("--out") ?? join("packaging", "out", `v${version}`);
let text;
if (value("--sums")) text = readFileSync(value("--sums"), "utf8");
else {
  const url = `https://github.com/scm-js/scm-js/releases/download/v${version}/SHA256SUMS`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`${url}: HTTP ${res.status}. Is v${version} released, with the command's archives?`); process.exit(1); }
  text = await res.text();
}

let values;
try { values = recipeValues(version, parseSums(text), undefined, args.includes("--partial") ? "0".repeat(64) : null); } catch (e) { console.error(e.message); process.exit(1); }
if (values.missing) console.log(`Not in the sums, zeros in their place: ${values.missing.join(", ")}`);
for (const r of recipes(version)) {
  const file = join(out, r.to);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, fillRecipe(readFileSync(r.from, "utf8"), values));
  console.log(file);
}
console.log(`\nscmjs ${version}: publish these as packaging/README.md says.`);
