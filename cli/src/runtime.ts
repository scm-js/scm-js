/**
 * How this copy of `scmjs` runs: the npm package on the user's own Node (`cli/dist/scmjs.mjs`), or a single
 * executable with Node inside it (scripts/build-cli-binary.mjs, attached to each GitHub release and installed by
 * Scoop, winget or Homebrew from there). The two differ in three places only, all here: how to update, how a command
 * starts the game engine's runners (Node scripts) when there is no `node` to start them with, and where the weigher
 * `map cost` hands the game lives (beside the bundle, or inside the executable).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { t } from "./i18n";

declare const __SCMJS_INSTALL__: string;

export type InstallKind = "npm" | "binary";
/** Set by the build: "binary" for the single executable, "npm" for the package (and a clone's `npm run cli`). */
export const INSTALL: InstallKind = typeof __SCMJS_INSTALL__ === "string" && __SCMJS_INSTALL__ === "binary" ? "binary" : "npm";

export type Manager = "scoop" | "winget" | "homebrew";
export interface Install {
  kind: InstallKind;
  /** The package manager a single executable was installed with, read off where it is; null for a download. */
  manager: Manager | null;
  /** The executable (binary) or the bundle Node runs (npm). */
  path: string;
}

/** Where the releases are; a downloaded executable is updated from here. */
export const RELEASES_URL = "https://github.com/scm-js/scm-js/releases/latest";

/** The package manager that put the executable at `path`, by the folders each installs into. */
export function managerOf(path: string): Manager | null {
  const p = path.replace(/\\/g, "/").toLowerCase();
  if (p.includes("/scoop/apps/") || p.includes("/scoop/shims/")) return "scoop";
  if (p.includes("/microsoft/winget/")) return "winget";
  if (p.includes("/cellar/") || p.includes("/homebrew/") || p.includes("/linuxbrew/")) return "homebrew";
  return null;
}

export function installInfo(kind = INSTALL, path = kind === "binary" ? process.execPath : process.argv[1] ?? ""): Install {
  return { kind, manager: kind === "binary" ? managerOf(path) : null, path };
}

/** The line that updates this install: npm's, the package manager's, or the release page for a download. */
export function updateCommand(install: Install, pkg = "@scm-js/cli"): string {
  if (install.kind === "npm") return `npm install -g ${pkg}@latest`;
  if (install.manager === "scoop") return "scoop update scmjs";
  if (install.manager === "winget") return "winget upgrade scm-js.scmjs";
  if (install.manager === "homebrew") return "brew upgrade scmjs";
  return t("download it again from {url}", { url: RELEASES_URL });
}

/** How the install is named in `about` and `doctor`. */
export function installLabel(install: Install): string {
  if (install.kind === "npm") return t("npm package");
  return install.manager === "scoop" ? t("single executable, from Scoop") : install.manager === "winget" ? t("single executable, from winget")
    : install.manager === "homebrew" ? t("single executable, from Homebrew") : t("single executable");
}

/**
 * The environment a command gives a runner started with `process.execPath`: in the single executable that path is
 * scmjs itself, and `SCMJS_RUN_AS_NODE=1` makes it run the script as Node would (`runAsNode`), the way
 * `ELECTRON_RUN_AS_NODE` does for Electron. A runner started with another Node (`--node`) is left alone.
 */
export function runnerEnv(node: string, env: NodeJS.ProcessEnv = process.env, kind = INSTALL): NodeJS.ProcessEnv | undefined {
  return kind === "binary" && node === process.execPath ? { ...env, SCMJS_RUN_AS_NODE: "1" } : undefined;
}

/**
 * The argv Node would give a script, from the single executable's: Node's own executable is `argv[0]` and repeated
 * as `argv[1]` there, so `[exe, exe, script, …args]` becomes `[exe, /abs/script, …args]` — a runner checks
 * `import.meta.url` against `argv[1]` to know it is the main module.
 */
export function scriptArgv(argv: string[], cwd = process.cwd()): string[] | null {
  const [exe, , script, ...rest] = argv;
  return script ? [exe, resolve(cwd, script), ...rest] : null;
}

/** The single executable as Node: imports the script `argv` names, with `process.argv` as Node would have it. */
export function runAsNode(): void {
  const argv = scriptArgv(process.argv);
  if (!argv) { process.stderr.write("SCMJS_RUN_AS_NODE is set, and no script was named.\n"); process.exitCode = 2; return; }
  process.argv = argv;
  import(/* @vite-ignore */ pathToFileURL(argv[1]).href).catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}

/**
 * A file the single executable carries (a SEA asset) written out once to `dir` and its path returned, for a process
 * that needs it on disk (the game's map runner imports the weigher by path). Null outside the executable.
 */
export function assetFile(name: string, dir: string, version: string): string | null {
  if (INSTALL !== "binary") return null;
  const sea = process.getBuiltinModule?.("node:sea") as { isSea(): boolean; getAsset(key: string, encoding: string): string } | undefined;
  if (!sea?.isSea()) return null;
  const text = sea.getAsset(name, "utf8");
  const file = join(dir, `${version}-${name}`);
  try { if (readFileSync(file, "utf8") === text) return file; } catch { /* not written yet */ }
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, text);
  renameSync(part, file);
  return file;
}
