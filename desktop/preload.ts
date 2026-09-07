/**
 * The bridge between the web bundle and the main process: `window.scmjsDesktop`, typed in
 * `src/gamedata/desktop.ts` (keep the two in step). Runs sandboxed; nothing here touches
 * Node beyond `process.argv` and `process.platform`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopBridge, UpdateProgress } from "../src/gamedata/desktop";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? "";
const version = arg("scmjs-version");
/** The origin `main.ts` serves the editor from; a window it did not open is given no origin at all. */
const pageOrigin = arg("scmjs-origin");

const bridge: DesktopBridge = {
  platform: process.platform,
  version,
  window: {
    setDirty: (dirty) => ipcRenderer.send("window:dirty", dirty),
    onCloseRequest: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("window:close-request", handler);
      return () => { ipcRenderer.off("window:close-request", handler); };
    },
    respondClose: (close) => ipcRenderer.send("window:close-response", close),
  },
  gameData: {
    status: () => ipcRenderer.invoke("gamedata:status"),
    locate: () => ipcRenderer.invoke("gamedata:locate"),
    pickFolder: () => ipcRenderer.invoke("gamedata:pickFolder"),
    clear: () => ipcRenderer.invoke("gamedata:clear"),
    searchDirs: () => ipcRenderer.invoke("gamedata:searchDirs"),
    onProgress: (listener) => {
      const handler = (_e: IpcRendererEvent, fraction: number, label: string) => listener(fraction, label);
      ipcRenderer.on("gamedata:progress", handler);
      return () => { ipcRenderer.off("gamedata:progress", handler); };
    },
  },
  files: {
    onOpen: (listener) => {
      const handler = (_e: IpcRendererEvent, file: { name: string; bytes: Uint8Array }) => listener({ name: file.name, bytes: new Uint8Array(file.bytes) });
      ipcRenderer.on("file:open", handler);
      // Ask for what the app was started with; the main process answers on the same channel.
      ipcRenderer.send("file:ready");
      return () => { ipcRenderer.off("file:open", handler); };
    },
  },
  updates: {
    support: () => ipcRenderer.invoke("update:support"),
    check: (allowPrerelease) => ipcRenderer.invoke("update:check", allowPrerelease),
    download: () => ipcRenderer.invoke("update:download"),
    install: () => ipcRenderer.invoke("update:install"),
    openReleases: (url) => ipcRenderer.invoke("update:openReleases", url),
    onProgress: (listener) => {
      const handler = (_e: IpcRendererEvent, progress: UpdateProgress) => listener(progress);
      ipcRenderer.on("update:progress", handler);
      return () => { ipcRenderer.off("update:progress", handler); };
    },
    onDownloaded: (listener) => {
      const handler = () => listener();
      ipcRenderer.on("update:downloaded", handler);
      return () => { ipcRenderer.off("update:downloaded", handler); };
    },
    onError: (listener) => {
      const handler = (_e: IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on("update:error", handler);
      return () => { ipcRenderer.off("update:error", handler); };
    },
  },
  game: {
    info: (dir) => ipcRenderer.invoke("game:info", dir ?? null),
    pickFolder: () => ipcRenderer.invoke("game:pickFolder"),
    test: (bytes, fileName, options) => ipcRenderer.invoke("game:test", bytes, fileName, options),
  },
};

// The bridge spawns the game, reads folders and installs updates, so it belongs to the editor's
// own page and nothing else. A plugin's sign-in popup is a child window, and Electron may hand a
// child its parent's preload — that window carries no `--scmjs-origin`, and the remote page it
// goes on to load is a different origin besides, so it is served no bridge either way.
if (pageOrigin && location.origin === pageOrigin) contextBridge.exposeInMainWorld("scmjsDesktop", bridge);
