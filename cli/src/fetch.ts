/**
 * `scmjs map fetch`: maps from scmscx.com — the best matches for some words as a table, or one map downloaded, opened
 * as the editor opens it before it is written (bytes that are not a map are refused), and named after the file name
 * the site has for it. The site is `scmscx.ts`; this is what the command makes of it.
 */
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { MAP_VERSIONS, mapVersionOf } from "../../src/formats/chk/scenario";
import { looksLikeMpq } from "../../src/formats/mpq/scm";
import { TILESETS } from "../../src/data/tilesets";
import { writeOutput, type Written } from "./exchange";
import { loadMapInput, STDIO, type Input } from "./files";
import { mapReport, type MapReport } from "./map";
import { SCMSCX, type MapInfo, type Scmscx, type SearchRow } from "./scmscx";
import { CliError, columns, dot, gameText, mark, num, pc, plural, rows, size, table } from "./ui";

export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;
/** Map details asked at once for a search's rows (each row is one request). */
const AT_ONCE = 4;

export const tilesetName = (era: number) => TILESETS[era & 7]?.name ?? `Tileset ${era}`;
export const versionName = (ver: number) => (ver ? MAP_VERSIONS[mapVersionOf(ver)].label : "");

/** A search's row with what the site knows of the map, or null where it would not say. */
export interface FoundMap extends SearchRow { url: string; info: MapInfo | null }
export interface SearchReport { words: string; total: number; maps: FoundMap[] }

export function parseLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) throw new CliError(`--limit takes 1 to ${MAX_LIMIT}, not "${value}"`, null, 2);
  return n;
}

/** The site's best matches for the words, the first `limit` maps with their size, tileset and players. */
export async function searchMaps(site: Scmscx, words: string, limit = DEFAULT_LIMIT): Promise<SearchReport> {
  const found = await site.search(words);
  const rows = found.rows.slice(0, limit);
  const maps: FoundMap[] = rows.map((r) => ({ ...r, url: site.pageUrl(r.id), info: null }));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, maps.length) }, async () => {
    while (next < maps.length) {
      const m = maps[next++];
      try { m.info = await site.mapInfo(m.id); } catch (e) { if (!(e instanceof CliError)) throw e; }
    }
  }));
  return { words, total: found.total, maps };
}

/** Text cut to `width` terminal columns, with an ellipsis. */
function cut(s: string, width: number): string {
  if (columns(s) <= width) return s;
  let out = "";
  for (const ch of s) { if (columns(out + ch) > width - 1) break; out += ch; }
  return `${out}…`;
}

export function printSearch(r: SearchReport, width = process.stdout.columns || 100): string[] {
  if (!r.maps.length) return [pc.dim(`Nothing on scmscx.com matches "${r.words}"`)];
  const players = (i: MapInfo) => (i.computers ? `${i.humans} + ${i.computers} computer` : String(i.humans));
  const cells = r.maps.map((m) => [m.name, m.info ? `${m.info.width} × ${m.info.height}` : "", m.info ? tilesetName(m.info.tileset) : "", m.info ? players(m.info) : "", m.info ? num(m.info.downloads) : "", m.id]);
  // The name takes what the other columns leave of the terminal, at least 24 columns.
  const others = [1, 2, 3, 4, 5].reduce((n, c) => n + Math.max(...cells.map((row) => columns(row[c])), 9) + 2, 4);
  const nameWidth = Math.max(24, Math.min(48, width - 1 - others));
  return [
    `${pc.bold("scmscx.com")}${dot}${plural(r.total, "file")} match "${r.words}"${dot}the best ${plural(r.maps.length, "map")}`,
    "",
    ...table([
      ["Name", "Size", "Tileset", "Players", "Downloads", "Id"].map((h) => pc.dim(h)),
      ...cells.map(([name, ...rest]) => [cut(name, nameWidth), ...rest.slice(0, 4), pc.cyan(rest[4])]),
    ], 2),
    "",
    pc.dim(`scmjs map fetch --id <id> downloads one. The maps are their makers', shared on ${SCMSCX}.`),
  ];
}

export function searchJson(r: SearchReport) {
  return {
    words: r.words, total: r.total,
    maps: r.maps.map((m) => ({
      id: m.id, name: m.name, url: m.url, fileNames: m.fileNames,
      ...(m.info ? { width: m.info.width, height: m.info.height, tileset: tilesetName(m.info.tileset), version: versionName(m.info.version), humans: m.info.humans, computers: m.info.computers, downloads: m.info.downloads, views: m.info.views, uploaded: m.info.uploaded } : {}),
    })),
  };
}

/** The map's id from what the person gave: the id, or the map's address on the site. */
export function mapIdFrom(given: string): string {
  const s = given.trim();
  const m = /scmscx\.com\/map\/([A-Za-z0-9_-]+)/i.exec(s) ?? /^([A-Za-z0-9_-]+)$/.exec(s);
  if (!m) throw new CliError(`"${given}" is not a map id`, "The id is the last part of the map's address on the site: scmscx.com/map/<id>.", 2);
  return m[1];
}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;
/**
 * A file name any system takes, from the name the site has: control characters dropped, `<>:"/\|?*` made `_`, no
 * leading dots, no trailing dots or spaces, no Windows device name, at most 120 characters; `.scm` or `.scx` added
 * (by the map's version) when the name has neither.
 */
export function safeFileName(name: string, version: number, fallback = "map"): string {
  const ext = version >= 205 ? ".scx" : ".scm";
  let s = name.replace(/[\x00-\x1f\x7f]/g, "").replace(/[<>:"/\\|?*]/g, "_").replace(/\s+/g, " ").trim(); // eslint-disable-line no-control-regex
  let have = /\.(scm|scx)$/i.exec(s)?.[0] ?? "";
  s = s.slice(0, s.length - have.length).replace(/^[.\s]+/, "").replace(/[.\s]+$/, "");
  if (!s) { s = fallback.replace(/[^A-Za-z0-9_-]/g, "_") || "map"; have = ""; }
  if (RESERVED.test(s)) s = `_${s}`;
  if ([...s].length > 120) s = [...s].slice(0, 120).join("").trimEnd();
  return s + (have || ext);
}

/** Where the map goes: `-` for standard output, into a folder named (or one ending in a slash), else the file named. */
export function outputPath(out: string | undefined, name: string): string {
  if (!out) return name;
  if (out === STDIO) return STDIO;
  if (/[\\/]$/.test(out) || (existsSync(out) && statSync(out).isDirectory())) return join(out, name);
  return out;
}

export interface FetchResult { id: string; url: string; info: MapInfo; report: MapReport; written: Written }

/**
 * One map from the site into `out` (see `outputPath`): its details, then its bytes, opened as the editor opens a map
 * before anything is written. An existing file is refused unless `force`, before the download.
 */
export async function fetchMap(site: Scmscx, id: string, o: { out?: string; force?: boolean; stdout?: Writable } = {}): Promise<FetchResult> {
  const info = await site.mapInfo(id, true);
  const name = safeFileName(info.fileNames[0] ?? info.name, info.version, id);
  const path = outputPath(o.out, name);
  if (path !== STDIO && existsSync(path) && !o.force) throw new CliError(`${path} is there already`, "--force overwrites it, --out names another file or folder.", 2);
  const bytes = await site.file(info.mpqHash);
  if (!looksLikeMpq(bytes)) throw new CliError(`What scmscx.com sent for ${id} is not a map (${size(bytes.length)}, no archive header)`, "Nothing was written. The site may have changed; please report it: https://github.com/scm-js/scm-js/issues");
  const input: Input = { path, name, bytes, kind: "map" };
  let report: MapReport;
  try { report = mapReport(input, await loadMapInput(input)); } catch (e) {
    if (e instanceof CliError) throw new CliError(`What scmscx.com sent for ${id} is not a map this can read: ${e.message.replace(/^.*? is not a map this can read: /, "")}`, "Nothing was written.");
    throw e;
  }
  const written = await writeOutput(bytes, path, o.stdout);
  return { id, url: info.url, info, report, written };
}

/** What `map info` says first — the name, the map, the file — then where it came from and where it went. */
export function printFetched(r: FetchResult): string[] {
  const where = r.written.path === STDIO ? "standard output" : pc.cyan(r.written.path);
  return [
    pc.bold(gameText(r.report.name) || pc.italic("Untitled")),
    ...rows([
      ["Map", `${r.report.width} × ${r.report.height}${dot}${r.report.tileset}${dot}${r.report.version}`],
      ["File", `${r.report.file.name}${dot}${size(r.report.file.bytes)}`],
      ["From", `${pc.cyan(r.url)}${r.info.uploadedBy ? `${dot}uploaded by ${r.info.uploadedBy}` : ""}${dot}${plural(r.info.downloads, "download")}`],
    ]),
    `${mark.ok} Written to ${where}`,
  ];
}

export function fetchJson(r: FetchResult) {
  return {
    id: r.id, url: r.url, name: r.report.name, width: r.report.width, height: r.report.height, tileset: r.report.tileset, version: r.report.version,
    file: r.report.file.name, uploadedBy: r.info.uploadedBy, downloads: r.info.downloads, written: r.written,
  };
}
