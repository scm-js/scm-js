/**
 * A part of the editor that cannot render does not take the rest with it. Before the
 * boundaries (`ui/ErrorBoundary.tsx`) a render that threw unmounted everything, the Debug
 * Console included, so there was nowhere left to read what had happened.
 *
 * The failure here is one a browser really produces: a dialog's chunk that does not
 * arrive, the way it does for a page opened before a release took its files away (a 404),
 * or over a connection that dropped (an aborted request). Nothing in the bundle is rigged
 * to throw for the test.
 */
import { test, expect } from "./support/editor";

const NOTICE = "Part of the editor could not be downloaded";

for (const how of ["gone", "dropped"] as const) {
  test(`a dialog whose chunk is ${how} is closed, the notice offers a reload, and the log has it`, async ({ editor }) => {
    const { page } = editor;
    editor.allowErrors(/Failed to load resource|Render failed|dynamically imported module/);
    await page.route("**/assets/StatisticsDialog-*.js", (route) =>
      how === "gone" ? route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html>" }) : route.abort());
    await editor.open();
    await editor.dismissGameDataOffer();

    await editor.menu("Tools", "Statistics…");

    const notice = page.locator(".toast", { hasText: NOTICE });
    await expect(notice).toBeVisible();
    await expect(editor.dialogs()).toHaveCount(0);
    // Not a fault of the dialog's, so not the notice for one.
    await expect(page.locator(".toast", { hasText: "A dialog hit an error and was closed" })).toHaveCount(0);
    // The editor is still there, and still works.
    await expect(page.locator(".menubar")).toBeVisible();
    await expect(page.locator(".viewport")).toBeVisible();

    // A second failure is the same notice, not another.
    await editor.menu("Tools", "Statistics…");
    await expect(editor.dialogs()).toHaveCount(0);
    await expect(page.locator(".toast", { hasText: NOTICE })).toHaveCount(1);

    await page.locator(".menubar").getByRole("menuitem", { name: "View", exact: true }).click();
    await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Debug Console" }).click();
    const row = page.locator(".debug-console .console-row.error", { hasText: "Render failed" }).first();
    await expect(row).toContainText('surface="dialog statistics"');

    // Another dialog opens as it always did.
    await editor.menu("Help", "About scmJS…");
    await expect(editor.dialogs().first()).toBeVisible();
    await page.keyboard.press("Escape");

    // Reload brings the page back, with the chunk there this time.
    await page.unroute("**/assets/StatisticsDialog-*.js");
    await Promise.all([page.waitForEvent("load"), notice.getByRole("button", { name: "Reload" }).click()]);
    await expect(page.locator(".menubar")).toBeVisible();
    await editor.dismissGameDataOffer();
    await editor.menu("Tools", "Statistics…");
    await expect(editor.dialogs().first()).toBeVisible();
    await expect(page.locator(".toast", { hasText: NOTICE })).toHaveCount(0);
  });
}
