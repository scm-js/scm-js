/**
 * The move from editor.scmjs.dev to scmjs.dev/editor/ (`src/moveIn.ts`): on the first
 * visit to the site, what the browser kept under the old address is brought over before
 * the editor reads its settings — so the very first paint is already in the language
 * somebody chose at the old address, not after a reload.
 *
 * Both addresses are played here: the site is the build under test, the old address is one
 * page that answers as the front-door worker's `/moved.html` does (the worker has the real
 * one, and its own tests).
 */
import { test, expect, type Page } from "@playwright/test";

const SITE = "https://scmjs.dev";
const OLD = "https://editor.scmjs.dev";
const GAME_DATA = /^(tileset|unit|arr|game|scripts)\//;

const HANDOFF = `<!doctype html><script>
  var entries = {};
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i);
    if (key.indexOf("scmjs.") === 0) entries[key] = localStorage.getItem(key);
  }
  if (window.parent !== window) window.parent.postMessage({ scmjsMove: 1, entries: entries }, "${SITE}");
</script>`;

/** The site served from the build, the old address from `old`; everything else is cut off. Returns the editor's address on the site. */
async function serve(page: Page, baseURL: string, old: "answers" | "silent"): Promise<string> {
  const { origin, pathname: basePath } = new URL(baseURL);
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
    if (url.origin === OLD) return old === "answers" ? route.fulfill({ status: 200, contentType: "text/html", body: HANDOFF }) : route.abort();
    if (url.origin !== SITE) return route.abort();
    if (url.pathname.startsWith(basePath) && GAME_DATA.test(url.pathname.slice(basePath.length))) return route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html>" });
    const res = await route.fetch({ url: `${origin}${url.pathname}${url.search}` });
    return route.fulfill({ response: res });
  });
  return `${SITE}${basePath}`;
}

test("settings kept at the old address are there on the first visit to the new one", async ({ page, baseURL }) => {
  const editor = await serve(page, baseURL!, "answers");
  // Somebody who used the old address: Korean, and a key that is not the editor's.
  await page.goto(`${OLD}/`);
  await page.evaluate(() => {
    localStorage.setItem("scmjs.prefs", JSON.stringify({ language: "ko" }));
    localStorage.setItem("someone.else", "x");
  });

  await page.goto(`${editor}?nosplash`);
  await expect(page.locator(".menubar").getByRole("menuitem", { name: "파일", exact: true })).toBeVisible();
  const kept = await page.evaluate(() => ({ prefs: localStorage.getItem("scmjs.prefs"), other: localStorage.getItem("someone.else"), moved: localStorage.getItem("scmjs-moved") }));
  expect(JSON.parse(kept.prefs!).language).toBe("ko");
  expect(kept.other).toBeNull();
  expect(kept.moved).toBe("1");

  // Once is all: a change at the new address is not undone by the next visit.
  await page.evaluate(() => localStorage.setItem("scmjs.prefs", JSON.stringify({ language: "en" })));
  let asked = 0;
  page.on("request", (req) => { if (req.url().startsWith(OLD)) asked++; });
  await page.reload();
  await expect(page.locator(".menubar").getByRole("menuitem", { name: "File", exact: true })).toBeVisible();
  expect(asked).toBe(0);
});

test("the editor starts when the old address does not answer", async ({ page, baseURL }) => {
  const editor = await serve(page, baseURL!, "silent");
  await page.goto(`${editor}?nosplash`);
  await expect(page.locator(".menubar")).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => [localStorage.getItem("scmjs-moved"), localStorage.getItem("scmjs-moved-tries")])).toEqual([null, "1"]);
});

test("any other address asks nothing", async ({ page }) => {
  let asked = 0;
  page.on("request", (req) => { if (req.url().startsWith(OLD)) asked++; });
  await page.goto("./?nosplash");
  await expect(page.locator(".menubar")).toBeVisible();
  expect(asked).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("scmjs-moved"))).toBeNull();
});
