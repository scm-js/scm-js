/**
 * Whether the editor has the site's pages beside it (`site.ts#onSite`): the one rule the
 * menu bar's links to Play, Replays and the library, the mark's link home and the start
 * screen's library link all hang on. A wrong yes puts dead links in the desktop app or in
 * somebody's own copy of the editor.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isOnSite } from "../src/editor/platform";
import { onSite, SITE_ORIGIN, SITE_PAGES, type PageAddress } from "../src/site";

const at = (href: string): PageAddress => {
  const url = new URL(href);
  // A scheme of the desktop app's own has no origin a URL will name; the page's is its scheme and host.
  return { origin: url.origin === "null" ? `${url.protocol}//${url.host}` : url.origin, hostname: url.hostname, pathname: url.pathname };
};

describe("on the site", () => {
  it("is scmjs.dev: the editor, the nightly beside it, and a link into either", () => {
    expect(onSite(at("https://scmjs.dev/editor/"))).toBe(true);
    expect(onSite(at("https://scmjs.dev/editor/?nosplash"))).toBe(true);
    expect(onSite(at("https://scmjs.dev/editor/map/abc123"))).toBe(true);
    expect(onSite(at("https://scmjs.dev/nightly/"))).toBe(true);
  });

  it("is a stand-in for the site on this machine, which serves the editor under /editor/", () => {
    expect(onSite(at("http://localhost:5190/editor/"))).toBe(true);
    expect(onSite(at("http://127.0.0.1:5180/editor/replay/xyz"))).toBe(true);
  });

  it("is not the dev server, a preview of the build or the container, which serve the editor at the root", () => {
    expect(onSite(at("http://localhost:5173/"))).toBe(false);
    expect(onSite(at("http://localhost:5173/?nosplash&layer=units"))).toBe(false);
    expect(onSite(at("http://localhost:4173/share/abc"))).toBe(false);
    expect(onSite(at("http://localhost:8080/"))).toBe(false);
    // Not a path that merely starts with the word.
    expect(onSite(at("http://localhost:5173/editorial/"))).toBe(false);
  });

  it("is not an editor hosted anywhere else, whatever path it is under", () => {
    expect(onSite(at("https://maps.example.org/editor/"))).toBe(false);
    expect(onSite(at("https://someone.github.io/scm-js/"))).toBe(false);
    expect(onSite(at("http://192.168.0.12:5190/editor/"))).toBe(false);
    // The addresses the editor had before it moved, and a look-alike.
    expect(onSite(at("https://editor.scmjs.dev/"))).toBe(false);
    expect(onSite(at("https://nightly.editor.scmjs.dev/"))).toBe(false);
    expect(onSite(at("https://scmjs.dev.example.org/editor/"))).toBe(false);
    expect(onSite(at("http://scmjs.dev/editor/"))).toBe(false);
  });

  it("is never the desktop app, wherever its window loaded the editor from", () => {
    expect(onSite(at("scmjs://app/index.html"))).toBe(false);
    expect(onSite(at("file:///opt/scmJS/resources/app/dist/index.html"))).toBe(false);
    expect(onSite(at("http://localhost:5190/editor/"), true)).toBe(false);
    expect(onSite(at(`${SITE_ORIGIN}/editor/`), true)).toBe(false);
  });

  it("links to the site's pages from the root of the origin", () => {
    for (const path of Object.values(SITE_PAGES)) expect(path.startsWith("/")).toBe(true);
    expect(SITE_PAGES.play).toBe("/play/");
    expect(SITE_PAGES.replays).toBe("/replay/");
    expect(SITE_PAGES.library).toBe("/library");
  });
});

describe("this page", () => {
  const global = globalThis as { window?: unknown; scmjsDesktop?: unknown };
  afterEach(() => { delete global.window; delete global.scmjsDesktop; });

  it("asks the rule of the page's own address, and of the desktop bridge", () => {
    // No page at all (the command line, a test): not on the site.
    expect(isOnSite()).toBe(false);
    global.window = { location: at("https://scmjs.dev/editor/") };
    expect(isOnSite()).toBe(true);
    global.window = { location: at("http://localhost:5173/") };
    expect(isOnSite()).toBe(false);
    global.window = { location: at("https://scmjs.dev/editor/") };
    global.scmjsDesktop = { platform: "linux", version: "0.0.0" };
    expect(isOnSite()).toBe(false);
  });
});
