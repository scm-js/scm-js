/**
 * The step that copies the default plugins' runtimes into the desktop and container builds
 * (`scripts/bundle-plugin-runtimes.mjs`). Nothing here touches the network: what is worth
 * pinning is that a plugin's `runtime.json` cannot write outside its own directory or fetch
 * over anything but https, and where a repository path is fetched from.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error - a plain .mjs script, imported for its pure parts.
import { checkManifest, sourceUrl } from "../scripts/bundle-plugin-runtimes.mjs";

const ok = { plugin: "eudplib", version: "0.3.0", files: [{ path: "pyodide/pyodide.mjs", from: "https://cdn.jsdelivr.net/pyodide/v1/full/pyodide.mjs" }, { path: "dist/worker.js", from: "dist/worker.js" }] };
const withFile = (path: string, from = "dist/x") => ({ ...ok, files: [{ path, from }] });

describe("a plugin's runtime.json", () => {
  it("is taken when every file stays in its directory", () => {
    expect(checkManifest(ok, "spec")).toBe(ok);
  });
  it("is refused when a path leaves the directory or collides with the manifest", () => {
    for (const path of ["../x", "a/../../x", "/etc/passwd", "a//b", "./x", "C:/x", "a\\b", "runtime.json"]) {
      expect(() => checkManifest(withFile(path), "spec"), path).toThrow(/runtime\.json/);
    }
    expect(() => checkManifest({ ...ok, files: [ok.files[1], ok.files[1]] }, "spec")).toThrow(/twice/);
  });
  it("is refused when the plugin or version is not one plain directory name", () => {
    for (const bad of [{ plugin: "../x" }, { plugin: "" }, { version: "../1" }, { version: "1/2" }, { files: [] }]) {
      expect(() => checkManifest({ ...ok, ...bad }, "spec")).toThrow(/runtime\.json/);
    }
  });
  it("is refused when a file comes over anything but https", () => {
    for (const from of ["http://x/y", "file:///etc/passwd", "data:,x"]) expect(() => checkManifest(withFile("x", from), "spec"), from).toThrow(/https/);
  });
});

describe("where a runtime file comes from", () => {
  const gh = { owner: "scm-js", repo: "plugin-eudplib", ref: "v0.3.0", dir: "" };
  it("fetches a repository path at the pinned tag, and an address as it is", () => {
    expect(sourceUrl("dist/worker.js", gh)).toBe("https://raw.githubusercontent.com/scm-js/plugin-eudplib/v0.3.0/dist/worker.js");
    expect(sourceUrl("dist/w.js", { ...gh, dir: "/sub/" })).toBe("https://raw.githubusercontent.com/scm-js/plugin-eudplib/v0.3.0/sub/dist/w.js");
    expect(sourceUrl("https://cdn.jsdelivr.net/a", gh)).toBe("https://cdn.jsdelivr.net/a");
  });
});
