/**
 * `scmjs map open` / `scmjs replay open`: the file in the scmJS desktop app when it is installed, else in the editor
 * in the browser, handed over by a page this command serves on the loopback address for a moment (the editor takes
 * files only from a loopback page that opened it: src/hooks/useOpenerHandoff.ts).
 */
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { Input } from "./files";
import { CliError, mark, pc, print } from "./ui";

export const EDITOR_URL = "https://scmjs.dev/editor/";

/** WSL: a Linux shell on Windows, where the app is the Windows one. */
const wsl = process.platform === "linux" && (() => { try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; } })();

function windowsEnv(name: string): string | null {
  try { const v = execFileSync("cmd.exe", ["/c", `echo %${name}%`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); return v && !v.includes("%") ? v : null; } catch { return null; }
}
const fromWindows = (p: string) => { try { return execFileSync("wslpath", ["-u", p], { encoding: "utf8" }).trim(); } catch { return null; } };
const toWindows = (p: string) => { try { return execFileSync("wslpath", ["-w", p], { encoding: "utf8" }).trim(); } catch { return p; } };

/** The installed desktop app, or null: `SCMJS_APP`, then where its installers put it. */
export function findDesktopApp(): string | null {
  if (process.env.SCMJS_APP) return existsSync(process.env.SCMJS_APP) ? process.env.SCMJS_APP : null;
  const candidates: string[] = [];
  if (process.platform === "win32") {
    for (const base of [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"), process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) if (base) candidates.push(join(base, "scmJS", "scmJS.exe"));
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/scmJS.app", join(homedir(), "Applications", "scmJS.app"));
  } else if (wsl) {
    const local = windowsEnv("LOCALAPPDATA"), files = windowsEnv("ProgramFiles");
    for (const base of [local && `${local}\\Programs`, files]) { const p = base && fromWindows(`${base}\\scmJS\\scmJS.exe`); if (p) candidates.push(p); }
  } else {
    candidates.push("/opt/scmJS/scm-js", "/opt/scmJS/scmjs", join(homedir(), "Applications", "scmJS.AppImage"));
  }
  return candidates.find((p) => existsSync(p)) ?? null;
}

function detach(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => { /* said by the caller's fallback */ });
  child.unref();
}

/** The person's browser at `url` (none with `BROWSER=none`, as other tools take it). */
function openBrowser(url: string): void {
  if (process.env.BROWSER === "none") return;
  if (process.platform === "win32") detach("cmd.exe", ["/c", "start", "", url]);
  else if (process.platform === "darwin") detach("open", [url]);
  else if (wsl) detach("cmd.exe", ["/c", "start", "", url.replace(/&/g, "^&")]);
  else detach("xdg-open", [url]);
}

export async function openInScmjs(input: Input, options: { browser?: boolean; editor?: string }): Promise<void> {
  const app = options.browser ? null : findDesktopApp();
  if (app) {
    const file = resolve(input.path);
    if (process.platform === "darwin") detach("open", ["-a", app, file]);
    else detach(app, [wsl ? toWindows(file) : file]);
    print(`${mark.ok} Opening ${pc.bold(input.name)} in the scmJS app`);
    return;
  }
  if (!options.browser) print(pc.dim("No scmJS app is installed here, so the editor opens in your browser."));
  await handOver(input, options.editor ?? process.env.SCMJS_EDITOR_URL ?? EDITOR_URL);
}

/**
 * The browser: a page on 127.0.0.1 opens the editor and posts it the file once it says it is ready; this waits for
 * the page to say it was taken (or two minutes) and stops serving.
 */
async function handOver(input: Input, editor: string): Promise<void> {
  const token = randomBytes(12).toString("hex");
  const target = new URL(editor);
  target.searchParams.set("handoff", "1");
  let done: (taken: boolean) => void = () => {};
  const finished = new Promise<boolean>((r) => { done = r; });
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === `/${token}/file`) { res.writeHead(200, { "content-type": "application/octet-stream" }); res.end(input.bytes); return; }
    if (url.pathname === `/${token}/taken` && req.method === "POST") { res.writeHead(204).end(); done(true); return; }
    if (url.pathname === `/${token}`) { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(handoffPage(input.name, target.href, token)); return; }
    res.writeHead(404).end();
  });
  await new Promise<void>((r, j) => { server.once("error", j); server.listen(0, "127.0.0.1", () => r()); });
  const port = (server.address() as { port: number }).port;
  const page = `http://127.0.0.1:${port}/${token}`;
  openBrowser(page);
  print(`${mark.info} Opening ${pc.bold(input.name)} in the editor in your browser`, pc.dim(`  If nothing opens, go to ${page}`));
  const timer = setTimeout(() => done(false), 120_000);
  const taken = await finished;
  clearTimeout(timer);
  server.close();
  if (!taken) throw new CliError("The editor did not take the file", `Open ${editor} and drop ${input.name} on it.`);
  print(`${mark.ok} Handed to the editor`);
}

/** The loopback page: opens the editor (a click, where the browser blocks a window it opens by itself) and posts it the file. */
function handoffPage(name: string, editor: string, token: string): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const origin = new URL(editor).origin;
  return `<!doctype html><meta charset="utf-8"><title>Opening ${esc(name)} in scmJS</title>
<style>body{font:15px system-ui,sans-serif;background:#14141c;color:#d8d8e8;display:grid;place-items:center;height:90vh;margin:0}
main{text-align:center}button{font:inherit;padding:.6em 1.4em;border-radius:6px;border:1px solid #4a4a6a;background:#262640;color:#fff;cursor:pointer}
p{color:#9898b0}</style>
<main><h2>Opening ${esc(name)}</h2><p id="say">Opening the editor…</p><button id="go" hidden>Open in the editor</button></main>
<script>
const editor = ${JSON.stringify(editor)}, origin = ${JSON.stringify(origin)}, token = ${JSON.stringify(token)}, name = ${JSON.stringify(name)};
const say = (t) => { document.getElementById("say").textContent = t; };
let win = null;
addEventListener("message", async (e) => {
  if (e.origin !== origin || e.source !== win) return;
  // (each time it says it is ready: in development the editor listens again after its first try)
  if (e.data?.type === "scmjs.ready") {
    const bytes = new Uint8Array(await (await fetch("/" + token + "/file")).arrayBuffer());
    win.postMessage({ type: "scmjs.open", files: [{ name, bytes }] }, origin, [bytes.buffer]);
  } else if (e.data?.type === "scmjs.taken") {
    await fetch("/" + token + "/taken", { method: "POST" });
    say("Opened in the editor. You can close this tab.");
    setTimeout(() => close(), 800);
  }
});
function go() { win = open(editor, "_blank"); if (win) { document.getElementById("go").hidden = true; say("Waiting for the editor…"); } return !!win; }
if (!go()) { say("Your browser asks before opening the editor."); document.getElementById("go").hidden = false; }
document.getElementById("go").onclick = go;
</script>`;
}
