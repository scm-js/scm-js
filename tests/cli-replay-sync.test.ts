/**
 * `scmjs replay sync` (cli/src/replaysync.ts): the replay folders found where StarCraft keeps them, the first run's
 * start, what the account has already, `LastReplay.rep` taken once a game, files that are not replays or too large,
 * the server's refusals, the state that spares a second read, and `--watch` taking a new game. The server is a fake
 * fetch that keeps replays by their SHA-256 as ai-server does.
 */
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chk, cmds, le16, writeReplay } from "@scm-js/replay/write";
import { describe, expect, it } from "vitest";
import { saveSession } from "../cli/src/account";
import {
  matchupOf, MAX_REPLAY_BYTES, parseSince, printSyncSummary, printSyncUpload, readSyncState, ReplayFolders, syncFolders, syncReplays,
  uploadName, usualReplayFolders, watchReplays, type SyncDeps,
} from "../cli/src/replaysync";
import { CliError, visible } from "../cli/src/ui";

const SERVER = "http://sync.test";
const DAY = 86_400_000;

/** A replay of `name` on `map`: the bytes differ with each. */
function replay(map: string, frames = 14_482, names: [string, string] = ["Ann", "Bob"]): Uint8Array {
  return writeReplay({
    format: "legacy", frames, mapName: map,
    players: [{ index: 0, id: 0, race: 2, name: names[0], team: 1 }, { index: 1, id: 1, race: 1, name: names[1], team: 2 }],
    commands: cmds([[10, 0, 0x1f, ...le16(7)]]), chk: chk(64, 64),
  });
}
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

/** A file with its time set: `ago` ms before `now`. */
function put(path: string, bytes: Uint8Array, at: number): string {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
  utimesSync(path, at / 1000, at / 1000);
  return path;
}

interface Fake { fetchImpl: typeof fetch; kept: Map<string, { fileName: string; link: boolean }>; posts: string[]; capBytes: number; refuse?: (fileName: string) => { code: string; message: string } | null }

/** ai-server's `/v1/replays`, as far as the sync uses it: the list with hashes, an upload kept once by its hash. */
function fakeServer(o: { had?: Uint8Array[]; capBytes?: number; refuse?: Fake["refuse"] } = {}): Fake {
  const fake: Fake = { kept: new Map(), posts: [], capBytes: o.capBytes ?? 100 * 1024 * 1024, refuse: o.refuse, fetchImpl: null as never };
  for (const b of o.had ?? []) fake.kept.set(sha(b), { fileName: "old.rep", link: false });
  let used = 0;
  const storage = () => ({ usedBytes: used, capBytes: fake.capBytes, maps: 0, revisions: 0 });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  fake.fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if ((init?.headers as Record<string, string>)?.authorization !== "Bearer sess") return json(401, { error: { code: "unauthorized", message: "That session has ended." } });
    if (u.pathname === "/v1/replays" && init?.method === "GET") return json(200, { replays: [...fake.kept.keys()].map((h, i) => ({ id: `r${i}`, sha256: h })), storage: storage() });
    if (u.pathname === "/v1/replays" && init?.method === "POST") {
      const form = await new Request("http://x", { method: "POST", body: init.body as FormData }).formData();
      const file = form.get("file") as File;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const fileName = String(form.get("fileName"));
      fake.posts.push(fileName);
      const refused = fake.refuse?.(fileName);
      if (refused) return json(refused.code === "storage_full" ? 413 : 400, { error: refused });
      const h = sha(bytes);
      const existing = fake.kept.has(h);
      if (!existing) {
        if (used + bytes.length > fake.capBytes) return json(413, { error: { code: "storage_full", message: `This replay would take the account past its ${fake.capBytes} bytes of storage. Delete some replays or revisions first.` } });
        used += bytes.length;
        fake.kept.set(h, { fileName, link: form.get("link") === "1" });
      }
      const id = `id-${h.slice(0, 6)}`;
      return json(existing ? 200 : 201, { replay: { id, fileName, links: [] }, storage: storage(), ...(form.get("link") === "1" ? { link: { token: `tok-${h.slice(0, 6)}` } } : {}), ...(existing ? { existing: true } : {}) });
    }
    return json(404, { error: { code: "not_found", message: "Not here." } });
  }) as typeof fetch;
  return fake;
}

/** A session for the fake server and a state file, in a folder of their own. */
function setup(fake: Fake, now: number): { deps: SyncDeps; stateFile: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "scmjs-sync-"));
  const file = join(dir, "session.json");
  saveSession({ server: SERVER, session: "sess", name: "Ann", provider: "discord", savedAt: "2026-11-16T00:00:00Z" }, file);
  const stateFile = join(dir, "replay-sync.json");
  return { dir, stateFile, deps: { server: SERVER, file, stateFile, fetchImpl: fake.fetchImpl, now: () => now, settleMs: 0 } };
}

describe("where the replays are", () => {
  it("finds Remastered's folder under Documents and OneDrive's Documents, from WSL too, and a 1.16.1 install's maps\\replays", () => {
    const root = mkdtempSync(join(tmpdir(), "scmjs-sync-where-"));
    const home = join(root, "home");
    mkdirSync(join(home, "Documents", "StarCraft", "Maps", "Replays", "AutoSave"), { recursive: true });
    const users = join(root, "Users");
    mkdirSync(join(users, "ann", "OneDrive", "Documents", "StarCraft", "Maps", "Replays"), { recursive: true });
    mkdirSync(join(users, "bob", "Documents"), { recursive: true });
    mkdirSync(join(users, "Public", "Documents", "StarCraft", "Maps", "Replays"), { recursive: true });
    const game = join(root, "StarCraft");
    mkdirSync(join(game, "maps", "replays"), { recursive: true });
    const found = usualReplayFolders({ SCMJS_STARCRAFT: game }, "linux", home, users).filter((f) => f.startsWith(root));
    expect(found).toEqual([
      join(home, "Documents", "StarCraft", "Maps", "Replays"),
      join(users, "ann", "OneDrive", "Documents", "StarCraft", "Maps", "Replays"),
      join(game, "maps", "replays"),
    ]);
    const win = usualReplayFolders({ USERPROFILE: join(users, "ann"), OneDrive: join(users, "ann", "OneDrive") }, "win32", home, users).filter((f) => f.startsWith(root));
    expect(win).toEqual([join(users, "ann", "OneDrive", "Documents", "StarCraft", "Maps", "Replays")]);
  });

  it("refuses a named folder that is not one", () => {
    expect(() => syncFolders([join(tmpdir(), "no-such-folder")])).toThrow(CliError);
  });
});

describe("the sync", () => {
  const now = Date.UTC(2026, 10, 16, 12);

  it("leaves what was there at the first sync, takes it when asked, and skips what the account has", async () => {
    const fake = fakeServer({ had: [replay("Had")] });
    const { deps, stateFile } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "AutoSave", "20261010", "180314,(4)Rivalry.rep"), replay("(4)Rivalry"), now - 30 * DAY);
    put(join(folder, "old-had.rep"), replay("Had"), now - 40 * DAY);
    const first = await syncReplays([folder], {}, deps);
    expect(first.firstRun).toBe(true);
    expect(first.uploaded).toEqual([]);
    expect(first.older).toEqual({ count: 2, bytes: expect.any(Number) });
    expect(fake.posts).toEqual([]);
    expect(readSyncState(stateFile).servers[SERVER].since).toBe(new Date(now).toISOString());
    expect(visible(printSyncSummary(first).join("\n"))).toContain("2 replays");

    // A new game after the start goes up; the old ones stay.
    put(join(folder, "AutoSave", "20261116", "121500,(2)Bottleneck.rep"), replay("(2)Bottleneck", 24 * 60 * 5), now + 60_000);
    const second = await syncReplays([folder], {}, { ...deps, now: () => now + 120_000 });
    expect(second.firstRun).toBe(false);
    expect(second.uploaded.map((u) => u.name)).toEqual(["121500,(2)Bottleneck.rep"]);
    expect(second.uploaded[0]).toMatchObject({ mapName: "(2)Bottleneck", matchup: "PvT", players: ["Ann", "Bob"], durationSec: 302, link: null, existing: false });
    expect(visible(printSyncUpload(second.uploaded[0]))).toBe("✔ 121500,(2)Bottleneck.rep · (2)Bottleneck · PvT Ann vs Bob · 5:02 · stored");

    // --all: the old one the account lacks goes up; the one it has is not sent.
    const all = await syncReplays([folder], { all: true }, { ...deps, now: () => now + 180_000 });
    expect(all.uploaded.map((u) => u.name)).toEqual(["180314,(4)Rivalry.rep"]);
    expect(all.already).toBe(2);
    expect(fake.posts).toEqual(["121500,(2)Bottleneck.rep", "180314,(4)Rivalry.rep"]);
  });

  it("asks on the first run, and a yes takes the old replays from then on", async () => {
    const fake = fakeServer();
    const { deps, stateFile } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "a.rep"), replay("A"), now - 3 * DAY);
    let asked = null as { count: number; bytes: number } | null;
    const r = await syncReplays([folder], {}, { ...deps, ask: async (older) => { asked = older; return true; } });
    expect(asked?.count).toBe(1);
    expect(r.uploaded.map((u) => u.name)).toEqual(["a.rep"]);
    expect(readSyncState(stateFile).servers[SERVER].since).toBeNull();
  });

  it("--since and --dry-run: what would go up from that date, nothing sent and nothing kept", async () => {
    const fake = fakeServer();
    const { deps, stateFile } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "week.rep"), replay("Week"), now - 3 * DAY);
    put(join(folder, "month.rep"), replay("Month"), now - 30 * DAY);
    const r = await syncReplays([folder], { since: parseSince("7d", now), dryRun: true }, deps);
    expect(r.uploaded.map((u) => [u.name, u.dryRun])).toEqual([["week.rep", true]]);
    expect(r.older.count).toBe(1);
    expect(fake.posts).toEqual([]);
    expect(() => readFileSync(stateFile)).toThrow();
    expect(visible(printSyncUpload(r.uploaded[0]))).toMatch(/^ℹ week\.rep · Week · .* · would upload$/);
  });

  it("takes each game LastReplay.rep holds once, named after the game, and the AutoSave copy of one is not sent twice", async () => {
    const fake = fakeServer();
    const { deps } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    const game1 = replay("(2)Destination");
    put(join(folder, "AutoSave", "20261116", "121000,(2)Destination.rep"), game1, now + 1000);
    put(join(folder, "LastReplay.rep"), game1, now + 1000);
    await syncReplays([folder], { since: now }, deps);
    expect(fake.posts).toEqual(["121000,(2)Destination.rep"]);
    // The next game is written over it.
    const at = now + 3_600_000;
    put(join(folder, "LastReplay.rep"), replay("(3)Power Bond"), at);
    const r = await syncReplays([folder], {}, { ...deps, now: () => at + 5000 });
    const d = new Date(at), two = (n: number) => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())},(3)Power Bond.rep`;
    expect(r.uploaded.map((u) => u.name)).toEqual([expected]);
    expect(uploadName("/x/Saved game.rep", { header: { mapName: "x" } } as never, at)).toBe("Saved game.rep");
  });

  it("skips what is not a replay and what is larger than the server takes, without reading a file twice", async () => {
    const fake = fakeServer();
    const { deps, stateFile } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "notes.rep"), new TextEncoder().encode("not a replay"), now + 1000);
    put(join(folder, "huge.rep"), new Uint8Array(MAX_REPLAY_BYTES + 1), now + 1000);
    const ok = put(join(folder, "ok.rep"), replay("Ok"), now + 1000);
    const r = await syncReplays([folder], { since: now }, deps);
    expect(r.uploaded.map((u) => u.name)).toEqual(["ok.rep"]);
    expect(r.skipped.map((s) => [s.file.split(/[\\/]/).pop(), s.why]).sort()).toEqual([["huge.rep", "larger than the server takes (8.0 MB)"], ["notes.rep", "not a replay"]]);
    const memo = readSyncState(stateFile).files;
    expect(memo[ok].sha256).toBe(sha(readFileSync(ok)));
    // A second run reads nothing it read before: an unreadable file with the same size and time is known by its memo.
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      chmodSync(ok, 0);
      const again = await syncReplays([folder], { since: now }, deps);
      expect(again.already).toBe(1);
      expect(again.uploaded).toEqual([]);
      chmodSync(ok, 0o644);
    }
  });

  it("stops at the server's refusal when the storage is full, and skips a replay it refuses alone", async () => {
    const fake = fakeServer({ refuse: (name) => (name === "bad.rep" ? { code: "invalid_input", message: "The replay could not be read: The file ends in the middle of a section." } : null) });
    const { deps } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "bad.rep"), replay("Bad"), now + 1000);
    put(join(folder, "one.rep"), replay("One"), now + 2000);
    put(join(folder, "two.rep"), replay("Two"), now + 3000);
    fake.capBytes = readFileSync(join(folder, "one.rep")).length + 10;
    const r = await syncReplays([folder], { since: now }, deps);
    expect(r.uploaded.map((u) => u.name)).toEqual(["one.rep"]);
    expect(r.skipped).toEqual([{ file: join(folder, "bad.rep"), why: "The replay could not be read: The file ends in the middle of a section." }]);
    expect(r.stopped).toMatchObject({ message: expect.stringMatching(/past its .* storage/), hint: expect.stringContaining("My Maps"), exitCode: 1 });
    // The refused one is remembered and not sent again.
    fake.capBytes = 1e9;
    const again = await syncReplays([folder], { since: now }, deps);
    expect(again.uploaded.map((u) => u.name)).toEqual(["two.rep"]);
    expect(fake.posts.filter((p) => p === "bad.rep")).toHaveLength(1);
  });

  it("--link asks for a link for each", async () => {
    const fake = fakeServer();
    const { deps } = setup(fake, now);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-f-"));
    put(join(folder, "one.rep"), replay("One"), now + 1000);
    const r = await syncReplays([folder], { since: now, link: true, picture: false }, deps);
    expect(r.uploaded[0].link).toMatch(/^https:\/\/scmjs\.dev\/replay\/tok-\w+\?scmjs-server=/);
    expect([...fake.kept.values()][0].link).toBe(true);
  });

  it("needs a session for the server", async () => {
    const fake = fakeServer();
    const { deps } = setup(fake, now);
    await expect(syncReplays([mkdtempSync(join(tmpdir(), "scmjs-sync-f-"))], {}, { ...deps, server: "http://other.test" })).rejects.toMatchObject({ message: "Sign in first: scmjs login", exitCode: 2 });
  });

  it("reads --since as a date or days back", () => {
    expect(parseSince("2026-11-01")).toBe(new Date(2026, 10, 1).getTime());
    expect(parseSince("3d", now)).toBe(now - 3 * DAY);
    expect(() => parseSince("last week")).toThrow(CliError);
    expect(matchupOf([{ race: 2, team: 1 }, { race: 1, team: 2 }])).toBe("PvT");
    expect(matchupOf([{ race: 0, team: 0 }, { race: 0, team: 0 }, { race: 5, team: 0 }])).toBe("ZvZv?");
  });
});

describe("--watch", () => {
  it("lists only the folders that changed, and looks again at LastReplay.rep", () => {
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-w-"));
    const t0 = Date.now() - 60_000;
    put(join(folder, "LastReplay.rep"), replay("A"), t0);
    put(join(folder, "AutoSave", "20261116", "a.rep"), replay("A"), t0);
    utimesSync(join(folder, "AutoSave", "20261116"), t0 / 1000, t0 / 1000);
    const scan = new ReplayFolders([folder]);
    expect(scan.all()).toHaveLength(2);
    expect(scan.changed()).toEqual([]);
    put(join(folder, "LastReplay.rep"), replay("B"), t0 + 10_000);
    expect(scan.changed().map((f) => f.path)).toEqual([join(folder, "LastReplay.rep")]);
    put(join(folder, "AutoSave", "20261117", "b.rep"), replay("B"), t0 + 10_000);
    expect(scan.changed().map((f) => f.path)).toEqual([join(folder, "AutoSave", "20261117", "b.rep")]);
    expect(scan.changed()).toEqual([]);
  });

  it("uploads a game saved while it runs, waits for a file still being written, and stops on the signal", async () => {
    const fake = fakeServer();
    const real = Date.now();
    const { deps } = setup(fake, real);
    const folder = mkdtempSync(join(tmpdir(), "scmjs-sync-w-"));
    put(join(folder, "old.rep"), replay("Old"), real - DAY);
    const stop = new AbortController();
    const seen: string[] = [];
    const run = watchReplays([folder], {}, {
      ...deps, now: Date.now, settleMs: 150, intervalMs: 40, signal: stop.signal,
      onUpload: (u) => { seen.push(u.name); stop.abort(); },
      onWatching: () => { put(join(folder, "AutoSave", "20261116", "new.rep"), replay("New"), Date.now()); },
    });
    const r = await run;
    expect(seen).toEqual(["new.rep"]);
    expect(r.uploaded.map((u) => u.name)).toEqual(["new.rep"]);
    expect(r.older.count).toBe(1);
    expect(r.stopped).toEqual({ signal: true });
  });
});
