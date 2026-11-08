/**
 * A browser for `scmjs replay export`: the one already on this computer (Chrome, Chromium, Edge, Brave, or the
 * Chromium Playwright keeps), started without a window and driven over the Chrome DevTools Protocol on a pipe — the
 * browser reads messages on its file descriptor 3 and writes them on 4, each a JSON text ended by a NUL byte. Nothing
 * is bundled for it and nothing is installed: the command says where to get a browser when there is none.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { CliError } from "./ui";

/** Names a Chromium-family browser goes by on the PATH. */
const ON_PATH = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser", "chrome", "msedge"];

/** Where the browsers' installers put them, by platform; then Playwright's own Chromium. */
export function browserCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home = homedir()): string[] {
  const out: string[] = [];
  const exe = platform === "win32" ? ".exe" : "";
  for (const dir of (env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : delimiter).filter(Boolean)) {
    for (const name of ON_PATH) out.push(join(dir, name + exe));
  }
  if (platform === "darwin") {
    for (const app of ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"]) {
      for (const base of ["/Applications", join(home, "Applications")]) out.push(join(base, `${app}.app`, "Contents", "MacOS", app));
    }
  } else if (platform === "win32") {
    for (const base of [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter((p): p is string => !!p)) {
      out.push(join(base, "Google", "Chrome", "Application", "chrome.exe"), join(base, "Microsoft", "Edge", "Application", "msedge.exe"), join(base, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"), join(base, "Chromium", "Application", "chrome.exe"));
    }
  } else {
    out.push("/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge", "/snap/bin/chromium", "/opt/google/chrome/chrome");
  }
  // Playwright's Chromium (what `npx playwright install chromium` fetched), newest first.
  const cache = env.PLAYWRIGHT_BROWSERS_PATH || (platform === "win32" ? join(env.LOCALAPPDATA ?? home, "ms-playwright") : platform === "darwin" ? join(home, "Library", "Caches", "ms-playwright") : join(home, ".cache", "ms-playwright"));
  let builds: string[] = [];
  try { builds = readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])); } catch { /* none */ }
  for (const b of builds) {
    if (platform === "win32") out.push(join(cache, b, "chrome-win64", "chrome.exe"), join(cache, b, "chrome-win", "chrome.exe"));
    else if (platform === "darwin") for (const d of ["chrome-mac-arm64", "chrome-mac-x64", "chrome-mac"]) out.push(join(cache, b, d, "Chromium.app", "Contents", "MacOS", "Chromium"), join(cache, b, d, "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing"));
    else out.push(join(cache, b, "chrome-linux64", "chrome"), join(cache, b, "chrome-linux", "chrome"));
  }
  return [...new Set(out)];
}

/** The browser to record with: the one named (`--browser`, `SCMJS_BROWSER`), else the first candidate there is; null for none. */
export function findBrowser(named: string | undefined = process.env.SCMJS_BROWSER, exists: (p: string) => boolean = existsSync): string | null {
  if (named) return named;
  return browserCandidates().find((p) => exists(p)) ?? null;
}

/** The words for a computer without one. */
export const NO_BROWSER = "Install Chrome, Chromium or Edge, or name one with --browser (or SCMJS_BROWSER); npx playwright install chromium fetches one too.";

/* ── The protocol ───────────────────────────────────────────── */

/** A message from the browser: the answer to a call (`id`), or an event (`method`), of a page when `sessionId` says so. */
export interface CdpMessage { id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message: string }; sessionId?: string }

/** Splits what came on the pipe into whole messages, keeping a part message for the next chunk. */
export class NulSplitter {
  private held: Buffer[] = [];
  push(chunk: Buffer): string[] {
    const out: string[] = [];
    let from = 0;
    for (let at = chunk.indexOf(0); at >= 0; at = chunk.indexOf(0, from)) {
      this.held.push(chunk.subarray(from, at));
      out.push(Buffer.concat(this.held).toString("utf8"));
      this.held = [];
      from = at + 1;
    }
    if (from < chunk.length) this.held.push(chunk.subarray(from));
    return out;
  }
}

/** The DevTools protocol over a pipe: calls answered by id, events to listeners. */
export class Cdp {
  private next = 1;
  private readonly calls = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void; method: string }>();
  private readonly listeners: ((m: CdpMessage) => void)[] = [];
  private readonly split = new NulSplitter();
  private closed: Error | null = null;
  private readonly out: { write(s: string): unknown };
  constructor(out: { write(s: string): unknown }) { this.out = out; }

  /** Feeds bytes read from the browser. */
  feed(chunk: Buffer): void {
    for (const text of this.split.push(chunk)) {
      let m: CdpMessage;
      try { m = JSON.parse(text) as CdpMessage; } catch { continue; }
      if (m.id !== undefined) {
        const call = this.calls.get(m.id);
        if (!call) continue;
        this.calls.delete(m.id);
        if (m.error) call.reject(new Error(`${call.method}: ${m.error.message}`));
        else call.resolve(m.result ?? {});
      } else for (const l of this.listeners) l(m);
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(this.closed);
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.calls.set(id, { resolve, reject, method });
      this.out.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + "\0");
    });
  }

  on(listener: (m: CdpMessage) => void): void { this.listeners.push(listener); }

  /** The browser went away: every call still waiting fails with `why`. */
  close(why: Error): void {
    this.closed = why;
    for (const c of this.calls.values()) c.reject(why);
    this.calls.clear();
  }
}

/** A browser started for a recording, and its protocol. */
export interface Launched {
  cdp: Cdp;
  process: ChildProcess;
  /** Resolves when the browser has exited. */
  exited: Promise<number | null>;
  /** Closes the browser (politely, then not) and removes its profile. */
  stop(): Promise<void>;
}

/** Starts `path` headless, a fresh profile in the temporary folder, speaking the protocol on a pipe. */
export function launchBrowser(path: string, size: { width: number; height: number }): Launched {
  const profile = mkdtempSync(join(tmpdir(), "scmjs-browser-"));
  const args = [
    "--headless", "--remote-debugging-pipe", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check",
    "--mute-audio", "--hide-scrollbars", "--disable-extensions", "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows", `--window-size=${size.width},${size.height}`,
    // (Chromium's sandbox will not start as root, as in a container.)
    ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  let child: ChildProcess;
  try {
    child = spawn(path, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
  } catch (e) {
    rmSync(profile, { recursive: true, force: true });
    throw new CliError(`${path} could not be started (${e instanceof Error ? e.message : e}).`, NO_BROWSER);
  }
  const toBrowser = child.stdio[3] as Writable, fromBrowser = child.stdio[4] as Readable;
  const cdp = new Cdp(toBrowser);
  fromBrowser.on("data", (chunk: Buffer) => cdp.feed(chunk));
  // What it says on its standard error, the last of it, for when it will not start.
  let said = "";
  child.stderr?.on("data", (c: Buffer) => { said = (said + c.toString("utf8")).slice(-2000); });
  toBrowser.on("error", () => { /* it went: said by `exited` */ });
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", (e) => { cdp.close(new CliError(`${path} could not be started (${e.message}).`, NO_BROWSER)); resolve(null); });
    child.once("exit", (code) => { cdp.close(new CliError(`The browser stopped${code ? ` (exit code ${code})` : ""}.`, said.trim().split("\n").slice(-3).join("\n") || null)); resolve(code); });
  });
  let stopping: Promise<void> | null = null;
  const stop = () => stopping ??= (async () => {
    if (child.exitCode === null && child.signalCode === null) {
      cdp.send("Browser.close").catch(() => {});
      const gone = await Promise.race([exited.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 3000))]);
      if (!gone) { child.kill("SIGKILL"); await exited; }
    }
    rmSync(profile, { recursive: true, force: true });
  })();
  return { cdp, process: child, exited, stop };
}
