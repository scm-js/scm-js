/**
 * `scmjs doctor`: what this computer has of what the commands need beyond Node — TypeScript for `map build` and a
 * `.ts` plugin, Docker for `bot new|build`, a copy of StarCraft and the fetched engine for `bot run`, the desktop app
 * for `map open` — and the command for each thing missing. Nothing is changed. Everything here is optional (`info`
 * and `check` need none of it), so the exit code is 0 unless Node itself is too old.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { newestVersion, olderThan, PACKAGE, VERSION } from "./about";
import { dockerVersion } from "./bot";
import { cacheRoot, findGameCopy } from "./botrun";
import { findTypeScript } from "./build";
import { findDesktopApp } from "./open";
import { CliError, mark, pc, visible } from "./ui";

/** The Node this package's `engines` asks for (cli/package.json). */
export const NODE_MIN = "22.12.0";

export type CheckState = "ok" | "warn" | "bad";
export interface Check { what: string; state: CheckState; detail: string; fix?: string; note?: string }

/** Is Node older than `engines` says. */
export function nodeCheck(version = process.version): Check {
  const v = version.replace(/^v/, "");
  return olderThan(v, NODE_MIN)
    ? { what: "Node", state: "bad", detail: `${version}, needs ${NODE_MIN} or newer`, fix: "Install the current LTS from https://nodejs.org (or nvm install 22)" }
    : { what: "Node", state: "ok", detail: `${version}${pc.dim(` · ${process.platform} ${process.arch}`)}`};
}

export function typescriptCheck(cwd = process.cwd()): Check {
  const path = findTypeScript(cwd);
  if (!path) return { what: "TypeScript", state: "warn", detail: "not found", fix: "npm install typescript   (in the map's project, or npm install -g typescript)", note: "scmjs map build and a .ts plugin under scmjs map run compile with it." };
  // `path` is typescript/lib/typescript.js; the package.json two folders up says the version.
  let version = "";
  for (let dir = dirname(path); dir !== dirname(dir); dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name?: string; version?: string };
      if (pkg.name === "typescript") { version = pkg.version ?? ""; break; }
    } catch { /* not this folder */ }
  }
  return { what: "TypeScript", state: "ok", detail: `${version || "found"}${pc.dim(` · ${path}`)}` };
}

export function dockerCheck(): Check {
  const running = dockerVersion();
  if (running) return { what: "Docker", state: "ok", detail: running };
  const installed = spawnSync("docker", ["--version"], { stdio: "ignore" }).status === 0;
  return installed
    ? { what: "Docker", state: "warn", detail: "installed, not running", fix: "Start Docker (Docker Desktop on Windows and macOS)", note: "scmjs bot new|init|build run the bot toolchain in it." }
    : { what: "Docker", state: "warn", detail: "not found", fix: "https://docs.docker.com/get-docker/", note: "scmjs bot new|init|build run the bot toolchain in it." };
}

export function starcraftCheck(): Check {
  try {
    const { folder, kind } = findGameCopy(undefined);
    return { what: "StarCraft", state: "ok", detail: `${kind === "remastered" ? "Remastered" : "1.16.1"}${pc.dim(` · ${folder}`)}` };
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    return { what: "StarCraft", state: "warn", detail: "not found", fix: "scmjs bot run … --starcraft <folder>   (or SCMJS_STARCRAFT=<folder>)", note: "scmjs bot run and replay watch play with your own installation's files." };
  }
}

export function engineCheck(cache = cacheRoot()): Check {
  const dir = join(cache, "engine");
  const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
  const builds = existsSync(dir) ? readdirSync(dir).filter((d) => isDir(join(dir, d)) && readdirSync(join(dir, d)).length > 0) : [];
  return builds.length
    ? { what: "Game engine", state: "ok", detail: `${builds.length === 1 ? "fetched" : `${builds.length} builds fetched`}${pc.dim(` · ${dir}`)}` }
    : { what: "Game engine", state: "ok", detail: pc.dim("not fetched yet"), note: "The first scmjs bot run or replay watch fetches it from the play page (about 25 MB) into " + dir };
}

export function desktopAppCheck(): Check {
  const app = findDesktopApp();
  return app
    ? { what: "Desktop app", state: "ok", detail: app }
    : { what: "Desktop app", state: "ok", detail: pc.dim("not installed"), note: "scmjs map open and replay open use the editor in your browser instead; the app is at https://scmjs.dev/editor/#download" };
}

export async function versionCheck(): Promise<Check> {
  const latest = await newestVersion();
  if (latest === null) return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(" · could not ask npm for a newer one")}` };
  if (olderThan(VERSION, latest)) return { what: "scmjs", state: "warn", detail: `${VERSION}, ${latest} is on npm`, fix: `npm install -g ${PACKAGE}@latest` };
  return { what: "scmjs", state: "ok", detail: `${VERSION}${pc.dim(latest === VERSION ? " · the newest" : ` · ${latest} on npm`)}` };
}

export async function doctorReport(): Promise<{ checks: Check[]; blocked: boolean }> {
  const checks = [nodeCheck(), await versionCheck(), typescriptCheck(), dockerCheck(), starcraftCheck(), engineCheck(), desktopAppCheck()];
  return { checks, blocked: checks.some((c) => c.state === "bad") };
}

/** What the report says, in JSON: the same checks without colour. */
export function doctorJson(r: { checks: Check[]; blocked: boolean }) {
  return { blocked: r.blocked, checks: r.checks.map((c) => ({ ...c, detail: visible(c.detail) })) };
}

export function printDoctor(r: { checks: Check[]; blocked: boolean }): string[] {
  const lines = [`${pc.bold(pc.cyan("scmjs"))} ${pc.bold("doctor")}  ${pc.dim("what this computer has of what the commands need")}`, ""];
  for (const c of r.checks) {
    const m = c.state === "ok" ? mark.ok : c.state === "warn" ? mark.warn : mark.error;
    lines.push(`${m} ${pc.bold(c.what.padEnd(12))} ${c.detail}`);
    if (c.note) lines.push(pc.dim(`    ${c.note}`));
    if (c.fix) lines.push(`    ${c.fix}`);
  }
  lines.push("", r.blocked ? `${mark.error} Something blocks scmjs itself` : `${mark.ok} scmjs info, check, dump, diff and the rest need nothing more${r.checks.some((c) => c.state === "warn") ? pc.dim("; the rest is for the commands named") : ""}`);
  return lines;
}
