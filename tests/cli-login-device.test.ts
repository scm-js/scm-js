/**
 * `scmjs login --device`, the sign-in by code, against a stand-in of the server's two routes on the loopback address
 * (answering as ai-server 0.40.0 does), with intervals cut to a fifth of a second. The real round — the built command,
 * a local ai-server and its /device page in Chromium — was run by hand (.claude/internals/cli-account.md).
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loginByCode, noLocalBrowser, readSession, type DeviceStart } from "../cli/src/account";
import { CliError } from "../cli/src/ui";

const ACCOUNT = { kind: "account", name: "Ann", role: "free", providers: ["google"] };
let srv: Server;
let base = "";
/** What the next polls answer, in order; the last one repeats. */
let answers: { status: number; body: unknown }[] = [];
let starts: Record<string, unknown>[] = [];
let polls: Record<string, unknown>[] = [];
let missing = false;
let expiresIn = 600;

beforeAll(async () => {
  srv = createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => { raw += c.toString("utf8"); });
    req.on("end", () => {
      const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
      const route = `${req.method} ${req.url}`;
      if (missing) return send(404, { message: "Route not found", statusCode: 404 });
      if (route === "POST /v1/auth/device") {
        starts.push(JSON.parse(raw));
        const d: DeviceStart = { deviceCode: "dev_secret", userCode: "WDJB-MJHT", verificationUri: `${base}/device`, verificationUriComplete: `${base}/device?code=WDJB-MJHT`, expiresIn, interval: 0.2 };
        return send(200, d);
      }
      if (route === "POST /v1/auth/device/token") {
        polls.push(JSON.parse(raw));
        const a = answers.length > 1 ? answers.shift()! : answers[0]!;
        return send(a.status, a.body);
      }
      send(404, { error: { code: "not_found", message: "No such route." } });
    });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterAll(() => srv.close());

let dir = "";
let file = "";
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "scmjs-device-")); file = join(dir, "config", "scmjs", "session.json"); answers = []; starts = []; polls = []; missing = false; expiresIn = 600; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const pending = { status: 200, body: { status: "pending", interval: 0.2 } };
const caught = async (p: Promise<unknown>): Promise<CliError> => {
  try { await p; } catch (e) { if (e instanceof CliError) return e; throw e; }
  throw new Error("expected a CliError");
};

describe("scmjs login --device", () => {
  it("shows the address and the code, polls at the server's pace and keeps the session it is given", async () => {
    answers = [pending, { status: 200, body: { status: "slow_down", interval: 0.2 } }, { status: 200, body: { status: "approved", session: "sess-dev", account: ACCOUNT } }];
    let said: DeviceStart | null = null;
    const ticks: number[] = [];
    const r = await loginByCode({ server: base, file, say: (d) => { said = d; }, tick: (left) => ticks.push(left) });
    expect(said!).toMatchObject({ userCode: "WDJB-MJHT", verificationUri: `${base}/device` });
    expect(starts).toEqual([{ client: `scmjs on ${hostname()}` }]);
    expect(polls).toEqual([{ deviceCode: "dev_secret" }, { deviceCode: "dev_secret" }, { deviceCode: "dev_secret" }]);
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks[0]).toBeGreaterThan(590_000);
    expect(r).toMatchObject({ server: base, file, provider: "google", account: { name: "Ann" } });
    expect(readSession(file)).toMatchObject({ server: base, session: "sess-dev", name: "Ann", provider: "google" });
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(file, "utf8")).not.toContain("dev_secret");
  });

  it("says when the code was denied, expired, or the wait ran past it", async () => {
    answers = [pending, { status: 200, body: { status: "denied" } }];
    const no = await caught(loginByCode({ server: base, file }));
    expect([no.message, no.hint]).toEqual(["The sign-in was denied on the page", "Nothing was signed in. scmjs login --device starts again."]);
    answers = [{ status: 200, body: { status: "expired" } }];
    const gone = await caught(loginByCode({ server: base, file }));
    expect([gone.message, gone.hint]).toEqual(["The code expired before it was allowed", "scmjs login --device gives a new one."]);
    answers = [pending];
    expiresIn = 0.5;
    const late = await caught(loginByCode({ server: base, file }));
    expect(late.message).toBe("The code expired before it was allowed");
    expect(readSession(file)).toBeNull();
  });

  it("refuses a trial session and a server without the sign-in by code", async () => {
    answers = [{ status: 200, body: { status: "approved", session: "sess-t", account: { ...ACCOUNT, kind: "trial" } } }];
    expect((await caught(loginByCode({ server: base, file }))).message).toBe("The server gave a trial session, not an account");
    missing = true;
    const e = await caught(loginByCode({ server: base, file }));
    expect([e.message, e.hint]).toEqual([`${base} does not offer sign-in by code`, "Sign in on a computer with a browser: scmjs login"]);
    expect(readSession(file)).toBeNull();
  });

  it("rides out two failed polls, not three", async () => {
    const down = { status: 500, body: { error: { code: "internal", message: "Something broke." } } };
    answers = [down, down, { status: 200, body: { status: "approved", session: "sess-dev", account: ACCOUNT } }];
    expect((await loginByCode({ server: base, file })).account.name).toBe("Ann");
    answers = [down, down, down, pending];
    expect((await caught(loginByCode({ server: base, file }))).message).toBe("Something broke.");
  });

  it("stops at once on Ctrl+C, with nothing kept", async () => {
    answers = [pending];
    const stop = new AbortController();
    const t0 = Date.now();
    setTimeout(() => stop.abort(), 300);
    const e = await caught(loginByCode({ server: base, file, signal: stop.signal }));
    expect([e.message, e.exitCode]).toEqual(["Cancelled; nothing was signed in", 130]);
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(readSession(file)).toBeNull();
  });

  it("is chosen by itself only where no browser can reach this computer", () => {
    const never = () => false;
    expect(noLocalBrowser({ SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22" } as NodeJS.ProcessEnv, "linux", never)).toBe("an SSH session");
    expect(noLocalBrowser({ SSH_TTY: "/dev/pts/1" } as NodeJS.ProcessEnv, "darwin", never)).toBe("an SSH session");
    // ssh -X: a browser opens through the forwarded display, and the loopback page works.
    expect(noLocalBrowser({ SSH_CONNECTION: "x", DISPLAY: "localhost:10.0" } as NodeJS.ProcessEnv, "linux", never)).toBeNull();
    expect(noLocalBrowser({ container: "podman" } as NodeJS.ProcessEnv, "linux", never)).toBe("a container");
    expect(noLocalBrowser({} as NodeJS.ProcessEnv, "linux", () => true)).toBe("a container");
    expect(noLocalBrowser({ WAYLAND_DISPLAY: "wayland-0" } as NodeJS.ProcessEnv, "linux", () => true)).toBeNull();
    expect(noLocalBrowser({} as NodeJS.ProcessEnv, "linux", never)).toBeNull();
    expect(noLocalBrowser({} as NodeJS.ProcessEnv, "win32", () => true)).toBeNull();
  });
});
