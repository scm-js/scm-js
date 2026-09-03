/**
 * Where the game data comes from. The loaders (`formats/tileset/load.ts`,
 * `formats/units/load.ts`) fetch every file through `fetchAsset`, which resolves the
 * source once per session and remembers it:
 *
 *   1. bundled — `public/` in this build (a clone that ran `npm run extract`, or the
 *                desktop app's own copy, served under the same base by its protocol)
 *   2. stored  — a copy an earlier install left in the browser (`store.ts`)
 *   3. desktop — the desktop app searches the disk and extracts, then it is 1 again
 *   4. none    — the editor runs with flat colours and marker units, and asks
 *
 * There is deliberately no fifth step. The editor used to also carry a configured web
 * address (a `VITE_GAME_DATA_URL` build default and a preference over it) serving either
 * an extracted tree or the two archives; it was dropped once Blizzard's own free StarEdit
 * package became installable in one click (`install.ts#installFromZipUrl`), because the
 * chain reaching a dead end and asking is easier to explain than four ways of not being
 * asked. Getting the files is now something the user does, on step 4, from Help ▸ Game
 * Data… — never a silent fetch from an address they did not name.
 *
 * `locateGameData` is the chain over injected probes so the order can be tested without a
 * browser.
 */
import { desktopBridge, type DesktopBridge } from "./desktop";
import { readStored, storedCopy, type StoredCopy } from "./store";

export type SourceKind = "bundled" | "stored" | "none";

export interface AssetSource {
  kind: SourceKind;
  /** URL prefix the files are fetched under (bundled), ending in `/`. */
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

/* ── The chain ──────────────────────────────────────────── */

export interface LocateDeps {
  bundledBase: string;
  /** True when a GET of `url` answers JSON — the manifest probe. A dev server answers index.html for anything, so a 200 alone means nothing. */
  probeManifest(url: string): Promise<boolean>;
  stored(): Promise<StoredCopy | null>;
  desktop: DesktopBridge | null;
}

const describeStored = (copy: StoredCopy) =>
  copy.where === "opfs" ? `Copy kept in this browser (${megabytes(copy.bytes)}, from ${copy.from})` : `Copy held for this session (${megabytes(copy.bytes)}, from ${copy.from})`;

export function megabytes(bytes: number): string {
  return `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;
}

/** Run the chain. `report` gets the one slow step's progress (the desktop extraction). */
export async function locateGameData(deps: LocateDeps, report?: InstallProgressLike): Promise<AssetSource> {
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

  // 3. The desktop app: the disk, then the files are served as bundled. Silent when it
  //    works — a user whose StarCraft folder is where the game puts it never hears about
  //    any of this.
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

  return { kind: "none", label: "No game data", tried };
}

/** `install.ts`'s progress shape, repeated so this module does not import it. */
type InstallProgressLike = (fraction: number, label: string) => void;

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

function defaultDeps(options: ResolveOptions = {}): LocateDeps {
  return {
    bundledBase: import.meta.env.BASE_URL,
    probeManifest,
    stored: storedCopy,
    desktop: options.search === false ? null : desktopBridge(),
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
export function resolveAssetSource(report?: InstallProgressLike, options?: ResolveOptions): Promise<AssetSource> {
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

/** Called when the source changes — the dialog installed something, or a copy was removed. */
export function onAssetSource(listener: (source: AssetSource) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Forget the resolution so the next `fetchAsset` runs the chain again (after an install or a clear). */
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
