/**
 * The vendoring step the desktop build runs (`scripts/vendor-plugins.mjs`).
 *
 * Nothing here touches the network: what is worth pinning is that the script and
 * `defaults.ts` agree — the script reads that file with a regex, because importing it
 * would pull in `builtin.ts` and its Vite-only `import.meta.glob` — and that every
 * default is pinned, since vendoring a moving ref would let the desktop and web builds
 * of one release drift apart with nothing to show it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - a plain .mjs script, imported for its pure parts.
import { dirNameFor, keepPath, parseDefaultSpecs, parseGithubSpec } from "../scripts/vendor-plugins.mjs";
import { DEFAULT_REMOTE_PLUGINS } from "../src/plugins/defaults";

const source = readFileSync(join(import.meta.dirname, "../src/plugins/defaults.ts"), "utf8");

describe("vendoring the default plugins", () => {
  it("reads the same defaults the editor does", () => {
    expect(parseDefaultSpecs(source)).toEqual(DEFAULT_REMOTE_PLUGINS.map((d) => ({ spec: d.spec, enabled: d.enabled })));
  });

  it("refuses to vendor anything that is not pinned", () => {
    for (const d of parseDefaultSpecs(source)) {
      const gh = parseGithubSpec(d.spec);
      expect(gh, `${d.spec} names no version`).not.toBeNull();
      expect(gh.ref).not.toBe("HEAD");
    }
    expect(parseGithubSpec("github:o/p")).toBeNull();
    expect(parseGithubSpec("https://x/p/")).toBeNull();
    expect(parseGithubSpec("github:scm-js/plugin-repair@v1.0.0")).toEqual({ owner: "scm-js", repo: "plugin-repair", ref: "v1.0.0", dir: "" });
  });

  it("takes the plugin's runtime source and leaves the rest", () => {
    for (const path of ["plugin.ts", "plugin.json", "icon.svg", "analyze.ts", "convert.ts", "LICENSE", "lib/deep.ts"]) {
      expect(keepPath(path), path).toBe(true);
    }
    // `plugin-api/` is imported with `import type` and erased before the bundler sees it;
    // tests, workflows and package files are not runtime source either.
    for (const path of ["plugin-api/plugins/api.d.ts", "tests/convert.test.ts", "convert.test.ts", ".github/workflows/registry.yml", "package.json", "tsconfig.json", "README.md", ".gitignore", "node_modules/x/index.js"]) {
      expect(keepPath(path), path).toBe(false);
    }
  });

  it("names the directory after the plugin, not the repository", () => {
    expect(dirNameFor("plugin-image-to-terrain")).toBe("image-to-terrain");
    expect(dirNameFor("plugin-scm-scx")).toBe("scm-scx");
    expect(dirNameFor("something-else")).toBe("something-else");
  });
});
