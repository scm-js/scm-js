// `npm run verify`: what CI runs on a pull request, in its order, on this machine: lint, the tests, the type-check
// and build, the browser tests. It stops at the first step that fails and shows the end of its output, and ends with
// a summary to paste into the pull request: what passed, and what did not run here and why (the suites that need the
// game data, the browser tests where Chromium cannot start).
//   npm run verify                 all of it (a few minutes)
//   npm run verify -- --quick      lint, type-check and tests: no build, no browser tests
//   npm run verify -- --network    also the tests that reach GitHub (CI runs them)
import { spawn } from "node:child_process";
import { chromiumState, gameData, wsl } from "./lib/devenv.mjs";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const args = new Set(process.argv.slice(2));
const quick = args.has("--quick"), network = args.has("--network");
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const [green, yellow, red, dim, bold] = [paint(32), paint(33), paint(31), paint(2), paint(1)];
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
// The colour codes in a step's output, which is read for its counts. (A control character on purpose.)
// eslint-disable-next-line no-control-regex
const plain = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const num = (n) => Number(n).toLocaleString("en-US");

/** Runs a command quietly; its output is kept for when it fails. */
function run(cmd, cmdArgs, env = {}) {
  return new Promise((done) => {
    const started = Date.now();
    const child = spawn(cmd, cmdArgs, { cwd: root, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env }, shell: process.platform === "win32" });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => done({ ok: code === 0, out: plain(out), seconds: Math.round((Date.now() - started) / 1000) }));
    child.on("error", (e) => done({ ok: false, out: e.message, seconds: 0 }));
  });
}

/** What vitest and Playwright say they ran, from their last lines. */
const vitestCounts = (out) => { const m = /Tests\s+(.+?)\s*\(\d+\)/.exec(out); return m ? m[1].replace(/(\d+)/g, (n) => num(n)).replace(/ \| /g, ", ") : null; };
const playwrightCounts = (out) => ["passed", "failed", "flaky", "skipped"].map((k) => { const m = new RegExp(`(\\d+) ${k}`).exec(out); return m ? `${num(m[1])} ${k}` : null; }).filter(Boolean).join(", ") || null;

const browser = quick ? null : await chromiumState(root);
const data = gameData(root);
const steps = [
  { name: "Lint", cmd: [npm, ["run", "lint"]] },
  ...(quick ? [{ name: "Type-check", cmd: [process.platform === "win32" ? "npx.cmd" : "npx", ["tsc", "-b"]] }] : []),
  { name: "Tests", cmd: [npm, ["test"]], counts: vitestCounts },
  ...(network ? [{ name: "Network tests", cmd: [process.platform === "win32" ? "npx.cmd" : "npx", ["vitest", "run", "tests/plugin-network.test.ts"]], env: { SCMJS_NETWORK_TESTS: "1" }, counts: vitestCounts }] : []),
  ...(quick ? [] : [{ name: "Type-check and build", cmd: [npm, ["run", "build"]] }]),
  ...(quick ? [] : browser.state === "ok" ? [{ name: "Browser tests", cmd: [npm, ["run", "test:e2e"]], counts: playwrightCounts }] : []),
];

console.log(bold("Running what CI runs") + dim(quick ? "  (quick: no build, no browser tests)" : "  (a few minutes)") + "\n");
const results = [];
for (const step of steps) {
  if (process.stdout.isTTY) process.stdout.write(dim(`  ${step.name}…`));
  const r = await run(step.cmd[0], step.cmd[1], step.env);
  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  const counts = step.counts?.(r.out) ?? null;
  results.push({ name: step.name, ok: r.ok, counts });
  console.log(`${r.ok ? green("✔") : red("✖")} ${step.name}${counts ? `  ${counts}` : ""}${dim(`  ${r.seconds}s`)}`);
  if (!r.ok) {
    const tail = r.out.trimEnd().split("\n").slice(-40).join("\n");
    console.log("\n" + dim(tail.replace(/^/gm, "  ")) + "\n");
    console.log(red(`${step.name} failed.`) + dim(` The full output: ${step.cmd[0] === npm ? `npm ${step.cmd[1].join(" ")}` : step.cmd[1].join(" ")}`));
    process.exit(1);
  }
}

// What did not run here, and why: the honest half of a PR's "Testing" section.
const notRun = [];
if (!data.extracted) notRun.push("the tileset and unit suites (no extracted game data: npm run extract)");
if (!data.archives) notRun.push("the archive suites (no StarDat.mpq and BrooDat.mpq in fixtures/data/)");
if (!data.maps) notRun.push("the suites on Blizzard's maps (none in fixtures/maps/)");
if (browser && browser.state !== "ok") notRun.push(`the browser tests (Chromium ${browser.state === "missing" ? "is not installed: npx playwright install chromium" : browser.state === "libraries" ? "is missing system libraries: sudo npx playwright install-deps chromium" : "did not start"})`);
if (quick) notRun.push("the build and the browser tests (--quick)");
if (!network) notRun.push("the network tests (--network runs them)");

const os = process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : wsl ? "Linux (WSL)" : "Linux";
console.log("\n" + green("All passed.") + dim(" For the pull request:") + "\n");
console.log(`Checked with \`npm run verify${quick ? " -- --quick" : ""}\` on Node ${process.version.slice(1)}, ${os}:`);
for (const r of results) console.log(`- ${r.name}: ${r.counts ?? "passed"}`);
if (notRun.length) console.log(`- Not run here: ${notRun.join("; ")}.`);
if (notRun.some((n) => n.startsWith("the tileset") || n.startsWith("the suites on")) && !quick) console.log(yellow("\n  A change under src/formats/ should be checked with the game data too; CI has none, so the reviewer will ask."));
