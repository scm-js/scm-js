/**
 * Every dialog opens. Each one is a lazy chunk named in two places (the `DialogId` union
 * and `DialogHost`'s registry) and most sessions open two or three of them, so a dialog
 * that throws as it mounts, or whose chunk the build lost, is found by whoever opens it
 * next. This opens them all, over the blank startup map, in both languages.
 *
 * The ids are read out of the registry's source, so a dialog added there is covered
 * without touching this file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect } from "./support/editor";

const HOST = readFileSync(join(import.meta.dirname, "../src/components/dialogs/DialogHost.tsx"), "utf8");
const REGISTRY = /const REGISTRY[^{]*\{([\s\S]*?)\n\};/.exec(HOST)?.[1] ?? "";
const DIALOG_IDS = [...REGISTRY.matchAll(/^\s*(\w+): from\(/gm)].map((m) => m[1]);

/**
 * Dialogs that are only ever opened *for* something, with a payload a deep link cannot
 * carry, and that show nothing without it.
 */
const NEEDS_PAYLOAD: Record<string, string> = {
  confirmPlugin: "asks about one plugin, named in its payload",
  pluginDialog: "is a plugin's own dialog, described in its payload",
};

test("the registry was read", () => {
  expect(DIALOG_IDS.length).toBeGreaterThan(40);
  for (const id of Object.keys(NEEDS_PAYLOAD)) expect(DIALOG_IDS, `${id} is no longer a dialog`).toContain(id);
});

const KOREAN: Record<string, string> = JSON.parse(readFileSync(join(import.meta.dirname, "../src/i18n/ko.json"), "utf8"));

for (const [language, locale, file] of [["English", "en-US", "File"], ["Korean", "ko-KR", KOREAN.File]] as const) {
  test.describe(language, () => {
    // The editor's language follows the browser's until a preference says otherwise.
    test.use({ locale });

    test("the editor is in this language", async ({ editor }) => {
      await editor.open();
      await expect(editor.page.locator(".menubar").getByRole("menuitem").first()).toHaveText(file);
    });

    for (const id of DIALOG_IDS) {
      test(`${id} opens and closes`, async ({ editor }) => {
        test.skip(id in NEEDS_PAYLOAD, NEEDS_PAYLOAD[id]);
        await editor.open(`dialog=${id}`);

        const dialog = editor.dialogs().first();
        await expect(dialog).toBeVisible();
        await expect(dialog.getByRole("heading").first()).not.toBeEmpty();

        // Marked, because the Game Data offer takes the place of whatever closes here.
        await dialog.evaluate((el) => el.setAttribute("data-e2e", "opened"));
        await editor.page.keyboard.press("Escape");
        await expect(editor.page.locator("[data-e2e=opened]")).toHaveCount(0);
      });
    }
  });
}
