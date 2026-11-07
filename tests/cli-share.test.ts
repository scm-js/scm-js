/**
 * `scmjs login | logout | account` and `scmjs map share`, against a stand-in of the scmjs.dev server on the loopback
 * address (the routes these commands call, answering as ai-server does). The sign-in page is driven here as the
 * browser would: its script is checked by string, and its posts to the command are made with fetch. The real round —
 * the built command, a local ai-server and Chromium — was run by hand (.claude/internals/cli.md).
 */
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { accountReport, DEFAULT_SERVER, linkTo, login, loginPage, logout, printAccount, readSession, requireSession, saveSession, serverUrl, sessionPath, type SavedSession } from "../cli/src/account";
import { scmjsDevCheck } from "../cli/src/doctor";
import { loadMapInput, readInput, type Input } from "../cli/src/files";
import { parseKeep, printShare, shareFileName, shareMap } from "../cli/src/share";
import { CliError, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";

const bytesOf = (name: string) => new Uint8Array(readFileSync(join(TEST_MAPS_DIR, name)));

/* ── The stand-in server ─────────────────────────────────────────── */

interface Seen { method: string; path: string; auth: string | null; origin: string | null; json?: Record<string, unknown>; form?: Record<string, string | { name: string; bytes: number }> }
interface StoredMap { id: string; name: string; revisions: { number: number; fileName: string; sha256: string; sizeBytes: number }[]; links: { token: string; revision: number | null }[] }

const ACCOUNT = { kind: "account", name: "Ann", role: "free", providers: ["discord"], storage: { usedBytes: 12_000, capBytes: 262_144_000, maps: 2, revisions: 3 } };
let srv: Server;
let base = "";
let seen: Seen[] = [];
let maps: StoredMap[] = [];
let refuseRooms = false;

const body = (req: IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const detail = (m: StoredMap) => {
  const head = m.revisions.at(-1)!;
  return { id: m.id, name: m.name, updatedAt: "", revisions: m.revisions.length, head, history: [...m.revisions].reverse(), linkList: m.links };
};
const sha = async (b: Uint8Array) => Buffer.from(await crypto.subtle.digest("SHA-256", b as BufferSource)).toString("hex");

beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const raw = await body(req);
    const s: Seen = { method: req.method ?? "", path: url.pathname, auth: req.headers.authorization ?? null, origin: req.headers.origin ?? null };
    const type = req.headers["content-type"] ?? "";
    let form: FormData | null = null;
    if (type.startsWith("application/json")) s.json = JSON.parse(raw.toString("utf8"));
    if (type.startsWith("multipart/form-data")) {
      form = await new Request("http://x", { method: "POST", headers: { "content-type": type }, body: raw }).formData();
      s.form = {};
      for (const [k, v] of form.entries()) s.form[k] = typeof v === "string" ? v : { name: v.name, bytes: v.size };
    }
    seen.push(s);
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    const signedIn = s.auth === "Bearer sess-ok";
    const unauthorized = () => send(401, { error: { code: "unauthorized", message: "That session has ended. Sign in again, or start a trial." } });
    const route = `${s.method} ${s.path}`;
    if (route === "POST /v1/auth/start") return send(200, { url: `${base}/provider?state=st-1` });
    if (route === "POST /v1/auth/logout") return send(200, { ok: true });
    if (!signedIn) return unauthorized();
    if (route === "GET /v1/account") return send(200, { account: ACCOUNT, ledger: [] });
    if (route === "GET /v1/rooms/mine") return send(200, { rooms: [{ id: "r1", kind: "kept", name: "Ridge", invite: "inv1234567890123456789012", people: [], createdAt: "", keepDays: 7 }], limit: 5 });
    if (route === "GET /v1/maps") return send(200, { maps: maps.map(detail), storage: ACCOUNT.storage });
    if (route === "POST /v1/maps" || /^POST \/v1\/maps\/[^/]+\/revisions$/.test(route)) {
      const file = form!.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const id = route === "POST /v1/maps" ? `m${maps.length + 1}` : s.path.split("/")[3];
      let m = maps.find((x) => x.id === id);
      if (!m) { m = { id, name: String(form!.get("name") ?? "map"), revisions: [], links: [] }; maps.push(m); }
      m.revisions.push({ number: m.revisions.length + 1, fileName: String(form!.get("fileName")), sha256: await sha(bytes), sizeBytes: bytes.length });
      return send(201, { map: detail(m), storage: ACCOUNT.storage });
    }
    const one = /^\/v1\/maps\/([^/]+)(\/links)?$/.exec(s.path);
    if (one) {
      const m = maps.find((x) => x.id === one[1]);
      if (!m) return send(404, { error: { code: "not_found", message: "There is no map with that id on this account." } });
      if (s.method === "GET" && !one[2]) return send(200, { map: detail(m), storage: ACCOUNT.storage });
      if (s.method === "POST" && one[2]) {
        const link = { token: `tok${m.id}r${s.json?.revision}n${m.links.length + 1}abcdefgh`, revision: (s.json?.revision as number) ?? null };
        m.links.push(link);
        return send(201, { link, map: detail(m) });
      }
    }
    if (route === "POST /v1/rooms") {
      if (refuseRooms) return send(429, { error: { code: "rate_limited", message: "You are sharing 5 maps already, as many as you may. End one of them first.", retryAfterSec: 60 } });
      const kept = s.json && "keepDays" in s.json;
      return send(200, { room: { id: "room1", name: s.json?.name, invite: "invABCDEFGHIJKLMNOPQRSTU", owner: "Ann", people: 0, maxPeople: 8, createdAt: "", ...(kept ? { keepDays: s.json!.keepDays, mapId: s.json!.mapId ?? "m9" } : {}) }, ...(kept ? { storage: ACCOUNT.storage } : {}) });
    }
    send(404, { error: { code: "invalid_input", message: "No such route." } });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
});
afterAll(() => srv.close());

let dir = "";
let file = "";
const signedIn = (over: Partial<SavedSession> = {}) => saveSession({ server: base, session: "sess-ok", name: "Ann", provider: "discord", savedAt: "", ...over }, file);
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "scmjs-share-")); file = join(dir, "config", "scmjs", "session.json"); seen = []; maps = []; refuseRooms = false; });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const caught = async (p: Promise<unknown>): Promise<CliError> => {
  try { await p; } catch (e) { if (e instanceof CliError) return e; throw e; }
  throw new Error("expected a CliError");
};
const input = (name: string): Input => ({ path: join(TEST_MAPS_DIR, name), name, bytes: bytesOf(name), kind: "map" });
const share = async (i: Input, o: Parameters<typeof shareMap>[2] = {}) => shareMap(i, await loadMapInput(i), { picture: false, ...o }, { server: base, file });

/* ── The tests ───────────────────────────────────────────────────── */

describe("the session file", () => {
  it("is SCMJS_SESSION, else the configuration folder of the platform", () => {
    expect(sessionPath({ SCMJS_SESSION: "/x/s.json" } as NodeJS.ProcessEnv)).toBe("/x/s.json");
    expect(sessionPath({ XDG_CONFIG_HOME: "/cfg" } as NodeJS.ProcessEnv, "linux", "/home/a")).toBe(join("/cfg", "scmjs", "session.json"));
    expect(sessionPath({} as NodeJS.ProcessEnv, "darwin", "/home/a")).toBe(join("/home/a", ".config", "scmjs", "session.json"));
    expect(sessionPath({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" } as NodeJS.ProcessEnv, "win32", "C:\\Users\\a")).toBe(join("C:\\Users\\a\\AppData\\Roaming", "scmjs", "session.json"));
    expect(serverUrl({} as NodeJS.ProcessEnv)).toBe(DEFAULT_SERVER);
    expect(serverUrl({ SCMJS_SERVER: "http://127.0.0.1:8787/" } as NodeJS.ProcessEnv)).toBe("http://127.0.0.1:8787");
  });

  it("is written for its owner only and read back; a session is for its own server", async () => {
    signedIn();
    if (process.platform !== "win32") {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(join(dir, "config", "scmjs")).mode & 0o777).toBe(0o700);
    }
    expect(readSession(file)).toMatchObject({ server: base, session: "sess-ok", name: "Ann" });
    expect(requireSession(base, file).session).toBe("sess-ok");
    const other = await caught((async () => requireSession(DEFAULT_SERVER, file))());
    expect([other.message, other.exitCode]).toEqual(["Sign in first: scmjs login", 2]);
    expect(other.hint).toContain(`is for ${base}`);
    writeFileSync(file, "not json");
    expect(readSession(file)).toBeNull();
  });

  it("refuses every account command without one: Sign in first, exit 2, and nothing sent", async () => {
    // Thunks: a promise made early would reject with nobody listening while the one before it is awaited.
    for (const run of [() => share(input("ums.scx")), () => share(input("ums.scx"), { edit: true }), () => accountReport({ server: base, file })]) {
      const e = await caught(run());
      expect([e.message, e.exitCode]).toEqual(["Sign in first: scmjs login", 2]);
    }
    expect(seen).toEqual([]);
  });
});

describe("scmjs login", () => {
  it("serves the page, asks the server for a command-line sign-in back to it, and keeps the session the page hands over", async () => {
    let page = "";
    const said: string[] = [];
    const done = login({
      server: base, file, provider: "Discord",
      say: (p, provider) => said.push(provider),
      open: (url) => { page = url; },
    });
    await expect.poll(() => page).not.toBe("");
    const origin = new URL(page).origin;
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(said).toEqual(["Discord"]);
    // The start: from the command (no Origin), cli, back to the page's own origin.
    expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/auth/start", origin: null, json: { provider: "discord", returnOrigin: origin, cli: true } });

    const html = await (await fetch(page)).text();
    expect(html).toContain(JSON.stringify(`${base}/provider?state=st-1`));
    expect(html).toContain(`server = ${JSON.stringify(base)}`);
    // Only the page itself may hand a session over.
    expect((await fetch(`${page}/session`, { method: "POST", body: JSON.stringify({ session: "sess-ok" }) })).status).toBe(403);
    expect((await fetch(`${page}/session`, { method: "POST", headers: { origin: "http://evil.example" }, body: JSON.stringify({ session: "sess-ok" }) })).status).toBe(403);
    const handed = await fetch(`${page}/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ session: "sess-ok" }) });
    expect(handed.status).toBe(200);
    expect(await handed.json()).toEqual({ name: "Ann" });

    const r = await done;
    expect(r.account.name).toBe("Ann");
    expect(readSession(file)).toMatchObject({ server: base, session: "sess-ok", name: "Ann", provider: "discord" });
    expect(seen.at(-1)).toMatchObject({ path: "/v1/account", auth: "Bearer sess-ok" });
    // The page's server has stopped.
    await expect(fetch(page)).rejects.toThrow();
  });

  it("keeps nothing when the server does not know the session, and tells the page", async () => {
    let page = "";
    const done = login({ server: base, file, open: (url) => { page = url; } });
    const failed = caught(done);
    await expect.poll(() => page).not.toBe("");
    const r = await fetch(`${page}/session`, { method: "POST", headers: { origin: new URL(page).origin }, body: JSON.stringify({ session: "sess-old" }) });
    expect(r.status).toBe(502);
    expect((await r.json()).error).toContain("session has ended");
    expect((await failed).exitCode).toBe(2);
    expect(readSession(file)).toBeNull();
  });

  it("gives up after the time it was given, and refuses a provider scmjs.dev does not have", async () => {
    const e = await caught(login({ server: base, file, open: () => {}, timeoutMs: 150 }));
    expect(e.message).toMatch(/did not finish/);
    expect(e.hint).toContain("BROWSER=none");
    const p = await caught(login({ server: base, file, provider: "github", open: () => {} }));
    expect([p.message, p.exitCode]).toEqual(["github is not a sign-in scmjs.dev offers", 2]);
  });

  it("takes a session only from the server's origin and the popup it opened, and hands it to the command", () => {
    const html = loginPage({ providerUrl: "https://discord.com/oauth2/authorize?x=</script><script>alert(1)", providerName: "Discord", server: "https://api.scmjs.dev", token: "t0k" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
    expect(html).toContain('if (done || e.origin !== server || !win || e.source !== win) return;');
    expect(html).toContain('m.type !== "scmjs-ai-auth" || typeof m.session !== "string"');
    expect(html).toContain('fetch("/" + token + "/session", { method: "POST"');
    expect(html).toContain('open(provider, "scmjs-signin", "width=540,height=720,popup=yes")');
    // The popup keeps its opener (no noopener): the callback page posts to window.opener.
    expect(html).not.toContain("noopener");
    expect(html).toContain('<button id="go" hidden>Sign in with Discord</button>');
  });
});

describe("scmjs logout and scmjs account", () => {
  it("ends the session on the server and deletes the file; a second time there is nothing to do", async () => {
    signedIn();
    const r = await logout({ file });
    expect(r).toMatchObject({ told: true, was: { name: "Ann" } });
    expect(seen.at(-1)).toMatchObject({ path: "/v1/auth/logout", auth: "Bearer sess-ok" });
    expect(readSession(file)).toBeNull();
    expect((await logout({ file })).was).toBeNull();
  });

  it("says who, the storage and the maps being shared, with their links", async () => {
    signedIn({ name: "Old name" });
    const r = await accountReport({ server: base, file });
    expect(r.shared?.rooms).toHaveLength(1);
    // The name as the server has it now goes into the file, for the doctor.
    expect(readSession(file)?.name).toBe("Ann");
    const text = printAccount(r).map(visible).join("\n");
    expect(text).toContain("Ann · signed in to");
    expect(text).toMatch(/Storage +12 KB of 250\.0 MB · 2 maps, 3 revisions/);
    expect(text).toMatch(/Shared +1 of 5 at once/);
    expect(text).toContain(`Ridge  kept open for a week  https://scmjs.dev/editor/share/inv1234567890123456789012?scmjs-server=${encodeURIComponent(base)}`);
    // --qr: the shared map's name, then its link's code.
    const withQr = printAccount(r, undefined, { qr: true }).map(visible);
    expect(withQr.length).toBeGreaterThan(printAccount(r).length + 10);
    expect(withQr[withQr.indexOf("  Ridge") + 1]).toMatch(/^ {2}[█▀▄ ]+$/u);
    signedIn({ session: "sess-old" });
    const e = await caught(accountReport({ server: base, file }));
    expect([e.message, e.hint, e.exitCode]).toEqual(["That session has ended. Sign in again, or start a trial.", "scmjs login signs in again.", 2]);
  });

  it("is a row in the doctor, fine either way", () => {
    expect(scmjsDevCheck(file, base)).toMatchObject({ what: "scmjs.dev", state: "ok", fix: "scmjs login" });
    expect(visible(scmjsDevCheck(file, base).detail)).toBe("not signed in");
    signedIn();
    const c = scmjsDevCheck(file, base);
    expect(c).toMatchObject({ state: "ok", path: file });
    expect(visible(c.detail)).toBe(`signed in as Ann · ${file}`);
    expect(visible(scmjsDevCheck(file, DEFAULT_SERVER).detail)).toBe("not signed in to scmjs.dev");
  });
});

describe("scmjs map share", () => {
  it("links scmjs.dev's editor, and carries a server that is not scmjs.dev's", () => {
    expect(linkTo("map", "abc", DEFAULT_SERVER)).toBe("https://scmjs.dev/editor/map/abc");
    expect(linkTo("share", "inv", "http://127.0.0.1:8787")).toBe("https://scmjs.dev/editor/share/inv?scmjs-server=http%3A%2F%2F127.0.0.1%3A8787");
  });

  it("stores a new map and links its first revision; the same bytes again are linked as they are; changed bytes are a revision", async () => {
    signedIn();
    const first = await share(input("ums.scx"), { note: "first" });
    expect(first).toMatchObject({ kind: "copy", name: "Test Scenario", map: { id: "m1", revision: 1, action: "new map" }, width: 64, height: 64, picture: { none: "left out with --no-picture" } });
    expect(first.link).toBe(`https://scmjs.dev/editor/map/tokm1r1n1abcdefgh?scmjs-server=${encodeURIComponent(base)}`);
    const upload = seen.find((s) => s.path === "/v1/maps" && s.method === "POST")!;
    expect(upload.form).toMatchObject({ fileName: "ums.scx", name: "Test Scenario", note: "first", file: { name: "ums.scx", bytes: bytesOf("ums.scx").length } });
    expect(JSON.parse(upload.form!.meta as string)).toMatchObject({ scenarioName: "Test Scenario", tileset: "badlands", width: 64, height: 64, units: 21, triggers: 3, players: 2, humanPlayers: 1 });
    expect(seen.find((s) => s.path.endsWith("/links"))?.json).toEqual({ revision: 1 });
    expect(visible(printShare(first).join("\n"))).toBe([first.link, "Test Scenario · 64 × 64 · 5.9 KB · revision 1, a new map on your account",
      "Anyone with the link opens a copy in their editor, without signing in. No picture for its card: left out with --no-picture."].join("\n"));

    seen = [];
    const again = await share(input("ums.scx"));
    expect(again.map).toMatchObject({ id: "m1", revision: 1, action: "unchanged" });
    expect(again.link).toBe(first.link);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(["GET /v1/maps", "GET /v1/maps/m1"]);

    const changed: Input = { ...input("melee.scx"), name: "ums.scx" };
    const second = await share(changed);
    expect(second.map).toMatchObject({ id: "m1", revision: 2, action: "new revision" });
    expect(seen.find((s) => s.path === "/v1/maps/m1/revisions")?.form).not.toHaveProperty("name");
    expect(visible(printShare(second)[1])).toContain("revision 2, a new revision of Test Scenario");

    const fresh = await share(input("ums.scx"), { new: true, name: "Copy" });
    expect(fresh.map).toMatchObject({ id: "m2", name: "Copy", revision: 1, action: "new map" });
  });

  it("takes a map from standard input, named after its scenario", async () => {
    signedIn();
    const piped = await readInput("-", Readable.from([bytesOf("melee.scx")]));
    expect(shareFileName(piped, "Test Melee")).toBe("Test Melee.scx");
    expect(shareFileName(input("ums.scx"), "Anything")).toBe("ums.scx");
    expect(shareFileName({ ...piped, name: "stdin.chk" }, 'a/b:"c"')).toBe("a_b__c_.chk");
    const r = await share(piped);
    expect(r).toMatchObject({ name: "Test Melee", file: { name: "Test Melee.scx" }, map: { action: "new map" } });
    expect(seen.find((s) => s.method === "POST" && s.path === "/v1/maps")?.form).toMatchObject({ fileName: "Test Melee.scx" });
  });

  it("opens a room to edit together: until everyone leaves, or kept for a while as a revision of the stored map", async () => {
    signedIn();
    const live = await share(input("ums.scx"), { edit: true });
    expect(live.link).toBe(`https://scmjs.dev/editor/share/invABCDEFGHIJKLMNOPQRSTU?scmjs-server=${encodeURIComponent(base)}`);
    const room = seen.find((s) => s.path === "/v1/rooms")!;
    expect(Object.keys(room.json!).sort()).toEqual(["map", "name"]);
    expect(Buffer.from(room.json!.map as string, "base64")).toEqual(Buffer.from(bytesOf("ums.scx")));
    expect(visible(printShare(live)[1])).toContain("shared for editing, open until everyone has left it");

    await share(input("ums.scx"));
    seen = [];
    const week = await share(input("ums.scx"), { edit: true, keep: "week", note: "together" });
    expect(seen.find((s) => s.path === "/v1/rooms")?.json).toMatchObject({ keepDays: 7, mapId: "m1", fileName: "ums.scx", note: "together", meta: { scenarioName: "Test Scenario" } });
    expect(week.room).toMatchObject({ keepDays: 7, mapId: "m1" });
    expect(visible(printShare(week)[1])).toContain("kept open for a week after its last edit, stored on your account");

    seen = [];
    const forever = await share(input("melee.scx"), { edit: true, keep: "forever" });
    const sent = seen.find((s) => s.path === "/v1/rooms")!.json!;
    expect(sent.keepDays).toBeNull();
    expect(sent).not.toHaveProperty("mapId");
    expect(visible(printShare(forever)[1])).toContain("kept open until you end it, stored on your account");
  });

  it("says the server's refusals in its own words, and refuses a --keep it does not know", async () => {
    signedIn();
    refuseRooms = true;
    const e = await caught(share(input("ums.scx"), { edit: true }));
    expect([e.message, e.exitCode]).toEqual(["You are sharing 5 maps already, as many as you may. End one of them first. Try again in 60 seconds.", 1]);
    expect(parseKeep("month")).toBe(30);
    expect(parseKeep(undefined)).toBeUndefined();
    expect((await caught(share(input("ums.scx"), { edit: true, keep: "year" }))).exitCode).toBe(2);
    expect((await caught(share(input("ums.scx"), { keep: "week" }))).message).toBe("--keep is for --edit");
  });

  it("refuses a --starcraft folder that is not a copy of the game, rather than go without a picture", async () => {
    signedIn();
    const e = await caught(share(input("ums.scx"), { picture: true, starcraft: dir }));
    expect(e.message).toContain("is not a copy of StarCraft");
  });
});
