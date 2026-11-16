/**
 * The `@scm-js/plugin-api` package the plugin repositories depend on
 * (`scripts/build-plugin-types.mjs`, `scripts/publish-plugin-api.mjs`).
 *
 * Nothing here touches the registry. What is pinned is the two rules the scheme rests on:
 * the version a publish picks, and the fact that a bundle with an import left in it is not
 * a package a plugin repository can compile against on its own — and, since 2026-11-16,
 * the bundle itself: the job that builds it runs only on a push to main, so a type that
 * pulled a library's into the declarations (an undo step naming the archive reader's
 * `StoredMembers`) passed its pull request and failed main.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain .mjs scripts, imported for their pure parts.
import { apiVersionOf, buildBundle, importsIn, nextVersion, packageJson, PACKAGE_NAME } from "../scripts/build-plugin-types.mjs";
import { PLUGIN_API_VERSION } from "../src/plugins/api";

describe("the plugin API package", () => {
  it("bundles the declarations into one file that imports nothing", () => {
    // Throws, naming the import, when a type the API reaches lives in a package.
    const dts = buildBundle({ apiVersion: PLUGIN_API_VERSION }) as string;
    expect(dts).toContain("export interface PluginApi");
    expect(importsIn(dts)).toEqual([]);
  }, 120_000);

  it("reads the API version the editor declares", () => {
    const source = readFileSync(join(import.meta.dirname, "../src/plugins/api.ts"), "utf8");
    expect(apiVersionOf(source)).toBe(PLUGIN_API_VERSION);
    expect(() => apiVersionOf("const NOPE = 1;")).toThrow(/PLUGIN_API_VERSION/);
  });

  it("versions the package by the API, not by the editor", () => {
    // Nothing published yet, or the API version moved: start that major at .0.0.
    expect(nextVersion(1, null)).toBe("1.0.0");
    expect(nextVersion(2, "1.7.0")).toBe("2.0.0");
    // Otherwise every change to the declarations is a minor, so `^1` takes it — which is
    // the whole reason the editor's own version stays out of this number: editor 0.1.0 to
    // 0.2.0 is an ordinary release, and to semver it would be a break.
    expect(nextVersion(1, "1.0.0")).toBe("1.1.0");
    expect(nextVersion(1, "1.9.0")).toBe("1.10.0");
    expect(nextVersion(1, "1.2.3")).toBe("1.3.0");
  });

  it("describes itself as the API version and nothing that moves on its own", () => {
    const pkg = JSON.parse(packageJson({ version: "1.4.0", apiVersion: 1 }));
    expect(pkg).toMatchObject({ name: PACKAGE_NAME, version: "1.4.0", types: "index.d.ts", scmjs: { pluginApiVersion: 1 } });
    // A date or an editor version here would publish an immutable npm version out of a
    // build that changed nothing.
    expect(JSON.stringify(pkg)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(pkg.scmjs.editorVersion).toBeUndefined();
    // Provenance attests to the repository that built the tarball, which is this one.
    expect(pkg.repository.url).toContain("scm-js/scm-js");
  });

  it("refuses a bundle that still imports anything", () => {
    expect(importsIn("export interface A { x: number }\n")).toEqual([]);
    expect(importsIn('import type { Atom } from "jotai";\nexport type B = Atom<number>;\n')).toEqual(["jotai"]);
    expect(importsIn('export type C = import("./view").EditorLayer;\n')).toEqual(["./view"]);
    expect(importsIn('export * from "react";\n')).toEqual(["react"]);
    // A string that merely reads like one is not an import.
    expect(importsIn('export declare const s = "from \\"x\\"";\n')).toEqual([]);
  });
});
