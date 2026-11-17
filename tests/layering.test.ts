import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `src/` is layered: a folder imports from its own tier and the ones below, never upward.
 * Types are exempt (they are erased, and a few shapes are named where they are shown).
 * The tiers, lowest first; a file directly under `src/` that is not listed is the app's root.
 */
const TIERS: readonly (readonly string[])[] = [
  ["i18n", "lib", "site.ts", "version.ts"],
  ["data", "formats"],
  ["editor"],
  ["gamedata"],
  ["atoms", "services", "plugins"],
  ["hooks"],
  ["components", "pages"],
];

/**
 * The imports that still point upward. Each is a move waiting to be made; the list may only
 * shrink — an entry that no longer exists fails the test, so it is taken out when it is fixed.
 */
const KNOWN = [
  "data/releaseNotes.ts -> editor/releaseNotes.ts",
  "editor/log.ts -> services/usage.ts",
  "editor/platform.ts -> gamedata/desktop.ts",
  "formats/tileset/load.ts -> gamedata/source.ts",
  "formats/units/load.ts -> editor/stockSounds.ts",
  "formats/units/load.ts -> gamedata/source.ts",
  "gamedata/profiles.ts -> atoms/storage.ts",
  "hooks/useDevDeepLinks.ts -> components/chrome/MenuBar.tsx",
  "hooks/useDevDeepLinks.ts -> components/dialogs/DialogHost.tsx",
  "plugins/host/mapView.ts -> components/viewport/paint/overView.ts",
  "services/mapImage.ts -> components/viewport/fog.ts",
  "services/mapImage.ts -> components/viewport/missingTile.ts",
];

const src = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.(test|d)\.ts$/.test(name) ? [path] : [];
  });
}

const rel = (file: string) => relative(src, file).split("\\").join("/");

function tierOf(file: string): number {
  const top = rel(file).split("/")[0];
  const at = TIERS.findIndex((names) => names.includes(top));
  return at < 0 ? TIERS.length : at;
}

function resolveModule(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (/\.tsx?$/.test(candidate) && existsSync(candidate)) return candidate;
  }
  return null;
}

/** The relative modules a file imports by value, `import()` included. */
function valueImports(file: string): string[] {
  const out: string[] = [];
  const pattern = /(?:import|export)\s+(type\s+)?([^"';]*?)from\s+["'](\.[^"']*)["']|import\(\s*["'](\.[^"']*)["']\s*\)/g;
  for (const m of readFileSync(file, "utf8").matchAll(pattern)) {
    if (m[1]) continue;
    const names = (m[2] ?? "").trim();
    const allTypes = names.startsWith("{") && names.replace(/[{}]/g, "").split(",").map((s) => s.trim()).filter(Boolean).every((s) => s.startsWith("type "));
    if (allTypes) continue;
    const target = resolveModule(file, m[3] ?? m[4]);
    if (target) out.push(target);
  }
  return out;
}

describe("src/ layering", () => {
  const upward = sources(src)
    .flatMap((file) => valueImports(file).filter((target) => tierOf(target) > tierOf(file)).map((target) => `${rel(file)} -> ${rel(target)}`))
    .sort();

  it("imports nothing from a higher tier, the known exceptions aside", () => {
    expect(upward.filter((line) => !KNOWN.includes(line))).toEqual([]);
  });

  it("lists no exception that has since been fixed", () => {
    expect(KNOWN.filter((line) => !upward.includes(line))).toEqual([]);
  });
});
