// Builds `scmjs` as a single executable, Node included, for people without Node (docs/cli.md "Without Node"): Node's
// single executable applications (SEA). The command's bundle is built again as CommonJS (SEA runs CommonJS only;
// scripts/lib/cli-bundle.mjs, entry cli/src/sea.ts), with the weigher `map cost` needs carried inside as an asset, and
// injected with postject into a copy of the official Node executable of this Node's version: this one for this
// computer, the others downloaded from nodejs.org and checked against its SHASUMS256.txt.
//
//   node scripts/build-cli-binary.mjs                      this computer's: cli/dist/bin/scmjs-<os>-<arch>[.exe]
//   node scripts/build-cli-binary.mjs --target darwin-arm64,darwin-x64 --archive
//   node scripts/build-cli-binary.mjs --check              and then run the checks of scripts/check-cli-binary.mjs
//
// Targets: linux-x64, darwin-arm64, darwin-x64, win-x64 (Node's names). A target's blob is made by that target's own
// Node when it runs here (this computer's; darwin-x64 on Apple silicon through Rosetta), with V8's code cache for a
// faster start; otherwise without it, which any Node of the same version reads. A macOS executable must be signed
// to run on Apple silicon: ad hoc (`codesign --sign -`), so only on a Mac. `--archive` packs each into the release's
// asset (.tar.gz, or .zip for Windows) with LICENSE and the third-party notices, Node's licence among them.
// Node 24 or newer: the executable imports TypeScript, plugins and the engine's runners from disk with `import()`.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { bundleCli, bundleWeigh, cliVersion } from "./lib/cli-bundle.mjs";

const POSTJECT = "postject@1.0.0-alpha.6";
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
/** Node's target names → the asset's (the desktop installers say windows, macos, linux too). */
const TARGETS = {
  "linux-x64": { os: "linux", arch: "x64", asset: "scmjs-linux-x64", archive: "tar.gz" },
  "darwin-arm64": { os: "macos", arch: "arm64", asset: "scmjs-macos-arm64", archive: "tar.gz" },
  "darwin-x64": { os: "macos", arch: "x64", asset: "scmjs-macos-x64", archive: "tar.gz" },
  "win-x64": { os: "windows", arch: "x64", asset: "scmjs-windows-x64", archive: "zip", exe: ".exe" },
};

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const host = `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`;
const targets = (value("--target") ?? host).split(",").map((t) => t.trim()).filter(Boolean);
for (const t of targets) if (!TARGETS[t]) fail(`No target ${t}; the targets are ${Object.keys(TARGETS).join(", ")}.`);
if (Number(process.versions.node.split(".")[0]) < 24) fail(`Node ${process.version} is too old to build the executable: it needs 24 or newer.`);

const OUT = "cli/dist/bin";
const WORK = join(OUT, ".work");
const NODE_VERSION = process.version;

function fail(message) { console.error(message); process.exit(1); }
/** A command, its output shown; `quiet`: shown only when it fails (postject warns about every ELF note it skips). */
function run(cmd, argv, { quiet = false, ...options } = {}) {
  const r = spawnSync(cmd, argv, { stdio: quiet ? "pipe" : "inherit", encoding: "utf8", shell: process.platform === "win32" && /\.cmd$/.test(cmd), ...options });
  if (r.status !== 0) fail(`${cmd} ${argv.join(" ")} failed${r.error ? `: ${r.error.message}` : ""}.${quiet ? `\n${r.stdout ?? ""}${r.stderr ?? ""}` : ""}`);
}
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) fail(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/** The official Node executable for `target` at this Node's version, downloaded once into the user's cache. */
async function officialNode(target) {
  const dir = join(process.env.SCMJS_BUILD_CACHE ?? join(homedir(), ".cache", "scmjs-build"), "node", NODE_VERSION, target);
  const file = join(dir, target.startsWith("win") ? "node.exe" : "node");
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const base = `https://nodejs.org/dist/${NODE_VERSION}`;
  const sums = (await download(`${base}/SHASUMS256.txt`)).toString("utf8");
  const name = target.startsWith("win") ? `win-x64/node.exe` : `node-${NODE_VERSION}-${target}.tar.gz`;
  const want = sums.split("\n").map((l) => l.trim().split(/\s+/)).find(([, n]) => n === name)?.[0];
  if (!want) fail(`${base}/SHASUMS256.txt does not list ${name}.`);
  console.log(`Downloading ${base}/${name}`);
  const bytes = await download(`${base}/${name}`);
  if (sha256(bytes) !== want) fail(`${name} does not match its SHA-256 in SHASUMS256.txt.`);
  if (target.startsWith("win")) writeFileSync(file, bytes);
  else {
    const tgz = join(dir, name);
    writeFileSync(tgz, bytes);
    run("tar", ["-xzf", tgz, "-C", dir, "--strip-components=2", `node-${NODE_VERSION}-${target}/bin/node`]);
    rmSync(tgz);
  }
  return file;
}

/** Node's licence (V8, ICU, OpenSSL and the rest inside it), from its source at this version, kept beside the executables. */
async function nodeLicence() {
  const file = join(process.env.SCMJS_BUILD_CACHE ?? join(homedir(), ".cache", "scmjs-build"), "node", NODE_VERSION, "LICENSE");
  if (existsSync(file)) return readFileSync(file, "utf8");
  const text = (await download(`https://raw.githubusercontent.com/nodejs/node/${NODE_VERSION}/LICENSE`)).toString("utf8");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  return text;
}

/** A .zip of `files` (deflated, no folders, no zip64: each well under 4 GB), for Windows, whose Explorer opens one. */
function zip(files, when = new Date()) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = deflateRawSync(f.bytes, { level: 9 });
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc32(f.bytes), 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(f.bytes.length, 22); head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); head.copy(dir, 8, 6, 30);
    dir.writeUInt32LE(offset, 42);
    locals.push(head, name, data);
    central.push(dir, name);
    offset += head.length + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

/** Does this Node executable run here (this computer's; an Intel Mac's under Rosetta)? */
function runsHere(node) {
  try { return execFileSync(node, ["-p", "process.version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() === NODE_VERSION; } catch { return false; }
}

// Vendored plugins, as build-cli.mjs: `map build` bundles the TrigScript compiler.
if (!existsSync("plugins/trigscript/vendored.json")) execFileSync("node", ["scripts/vendor-plugins.mjs"], { stdio: "inherit" });

const { version, commit } = cliVersion();
const started = Date.now();
await bundleCli({ outDir: WORK, install: "binary", version, commit });
await bundleWeigh({ outDir: WORK });
const notices = `${readFileSync(join(WORK, "THIRD-PARTY-NOTICES.txt"), "utf8").trimEnd()}\n\n${"=".repeat(80)}\nNode.js ${NODE_VERSION}, which the executable carries\n${"=".repeat(80)}\n\n${await nodeLicence()}`;
mkdirSync(OUT, { recursive: true });

const made = [];
for (const target of targets) {
  const t = TARGETS[target];
  const out = join(OUT, `${t.asset}${t.exe ?? ""}`);
  const node = target === host && !flag("--download") ? process.execPath : await officialNode(target);
  // The blob: by the target's own Node with V8's code cache when it runs here, else portable (no cache).
  const own = !flag("--no-code-cache") && runsHere(node);
  const config = join(WORK, `sea-${target}.json`);
  const blob = join(WORK, `${target}.blob`);
  writeFileSync(config, JSON.stringify({
    main: resolve(WORK, "scmjs.cjs"), output: resolve(blob), disableExperimentalSEAWarning: true, useCodeCache: own,
    assets: { "weigh.mjs": resolve(WORK, "weigh.mjs") },
  }, null, 2));
  run(own ? node : process.execPath, ["--experimental-sea-config", config], { quiet: true });
  rmSync(out, { force: true });
  copyFileSync(node, out);
  chmodSync(out, 0o755);
  const mac = target.startsWith("darwin");
  if (mac) {
    if (process.platform !== "darwin") fail(`${target}: a macOS executable is signed (ad hoc) after the injection, which needs a Mac.`);
    run("codesign", ["--remove-signature", out]);
  }
  run(process.platform === "win32" ? "npx.cmd" : "npx", ["--yes", POSTJECT, out, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE, ...(mac ? ["--macho-segment-name", "NODE_SEA"] : [])], { quiet: true });
  if (mac) run("codesign", ["--sign", "-", out]);
  const runnable = runsHere(node);
  if (runnable) {
    const said = execFileSync(out, ["--version"], { encoding: "utf8" }).trim();
    if (said !== version) fail(`${out} --version said ${said}, not ${version}.`);
  }
  const entry = { target, file: out, bytes: statSync(out).size, codeCache: own, runnable };
  if (flag("--archive")) {
    const name = `scmjs${t.exe ?? ""}`;
    const stage = join(WORK, target);
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    copyFileSync(out, join(stage, name));
    chmodSync(join(stage, name), 0o755);
    copyFileSync("cli/LICENSE", join(stage, "LICENSE"));
    writeFileSync(join(stage, "THIRD-PARTY-NOTICES.txt"), notices);
    const archive = resolve(OUT, `${t.asset}.${t.archive}`);
    rmSync(archive, { force: true });
    if (t.archive === "zip") {
      writeFileSync(archive, zip([name, "LICENSE", "THIRD-PARTY-NOTICES.txt"].map((f) => ({ name: f, bytes: readFileSync(join(stage, f)) }))));
    } else {
      // COPYFILE_DISABLE: no ._ files from a Mac's tar.
      run("tar", ["-czf", archive, "-C", stage, name, "LICENSE", "THIRD-PARTY-NOTICES.txt"], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
    }
    entry.archive = archive;
    entry.archiveBytes = statSync(archive).size;
    entry.sha256 = sha256(readFileSync(archive));
  }
  made.push(entry);
}

const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
for (const m of made) console.log(`${m.file}: ${mb(m.bytes)}${m.codeCache ? ", code cache" : ""}${m.archive ? `; ${m.archive.slice(resolve(".").length + 1)}: ${mb(m.archiveBytes)}` : ""}`);
console.log(`scmjs ${version}${commit ? ` (${commit})` : ""} on Node ${NODE_VERSION}, ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (made.some((m) => m.archive)) writeFileSync(join(OUT, "SHA256SUMS"), made.filter((m) => m.archive).map((m) => `${m.sha256}  ${m.archive.split(/[\\/]/).pop()}\n`).join(""));
if (flag("--check")) {
  for (const m of made) if (m.runnable) run(process.execPath, ["scripts/check-cli-binary.mjs", m.file]);
}
