/**
 * In-app updates for the desktop build (`electron-updater` over the GitHub releases the
 * workflow publishes — see `.github/workflows/build.yml`).
 *
 * The feed is `latest.yml` / `latest-mac.yml` / `latest-linux.yml`, which electron-builder
 * writes beside the installers because `electron-builder.yml` carries a `publish:` block;
 * the same block bakes `app-update.yml` into the asar, which is how this knows the
 * repository. Version comparison is the `version` field inside those files, not the git
 * tag, so the rolling `nightly` tag is not a problem — and because the assets are named
 * without a version in them, the download URL under that tag is always the current one.
 *
 * What can actually install, and why the renderer is told:
 *
 *   Windows (NSIS)     yes, unsigned. SmartScreen prompts, the update still applies.
 *   Linux AppImage     yes, when the app was started from the .AppImage.
 *   Linux deb/rpm      yes — electron-updater installs through dpkg/apt, asking for
 *                      privileges. It needs the `package-type` file the package carries.
 *   Linux unpacked     no, and it cannot even check: see `support()`.
 *   macOS              checks, but cannot install until there is a signing identity —
 *                      Squirrel.Mac verifies the code signature.
 *   unpackaged (dev)   no — electron-updater skips a check when `app.isPackaged` is false.
 *
 * Everything that cannot install still *checks*, so the app can say a version exists and
 * point at the release page. `UpdateSupport.install` is what the dialog reads to decide
 * between a Download button and an Open download page link; it never offers a progress
 * bar that is going to fail at the end.
 */
import { app, ipcMain, shell, type BrowserWindow } from "electron";
import type { UpdateAvailability, UpdateProgress, UpdateSupport } from "../src/gamedata/desktop";

/** The releases page, for every case that cannot install and for "what changed". */
const RELEASES_URL = "https://github.com/scm-js/scm-js/releases";

type Updater = import("electron-updater").AppUpdater;

let updater: Updater | null = null;
let loadError: string | null = null;

/**
 * `electron-updater` is required lazily: importing it eagerly costs the main process a
 * chunk of startup for something most launches never use, and `desktop/main.ts` is on the
 * critical path to the first painted frame (see the startup notes in CLAUDE.md).
 */
function get(): Updater | null {
  if (updater || loadError) return updater;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { autoUpdater } = require("electron-updater") as typeof import("electron-updater");
    autoUpdater.autoDownload = false;
    // Nothing is written over the running app until the user asks. After a download they
    // did ask for, letting it apply on quit is the one thing that makes "Later" useful.
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    updater = autoUpdater;
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }
  return updater;
}

/**
 * What this build can do about updates.
 *
 * Whether the feed can be asked at all is `isUpdaterActive()` — the updater's own answer,
 * not a guess from `process.platform`. It matters because electron-updater picks an
 * implementation per platform and package type (NSIS, Mac, AppImage, deb, rpm, pacman) and
 * `AppImageUpdater` is the one that refuses: with no `APPIMAGE` in the environment and no
 * `package-type` beside the resources — a Linux build started from an unpacked folder —
 * `checkForUpdates()` resolves **null** rather than throwing. Reading that null as "you are
 * up to date" is exactly the lie this exists to prevent.
 *
 * Installing is the narrower question, and only macOS fails it: Squirrel.Mac verifies the
 * code signature, so an unsigned build can see an update and not apply it. Windows (NSIS),
 * the AppImage and the .deb package all install what they download — the deb through dpkg
 * or apt, which asks for privileges.
 */
function support(): UpdateSupport {
  if (!app.isPackaged) return { check: false, install: false, reason: "This is a development build.", releasesUrl: RELEASES_URL };
  const up = get();
  if (!up) return { check: false, install: false, reason: loadError ?? "The updater could not be loaded.", releasesUrl: RELEASES_URL };
  if (!up.isUpdaterActive()) {
    const reason = process.platform === "linux"
      ? "scmJS was started from an unpacked folder; only the AppImage and the .deb package can update themselves."
      : "This build cannot check for updates.";
    return { check: false, install: false, reason, releasesUrl: RELEASES_URL };
  }
  if (process.platform === "darwin") {
    return { check: true, install: false, reason: "macOS will not install an unsigned update, and scmJS is not signed yet.", releasesUrl: RELEASES_URL };
  }
  return { check: true, install: true, releasesUrl: RELEASES_URL };
}

/**
 * electron-updater's failures carry the entire HTTP response in `message` — every response
 * header, `Set-Cookie` among them. Putting that in a dialog is both unreadable and a way to
 * show a session cookie on screen, so only the first line survives, and the cases worth
 * naming are named. `HttpError` (builder-util-runtime) carries `statusCode`; Node's socket
 * errors carry a string `code`.
 */
function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const { statusCode, code } = err as { statusCode?: number; code?: string };
  if (statusCode === 404) return "No release was found for this build — it may not have been published yet.";
  if (statusCode === 403) return "GitHub refused the request. It may be rate limiting this address; try again later.";
  if (statusCode !== undefined && statusCode >= 500) return `GitHub answered ${statusCode}. Try again later.`;
  if (code && /^(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ENETUNREACH|EHOSTUNREACH)$/.test(code)) {
    return "Could not reach GitHub. Check the network connection.";
  }
  const first = raw.split("\n", 1)[0].trim();
  if (!first) return "The update check failed.";
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}

/**
 * Ask the feed what is out there. Answers rather than throws: a check that failed because
 * the machine is offline is an ordinary state, not an error the renderer should surface as
 * a crash.
 */
async function check(allowPrerelease: boolean): Promise<UpdateAvailability> {
  const can = support();
  const current = app.getVersion();
  if (!can.check) return { status: "unsupported", current, support: can };
  const up = get();
  if (!up) return { status: "error", current, support: can, message: loadError ?? "The updater could not be loaded." };
  up.allowPrerelease = allowPrerelease;
  try {
    const result = await up.checkForUpdates();
    // A null result means the updater declined to check at all — `support()` should have
    // caught that above, so treat it as "cannot", never as "up to date". Only an
    // `updateInfo` at or below the running version is really nothing to do.
    if (!result) {
      return { status: "unsupported", current, support: { ...can, check: false, install: false, reason: can.reason ?? "The updater declined to check." } };
    }
    const version = result.updateInfo?.version;
    if (!version || version === current) return { status: "current", current, support: can };
    return {
      status: "available",
      current,
      support: can,
      version,
      notes: typeof result?.updateInfo?.releaseNotes === "string" ? result.updateInfo.releaseNotes : undefined,
      date: result?.updateInfo?.releaseDate,
      bytes: result?.updateInfo?.files?.[0]?.size,
    };
  } catch (err) {
    return { status: "error", current, support: can, message: message(err) };
  }
}

/**
 * Registers the IPC and forwards the updater's progress to `win`. Called once from
 * `app.whenReady`; nothing here loads `electron-updater` until the renderer asks.
 */
export function updaterIpc(target: () => BrowserWindow | null) {
  let wired = false;
  /** Attached on the first download rather than at startup, so a launch that never checks stays cheap. */
  const wire = (up: Updater) => {
    if (wired) return;
    wired = true;
    const send = (channel: string, ...args: unknown[]) => target()?.webContents.send(channel, ...args);
    up.on("download-progress", (p: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => {
      const progress: UpdateProgress = { percent: p.percent, transferred: p.transferred, total: p.total, bytesPerSecond: p.bytesPerSecond };
      send("update:progress", progress);
    });
    up.on("update-downloaded", () => send("update:downloaded"));
    up.on("error", (err: Error) => send("update:error", message(err)));
  };

  ipcMain.handle("update:support", () => support());
  ipcMain.handle("update:check", (_e, allowPrerelease: boolean) => check(allowPrerelease));
  ipcMain.handle("update:download", async () => {
    const up = get();
    if (!up) return { ok: false as const, message: loadError ?? "The updater could not be loaded." };
    if (!support().install) return { ok: false as const, message: support().reason ?? "This build cannot install updates." };
    wire(up);
    try {
      await up.downloadUpdate();
      return { ok: true as const };
    } catch (err) {
      return { ok: false as const, message: message(err) };
    }
  });
  ipcMain.handle("update:install", () => {
    const up = get();
    if (!up) return;
    // isSilent false so the NSIS installer shows its progress; isForceRunAfter so the app
    // comes back. The renderer has already been through the unsaved-changes gate.
    setImmediate(() => up.quitAndInstall(false, true));
  });
  ipcMain.handle("update:openReleases", async (_e, url: string | undefined) => {
    // Only ever our own releases: the renderer hands a URL over IPC, so it is checked here.
    await shell.openExternal(url?.startsWith("https://github.com/") ? url : RELEASES_URL);
  });
}
