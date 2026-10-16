/**
 * Rewraps the prose of the README and the guides under `docs/` to one width.
 *
 * Paragraphs, list items and block quotes are joined and broken again at WIDTH columns;
 * headings, tables, fenced code, pictures, HTML and the generated blocks
 * (`<!-- generated: … -->`) are left exactly as they are. A code span is never broken,
 * so a line runs past the width only when one word or span is longer than it.
 * `tests/docs.test.ts` fails on a prose line this would change.
 *
 *   node scripts/wrap-docs.mjs            # rewrites the files in place
 *   node scripts/wrap-docs.mjs --check    # changes nothing, exits 1 if a file would change
 *   node scripts/wrap-docs.mjs docs/guide.md
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const WIDTH = 90;

/** Words of a run of prose: split on spaces outside code spans. */
function words(text) {
  const out = [];
  let cur = "";
  let tick = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "`") {
      let n = 1;
      while (text[i + n] === "`") n++;
      if (!tick) tick = n;
      else if (tick === n) tick = 0;
      cur += text.slice(i, i + n);
      i += n - 1;
    } else if (c === " " && !tick) {
      if (cur) out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  // A word markdown would read as the start of a list, a quote, a heading or a table
  // cannot begin a line, so it travels with the word before it.
  for (let i = out.length - 1; i > 0; i--) if (/^([-+*>#|=]|\d+[.)]|<\S*)$/.test(out[i])) out.splice(i - 1, 2, `${out[i - 1]} ${out[i]}`);
  return out;
}

/** `text` broken into lines, the first starting with `first`, the rest with `rest`. */
function fill(text, first, rest, width = WIDTH) {
  const lines = [];
  let line = first;
  let empty = true;
  for (const w of words(text)) {
    if (!empty && line.length + 1 + w.length > width) {
      lines.push(line);
      line = rest + w;
    } else line += (empty ? "" : " ") + w;
    empty = false;
  }
  lines.push(line);
  return lines;
}

const FENCE = /^\s*(```|~~~)/;
const ITEM = /^(\s*)([-*+]|\d+[.)])( +)/;
/** Lines that are never prose: they end a paragraph and are kept as written. */
const RAW = (l) => /^\s*(#{1,6} |\||!\[|<|```|~~~|---\s*$|\*\*\*\s*$)/.test(l) || /^ {4,}\S/.test(l) && !ITEM.test(l);
const HARD_BREAK = (l) => / {2,}$/.test(l) || /\\$/.test(l);

export function wrap(source) {
  const src = source.split("\n");
  const out = [];
  let i = 0;
  while (i < src.length) {
    const line = src[i];
    // Fenced code: copied through to the closing fence.
    if (FENCE.test(line)) {
      const fence = FENCE.exec(line)[1];
      out.push(line);
      i++;
      while (i < src.length && !src[i].trimStart().startsWith(fence)) out.push(src[i++]);
      if (i < src.length) out.push(src[i++]);
      continue;
    }
    // A generated block: copied through to its end marker.
    if (/^<!-- generated: /.test(line) && !line.includes("<!-- /generated -->")) {
      while (i < src.length && !src[i].includes("<!-- /generated -->")) out.push(src[i++]);
      if (i < src.length) out.push(src[i++]);
      continue;
    }
    if (!line.trim() || RAW(line)) {
      out.push(line);
      i++;
      continue;
    }
    // A block quote: its inner prose wrapped, the `> ` put back.
    if (/^>/.test(line)) {
      const inner = [];
      while (i < src.length && /^>/.test(src[i])) inner.push(src[i++].replace(/^> ?/, ""));
      for (const l of wrap(inner.join("\n")).split("\n")) out.push(l ? `> ${l}` : ">");
      continue;
    }
    // A list item or a paragraph: its lines gathered up to a blank line, a new item or a raw line.
    const item = ITEM.exec(line);
    const indent = item ? item[0].length : /^\s*/.exec(line)[0].length;
    const first = item ? item[0] : line.slice(0, indent);
    const rest = " ".repeat(indent);
    let text = line.slice(first.length).trim();
    i++;
    let lead = first;
    while (i < src.length) {
      const next = src[i];
      if (!next.trim() || RAW(next) || ITEM.test(next) || /^>/.test(next) || FENCE.test(next)) break;
      if (item && /^\s*/.exec(next)[0].length < indent) break;
      if (HARD_BREAK(src[i - 1])) {
        // Keep the author's line break: what came before is wrapped on its own.
        for (const l of fill(text, lead, rest)) out.push(l);
        lead = rest;
        text = next.trim();
      } else text += " " + next.trim();
      i++;
    }
    for (const l of fill(text, lead, rest)) out.push(l);
  }
  return out.join("\n");
}

/** The README and every guide under docs/. */
export function docFiles(root) {
  return ["README.md", ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).sort().map((f) => `docs/${f}`)];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(import.meta.dirname, "..");
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const files = args.filter((a) => !a.startsWith("--"));
  let changed = 0;
  for (const file of files.length ? files : docFiles(root)) {
    const path = resolve(root, file);
    const before = readFileSync(path, "utf8");
    const after = wrap(before);
    if (after === before) continue;
    changed++;
    if (check) console.error(`${file} is not wrapped at ${WIDTH} columns — run node scripts/wrap-docs.mjs`);
    else {
      writeFileSync(path, after);
      console.log(`wrapped ${file}`);
    }
  }
  if (check && changed) process.exit(1);
}
