import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom } from "../src/atoms/pluginAtoms";
import { pluginKey } from "../src/plugins/defaults";
import { enableWithRequirements, installPlugin, orderedInstalls, setInstalled } from "../src/plugins/host";
import { parseSpec, previewPlugin, PluginLoadError, resolvePlugin, validateManifest, type LoaderDeps } from "../src/plugins/loader";
import { activationOrder, neededBy, requiredInstalls, type OrderProblem } from "../src/plugins/requires";
import type { PluginManifest } from "../src/plugins/api";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function servedDeps(files: Record<string, string>): Pick<LoaderDeps, "fetchText" | "builtins"> {
  return {
    fetchText: async (url) => { const body = files[url]; if (body === undefined) throw new Error(`404 ${url}`); return body; },
    builtins: {},
  };
}

function githubFiles(owner: string, repo: string, sha: string, manifest: object) {
  return {
    [`https://api.github.com/repos/${owner}/${repo}/commits/HEAD`]: JSON.stringify({ sha, commit: { message: "x" } }),
    [`https://raw.githubusercontent.com/${owner}/${repo}/${sha}/plugin.json`]: JSON.stringify(manifest),
  };
}

/** Loader deps with no network: installs are listed, activation fails harmlessly. */
const offline: LoaderDeps = { fetchText: async () => { throw new Error("offline"); }, transpile: async (s) => s, createModuleUrl: () => "mem:0", importModule: async () => ({}), builtins: {} };

const lookup = (manifests: Record<string, PluginManifest | undefined>) => (spec: string) => manifests[spec] ?? null;

describe("manifest requires", () => {
  it("reads a list of specs, canonicalised and deduplicated, and ignores what is not one", () => {
    const m = validateManifest({ name: "A", requires: ["https://github.com/scm-js/plugin-eudplib", "github:scm-js/plugin-eudplib", " builtin:x ", 3, ""] }, "m");
    expect(m.requires).toEqual(["github:scm-js/plugin-eudplib", "builtin:x"]);
    expect(validateManifest({ name: "A", requires: "github:o/p" }, "m").requires).toBeUndefined();
    expect(validateManifest({ name: "A", requires: [] }, "m").requires).toBeUndefined();
  });

  it("refuses a manifest whose requires names something the editor cannot install", () => {
    expect(() => validateManifest({ name: "A", requires: ["nonsense"] }, "plugin.json")).toThrow(PluginLoadError);
    expect(() => validateManifest({ name: "A", requires: ["nonsense"] }, "plugin.json")).toThrow(/"requires" names a plugin location the editor cannot use, "nonsense"/);
  });

  it("comes through resolvePlugin like the other fields", async () => {
    const deps = servedDeps({ "https://x/a/plugin.json": JSON.stringify({ name: "A", entry: "plugin.js", requires: ["github:o/lib"] }) });
    expect((await resolvePlugin(parseSpec("https://x/a/"), deps, { entry: false })).manifest.requires).toEqual(["github:o/lib"]);
  });
});

describe("who needs whom", () => {
  const installs = [
    { spec: "github:o/lib@v1.0.0", enabled: true },
    { spec: "github:o/app@v2.0.0", enabled: true },
    { spec: "github:o/other", enabled: false },
  ];
  const manifests = lookup({
    "github:o/app@v2.0.0": { name: "App", requires: ["github:o/lib"] },
    "github:o/other": { name: "Other", requires: ["github:o/lib"] },
    "github:o/lib@v1.0.0": { name: "Lib" },
  });

  it("matches a requirement to the installed row by plugin, whatever version either names", () => {
    expect(requiredInstalls("github:o/app@v2.0.0", installs, manifests, pluginKey)).toEqual([{ spec: "github:o/lib@v1.0.0", enabled: true }]);
    expect(requiredInstalls("github:o/lib@v1.0.0", installs, manifests, pluginKey)).toEqual([]);
    // A manifest not read yet requires nothing, as far as the list can tell.
    expect(requiredInstalls("github:o/lib@v1.0.0", installs, () => null, pluginKey)).toEqual([]);
  });

  it("counts only enabled dependents as holding a plugin", () => {
    expect([...neededBy(installs, manifests, pluginKey)]).toEqual([["github:o/lib@v1.0.0", ["github:o/app@v2.0.0"]]]);
    const allOn = installs.map((p) => ({ ...p, enabled: true }));
    expect(neededBy(allOn, manifests, pluginKey).get("github:o/lib@v1.0.0")).toEqual(["github:o/app@v2.0.0", "github:o/other"]);
    expect(neededBy(installs.map((p) => ({ ...p, enabled: false })), manifests, pluginKey).size).toBe(0);
  });

  it("orders each plugin after what it requires, keeping the list's order otherwise", () => {
    const list = [
      { spec: "github:o/app", enabled: true },
      { spec: "github:o/z", enabled: true },
      { spec: "github:o/lib", enabled: true },
      { spec: "github:o/base", enabled: true },
    ];
    const chain = lookup({ "github:o/app": { name: "App", requires: ["github:o/lib"] }, "github:o/lib": { name: "Lib", requires: ["github:o/base"] } });
    expect(activationOrder(list, chain, pluginKey).map((p) => p.spec)).toEqual(["github:o/base", "github:o/lib", "github:o/app", "github:o/z"]);
    // Nothing to say: the same list back.
    expect(activationOrder(list, () => null, pluginKey).map((p) => p.spec)).toEqual(list.map((p) => p.spec));
  });

  it("reports a missing requirement and a cycle, and still returns every plugin once", () => {
    const list = [{ spec: "github:o/a", enabled: true }, { spec: "github:o/b", enabled: true }];
    const problems: OrderProblem[] = [];
    const manifests = lookup({ "github:o/a": { name: "A", requires: ["github:o/b", "github:o/nowhere"] }, "github:o/b": { name: "B", requires: ["github:o/a"] } });
    const order = activationOrder(list, manifests, pluginKey, (p) => problems.push(p));
    expect(order.map((p) => p.spec).sort()).toEqual(["github:o/a", "github:o/b"]);
    expect(order.length).toBe(2);
    expect(problems).toEqual([
      { kind: "cycle", spec: "github:o/b", required: "github:o/a" },
      { kind: "unknown", spec: "github:o/a", required: "github:o/nowhere" },
    ]);
  });

  it("orderedInstalls reads the manifests the store holds", () => {
    const store = createStore();
    store.set(pluginManifestCacheAtom, { "github:o/app": { manifest: { name: "App", requires: ["github:o/lib"] }, icon: null, at: 0 } });
    store.set(pluginRuntimesAtom, { "github:o/lib": { spec: "github:o/lib", status: "disabled", manifest: { name: "Lib" }, icon: null, error: null } });
    const list = [{ spec: "github:o/app", enabled: true }, { spec: "github:o/lib", enabled: true }];
    expect(orderedInstalls(store, list).map((p) => p.spec)).toEqual(["github:o/lib", "github:o/app"]);
  });
});

describe("installing and enabling with requirements", () => {
  it("installs what the plugin requires before the plugin, with the same choices", async () => {
    const store = createStore();
    const read = servedDeps({ ...githubFiles("o", "app", SHA, { name: "App", requires: ["github:o/lib"] }), ...githubFiles("o", "lib", SHA, { name: "Lib" }) });
    const preview = await previewPlugin("github:o/app", read);
    expect(preview.manifest?.requires).toEqual(["github:o/lib"]);
    // The requirement is read through the same deps when the caller has no preview for it.
    await installPlugin(store, preview, { enabled: false, pin: false, deps: { ...offline, fetchText: read.fetchText } });
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:o/lib", enabled: false }, { spec: "github:o/app", enabled: false }]);
    expect(store.get(pluginRuntimesAtom)["github:o/lib"]).toMatchObject({ manifest: { name: "Lib" } });
  });

  it("takes the confirmation's previews, pins them too, and skips a requirement already listed", async () => {
    const store = createStore();
    const read = servedDeps({ ...githubFiles("o", "app", SHA, { name: "App", requires: ["github:o/lib", "github:o/have"] }), ...githubFiles("o", "lib", SHA, { name: "Lib" }) });
    setInstalled(store, `github:o/have@${SHA}`, { enabled: false });
    const preview = await previewPlugin("github:o/app", read);
    const lib = await previewPlugin("github:o/lib", read);
    await installPlugin(store, preview, { enabled: false, deps: offline, requirements: [{ spec: "github:o/lib", preview: lib }, { spec: "github:o/have", preview: null }] });
    expect(store.get(installedPluginsAtom)).toEqual([
      { spec: `github:o/have@${SHA}`, enabled: false },
      { spec: `github:o/lib@${SHA}`, enabled: false },
      { spec: `github:o/app@${SHA}`, enabled: false },
    ]);
  });

  it("a requirement that cannot be read does not stop the install", async () => {
    const store = createStore();
    const read = servedDeps(githubFiles("o", "app", SHA, { name: "App", requires: ["github:o/gone"] }));
    const preview = await previewPlugin("github:o/app", read);
    await installPlugin(store, preview, { enabled: false, deps: { ...offline, fetchText: read.fetchText } });
    // `previewPlugin` never throws for a bad address, so the unreadable requirement is listed
    // (unpinned: GitHub answered nothing to pin it to) and will show its error on its own row.
    expect(store.get(installedPluginsAtom).map((p) => p.spec)).toEqual(["github:o/gone", `github:o/app@${SHA}`]);
  });

  it("enabling a plugin enables what it requires first", async () => {
    const store = createStore();
    setInstalled(store, "github:o/lib", { enabled: false });
    setInstalled(store, "github:o/app", { enabled: false });
    store.set(pluginManifestCacheAtom, { "github:o/app": { manifest: { name: "App", requires: ["github:o/lib"] }, icon: null, at: 0 } });
    await enableWithRequirements(store, "github:o/app", offline);
    expect(store.get(installedPluginsAtom)).toEqual([{ spec: "github:o/lib", enabled: true }, { spec: "github:o/app", enabled: true }]);
    // Both were asked to start (offline, so both failed the same way) — the requirement first.
    expect(store.get(pluginRuntimesAtom)["github:o/lib"]?.status).toBe("error");
    expect(store.get(pluginRuntimesAtom)["github:o/app"]?.status).toBe("error");
  });
});
