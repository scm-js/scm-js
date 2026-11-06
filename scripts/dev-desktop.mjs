// `npm run dev:desktop`: the desktop app against the dev server, in one command. It starts Vite, waits until it
// answers, then runs Electron with SCMJS_DEV_URL pointing at it; closing the window or Ctrl+C stops both. Anything
// after `--` goes to Electron. No dependencies, so it is the same on Windows, macOS and Linux. (Idea and first
// versions: #120.)
//   npm run dev:desktop
//   npm run dev:desktop -- --remote-debugging-port=9222
//   DEV_DESKTOP_PORT=5174 npm run dev:desktop
//
// The page reloads on edits as in a browser. The main process and the preload are bundled once at launch, so a
// change to desktop/ needs the app restarted.
import { spawn, spawnSync } from "node:child_process";

const port = Number(process.env.DEV_DESKTOP_PORT || 5173);
const url = `http://localhost:${port}/`;
const appArgs = process.argv.slice(2);
const windows = process.platform === "win32";
const npm = windows ? "npm.cmd" : "npm";
const say = (s) => console.log(`\x1b[2m[dev:desktop]\x1b[0m ${s}`);

/** A child with its own process group (Unix), so stopping it stops what it started; Windows stops the tree. */
function start(args, env = {}) {
  return spawn(npm, args, { stdio: "inherit", env: { ...process.env, ...env }, detached: !windows, shell: windows });
}
function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (windows) spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else try { process.kill(-child.pid, "SIGTERM"); } catch { /* already gone */ }
}

let app = null;
const vite = start(["run", "dev", "--", "--port", String(port), "--strictPort"]);
const finish = (code) => { stop(app); stop(vite); process.exit(code); };
process.on("SIGINT", () => finish(130));
process.on("SIGTERM", () => finish(143));
vite.on("exit", (code) => {
  if (app) return; // stopped after the app closed
  say(code === 0 ? "the dev server stopped" : `the dev server stopped (exit ${code}); is port ${port} in use? DEV_DESKTOP_PORT picks another`);
  finish(code || 1);
});

// The first run fetches the default plugins before Vite starts (predev), so this can take a while.
const deadline = Date.now() + 180_000;
for (;;) {
  try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* not yet */ }
  if (Date.now() > deadline) { say(`${url} did not answer in three minutes`); finish(1); }
  await new Promise((r) => setTimeout(r, 300));
}

say(`starting the app against ${url}`);
app = start(["run", "desktop", ...(appArgs.length ? ["--", ...appArgs] : [])], { SCMJS_DEV_URL: url });
app.on("exit", (code, signal) => { say("the app closed; stopping the dev server"); stop(vite); process.exit(signal ? 1 : code ?? 0); });
