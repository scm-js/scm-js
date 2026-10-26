/**
 * The TrigScript guides' examples (`docs/trigscript.md`, `docs/trigscript-language.md`,
 * `docs/trigscript-library.md`) compile.
 *
 * They are the code a map maker copies, and nothing else runs them: the plugin's own
 * tests cover the language, the docs tests cover the prose, and an example that quietly
 * stopped compiling after a language change would only be found by the reader who
 * pasted it. So every fenced `ts` and `tsx` block in them is compiled here with the
 * plugin's real compiler, against a map that has the locations the guides say they
 * assume. An example that carries a `test()` has its tests run too, and they pass; a
 * `print(…)` with `// what it shows` beside it is simulated and shows that.
 *
 * A block of several files says so with a `// name.ts` line before each. A `tsx` block is
 * `main.tsx`. The library guide's last example imports `waves`, a library another
 * plugin would provide; a stand-in with the two functions it names takes its place.
 *
 * The compiler is the vendored default's (`plugins/trigscript/`, written by
 * `scripts/vendor-plugins.mjs` at the pinned version), so the examples are checked
 * against exactly the language the editor ships. A clone that has not vendored yet has no
 * compiler to check with and skips — as the real-map suites do — and the imports are
 * dynamic so the type-check does not need the directory either.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const root = join(import.meta.dirname, "..");
const plugin = join(root, "plugins", "trigscript");
const have = existsSync(join(plugin, "compiler", "compiler.ts")) && existsSync(join(plugin, "bundle", "lib.mjs"));

const GUIDES = ["docs/trigscript.md", "docs/trigscript-language.md", "docs/trigscript-library.md"];
const LOCATIONS = ["Beacon", "Spawn", "Base", "Hill", "Shop", "Pen", "Gate", "Exit", "Cursor"];

/** A guide's fenced `ts` and `tsx` blocks, each with the line it starts on. */
function examples(file: string): { line: number; code: string; tsx: boolean }[] {
  const lines = readFileSync(join(root, file), "utf8").split("\n");
  const out: { line: number; code: string; tsx: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const fence = lines[i].trim();
    if (fence !== "```ts" && fence !== "```tsx") continue;
    const from = i + 1;
    while (i < lines.length && lines[++i].trim() !== "```");
    out.push({ line: from + 1, code: lines.slice(from, i).join("\n"), tsx: fence === "```tsx" });
  }
  return out;
}

/** The script's files: `main.ts` (or `main.tsx`), or each file a `// name.ts` line starts. */
function files(code: string, tsx: boolean): Record<string, string> {
  if (!/^\/\/ [\w./-]+\.tsx?$/m.test(code)) return { [tsx ? "main.tsx" : "main.ts"]: code };
  const out: Record<string, string> = {};
  let file = "";
  for (const l of code.split("\n")) {
    const named = /^\/\/ ([\w./-]+\.tsx?)$/.exec(l);
    if (named) { file = named[1]; out[file] = ""; } else if (file) out[file] += `${l}\n`;
  }
  return out;
}

const WAVES = `
export const announce = game((text: string) => { print(text, { to: AllPlayers, position: "center" }); });
export const spawnWave = game((p: Player, unit: UnitType, n: number, at: Location) => { createUnit(p, unit, n, at); });
`;

describe.skipIf(!have)("the TrigScript guides' examples", () => {
  it("every fenced example compiles against the map the guides assume, and shows what it says", { timeout: 120_000 }, async () => {
    const { compileScript } = await import(join(plugin, "compiler", "compiler.ts"));
    const { scriptNames } = await import(join(plugin, "compiler", "names.ts"));
    const { simulatePrograms } = await import(join(plugin, "compiler", "simulateIr.ts"));
    const { defaultLib } = await import(join(plugin, "bundle", "lib.mjs"));
    const { writeVideo } = await import(join(plugin, "compiler", "media.ts"));
    const lib = defaultLib();
    // A video an example imports (the Showcase's) is the reader's own file: a stand-in of a
    // few frames at the guide's 128 × 96, a block of ink moving across, takes its place.
    const standIn = (): string => {
      const frames = [0, 1, 2].map((f) => Uint8Array.from({ length: 128 * 96 }, (_, i) => (Math.abs((i % 128) - 40 * f - 20) < 12 && ((i / 128) | 0) > 30 ? 1 : 0)));
      return writeVideo({ width: 128, height: 96, frameMs: 42, frames });
    };
    const names = scriptNames({ locations: LOCATIONS.map((name, index) => ({ index, name })) });
    const failures: string[] = [];
    for (const guide of GUIDES) {
      const blocks = examples(guide);
      expect(blocks.length, guide).toBeGreaterThan(8);
      for (const { line, code, tsx } of blocks) {
        const at = `${guide}:${line}`;
        // An example that carries a test() is also run: each location a box of its own, side by side.
        const tests = /\btest\(/.test(code) ? { world: { locations: Object.fromEntries(names.locations.entries.map((e: { value: number }) => [e.value, { left: e.value * 1000, top: 0, right: e.value * 1000 + 200, bottom: 200 }])) } } : undefined;
        const videos = Object.fromEntries([...code.matchAll(/from "\.\/([\w-]+\.video)"/g)].map((m) => [m[1], standIn()]));
        const libraries = /from "waves"/.test(code) ? { waves: { "index.ts": WAVES } } : undefined;
        const result = compileScript(ts, { ...files(code, tsx), ...videos }, names, { lib, ...(tests ? { tests } : {}), ...(libraries ? { libraries } : {}) });
        for (const d of result.diagnostics) failures.push(`${at} (${d.file}:${d.line}) ${d.message}`);
        if (tests && !result.tests?.results.length) failures.push(`${at}: the example's tests did not run`);
        for (const t of result.tests?.results ?? []) if (t.status === "failed") failures.push(`${at}: the test "${t.id}" fails: ${t.message}`);
        // A trigger() is a trigger of the map; a program() is IR, built into the saved file by TrigScript's own build.
        if (result.diagnostics.length === 0 && result.triggers.length === 0 && (result.ir?.length ?? 0) === 0) failures.push(`${at}: the example makes neither a trigger nor a program`);
        // A print whose comment says what it shows shows that, with nothing going wrong on the way.
        const wanted = [...code.matchAll(/\bprint\(.*\);\s*\/\/ (.+)$/gm)].map((m) => m[1].trim());
        if (wanted.length === 0 || result.diagnostics.length > 0) continue;
        const sim = simulatePrograms(result.ir, 30, { strings: result.strings });
        for (const f of sim.faults) failures.push(`${at}: Simulate: ${JSON.stringify(f)}`);
        const shown = sim.events.map((e: { text?: string }) => e.text);
        for (const text of wanted) if (!shown.includes(text)) failures.push(`${at}: prints ${JSON.stringify(shown)}, not "${text}"`);
      }
    }
    expect(failures).toEqual([]);
  });
});
