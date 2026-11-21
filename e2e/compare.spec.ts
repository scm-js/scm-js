/**
 * Tools ▸ Compare Maps…: the open map held against itself as it was, a change made, and the
 * dialog saying what differs with a button that goes there and turns View ▸ Differences on.
 */
import { join } from "node:path";
import { expect, test } from "./support/editor";

const MELEE = join(import.meta.dirname, "../tests/maps/melee.scx");

test("says what changed since the map was kept, and marks it on the map", async ({ editor, page }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  await editor.openMap(MELEE);

  await editor.menu("Tools", "Compare Maps…");
  const compare = editor.dialog("Compare Maps");
  await expect(compare).toBeVisible();
  await expect(compare).toContainText("No other map is open.");
  await compare.getByRole("button", { name: "Compare with this map as it is now" }).click();
  await expect(compare).toContainText("The ground, the units and the locations are the same in both maps.");
  await compare.locator(".dlg-footer").getByRole("button", { name: "Close" }).click();
  await expect(compare).toHaveCount(0);

  // Every unit of the map goes: the start locations and their resources.
  await page.locator(".menubar").getByRole("menuitem", { name: "Layer", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitemradio", { name: /^Units/ }).click();
  await editor.menu("Edit", "Select All");
  await editor.menu("Edit", "Delete");

  await editor.menu("Tools", "Compare Maps…");
  await expect(compare).toContainText(/Units: 0 added, [1-9]\d* removed, 0 moved, 0 changed/);
  await expect(compare.getByRole("checkbox", { name: /Show on the map/ })).not.toBeChecked();
  await compare.getByRole("button", { name: /removed from tile/ }).first().click();
  await expect(compare).toHaveCount(0);

  // Going to a place turned the overlay on.
  await page.locator(".menubar").getByRole("menuitem", { name: "View", exact: true }).click();
  await expect(page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Differences", exact: true })).toBeChecked();
});

test("offers Differences only with something to compare with, and does not call two tilesets' ground the same", async ({ editor, page }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  await editor.openMap(MELEE);

  const view = page.locator(".menubar").getByRole("menuitem", { name: "View", exact: true });
  const differences = page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Differences", exact: true });
  await view.click();
  await expect(differences).toBeDisabled();
  await expect(differences).not.toBeChecked();
  await page.keyboard.press("Escape");

  await editor.menu("Tools", "Compare Maps…");
  const compare = editor.dialog("Compare Maps");
  await compare.getByRole("button", { name: "Compare with this map as it is now" }).click();
  await compare.locator(".dlg-footer").getByRole("button", { name: "Close" }).click();
  await expect(compare).toHaveCount(0);

  await view.click();
  await expect(differences).toBeEnabled();
  await page.keyboard.press("Escape");

  // Another tileset, with the units and locations left as they are.
  await editor.menu("File", "Map Properties…");
  const properties = editor.dialog("Map Properties");
  const tileset = properties.locator("select").first();
  await tileset.selectOption((await tileset.inputValue()) === "ice" ? "desert" : "ice");
  await properties.getByRole("button", { name: "OK" }).click();
  await expect(properties).toHaveCount(0);

  await editor.menu("Tools", "Compare Maps…");
  await expect(compare).toContainText("their ground cannot be compared");
  await expect(compare).toContainText("The units and the locations are the same in both maps.");
  await expect(compare).not.toContainText("The ground, the units and the locations are the same");
});
