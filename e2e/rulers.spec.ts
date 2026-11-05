/**
 * The rulers measure the map view, which stops at the scroller's scrollbars while the
 * rulers' strips run past them. Stretched to the strip, a tile's mark drifted from the tile
 * by up to a scrollbar's width towards the far end.
 */
import { test, expect } from "./support/editor";

// Headless Chromium hides scrollbars, and with them the difference this is about.
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });

test("the rulers are as long as the map view, so a tile's mark sits beside the tile", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();

  const page = editor.page;
  // Where scrollbars overlay the content (macOS by default) they take no space and there is
  // nothing to test. A styled ::-webkit-scrollbar always takes space, but the app's
  // scrollbar-width / scrollbar-color win over it in Chromium, so set those back to auto.
  await page.addStyleTag({
    content: `.scroller { scrollbar-width: auto; scrollbar-color: auto; }
      .scroller::-webkit-scrollbar { width: 10px; height: 10px; }`,
  });
  await expect.poll(() => page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>(".scroller")!;
    const top = document.querySelector<HTMLCanvasElement>(".ruler.top canvas")!.getBoundingClientRect();
    const left = document.querySelector<HTMLCanvasElement>(".ruler.left canvas")!.getBoundingClientRect();
    return {
      scrollbars: scroller.offsetHeight > scroller.clientHeight && scroller.offsetWidth > scroller.clientWidth,
      across: top.width - scroller.clientWidth,
      down: left.height - scroller.clientHeight,
    };
  })).toEqual({ scrollbars: true, across: 0, down: 0 });
});
