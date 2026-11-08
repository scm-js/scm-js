// The `scmjs` bundle, for both of its shapes: the npm package (scripts/build-cli.mjs: ESM with a shebang, the
// weigher beside it) and the single executable (scripts/build-cli-binary.mjs: CommonJS, as Node's single executable
// applications need, the weigher carried inside). One Vite SSR build each, the same plugins and defines, so the two
// differ only in `__SCMJS_INSTALL__` (cli/src/runtime.ts) and the entry.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "vite";
import { cliNotices } from "./notices.mjs";

/** The editor's version (package.json) and the clone's short commit, if it is one. */
export function cliVersion() {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  let commit = "";
  try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { /* not a clone */ }
  return { version, commit };
}

const plugins = (version) => [{
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
}];

/**
 * The command's bundle into `outDir`: `install` "npm" (ESM, `scmjs.mjs`, shebang, cli/src/main.ts) or "binary"
 * (CommonJS, `scmjs.cjs`, cli/src/sea.ts — the entry that can also run a runner as Node would). The folder is emptied.
 */
export async function bundleCli({ outDir, install = "npm", version, commit = "" }) {
  const binary = install === "binary";
  await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    define: {
      __SCMJS_VERSION__: JSON.stringify(version),
      __SCMJS_COMMIT__: JSON.stringify(commit),
      __SCMJS_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
      __SCMJS_INSTALL__: JSON.stringify(install),
    },
    plugins: plugins(version),
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: binary ? "cli/src/sea.ts" : "cli/src/main.ts",
      outDir,
      emptyOutDir: true,
      target: "node22",
      minify: false,
      reportCompressedSize: false,
      rollupOptions: {
        output: binary
          ? { entryFileNames: "scmjs.cjs", format: "cjs", codeSplitting: false }
          : { entryFileNames: "scmjs.mjs", format: "es", banner: "#!/usr/bin/env node", codeSplitting: false },
      },
    },
  });
}

/**
 * The weigher `scmjs map cost` hands the game's map runner (cli/src/weigh.ts): TrigScript's `RemasteredWeigh` and its
 * limits, built on its own as `weigh.mjs` into `outDir` (kept as it is), since the runner is another process that
 * imports it by path.
 */
export async function bundleWeigh({ outDir }) {
  await build({
    configFile: false,
    logLevel: "warn",
    publicDir: false,
    ssr: { noExternal: true, target: "node" },
    build: {
      ssr: "cli/src/weigh.ts",
      outDir,
      emptyOutDir: false,
      target: "node22",
      minify: false,
      reportCompressedSize: false,
      rollupOptions: { output: { entryFileNames: "weigh.mjs", format: "es", codeSplitting: false } },
    },
  });
}
