// Builds the `scmjs` command (cli/, docs/cli.md) into one file, cli/dist/scmjs.mjs: its code, the editor's code it
// reads maps and replays with, its two libraries and the TrigScript compiler (`plugins/trigscript`, vendored at the
// editor's pin), so `npx @scm-js/cli` downloads nothing more — TypeScript apart, which `map build` finds installed; and
// beside it cli/dist/weigh.mjs, the weigher `map cost` hands the game (cli/src/weigh.ts). Its version is the
// editor's (package.json), written into cli/package.json too. Beside it, THIRD-PARTY-NOTICES.txt carries the license
// of every package compiled in (scripts/lib/notices.mjs). The Vite builds are scripts/lib/cli-bundle.mjs, shared with
// the single executable (scripts/build-cli-binary.mjs).
//   npm run build:cli                   then: node cli/dist/scmjs.mjs --help
//   npm run cli -- map info a.scx       built and run in one step (--quiet: no line about the build)
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { bundleCli, bundleWeigh, cliVersion } from "./lib/cli-bundle.mjs";

const { version, commit } = cliVersion();

// `map build` bundles the TrigScript compiler from the vendored plugin source (`plugins/`, fetched by
// scripts/vendor-plugins.mjs and not in the repository): fetch it when it is not here yet, as `prebuild` would.
if (!existsSync("plugins/trigscript/vendored.json")) execFileSync("node", ["scripts/vendor-plugins.mjs"], { stdio: "inherit" });

const cliPackage = JSON.parse(readFileSync("cli/package.json", "utf8"));
if (cliPackage.version !== version) {
  cliPackage.version = version;
  writeFileSync("cli/package.json", JSON.stringify(cliPackage, null, 2) + "\n");
}

await bundleCli({ outDir: "cli/dist", install: "npm", version, commit });
chmodSync("cli/dist/scmjs.mjs", 0o755);
await bundleWeigh({ outDir: "cli/dist" });
if (!process.argv.includes("--quiet")) console.log(`cli/dist/scmjs.mjs: scmjs ${version}${commit ? ` (${commit})` : ""}`);
