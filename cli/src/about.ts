/** `scmjs about`: this build, the machine it runs on, the desktop app, and where everything is. */
import { PLUGIN_API_VERSION } from "../../src/plugins/api";
import { findDesktopApp, EDITOR_URL } from "./open";
import { dot, pc, rows } from "./ui";

declare const __SCMJS_VERSION__: string, __SCMJS_COMMIT__: string, __SCMJS_BUILT__: string;
export const VERSION = typeof __SCMJS_VERSION__ === "string" ? __SCMJS_VERSION__ : "0.0.0-dev";
const COMMIT = typeof __SCMJS_COMMIT__ === "string" ? __SCMJS_COMMIT__ : "";
const BUILT = typeof __SCMJS_BUILT__ === "string" ? __SCMJS_BUILT__ : "";

export function aboutReport() {
  return {
    version: VERSION, commit: COMMIT || null, built: BUILT || null,
    node: process.version, platform: `${process.platform} ${process.arch}`,
    desktopApp: findDesktopApp(), pluginApi: PLUGIN_API_VERSION,
    reads: { maps: [".scm", ".scx", ".chk"], replays: [".rep"] },
    links: { editor: EDITOR_URL, docs: "https://docs.scmjs.dev", source: "https://github.com/scm-js/scm-js", issues: "https://github.com/scm-js/scm-js/issues" },
    license: "MIT",
  };
}

export function printAbout(r: ReturnType<typeof aboutReport>): string[] {
  return [
    `${pc.bold(pc.cyan("scmjs"))} ${pc.bold(r.version)}`,
    pc.dim("StarCraft: Brood War maps and replays from the command line, by scmJS"),
    "",
    ...rows([
      ["Version", [r.version, r.commit && `commit ${r.commit}`, r.built && `built ${r.built}`].filter(Boolean).join(dot)],
      ["Node", `${r.node}${dot}${r.platform}`],
      ["Desktop app", r.desktopApp ?? pc.dim("not found (scmjs … open uses the browser)")],
      ["Plugin API", String(r.pluginApi)],
      ["Reads", `maps ${r.reads.maps.join(" ")}${dot}replays ${r.reads.replays.join(" ")}`],
      null,
      ["Editor", pc.cyan(r.links.editor)],
      ["Docs", pc.cyan(r.links.docs)],
      ["Source", pc.cyan(r.links.source)],
      ["Issues", pc.cyan(r.links.issues)],
      ["Licence", r.license],
    ]),
  ];
}
