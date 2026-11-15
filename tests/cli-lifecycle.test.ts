/**
 * What a command starts and leaves (cli/src/lifecycle.ts): the processes it starts, and what they start in turn, are
 * stopped and its temporary folders removed however the command ends — SIGINT, SIGTERM or SIGHUP from outside, an
 * exit before its work was done (a closed pipe), an uncaught error — and a signal still ends it with 128 + the signal's
 * number. Run against a small command bundled from `tests/support/lifecycleDriver.ts`.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startRunner } from "../cli/src/engine";

const posix = process.platform !== "win32";
const work = mkdtempSync(join(tmpdir(), "scmjs-lifecycle-test-"));
const temp = join(work, "tmp");
let driver = "";

beforeAll(async () => {
  mkdirSync(temp);
  const { build } = await import("rolldown");
  await build({ input: join(import.meta.dirname, "support", "lifecycleDriver.ts"), platform: "node", logLevel: "silent", output: { file: join(work, "driver.mjs"), format: "esm" } });
  driver = join(work, "driver.mjs");
}, 60_000);
/** Every process a test saw made: stopped at the end whatever the tests found, so a failing run leaves none. */
const seen: number[] = [];
afterAll(() => {
  for (const pid of seen) { try { process.kill(pid, "SIGKILL"); } catch { /* gone, as it should be */ } }
  rmSync(work, { recursive: true, force: true });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (ok: () => boolean, ms = 5000) => { for (const end = Date.now() + ms; !ok() && Date.now() < end;) await new Promise((r) => setTimeout(r, 20)); return ok(); };

interface Made { child: number; grandchild: number; folder: string; kept: string }

/** Starts the driver in `mode`, waits for what it made, then (unless `signal` is null) signals it; its end and what it made. */
async function drive(mode: string, signal: NodeJS.Signals | null) {
  const report = join(work, `${mode}-${signal}-${Date.now()}.json`);
  const p = spawn(process.execPath, [driver, mode, report], { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, TMPDIR: temp, TMP: temp, TEMP: temp } });
  seen.push(p.pid!);
  let stderr = "";
  p.stderr.on("data", (d) => { stderr += d; });
  const ended = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((r) => p.once("exit", (code, sig) => r({ code, signal: sig })));
  expect(await until(() => existsSync(report))).toBe(true);
  const made = JSON.parse(readFileSync(report, "utf8")) as Made;
  seen.push(made.child, made.grandchild);
  if (signal) p.kill(signal);
  const end = await ended;
  return { made, end, stderr, report };
}

describe.skipIf(!posix)("scmjs: what a command starts ends with it", () => {
  for (const [signal, code] of [["SIGINT", 130], ["SIGTERM", 143], ["SIGHUP", 129]] as const) {
    it(`stops its processes and theirs, and removes its folders, on ${signal}; it still ends as signalled`, async () => {
      const { made, end, stderr } = await drive("wait", signal);
      // As a shell sees it: killed by the signal (or, where it cannot be raised again, its exit code).
      expect(end.signal === signal || end.code === code).toBe(true);
      expect(await until(() => !alive(made.child) && !alive(made.grandchild))).toBe(true);
      expect(existsSync(made.folder)).toBe(false);
      expect(existsSync(made.kept)).toBe(false);
      expect(stderr).toContain("Stopped.");
    });
  }

  it("stops them when the command exits before its work is done (a closed pipe) or throws", async () => {
    for (const mode of ["exit", "throw"]) {
      const { made, end } = await drive(mode, null);
      expect(end.code).toBe(mode === "exit" ? 0 : 1);
      expect(await until(() => !alive(made.child) && !alive(made.grandchild))).toBe(true);
      expect(existsSync(made.folder)).toBe(false);
      // A folder kept on purpose unless the command is stopped (the text of an edit that did not import).
      expect(existsSync(made.kept)).toBe(true);
      rmSync(made.kept, { recursive: true, force: true });
    }
  });

  it("leaves a signal to the part of the command that listens for it itself", async () => {
    const report = join(work, "own.json");
    const p = spawn(process.execPath, [driver, "own-sigint", report], { stdio: "ignore", env: { ...process.env, TMPDIR: temp } });
    const ended = new Promise<NodeJS.Signals | null>((r) => p.once("exit", (_c, sig) => r(sig)));
    expect(await until(() => existsSync(report))).toBe(true);
    const made = JSON.parse(readFileSync(report, "utf8")) as Made;
    seen.push(made.child, made.grandchild, p.pid!);
    await new Promise((r) => setTimeout(r, 100));
    p.kill("SIGINT");
    expect(await until(() => existsSync(`${report}.sigint`))).toBe(true);
    expect(alive(made.child)).toBe(true);
    p.kill("SIGTERM");
    expect(await ended).toBe("SIGTERM");
    expect(await until(() => !alive(made.child) && !alive(made.grandchild))).toBe(true);
  });
});

describe("scmjs: a runner reached through a link", () => {
  it("is started by its real path, so it knows itself as the main module", async () => {
    const real = join(work, "engine-real"), linked = join(work, "engine-link");
    mkdirSync(real);
    // As scm-sim's runners do: the game starts only when the module is the one Node was started with.
    writeFileSync(join(real, "map-1.mjs"), `import { pathToFileURL } from "node:url";\nif (import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write("main\\n");\n`);
    try { symlinkSync(real, linked, "dir"); } catch { return; /* no links here (Windows without the right) */ }
    const child = startRunner(join(linked, "map-1.mjs"), []);
    let out = "";
    child.stdout!.on("data", (d) => { out += d; });
    await new Promise((r) => child.once("close", r));
    expect(out).toBe("main\n");
  });
});
