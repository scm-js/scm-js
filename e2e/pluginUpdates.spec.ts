/**
 * Check all for updates answers the whole list in one line under its button, not a toast
 * per plugin, and Update all appears once two rows offer an update. The plugin list is
 * answered here: every default at the release this editor ships, two of them newer.
 */
import { readFileSync } from "node:fs";
import { test, expect } from "./support/editor";

const REGISTRY = "https://raw.githubusercontent.com/scm-js/registry/main/index.json";
const NEWER = new Set(["plugin-paint", "plugin-repair"]);

/** The defaults this editor ships, read off the source the way a reader would. */
function shippedDefaults(): { repo: string; version: string }[] {
  const source = readFileSync(new URL("../src/plugins/defaults.ts", import.meta.url), "utf8");
  return [...source.matchAll(/spec: "github:scm-js\/(plugin-[\w-]+)@v([\d.]+)"/g)].map((m) => ({ repo: m[1], version: m[2] }));
}

test("Check all answers in one line, and Update all appears for two offers", async ({ editor }) => {
  const page = editor.page;
  const plugins = shippedDefaults().map(({ repo, version }) => ({
    spec: `github:scm-js/${repo}`,
    name: repo,
    version: NEWER.has(repo) ? `${Number(version.split(".")[0]) + 1}.0.0` : version,
  }));
  await page.route(REGISTRY, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ format: 1, name: "Test", plugins }) }));

  await editor.open("dialog=plugins");
  const dialog = editor.dialog("Plugins");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Update all/ })).toHaveCount(0);

  const toasts = page.locator(".toast");
  const before = await toasts.count();
  await dialog.getByRole("button", { name: "Check all for updates" }).click();

  await expect(dialog.getByRole("status")).toHaveText(/2 updates available\./);
  await expect(dialog.getByRole("button", { name: "Update all (2)" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /^Update to/ })).toHaveCount(2);
  await expect(dialog.getByText("Up to date").first()).toBeVisible();
  expect(await toasts.count()).toBe(before);
});
