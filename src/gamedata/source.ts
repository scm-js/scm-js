/**
 * Where the game data comes from. The loaders (`formats/tileset/load.ts`,
 * `formats/units/load.ts`) fetch every file through `fetchAsset`, which resolves the
 * source once per session and remembers it:
 *
 *   1. bundled  — `public/` in this build (a clone that ran `npm run extract`, or the
 *                 desktop app's own copy, served under the same base by its protocol)
 *   2. stored   — a copy an earlier upload or download left in the browser (`store.ts`)
 *   3. desktop  — the desktop app searches the disk and extracts, then it is 1 again
 *   4. remote   — the configured URL: either the extracted tree (`tileset/manifest.json`
 *                 answers) fetched file by file, or the two archives, downloaded once,
 *                 extracted here and kept as 2
 *   5. none     — the editor runs with flat colours and marker units, and asks
 *
 * The configured URL is Preferences ▸ Game data, else the build's `VITE_GAME_DATA_URL`
 * (the hosted build sets it; a desktop build does not, so it asks). `locateGameData` is
 * the chain over injected probes so the order can be tested without a browser.
 */
import { storedPreference } from "../atoms/preferencesAtoms";
import { desktopBridge, type DesktopBridge } from "./desktop";
import { installFromUrl, type InstallProgress } from "./install";
import { readStored, storedCopy, type StoredCopy } from "./store";

export type SourceKind = "bundled" | "stored" | "remote" | "none";

export interface AssetSource {
  kind: SourceKind;
  /** URL prefix the files are fetched under (bundled / remote), ending in `/`. */
  base?: string;
  /** One line for the dialog and the status bar. */
  label: string;
  /** What was tried on the way, for the dialog to explain a `none`. */
  tried: string[];
  /** The stored copy's stamp, when that is what answers. */
  stored?: StoredCopy;
  /** Set when the desktop app extracted the files into its own data folder (served as bundled). */
  desktop?: true;
}

/** The default URL baked into this build, or "". */
export const BUILD_GAME_DATA_URL: string = (import.meta.env.VITE_GAME_DATA_URL as string | undefined)?.trim() ?? "";

/** A URL as a base: trimmed, with one trailing slash; "" stays "". */
export function normalizeBase(url: string): string {
  const s = url.trim();
  if (!s) return "";
  return s.endsWith("/") ? s : `${s}/`;
}

/** Preferences first, then the build's default. */
export function configuredGameDataUrl(): string {
  return normalizeBase(storedPreference("gameDataUrl", "") || BUILD_GAME_DATA_URL);
}

/* ── The chain ──────────────────────────────────────────── */

export interface LocateDeps {
  bundledBase: string;
  /** True when a GET of `url` answers JSON — the manifest probe. A dev server answers index.html for anything, so a 200 alone means nothing. */
  probeManifest(url: string): Promise<boolean>;
  /** True when a GET of `url` answers with something that is not a web page. */
  probeFile(url: string): Promise<boolean>;
  stored(): Promise<StoredCopy | null>;
  desktop: DesktopBridge | null;
  configuredUrl: string;
  installFromUrl(base: string, progress?: InstallProgress): Promise<StoredCopy>;
}

const describeStored = (copy: StoredCopy) =>
  copy.where === "opfs" ? `Copy kept in this browser (${megabytes(copy.bytes)}, from ${copy.from})` : `Copy held for this session (${megabytes(copy.bytes)}, from ${copy.from})`;

export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

/** Run the chain. `report` gets the slow steps' progress (a desktop extraction, a download). */
export async function locateGameData(deps: LocateDeps, report?: InstallProgress): Promise<AssetSource> {
  const tried: string[] = [];
  const bundled = async () =>
    (await deps.probeManifest(`${deps.bundledBase}tileset/manifest.json`)) || (await deps.probeManifest(`${deps.bundledBase}unit/manifest.json`));

  // 1. This build's own files.
  if (await bundled()) return { kind: "bundled", base: deps.bundledBase, label: "Bundled with this build", tried };
  tried.push("Nothing bundled with this build");

  // 2. A copy an earlier install left here.
  const copy = await deps.stored().catch(() => null);
  if (copy) return { kind: "stored", label: describeStored(copy), tried, stored: copy };
  tried.push("No copy kept in the browser");

  // 3. The desktop app: the disk, then the files are served as bundled.
  if (deps.desktop) {
    report?.(0, "Looking for a StarCraft installation");
    const off = deps.desktop.gameData.onProgress((f, label) => report?.(f, label));
    try {
      const found = await deps.desktop.gameData.locate();
      if (found.status === "ready") return { kind: "bundled", base: deps.bundledBase, label: `Extracted from ${found.from}`, tried, desktop: true };
      tried.push(found.status === "missing" ? `No StarCraft archives in ${found.searched.length} places on this computer` : `Extraction failed: ${found.message}`);
    } catch (err) {
      tried.push(`Desktop search failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      off();
    }
  }

  // 4. The configured address.
  const url = normalizeBase(deps.configuredUrl);
  if (url) {
    const remote = await fromUrl(deps, url, tried, report);
    if (remote) return remote;
  } else {
    tried.push("No web address configured");
  }

  return { kind: "none", label: "No game data", tried };
}

/**
 * The address step on its own: the extracted tree if `tileset/manifest.json` answers,
 * else the archives if `StarDat.mpq` does (downloaded and extracted into the stored
 * copy). Null when neither, with the reason pushed onto `tried`.
 */
export async function fromUrl(deps: Pick<LocateDeps, "probeManifest" | "probeFile" | "installFromUrl">, url: string, tried: string[], report?: InstallProgress): Promise<AssetSource | null> {
  try {
    if (await deps.probeManifest(`${url}tileset/manifest.json`)) return { kind: "remote", base: url, label: url, tried };
    if (await deps.probeFile(`${url}StarDat.mpq`)) {
      const stored = await deps.installFromUrl(url, report);
      return { kind: "stored", label: describeStored(stored), tried, stored };
    }
    tried.push(`Nothing at ${url} (neither tileset/manifest.json nor StarDat.mpq answered)`);
  } catch (err) {
    tried.push(`${url}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/** The dialog's "Use this address": the URL step alone, made the session's source when it answers. */
export async function adoptGameDataUrl(url: string, report?: InstallProgress): Promise<AssetSource | null> {
  const tried: string[] = [];
  const source = await fromUrl(defaultDeps(), normalizeBase(url), tried, report);
  if (source) setAssetSource(source);
  else if (tried.length) throw new Error(tried[tried.length - 1]);
  return source;
}

/** A stored copy just written by the dialog, made the session's source. */
export function adoptStoredCopy(copy: StoredCopy): AssetSource {
  const source: AssetSource = { kind: "stored", label: describeStored(copy), tried: [], stored: copy };
  setAssetSource(source);
  return source;
}

/* ── The session's source ───────────────────────────────── */

async function probeManifest(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return false;
    const data: unknown = JSON.parse(await res.text());
    return typeof data === "object" && data !== null;
  } catch {
    return false;
  }
}

async function probeFile(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" }).catch(() => fetch(url, { headers: { Range: "bytes=0-3" } }));
    if (!res.ok) return false;
    const type = res.headers.get("content-type") ?? "";
    if (res.body && res.headers.get("content-length") === null) await res.body.cancel();
    return !type.includes("text/html");
  } catch {
    return false;
  }
}

function defaultDeps(options: ResolveOptions = {}): LocateDeps {
  return {
    bundledBase: import.meta.env.BASE_URL,
    probeManifest,
    probeFile,
    stored: storedCopy,
    desktop: options.search === false ? null : desktopBridge(),
    configuredUrl: configuredGameDataUrl(),
    installFromUrl,
  };
}

export interface ResolveOptions {
  /**
   * `false` leaves the desktop app's disk search out — after the user removes the app's
   * copy, running it again would only extract the same files back before they could
   * choose somewhere else.
   */
  search?: boolean;
}

let resolving: Promise<AssetSource> | null = null;
let current: AssetSource | null = null;
const listeners = new Set<(source: AssetSource) => void>();

/**
 * The session's source, resolved once; every caller shares the one run. `report` only
 * reaches the run that starts it (the startup preload), which is where progress shows.
 */
export function resolveAssetSource(report?: InstallProgress, options?: ResolveOptions): Promise<AssetSource> {
  if (!resolving) {
    resolving = locateGameData(defaultDeps(options), report).then((source) => {
      current = source;
      for (const l of listeners) l(source);
      return source;
    });
  }
  return resolving;
}

/** The resolved source, or null while (or before) it resolves. */
export function currentAssetSource(): AssetSource | null {
  return current;
}

/** Called when the source changes — the dialog installed something, or a preference moved. */
export function onAssetSource(listener: (source: AssetSource) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Forget the resolution so the next `fetchAsset` runs the chain again (after an install, a clear or a URL change). */
export function resetAssetSource(): void {
  resolving = null;
  current = null;
}

/** Make `source` the session's source without running the chain — an install just produced it. */
export function setAssetSource(source: AssetSource): void {
  resolving = Promise.resolve(source);
  current = source;
  for (const l of listeners) l(source);
}

export class GameDataUnavailableError extends Error {
  constructor(path: string) {
    super(`${path}: no game data source (Help ▸ Game Data…)`);
    this.name = "GameDataUnavailableError";
  }
}

/** Fetch one game-data file (`tileset/badlands.cv5`, `unit/…`) from wherever this session's source is. */
export async function fetchAsset(path: string, init?: RequestInit): Promise<Response> {
  const source = await resolveAssetSource();
  switch (source.kind) {
    case "bundled":
    case "remote":
      return fetch(source.base + path, init);
    case "stored": {
      const blob = await readStored(path);
      if (!blob) return new Response(null, { status: 404, statusText: "Not in the stored copy" });
      return new Response(blob, { status: 200, headers: { "content-length": String(blob.size) } });
    }
    case "none":
      throw new GameDataUnavailableError(path);
  }
}
