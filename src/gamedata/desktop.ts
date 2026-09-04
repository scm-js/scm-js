/**
 * What the desktop build's preload script puts on `window.scmjsDesktop`. The renderer is
 * the same bundle as the web app; this is what it can do that a browser cannot — ask the
 * main process to look for a StarCraft installation on disk and extract from it, and take
 * over the window's close button so a map with unsaved changes is asked about first.
 * Keep this in step with `desktop/preload.ts`.
 */

export type DesktopLocateResult =
  | { status: "ready"; from: string; files: number; bytes: number; at: string; /** Archives that could not be opened on the way, if any. */ problems?: string[] }
  | { status: "missing"; searched: string[] }
  | { status: "failed"; message: string };

/** Where the desktop build found the game: its executable and its Maps folder, if any. */
export interface DesktopGameInfo {
  /** The game executable, or null when none of the searched folders holds one. */
  exe: string | null;
  /** The game's Maps folder (created on first use when the install is known), or null. */
  mapsDir: string | null;
  installDir: string | null;
  searched: string[];
}

export interface DesktopTestResult {
  /** Where the map was written. */
  path: string;
  launched: boolean;
  /** Why the game was not launched, when it was asked for. */
  message?: string;
}

/** What this build can do about updates — see `desktop/updater.ts` for the table behind it. */
export interface UpdateSupport {
  /** Whether the feed can be asked at all (false in an unpackaged development build). */
  check: boolean;
  /**
   * Whether a downloaded update could actually be applied. False on macOS until there is a
   * signing identity, on a Linux package install (only the AppImage updates itself), and in
   * development. The dialog offers the release page instead of a progress bar.
   */
  install: boolean;
  /** Why `install` is false, in words for the dialog. */
  reason?: string;
  releasesUrl: string;
}

export type UpdateAvailability =
  | { status: "available"; current: string; support: UpdateSupport; version: string; notes?: string; date?: string; bytes?: number }
  | { status: "current"; current: string; support: UpdateSupport }
  /** The feed cannot be asked at all; `support.reason` says why. */
  | { status: "unsupported"; current: string; support: UpdateSupport }
  /** Offline, or the feed answered something unusable. An ordinary state, not a crash. */
  | { status: "error"; current: string; support: UpdateSupport; message: string };

export interface UpdateProgress {
  /** 0–100. */
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

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
  /** Map files the operating system hands the app: a double-click, "Open with", a path on the command line. */
  files: {
    /** A file arrived; open it the way File ▸ Open does. Fires for the file the app was started with once the editor listens. */
    onOpen(listener: (file: { name: string; bytes: Uint8Array }) => void): () => void;
  };
  /**
   * In-app updates (`desktop/updater.ts`). Everything here answers rather than throws —
   * a failed check is a state the dialog shows, not an exception.
   */
  updates: {
    /** What this build can do, without asking the network. */
    support(): Promise<UpdateSupport>;
    /** Ask the feed. `allowPrerelease` is the Preferences tick for nightly builds. */
    check(allowPrerelease: boolean): Promise<UpdateAvailability>;
    /** Download the update the last check found; progress arrives on `onProgress`. */
    download(): Promise<{ ok: boolean; message?: string }>;
    /** Quit and apply what was downloaded. The caller has already asked about unsaved changes. */
    install(): Promise<void>;
    /** Open the releases page in the browser — every case that cannot install. */
    openReleases(url?: string): Promise<void>;
    onProgress(listener: (progress: UpdateProgress) => void): () => void;
    onDownloaded(listener: () => void): () => void;
    onError(listener: (message: string) => void): () => void;
  };
  /** Tools ▸ Test Map: hand the map to the installed game. */
  game: {
    /** Look for the game (its executable and Maps folder) in the usual places, or under `dir` when given. */
    info(dir?: string): Promise<DesktopGameInfo>;
    /** A native folder dialog for the game's folder. `null` when dismissed. */
    pickFolder(): Promise<string | null>;
    /**
     * Write the map into the `scmJS` folder under the Maps folder (`dir` names the game or
     * Maps folder; the located one when omitted) and, when asked, start the game.
     */
    test(bytes: Uint8Array, fileName: string, options: { dir?: string; launch: boolean }): Promise<DesktopTestResult>;
  };
}

/** The bridge, or null in a browser. */
export function desktopBridge(): DesktopBridge | null {
  return (globalThis as { scmjsDesktop?: DesktopBridge }).scmjsDesktop ?? null;
}
