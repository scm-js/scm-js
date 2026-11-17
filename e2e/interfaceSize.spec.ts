/**
 * Preferences ▸ View ▸ Interface size at 130%, in a 1366 × 768 window: the chrome is drawn
 * larger, the map is not, and a press on the map still lands on the tile under the pointer.
 * The map's corner has to be a whole pixel for that: the canvas is drawn at its box rounded
 * to the pixel while the pointer is measured against the box itself, and before the bars
 * above it were rounded the corner sat at y = 103.19 at 130%, so a press on a tile's first
 * row read the row above.
 */
import { join } from "node:path";
import { test, expect } from "./support/editor";

test.use({ viewport: { width: 1366, height: 768 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem("scmjs.prefs") ?? "{}");
    localStorage.setItem("scmjs.prefs", JSON.stringify({ ...stored, interfaceSize: 130 }));
  });
});

test("at 130% the chrome is zoomed, the map is not, and its corner is a whole pixel", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  const page = editor.page;
  await expect(page.locator("html")).toHaveAttribute("data-ui-size", "130");
  const zooms = await page.evaluate(() => {
    const zoom = (sel: string) => (document.querySelector(sel) as Element & { currentCSSZoom: number }).currentCSSZoom;
    const r = document.querySelector(".scroller")!.getBoundingClientRect();
    return { menubar: zoom(".menubar"), toolbar: zoom(".toolbar"), dock: zoom(".dock.left"), statusbar: zoom(".statusbar"), map: zoom(".map-surface"), left: r.left, top: r.top };
  });
  for (const part of ["menubar", "toolbar", "dock", "statusbar"] as const) expect(zooms[part], part).toBeCloseTo(1.3, 5);
  expect(zooms.map).toBe(1);
  expect(Number.isInteger(zooms.left) && Number.isInteger(zooms.top), `map corner at ${zooms.left}, ${zooms.top}`).toBe(true);
});

test("at 130% a drag on the map reads and makes the tiles under the pointer", async ({ editor }) => {
  await editor.open("layer=locations");
  await editor.dismissGameDataOffer();
  const page = editor.page;
  // Where the map is drawn: its box rounded to the pixel, as the canvas is.
  const corner = await page.locator(".scroller").evaluate((el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top) }; });
  // A tile's first pixel and its last, at the map's 100%: a corner off by a fraction of a
  // pixel reads the tile before the first or the one after the last.
  const first = (tx: number, ty: number) => ({ x: corner.x + tx * 32, y: corner.y + ty * 32 });
  const last = (tx: number, ty: number) => ({ x: corner.x + tx * 32 + 31, y: corner.y + ty * 32 + 31 });
  const status = page.locator(".statusbar");
  // (Below the notice the map shows without game data, which takes the pointer at its top left.)
  const from = first(6, 10), to = last(9, 13);
  await page.mouse.move(to.x, to.y);
  await expect(status).toContainText(/Tile\s*9, 13(?!\d)/i);
  await page.mouse.move(from.x, from.y);
  await expect(status).toContainText(/Tile\s*6, 10(?!\d)/i);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await expect(status).toContainText(/Tile\s*9, 13(?!\d)/i);
  await page.mouse.up();
  await expect(status).toContainText(/Created location \d+ .* at 6, 10 — 4 × 4 tiles/);
});

test("at 130% the Preferences dialog and the Trigger Editor fit the window", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  const page = editor.page;
  for (const [menu, item, title] of [["Edit", /^Preferences/, "Preferences"], ["Triggers", /^Trigger Editor/, "Trigger Editor"]] as const) {
    await editor.menu(menu, item);
    const dlg = editor.dialog(title);
    await expect(dlg).toBeVisible();
    await expect.poll(async () => {
      const r = (await dlg.boundingBox())!;
      return r.x >= 0 && r.y >= 0 && r.x + r.width <= 1366 && r.y + r.height <= 768;
    }).toBe(true);
    // Its own footer is inside it, not cut off below the window.
    const footer = (await dlg.locator(".dlg-footer").boundingBox())!;
    expect(footer.y + footer.height).toBeLessThanOrEqual(768);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  }
});

test("at 130% the right dock's edge stays under the pointer", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  const page = editor.page;
  const dock = page.locator(".dock.right");
  const before = (await dock.boundingBox())!;
  const grip = (await dock.locator(".dock-resizer").boundingBox())!;
  const x = grip.x + grip.width / 2, y = grip.y + 200;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 130, y, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => Math.round((await dock.boundingBox())!.x)).toBe(Math.round(before.x - 130));
});

test("at 130% nothing in the Trigger Editor is zoomed a second time", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  // A map with triggers: a trigger's row is a `.body`, the app's own class for what is under the bars.
  await editor.openMap(join(import.meta.dirname, "../tests/maps/ums.scx"));
  await editor.menu("Triggers", /^Trigger Editor/);
  const dlg = editor.dialog("Trigger Editor");
  await expect(dlg.locator(".trig-list .item .body").first()).toBeVisible();
  // Everything drawn in the dialog is at the dialog's size (an element that is not drawn answers 1).
  const largest = await dlg.evaluate((el) => Math.max(...[el, ...el.querySelectorAll("*")].map((e) => Math.round((e as HTMLElement).currentCSSZoom * 100) / 100)));
  expect(largest).toBe(1.3);
  const row = dlg.locator(".trig-list .item .body").first().locator("span").first();
  expect(await row.evaluate((e) => Math.round((e as HTMLElement).currentCSSZoom * 100) / 100)).toBe(1.3);
});

