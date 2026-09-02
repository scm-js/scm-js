/**
 * What the desktop build's preload script puts on `window.scmjsDesktop`. The renderer is
 * the same bundle as the web app; this is what it can do that a browser cannot — ask the
 * main process to look for a StarCraft installation on disk and extract from it, and take
 * over the window's close button so a map with unsaved changes is asked about first.
 * Keep this in step with `desktop/preload.ts`.
 */

export type DesktopLocateResult =
  | { status: "ready"; from: string; files: number; bytes: number; at: string }
  | { status: "missing"; searched: string[] }
  | { status: "failed"; message: string };

export interface DesktopBridge {
  platform: string;
  version: string;
  /**
   * The close guard. A browser can only ask its own generic "leave site?" question, so the
   * desktop build hands the decision back to the editor: the renderer says whether closing
   * should ask (`setDirty`), the main process holds the close back when it should and calls
   * `onCloseRequest`, and the editor answers with `respondClose` once the user has chosen.
   */
  window: {
    /** Whether closing this window should ask first — `needsCloseConfirm` in the renderer. */
    setDirty(dirty: boolean): void;
    /** The window was asked to close while dirty; answer with `respondClose`. */
    onCloseRequest(listener: () => void): () => void;
    /** true closes the window (quitting the app when the close was a quit), false keeps it open. */
    respondClose(close: boolean): void;
  };
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
