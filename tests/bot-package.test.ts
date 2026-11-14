/**
 * `@scm-js/bot`, the types a JavaScript bot author installs (`bot/`, `scripts/build-bot-types.mjs`),
 * and the bots in `docs/bots.md`, which must keep compiling against them.
 *
 * The two files in `bot/src/` are copies of the play page engine's, which is a private
 * repository: what is pinned here is that the copies stay portable (they import only each
 * other), that the package's major is `BOT_API`, that the bundle builds as one file with
 * no imports, and that every bot the guide shows type-checks against that file the way a
 * reader's editor would check it. Whether the copies match the engine's is
 * `node scripts/build-bot-types.mjs --check <scm-sim>`, run where a checkout is; with
 * `SCM_SIM_DIR` set, the last test runs it too.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
// @ts-expect-error - a plain .mjs script, imported for its parts.
import { ALLOWED_IMPORTS, BOT_DIR, botApiVersionOf, buildBundle, COPIED, differences, sourceImports } from "../scripts/build-bot-types.mjs";

const root = join(import.meta.dirname, "..");
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("the @scm-js/bot package", () => {
  it("keeps the two copied files importing only each other", () => {
    for (const { to } of COPIED as { to: string }[]) {
      expect(sourceImports(read(`bot/${to}`)), to).toEqual(ALLOWED_IMPORTS[to]);
    }
    expect(sourceImports('import type { A } from "./api.ts";\nexport * from "x";\nconst y = import("z");')).toEqual(["./api.ts", "x", "z"]);
    // A comment that shows an import is not one.
    expect(sourceImports(' * used on its own (`import type { BotModule } from "./api.ts"`).')).toEqual([]);
  });

  it("is versioned by BOT_API, and publishes the declarations and the README only", () => {
    const pkg = JSON.parse(read("bot/package.json"));
    const apiVersion = botApiVersionOf(read("bot/src/api.ts"));
    expect(pkg.name).toBe("@scm-js/bot");
    expect(Number(pkg.version.split(".")[0])).toBe(apiVersion);
    expect(pkg.files).toEqual(["dist/index.d.ts", "README.md"]);
    expect(pkg.types).toBe("./dist/index.d.ts");
    expect(pkg.exports["."]).toEqual({ types: "./dist/index.d.ts" });
    expect(pkg.dependencies ?? {}).toEqual({});
  });

  const bundle: string = buildBundle().text;

  it("builds one declaration file with no imports and no internals", () => {
    expect(bundle).toMatch(/export declare const BOT_API = 1;/);
    for (const name of ["EasyBot", "Game", "Unit", "Units", "BotModule", "BotView", "BotApi"]) expect(bundle).toMatch(new RegExp(`\\b${name}\\b`));
    // `@internal` members of the layer (its bookkeeping) are left out of an author's completion.
    expect(bundle).not.toMatch(/\bupdate\(view: BotView/);
    expect(bundle).not.toMatch(/\bsendToMine\(/);
  });

  it("type-checks the bots of the guide and the README against the bundle, as a reader's editor would", () => {
    const blocks = ["docs/bots.md", "bot/README.md"].flatMap((file) => [...read(file).matchAll(/```(js|ts)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], code: m[2] })));
    const files: Record<string, string> = {};
    let n = 0;
    for (const { lang, code } of blocks) {
      n += 1;
      if (/export default/.test(code)) {
        // A whole bot. One without its own annotation gets the one the guide recommends.
        const type = /\bcreate\s*\(/.test(code) ? "BotModule" : "EasyBot";
        const typed = /@type \{import\("@scm-js\/bot"\)|from "@scm-js\/bot"/.test(code) ? code : code.replace(/export default \{/, `/** @type {import("@scm-js/bot").${type}} */\nexport default {`);
        files[`block${n}.${lang === "ts" ? "ts" : "mjs"}`] = typed;
      } else if (/\bgame\./.test(code)) {
        // A few lines meant for the inside of `onFrame(game)`.
        files[`block${n}.mjs`] = `/** @type {import("@scm-js/bot").EasyBot} */\nexport default {\n  name: "fragment",\n  onFrame(game) {\n${code}\n  },\n};\n`;
      }
    }
    // Starter, the fragment, Miner twice, the Cosmonarchy example, the module underneath, the README's Miner.
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(7);

    const dir = mkdtempSync(join(tmpdir(), "scmjs-bot-types-"));
    try {
      const pkgDir = join(dir, "node_modules/@scm-js/bot");
      mkdirSync(join(pkgDir, "dist"), { recursive: true });
      writeFileSync(join(pkgDir, "dist/index.d.ts"), bundle);
      writeFileSync(join(pkgDir, "package.json"), read("bot/package.json"));
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
      const program = ts.createProgram(Object.keys(files).map((f) => join(dir, f)), {
        allowJs: true, checkJs: true, strict: true,
        // The guide's JavaScript indexes plain objects by a race's name; an editor's check of
        // a plain .mjs file does not complain about that, and neither does this.
        noImplicitAny: false,
        noEmit: true, target: ts.ScriptTarget.ES2023, lib: ["lib.es2023.d.ts"], types: [],
        module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler,
        allowImportingTsExtensions: true,
      });
      const problems = ts.getPreEmitDiagnostics(program).map((d) => {
        const where = d.file ? `${d.file.fileName.slice(dir.length + 1)}:${d.file.getLineAndCharacterOfPosition(d.start ?? 0).line + 1}` : "";
        return `${where} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`;
      });
      expect(problems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!process.env.SCM_SIM_DIR)("matches the engine's own files (SCM_SIM_DIR)", () => {
    expect(differences(process.env.SCM_SIM_DIR)).toEqual([]);
    expect(BOT_DIR).toBe(join(root, "bot"));
  });
});
