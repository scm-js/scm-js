/**
 * `npm run i18n`: the language catalogues against the source.
 *
 *   node scripts/i18n.mjs            report: what each catalogue is missing, no longer needs, or has wrong
 *   node scripts/i18n.mjs --write    bring every catalogue up to date (new keys empty, dropped keys removed)
 *   node scripts/i18n.mjs --export ko out.csv    the catalogue as a spreadsheet: English, Korean, where it appears
 *   node scripts/i18n.mjs --import ko in.csv     a reviewed spreadsheet back into the catalogue (by the English column)
 *
 * The spreadsheet is what a reviewer gets: one row per string, the English on the left,
 * the translation on the right, and the source files it appears in so a term can be
 * checked in context. Import matches rows by their English text, keeps the JSON's key
 * order, and ignores rows whose English the source no longer has.
 *
 * A catalogue is `src/i18n/<locale>.json`, one per entry of `LOCALES` other than English.
 * The report exits non-zero on a missing key, an unused key, a placeholder mismatch or
 * a `t()` whose text is not a literal — the same things `tests/i18n.test.ts` fails on —
 * and only lists the untranslated ones, which show in English until someone writes them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkCatalogue, extractMessages, messageKey, splitKey, updatedCatalogue } from "./lib/i18n.mjs";

const root = resolve(import.meta.dirname, "..");
const src = join(root, "src");
const write = process.argv.includes("--write");
const LOCALES = ["ko"];

const { messages, errors } = extractMessages(src);

const flag = (name) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv.slice(i + 1, i + 3) : null; };
const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.length));
}

const exp = flag("--export");
if (exp) {
  const [locale, out] = exp;
  const catalogue = JSON.parse(readFileSync(join(src, "i18n", `${locale}.json`), "utf8"));
  const lines = ["English,Translation,Context,Where"];
  for (const [key, { text, context, uses }] of messages) {
    lines.push([text, catalogue[key] ?? "", context, uses.map((u) => u.replace(/:\d+$/, "")).filter((v, i, a) => a.indexOf(v) === i).join(" ")].map(csvCell).join(","));
  }
  writeFileSync(out, "\ufeff" + lines.join("\n") + "\n");
  console.log(`${locale}: ${messages.size} rows → ${out}`);
  process.exit(0);
}
const imp = flag("--import");
if (imp) {
  const [locale, file] = imp;
  const path = join(src, "i18n", `${locale}.json`);
  const catalogue = JSON.parse(readFileSync(path, "utf8"));
  const rows = parseCsv(readFileSync(file, "utf8").replace(/^\ufeff/, ""));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (name) => header.indexOf(name);
  const iText = col("english"); const iTr = col("translation"); const iCtx = col("context");
  let changed = 0; let unknown = 0;
  for (const r of rows) {
    const key = messageKey(r[iText] ?? "", iCtx >= 0 ? r[iCtx] ?? "" : "");
    if (!messages.has(key)) { unknown++; continue; }
    const value = (r[iTr] ?? "").trim();
    if (catalogue[key] !== value) { catalogue[key] = value; changed++; }
  }
  writeFileSync(path, JSON.stringify(updatedCatalogue(messages, catalogue), null, 2) + "\n");
  console.log(`${locale}: ${changed} changed, ${unknown} rows the source no longer has`);
  process.exit(0);
}
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
