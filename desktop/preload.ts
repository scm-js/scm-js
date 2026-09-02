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
};

contextBridge.exposeInMainWorld("scmjsDesktop", bridge);
