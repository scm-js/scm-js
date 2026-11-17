/**
 * Preferences ▸ View's two additions: the interface size, from the stored preference to
 * the attribute and zoom `styles/size.css` keys on (both the early script in `index.html`
 * and `applyInterfaceSize` after it), and the rule that keeps notices until they are
 * closed.
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { mergeDefaults } from "../src/app/storage";
import { pushToastAtom, toastsAtom } from "../src/atoms/uiAtoms";
import { applyInterfaceSize, SIZE_ATTRIBUTE, type SizeRoot } from "../src/app/interfaceSize";
import { DEFAULT_PREFERENCES, INTERFACE_SIZES, interfaceZoom } from "../src/app/preferences";
import { defaultToastTtl, toastLifetime } from "../src/app/view";

/** A stand-in for `document.documentElement`: what it was given, as the page would have it. */
function fakeRoot() {
  const attributes = new Map<string, string>();
  const properties = new Map<string, string>();
  const root: SizeRoot = {
    setAttribute: (k, v) => { attributes.set(k, v); },
    removeAttribute: (k) => { attributes.delete(k); },
    style: { setProperty: (k, v) => { properties.set(k, v); }, removeProperty: (k) => { properties.delete(k); } },
  };
  return { root, state: () => ({ size: attributes.get(SIZE_ATTRIBUTE) ?? null, zoom: properties.get("--ui-zoom") ?? null }) };
}

/** A selector list split at its own commas, not those inside `:is(…)` / `:not(…)`. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0, from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(from, i)); from = i + 1; }
  }
  return [...out, list.slice(from)];
}

/** Run `index.html`'s interface-size script over a stored preferences value, as the page does before it paints. */
function earlyScript(stored: string | null) {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("interfaceSize"));
  expect(script, "index.html's interface-size script").toBeDefined();
  const { root, state } = fakeRoot();
  const localStorage = { getItem: (key: string) => (key === "scmjs.prefs" ? stored : null) };
  runInNewContext(script!.replace(/%SCMJS_PREFS_KEY%/g, "scmjs.prefs"), { localStorage, document: { documentElement: root }, JSON, String });
  return state();
}

describe("interface size", () => {
  it("is 100% by default, and an older stored object gets that default", () => {
    expect(DEFAULT_PREFERENCES.interfaceSize).toBe(100);
    expect(mergeDefaults(DEFAULT_PREFERENCES, { language: "ko" } as never).interfaceSize).toBe(100);
    expect(INTERFACE_SIZES).toEqual([100, 115, 130]);
  });

  it("stands for a zoom of 1, 1.15 or 1.3, and anything not offered is 1", () => {
    expect(INTERFACE_SIZES.map(interfaceZoom)).toEqual([1, 1.15, 1.3]);
    for (const odd of [120, "130", null, undefined, 0, -5]) expect(interfaceZoom(odd)).toBe(1);
  });

  it("reaches the page as the attribute and --ui-zoom, and leaves nothing behind at 100%", () => {
    const { root, state } = fakeRoot();
    applyInterfaceSize(130, root);
    expect(state()).toEqual({ size: "130", zoom: "1.3" });
    applyInterfaceSize(115, root);
    expect(state()).toEqual({ size: "115", zoom: "1.15" });
    applyInterfaceSize(100, root);
    expect(state()).toEqual({ size: null, zoom: null });
    applyInterfaceSize(125, root);
    expect(state()).toEqual({ size: null, zoom: null });
  });

  it("is on the page before the first paint: index.html's script does what applyInterfaceSize does", () => {
    for (const size of [100, 115, 130, 125]) {
      const { root, state } = fakeRoot();
      applyInterfaceSize(size, root);
      expect(earlyScript(JSON.stringify({ interfaceSize: size })), `size ${size}`).toEqual(state());
    }
    expect(earlyScript(null)).toEqual({ size: null, zoom: null });
    expect(earlyScript("not json")).toEqual({ size: null, zoom: null });
    expect(earlyScript(JSON.stringify({ language: "ko" }))).toEqual({ size: null, zoom: null });
  });

  it("zooms only under the attribute, and never the map", () => {
    const css = readFileSync(new URL("../src/styles/size.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    // Every rule is the zoomed sizes' alone. (An @container rule can only match inside the
    // container size.css makes under the attribute, so it is left out of the look.)
    const plain = css.replace(/@container[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
    expect(plain).not.toContain("@container");
    const rules = [...plain.matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim());
    expect(rules.length).toBeGreaterThan(10);
    for (const sel of rules) for (const part of topLevel(sel)) expect(part.trim(), sel).toMatch(/^:root\[data-ui-size\]/);
    // The map's own boxes are never zoomed: no entry of the zoomed list ends on one of them.
    const list = css.slice(css.indexOf(":is(") + 4, css.indexOf("zoom: var(--ui-zoom)"));
    const entries = topLevel(list.slice(0, list.lastIndexOf(")"))).map((e) => e.trim());
    expect(entries).toContain(".map-column > :not(.map-stack)");
    for (const entry of entries) expect(entry, entry).not.toMatch(/(^|[\s>])(\.map-stack|\.map-column|\.body|\.viewport|\.scroller|\.map-surface)$/);
  });
});

describe("notices", () => {
  it("leave after 6 seconds, errors after 12, or the time their caller asked for", () => {
    const store = createStore();
    store.set(pushToastAtom, { kind: "ok", title: "Saved" });
    store.set(pushToastAtom, { kind: "error", title: "Failed" });
    store.set(pushToastAtom, { kind: "info", title: "Reloaded", ttl: 2500 });
    store.set(pushToastAtom, { kind: "warn", title: "Shared", ttl: 0 });
    expect(store.get(toastsAtom).map((t) => t.ttl)).toEqual([6000, 12000, 2500, 0]);
    expect([defaultToastTtl("info"), defaultToastTtl("warn"), defaultToastTtl("error")]).toEqual([6000, 6000, 12000]);
    expect(store.get(toastsAtom).map((t) => toastLifetime(t, false))).toEqual([6000, 12000, 2500, 0]);
  });

  it("stay until closed while the preference is on, whatever time was asked for", () => {
    expect(DEFAULT_PREFERENCES.keepNotices).toBe(false);
    expect(mergeDefaults(DEFAULT_PREFERENCES, { language: "ko" } as never).keepNotices).toBe(false);
    for (const ttl of [6000, 12000, 2500, 0, 60_000]) expect(toastLifetime({ ttl }, true)).toBe(0);
  });
});
