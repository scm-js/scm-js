// What a working tree has to work with, for `npm run doctor` and `npm run verify`: the game data the editor and some
// test suites need (never committed: public/ from `npm run extract`, Blizzard's archives and maps in fixtures/), and
// whether the browser tests' Chromium can start here.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

export const wsl = process.platform === "linux" && (() => { try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; } })();

/** Where a classic StarCraft is usually installed on this system, if one is there. */
export function starcraftFolder() {
  const places = process.platform === "darwin" ? ["/Applications/StarCraft"]
    : process.platform === "win32" ? ["C:\\Program Files (x86)\\StarCraft", "C:\\Program Files\\StarCraft"]
    : wsl ? ["/mnt/c/Program Files (x86)/StarCraft", "/mnt/c/Program Files/StarCraft"] : [];
  return places.find((d) => existsSync(join(d, "StarDat.mpq")) || existsSync(join(d, "BrooDat.mpq"))) ?? null;
}

/** The three kinds of game data the tests read: extracted into public/, the archives and the maps in fixtures/. */
export function gameData(root) {
  let extracted = false;
  try { extracted = /Game data is in place/.test(execFileSync(process.execPath, [join(root, "scripts/extract-assets.mjs"), "--check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })); } catch { /* exits 1 when incomplete */ }
  const list = (dir, re) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((n) => re.test(n)) : []);
  const mpqs = list("fixtures/data", /\.mpq$/i);
  return {
    extracted,
    archives: mpqs.some((n) => /^stardat/i.test(n)) && mpqs.some((n) => /^broodat/i.test(n)),
    maps: list("fixtures/maps", /\.sc[mx]$/i).length,
  };
}

/** Whether Playwright's Chromium starts here: "ok", or why not ("missing", "libraries" with the library, "other"). */
export async function chromiumState(root) {
  try {
    const { chromium } = createRequire(join(root, "package.json"))("@playwright/test");
    await (await chromium.launch()).close();
    return { state: "ok" };
  } catch (e) {
    const text = String(e?.message ?? e);
    if (/Executable doesn't exist|Looks like Playwright/.test(text)) return { state: "missing" };
    if (/shared librar|error while loading|Host system is missing dependencies/i.test(text)) return { state: "libraries", library: text.match(/lib[\w.+-]+\.so[\d.]*/)?.[0] ?? null };
    return { state: "other", text: text.split("\n")[0].slice(0, 160) };
  }
}
