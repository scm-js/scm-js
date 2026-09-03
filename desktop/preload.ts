/**
 * The bridge between the web bundle and the main process: `window.scmjsDesktop`, typed in
 * `src/gamedata/desktop.ts` (keep the two in step). Runs sandboxed; nothing here touches
 * Node beyond `process.argv` and `process.platform`.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DesktopBridge } from "../src/gamedata/desktop";

const version = process.argv.find((a) => a.startsWith("--scmjs-version="))?.slice("--scmjs-version=".length) ?? "";

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
  game: {
    info: (dir) => ipcRenderer.invoke("game:info", dir ?? null),
    pickFolder: () => ipcRenderer.invoke("game:pickFolder"),
    test: (bytes, fileName, options) => ipcRenderer.invoke("game:test", bytes, fileName, options),
  },
};

contextBridge.exposeInMainWorld("scmjsDesktop", bridge);
