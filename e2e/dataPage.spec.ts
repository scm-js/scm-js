/**
 * The Game Data page (`data.html`): the dialog's controls on a page of their own, which
 * the site's header links to. On a browser that holds nothing it says so and offers the
 * two ways in; none of the editor is started around it.
 */
import { test, expect } from "./support/editor";

test("the Game Data page says what the browser holds and offers to add it", async ({ editor }) => {
  const { page } = editor;
  await page.goto("./data.html");

  await expect(page.getByRole("heading", { level: 1, name: "Game data" })).toBeVisible();
  await expect(page).toHaveTitle("Game data — scmJS");
  await expect(page.getByText("Nothing yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Download the graphics/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose the StarCraft folder…" })).toBeVisible();

  // The editor is one link away, and is not here: no menu bar, no map.
  await expect(page.getByRole("link", { name: "Open the editor" })).toHaveAttribute("href", new URL(page.url()).pathname.replace(/data\.html$/, ""));
  await expect(page.locator(".menubar")).toHaveCount(0);
});

test("the Game Data page lists a copy kept in the browser", async ({ editor }) => {
  const { page } = editor;
  await page.goto("./data.html");
  await expect(page.getByText("Nothing yet.")).toBeVisible();
  // A stamp is what says a copy is there; the page reads nothing else to list it.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("gamedata", { create: true });
    const file = await (await dir.getFileHandle("stamp.json", { create: true })).createWritable();
    await file.write(JSON.stringify({ from: "StarDat.mpq + BrooDat.mpq", at: "2026-10-01T12:00:00.000Z", files: 931, bytes: 222298112, summary: "8 tilesets" }));
    await file.close();
  });
  await page.reload();

  const copy = page.locator(".pg-copies li");
  await expect(copy).toHaveCount(1);
  await expect(copy).toHaveAttribute("data-kind", "classic");
  await expect(copy).toContainText("StarCraft: Brood War");
  await expect(copy).toContainText("From your own StarCraft files (StarDat.mpq + BrooDat.mpq).");
  await expect(copy).toContainText("931 files · 212.00 MB");
  await expect(copy).toContainText("In use");
  await expect(page.getByRole("button", { name: "Remove copy" })).toBeVisible();
});
