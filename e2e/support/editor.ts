/**
 * What every browser test starts from: the editor as CI has it, and the handful of things
 * a test does to it.
 *
 * Three things are arranged before the page loads, so a run on a machine with the game
 * data extracted is the run CI makes:
 *
 * - **No game data.** Requests for the generated `public/` trees are answered the way a
 *   build without them answers (the page itself, which is not a manifest), so the editor
 *   is in its degraded state everywhere. A test that needs real graphics does not belong
 *   in this fixture.
 * - **No network.** Anything off the server under test is refused: the update checks and
 *   the plugins' own services are not what is being tested, and would make a run depend
 *   on them.
 * - **No native file pickers.** Playwright cannot drive `showOpenFilePicker` /
 *   `showSaveFilePicker`, so they are taken away and the editor falls back to a file input
 *   and a download — the route Firefox and Safari always take.
 *
 * And one thing is checked after every test: nothing threw and nothing was logged as an
 * error. A test that expects one says so with `editor.allowErrors`.
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { test as base, expect, type Locator, type Page } from "@playwright/test";
import { loadFormats, type Formats } from "./formats";

const GAME_DATA = /^\/(tileset|unit|arr|game|scripts)\//;

export interface Editor {
  page: Page;
  /** What the page threw or logged as an error so far. */
  errors: string[];
  /** Let errors matching this through the after-test check. */
  allowErrors(pattern: RegExp): void;
  /** Load the editor past the splash; `query` is the rest of a dev deep link (`dialog=about`). */
  open(query?: string): Promise<void>;
  /**
   * Wait for the Game Data dialog the editor raises by itself when it has no game data, and
   * close it. It comes once the plugins have started and no other dialog is open, so a test
   * that clicks around calls this first or has it land on top of what it is doing.
   */
  dismissGameDataOffer(): Promise<void>;
  /** The open dialogs, bottom first. */
  dialogs(): Locator;
  /** An open dialog by its title. */
  dialog(title: string | RegExp): Locator;
  /** Pick an item of the menu bar: `menu("File", "Save As…")`. */
  menu(top: string, item: string | RegExp): Promise<void>;
  /** File ▸ Open… ▸ Browse…, answered with a file on disk. */
  openMap(path: string): Promise<void>;
  /** File ▸ Save As… ▸ Save: the bytes the browser was handed, and the name they were given. */
  saveAs(): Promise<{ bytes: Uint8Array; fileName: string }>;
}

export const test = base.extend<{ editor: Editor }, { formats: Formats }>({
  // The editor's format code, for reading back what a test saved. Once per worker.
  // oxlint-disable-next-line no-empty-pattern -- Playwright reads a fixture's dependencies off this pattern
  formats: [async ({}, use) => {
    const formats = await loadFormats();
    await use(formats);
    await formats.close();
  }, { scope: "worker" }],

  editor: async ({ page, baseURL }, use) => {
    const origin = new URL(baseURL!).origin;
    const errors: string[] = [];
    const allowed: RegExp[] = [];
    page.on("pageerror", (err) => errors.push(`uncaught: ${err.message}`));
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(`console: ${msg.text()}`); });

    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
      if (url.origin !== origin) return route.abort();
      if (GAME_DATA.test(url.pathname)) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
      return route.continue();
    });
    await page.addInitScript(() => {
      for (const name of ["showOpenFilePicker", "showSaveFilePicker"]) {
        delete (window as unknown as Record<string, unknown>)[name];
        delete (Window.prototype as unknown as Record<string, unknown>)[name];
      }
    });

    const dialogs = () => page.getByRole("dialog");
    const dialog = (title: string | RegExp) => page.getByRole("dialog", { name: title });

    const editor: Editor = {
      page,
      errors,
      allowErrors: (pattern) => { allowed.push(pattern); },
      async open(query = "") {
        await page.goto(`./?nosplash${query ? `&${query}` : ""}`);
        await expect(page.locator(".menubar")).toBeVisible();
      },
      async dismissGameDataOffer() {
        const offer = dialog("Game Data");
        await expect(offer).toBeVisible({ timeout: 15_000 });
        await offer.getByRole("button", { name: "Close" }).first().click();
        await expect(offer).toHaveCount(0);
      },
      dialogs,
      dialog,
      async menu(top, item) {
        await page.locator(".menubar").getByRole("menuitem", { name: top, exact: true }).click();
        await page.getByRole("menu").getByRole("menuitem", { name: item }).first().click();
      },
      async openMap(path) {
        await editor.menu("File", "Open…");
        const chooser = page.waitForEvent("filechooser");
        await dialog("Open Scenario").locator(".dlg-footer").getByRole("button", { name: "Browse…" }).click();
        await (await chooser).setFiles({ name: basename(path), mimeType: "application/octet-stream", buffer: readFileSync(path) });
        await expect(dialog("Open Scenario")).toHaveCount(0);
      },
      async saveAs() {
        await editor.menu("File", "Save As…");
        const save = dialog("Save Scenario As");
        const download = page.waitForEvent("download");
        await save.getByRole("button", { name: "Save", exact: true }).click();
        const file = await download;
        const bytes = new Uint8Array(readFileSync(await file.path()));
        await expect(save).toHaveCount(0);
        return { bytes, fileName: file.suggestedFilename() };
      },
    };

    await use(editor);

    expect(errors.filter((e) => !allowed.some((p) => p.test(e))), "errors thrown or logged by the page").toEqual([]);
  },
});

export { expect };
