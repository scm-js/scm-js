/**
 * `--copy`: text to the system clipboard through the tool the system has for it — `clip.exe` on Windows and in WSL
 * (Windows' own clipboard, which is the one the person pastes from there), `pbcopy` on macOS, and on Linux `wl-copy`
 * under Wayland, else `xclip` or `xsel`. The first that runs and exits 0 wins; none is a reason in words, never a
 * failure of the command that asked (the link is printed either way).
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { t } from "./i18n";

export interface ClipboardTool { command: string; args: string[] }

/** Whether this Linux is WSL, where Windows' clipboard is reached through clip.exe. */
export function isWsl(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): boolean {
  if (platform !== "linux") return false;
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP) return true;
  try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; }
}

/** The tools to try, in order, for this system. */
export function clipboardTools(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, wsl = isWsl(platform, env)): ClipboardTool[] {
  if (platform === "win32") return [{ command: "clip.exe", args: [] }];
  if (platform === "darwin") return [{ command: "pbcopy", args: [] }];
  const unix: ClipboardTool[] = [
    ...(env.WAYLAND_DISPLAY ? [{ command: "wl-copy", args: [] }] : []),
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
  ];
  // (clip.exe is on the PATH through WSL's interop; the full path for a PATH without Windows' folders)
  return wsl ? [{ command: "clip.exe", args: [] }, { command: "/mnt/c/Windows/System32/clip.exe", args: [] }, ...unix] : unix;
}

export type CopyOutcome = { copied: true; tool: string } | { copied: false; why: string };

/** Runs one tool with `text` on its standard input: null when it took it, else why not (`missing` when it is not there). */
function runTool(tool: ClipboardTool, text: string, timeoutMs: number): Promise<string | null> {
  return new Promise((done) => {
    let said = "";
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (why: string | null) => { if (!settled) { settled = true; clearTimeout(timer); done(why); } };
    let child: ReturnType<typeof spawn>;
    try { child = spawn(tool.command, tool.args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true }); } catch (e) { finish((e as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : String(e)); return; }
    timer = setTimeout(() => { child.kill(); finish(t("it did not finish in time")); }, timeoutMs);
    child.on("error", (e: NodeJS.ErrnoException) => finish(e.code === "ENOENT" ? "missing" : e.message));
    child.stderr?.on("data", (d: Buffer) => { said += d.toString(); });
    // `exit`, not `close`: xclip and wl-copy leave a process behind that holds the clipboard, and with it the pipes.
    // The pipe is let go of then, so the one left behind does not keep this process waiting; a refusal's words first.
    child.on("exit", (code) => {
      const end = () => { finish(code === 0 ? null : said.trim().split("\n")[0] || t("it stopped with {code}", { code: String(code) })); child.stderr?.destroy(); child.unref(); };
      if (code === 0 || !child.stderr || child.stderr.readableEnded) return end();
      child.stderr.once("end", end);
      setTimeout(end, 200).unref();
    });
    child.stdin?.on("error", () => { /* said by exit */ });
    child.stdin?.end(text);
  });
}

/** `text` to the clipboard by the first tool that takes it; the reason in words when none did. */
export async function copyToClipboard(text: string, o: { tools?: ClipboardTool[]; timeoutMs?: number } = {}): Promise<CopyOutcome> {
  const tools = o.tools ?? clipboardTools();
  const failed: string[] = [];
  for (const tool of tools) {
    const why = await runTool(tool, text, o.timeoutMs ?? 5_000);
    if (why === null) return { copied: true, tool: tool.command };
    if (why !== "missing") failed.push(`${tool.command}: ${why}`);
  }
  const names = [...new Set(tools.map((tool) => tool.command.replace(/^.*\//, "")))].join(", ");
  return { copied: false, why: failed.length ? failed.join("; ") : t("no clipboard tool here ({tools})", { tools: names }) };
}
