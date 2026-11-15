/**
 * The Tile tab comes back as it was left. Its browser unmounts when another Terrain tab is
 * shown, and used to start again on grouped rows with every group listed and no search.
 * Its filter and view buttons also have to stay inside the palette at its default width,
 * where the filter's label used to be cut to a few letters.
 */
import { test, expect } from "./support/editor";

test("the Tile tab keeps its view, filter and search while another Terrain tab is shown", async ({ editor }) => {
  await editor.open("layer=terrain&mode=tile");
  await editor.dismissGameDataOffer();

  const page = editor.page;
  const sheet = page.getByRole("button", { name: "Sheet", exact: true });
  const filter = page.getByLabel("Group filter");
  const search = page.getByLabel("Search tile groups");
  await sheet.click();
  await filter.selectOption({ index: 1 });
  const picked = await filter.inputValue();
  await search.fill("dirt");

  await page.getByRole("tab", { name: "Rect", exact: true }).click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole("tab", { name: "Tile", exact: true }).click();

  await expect(sheet).toHaveClass(/is-active/);
  await expect(filter).toHaveValue(picked);
  await expect(search).toHaveValue("dirt");

  // Nothing in the two rows runs past the palette, and the filter has a row's width to show its label in.
  const inside = await page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".tile-filter")!.parentElement!;
    const edge = bar.getBoundingClientRect().right;
    const right = (sel: string) => document.querySelector<HTMLElement>(sel)!.getBoundingClientRect().right;
    return { filter: right(".tile-filter") <= edge, views: right(".tile-views") <= edge, room: document.querySelector<HTMLElement>(".tile-filter")!.offsetWidth >= 150 };
  });
  expect(inside).toEqual({ filter: true, views: true, room: true });
});
