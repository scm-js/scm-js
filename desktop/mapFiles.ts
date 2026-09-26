/**
 * The map files the desktop app reads and writes by path. The page cannot learn a path
 * from a file handle (`webUtils.getPathForFile` answers "" for `handle.getFile()`), so the
 * desktop build works with paths instead: the main process's own open and save dialogs, a
 * drop (whose `File` does carry its path), and a double-click all hand it one, and it is
 * recorded here. Reading, writing and Save's `.bak` then go by that path.
 *
 * Plugins run with the page's privileges, so this is not a general file API: only a map
 * file (`.scm`, `.scx`, `.chk`) the user gave the app in one of those ways is readable or
 * writable. The list is kept in the user data folder, so Open Recent and "reopen the last
 * map" still work after a restart.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DesktopBackupResult } from "../src/gamedata/desktop";
import { backupMap } from "./backup";

const MAP_FILE = /\.(scm|scx|chk)$/i;
/** How many paths the list keeps, most recent first. */
const KEEP = 500;

export type MapFileResult = { ok: true } | { ok: false; message: string };

export class MapFiles {
  private paths: string[] = [];
  private readonly listFile: string | null;
  private readonly caseless: boolean;

  constructor(listFile: string | null, caseless = process.platform === "win32") {
    this.listFile = listFile;
    this.caseless = caseless;
    if (!listFile) return;
    try {
      const saved = JSON.parse(readFileSync(listFile, "utf8")) as unknown;
      if (Array.isArray(saved)) this.paths = saved.filter((p): p is string => typeof p === "string" && MAP_FILE.test(p)).slice(0, KEEP);
    } catch { /* first run, or an unreadable list: start empty */ }
  }

  private key(path: string): string {
    return this.caseless ? path.toLowerCase() : path;
  }

  /** Record a map path the user gave the app; null when it is not a map file's name. */
  allow(path: string): string | null {
    if (typeof path !== "string" || !path || !MAP_FILE.test(path)) return null;
    const full = resolve(path);
    const k = this.key(full);
    this.paths = [full, ...this.paths.filter((p) => this.key(p) !== k)].slice(0, KEEP);
    this.persist();
    return full;
  }

  /** Whether `path` is one the user gave the app. */
  known(path: string): boolean {
    if (typeof path !== "string" || !MAP_FILE.test(path)) return false;
    const k = this.key(resolve(path));
    return this.paths.some((p) => this.key(p) === k);
  }

  read(path: string): Uint8Array {
    if (!this.known(path)) throw new Error("The app was not given this file.");
    return readFileSync(path);
  }

  write(path: string, bytes: Uint8Array): MapFileResult {
    if (!this.known(path)) return { ok: false, message: "The app was not given this file." };
    try {
      writeFileSync(path, bytes);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Save's `.bak`: `<path>.bak`, for a known map file that exists and has something in it. */
  backup(path: string): DesktopBackupResult {
    if (!this.known(path)) return { ok: false, message: "The app was not given this file." };
    try {
      if (!existsSync(path) || statSync(path).size === 0) return { ok: false, message: "There is no file to keep yet." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    return backupMap(path);
  }

  private persist() {
    if (!this.listFile) return;
    try {
      mkdirSync(dirname(this.listFile), { recursive: true });
      writeFileSync(this.listFile, JSON.stringify(this.paths));
    } catch { /* the list is a convenience; the session still has it in memory */ }
  }
}
