/**
 * The installer page (`install.html`): no interface, an ear for another page of the site
 * that frames it and hands over a StarCraft: Remastered folder. Here: it says it is there,
 * and a folder that is no installation is answered in words rather than not at all.
 */
import { test, expect } from "./support/editor";

test("the installer page answers the page that frames it", async ({ editor }) => {
  const { page } = editor;
  await page.goto("./data.html");
  const heard = await page.evaluate(async () => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    const said: { type: string; message?: string }[] = [];
    const done = new Promise<void>((resolve) => {
      window.addEventListener("message", (e) => {
        if (e.source !== frame.contentWindow) return;
        said.push({ type: e.data.type, message: e.data.message });
        if (e.data.type === "scmjs.install.ready") frame.contentWindow!.postMessage({ type: "scmjs.install", files: [{ path: "Folder/readme.txt", file: new File(["x"], "readme.txt") }] }, location.origin);
        if (e.data.type === "scmjs.install.error" || e.data.type === "scmjs.install.done") resolve();
      });
    });
    frame.src = new URL("install.html", location.href).href;
    document.body.appendChild(frame);
    await done;
    return said;
  });
  expect(heard.map((m) => m.type)).toEqual(["scmjs.install.ready", "scmjs.install.error"]);
  expect(heard[1].message).toContain("not a StarCraft: Remastered installation");
});
