/**
 * `npm run build:desktop [-- <platform|arch|target|option>…]`: the steps a desktop build
 * is — the default plugins vendored into `plugins/`, the web bundle in desktop mode, the
 * main process bundled by `desktop/vite.config.ts`, and electron-builder over the two —
 * with the packaging step's platform, architecture and targets picked on the command line.
 *
 * The vendoring is what `npm run build` does in its `prebuild` hook too; it is repeated
 * here because this script runs tsc and vite directly rather than through that script.
 * It only fetches what is not already there at the pinned version, so after the first
 * run it is offline and instant; `--skip-plugins` leaves `plugins/` exactly as it is.
 *
 * With no arguments it is what it always was: this OS, the targets `electron-builder.yml`
 * lists for it, `--publish never`.
 *
 *   npm run build:desktop -- win                 # Windows, its two targets (nsis, zip)
 *   npm run build:desktop -- win nsis            # just the installer
 *   npm run build:desktop -- linux appimage x64 arm64
 *   npm run build:desktop -- mac dmg arm64
 *   npm run build:desktop -- --dir               # unpacked, no installer — the fast check
 *   npm run build:desktop -- win --skip-web      # repackage the dist/ already on disk
 *
 * Cross-building is electron-builder's business, not this script's: it warns about the
 * combinations that need tooling this machine may not have (a macOS target off a Mac, an
 * NSIS installer without wine) and runs them anyway.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const PLATFORMS = {
  win: "win", windows: "win", win32: "win",
  mac: "mac", macos: "mac", osx: "mac", darwin: "mac",
  linux: "linux",
};
const ARCHES = new Set(["x64", "ia32", "arm64", "armv7l", "universal"]);
// Canonical spelling per target, because electron-builder's names are case-sensitive.
const TARGETS = {};
for (const name of [
  "nsis", "nsis-web", "msi", "appx", "squirrel",
  "dmg", "pkg", "mas",
  "AppImage", "deb", "rpm", "snap", "pacman", "freebsd", "apk",
  "zip", "7z", "tar.gz", "tar.xz", "tar.bz2",
]) TARGETS[name.toLowerCase()] = name;

const HOST = PLATFORMS[process.platform] ?? process.platform;

const usage = `usage: npm run build:desktop -- [platform…] [arch…] [target…] [options]

  platforms  win | mac | linux                (default: this OS — ${HOST})
  arches     ${[...ARCHES].join(" | ")}
  targets    ${Object.values(TARGETS).join(" ")}
             (targets apply to every platform named; default: electron-builder.yml's)

  --dir              unpacked app only, no installer
  --skip-web         reuse the existing dist/ (skip tsc + vite)
  --skip-main        reuse the existing desktop/dist/
  --skip-plugins     leave plugins/ as it is (skip vendoring the defaults)
  --publish <mode>   electron-builder's --publish (default: never)
  --                 pass everything after it to electron-builder verbatim`;

const platforms = [];
const arches = [];
const targets = [];
const passthrough = [];
let dir = false;
let skipWeb = false;
let skipMain = false;
let skipPlugins = false;
let publish = "never";

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--") { passthrough.push(...argv.slice(i + 1)); break; }
  if (arg === "-h" || arg === "--help") { console.log(usage); process.exit(0); }
  else if (arg === "--dir" || arg === "-d") dir = true;
  else if (arg === "--skip-web") skipWeb = true;
  else if (arg === "--skip-main") skipMain = true;
  else if (arg === "--skip-plugins") skipPlugins = true;
  else if (arg === "--publish") publish = argv[++i] ?? "never";
  else if (arg.startsWith("--publish=")) publish = arg.slice("--publish=".length);
  else {
    // Platforms, arches and targets are accepted bare or with the leading dashes
    // electron-builder itself takes, in any order.
    const word = arg.replace(/^--?/, "").toLowerCase();
    if (word in PLATFORMS) push(platforms, PLATFORMS[word]);
    else if (ARCHES.has(word)) push(arches, word);
    else if (word in TARGETS) push(targets, TARGETS[word]);
    else {
      console.error(`build:desktop: don't know "${arg}"\n\n${usage}`);
      process.exit(2);
    }
  }
}
function push(list, value) { if (!list.includes(value)) list.push(value); }

if (platforms.length === 0) platforms.push(HOST);
if (!(HOST in PLATFORMS) && platforms.includes(HOST)) {
  console.error(`build:desktop: no default target for ${process.platform}; name a platform`);
  process.exit(2);
}

for (const platform of platforms) {
  if (platform === HOST) continue;
  if (platform === "mac") warn("macOS installers can only be built on macOS (dmg and pkg need Apple's tooling)");
  else if (platform === "win" && !dir) warn("Windows installers off a non-Windows host need wine on PATH; --dir and zip do not");
  else if (platform === "linux" && HOST === "win") warn("Linux targets off Windows want WSL or Docker");
}
function warn(text) { console.warn(`build:desktop: ${text}`); }

/** Run a JS entry point of an installed dependency under this same node. */
function run(label, entry, args) {
  console.log(`\n▸ ${label}`);
  const result = spawnSync(process.execPath, [resolve(root, entry), ...args], { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// Before the bundle: `builtin.ts` globs `plugins/` at build time, so this has to land
// first. It brings the directory to exactly the pinned defaults — fetching only what is
// missing, and dropping a copy that stopped being one — so no stale plugin rides along.
if (!skipPlugins && !skipWeb) run("default plugins", "scripts/vendor-plugins.mjs", []);

if (!skipWeb) {
  // What `npm run build` is, plus the asset check its prebuild hook runs.
  run("game data check", "scripts/extract-assets.mjs", ["--check", "--warn"]);
  run("type check", "node_modules/typescript/bin/tsc", ["-b"]);
  run("web bundle (desktop mode)", "node_modules/vite/bin/vite.js", ["build", "--mode", "desktop"]);
}
if (!skipMain) run("main process", "node_modules/vite/bin/vite.js", ["build", "-c", "desktop/vite.config.ts"]);

const builderArgs = [];
for (const platform of platforms) builderArgs.push(`--${platform}`, ...targets);
for (const arch of arches) builderArgs.push(`--${arch}`);
if (dir) builderArgs.push("--dir");
builderArgs.push("--publish", publish, ...passthrough);

run(`electron-builder ${builderArgs.join(" ")}`, "node_modules/electron-builder/cli.js", builderArgs);
