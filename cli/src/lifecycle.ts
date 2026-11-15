/**
 * What a command starts and leaves behind, ended with the command: the game's runners and the browser (processes of
 * their own), temporary folders, and what was done to the terminal (a hidden cursor). However the command ends — its
 * work done, an error, a closed pipe (`| head`), SIGINT, SIGTERM or SIGHUP from outside (a supervisor, `timeout`, a CI
 * cancel) — the processes are stopped and the folders removed. SIGKILL cannot be answered from inside the process.
 *
 * A process is started in a process group of its own (POSIX), so stopping it stops what it started too: the match
 * runner's seats, the browser's renderers. A signal is answered only while nothing else in the command listens for it
 * (the text editor leaves Ctrl-C to the editor; `plugin dev` stops its own way); the clean-up at exit runs regardless.
 */
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isatty } from "node:tty";
import { t } from "./i18n";
import { mark } from "./ui";

const children = new Set<ChildProcess>();
/** Temporary folders, and whether each goes at any end (`true`) or only when the command is stopped by a signal. */
const folders = new Map<string, boolean>();
const undos = new Set<() => void>();
const SIGNALS = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 } as const;
type Sig = keyof typeof SIGNALS;
const groups = process.platform !== "win32";
let armed = false;

/** Listens for the command's end, once, the first time there is something to end. */
function arm(): void {
  if (armed) return;
  armed = true;
  process.on("exit", () => finish(false));
  for (const sig of Object.keys(SIGNALS) as Sig[]) process.on(sig, onSignal);
}

function onSignal(sig: NodeJS.Signals): void {
  // Someone else in the command listens for it (the text editor's Ctrl-C, plugin dev's stop): theirs to answer.
  if (process.listenerCount(sig) > 1) return;
  const running = [...children].some(alive);
  finish(true);
  // The keyboard as it was (replay watch reads keys one at a time): the signal's own end would leave it so.
  if (isatty(0) && (process.stdin as { isRaw?: boolean }).isRaw) { try { (process.stdin as unknown as { setRawMode(on: boolean): void }).setRawMode(false); } catch { /* best effort */ } }
  if (running) { try { process.stderr.write(`${process.stderr.isTTY ? "\n" : ""}${mark.warn} ${t("Stopped.")}\n`); } catch { /* a closed terminal */ } }
  // The signal again, now with nothing listening, so the command ends as signalled (130, 143, 129) as a shell expects.
  for (const s of Object.keys(SIGNALS) as Sig[]) process.off(s, onSignal);
  try { process.kill(process.pid, sig); } catch { /* not on this system */ }
  process.exit(128 + (SIGNALS[sig as Sig] ?? 0));
}

const alive = (c: ChildProcess) => c.exitCode === null && c.signalCode === null && c.pid !== undefined;

/** Stops what is still running, undoes what was done to the terminal, removes the folders. Synchronous: it runs at exit. */
function finish(signalled: boolean): void {
  for (const undo of undos) { undos.delete(undo); try { undo(); } catch { /* best effort */ } }
  const running = [...children].filter(alive);
  children.clear();
  if (running.length) {
    for (const c of running) stopProcess(c, "SIGTERM");
    // A moment for each to go on its own (a runner goes at once; the browser closes its profile), then for good.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    for (const c of running) stopProcess(c, "SIGKILL");
  }
  for (const [dir, always] of folders) {
    if (!always && !signalled) continue;
    folders.delete(dir);
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* the system's to clear */ }
  }
}

function stopProcess(c: ChildProcess, sig: NodeJS.Signals): void {
  try {
    if (groups && c.pid) process.kill(-c.pid, sig);
    else c.kill(sig);
  } catch { /* gone already */ }
}

/**
 * `spawn`, the process ending with the command: in a group of its own on POSIX, so what it starts ends with it too.
 * Not for a process meant to outlive the command (a browser opened on a page) nor one on the terminal (an editor).
 */
export function spawnOwned(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const child = spawn(command, args, { ...options, detached: groups });
  arm();
  if (child.pid === undefined) return child;
  children.add(child);
  child.once("exit", () => {
    children.delete(child);
    // Anything it left in its group (a seat whose match ended badly) goes with it.
    if (groups && child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* none left */ } }
  });
  return child;
}

/**
 * A new folder in the system's temporary one, removed when the command ends however it ends. `untilStopped`: removed
 * only when the command is stopped by a signal — a folder the command removes itself, or keeps on purpose (an edit
 * that did not import stays for the person to fix).
 */
export function tempFolder(prefix: string, o: { untilStopped?: boolean } = {}): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  arm();
  folders.set(dir, !o.untilStopped);
  return dir;
}

/**
 * A folder the command made for its results (a `--out` folder that was not there), removed if the command is stopped
 * by a signal: a run cut short leaves nothing where nothing was.
 */
export function madeFolder(dir: string): void {
  arm();
  if (!folders.has(dir)) folders.set(dir, false);
}

/** A temporary folder kept after all: not removed at the end. */
export function keepFolder(dir: string): void { folders.delete(dir); }

/** A temporary folder removed now (and no longer at the end). */
export function removeFolder(dir: string): void {
  folders.delete(dir);
  try { rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* the system's to clear */ }
}

/** `undo` runs when the command ends, however it ends, unless the returned function is called first (it was undone). */
export function atExit(undo: () => void): () => void {
  arm();
  undos.add(undo);
  return () => { undos.delete(undo); };
}

/** For tests: what is being watched now. */
export function owned(): { processes: number; folders: string[] } {
  return { processes: [...children].filter(alive).length, folders: [...folders.keys()] };
}
