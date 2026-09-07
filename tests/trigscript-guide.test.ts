/**
 * The guide's TrigScript examples (`README.md` § TrigScript) compile.
 *
 * They are the code a map maker copies, and nothing else runs them: the plugin's own
 * tests cover the language, the docs tests cover the prose, and an example that quietly
 * stopped compiling after a language change would only be found by the reader who
 * pasted it. So every fenced `ts` block in the section is compiled here with the
 * plugin's real compiler, against a map that has the locations the section says it
 * assumes.
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

/** The section's fenced `ts` blocks, each with the line it starts on. */
function examples(): { line: number; code: string }[] {
  const text = readFileSync(join(root, "README.md"), "utf8");
  const start = text.indexOf("\n## TrigScript\n");
  const end = text.indexOf("\n## ", start + 1);
  expect(start).toBeGreaterThan(0);
  const section = text.slice(start, end);
  const before = text.slice(0, start).split("\n").length;
  const out: { line: number; code: string }[] = [];
  const lines = section.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "```ts") continue;
    const from = i + 1;
    while (i < lines.length && lines[++i].trim() !== "```");
    out.push({ line: before + from, code: lines.slice(from, i).join("\n") });
  }
  return out;
}

describe.skipIf(!have)("the guide's TrigScript examples", () => {
  it("every fenced example compiles against the map the section assumes", { timeout: 60_000 }, async () => {
    const { compileScript } = await import(join(plugin, "compiler", "compiler.ts"));
    const { scriptNames } = await import(join(plugin, "compiler", "names.ts"));
    const { defaultLib } = await import(join(plugin, "bundle", "lib.mjs"));
    const lib = defaultLib();
    const names = scriptNames({ locations: ["Beacon", "Spawn", "Base", "Hill", "Shop"].map((name, index) => ({ index, name })) });
    const blocks = examples();
    expect(blocks.length).toBeGreaterThan(8);
    const failures: string[] = [];
    for (const { line, code } of blocks) {
      const result = compileScript(ts, { "main.ts": code }, names, { lib });
      for (const d of result.diagnostics) failures.push(`README.md:${line} (${d.file}:${d.line}) ${d.message}`);
      if (result.diagnostics.length === 0 && result.triggers.length === 0) failures.push(`README.md:${line}: the example makes no triggers`);
    }
    expect(failures).toEqual([]);
  });
});
