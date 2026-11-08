// Runs the single executable (scripts/build-cli-binary.mjs) through what tests/cli*.test.ts cover, as a person without
// Node would: with no `node` and no `npm` on PATH, in a temporary folder. Maps come from tests/maps; TypeScript for
// `map build` from a project folder whose node_modules links this clone's. Prints a line per check, exits 1 on any
// failure. CI runs it on each executable it builds (build.yml's `cli-binary`); by hand:
//   node scripts/check-cli-binary.mjs cli/dist/bin/scmjs-linux-x64
//   node scripts/check-cli-binary.mjs <exe> --replay some.rep --game     a replay's info, and the game (needs StarCraft)
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

const args = process.argv.slice(2);
const exe = args[0] && resolve(args[0]);
if (!exe || !existsSync(exe)) { console.error("usage: node scripts/check-cli-binary.mjs <executable> [--replay <file>] [--game]"); process.exit(2); }
const replay = args.includes("--replay") ? resolve(args[args.indexOf("--replay") + 1]) : process.env.SCMJS_TEST_REPLAY;
const game = args.includes("--game");
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const maps = resolve("tests/maps");

// PATH without Node: every folder holding a `node` or `npm` is left out, so nothing the executable does can lean on one.
const windows = process.platform === "win32";
const hasNode = (d) => ["node", "npm", "node.exe", "npm.cmd"].some((f) => existsSync(join(d, f)));
const PATH = (process.env.PATH ?? "").split(delimiter).filter((d) => d && !hasNode(d)).join(delimiter);
// Windows spells it Path and reads it in any case: one key, whatever it was called.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^path$/i.test(k) && k !== "NODE_OPTIONS"));
env[windows ? "Path" : "PATH"] = PATH;
env.NO_COLOR = "1";
const work = mkdtempSync(join(tmpdir(), "scmjs-binary-check-"));

let failed = 0;
const scmjs = (argv, options = {}) => spawnSync(exe, argv, { cwd: work, env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...options });
async function check(name, fn) {
  const t = Date.now();
  try {
    await fn();
    console.log(`  ok    ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : e}`);
  }
}
function expectRun(r, { status = 0, out, err } = {}) {
  const said = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-6).join(" | ");
  if (r.error) throw r.error;
  if (r.status !== status) throw new Error(`exit ${r.status}, wanted ${status}: ${said}`);
  if (/Something went wrong/.test(r.stderr ?? "")) throw new Error(`crashed: ${said}`);
  if (out && !out.test(r.stdout)) throw new Error(`output did not match ${out}: ${said}`);
  if (err && !err.test(r.stderr)) throw new Error(`errors did not match ${err}: ${said}`);
  return r;
}

console.log(`${exe}\n  in ${work}, PATH without Node`);
cpSync(join(maps, "melee.scx"), join(work, "melee.scx"));
cpSync(join(maps, "ums.scx"), join(work, "ums.scx"));

await check("--version", () => expectRun(scmjs(["--version"]), { out: new RegExp(`^${version.replace(/\./g, "\\.")}\\s*$`) }));
await check("the overview", () => expectRun(scmjs([]), { out: /map info\|check/ }));
await check("about knows it is the executable", () => {
  const r = JSON.parse(expectRun(scmjs(["about", "--json"])).stdout);
  if (r.install?.kind !== "binary") throw new Error(`install is ${JSON.stringify(r.install)}`);
});
await check("doctor", () => {
  const r = JSON.parse(expectRun(scmjs(["doctor", "--json"])).stdout);
  if (r.install?.kind !== "binary") throw new Error(`install is ${JSON.stringify(r.install)}`);
  if (r.checks.find((c) => c.what === "Node")?.state !== "ok") throw new Error("the Node check is not ok");
});
await check("map info", () => expectRun(scmjs(["map", "info", "melee.scx"]), { out: /64 × 64/ }));
await check("info from standard input", () => expectRun(scmjs(["map", "info", "-"], { input: readFileSync(join(work, "melee.scx")) }), { out: /Jungle World/ }));
await check("map check over the test maps", () => expectRun(scmjs(["map", "check", ...readdirSync(maps).filter((f) => /\.sc[mx]$/.test(f)).map((f) => join(maps, f))]), { out: /5 maps checked/ }));
await check("map new", () => expectRun(scmjs(["map", "new", "new.scx", "--players", "2"])));
await check("map dump", () => expectRun(scmjs(["map", "dump", "ums.scx"]), { out: /^# ums\.scx — scmjs map dump/ }));
await check("map find", () => expectRun(scmjs(["map", "find", "Marine", "ums.scx"]), { out: /Marine/ }));
await check("map set, then map diff", () => {
  expectRun(scmjs(["map", "set", "melee.scx", "--name", "Renamed", "--out", "renamed.scx"]));
  expectRun(scmjs(["map", "diff", "melee.scx", "renamed.scx"]), { status: 1, out: /Renamed/ });
});
await check("map unpack and pack", () => {
  expectRun(scmjs(["map", "unpack", "ums.scx", "--out", "ums-folder"]));
  expectRun(scmjs(["map", "pack", "ums-folder", "--out", "packed.scx"]));
  expectRun(scmjs(["map", "diff", "ums.scx", "packed.scx"]));
});
await check("map triggers export", () => expectRun(scmjs(["map", "triggers", "export", "ums.scx", "--out", "-"]), { out: /Trigger/ }));
await check("map preview without the game's files says so", () => {
  expectRun(scmjs(["map", "preview", "melee.scx", "--starcraft", work]), { status: 1, err: /StarCraft/ });
});
await check("map run with a plugin script", () => {
  writeFileSync(join(work, "rename.js"), 'export default function activate(api) { api.document.update("Rename", (tx) => tx.properties({ name: "From a plugin" })); }\n');
  expectRun(scmjs(["map", "run", "rename.js", "melee.scx", "--out", "plugged.scx"]));
  expectRun(scmjs(["map", "info", "plugged.scx"]), { out: /From a plugin/ });
});

// TypeScript from the project's node_modules (this clone's, linked): the executable has no folder of its own to look in.
const typescript = realpathSync("node_modules/typescript");
const project = join(work, "project");
if (existsSync(join("plugins", "trigscript", "vendored.json"))) {
  await check("map build, TypeScript from the project", () => {
    mkdirSync(join(project, "node_modules"), { recursive: true });
    symlinkSync(typescript, join(project, "node_modules", "typescript"), windows ? "junction" : "dir");
    expectRun(scmjs(["map", "unpack", join(work, "ums.scx"), "--out", "src"], { cwd: project }));
    mkdirSync(join(project, "src", "trigscript"), { recursive: true });
    writeFileSync(join(project, "src", "trigscript", "main.ts"), 'import { trigger, always, displayText, P1 } from "trigscript";\ntrigger(P1, [always()], [displayText("built without Node")]);\n');
    expectRun(scmjs(["map", "pack", "src", "--out", "scripted.scx"], { cwd: project }));
    expectRun(scmjs(["map", "build", "scripted.scx"], { cwd: project }));
    expectRun(scmjs(["map", "triggers", "export", "scripted.scx", "--out", "-"], { cwd: project }), { out: /built without Node/ });
  });
  await check("map build without TypeScript says how to get it", () => {
    expectRun(scmjs(["map", "build", join(project, "scripted.scx"), "--check"], { cwd: tmpdir() }), { status: 1, err: /TypeScript/ });
  });
}

await check("the executable runs a script as Node (SCMJS_RUN_AS_NODE)", () => {
  // As a runner is: the main module by argv[1], with a worker thread from a file beside it.
  writeFileSync(join(work, "worker.mjs"), 'import { parentPort } from "node:worker_threads";\nparentPort.postMessage(6 * 7);\n');
  writeFileSync(join(work, "script.mjs"), [
    'import { pathToFileURL } from "node:url";',
    'import { Worker } from "node:worker_threads";',
    'const main = import.meta.url === pathToFileURL(process.argv[1]).href;',
    'const w = new Worker(new URL("./worker.mjs", import.meta.url));',
    'w.once("message", (n) => { console.log(JSON.stringify({ main, args: process.argv.slice(2), n })); w.terminate(); });',
    'w.on("error", (e) => { console.error(e); process.exit(1); });',
  ].join("\n"));
  const r = expectRun(scmjs(["script.mjs", "a", "b"], { env: { ...env, SCMJS_RUN_AS_NODE: "1" } }));
  const said = JSON.parse(r.stdout.trim());
  if (!said.main || said.args.join() !== "a,b" || said.n !== 42) throw new Error(r.stdout);
});

await check("mcp answers initialize and lists its tools", () => new Promise((done, failNow) => {
  const child = spawn(exe, ["mcp"], { cwd: work, env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  const timer = setTimeout(() => { child.kill(); failNow(new Error(`no answer: ${out}`)); }, 20000);
  child.stdout.on("data", (b) => {
    out += b;
    const lines = out.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
    const list = lines.find((m) => m?.id === 2);
    if (!list) return;
    clearTimeout(timer);
    child.kill();
    const n = list.result?.tools?.length ?? 0;
    if (n < 10) failNow(new Error(`${n} tools`)); else done();
  });
  const send = (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`);
  send({ id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "check", version: "1" } } });
  send({ method: "notifications/initialized" });
  send({ id: 2, method: "tools/list", params: {} });
}));

if (replay && existsSync(replay)) {
  await check("replay info", () => expectRun(scmjs(["replay", "info", replay])));
  await check("replay map", () => expectRun(scmjs(["replay", "map", replay, "--out", "from-replay.scx"])));
}
if (game) {
  // The game engine's runner, started by the executable as Node: needs a copy of StarCraft and the engine (fetched).
  await check("map trace in the game", () => expectRun(scmjs(["map", "trace", "ums.scx", "--frames", "240", "--every", "0"]), { out: /Never fired|fired/ }));
  await check("map cost, the weigher from inside the executable", () => expectRun(scmjs(["map", "cost", "ums.scx", "--frames", "120"]), { out: /Costliest/ }));
}

rmSync(work, { recursive: true, force: true });
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
