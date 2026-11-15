/**
 * The start screen, and the site's items in the menu bar.
 *
 * With no map open the map's area says where to drop one and offers the ways to start; it
 * is gone the moment a map is open, and it never shows over one. And an editor that has
 * scmjs.dev's pages beside it (served under `/editor/`) carries the site's doors in its
 * menu bar, where every other editor's bar is as it always was.
 */
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { test, expect, type Editor } from "./support/editor";

const MAP = join(import.meta.dirname, "../tests/maps/melee.scx");

/** File ▸ Close Map on a map with nothing to save: the plain question, answered. */
async function closeMap(editor: Editor) {
  await editor.menu("File", "Close Map");
  const ask = editor.dialog("Close Scenario");
  await ask.getByRole("button", { name: "Close", exact: true }).last().click();
  await expect(ask).toHaveCount(0);
}

test("the start screen is there with no map open, and gone once one is", async ({ editor }) => {
  const { page } = editor;
  await editor.open();
  await editor.dismissGameDataOffer();
  const start = page.locator(".start-screen");

  // The editor starts on a blank map, so there is nothing to start from.
  await expect(page).toHaveTitle("Untitled Scenario — scmJS");
  await expect(start).toHaveCount(0);

  await closeMap(editor);
  await expect(start).toBeVisible();
  await expect(start.getByRole("heading", { name: "Drop a map to edit it" })).toBeVisible();
  await expect(start.getByText("Nothing opened yet.")).toBeVisible();

  // New map… is File ▸ New's dialog.
  await start.getByRole("button", { name: "New map…" }).click();
  const create = editor.dialog("New Scenario");
  await create.getByRole("button", { name: "Create" }).click();
  await expect(create).toHaveCount(0);
  await expect(start).toHaveCount(0);

  // Open a file… is the picker, and the file opens as it does from File ▸ Open.
  await closeMap(editor);
  await expect(start).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await start.getByRole("button", { name: "Open a file…" }).click();
  await (await chooser).setFiles({ name: "melee.scx", mimeType: "application/octet-stream", buffer: readFileSync(MAP) });
  await expect(page).toHaveTitle("melee.scx — scmJS");
  await expect(start).toHaveCount(0);

  // It is in the recent files now; with no handle kept for it (a file input gives none), its row leads to the picker.
  await closeMap(editor);
  const recent = start.getByRole("button", { name: /melee\.scx/ });
  await expect(recent).toContainText("browse for it");
  const again = page.waitForEvent("filechooser");
  await recent.click();
  await (await again).setFiles({ name: "melee.scx", mimeType: "application/octet-stream", buffer: readFileSync(MAP) });
  await expect(page).toHaveTitle("melee.scx — scmJS");
  await expect(start).toHaveCount(0);
});

test("a map dropped on the start screen opens", async ({ editor }) => {
  const { page } = editor;
  await editor.open();
  await editor.dismissGameDataOffer();
  await closeMap(editor);
  const zone = page.locator(".start-drop");
  await expect(zone).toBeVisible();

  // The drop is the window's own: the zone only says where.
  const data = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "melee.scx"));
    return transfer;
  }, [...readFileSync(MAP)]);
  await zone.dispatchEvent("dragover", { dataTransfer: data });
  await expect(page.locator(".app")).toHaveClass(/drop-target/);
  await zone.dispatchEvent("drop", { dataTransfer: data });
  await expect(page).toHaveTitle("melee.scx — scmJS");
  await expect(page.locator(".start-screen")).toHaveCount(0);
});

test("an editor that is not on the site has no site items", async ({ editor, baseURL }) => {
  // The suite pointed at a stand-in for the site (`SCMJS_E2E_URL=…/editor/`) is on it by the rule this checks.
  test.skip(new URL(baseURL!).pathname.startsWith("/editor/"), "the editor under test is itself served under /editor/");
  const { page } = editor;
  await editor.open();
  await editor.dismissGameDataOffer();

  await expect(page.locator(".site-nav")).toHaveCount(0);
  await expect(page.locator(".menubar a")).toHaveCount(0);
  await expect(page.locator(".menubar .brand")).toHaveText("scmJS");
  await closeMap(editor);
  await expect(page.locator(".start-screen")).toBeVisible();
  await expect(page.locator(".start-screen a")).toHaveCount(0);
});

test("under /editor/ the bar has the site's doors, and they give way to the menus in a narrow window", async ({ editor }) => {
  const { page } = editor;
  // The server answers any path with the editor, so this is the editor where a stand-in for the site serves it.
  await page.goto("./editor/?nosplash");
  await expect(page.locator(".menubar")).toBeVisible();
  await editor.dismissGameDataOffer();

  const bar = page.locator(".menubar");
  await expect(bar.locator("a.brand")).toHaveAttribute("href", "/");
  await expect(bar.locator("a.brand")).toHaveText("scmJS");
  const nav = bar.getByRole("navigation");
  await expect(nav.getByRole("link", { name: "Play", exact: true })).toHaveAttribute("href", "/play/");
  const replays = nav.getByRole("link", { name: "Replays", exact: true });
  await expect(replays).toHaveAttribute("href", "/replay/");
  await expect(nav.getByRole("link", { name: "Library", exact: true })).toHaveAttribute("href", "/library");
  // What the browser holds, as the site's header says it, leading to the Game Data page.
  const data = nav.getByRole("link", { name: "No game data" });
  await expect(data).toHaveAttribute("href", "/editor/data");
  await expect(data).toHaveAttribute("data-state", "none");
  // A map to edit is in front, not a replay: no door is the current one.
  await expect(replays).not.toHaveAttribute("aria-current", "page");
  await expect(bar.locator(".menubar-doc")).toContainText("Untitled Scenario");

  // The start screen offers the library there too.
  await closeMap(editor);
  await expect(page.locator(".start-screen").getByRole("link", { name: "From your library" })).toHaveAttribute("href", "/library");

  // At the desktop app's smallest window the menus are all still there and nothing in the bar is cut.
  const menus = await bar.getByRole("menuitem").count();
  for (const width of [1100, 900]) {
    await page.setViewportSize({ width, height: 600 });
    await expect(bar.getByRole("menuitem")).toHaveCount(menus);
    const cut = await bar.evaluate((el) => {
      const edge = el.getBoundingClientRect().right;
      const rest = el.querySelector(".menubar-rest")!.getBoundingClientRect();
      const shown = [...el.querySelectorAll<HTMLElement>(".menu-trigger, .menubar-doc, .site-nav > *")].filter((e) => e.getClientRects().length > 0);
      return shown.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.right > edge + 0.5 || (!e.classList.contains("menu-trigger") && r.left < rest.left - 0.5);
      }).map((e) => e.className);
    });
    expect(cut, `cut off at ${width}px`).toEqual([]);
  }
  await expect(nav.getByRole("link", { name: "Play", exact: true })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Library", exact: true })).toBeHidden();
});
