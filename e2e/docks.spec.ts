/**
 * Dragging a dock's edge. A plugin's map view can be an iframe over the map (a replay's
 * game), and a drag that only listened on the window lost the pointer there: the dock
 * stopped following, and the release never arrived, so it went on following later.
 */
import { test, expect } from "./support/editor";

test("the right dock's edge drags across an iframe over the map, and lets go on release", async ({ editor }) => {
  await editor.open();
  await editor.dismissGameDataOffer();
  const page = editor.page;

  // An iframe where a map view's would be: over the map, under the dock's edge.
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.srcdoc = "<body style='margin:0;background:#123'></body>";
    Object.assign(frame.style, { position: "fixed", left: "0", top: "0", width: "100vw", height: "100vh", zIndex: "4", border: "0" });
    document.body.append(frame);
  });

  const dock = page.locator(".dock.right");
  const handle = dock.locator(".dock-resizer");
  const before = (await dock.boundingBox())!.width;
  const grip = (await handle.boundingBox())!;
  const x = grip.x + grip.width / 2, y = grip.y + 200;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 150, y, { steps: 10 });
  await expect.poll(async () => Math.round((await dock.boundingBox())!.width)).toBe(Math.round(before + 150));
  await page.mouse.up();
  await expect(page.locator("body")).not.toHaveClass(/dock-resizing/);

  // Released: moving on does not move the edge.
  await page.mouse.move(x - 300, y, { steps: 5 });
  expect(Math.round((await dock.boundingBox())!.width)).toBe(Math.round(before + 150));
});
