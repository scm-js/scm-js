import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom, pluginUpdateCheckAtom, pluginUpdatesAtom, type PluginRuntime } from "../src/atoms/pluginAtoms";
import { RECHECK_MS } from "../src/editor/updates";
import { defaultPlugins, pluginKey, updateAddress } from "../src/plugins/defaults";
import type { UpdateCheck } from "../src/plugins/host";
import { unpin, type PluginPreview } from "../src/plugins/loader";
import { parseRegistry, type Registry } from "../src/plugins/registry";
import {
  answerFor, autoUpdateBlock, autoUpdateToast, checkAllForUpdates, compareVersions, runUpdatePass, shouldCheckPlugins, updateAllPlugins, updatesFromRegistries, updateToast, type UpdateDeps,
} from "../src/plugins/updates";

const rt = (spec: string, name: string, version: string): Record<string, PluginRuntime> => ({
  [spec]: { spec, status: "active", manifest: { name, version } as never, icon: null, error: null, contributions: { menu: 0, contextMenu: 0, hotkeys: 0, events: 0, preferences: 0 } } as never,
});

const registry = (...plugins: object[]): Registry =>
  parseRegistry({ format: 1, name: "Test", plugins }, "https://example.test/plugins.json");

const preview = (spec: string, version: string, extra: Partial<PluginPreview> = {}): PluginPreview => ({
  spec, source: { kind: "remote" } as never, manifest: { name: "X", version } as never, icon: null,
  pin: { spec: `${spec}@0000000000000000000000000000000000000000`, source: {} as never, ref: "0".repeat(40), short: "0000000" },
  pinProblem: null, ref: null, problem: null, needsApi: null, ...extra,
});

const check = (spec: string, version: string, newer = true): UpdateCheck => ({ preview: preview(spec, version), current: null, tag: `v${version}`, newer });

describe("plugin update versions", () => {
  it("compares dotted versions with a v and a prerelease that ranks below its release", () => {
    expect(compareVersions("1.2.0", "1.10.0")).toBeLessThan(0);
    expect(compareVersions("v1.2", "1.2.0")).toBe(0);
    expect(compareVersions("2.0.0-rc.1", "2.0.0")).toBeLessThan(0);
    expect(compareVersions("2.0.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-beta", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("is due once per RECHECK_MS and never in manual", () => {
    expect(shouldCheckPlugins("notify", null, 1000)).toBe(true);
    expect(shouldCheckPlugins("notify", 0, 1000)).toBe(true);
    expect(shouldCheckPlugins("auto", 1000, 1000 + RECHECK_MS - 1)).toBe(false);
    expect(shouldCheckPlugins("auto", 1000, 1000 + RECHECK_MS)).toBe(true);
    expect(shouldCheckPlugins("manual", null, 1000)).toBe(false);
  });
});

describe("plugin updates from the registries", () => {
  const paint = "github:scm-js/plugin-paint@v1.0.0";
  const mine = "github:me/plugin-mine@v0.3.0";
  const branch = "github:me/plugin-dev";
  const installs = [
    { spec: paint, enabled: true },
    { spec: mine, enabled: true },
    { spec: branch, enabled: true },
  ];
  const runtimes = { ...rt(paint, "Paint", "1.0.0"), ...rt(mine, "Mine", "0.3.0"), ...rt(branch, "Dev", "0.0.1") };

  it("names the rows a registry lists at a newer version and sends the rest to their address", () => {
    const reg = registry({ spec: "github:scm-js/plugin-paint", name: "Paint", version: "1.1.0" });
    const { found, ask } = updatesFromRegistries(installs, runtimes, {}, [reg]);
    expect(found).toEqual([{ spec: paint, address: paint, name: "Paint", from: "1.0.0", to: "1.1.0", preview: null }]);
    // Mine is not listed; Dev follows a branch and has Reload for its update.
    expect(ask).toEqual([{ spec: mine, address: mine, name: "Mine", from: "0.3.0" }]);
  });

  it("says nothing for a row already at the listed version, or one whose running version is unknown", () => {
    const reg = registry({ spec: "github:scm-js/plugin-paint", name: "Paint", version: "1.0.0" });
    expect(updatesFromRegistries([installs[0]], runtimes, {}, [reg]).found).toEqual([]);
    // Listed, but nothing loaded or cached to compare against: left to the row's button
    // rather than asked at its address, which keeps the defaults off GitHub's meter.
    const unknown = updatesFromRegistries([installs[0]], {}, {}, [registry({ spec: "github:scm-js/plugin-paint", name: "Paint", version: "9.0.0" })]);
    expect(unknown).toMatchObject({ found: [], ask: [], current: [] });
    // No running version to compare: the startup pass leaves it, a press asks its address.
    expect(unknown.unversioned.map((a) => a.spec)).toEqual([installs[0].spec]);
    // A version cached from an earlier session stands in for one no plugin loaded.
    const cached = { [paint]: { manifest: { name: "Paint", version: "0.9.0" }, icon: null, at: 0 } } as never;
    expect(updatesFromRegistries([installs[0]], {}, cached, [reg]).found[0]).toMatchObject({ from: "0.9.0", to: "1.0.0" });
  });

  it("matches a bundled default to its registry entry and asks at the address it was built from", () => {
    const shipped = defaultPlugins().find((d) => d.spec.startsWith("builtin:"));
    if (!shipped) return; // no vendored copies in this checkout
    const key = shipped.spec.slice("builtin:".length);
    const reg = registry({ spec: `github:scm-js/plugin-${key}`, name: key, version: "99.0.0" });
    const { found } = updatesFromRegistries([shipped], rt(shipped.spec, key, "1.0.0"), {}, [reg]);
    expect(found).toHaveLength(1);
    expect(found[0].address).not.toMatch(/^builtin:/);
  });
});

describe("plugin auto-update rules", () => {
  it("leaves defaults, plugins turned off, saved copies and a newer API to the button", () => {
    const defaults = ["github:scm-js/plugin-paint@v1.0.0"];
    expect(autoUpdateBlock({ spec: "github:scm-js/plugin-paint@v1.2.0", enabled: true }, { defaults })).toMatch(/default/);
    expect(autoUpdateBlock({ spec: "builtin:paint", enabled: true }, { defaults: ["builtin:paint"] })).toMatch(/default/);
    expect(autoUpdateBlock({ spec: "github:me/plugin-x@v1", enabled: false }, { defaults })).toBe("turned off");
    expect(autoUpdateBlock({ spec: "github:me/plugin-x@v1", enabled: true, local: true }, { defaults })).toMatch(/copy/);
    expect(autoUpdateBlock({ spec: "github:me/plugin-x@v1", enabled: true }, { defaults, needsApi: 99 })).toMatch(/plugin API/);
    expect(autoUpdateBlock({ spec: "github:me/plugin-x@v1", enabled: true }, { defaults, needsApi: 1 })).toBeNull();
  });
});

describe("plugin update notices", () => {
  const one = { spec: "s", address: "s", name: "Repair", from: "1.2.0", to: "1.3.0", preview: null };
  const two = { spec: "t", address: "t", name: "Paint", from: null, to: "2.0.0", preview: null };

  it("names one update, counts several, and opens the plugins dialog", () => {
    let opened = 0;
    const t = updateToast([one], () => { opened++; })!;
    expect(t).toMatchObject({ kind: "info", title: "Repair 1.3.0 is available", ttl: 0 });
    expect(t.detail).toBe("You have 1.2.0.");
    t.action!.run();
    expect(opened).toBe(1);
    expect(updateToast([one, two], () => {})!).toMatchObject({ title: "2 plugin updates are available", detail: "Repair 1.2.0 to 1.3.0, Paint to 2.0.0." });
    expect(updateToast([], () => {})).toBeNull();
  });

  it("says what an install pass did and why it left something", () => {
    expect(autoUpdateToast({ installed: [], skipped: [], failed: [] }, () => {})).toBeNull();
    const done = autoUpdateToast({ installed: [one], skipped: [], failed: [] }, () => {})!;
    expect(done).toMatchObject({ kind: "info", title: "Repair updated to 1.3.0", detail: "Updated Repair 1.2.0 to 1.3.0." });
    const mixed = autoUpdateToast({ installed: [one], skipped: [{ update: two, reason: "a default, which moves with the editor's own releases" }], failed: [] }, () => {})!;
    expect(mixed.detail).toBe("Updated Repair 1.2.0 to 1.3.0. Paint 2.0.0 is available; it is left to the row's button, being a default, which moves with the editor's own releases.");
    const failed = autoUpdateToast({ installed: [], skipped: [], failed: [{ update: one, error: "Failed to fetch." }] }, () => {})!;
    expect(failed).toMatchObject({ kind: "warn", title: "A plugin update failed", detail: "Could not update Repair: Failed to fetch." });
    expect(autoUpdateToast({ installed: [], skipped: [{ update: two, reason: "turned off" }], failed: [] }, () => {})!.title).toBe("Paint 2.0.0 is available");
  });
});

describe("plugin update pass", () => {
  // The defaults are folded in by `effectiveInstalls`, whatever this checkout's specs
  // are, so the fixture lists every one of them (Paint first, at a newer version) and
  // runs Paint alone; the other four have no version to compare and stay quiet.
  const paint = defaultPlugins().find((d) => pluginKey(d.spec) === pluginKey("github:scm-js/plugin-paint"))!.spec;
  const mine = "github:me/plugin-mine@v0.3.0";
  const listed = [
    { spec: "github:scm-js/plugin-paint", name: "Paint", version: "1.1.0" },
    ...defaultPlugins().map((d) => ({ spec: unpin(updateAddress(d.spec)!), name: d.spec, version: "0.0.1" })),
  ];
  const setup = () => {
    const store = createStore();
    store.set(installedPluginsAtom, [{ spec: mine, enabled: true }]);
    store.set(pluginRuntimesAtom, { ...rt(paint, "Paint", "1.0.0"), ...rt(mine, "Mine", "0.3.0") });
    store.set(pluginManifestCacheAtom, {});
    const asked: string[] = [];
    const installed: { spec: string; replaces: string }[] = [];
    const deps: UpdateDeps = {
      loadRegistries: async () => [registry(...listed)],
      checkForUpdate: async (address) => { asked.push(address); return check(address.replace(/@.*$/, ""), "0.4.0"); },
      installPlugin: async (_s, p, o) => { installed.push({ spec: p.spec, replaces: o.replaces }); },
      now: () => 12345,
    };
    return { store, asked, installed, deps };
  };

  it("in notify records what it found for Manage Plugins and installs nothing", async () => {
    const { store, asked, installed, deps } = setup();
    // The defaults are folded in by `effectiveInstalls`; the one listed here answers from the registry alone.
    const { found, outcome } = await runUpdatePass(store, "notify", deps);
    expect(outcome).toBeNull();
    expect(installed).toEqual([]);
    expect(store.get(pluginUpdateCheckAtom)).toEqual({ at: 12345 });
    // Mine is listed nowhere, so its address was asked; the registry answered for the rest.
    expect(asked).toEqual([mine]);
    const byName = Object.fromEntries(found.map((u) => [u.name, u]));
    expect(byName.Mine).toMatchObject({ from: "0.3.0", to: "0.4.0" });
    expect(byName.Mine.preview).not.toBeNull();
    const answers = store.get(pluginUpdatesAtom);
    expect(answers[mine]).toMatchObject({ kind: "newer", version: "0.4.0" });
    // The registry's answer names a version but carries no preview yet: the row fetches one on the press.
    expect(answers[paint]).toEqual({ kind: "newer", version: "1.1.0", preview: null });
    expect(found).toHaveLength(2);
  });

  it("in auto installs what it may and leaves the defaults to the button, naming why", async () => {
    const { store, installed, deps } = setup();
    const { outcome } = await runUpdatePass(store, "auto", deps);
    expect(installed).toEqual([{ spec: mine.replace(/@.*$/, ""), replaces: mine }]);
    expect(outcome!.installed.map((u) => u.name)).toEqual(["Mine"]);
    expect(outcome!.failed).toEqual([]);
    expect(outcome!.skipped).toEqual([{ update: expect.objectContaining({ name: "Paint" }), reason: "a default, which moves with the editor's own releases" }]);
    // The default's answer stays, so the row still offers it.
    expect(store.get(pluginUpdatesAtom)[paint]).toMatchObject({ kind: "newer" });
    // An installed update is no longer an answer on the (now gone) row.
    expect(store.get(pluginUpdatesAtom)[mine]).toBeUndefined();
  });

  it("in auto reports an install that failed and a registry that could not be read", async () => {
    const { store, deps } = setup();
    const { outcome } = await runUpdatePass(store, "auto", {
      ...deps,
      loadRegistries: async () => { throw new Error("offline"); },
      installPlugin: async () => { throw new Error("Failed to fetch."); },
    });
    expect(outcome!.failed).toEqual([{ update: expect.objectContaining({ name: "Mine" }), error: "Failed to fetch." }]);
    expect(store.get(pluginUpdatesAtom)[mine]).toMatchObject({ kind: "newer" });
  });

  it("skips a plugin whose address check says it is current after all", async () => {
    const { store, installed, deps } = setup();
    const { found } = await runUpdatePass(store, "auto", { ...deps, checkForUpdate: async (a) => check(a, "0.3.0", false) });
    expect(found.find((u) => u.name === "Mine")).toBeUndefined();
    expect(installed).toEqual([]);
  });
});

describe("checking and updating every plugin on request", () => {
  const paint = defaultPlugins().find((d) => pluginKey(d.spec) === pluginKey("github:scm-js/plugin-paint"))!.spec;
  const other = defaultPlugins().find((d) => d.spec !== paint)!.spec;
  const mine = "github:me/plugin-mine@v0.3.0";
  const listed = [
    { spec: "github:scm-js/plugin-paint", name: "Paint", version: "1.1.0" },
    ...defaultPlugins().filter((d) => d.spec !== paint).map((d) => ({ spec: unpin(updateAddress(d.spec)!), name: d.spec, version: "0.0.1" })),
  ];
  const setup = (opts: { needsApi?: number } = {}) => {
    const store = createStore();
    store.set(installedPluginsAtom, [{ spec: mine, enabled: false, local: true }]);
    store.set(pluginRuntimesAtom, { ...rt(paint, "Paint", "1.0.0"), ...rt(mine, "Mine", "0.3.0"), ...rt(other, "Other", "0.0.1") });
    store.set(pluginManifestCacheAtom, {});
    const asked: string[] = [];
    const forced: (boolean | undefined)[] = [];
    const installed: { replaces: string; local: boolean; enabled?: boolean }[] = [];
    const deps: UpdateDeps = {
      loadRegistries: async (_s, o) => { forced.push(o?.force); return [registry(...listed)]; },
      checkForUpdate: async (address) => {
        asked.push(address);
        const bare = address.replace(/@.*$/, "");
        if (bare.endsWith("plugin-mine")) return check(bare, "0.4.0");
        if (bare.endsWith("plugin-paint")) return { ...check(bare, "1.1.0"), preview: preview(bare, "1.1.0", { needsApi: opts.needsApi ?? null }) };
        return check(bare, "0.0.1", false);
      },
      installPlugin: async (_s, _p, o) => { installed.push({ replaces: o.replaces, local: o.local, enabled: o.enabled }); },
      now: () => 777,
    };
    return { store, asked, forced, installed, deps };
  };

  it("answers every row: the registry where it can, the address for the rest, fetched fresh", async () => {
    const { store, asked, forced, deps } = setup();
    const r = await checkAllForUpdates(store, deps);
    expect(forced).toEqual([true]);
    // Paint and Other are answered by the registry alone; Mine is listed nowhere.
    expect(asked).toContain(mine);
    expect(asked.some((a) => a.includes("plugin-paint"))).toBe(false);
    expect(asked).not.toContain(updateAddress(other));
    // The other defaults are off here (no runtime): their tag names the version, so nobody is asked.
    expect(asked).toEqual([mine]);
    const answers = store.get(pluginUpdatesAtom);
    expect(answers[paint]).toEqual({ kind: "newer", version: "1.1.0", preview: null });
    expect(answers[mine]).toMatchObject({ kind: "newer", version: "0.4.0" });
    expect(answers[other]).toMatchObject({ kind: "current" });
    expect(r.newer).toBe(2);
    expect(r.problem).toBe(0);
    expect(store.get(pluginUpdateCheckAtom)).toEqual({ at: 777 });
  });

  it("puts a check that failed on its row", async () => {
    const { store, deps } = setup();
    const r = await checkAllForUpdates(store, { ...deps, checkForUpdate: async () => { throw new Error("rate limited"); } });
    expect(store.get(pluginUpdatesAtom)[mine]).toEqual({ kind: "problem", text: "rate limited" });
    expect(r.problem).toBeGreaterThan(0);
  });

  it("installs every offer, keeping each row's settings, and clears what it installed", async () => {
    const { store, installed, deps } = setup();
    await checkAllForUpdates(store, deps);
    const outcome = await updateAllPlugins(store, deps);
    expect(outcome.installed.map((u) => u.name).sort()).toEqual(["Mine", "Paint"]);
    expect(installed).toContainEqual({ replaces: mine, local: true, enabled: false });
    expect(installed).toContainEqual({ replaces: paint, local: false, enabled: true });
    const answers = store.get(pluginUpdatesAtom);
    expect(answers[paint]).toBeUndefined();
    expect(answers[mine]).toBeUndefined();
  });

  it("leaves a release built for a newer plugin API, and says why", async () => {
    const { store, installed, deps } = setup({ needsApi: 99 });
    await checkAllForUpdates(store, deps);
    const outcome = await updateAllPlugins(store, deps);
    expect(outcome.skipped).toEqual([{ update: expect.objectContaining({ name: "Paint" }), reason: expect.stringMatching(/plugin API \(99\)/) }]);
    expect(installed.map((i) => i.replaces)).toEqual([mine]);
    expect(store.get(pluginUpdatesAtom)[paint]).toMatchObject({ kind: "newer" });
  });

  it("words an address check as the row shows it", () => {
    expect(answerFor(check("github:me/x", "1.0.0", false))).toEqual({ kind: "current", text: "X v1.0.0 is the newest version there is." });
    expect(answerFor(check("github:me/x", "1.1.0"))).toMatchObject({ kind: "newer", version: "1.1.0" });
    expect(answerFor({ ...check("github:me/x", "1.0.0"), preview: preview("github:me/x", "1.0.0", { manifest: null, problem: "404" }) })).toMatchObject({ kind: "problem" });
  });
});
