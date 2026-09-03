/**
 * The desktop app's main process. The renderer is the web build, unchanged; this side
 * serves it under `app://scmjs/` and adds what a browser cannot do — look for a StarCraft
 * installation on disk and extract the game data from it (`src/gamedata/extract.ts`, the same
 * code the browser runs in its worker), and hold the window's close back while the editor asks
 * about unsaved changes (`src/hooks/useCloseGuard.ts`). The extracted files go to the user data
 * directory and are served under the same base as the bundle, so the renderer's ordinary
 * "bundled" probe finds them (`src/gamedata/source.ts`); the IPC here is what the preload
 * exposes as `window.scmjsDesktop` (`src/gamedata/desktop.ts`).
 *
 * `npm run build:desktop` bundles this with Vite (`desktop/vite.config.ts`) and packages it
 * with electron-builder (`electron-builder.yml`).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell } from "electron";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openArchives, readerFor } from "../src/gamedata/archives";
import { describeExtraction, extractGameData } from "../src/gamedata/extract";
import type { DesktopGameInfo, DesktopLocateResult, DesktopTestResult } from "../src/gamedata/desktop";

const SCHEME = "app";
const HOST = "scmjs";
/** The directories the web bundle would hold game data under; served from the user's copy instead. */
const GAME_DATA_PREFIXES = ["tileset/", "arr/", "unit/", "game/", "scripts/"];
const STAMP = "stamp.json";
const KNOWN = /^(stardat|broodat|patch_rt)\.mpq$/i;
const order = (n: string) => (/^stardat/i.test(n) ? 0 : /^broodat/i.test(n) ? 1 : 2);

const distDir = resolve(__dirname, "..", "..", "dist");
const dataDir = () => join(app.getPath("userData"), "gamedata");

interface Stamp { from: string; at: string; files: number; bytes: number; summary: string }

/* ── Finding the archives ───────────────────────────────── */

/**
 * Where the archives are looked for, in order: next to the app (a portable exe's folder,
 * the AppImage's folder, the install directory — so two files dropped beside the app are
 * found), the app's own data folder, the environment, then the usual install locations.
 */
function searchDirs(): string[] {
  const dirs: string[] = [];
  const env = process.env;
  if (env.PORTABLE_EXECUTABLE_DIR) dirs.push(env.PORTABLE_EXECUTABLE_DIR);
  if (env.APPIMAGE) dirs.push(dirname(env.APPIMAGE));
  dirs.push(dirname(process.execPath));
  if (process.platform === "darwin") dirs.push(resolve(process.execPath, "..", "..", "..", ".."));
  dirs.push(app.getPath("userData"));
  for (const name of ["SCM_DATA_DIR", "STARCRAFT_DIR"]) if (env[name]) dirs.push(resolve(env[name]!));
  const home = homedir();
  if (process.platform === "win32") {
    dirs.push("C:\\Program Files (x86)\\StarCraft", "C:\\Program Files\\StarCraft");
  } else if (process.platform === "darwin") {
    dirs.push("/Applications/StarCraft");
  } else {
    dirs.push(join(home, ".wine", "drive_c", "Program Files (x86)", "StarCraft"), join(home, ".wine", "drive_c", "Program Files", "StarCraft"));
  }
  dirs.push(join(home, "StarCraft"), join(home, "Games", "StarCraft"));
  return [...new Set(dirs.map((d) => resolve(d)))];
}

/** The game's archives in one directory, in the order the game applies them. */
function archivesIn(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => KNOWN.test(n)).sort((a, b) => order(a) - order(b) || a.localeCompare(b)).map((n) => join(dir, n));
}

/* ── Extracting ─────────────────────────────────────────── */

let progressTarget: BrowserWindow | null = null;
const report = (fraction: number, label: string) => progressTarget?.webContents.send("gamedata:progress", fraction, label);

function readStamp(): Stamp | null {
  try {
    return JSON.parse(readFileSync(join(dataDir(), STAMP), "utf8")) as Stamp;
  } catch {
    return null;
  }
}

function status(): DesktopLocateResult {
  const stamp = readStamp();
  return stamp ? { status: "ready", ...stamp } : { status: "missing", searched: [] };
}

/** Extract from the archives in `dir` into the data directory, replacing what was there. */
function extractFrom(dir: string): DesktopLocateResult {
  const paths = archivesIn(dir);
  if (paths.length === 0) return { status: "missing", searched: [dir] };
  try {
    report(0, "Reading the archives");
    const { archives, problems } = openArchives(paths.map((p) => ({ name: p.split(/[\\/]/).pop()!, bytes: new Uint8Array(readFileSync(p)) })));
    if (archives.length === 0) return { status: "failed", message: problems[0] ?? "No archive could be opened." };
    const result = extractGameData(readerFor(archives), (f, label) => report(f * 0.9, label));

    const out = dataDir();
    rmSync(out, { recursive: true, force: true });
    let i = 0;
    for (const [path, data] of result.files) {
      const target = join(out, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, data);
      if (++i % 100 === 0) report(0.9 + (i / result.files.size) * 0.1, "Writing the files");
    }
    const stamp: Stamp = { from: dir, at: new Date().toISOString(), files: result.files.size, bytes: result.bytes, summary: describeExtraction(result) };
    writeFileSync(join(out, STAMP), JSON.stringify(stamp));
    report(1, "Done");
    return { status: "ready", ...stamp, ...(problems.length > 0 ? { problems } : {}) };
  } catch (err) {
    return { status: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

/** The copy if it is there, else the first searched directory with the archives. */
function locate(): DesktopLocateResult {
  const have = status();
  if (have.status === "ready") return have;
  const searched = searchDirs();
  for (const dir of searched) {
    if (archivesIn(dir).length === 0) continue;
    const result = extractFrom(dir);
    if (result.status !== "missing") return result;
  }
  return { status: "missing", searched };
}

/* ── Test Map: the installed game ───────────────────────── */

/** Where each StarCraft build keeps its executable, relative to the install folder. */
const EXE_CANDIDATES = process.platform === "darwin"
  ? ["StarCraft.app", "StarCraft/StarCraft.app"]
  : ["x86_64/StarCraft.exe", "x86/StarCraft.exe", "StarCraft.exe"];
/** The folder Test Map writes into, under Maps, so the game lists it and nothing of the user's is touched. */
const TEST_FOLDER = "scmJS";

/** The game in `dir`: an executable and a Maps folder, either being enough to call it an install. */
function gameIn(dir: string): { exe: string | null; mapsDir: string | null } | null {
  const exe = EXE_CANDIDATES.map((c) => join(dir, c)).find((p) => existsSync(p)) ?? null;
  // A Maps folder handed over directly counts as one too.
  const mapsDir = /maps$/i.test(basename(dir)) && existsSync(dir) ? dir : existsSync(join(dir, "Maps")) ? join(dir, "Maps") : null;
  if (!exe && !mapsDir) return null;
  return { exe, mapsDir: mapsDir ?? (exe ? join(dir, "Maps") : null) };
}

function gameInfo(preferred: string | null): DesktopGameInfo {
  const dirs = preferred ? [resolve(preferred), ...searchDirs()] : searchDirs();
  for (const dir of dirs) {
    const found = gameIn(dir);
    if (found) return { ...found, installDir: /maps$/i.test(basename(dir)) ? dirname(dir) : dir, searched: dirs };
  }
  return { exe: null, mapsDir: null, installDir: null, searched: dirs };
}

/** Start the game: the executable itself on Windows, `open` on macOS, Wine elsewhere. */
function launchGame(exe: string): string | null {
  try {
    const cwd = dirname(exe);
    const child = process.platform === "darwin"
      ? spawn("open", ["-a", exe], { detached: true, stdio: "ignore" })
      : process.platform === "win32"
        ? spawn(exe, [], { detached: true, stdio: "ignore", cwd })
        : spawn("wine", [exe], { detached: true, stdio: "ignore", cwd });
    child.on("error", (err) => console.warn("test map: launch failed:", err.message));
    child.unref();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function testMap(bytes: Uint8Array, fileName: string, options: { dir?: string; launch: boolean }): DesktopTestResult {
  const info = gameInfo(options.dir ?? null);
  if (!info.mapsDir) throw new Error("No StarCraft installation was found — pick its folder first.");
  const out = join(info.mapsDir, TEST_FOLDER);
  mkdirSync(out, { recursive: true });
  const target = join(out, basename(fileName));
  writeFileSync(target, bytes);
  if (!options.launch) return { path: target, launched: false };
  if (!info.exe) return { path: target, launched: false, message: "The game's executable was not found next to the Maps folder." };
  const problem = launchGame(info.exe);
  return problem ? { path: target, launched: false, message: problem } : { path: target, launched: true };
}

/* ── Map files from the OS ──────────────────────────────── */

/** A map path among the arguments the app (or a second copy of it) was started with. */
function mapArg(argv: string[]): string | null {
  return argv.slice(1).find((a) => /\.(scm|scx|chk)$/i.test(a) && existsSync(a)) ?? null;
}

/** The file to hand the renderer once it listens: the launch argument, or a macOS open-file. */
let pendingOpen: string | null = mapArg(process.argv);

function sendOpen(win: BrowserWindow, path: string) {
  try {
    win.webContents.send("file:open", { name: basename(path), bytes: readFileSync(path) });
  } catch (err) {
    console.warn("open file:", err instanceof Error ? err.message : String(err));
  }
}

/** One running copy: a double-click while the app runs opens in its window instead of starting another. */
const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
app.on("second-instance", (_e, argv) => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const path = mapArg(argv);
  if (path) sendOpen(win, path);
});
app.on("open-file", (e, path) => {
  e.preventDefault();
  const win = BrowserWindow.getAllWindows()[0];
  if (win) sendOpen(win, path); else pendingOpen = path;
});

/* ── Serving the bundle ─────────────────────────────────── */

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

function serveFile(file: string): Promise<Response> {
  return net.fetch(pathToFileURL(file).href);
}

function handleRequest(req: Request): Promise<Response> | Response {
  const url = new URL(req.url);
  let path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  if (path === "") path = "index.html";
  if (GAME_DATA_PREFIXES.some((p) => path.startsWith(p))) {
    const file = join(dataDir(), path);
    return existsSync(file) ? serveFile(file) : new Response("Not found", { status: 404 });
  }
  const file = resolve(distDir, path);
  if (!file.startsWith(distDir)) return new Response("Forbidden", { status: 403 });
  if (existsSync(file) && statSync(file).isFile()) return serveFile(file);
  // The app is a single page; anything else the renderer navigates to is the page itself.
  return path.includes(".") ? new Response("Not found", { status: 404 }) : serveFile(join(distDir, "index.html"));
}

/* ── Remembering the window ─────────────────────────────── */

interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }

/**
 * What the *first* run gets: maximized, because the editor is a chrome-heavy tool and its
 * panels only fit comfortably at full screen. The size is what "restore down" gives back.
 * Every run after that reopens the window the user left, as Windows apps are expected to.
 */
const FIRST_RUN_WINDOW: WindowState = { width: 1400, height: 900, maximized: true };
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;
/** How much of a saved rectangle must still land on a screen for its position to be reused. */
const MUST_BE_VISIBLE = 100;

const windowStateFile = () => join(app.getPath("userData"), "window.json");

/** Whether enough of a saved rectangle lands on a display that is still attached. */
function onScreen(x: number, y: number, width: number, height: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    Math.min(x + width, a.x + a.width) - Math.max(x, a.x) >= MUST_BE_VISIBLE &&
    Math.min(y + height, a.y + a.height) - Math.max(y, a.y) >= MUST_BE_VISIBLE);
}

/**
 * The size, position and maximized state of the last run. A missing or unreadable file is the
 * first run; a position that no longer lands on any screen (the laptop left its dock) is
 * dropped on its own, keeping the size and letting the platform place the window.
 */
function readWindowState(): WindowState {
  let saved: Partial<WindowState>;
  try {
    saved = JSON.parse(readFileSync(windowStateFile(), "utf8")) as Partial<WindowState>;
  } catch {
    return FIRST_RUN_WINDOW;
  }
  const width = Math.max(MIN_WIDTH, Math.round(saved.width ?? FIRST_RUN_WINDOW.width));
  const height = Math.max(MIN_HEIGHT, Math.round(saved.height ?? FIRST_RUN_WINDOW.height));
  const state: WindowState = { width, height, maximized: saved.maximized === true };
  const { x, y } = saved;
  if (typeof x === "number" && typeof y === "number" && onScreen(x, y, width, height)) {
    state.x = Math.round(x);
    state.y = Math.round(y);
  }
  return state;
}

/**
 * Saved on a timer rather than only on close, so a session that ends without a clean quit —
 * a kill from Task Manager, a crash, a shutdown — still remembers where the window was.
 */
function watchWindowState(win: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!win.isDestroyed()) saveWindowState(win); }, 500);
  };
  win.on("resize", later);
  win.on("move", later);
  win.on("maximize", later);
  win.on("unmaximize", later);
  win.on("close", () => { clearTimeout(timer); saveWindowState(win); });
}

function saveWindowState(win: BrowserWindow) {
  // getNormalBounds is the *un*-maximized rectangle: what "restore down" should give back next
  // time. getBounds would save the maximized size as the restored one, so unmaximizing after a
  // restart would do nothing visible.
  const { x, y, width, height } = win.getNormalBounds();
  const state: WindowState = { x, y, width, height, maximized: win.isMaximized() };
  try {
    writeFileSync(windowStateFile(), JSON.stringify(state));
  } catch {
    // Nothing the user needs to hear about: the next run just opens at the first-run size.
  }
}

/* ── Closing with unsaved changes ───────────────────────── */

/**
 * A window whose renderer says the open map has unsaved changes is not allowed to close on
 * its own: the close is held, the renderer is asked (it shows the editor's own Close Scenario
 * dialog, so Save goes through the same path as File ▸ Save), and it answers with
 * `window:close-response`. `cleared` is that answer — the one close that is let through.
 *
 * The renderer is the only source of both facts; a reload that leaves `dirty` stale heals
 * itself, since the fresh renderer answers the next close request at once.
 */
const dirty = new WeakSet<BrowserWindow>();
const cleared = new WeakSet<BrowserWindow>();
/** Set while the app is quitting (macOS Cmd+Q, a session logout), so a cleared close quits rather than closing one window. */
let quitting = false;

function guardClose(win: BrowserWindow) {
  win.on("close", (e) => {
    if (cleared.has(win) || !dirty.has(win)) return;
    e.preventDefault();
    if (win.isMinimized()) win.restore();
    win.focus();
    win.webContents.send("window:close-request");
  });
}

function closeIpc() {
  ipcMain.on("window:dirty", (e, value: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    if (value) dirty.add(win);
    else dirty.delete(win);
  });
  ipcMain.on("window:close-response", (e, close: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    // A "stay open" also cancels the quit the close came from; the next Cmd+Q asks again.
    if (!close) { quitting = false; return; }
    cleared.add(win);
    if (quitting) app.quit();
    else win.close();
  });
}

/* ── The window ─────────────────────────────────────────── */

function createWindow() {
  const icon = join(distDir, "icon.png");
  const state = readWindowState();
  const win = new BrowserWindow({
    ...(state.x !== undefined ? { x: state.x, y: state.y } : {}),
    width: state.width,
    height: state.height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    backgroundColor: "#0b0c10",
    title: "scmJS",
    ...(existsSync(icon) ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--scmjs-version=${app.getVersion()}`],
    },
  });
  if (state.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());
  watchWindowState(win);
  guardClose(win);
  progressTarget = win;
  win.on("closed", () => { if (progressTarget === win) progressTarget = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  // The editor has its own menu bar; the platform menu only matters on macOS (Cmd+Q, Cmd+C/V in fields).
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }]));
  } else {
    Menu.setApplicationMenu(null);
  }
  const dev = process.env.SCMJS_DEV_URL;
  void win.loadURL(dev || `${SCHEME}://${HOST}/`);
  return win;
}

app.whenReady().then(() => {
  protocol.handle(SCHEME, handleRequest);
  closeIpc();

  ipcMain.handle("gamedata:status", () => status());
  ipcMain.handle("gamedata:locate", () => locate());
  ipcMain.handle("gamedata:searchDirs", () => searchDirs());
  ipcMain.handle("gamedata:clear", () => { rmSync(dataDir(), { recursive: true, force: true }); });
  ipcMain.handle("gamedata:pickFolder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win ?? undefined as never, {
      title: "Choose the StarCraft folder",
      message: "The folder holding StarDat.mpq and BrooDat.mpq",
      properties: ["openDirectory"],
    });
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return extractFrom(picked.filePaths[0]);
  });
  ipcMain.on("file:ready", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win && pendingOpen) { sendOpen(win, pendingOpen); pendingOpen = null; }
  });
  ipcMain.handle("game:info", (_e, dir: string | null) => gameInfo(dir));
  ipcMain.handle("game:pickFolder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const picked = await dialog.showOpenDialog(win ?? undefined as never, {
      title: "Choose the StarCraft folder",
      message: "The folder holding the game (or its Maps folder)",
      properties: ["openDirectory"],
    });
    return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths[0];
  });
  ipcMain.handle("game:test", (_e, bytes: Uint8Array, fileName: string, options: { dir?: string; launch: boolean }) => testMap(new Uint8Array(bytes), fileName, options));

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("before-quit", () => { quitting = true; });
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
