import { buildAtlas, type TilesetAtlas } from "./atlas";
import { cycleBands } from "./cycle";
import { loadTileset, type Tileset } from "./decode";
import { buildDoodadCatalogue, DDDATA_SIZE, type DoodadCatalogue } from "./doodads";
import { decodeTbl } from "../dat/tbl";

/** ERA index order, which is also the on-disk file basename in `tileset/`. */
export const TILESET_FILENAMES = [
  "badlands",
  "platform",
  "install",
  "ashworld",
  "jungle",
  "desert",
  "ice",
  "twilight",
] as const;

export type TilesetFileName = (typeof TILESET_FILENAMES)[number];

/** Where the extracted tileset files are served from. See scripts/extract-tilesets.mjs. */
const BASE = `${import.meta.env.BASE_URL}tileset/`;

export interface LoadedTileset {
  name: TilesetFileName;
  tileset: Tileset;
  atlas: TilesetAtlas;
  /** The doodads the CV5 holds, with their placement rules when `<name>.dddata.bin` was extracted. */
  doodads: DoodadCatalogue;
}

const cache = new Map<TilesetFileName, Promise<LoadedTileset>>();

export class TilesetMissingError extends Error {
  readonly tileset: TilesetFileName;

  constructor(tileset: TilesetFileName, cause?: unknown) {
    super(
      `Tileset "${tileset}" is not available. Run scripts/extract-tilesets.mjs against a StarCraft install to populate public/tileset/.`,
      { cause },
    );
    this.name = "TilesetMissingError";
    this.tileset = tileset;
  }
}

/* ── Load progress ──────────────────────────────────────── */

export interface TilesetProgress {
  tileset: TilesetFileName;
  /** Bytes received so far, and the total announced by the parts fetched so far. */
  loaded: number;
  total: number;
}

const progressListeners = new Set<(p: TilesetProgress) => void>();

/**
 * Watch tileset downloads. This is a module-level subscription rather than an argument to
 * `getTileset` because the loader shares one promise per tileset: whoever asks second
 * would otherwise get no progress at all, and the caller that wants to *show* progress
 * (the splash preload) is not reliably the caller that starts the load.
 */
export function onTilesetProgress(listener: (p: TilesetProgress) => void): () => void {
  progressListeners.add(listener);
  return () => { progressListeners.delete(listener); };
}

/** Per-load byte tally, threaded through the parts of one tileset. */
interface Tally { tileset: TilesetFileName; loaded: number; total: number; emitted: number }

/**
 * Bodies arrive in many small chunks and the listener drives a React render, so emitting
 * on every chunk costs far more than the download does. Coalesce to roughly one update
 * per frame; `force` flushes the last one.
 */
const PROGRESS_MS = 50;

function report(tally: Tally | null, force = false) {
  if (!tally || progressListeners.size === 0) return;
  const now = performance.now();
  if (!force && now - tally.emitted < PROGRESS_MS) return;
  tally.emitted = now;
  const { tileset, loaded, total } = tally;
  for (const l of progressListeners) l({ tileset, loaded, total });
}

/**
 * A dev server answers a missing asset with the SPA index.html and a 200, so a plain
 * `res.ok` check is not enough — every part is size-checked against its format.
 *
 * When a `tally` is given the body is read chunk by chunk so the bytes can be counted as
 * they land; `arrayBuffer()` would only tell us the size once it was already all here.
 */
async function fetchPart(name: string, check: (data: Uint8Array) => boolean, tally: Tally | null = null): Promise<Uint8Array> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const data = tally && res.body ? await readCounted(res, tally) : new Uint8Array(await res.arrayBuffer());
  if (!check(data)) throw new Error(`${name}: not a tileset file (${data.length} bytes)`);
  return data;
}

async function readCounted(res: Response, tally: Tally): Promise<Uint8Array> {
  const length = Number(res.headers.get("content-length") ?? 0);
  tally.total += length;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    tally.loaded += value.length;
    report(tally);
  }
  // A gzipped or chunked response can outrun its announced length; keep the total honest.
  if (size > length) tally.total += size - length;
  report(tally, true);
  const data = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { data.set(c, at); at += c.length; }
  return data;
}

const isPalette = (d: Uint8Array) => d.length === 1024;
const isCv5 = (d: Uint8Array) => d.length > 0 && d.length % 52 === 0;
const isVf4 = (d: Uint8Array) => d.length > 0 && d.length % 32 === 0;
const isVr4 = (d: Uint8Array) => d.length > 0 && d.length % 64 === 0;
const isVx4 = (d: Uint8Array) => d.length > 0 && d.length % 32 === 0;
const isVx4Ex = (d: Uint8Array) => d.length > 0 && d.length % 64 === 0;
const isDdData = (d: Uint8Array) => d.length === DDDATA_SIZE;
const isTbl = (d: Uint8Array) => d.length > 2 && (d[0] | (d[1] << 8)) > 0;

/** `stat_txt.tbl` (doodad category names) is shared by every tileset, so it is fetched once. */
let statTxt: Promise<string[] | null> | null = null;
function getStatTxt(): Promise<string[] | null> {
  statTxt ??= fetchOptional("stat_txt.tbl", isTbl).then((d) => (d ? decodeTbl(d) : null));
  return statTxt;
}

async function fetchOptional(name: string, check: (data: Uint8Array) => boolean, tally: Tally | null = null): Promise<Uint8Array | null> {
  try {
    return await fetchPart(name, check, tally);
  } catch {
    return null;
  }
}

/** Fetch, decode and rasterise a tileset. Repeat calls share one in-flight promise. */
export function getTileset(name: TilesetFileName): Promise<LoadedTileset> {
  const existing = cache.get(name);
  if (existing) return existing;

  const loading = (async (): Promise<LoadedTileset> => {
    const tally: Tally = { tileset: name, loaded: 0, total: 0, emitted: 0 };
    try {
      // Remastered ships .vx4ex alongside .vx4; prefer it when it was extracted.
      const [cv5, vf4, vr4, wpe, vx4ex, dddata, names] = await Promise.all([
        fetchPart(`${name}.cv5`, isCv5, tally),
        fetchPart(`${name}.vf4`, isVf4, tally),
        fetchPart(`${name}.vr4`, isVr4, tally),
        fetchPart(`${name}.wpe`, isPalette, tally),
        fetchOptional(`${name}.vx4ex`, isVx4Ex, tally),
        // Optional: an older extraction has no dddata.bin (doodads then place anywhere) or names.
        fetchOptional(`${name}.dddata.bin`, isDdData, tally),
        getStatTxt(),
      ]);
      const vx4 = vx4ex ?? (await fetchPart(`${name}.vx4`, isVx4, tally));

      const tileset = loadTileset({ cv5, vf4, vr4, wpe, vx4, vx4Extended: vx4ex !== null });
      const doodads = buildDoodadCatalogue(tileset, dddata, names);
      return { name, tileset, atlas: await buildAtlas(tileset, cycleBands(TILESET_FILENAMES.indexOf(name))), doodads };
    } catch (err) {
      cache.delete(name); // let a later attempt retry after the files are installed
      throw new TilesetMissingError(name, err);
    }
  })();

  cache.set(name, loading);
  return loading;
}

/** Already-resolved tileset, for synchronous render paths. */
const ready = new Map<TilesetFileName, LoadedTileset>();

export function peekTileset(name: TilesetFileName): LoadedTileset | null {
  return ready.get(name) ?? null;
}

export async function ensureTileset(name: TilesetFileName): Promise<LoadedTileset> {
  const loaded = await getTileset(name);
  ready.set(name, loaded);
  return loaded;
}

/** Install an already-decoded tileset as if it had been fetched (tests, or a loader that read the files itself). */
export function primeTileset(loaded: LoadedTileset) {
  cache.set(loaded.name, Promise.resolve(loaded));
  ready.set(loaded.name, loaded);
}
