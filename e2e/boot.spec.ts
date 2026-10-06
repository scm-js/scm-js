/**
 * The built editor starts, on a machine that has never had game data — which is every CI
 * run and every first visit. "It degrades rather than crashing" is the claim; this is
 * where it is checked in a browser.
 */
import { test, expect } from "./support/editor";

test("a first visit goes from the splash to a working editor", async ({ editor }) => {
  const { page } = editor;
  await page.goto("./");

  // The splash holds until the preload is done, then leaves on its own.
  const splash = page.locator(".splash-veil");
  await expect(splash).toBeVisible();
  await expect(splash).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator("#boot-splash")).toHaveCount(0);

  // The chrome is there, around a blank map.
  await expect(page.locator(".menubar")).toBeVisible();
  await expect(page.locator(".statusbar")).toBeVisible();
  await expect(page).toHaveTitle("Untitled Scenario — scmJS");

  // With nothing to draw terrain from, the editor says so once and is usable after.
  await editor.dismissGameDataOffer();
  await editor.menu("Help", "About scmJS");
  await expect(editor.dialog(/About/)).toBeVisible();
});

test("the blank map is drawn without game data", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();

  // Flat colours stand in for the tileset: the viewport must not be an empty canvas.
  const canvas = editor.page.locator(".map-surface canvas");
  await expect(canvas).toBeVisible();
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => {
    const { data } = el.getContext("2d")!.getImageData(0, 0, el.width, el.height);
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
    return false;
  })).toBe(true);
});
