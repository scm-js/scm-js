/**
 * `scmjs replay share`: one upload with `link=1` to a stand-in of the server, the link printed first, the same bytes
 * again answering "already on your account", the sign-in required, and the picture left out when asked; a moment
 * (`--at`, `--play`) checked against the replay and written into the link; `--no-link` sending no `link`. The replay
 * is a stub: the server parses the header, the command only sends the bytes and reads the length and the players.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Replay } from "@scm-js/replay";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveSession } from "../cli/src/account";
import type { Input } from "../cli/src/files";
import { keepReplay, parseMomentTime, printReplayShare, replayMoment, shareReplay, withMoment } from "../cli/src/replayshare";
import { CliError, visible } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import { serializeScenario } from "../src/formats/chk/scenario";
import { TEST_MAPS_DIR } from "./support/maps";

const body = (req: IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on("data", (d: Buffer) => c.push(d)); req.on("end", () => r(Buffer.concat(c))); });
const VIEW = { id: "r1", fileName: "game.rep", note: "", sizeBytes: 7, uploadedAt: "2026-11-07T00:00:00Z", mapName: "투혼 1.3", mapWidth: 128, mapHeight: 128, players: [{ name: "Question", race: "protoss", team: 1, color: "#0c48cc" }, { name: "Drywater", race: "terran", team: 2, color: "#703014" }], matchup: "PvT", frames: 14482, durationSec: 608, gameTypeName: "Melee", playedAt: "2013-01-12T17:25:06.000Z", format: "legacy", links: [{ token: "tok1" }] };

describe("scmjs replay share", () => {
  let srv: Server, base = "", sessionFile = "";
  const seen: { auth: string | null; fields: Record<string, string>; files: Record<string, number> }[] = [];
  let hashes = new Set<string>();
  beforeAll(async () => {
    srv = createServer(async (req, res) => {
      const raw = await body(req);
      const form = await new Request("http://x", { method: "POST", headers: { "content-type": req.headers["content-type"] ?? "" }, body: raw }).formData();
      const fields: Record<string, string> = {}, files: Record<string, number> = {};
      for (const [k, v] of form.entries()) { if (typeof v === "string") fields[k] = v; else files[k] = v.size; }
      seen.push({ auth: req.headers.authorization ?? null, fields, files });
      if (req.headers.authorization !== "Bearer sess") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: "unauthorized", message: "That session has ended." } })); return; }
      const key = String(files.file);
      const existing = hashes.has(key); hashes.add(key);
      res.writeHead(existing ? 200 : 201, { "content-type": "application/json" });
      res.end(JSON.stringify({ replay: { ...VIEW, sizeBytes: files.file, note: fields.note ?? "" }, storage: { usedBytes: 7, capBytes: 100, maps: 0, revisions: 0, replays: 1 }, link: { token: "tok1" }, ...(existing ? { existing: true } : {}) }));
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(srv.address() as { port: number }).port}`;
    sessionFile = join(mkdtempSync(join(tmpdir(), "scmjs-rs-")), "session.json");
    saveSession({ server: base, session: "sess", name: "Ann", provider: "discord", at: "2026-11-07T00:00:00Z" } as never, sessionFile);
  });
  afterAll(() => { srv.close(); });

  const replay = async (): Promise<Replay> => {
    const opened = await openMapBytes(new Uint8Array(readFileSync(join(TEST_MAPS_DIR, "ums.scx"))), "ums.scx");
    // (slots as a real 1v1 has them: the second player in slot 2; a computer in slot 4)
    const players = [{ slot: 0, type: 2, name: "Question" }, { slot: 2, type: 2, name: "Drywater" }, { slot: 4, type: 1, name: "Drywall" }, { slot: 5, type: 0, name: "" }];
    return { chk: serializeScenario(opened.scenario), header: { frames: 14482 }, players } as unknown as Replay;
  };
  const input = (bytes: Uint8Array, name = "game.rep"): Input => ({ path: name, name, bytes, kind: "replay" });

  it("uploads once with link=1 and prints the link first", async () => {
    const r = await shareReplay(input(new Uint8Array([1, 2, 3, 4, 5, 6, 7])), await replay(), { note: "gg", picture: false }, { server: base, file: sessionFile });
    expect(r.link).toBe(`https://scmjs.dev/replay/tok1?scmjs-server=${encodeURIComponent(base)}`);
    expect(r).not.toHaveProperty("moment");
    expect(r.existing).toBe(false);
    expect(r.replay).toMatchObject({ mapName: "투혼 1.3", matchup: "PvT", players: ["Question", "Drywater"], durationSec: 608, bytes: 7 });
    expect(r.picture).toEqual({ none: "left out with --no-picture" });
    const last = seen.at(-1)!;
    expect(last.auth).toBe("Bearer sess");
    expect(last.fields).toMatchObject({ fileName: "game.rep", note: "gg", link: "1" });
    expect(last.files).toEqual({ file: 7 });
    const lines = printReplayShare(r).map(visible);
    expect(lines[0]).toBe(r.link);
    expect(lines[1]).toBe("투혼 1.3 · PvT · Question vs Drywater · 10:08 · 7 B · stored on your account");
    expect(lines[2]).toContain("No map picture for its card: left out with --no-picture");
  });

  it("the same bytes again are already on the account; a piped replay is named", async () => {
    const r = await shareReplay(input(new Uint8Array([1, 2, 3, 4, 5, 6, 7]), "stdin"), await replay(), { picture: false }, { server: base, file: sessionFile });
    expect(r.existing).toBe(true);
    expect(seen.at(-1)!.fields.fileName).toBe("replay.rep");
    expect(printReplayShare(r).map(visible)[1]).toMatch(/already on your account$/);
  });

  it("writes a moment into the link: a time to watch from, a player to play as, or the person's choice", async () => {
    const rep = await replay();
    const go = (o: Parameters<typeof shareReplay>[2]) => shareReplay(input(new Uint8Array([1, 2, 3, 4, 5, 6, 7])), rep, { picture: false, ...o }, { server: base, file: sessionFile });
    const q = `?scmjs-server=${encodeURIComponent(base)}`;
    const watched = await go({ at: "6:42" });
    expect(watched.link).toBe(`https://scmjs.dev/replay/tok1${q}&t=6:42`);
    expect(watched.moment).toEqual({ t: "6:42", seconds: 402, frame: 9572, play: null });
    expect(visible(printReplayShare(watched)[2])).toMatch(/^Anyone with the link watches it from 6:42 in the editor, without signing in\./);
    const played = await go({ at: "402", play: "drywater" });
    expect(played.link).toBe(`https://scmjs.dev/replay/tok1${q}&t=6:42&play=2`);
    expect(visible(printReplayShare(played)[2])).toMatch(/^Anyone with the link plays on from 6:42 as Drywater on the play page/);
    expect((await go({ play: "0" })).link).toBe(`https://scmjs.dev/replay/tok1${q}&play=0`);
    expect((await go({ play: "drywall" })).moment?.play).toEqual({ slot: 4, name: "Drywall" });
    const chosen = await go({ play: true });
    expect(chosen.link).toBe(`https://scmjs.dev/replay/tok1${q}&play`);
    expect((await go({ at: "1:00", play: true })).link).toBe(`https://scmjs.dev/replay/tok1${q}&t=1:00&play`);
    expect(visible(printReplayShare(chosen)[2])).toMatch(/^Anyone with the link picks a player and plays it from the start/);
    // One upload each time, with the link the replay has.
    expect(seen.slice(-6).every((x) => x.fields.link === "1")).toBe(true);
  });

  it("checks the moment against the replay before anything is sent", async () => {
    const rep = await replay();
    const before = seen.length;
    const refused = async (o: { at?: string; play?: string | boolean }) => {
      try { await shareReplay(input(new Uint8Array(7)), rep, { picture: false, ...o }, { server: base, file: sessionFile }); } catch (e) { if (e instanceof CliError) return [e.message, e.hint, e.exitCode]; throw e; }
      throw new Error("expected a refusal");
    };
    expect(await refused({ at: "10:09" })).toEqual(["--at 10:09 is past the end of game.rep, which is 10:08 long", "A time from 0:00 to 10:08.", 2]);
    expect(await refused({ play: "1" })).toEqual(["--play 1: no player of game.rep is in slot 1", "Its players, by slot: 0 Question, 2 Drywater, 4 Drywall.", 2]);
    expect((await refused({ play: "dr" }))[0]).toBe("--play dr is more than one player of game.rep");
    expect((await refused({ play: "zz" }))[0]).toBe("--play zz is nobody in game.rep");
    expect((await refused({ at: "6:4x" }))[0]).toBe('--at takes m:ss, h:mm:ss or seconds, not "6:4x"');
    expect(seen.length).toBe(before);
    // 10:08 is the last second the game's clock reads.
    expect(replayMoment(rep, { at: "10:08" }, "game.rep")).toMatchObject({ t: "10:08", frame: 14477 });
    expect(replayMoment(rep, {}, "game.rep")).toBeNull();
  });

  it("reads m:ss, h:mm:ss and seconds, and adds the moment after any query the link has", () => {
    expect([parseMomentTime("6:42"), parseMomentTime("1:02:03"), parseMomentTime(" 90 "), parseMomentTime("0:05")]).toEqual([402, 3723, 90, 5]);
    for (const bad of ["6:75", "1:2:3:4", "abc", "6.5", "-1"]) expect(() => parseMomentTime(bad)).toThrow(CliError);
    expect(withMoment("https://scmjs.dev/replay/t", { t: "6:42", seconds: 402, frame: 9572, play: { slot: 2, name: "x" } })).toBe("https://scmjs.dev/replay/t?t=6:42&play=2");
    expect(withMoment("https://scmjs.dev/replay/t", { t: null, seconds: 0, frame: 0, play: "choose" })).toBe("https://scmjs.dev/replay/t?play");
    expect(withMoment("https://scmjs.dev/replay/t", null)).toBe("https://scmjs.dev/replay/t");
  });

  it("--no-link keeps the replay without asking for a link, and takes no moment", async () => {
    const r = await keepReplay(input(new Uint8Array([9, 9, 9])), await replay(), { picture: false }, { server: base, file: sessionFile });
    expect(r.link).toBeNull();
    expect(seen.at(-1)!.fields).not.toHaveProperty("link");
    expect(printReplayShare(r).map(visible)).toEqual(["투혼 1.3 · PvT · Question vs Drywater · 10:08 · 3 B · stored on your account", "Not linked: nothing was made for anyone to open. scmjs replay share gives it a link."]);
    await expect(keepReplay(input(new Uint8Array(3)), await replay(), { at: "1:00" }, { server: base, file: sessionFile })).rejects.toMatchObject({ exitCode: 2 });
    await expect(shareReplay(input(new Uint8Array(3)), await replay(), { link: false }, { server: base, file: sessionFile })).rejects.toMatchObject({ exitCode: 2 });
  });

  it("needs a session, and says the server's refusal in its words", async () => {
    const none = join(mkdtempSync(join(tmpdir(), "scmjs-rs-")), "none.json");
    await expect(shareReplay(input(new Uint8Array(3)), await replay(), { picture: false }, { server: base, file: none })).rejects.toMatchObject({ message: "Sign in first: scmjs login", exitCode: 2 } satisfies Partial<CliError>);
    const stale = join(mkdtempSync(join(tmpdir(), "scmjs-rs-")), "session.json");
    writeFileSync(stale, JSON.stringify({ server: base, session: "old", name: "Ann", provider: "discord", at: "2026-11-07T00:00:00Z" }));
    await expect(shareReplay(input(new Uint8Array(3)), await replay(), { picture: false }, { server: base, file: stale })).rejects.toThrow(/That session has ended/);
  });
});
