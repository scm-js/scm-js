/**
 * `THIRD-PARTY-NOTICES.txt`, the license texts of everything compiled into the web bundle,
 * written into `dist/` by the build (`vite.config.ts`, the `scmjs-notices` plugin) so the
 * web zip, the installers and the container image all carry them. MIT and ISC require the
 * notice to travel with the code, and TypeScript (Apache-2.0) requires its license text
 * to; ATTRIBUTION.md names the projects and this file is the mechanical half.
 *
 * What goes in is not a list kept by hand: every runtime dependency in `package.json`
 * (the bundler pulls in nothing else), plus the default plugins vendored into `plugins/`,
 * each with its own LICENSE. A dependency with no license file fails the build rather
 * than being left out.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LICENSE_NAMES = ["LICENSE", "LICENSE.txt", "LICENSE.md", "LICENCE", "LICENCE.txt", "license", "license.txt", "license.md"];

function licenseFileIn(dir) {
  for (const name of LICENSE_NAMES) {
    const file = join(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

const rule = (title) => `${"=".repeat(78)}\n${title}\n${"=".repeat(78)}\n`;

/** The dependencies the bundle is built from: `package.json`'s runtime `dependencies`, sorted. */
export function bundledDependencies(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  return Object.keys(pkg.dependencies ?? {}).sort();
}

/** The vendored default plugins, `plugins/<dir>/` with a `vendored.json` naming the spec. */
export function vendoredPlugins(root) {
  const dir = join(root, "plugins");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "vendored.json")))
    .map((d) => {
      const spec = JSON.parse(readFileSync(join(dir, d.name, "vendored.json"), "utf8")).spec;
      return { name: d.name, spec, dir: join(dir, d.name) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The whole notices file as text. Throws when a dependency ships no license file. */
export function buildNotices(root) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const parts = [
    `Third-party notices for scmJS ${pkg.version}\n`,
    "scmJS itself is MIT-licensed (LICENSE in the repository). This file carries the license",
    "texts of the third-party code compiled into the application bundle. Who wrote what,",
    "and where the adapted algorithms and reference tables come from, is in ATTRIBUTION.md:",
    "https://github.com/scm-js/scm-js/blob/main/ATTRIBUTION.md",
    "",
    "No StarCraft game data is included. The editor reads Blizzard's files from the user's",
    "own installation or from Blizzard's own download, on the user's machine.",
    "",
  ];

  for (const name of bundledDependencies(root)) {
    const dir = join(root, "node_modules", name);
    const file = licenseFileIn(dir);
    if (!file) throw new Error(`notices: ${name} has no license file in node_modules/${name}`);
    const version = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version;
    const note = name === "electron-updater" ? " (desktop app only)" : "";
    parts.push(rule(`${name} ${version}${note}`), readFileSync(file, "utf8").trim(), "");
  }

  for (const plugin of vendoredPlugins(root)) {
    const file = licenseFileIn(plugin.dir);
    if (!file) throw new Error(`notices: the vendored plugin ${plugin.name} has no LICENSE`);
    parts.push(rule(`plugin ${plugin.name} (${plugin.spec}, compiled in)`), readFileSync(file, "utf8").trim(), "");
  }

  return parts.join("\n");
}

/** The line that starts the runtimes' part of the file, so a second run replaces it. */
export const RUNTIMES_HEADING = "Plugin runtimes (desktop app and container image only)";

/**
 * The notices of the plugin runtimes a desktop or container build carries: each runtime's
 * `licenses/` files as the plugin ships them (eudplib's are its own licence, euddraft's,
 * Pyodide's and an ATTRIBUTION.md). The web build cannot write these — the runtimes are
 * copied into `dist/` after it, by `scripts/bundle-plugin-runtimes.mjs` — so that script
 * adds this to the file the build wrote, through `withRuntimeNotices`. `runtimes` is
 * `{ plugin, version, dir }` with `dir` the runtime as copied. Throws on a runtime with no
 * licence files: redistributing one without its notices is what this exists to prevent.
 */
export function runtimeNotices(runtimes) {
  if (runtimes.length === 0) return "";
  const parts = [rule(RUNTIMES_HEADING)];
  for (const { plugin, version, dir } of runtimes) {
    const licenses = join(dir, "licenses");
    const files = existsSync(licenses) ? readdirSync(licenses).filter((f) => !f.startsWith(".")).sort() : [];
    if (files.length === 0) throw new Error(`notices: the ${plugin} ${version} runtime carries no licenses/ files`);
    for (const f of files) parts.push(rule(`runtime ${plugin} ${version}: ${f}`), readFileSync(join(licenses, f), "utf8").trim(), "");
  }
  return parts.join("\n");
}

/** `text` (the build's notices) with the runtimes' part replaced by `runtimeNotices(runtimes)`. */
export function withRuntimeNotices(text, runtimes) {
  const at = text.indexOf(rule(RUNTIMES_HEADING));
  const base = (at < 0 ? text : text.slice(0, at)).replace(/\n*$/, "\n");
  const extra = runtimeNotices(runtimes);
  return extra ? `${base}\n${extra}` : base;
}
