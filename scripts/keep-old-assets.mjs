/**
 * The hosted editor's previous builds' `assets/` files, carried into the next deploy.
 *
 * A deploy to GitHub Pages replaces the whole site, and every file under `assets/` is named
 * by its content's hash, so the files a page opened before the deploy still asks for are
 * gone once it lands. The editor loads most of itself on demand — every dialog is its own
 * chunk — so a tab left open across a release fails the first time it opens a dialog it had
 * not opened yet ("Failed to fetch dynamically imported module"), and every tab of the
 * nightly does that once a day. Keeping the files of the last few builds beside the new
 * ones lets those tabs go on working; a reload brings them up to date when they choose.
 *
 * The site carries `asset-versions.json`: the build it is and the builds it kept, newest
 * first, each with its own files. A deploy reads it from the live site, downloads the files
 * of the newest `--keep` builds that are not its own, and writes the list again with itself
 * at the top. A site without the list (the first deploy with this script) is read the long
 * way once: its pages and every chunk they name, which finds all of a Vite build's files.
 * Nothing here fails the deploy: a site that cannot be read, or a file that does not
 * arrive, is reported, and the new build goes out regardless.
 *
 *   node scripts/keep-old-assets.mjs --dist dist --site https://scmjs.dev/editor/ --version 0.18.0 [--keep 3]
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const LIST = "asset-versions.json";

/** How many earlier builds' files a deploy keeps, by default. */
export const KEEP = 3;

/** A path the list may name: one file directly under `assets/`, nothing that climbs out. */
const ASSET = /^assets\/[\w.-]+$/;

/**
 * Pure: the list the new site carries. `own` is this build's files, `live` whatever the
 * live site's list said (anything at all — it came over the network). A build of the same
 * version as one already listed replaces it, since a re-deploy of a tag is that tag.
 */
export function nextList(version, own, live, keep = KEEP) {
  const earlier = Array.isArray(live?.versions) ? live.versions : [];
  const kept = [];
  for (const entry of earlier) {
    if (kept.length >= keep) break;
    if (!entry || typeof entry.version !== "string" || entry.version === version || !Array.isArray(entry.files)) continue;
    if (kept.some((k) => k.version === entry.version)) continue;
    const files = entry.files.filter((f) => typeof f === "string" && ASSET.test(f) && !f.includes(".."));
    if (files.length) kept.push({ version: entry.version, files });
  }
  return { versions: [{ version, files: [...own].sort() }, ...kept] };
}

/** A hashed file of a build, as a page or a chunk names it: `assets/x-AbCd1234.js`, `./x-AbCd1234.js`, `"x-AbCd1234.css"`. */
const REFERENCE = /(?:assets\/|\.\/|["`'])([\w.-]+-[\w-]{8}\.(?:js|mjs|css|wasm))/g;

/** Pure: the `assets/` files a page or a chunk refers to. */
export function referencedAssets(text) {
  return [...new Set([...text.matchAll(REFERENCE)].map((m) => `assets/${m[1]}`))];
}

/** Pure: the files `list` names that are not `own` and so have to be fetched, each once. */
export function filesToFetch(list, own) {
  const have = new Set(own);
  const out = new Set();
  for (const entry of list.versions.slice(1)) for (const f of entry.files) if (!have.has(f)) out.add(f);
  return [...out].sort();
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = /^--([\w-]+)$/.exec(argv[i]);
    if (m) out[m[1]] = argv[++i];
  }
  return out;
}

const warn = (text) => console.log(process.env.GITHUB_ACTIONS ? `::warning::${text}` : `warning: ${text}`);

async function fetchList(site) {
  try {
    const res = await fetch(new URL(LIST, site), { cache: "no-store" });
    if (!res.ok) return { list: null, why: `HTTP ${res.status}` };
    return { list: await res.json(), why: "" };
  } catch (err) {
    return { list: null, why: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The live build's files, for a site that has no list yet: its pages (the same names as this
 * build's), then every file they and the chunks they name refer to, breadth first.
 */
async function crawl(site, pages) {
  const seen = new Set();
  const queue = [...pages];
  const found = [];
  while (queue.length) {
    const path = queue.shift();
    let text;
    try {
      const res = await fetch(new URL(path, site), { cache: "no-store" });
      if (!res.ok) continue;
      text = await res.text();
    } catch {
      continue;
    }
    if (path.startsWith("assets/")) found.push(path);
    for (const f of referencedAssets(text)) if (!seen.has(f)) { seen.add(f); queue.push(f); }
  }
  return found;
}

async function main() {
  const a = args(process.argv.slice(2));
  const dist = a.dist ?? "dist";
  const version = a.version;
  const keep = a.keep === undefined ? KEEP : Number(a.keep);
  if (!a.site || !version || !Number.isInteger(keep) || keep < 0) {
    console.error("usage: node scripts/keep-old-assets.mjs --dist <folder> --site <url> --version <version> [--keep <n>]");
    process.exit(2);
  }
  const site = a.site.endsWith("/") ? a.site : `${a.site}/`;
  const own = existsSync(join(dist, "assets")) ? readdirSync(join(dist, "assets")).map((f) => `assets/${f}`) : [];

  const { list: listed, why } = await fetchList(site);
  let live = listed;
  if (!live) {
    const pages = readdirSync(dist).filter((f) => f.endsWith(".html"));
    const files = await crawl(site, pages);
    if (files.length) {
      console.log(`No ${LIST} at ${site} (${why}); found the live build's ${files.length} file(s) from its pages instead.`);
      // Named for what it is: the build that was there before the lists began.
      live = { versions: [{ version: "earlier", files }] };
    } else {
      warn(`No ${LIST} at ${site} (${why}), and nothing found from its pages; this deploy keeps no earlier build's files.`);
    }
  }
  const list = nextList(version, own, live, keep);
  const wanted = filesToFetch(list, own);

  const missing = new Set();
  let next = 0;
  const worker = async () => {
    while (next < wanted.length) {
      const file = wanted[next++];
      try {
        const res = await fetch(new URL(file, site));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // A front door that answers a missing file with the editor's page, status and all,
        // must not leave that page behind under a chunk's name.
        if ((res.headers.get("content-type") ?? "").startsWith("text/html")) throw new Error("a page, not the file");
        const to = join(dist, file);
        mkdirSync(dirname(to), { recursive: true });
        writeFileSync(to, Buffer.from(await res.arrayBuffer()));
      } catch {
        missing.add(file);
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  // A file that did not arrive is not listed as kept, so the next deploy does not ask for it.
  for (const entry of list.versions.slice(1)) entry.files = entry.files.filter((f) => !missing.has(f));
  list.versions = list.versions.filter((e, i) => i === 0 || e.files.length > 0);
  writeFileSync(join(dist, LIST), `${JSON.stringify(list, null, 1)}\n`);

  if (missing.size) warn(`${missing.size} earlier file(s) could not be fetched from ${site} and were left out.`);
  const lines = [
    `Kept ${wanted.length - missing.size} file(s) of ${list.versions.length - 1} earlier build(s) beside ${version}'s ${own.length}:`,
    ...list.versions.slice(1).map((e) => `- ${e.version}: ${e.files.length} file(s)`),
  ];
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `### Earlier builds kept on ${site}\n\n${lines.join("\n")}\n`, { flag: "a" });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
