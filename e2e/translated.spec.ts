/**
 * A page translator does not take the editor down. Chrome's replaces each text node React
 * put in the page with a `<font>` holding its own, so React's next removal of the old node
 * — or insertion beside it — finds it gone and throws `NotFoundError` (facebook/react#11538).
 * 0.8.3's error counts were these: the panels that change with the layer, and the Layer
 * menu's check mark. `domGuard.ts` makes the two calls step aside and log a warning.
 *
 * The translator here does what Chrome's does to the DOM, to every text node in the page
 * now and to every one added later; it only leaves the words as they were.
 */
import { test, expect } from "./support/editor";

test("a translated page switches layers through the menu without an error", async ({ editor }) => {
  const { page } = editor;
  await editor.open();
  await editor.dismissGameDataOffer();

  await page.evaluate(() => {
    const translate = (root: Node) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const texts: Text[] = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
      for (const text of texts) {
        const parent = text.parentNode;
        if (!parent || !text.data.trim() || (parent as Element).closest?.("font, script, style")) continue;
        const font = document.createElement("font");
        font.appendChild(document.createTextNode(text.data));
        parent.replaceChild(font, text);
      }
    };
    translate(document.body);
    document.documentElement.classList.add("translated-ltr");
    new MutationObserver((records) => {
      for (const r of records) for (const n of r.addedNodes) if (n.nodeName !== "FONT") translate(n.nodeType === Node.TEXT_NODE ? n.parentNode! : n);
    }).observe(document.body, { childList: true, subtree: true });
  });

  const menubar = page.locator(".menubar");
  for (const layer of ["Units", "Doodads", "Locations", "Terrain"]) {
    await menubar.getByRole("menuitem", { name: "Layer", exact: true }).click();
    await page.getByRole("menu").getByRole("menuitemradio", { name: layer }).first().click();
    await expect(page.locator(".menu-content")).toHaveCount(0);
  }

  // Every part still drawn — nothing fell to its boundary — and the guard said what it skipped.
  await expect(page.locator(".surface-error")).toHaveCount(0);
  await expect(menubar).toBeVisible();
  await menubar.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menu").getByRole("menuitemcheckbox", { name: "Debug Console" }).click();
  await expect(page.locator(".debug-console .console-row", { hasText: "A node had moved" }).first()).toBeVisible();
});
