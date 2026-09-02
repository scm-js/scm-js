/**
 * The desktop app's main process. The renderer is the web build, unchanged; this side
 * serves it under `app://scmjs/` and adds the one thing a browser cannot do — look for a
 * StarCraft installation on disk and extract the game data from it (`src/gamedata/extract.ts`,
 * the same code the browser runs in its worker). The extracted files go to the user data
 * directory and are served under the same base as the bundle, so the renderer's ordinary
 * "bundled" probe finds them (`src/gamedata/source.ts`); the IPC here is what the preload
 * exposes as `window.scmjsDesktop` (`src/gamedata/desktop.ts`).
 *
 * `npm run build:desktop` bundles this with Vite (`desktop/vite.config.ts`) and packages it
 * with electron-builder (`electron-builder.yml`).
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openArchives, readerFor } from "../src/gamedata/archives";
import { describeExtraction, extractGameData } from "../src/gamedata/extract";
import type { DesktopLocateResult } from "../src/gamedata/desktop";

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
    for (const p of problems) console.warn("game data:", p);
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
    return { status: "ready", ...stamp };
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

/* ── The window ─────────────────────────────────────────── */

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#0b0c10",
    title: "scmJS",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--scmjs-version=${app.getVersion()}`],
    },
  });
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

  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
