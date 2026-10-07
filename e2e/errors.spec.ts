/**
 * A part of the editor that cannot render does not take the rest with it. Before the
 * boundaries (`ui/ErrorBoundary.tsx`) a render that threw unmounted everything, the Debug
 * Console included, so there was nowhere left to read what had happened.
 *
 * The failure here is one a browser really produces: a dialog's chunk that does not
 * arrive. Nothing in the bundle is rigged to throw for the test.
 */
import { test, expect } from "./support/editor";

test("a dialog that cannot load is closed, said so, and in the log", async ({ editor }) => {
  const { page } = editor;
  editor.allowErrors(/Failed to load resource|Render failed|dynamically imported module/);
  await page.route("**/assets/StatisticsDialog-*.js", (route) => route.abort());
  await editor.open();
  await editor.dismissGameDataOffer();

  await editor.menu("Tools", "Statistics…");

  const toast = page.locator(".toast", { hasText: "A dialog hit an error and was closed" });
  await expect(toast).toBeVisible();
  await expect(editor.dialogs()).toHaveCount(0);
  // The editor is still there, and still works.
  await expect(page.locator(".menubar")).toBeVisible();
  await expect(page.locator(".viewport")).toBeVisible();

  await toast.getByRole("button", { name: "Show the log" }).click();
  const row = page.locator(".debug-console .console-row.error", { hasText: "Render failed" });
  await expect(row).toContainText('surface="dialog statistics"');

  // Another dialog opens as it always did.
  await editor.menu("Help", "About scmJS…");
  await expect(editor.dialogs().first()).toBeVisible();
});
