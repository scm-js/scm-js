/**
 * Preferences' filter box: a word from another page shows that page's section with its real
 * control, the Hotkeys page narrows to the commands asked for, clearing the box puts back
 * the page that was in front, and OK, Apply and Reset everything work while results show.
 */
import { test, expect } from "./support/editor";
import type { Page } from "@playwright/test";

const stored = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("scmjs.prefs") ?? "{}") as Record<string, unknown>);

test("a word from another page shows its section, and the control there is the real one", async ({ editor }) => {
  await editor.open("dialog=preferences");
  const dlg = editor.dialog("Preferences");
  const box = dlg.getByRole("textbox", { name: "Find a setting" });
  // The cursor starts in the box.
  await expect(box).toBeFocused();
  await box.fill("NOTICES UNTIL");
  const results = dlg.locator(".prefs-results");
  await expect(results.locator("[data-results-page=view]")).toBeVisible();
  await expect(results.locator("[data-results-page=general]")).toBeHidden();
  // Only the matching section of View is shown, under the page's name.
  await expect(results.locator("[data-results-page=view] .prefs-results-head")).toHaveText("View");
  await expect(results.locator(".prefs-section:visible h3")).toHaveText(["Notices"]);
  // There is no page in front while the results show.
  await expect(dlg.getByRole("button", { name: "Reset this page" })).toBeDisabled();
  await expect(dlg.locator(".prefs-nav-btn.is-active")).toHaveCount(0);
  await results.getByLabel("Keep notices until I close them").check();
  await dlg.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  expect((await stored(editor.page)).keepNotices).toBe(true);
});

test("the Hotkeys page narrows to the command asked for, by name or by its keys", async ({ editor }) => {
  await editor.open("dialog=preferences&page=hotkeys");
  const dlg = editor.dialog("Preferences");
  const box = dlg.getByRole("textbox", { name: "Find a command" });
  const rows = dlg.locator(".hotkeys tbody tr:not(.hotkeys-group)");
  await expect(rows.first()).toBeVisible();
  const all = await rows.count();
  await box.fill("save as");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("td").first()).toHaveText("Save As");
  // Under its group's heading, and still the Hotkeys page rather than results.
  await expect(dlg.locator(".hotkeys .hotkeys-group")).toHaveText(["File"]);
  await expect(dlg.locator(".prefs-results")).toHaveCount(0);
  await box.fill("Ctrl+S");
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator("td").first()).toHaveText("Save");
  await box.fill("no such command");
  await expect(rows).toHaveCount(0);
  await expect(dlg.getByText('Nothing matches "no such command".')).toBeVisible();
  await dlg.getByRole("button", { name: "Clear search" }).click();
  await expect(rows).toHaveCount(all);
});

test("Esc clears the box and puts back the page in front; a second Esc closes", async ({ editor }) => {
  await editor.open("dialog=preferences&page=view");
  const dlg = editor.dialog("Preferences");
  const box = dlg.getByRole("textbox", { name: "Find a setting" });
  const wheel = dlg.locator(".prefs-builtin h3", { hasText: "Mouse wheel" });
  await expect(wheel).toBeVisible();
  await box.fill("spacing");
  await expect(dlg.locator(".prefs-results [data-results-page=editing]")).toBeVisible();
  await expect(wheel).toBeHidden();
  await editor.page.keyboard.press("Escape");
  await expect(box).toHaveValue("");
  await expect(dlg.locator(".prefs-results")).toHaveCount(0);
  await expect(wheel).toBeVisible();
  await expect(dlg.locator(".prefs-nav-btn.is-active")).toHaveText("View");
  await expect(dlg.getByRole("button", { name: "Reset this page" })).toBeEnabled();
  await editor.page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
});

test("choosing a page while filtering clears the box and goes there; nothing matching says so", async ({ editor }) => {
  await editor.open("dialog=preferences");
  const dlg = editor.dialog("Preferences");
  const box = dlg.getByRole("textbox", { name: "Find a setting" });
  await box.fill("xyzzy");
  await expect(dlg.getByText('Nothing matches "xyzzy".')).toBeVisible();
  await dlg.locator(".prefs-nav-btn", { hasText: "Files" }).click();
  await expect(box).toHaveValue("");
  await expect(dlg.locator(".prefs-builtin h3").first()).toHaveText("New scenario");
  // Ctrl+F, Find's key, brings the cursor back to the box from anywhere in the dialog.
  await expect(box).not.toBeFocused();
  await editor.page.keyboard.press("Control+f");
  await expect(box).toBeFocused();
});

test("Apply and Reset everything work while the results show", async ({ editor }) => {
  await editor.open("dialog=preferences");
  const dlg = editor.dialog("Preferences");
  const box = dlg.getByRole("textbox", { name: "Find a setting" });
  await box.fill("notices");
  const tick = dlg.locator(".prefs-results").getByLabel("Keep notices until I close them");
  await tick.check();
  await dlg.getByRole("button", { name: "Apply", exact: true }).click();
  expect((await stored(editor.page)).keepNotices).toBe(true);
  // Still open, still filtering.
  await expect(box).toHaveValue("notices");
  await dlg.getByRole("button", { name: "Reset everything…" }).click();
  await dlg.locator(".dlg-footer").getByRole("button", { name: "Reset everything", exact: true }).click();
  await expect(tick).not.toBeChecked();
  await expect(box).toHaveValue("notices");
  await dlg.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  expect((await stored(editor.page)).keepNotices).toBe(false);
});

test("a radio chosen in the results shows as chosen while its page is the one in front", async ({ editor }) => {
  // The page in front stays mounted behind the results, so View's radios are in the dialog twice.
  await editor.open("dialog=preferences&page=view");
  const dlg = editor.dialog("Preferences");
  await dlg.getByRole("textbox", { name: "Find a setting" }).fill("wheel");
  const results = dlg.locator(".prefs-results");
  const scrolls = results.getByLabel("Scrolls the map; Ctrl+wheel zooms");
  const zooms = results.getByLabel("Zooms; Shift+wheel scrolls sideways");
  await expect(scrolls).toBeChecked();
  await zooms.check();
  await expect(zooms).toBeChecked();
  await expect(scrolls).not.toBeChecked();
  await dlg.getByRole("button", { name: "OK", exact: true }).click();
  await expect(dlg).toHaveCount(0);
  expect(((await stored(editor.page)).view as { wheel: string }).wheel).toBe("zoom");
});

