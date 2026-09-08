/**
 * `npm run i18n`: the language catalogues against the source.
 *
 *   node scripts/i18n.mjs            report: what each catalogue is missing, no longer needs, or has wrong
 *   node scripts/i18n.mjs --write    bring every catalogue up to date (new keys empty, dropped keys removed)
 *
 * A catalogue is `src/i18n/<locale>.json`, one per entry of `LOCALES` other than English.
 * The report exits non-zero on a missing key, an unused key, a placeholder mismatch or
 * a `t()` whose text is not a literal — the same things `tests/i18n.test.ts` fails on —
 * and only lists the untranslated ones, which show in English until someone writes them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCatalogue, extractMessages, splitKey, updatedCatalogue } from "./lib/i18n.mjs";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");
const write = process.argv.includes("--write");
const LOCALES = ["ko"];

const { messages, errors } = extractMessages(src);
let failed = errors.length > 0;
for (const e of errors) console.error(`${e.file}:${e.line}: ${e.reason}`);
console.log(`${messages.size} message${messages.size === 1 ? "" : "s"} in the source`);

for (const locale of LOCALES) {
  const file = join(src, "i18n", `${locale}.json`);
  const catalogue = JSON.parse(readFileSync(file, "utf8"));
  const { missing, unused, untranslated, mismatched } = checkCatalogue(messages, catalogue);
  const show = (key) => { const { context, text } = splitKey(key); return context ? `[${context}] ${text}` : text; };
  if (write) {
    writeFileSync(file, JSON.stringify(updatedCatalogue(messages, catalogue), null, 2) + "\n");
    console.log(`${locale}: written — ${missing.length} added, ${unused.length} removed, ${untranslated.length + missing.length} to translate`);
    continue;
  }
  console.log(`${locale}: ${missing.length} missing, ${unused.length} unused, ${mismatched.length} mismatched, ${untranslated.length} untranslated`);
  for (const k of missing) console.log(`  missing:  ${show(k)}`);
  for (const k of unused) console.log(`  unused:   ${show(k)}`);
  for (const m of mismatched) console.log(`  mismatch: ${show(m.key)} — source has {${m.want.join("} {")}}, translation has {${m.have.join("} {")}}`);
  for (const k of untranslated) console.log(`  english:  ${show(k)}`);
  if (missing.length || unused.length || mismatched.length) failed = true;
}
if (failed && !write) { console.error("\nRun `npm run i18n -- --write` to bring the catalogues up to date, then fill in the empty entries."); process.exit(1); }
