/**
 * `THIRD-PARTY-NOTICES.txt` (scripts/lib/notices.mjs), written into `dist/` by the build.
 * The list is not kept by hand — it is package.json's runtime dependencies plus the
 * vendored default plugins — so what is pinned here is that nothing is dropped: every
 * runtime dependency is in the file with its license text, and the one Apache-licensed
 * component (TypeScript, the plugin transpiler) carries the text that license requires.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
// @ts-expect-error - plain .mjs build script, imported for its pure parts.
import { buildNotices, bundledDependencies, vendoredPlugins } from "../scripts/lib/notices.mjs";

const root = join(import.meta.dirname, "..");

describe("third-party notices", () => {
  const text: string = buildNotices(root);

  it("names every runtime dependency with its license text", () => {
    const deps: string[] = bundledDependencies(root);
    expect(deps).toContain("typescript");
    expect(deps).toContain("react");
    for (const name of deps) expect(text, name).toMatch(new RegExp(`^${name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")} \\d`, "m"));
    expect(text).toContain("Apache License");
    expect(text).toContain("Permission is hereby granted, free of charge");
  });

  it("includes each vendored default plugin", () => {
    const plugins: { name: string; spec: string }[] = vendoredPlugins(root);
    for (const p of plugins) expect(text).toContain(`plugin ${p.name} (${p.spec}, compiled in)`);
    if (existsSync(join(root, "plugins"))) expect(plugins.length).toBeGreaterThan(0);
  });

  it("points at ATTRIBUTION.md and says no game data is inside", () => {
    expect(text).toContain("ATTRIBUTION.md");
    expect(text).toContain("No StarCraft game data is included");
  });
});
