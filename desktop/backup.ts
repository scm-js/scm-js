import { copyFileSync, statSync } from "node:fs";
import type { DesktopBackupResult } from "../src/gamedata/desktop";

/**
 * Save's `.bak`: copy a map file to `<path>.bak` before the page writes over it. Only a map
 * file, and only one that exists — the page runs plugins with its own privileges, so this
 * must not become a way to copy (or overwrite a `.bak` of) anything else on the disk.
 */
export function backupMap(path: string): DesktopBackupResult {
  try {
    if (typeof path !== "string" || !/\.(scm|scx|chk)$/i.test(path)) return { ok: false, message: "Not a map file." };
    if (!statSync(path).isFile()) return { ok: false, message: "Not a file." };
    const bak = `${path}.bak`;
    copyFileSync(path, bak);
    return { ok: true, path: bak };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
