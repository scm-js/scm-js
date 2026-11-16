/**
 * `scmjs share <files…>` against a stand-in of the scmjs.dev server: a map and a replay in one go, each its own link
 * first, the options that fit one kind refused when no file is of it, `--no-link`, `--json`; and `--copy`'s
 * clipboard, with tools that stand in for clip.exe, pbcopy and the rest.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chk, cmds, writeReplay } from "@scm-js/replay/write";
import type { Command } from "commander";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { saveSession } from "../cli/src/account";
import { clipboardTools, copyToClipboard } from "../cli/src/clipboard";
import { buildProgram, run } from "../cli/src/main";
import { checkShareOptions, copyLinks } from "../cli/src/sharefiles";
import { visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";

const body = (req: IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const REPLAY_VIEW = { id: "r1", fileName: "game.rep", note: "", sizeBytes: 1, uploadedAt: "", mapName: "Two", mapWidth: 64, mapHeight: 64, players: [{ name: "Alpha", race: "terran", team: 1, color: "#f00" }, { name: "Beta", race: "zerg", team: 2, color: "#00f" }], matchup: "TvZ", frames: 2000, durationSec: 84, gameTypeName: "Melee", playedAt: null, format: "legacy", links: [] as { token: string }[] };

let srv: Server, base = "", dir = "", sessionFile = "";
const seen: { route: string; fields: Record<string, string> }[] = [];

beforeAll(async () => {
  srv = createServer(async (req, res) => {
    const raw = await body(req);
    const type = req.headers["content-type"] ?? "";
    const fields: Record<string, string> = {};
    if (type.startsWith("multipart/form-data")) for (const [k, v] of (await new Request("http://x", { method: "POST", headers: { "content-type": type }, body: raw }).formData()).entries()) fields[k] = typeof v === "string" ? v : `<${v.size} bytes>`;
    const route = `${req.method} ${new URL(req.url ?? "/", "http://x").pathname}`;
    seen.push({ route, fields });
    const send = (status: number, v: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };
    const head = { number: 1, fileName: "melee.scx", sizeBytes: 1, sha256: "x" };
    const map = { id: "m1", name: "Test Melee", updatedAt: "", revisions: 1, head, history: [head], linkList: [] };
    if (route === "GET /v1/maps") return send(200, { maps: [] });
    if (route === "POST /v1/maps") return send(201, { map, storage: { usedBytes: 1, capBytes: 9, maps: 1, revisions: 1 } });
    if (route === "POST /v1/maps/m1/links") return send(201, { link: { token: "maptoken1234", revision: 1 }, map });
    if (route === "POST /v1/rooms") return send(200, { room: { id: "room1", name: "Test Melee", invite: "invite123456", owner: "Ann", people: 0, maxPeople: 8, createdAt: "" } });
    if (route === "POST /v1/replays") return send(201, { replay: { ...REPLAY_VIEW, links: fields.link ? [{ token: "reptoken1234" }] : [] }, ...(fields.link ? { link: { token: "reptoken1234" } } : {}) });
    send(404, { error: { code: "invalid_input", message: "No such route." } });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
  dir = mkdtempSync(join(tmpdir(), "scmjs-share-files-"));
  sessionFile = join(dir, "session.json");
  saveSession({ server: base, session: "sess", name: "Ann", provider: "discord", savedAt: "" }, sessionFile);
  // Two players a minute and a half long (2,000 frames): Alpha in slot 0, Beta in slot 1.
  writeFileSync(join(dir, "game.rep"), writeReplay({ format: "legacy", frames: 2000, players: [{ index: 0, id: 0, race: 1, name: "Alpha" }, { index: 1, id: 1, race: 0, name: "Beta" }], commands: cmds([]), chk: chk(64, 64) }));
});
afterAll(() => { srv.close(); rmSync(dir, { recursive: true, force: true }); });
afterEach(() => { process.exitCode = 0; vi.unstubAllEnvs(); });

/** `scmjs …` in-process, against the stand-in. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  vi.stubEnv("SCMJS_SERVER", base);
  vi.stubEnv("SCMJS_SESSION", sessionFile);
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    const program = buildProgram();
    const override = (c: Command): void => { c.exitOverride(); c.commands.forEach(override); };
    override(program);
    await run(args, program);
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}

const map = join(TEST_MAPS_DIR, "melee.scx");
const q = () => `?scmjs-server=${encodeURIComponent(base)}`;

describe("scmjs share", () => {
  it("shares a map and a replay, each link the first line of its own, the moment on the replay's", async () => {
    const r = await scmjs("share", map, join(dir, "game.rep"), "--at", "1:02", "--play", "beta", "--no-picture");
    expect(r.code).toBe(0);
    const [mapLines, replayLines] = r.out.trimEnd().split("\n\n").map((b) => b.split("\n"));
    expect(mapLines[0]).toBe(`https://scmjs.dev/editor/map/maptoken1234${q()}`);
    expect(replayLines[0]).toBe(`https://scmjs.dev/replay/reptoken1234${q()}&t=1:02&play=1`);
    expect(replayLines[2]).toMatch(/^Anyone with the link plays on from 1:02 as Beta on the play page/);
    expect(seen.filter((s) => s.route === "POST /v1/replays").at(-1)!.fields.link).toBe("1");
  });

  it("gives a map's options to the maps alone: --edit makes the map's link one to edit together", async () => {
    const r = await scmjs("share", map, join(dir, "game.rep"), "--edit", "--no-picture");
    expect(r.code).toBe(0);
    expect(r.out.split("\n")[0]).toBe(`https://scmjs.dev/editor/share/invite123456${q()}`);
    expect(r.out.split("\n\n")[1].split("\n")[0]).toBe(`https://scmjs.dev/replay/reptoken1234${q()}`);
  });

  it("prints one JSON value for one file, a list for several, with each file's link at the top", async () => {
    const one = JSON.parse((await scmjs("share", join(dir, "game.rep"), "--at", "30", "--no-picture", "--json")).out);
    expect(one).toMatchObject({ kind: "replay", link: `https://scmjs.dev/replay/reptoken1234${q()}&t=0:30`, replay: { moment: { t: "0:30", seconds: 30, frame: 715, play: null } } });
    const from = seen.length;
    const two = JSON.parse((await scmjs("share", map, join(dir, "game.rep"), "--no-link", "--no-picture", "--json")).out);
    expect(two.map((x: { kind: string; link: unknown }) => [x.kind, x.link])).toEqual([["map", null], ["replay", null]]);
    expect(seen.slice(from).map((s) => s.route)).toEqual(["GET /v1/maps", "POST /v1/maps", "POST /v1/replays"]);
    expect(seen.at(-1)!.fields).not.toHaveProperty("link");
  });

  it("refuses an option for the other kind, or for a link with --no-link, before anything is sent", async () => {
    const before = seen.length;
    const cases: [string[], string][] = [
      [["share", map, "--at", "1:00"], "✖ --at is for a replay, and melee.scx is not one"],
      [["share", join(dir, "game.rep"), "--edit"], "✖ --edit is for a map, and game.rep is not one"],
      [["share", map, map, "--play"], "✖ --play is for a replay, and none of these files is one"],
      [["share", map, map, "--name", "x"], "✖ --name names one map, and 2 are given"],
      [["share", join(dir, "game.rep"), "--no-link", "--copy"], "✖ --copy is for a link, and --no-link makes none"],
      [["share", join(dir, "game.rep"), "--at", "2:00"], "✖ --at 2:00 is past the end of game.rep, which is 1:24 long"],
      [["replay", "share", join(dir, "game.rep"), "--play", "7"], "✖ --play 7: no player of game.rep is in slot 7"],
    ];
    for (const [args, said] of cases) {
      const r = await scmjs(...args);
      expect([r.code, r.err.split("\n")[0]], args.join(" ")).toEqual([2, said]);
    }
    expect(seen.length).toBe(before);
  });

  it("takes a file of neither kind as the mistake it is", () => {
    expect(() => checkShareOptions([{ name: "a.scx", kind: "map" }], { link: false, qr: true, edit: true })).toThrow("--edit, --qr are for a link, and --no-link makes none");
    expect(() => checkShareOptions([{ name: "a.scx", kind: "map" }, { name: "b.rep", kind: "replay" }], { at: "1:00", edit: true })).not.toThrow();
  });
});

describe("--copy", () => {
  /** A stand-in tool: a Node script that writes what it is given to a file, or refuses with words on stderr. */
  const tool = (script: string) => ({ command: process.execPath, args: ["-e", script] });

  it("hands the links to the first tool that takes them, one a line", async () => {
    const got = join(dir, "clip.txt");
    const take = tool(`let s="";process.stdin.on("data",d=>s+=d).on("end",()=>require("fs").writeFileSync(${JSON.stringify(got)},s))`);
    const r = await copyLinks(["https://a", null, "https://b"], (text) => copyToClipboard(text, { tools: [{ command: "no-such-clipboard-tool", args: [] }, take] }));
    expect(r).toEqual({ copied: true, tool: process.execPath });
    expect(readFileSync(got, "utf8")).toBe("https://a\nhttps://b");
    expect(await copyLinks([null])).toBeNull();
  });

  it("says why when nothing took them: none there, or the tool's own words", async () => {
    expect(await copyToClipboard("x", { tools: [{ command: "no-such-clipboard-tool", args: [] }] })).toEqual({ copied: false, why: "no clipboard tool here (no-such-clipboard-tool)" });
    const refuses = tool(`process.stdin.resume();process.stdin.on("end",()=>{process.stderr.write("Error: Can't open display\\n");process.exit(1)})`);
    const r = await copyToClipboard("x", { tools: [refuses] });
    expect(r.copied).toBe(false);
    expect(!r.copied && r.why).toMatch(/Can't open display/);
  });

  it("knows each system's tool: clip.exe on Windows and in WSL, pbcopy, wl-copy under Wayland, else xclip or xsel", () => {
    const names = (p: NodeJS.Platform, env: Record<string, string>, wsl = false) => clipboardTools(p, env as NodeJS.ProcessEnv, wsl).map((t) => t.command);
    expect(names("win32", {})).toEqual(["clip.exe"]);
    expect(names("darwin", {})).toEqual(["pbcopy"]);
    expect(names("linux", {})).toEqual(["xclip", "xsel"]);
    expect(names("linux", { WAYLAND_DISPLAY: "wayland-0" })).toEqual(["wl-copy", "xclip", "xsel"]);
    expect(names("linux", {}, true)).toEqual(["clip.exe", "/mnt/c/Windows/System32/clip.exe", "xclip", "xsel"]);
  });
});
