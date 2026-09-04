/**
 * The remote loading path, over the real network, against the real repositories.
 *
 * Every default plugin used to be fetched at the start of every session, so `parseSpec` →
 * `resolvePlugin` → `candidateUrls` → `bundleModule` → transpile → `import()` was smoke
 * tested by simply opening the editor, on every machine, every day. The defaults are
 * compiled in now (`scripts/vendor-plugins.mjs` — it is worth 890 KB gzipped off the cold
 * start), which takes that guarantee away: a break in the loader would ship and only
 * surface the first time somebody installed a plugin from Browse. This is the deliberate
 * replacement for an accidental guarantee.
 *
 * It is off unless `SCMJS_NETWORK_TESTS=1`, so an ordinary `npm test` stays offline and
 * fast. CI sets it on the same job that vendors, which already needs GitHub — so this
 * adds no dependency the build did not have, and a failure here means the loader is
 * broken or the repository moved, both of which should stop a release.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { bundleModule, loadPlugin, parseSpec, previewPlugin, type LoaderDeps } from "../src/plugins/loader";
import { resolveActivate } from "../src/plugins/host";
import { transpileTs } from "../src/plugins/transpile";
import { DEFAULT_REMOTE_PLUGINS } from "../src/plugins/defaults";

const live = process.env.SCMJS_NETWORK_TESTS === "1";

/**
 * The browser's deps, in Node. The one difference is the module URL: `blob:` is a browser
 * thing, and `import()` in Node takes a `data:` URL instead — everything the loader does
 * around it (following relative imports, rewriting their specifiers to those URLs) is the
 * same code the editor runs.
 */
const nodeDeps: LoaderDeps = {
  fetchText: async (url) => {
    const res = await fetch(url, { headers: { "user-agent": "scm-js tests" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`);
    return res.text();
  },
  transpile: async (source, fileName) => transpileTs(ts, source, fileName),
  createModuleUrl: (code) => `data:text/javascript;base64,${Buffer.from(code, "utf8").toString("base64")}`,
  importModule: (url) => import(/* @vite-ignore */ url),
  builtins: {},
};

describe.skipIf(!live)("loading a plugin over the network", () => {
  // The whole path, on the plugin with the deepest import graph of the defaults: its
  // entry pulls in three siblings, one of them extensionless, which is what `candidateUrls`
  // exists for and what the first remote load of Terrain from Image once 404ed on.
  it("fetches, transpiles and imports Repair at its pinned version", { timeout: 60_000 }, async () => {
    const spec = DEFAULT_REMOTE_PLUGINS.find((d) => d.spec.includes("plugin-repair"))!.spec;
    const { manifest, module, icon } = await loadPlugin(spec, nodeDeps);
    expect(manifest.name).toBe("Repair");
    expect(manifest.version).toBeTruthy();
    expect(icon).not.toBeNull();
    // An entry that imports its siblings and exports something the host can call is the
    // whole contract; running it needs a store and a document, which the rest of the
    // suite covers offline.
    expect(typeof resolveActivate(module)).toBe("function");
  });

  it("reads every default's manifest at the version it is pinned to", { timeout: 90_000 }, async () => {
    for (const d of DEFAULT_REMOTE_PLUGINS) {
      const preview = await previewPlugin(d.spec, nodeDeps);
      expect(preview.problem, `${d.spec}: ${preview.problem}`).toBeNull();
      expect(preview.manifest?.name, d.spec).toBeTruthy();
      // The tag has to be a tag that is there; a pin that names nothing is a plugin that
      // does not load, and nothing else in the suite can tell.
      expect(parseSpec(d.spec)).toMatchObject({ kind: "remote" });
    }
  });

  it("refuses a plugin that imports a package rather than a file", { timeout: 30_000 }, async () => {
    const entry = "https://raw.githubusercontent.com/scm-js/plugin-paint/v1.0.0/plugin.ts";
    await expect(bundleModule(entry, { ...nodeDeps, fetchText: async () => `import "lodash";` })).rejects.toThrow(/lodash|bare|package/i);
  });
});
