// Builds the `scmjs` command (cli/, docs/cli.md) into one file, cli/dist/scmjs.mjs: its code, the editor's code it
// reads maps and replays with, its two libraries and the TrigScript compiler (`plugins/trigscript`, vendored at the
// editor's pin), so `npx @scm-js/cli` downloads nothing more — TypeScript apart, which `map build` finds installed. Its version is the
// editor's (package.json), written into cli/package.json too. Beside it, THIRD-PARTY-NOTICES.txt carries the license
// of every package compiled in (scripts/lib/notices.mjs).
//   npm run build:cli                   then: node cli/dist/scmjs.mjs --help
//   npm run cli -- map info a.scx       built and run in one step (--quiet: no line about the build)
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";
import { cliNotices } from "./lib/notices.mjs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
let commit = "";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a clone */ }

// `map build` bundles the TrigScript compiler from the vendored plugin source (`plugins/`, fetched by
// scripts/vendor-plugins.mjs and not in the repository): fetch it when it is not here yet, as `prebuild` would.
if (!existsSync("plugins/trigscript/vendored.json")) execFileSync("node", ["scripts/vendor-plugins.mjs"], { stdio: "inherit" });

const cliPackage = JSON.parse(readFileSync("cli/package.json", "utf8"));
if (cliPackage.version !== version) {
  cliPackage.version = version;
  writeFileSync("cli/package.json", JSON.stringify(cliPackage, null, 2) + "\n");
}

await build({
  configFile: false,
  logLevel: "warn",
  publicDir: false,
  define: {
    __SCMJS_VERSION__: JSON.stringify(version),
    __SCMJS_COMMIT__: JSON.stringify(commit),
    __SCMJS_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [{
    // Two modules of the editor's the command has no use for, replaced by empty ones. The Korean catalogue
    // (`src/i18n/ko.json`, 200 KB): the command prints English. The built-in plugins (`src/plugins/builtin.ts`): its
    // `import.meta.glob` of every vendored plugin's entry would be inlined whole into this one file by `map run`'s
    // host — TrigScript's workspace, Aftermath, React among them, 3 MB — and the command never loads a built-in.
    name: "scmjs-cli-leave-out",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!importer) return null;
      if (!source.endsWith("ko.json") && !/\/builtin(?:\.ts)?$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      if (resolve(resolved.id) === resolve("src/i18n/ko.json")) return "\0scmjs-cli-empty-catalogue";
      if (resolve(resolved.id) === resolve("src/plugins/builtin.ts")) return "\0scmjs-cli-no-builtins";
      return null;
    },
    load(id) {
      if (id === "\0scmjs-cli-empty-catalogue") return "export default {};";
      if (id === "\0scmjs-cli-no-builtins") return "export const BUILTIN_PLUGINS = {}; export const BUILTIN_REPLACES = {};";
      return null;
    },
  }, {
    // The packages the bundle holds, from its modules' paths: node_modules/<name> or node_modules/@scope/<name>.
    name: "scmjs-cli-notices",
    generateBundle(_, bundle) {
      const names = new Set();
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const id of chunk.moduleIds) {
          const m = /node_modules\/((?:@[^/]+\/)?[^/]+)\/(?!.*node_modules\/)/.exec(id.replace(/\\/g, "/"));
          if (m) names.add(m[1]);
        }
      }
      this.emitFile({ type: "asset", fileName: "THIRD-PARTY-NOTICES.txt", source: cliNotices(".", [...names].sort(), version) });
    },
  }],
  ssr: { noExternal: true, target: "node" },
  build: {
    ssr: "cli/src/main.ts",
    outDir: "cli/dist",
    emptyOutDir: true,
    target: "node22",
    minify: false,
    reportCompressedSize: false,
    rollupOptions: { output: { entryFileNames: "scmjs.mjs", format: "es", banner: "#!/usr/bin/env node", codeSplitting: false } },
  },
});
chmodSync("cli/dist/scmjs.mjs", 0o755);
if (!process.argv.includes("--quiet")) console.log(`cli/dist/scmjs.mjs: scmjs ${version}${commit ? ` (${commit})` : ""}`);
