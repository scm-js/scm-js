/**
 * What the desktop build's preload script puts on `window.scmjsDesktop`. The renderer is
 * the same bundle as the web app; this is the one thing it can do that a browser cannot —
 * ask the main process to look for a StarCraft installation on disk and extract from it.
 * Keep this in step with `desktop/preload.ts`.
 */

export type DesktopLocateResult =
  | { status: "ready"; from: string; files: number; bytes: number; at: string }
  | { status: "missing"; searched: string[] }
  | { status: "failed"; message: string };

export interface DesktopBridge {
  platform: string;
  version: string;
  gameData: {
    /** Whether the app's own copy is in place; never searches or extracts. */
    status(): Promise<DesktopLocateResult>;
    /** Search the usual places (and the app's own folder) for the archives and extract from the first that has them. */
    locate(): Promise<DesktopLocateResult>;
    /** A native folder dialog, then extraction from that folder. `null` when dismissed. */
    pickFolder(): Promise<DesktopLocateResult | null>;
    /** Remove the app's copy. */
    clear(): Promise<void>;
    /** Extraction progress, while `locate` or `pickFolder` runs. */
    onProgress(listener: (fraction: number, label: string) => void): () => void;
    /** The directories `locate` looks in, for the dialog to list. */
    searchDirs(): Promise<string[]>;
  };
}

/** The bridge, or null in a browser. */
export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { scmjsDesktop?: DesktopBridge }).scmjsDesktop ?? null;
}
