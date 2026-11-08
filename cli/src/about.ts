/**
 * `scmjs about`: this build and whether npm has a newer one (the single executable is released with the same version),
 * how it was installed and so how to update it, who made it, the machine it runs on, the desktop app and Docker, and
 * where everything is.
 */
import { PLUGIN_API_VERSION } from "../../src/plugins/api";
import { BOT_GUIDE, dockerVersion } from "./bot";
import { findDesktopApp, EDITOR_URL } from "./open";
import { installInfo, installLabel, updateCommand, type Install } from "./runtime";
import { dot, pc, rows } from "./ui";

declare const __SCMJS_VERSION__: string, __SCMJS_COMMIT__: string, __SCMJS_BUILT__: string;
export const VERSION = typeof __SCMJS_VERSION__ === "string" ? __SCMJS_VERSION__ : "0.0.0-dev";
const COMMIT = typeof __SCMJS_COMMIT__ === "string" ? __SCMJS_COMMIT__ : "";
const BUILT = typeof __SCMJS_BUILT__ === "string" ? __SCMJS_BUILT__ : "";

export const PACKAGE = "@scm-js/cli";

/** a < b, for x.y.z versions (a prerelease or build suffix is ignored). */
export function olderThan(a: string, b: string): boolean {
  const n = (v: string) => v.split(/[-+]/)[0].split(".").map((x) => Number(x) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}

/** The newest version on npm, or null when npm could not be asked (offline, slow): two seconds at most. */
export async function newestVersion(): Promise<string | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(2000), headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown }).version;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}

/**
 * About's "Newest" row: the update and the line that installs it (npm's, the package manager's, or the release page
 * for a downloaded executable), this one, or what npm has when this is newer (a build from a clone).
 */
export function newestLine(version: string, latest: string | null, install: Install = installInfo()): string {
  if (latest === null) return pc.dim("could not ask npm");
  if (olderThan(version, latest)) return `${pc.yellow(latest)}${dot}${updateCommand(install, PACKAGE)}`;
  return pc.dim(latest === version ? "this one" : `${latest} on npm`);
}

export async function aboutReport() {
  const latest = await newestVersion();
  const install = installInfo();
  return {
    version: VERSION, latest, outdated: latest !== null && olderThan(VERSION, latest), commit: COMMIT || null, built: BUILT || null,
    install: { ...install, update: updateCommand(install, PACKAGE) },
    node: process.version, platform: `${process.platform} ${process.arch}`,
    desktopApp: findDesktopApp(), docker: dockerVersion(), pluginApi: PLUGIN_API_VERSION,
    reads: { maps: [".scm", ".scx", ".chk"], replays: [".rep"], bots: [".scmbot"] },
    links: { editor: EDITOR_URL, play: "https://scmjs.dev/play/", docs: "https://docs.scmjs.dev", bots: BOT_GUIDE, source: "https://github.com/scm-js/scm-js", issues: "https://github.com/scm-js/scm-js/issues" },
    author: "Jeany", license: "MIT",
  };
}

export function printAbout(r: Awaited<ReturnType<typeof aboutReport>>): string[] {
  return [
    `${pc.bold(pc.cyan("scmjs"))} ${pc.bold(r.version)}`,
    pc.dim("StarCraft: Brood War maps, replays and bots from the command line, by scmJS"),
    "",
    ...rows([
      ["Version", [r.version, r.commit && `commit ${r.commit}`, r.built && `built ${r.built}`].filter(Boolean).join(dot)],
      ["Newest", newestLine(r.version, r.latest, r.install)],
      ["Installed", `${installLabel(r.install)}${r.install.path ? pc.dim(`${dot}${r.install.path}`) : ""}`],
      ["Node", `${r.node}${r.install.kind === "binary" ? " (inside scmjs)" : ""}${dot}${r.platform}`],
      ["Desktop app", r.desktopApp ?? pc.dim("not found (scmjs … open uses the browser)")],
      ["Docker", r.docker ? `${r.docker}` : pc.dim("not found (scmjs bot needs it)")],
      ["Plugin API", String(r.pluginApi)],
      ["Reads", `maps ${r.reads.maps.join(" ")}${dot}replays ${r.reads.replays.join(" ")}${dot}bots ${r.reads.bots.join(" ")}`],
      null,
      ["Editor", pc.cyan(r.links.editor)],
      ["Play", pc.cyan(r.links.play)],
      ["Docs", pc.cyan(r.links.docs)],
      ["Bots", pc.cyan(r.links.bots)],
      ["Source", pc.cyan(r.links.source)],
      ["Issues", pc.cyan(r.links.issues)],
      null,
      ["Made by", pc.bold(r.author)],
      ["Licence", r.license],
    ]),
  ];
}
