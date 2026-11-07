/**
 * `scmjs replay share`: one upload with `link=1` to a stand-in of the server, the link printed first, the same bytes
 * again answering "already on your account", the sign-in required, and the picture left out when asked. The replay
 * is a stub: the server parses the header, the command only sends the bytes.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Replay } from "@scm-js/replay";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { saveSession } from "../cli/src/account";
import type { Input } from "../cli/src/files";
import { printReplayShare, shareReplay } from "../cli/src/replayshare";
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
    return { chk: serializeScenario(opened.scenario) } as unknown as Replay;
  };
  const input = (bytes: Uint8Array, name = "game.rep"): Input => ({ path: name, name, bytes, kind: "replay" });

  it("uploads once with link=1 and prints the link first", async () => {
    const r = await shareReplay(input(new Uint8Array([1, 2, 3, 4, 5, 6, 7])), await replay(), { note: "gg", picture: false }, { server: base, file: sessionFile });
    expect(r.link).toBe(`https://scmjs.dev/editor/replay/tok1?scmjs-server=${encodeURIComponent(base)}`);
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

  it("needs a session, and says the server's refusal in its words", async () => {
    const none = join(mkdtempSync(join(tmpdir(), "scmjs-rs-")), "none.json");
    await expect(shareReplay(input(new Uint8Array(3)), await replay(), { picture: false }, { server: base, file: none })).rejects.toMatchObject({ message: "Sign in first: scmjs login", exitCode: 2 } satisfies Partial<CliError>);
    const stale = join(mkdtempSync(join(tmpdir(), "scmjs-rs-")), "session.json");
    writeFileSync(stale, JSON.stringify({ server: base, session: "old", name: "Ann", provider: "discord", at: "2026-11-07T00:00:00Z" }));
    await expect(shareReplay(input(new Uint8Array(3)), await replay(), { picture: false }, { server: base, file: stale })).rejects.toThrow(/That session has ended/);
  });
});
