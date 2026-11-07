/**
 * scmscx.com, the community's map database, from Node. The site has no documented API: these are the routes its own
 * pages use (the editor's scmscx plugin and scm-server use the same), so every route is in this file and a change on
 * the site is one edit here. Node needs no forwarder (the browser does, for want of CORS headers). Every request
 * gives up after `timeout` without an answer — before the headers, or between two pieces of a download — and
 * nothing is cached.
 */
import { VERSION } from "./about";
import { CliError } from "./ui";

export const SCMSCX = "https://scmscx.com";
export const TIMEOUT_MS = 10_000;
export const USER_AGENT = `scmjs/${VERSION} (+https://docs.scmjs.dev/cli/)`;

/** The routes, as verified against the site on 2026-11-07 (.claude/internals/cli.md). */
export const ROUTES = {
  /** `{ maps: [{ id, filename, scenario_name, last_modified, uploaded_time }], total_results }`, a row per file name, 300 a page. */
  search: (words: string) => `/api/uiv2/search/${encodeURIComponent(words)}`,
  /** `{ scenario, scenario_description, player_owners, forces, meta: { mpq_hash, mpq_size, downloads, views, … }, properties: { width, height, tileset, ver, … } }`; 500 for an unknown id. */
  mapInfo: (id: string) => `/api/uiv2/map_info/${encodeURIComponent(id)}`,
  /** `[{ filename, modified_time }]`, every name the site has seen the map under. */
  fileNames: (id: string) => `/api/uiv2/filenames2/${encodeURIComponent(id)}`,
  /** The archive as uploaded; 404 for an unknown hash. */
  file: (mpqHash: string) => `/api/maps/${encodeURIComponent(mpqHash)}`,
  /** The map's page on the site, for people. */
  page: (id: string) => `/map/${encodeURIComponent(id)}`,
};

export interface ScmscxOptions {
  /** The site's address; another one only in tests. */
  base?: string;
  timeout?: number;
  fetch?: typeof fetch;
}

/** One map among the matches: the site lists a map once per file name, merged here. */
export interface SearchRow { id: string; name: string; fileNames: string[] }
export interface SearchResult { rows: SearchRow[]; /** Rows the site matched, a row per file name. */ total: number }

export interface MapInfo {
  id: string;
  name: string;
  mpqHash: string;
  /** The archive's size in bytes. */
  bytes: number;
  width: number;
  height: number;
  /** ERA: 0 Badlands … 7 Twilight. */
  tileset: number;
  /** The VER section: 59, 63, 205 or 206. */
  version: number;
  humans: number;
  computers: number;
  downloads: number;
  views: number;
  uploadedBy: string;
  /** Unix seconds, or null. */
  uploaded: number | null;
  /** The names the site has seen it under, each once, as the site lists them; empty unless asked for. */
  fileNames: string[];
  url: string;
}

const HUMAN = 6, COMPUTER = 5;

/** StarCraft's colour and control bytes out, for a name that is shown as plain text. */
export const plainName = (s: unknown): string => (typeof s === "string" ? s.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim() : ""); // eslint-disable-line no-control-regex

export function scmscx(options: ScmscxOptions = {}) {
  const base = (options.base ?? SCMSCX).replace(/\/+$/, "");
  const timeout = options.timeout ?? TIMEOUT_MS;
  const fetchFn = options.fetch ?? fetch;
  const site = new URL(base).host;

  /** The body of `path`, or a CliError saying what the site did. `missing` is the error for an unknown map. */
  async function get(path: string, accept: string, missing: (status: number) => boolean = (s) => s === 404): Promise<Uint8Array> {
    const control = new AbortController();
    let timedOut = false;
    let timer = setTimeout(() => { timedOut = true; control.abort(); }, timeout);
    const again = () => { clearTimeout(timer); timer = setTimeout(() => { timedOut = true; control.abort(); }, timeout); };
    const down = (e: unknown) => timedOut
      ? new CliError(`${site} did not answer within ${timeout / 1000} seconds`, `Try again later, or see whether ${base} is up.`)
      : new CliError(`${site} could not be reached (${(e as { cause?: { code?: string } })?.cause?.code ?? (e instanceof Error ? e.message : e)})`, "Check the connection, or try again later.");
    try {
      let res: Response;
      try { res = await fetchFn(`${base}${path}`, { headers: { accept, "user-agent": USER_AGENT }, signal: control.signal }); } catch (e) { throw down(e); }
      if (missing(res.status)) throw new CliError(`${site} has no such map`, "The id is the last part of the map's address on the site: scmscx.com/map/<id>.");
      if (!res.ok) throw new CliError(`${site} answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`, `Try again later, or see whether ${base} is up.`);
      const chunks: Uint8Array[] = [];
      try {
        if (res.body) for await (const c of res.body as unknown as AsyncIterable<Uint8Array>) { chunks.push(c); again(); }
      } catch (e) { throw down(e); }
      return new Uint8Array(Buffer.concat(chunks));
    } finally { clearTimeout(timer); }
  }

  async function json(path: string, missing?: (status: number) => boolean): Promise<unknown> {
    const bytes = await get(path, "application/json", missing);
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new CliError(`${site} answered with something that is not JSON`, "The site may have changed; please report it: https://github.com/scm-js/scm-js/issues"); }
  }

  return {
    base,
    pageUrl: (id: string) => `${base}${ROUTES.page(id)}`,

    /** The site's best matches for the words (its relevance order), a row per map. */
    async search(words: string): Promise<SearchResult> {
      const body = await json(ROUTES.search(words)) as { maps?: unknown; total_results?: unknown };
      if (!body || !Array.isArray(body.maps)) throw new CliError(`${site} answered the search with something unexpected`, "The site may have changed; please report it: https://github.com/scm-js/scm-js/issues");
      const byId = new Map<string, SearchRow>();
      for (const r of body.maps as { id?: unknown; filename?: unknown; scenario_name?: unknown }[]) {
        if (!r || typeof r.id !== "string" || !r.id) continue;
        const file = typeof r.filename === "string" && r.filename ? r.filename : null;
        let row = byId.get(r.id);
        if (!row) byId.set(r.id, row = { id: r.id, name: plainName(r.scenario_name) || file || r.id, fileNames: [] });
        if (file && !row.fileNames.includes(file)) row.fileNames.push(file);
      }
      return { rows: [...byId.values()], total: typeof body.total_results === "number" ? body.total_results : body.maps.length };
    },

    /** What the site knows of a map; with `names`, the file names it has seen it under too (one more request). */
    async mapInfo(id: string, names = false): Promise<MapInfo> {
      // An id the site cannot read is a 500 from this route, not a 404.
      const raw = await json(ROUTES.mapInfo(id), (s) => s === 404 || s === 500) as {
        scenario?: unknown; player_owners?: unknown;
        meta?: { mpq_hash?: unknown; mpq_size?: unknown; downloads?: unknown; views?: unknown; uploaded_by?: unknown; uploaded_time?: unknown };
        properties?: { width?: unknown; height?: unknown; tileset?: unknown; ver?: unknown };
      };
      const meta = raw?.meta ?? {}, props = raw?.properties ?? {};
      if (typeof meta.mpq_hash !== "string" || !meta.mpq_hash) throw new CliError(`${site} answered for ${id} without the map's file`, "The site may have changed; please report it: https://github.com/scm-js/scm-js/issues");
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      const owners = Array.isArray(raw.player_owners) ? raw.player_owners : [];
      let fileNames: string[] = [];
      if (names) {
        try {
          const list = await json(ROUTES.fileNames(id));
          if (Array.isArray(list)) for (const f of list as { filename?: unknown }[]) if (typeof f?.filename === "string" && f.filename && !fileNames.includes(f.filename)) fileNames.push(f.filename);
        } catch { fileNames = []; }
      }
      return {
        id, name: plainName(raw.scenario), mpqHash: meta.mpq_hash, bytes: n(meta.mpq_size),
        width: n(props.width), height: n(props.height), tileset: n(props.tileset), version: n(props.ver),
        humans: owners.filter((o) => o === HUMAN).length, computers: owners.filter((o) => o === COMPUTER).length,
        downloads: n(meta.downloads), views: n(meta.views), uploadedBy: typeof meta.uploaded_by === "string" ? meta.uploaded_by : "",
        uploaded: n(meta.uploaded_time) || null, fileNames, url: `${base}${ROUTES.page(id)}`,
      };
    },

    /** The map's file, the archive as it was uploaded. */
    file: (mpqHash: string) => get(ROUTES.file(mpqHash), "application/octet-stream"),
  };
}

export type Scmscx = ReturnType<typeof scmscx>;
