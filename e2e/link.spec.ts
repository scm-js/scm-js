/**
 * A map linked to the command line: `scmjs map open --live` hands the map to the editor and stays on the other end,
 * and from then on the commands read what the editor has and change it there, one undo step each.
 *
 * Everything here is the real thing: the built command (built first, below), the page it serves on the loopback
 * address, the editor that page opens, and the file on disk the editor's Save writes through the link. What the
 * suites under `tests/` cannot show is exactly this chain: three processes and two pages passing a map along.
 */
import { execFile, execFileSync, spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { test, expect, type Page } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..");
const MAP = join(ROOT, "tests/maps/ums.scx");
const CLI = join(ROOT, "cli/dist/scmjs.mjs");
const GAME_DATA = /^(tileset|unit|arr|game|scripts)\//;

test.beforeAll(() => {
  // The command as it ships: one file, built from this tree.
  execFileSync(process.execPath, [join(ROOT, "scripts/build-cli.mjs"), "--quiet"], { cwd: ROOT, stdio: "ignore", timeout: 120_000 });
});

let live: ChildProcess | null = null;
test.afterEach(() => { live?.kill(); live = null; });

test("commands change a linked map in the editor, undo takes them back, and Save writes the file", async ({ context, baseURL }, testInfo) => {
  test.setTimeout(90_000);
  const dir = testInfo.outputPath("");
  const file = join(dir, "ums.scx");
  copyFileSync(MAP, file);
  const original = readFileSync(file);
  const { origin, pathname: basePath } = new URL(baseURL!);
  const env = { ...process.env, BROWSER: "none", NO_COLOR: "1", SCMJS_CACHE: join(dir, "cache"), SCMJS_EDITOR_URL: `${baseURL}?nosplash` };
  // Never the blocking form: the pages' requests are routed through this process while the command waits on them.
  const scmjs = async (...args: string[]) => (await promisify(execFile)(process.execPath, [CLI, ...args], { cwd: dir, env, encoding: "utf8" })).stdout;
  const nameNow = async () => (JSON.parse(await scmjs("map", "info", "ums.scx", "--json")) as { name: string }).name;

  // The editor as CI has it (support/editor.ts), for every page of this context: no game data, no network but
  // the server under test and the command's own page.
  const errors: string[] = [];
  // Playwright holds a new window at its first line, and Chromium now and then reports that from inside the
  // `window.open` that made it: the call returns the window and the link goes on, as the rest of this test shows.
  const OPEN_NOISE = "Failed to execute 'open' on 'Window': The provided callback is no longer runnable.";
  const watch = (page: Page) => {
    page.on("pageerror", (err) => { if (err.message !== OPEN_NOISE) errors.push(`uncaught: ${err.message}`); });
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });
  };
  context.on("page", watch);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:" || url.hostname === "127.0.0.1") return route.continue();
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith(basePath) && GAME_DATA.test(url.pathname.slice(basePath.length))) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
    return route.continue();
  });
  await context.addInitScript(() => {
    // (The window the command's page opens is blank for a moment, with no storage to read.)
    try { if (!localStorage.getItem("scmjs.plugin-updates")) localStorage.setItem("scmjs.plugin-updates", JSON.stringify({ at: Date.now() })); } catch { /* not the editor yet */ }
  });

  // Link it. BROWSER=none: the command prints its page's address instead of opening a browser.
  let said = "";
  live = spawn(process.execPath, [CLI, "map", "open", "--live", "ums.scx"], { cwd: dir, env });
  live.stdout!.on("data", (d: Buffer) => { said += d.toString(); });
  await expect.poll(() => /http:\/\/127\.0\.0\.1:\d+\/\w+/.exec(said)?.[0] ?? null).not.toBeNull();
  const relay = await context.newPage();
  const opened = context.waitForEvent("page");
  await relay.goto(/http:\/\/127\.0\.0\.1:\d+\/\w+/.exec(said)![0]);
  const editor = await opened;
  await expect(editor.locator(".statusbar .badge", { hasText: "Linked" })).toBeVisible({ timeout: 20_000 });
  await expect(relay.locator("#say")).toContainText("Linked to scmjs");
  await expect.poll(() => said).toContain("is linked to the editor");
  const offer = editor.getByRole("dialog", { name: "Game Data" });
  await expect(offer).toBeVisible({ timeout: 15_000 });
  await offer.getByRole("button", { name: "Close" }).first().click();

  // A command reads the map from the editor and changes it there; the file is left alone.
  expect(await nameNow()).toBe("Test Scenario");
  expect(await scmjs("map", "set", "ums.scx", "--name", "Linked name")).toContain("written to the editor, as one undo step");
  await expect(editor.locator(".statusbar .msg")).toContainText("scmjs map set");
  await expect(editor).toHaveTitle("*ums.scx — scmJS");
  expect(await nameNow()).toBe("Linked name");
  expect(readFileSync(file).equals(original)).toBe(true);

  // One undo step each way, and the commands see whichever side the editor is on.
  await editor.keyboard.press("Control+z");
  await expect.poll(nameNow).toBe("Test Scenario");
  await editor.keyboard.press("Control+y");
  await expect.poll(nameNow).toBe("Linked name");

  // Save in the editor writes the file on disk, through the link.
  await editor.keyboard.press("Control+s");
  await expect.poll(() => readFileSync(file).equals(original)).toBe(false);
  await expect.poll(() => said).toContain("Saved from the editor");
  await expect(editor).toHaveTitle("ums.scx — scmJS");

  // Closing the editor ends the link, and the command with it; the file now reads as it was saved.
  const ended = new Promise<number | null>((done) => live!.once("exit", done));
  await editor.close();
  expect(await ended).toBe(0);
  expect(said).toContain("The link has ended");
  expect(await nameNow()).toBe("Linked name");
  expect(errors).toEqual([]);
});
