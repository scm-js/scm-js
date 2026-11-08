/**
 * `scmjs mcp`: the map commands as an MCP server, driven here by the SDK's own client over an in-memory transport —
 * the tool list a client sees, a read, a round trip of triggers and strings as text, a change written to another
 * file, a failure that comes back as text the model can act on, and the game tools over a stand-in for the engine's map
 * runner (tests/support/mapRunner.ts; the real one needs the lifted game and a copy of StarCraft, which CI has not got).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { findGameCopy } from "../cli/src/engine";
import { createMcpServer, INSTRUCTIONS, MAX_FRAMES, type McpOptions } from "../cli/src/mcp";
import { classicCopy, stagedEngine } from "./support/mapRunner";
import { TEST_MAPS_DIR } from "./support/maps";

type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

const text = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-mcp-"));

/** Whether a process is still there. */
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
/** `get`'s first answer that is not null, asked every 25 ms for up to five seconds. */
async function until<T>(get: () => T | null): Promise<T> {
  for (let i = 0; i < 200; i++) { const v = get(); if (v !== null) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error("waited five seconds for nothing");
}

/** A server and the SDK's client, linked in memory. */
async function connected(options?: McpOptions) {
  const client = new Client({ name: "test", version: "0" });
  const { server } = createMcpServer(options);
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown>, extra?: Parameters<Client["callTool"]>[2]) => (await client.callTool({ name, arguments: args }, undefined, extra)) as Result;
  return { client, call };
}

describe("scmjs mcp", () => {
  let client: Client, call: Awaited<ReturnType<typeof connected>>["call"];
  let dir: string, ums: string;
  beforeAll(async () => {
    ({ client, call } = await connected());
    dir = tmp();
    ums = join(dir, "ums.scx");
    copyFileSync(join(TEST_MAPS_DIR, "ums.scx"), ums);
  });
  afterAll(async () => { await client.close(); });

  it("lists the tools with what each is for, and says how they fit together", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["doctor", "map_build", "map_check", "map_cost", "map_coverage", "map_diff", "map_dump", "map_find", "map_info", "map_new", "map_preview", "map_resize", "map_run", "map_set", "map_strings_export", "map_strings_import", "map_strings_prune", "map_trace", "map_triggers_export", "map_triggers_import", "replay_info", "replay_map"]);
    for (const t of tools) {
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(60);
      expect((t.inputSchema as { properties?: object }).properties, t.name).toBeDefined();
    }
    expect(tools.find((t) => t.name === "map_info")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "map_set")?.annotations?.destructiveHint).toBe(true);
    for (const name of ["map_trace", "map_cost", "map_coverage", "doctor"]) expect(tools.find((t) => t.name === name)?.annotations?.readOnlyHint, name).toBe(true);
    const trace = tools.find((t) => t.name === "map_trace")!;
    expect(trace.description).toMatch(/copy of StarCraft.*about 25 MB.*doctor/);
    const most = (name: string) => (tools.find((t) => t.name === name)!.inputSchema.properties as Record<string, { maximum?: number }>).frames.maximum;
    expect([most("map_trace"), most("map_cost")]).toEqual([MAX_FRAMES.trace, MAX_FRAMES.cost]);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/map_trace and map_cost .* copy of StarCraft .* doctor says whether/);
  });

  it("reads a map: the info lines without colour, and the report as structured data", async () => {
    const r = await call("map_info", { path: ums });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/^Test Scenario\n/);
    expect(text(r)).toMatch(/ {2}Map +64 × 64 · Badlands · Brood War 1\.04/);
    expect(text(r)).not.toMatch(/\x1b\[/);
    expect(r.structuredContent?.width).toBe(64);
    expect((r.structuredContent?.statistics as { triggers: { count: number } }).triggers.count).toBe(3);
    const dump = await call("map_dump", { path: ums });
    expect(text(dump)).toMatch(/^# ums\.scx — scmjs map dump 1\n/);
    expect(text(dump)).toContain("## Triggers (3)");
  });

  it("checks a map and says whether it failed", async () => {
    const r = await call("map_check", { path: ums });
    expect(text(r)).toMatch(/^ums\.scx  ▲ 1 warning/);
    expect(r.structuredContent?.failed).toBe(false);
    expect((r.structuredContent?.issues as unknown[]).length).toBe(1);
  });

  it("takes triggers out as text and back in, written to another file", async () => {
    const out = join(dir, "more.scx");
    const exported = await call("map_triggers_export", { path: ums });
    expect(exported.structuredContent?.count).toBe(3);
    const first = text(exported).split(/\n(?=Trigger)/)[0];
    const imported = await call("map_triggers_import", { path: ums, text: first, append: true, out });
    expect(imported.isError).toBeFalsy();
    expect(text(imported)).toContain("3 → 4 triggers (1 added)");
    expect(readFileSync(ums)).toEqual(readFileSync(join(TEST_MAPS_DIR, "ums.scx")));
    const after = await call("map_info", { path: out });
    expect((after.structuredContent?.statistics as { triggers: { count: number } }).triggers.count).toBe(4);
    const diff = await call("map_diff", { a: ums, b: out });
    expect(diff.structuredContent?.same).toBe(false);
    expect(text(diff)).toContain("Triggers");
  });

  it("sets strings by number and the header, in place", async () => {
    const strings = await call("map_strings_export", { path: ums });
    // Not the first string: that is the map's name, which the header test below sets.
    const line = text(strings).split("\n").filter((l) => /^\d+\t\S/.test(l))[2];
    const index = line.split("\t")[0];
    const set = await call("map_strings_import", { path: ums, text: `${index}\tChanged by the model` });
    expect(text(set)).toContain("1 strings replaced");
    const header = await call("map_set", { path: ums, name: "Renamed" });
    expect(text(header)).toMatch(/Name: Test Scenario → Renamed\nWritten to /);
    const again = await call("map_strings_export", { path: ums });
    expect(text(again)).toContain(`${index}\tChanged by the model`);
    expect((await call("map_info", { path: ums })).structuredContent?.name).toBe("Renamed");
  });

  it("finds across maps, and makes a new one", async () => {
    const found = await call("map_find", { text: "Marine", paths: [ums, join(TEST_MAPS_DIR, "melee.scx")] });
    expect(text(found)).toMatch(/ums\.scx  \d+ match/);
    const none = await call("map_find", { text: "no such thing anywhere", paths: [ums] });
    expect(text(none)).toContain("Nothing in the map matches");
    const fresh = join(dir, "fresh.scx");
    const made = await call("map_new", { path: fresh, size: "64x64", players: 2 });
    expect(text(made)).toContain("64 × 64");
    expect((await call("map_check", { path: fresh })).structuredContent?.failed).toBe(false);
  });

  it("a failure is a result the model can read, with the hint", async () => {
    const missing = await call("map_info", { path: join(dir, "nowhere.scx") });
    expect(missing.isError).toBe(true);
    expect(text(missing)).toMatch(/^No file .*nowhere\.scx\nCheck the name/);
    const wrong = await call("map_triggers_import", { path: ums, text: "Trigger(\"Player 1\"){\nConditions:\n\tNo such condition();\nActions:\n}" });
    expect(wrong.isError).toBe(true);
    expect(text(wrong)).toMatch(/line \d+/);
    const nothing = await call("map_set", { path: ums });
    expect(nothing.isError).toBe(true);
    expect(text(nothing)).toContain("Nothing to set");
  });

  it("refuses `-`, which is the protocol here, not standard input or output", async () => {
    for (const [name, args] of [["map_info", { path: "-" }], ["map_strings_prune", { path: ums, out: "-" }], ["map_diff", { a: "-", b: ums }], ["map_find", { text: "x", paths: [ums, "-"] }]] as const) {
      const r = await call(name, args);
      expect(r.isError, name).toBe(true);
      expect(text(r), name).toMatch(/^`-` \(standard input or output\) is not a file here/);
    }
  });

  it("doctor says what this computer has, as text and as checks", async () => {
    // newestVersion asks npm; offline it says it could not.
    vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
    try {
      const r = await call("doctor", {});
      expect(r.isError).toBeFalsy();
      expect(text(r)).toMatch(/^scmjs (doctor|\S+ ·).*Node v/);
      expect(text(r)).not.toMatch(/\x1b\[/);
      const checks = r.structuredContent?.checks as { what: string; state: string; detail: string }[];
      expect(checks.map((c) => c.what)).toEqual(expect.arrayContaining(["Node", "StarCraft", "Game engine"]));
      expect(typeof r.structuredContent?.blocked).toBe("boolean");
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("scmjs mcp: map_check with a baseline, map_coverage", () => {
  it("map_check lists only the findings a baseline does not hold", async () => {
    const { client, call } = await connected();
    const dir = tmp(), map = join(dir, "ums.scx"), file = join(dir, "known.json");
    copyFileSync(join(TEST_MAPS_DIR, "ums.scx"), map);
    try {
      expect(text(await call("map_check", { path: map, baseline: file }))).toMatch(/^No baseline .*known\.json/);
      writeFileSync(file, JSON.stringify({ maps: { "ums.scx": [{ level: "warn", where: "Triggers", text: "Nothing makes Player 1 lose: no Defeat, and no Victory or Draw for another player. A scenario does not end when a player's units are gone." }, { level: "warn", where: "Units", text: "Gone since." }] } }));
      const r = await call("map_check", { path: map, baseline: file });
      expect(text(r)).toBe("ums.scx  ✔ no new problems · 1 known, 1 fixed since the baseline");
      expect(r.structuredContent).toMatchObject({ issues: [], failed: false, baseline: { file, suppressed: 1, fixed: 1, new: 0 } });
      expect((await call("map_check", { path: map, baseline: "-" })).isError).toBe(true);
    } finally { await client.close(); }
  });

  it("map_coverage plays the replays and counts the triggers, its lines on standard error", async () => {
    const { client, call } = await connected({ engine: stagedEngine(tmp()).dir });
    const { writeReplay, cmds } = await import("@scm-js/replay/write");
    const { readArchive } = await import("../src/editor/mapFile");
    const map = join(TEST_MAPS_DIR, "ums.scx"), reps = tmp();
    const chk = (await readArchive(new Uint8Array(readFileSync(map)))).chk;
    for (const n of ["a.rep", "parted.rep"]) writeFileSync(join(reps, n), writeReplay({ format: "legacy", gameType: 10, players: [{ index: 0, id: 0, name: n, type: 2 }], commands: cmds([]), chk }));
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await call("map_coverage", { path: map, replays: [reps], starcraft: classicCopy(tmp()) });
      expect(r.isError).toBeFalsy();
      expect(stdout).not.toHaveBeenCalled();
      expect(stderr.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining([expect.stringMatching(/^ums\.scx · 3 triggers · 2 replays to play/)]));
      expect(text(r).split("\n")[0]).toBe("▲ ums.scx: 2 of 3 triggers fired in 2 games; 1 never fired");
      expect(text(r)).toMatch(/1 game parted from the map: parted\.rep at 0:21/);
      const data = r.structuredContent as { games: { name: string }[]; rows: { number: number; fired: number; why?: string }[] };
      expect(data.games).toHaveLength(2);
      expect(data.rows.map((x) => x.fired)).toEqual([49, 2, 0]);
      expect(data.rows[2].why).toMatch(/^Bring \(condition 1\) said no last/);
      expect((await call("map_coverage", { path: map, replays: ["-"] })).isError).toBe(true);
    } finally { stdout.mockRestore(); stderr.mockRestore(); await client.close(); }
  });
});

describe("scmjs mcp: the game tools", () => {
  const ums = join(TEST_MAPS_DIR, "ums.scx");
  let weigh: string;
  beforeAll(() => {
    weigh = join(tmp(), "weigh.mjs");
    writeFileSync(weigh, "export const weigher = () => ({ trigger: () => 0, record: () => 0 });\n");
  });

  it("map_trace runs the map: the command's lines, its --json data, progress to the client and nothing on standard output", async () => {
    const { client, call } = await connected({ engine: stagedEngine(tmp()).dir });
    const copy = classicCopy(tmp());
    const progress: number[] = [];
    const stdout = vi.spyOn(process.stdout, "write");
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await call("map_trace", { path: ums, frames: 1300, seed: 5, starcraft: copy }, { onprogress: (p) => progress.push(p.progress) });
      expect(r.isError).toBeFalsy();
      expect(stdout).not.toHaveBeenCalled();
      // The runner's live lines (the start, a progress line each 600 frames) went to standard error.
      expect(stderr.mock.calls.map((c) => String(c[0]))).toEqual(expect.arrayContaining([expect.stringMatching(/^ums\.scx 64 × 64, badlands · 3 triggers · seed 5/), expect.stringMatching(/frame +600 +19 passes/)]));
      expect(progress).toEqual([600, 1200]);
      const lines = text(r).split("\n");
      expect(lines[0]).toMatch(/^✔ ums\.scx: 3 triggers · 1,300 frames \(0:54 of play\) · 41 passes · 2 fired · 1 never/);
      expect(lines).toContain("  Never fired (1 of 3)");
      expect(text(r)).toMatch(/Bring \(condition 1\) said no last, at frame 1,242/);
      expect(text(r)).not.toMatch(/\x1b\[/);
      const data = r.structuredContent as { file: string; rows: { fired: number }[]; copies: unknown[]; engine: { build: string }; game: { kind: string }; frame: number };
      expect(data.file).toBe("ums.scx");
      expect(data.rows.map((x) => x.fired)).toEqual([41, 1, 0]);
      expect(data.copies).toHaveLength(3);
      expect(data.engine.build).toBe("abcdef123456");
      expect(data.game.kind).toBe("classic");
    } finally { stdout.mockRestore(); stderr.mockRestore(); await client.close(); }
  });

  it("map_cost weighs it, the frame-by-frame series as data", async () => {
    const { client, call } = await connected({ engine: stagedEngine(tmp()).dir, weigh });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const r = await call("map_cost", { path: ums, frames: 310, starcraft: classicCopy(tmp()) });
      expect(r.isError).toBeFalsy();
      expect(text(r)).toMatch(/^✔ ums\.scx: triggers cost 0\.024 ms a frame on average where they ran \(10 of 308 frames\)/);
      expect(text(r)).toContain("Costliest triggers, a frame they ran in");
      const data = r.structuredContent as { averageMs: number; rows: unknown[]; series: { ns: number[]; weighed: boolean } };
      expect(data.averageMs).toBeCloseTo(0.024, 5);
      expect(data.rows).toHaveLength(2);
      expect(data.series.ns).toHaveLength(308);
      expect(data.series.weighed).toBe(true);
    } finally { stderr.mockRestore(); await client.close(); }
  });

  it("a cancelled request stops the game: the runner is killed, and the server goes on answering", async () => {
    const { client, call } = await connected({ engine: stagedEngine(tmp()).dir });
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const slow = join(tmp(), "slow.scx");    // the stand-in starts it and waits to be killed
    copyFileSync(ums, slow);
    try {
      const stop = new AbortController();
      const run = call("map_trace", { path: slow, starcraft: classicCopy(tmp()) }, { signal: stop.signal });
      const pid = await until(() => (existsSync(`${slow}.pid`) ? Number(readFileSync(`${slow}.pid`, "utf8")) : null));
      expect(alive(pid)).toBe(true);
      stop.abort();
      await expect(run).rejects.toThrow();
      // The client gives up at once; the server hears the cancellation and kills the runner.
      expect(await until(() => (alive(pid) ? null : true))).toBe(true);
      const after = await call("map_info", { path: ums });
      expect(after.isError).toBeFalsy();
    } finally { stderr.mockRestore(); await client.close(); }
  });

  it("no copy of the game, no map runner, no weigher, a map the game refused: text the model can act on", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const staged = await connected({ engine: stagedEngine(tmp()).dir });
    const older = await connected({ engine: stagedEngine(tmp(), false).dir });
    try {
      const noCopy = await staged.call("map_trace", { path: ums, starcraft: tmp() });
      expect(noCopy.isError).toBe(true);
      expect(text(noCopy)).toMatch(/is not a copy of StarCraft\.\nA Remastered installation/);
      const noRunner = await older.call("map_trace", { path: ums, starcraft: classicCopy(tmp()) });
      expect(noRunner.isError).toBe(true);
      expect(text(noRunner)).toMatch(/has no map runner\.\nscmjs map trace \(and map cost, rush and test\) needs a play page deployed with one; .* must hold a map-<hash>\.mjs\.$/);
      // The weigher is built beside the command; the source tree has none.
      const noWeigher = await staged.call("map_cost", { path: ums, starcraft: classicCopy(tmp()) });
      expect(noWeigher.isError).toBe(true);
      expect(text(noWeigher)).toContain("The weigher is not beside the command");
      const bad = join(tmp(), "bad.scx");
      copyFileSync(ums, bad);
      const refused = await staged.call("map_trace", { path: bad, starcraft: classicCopy(tmp()) });
      expect(refused.isError).toBe(true);
      expect(text(refused)).toMatch(/^the game did not take this map\n/);
      const tooLong = await staged.call("map_trace", { path: ums, frames: MAX_FRAMES.trace + 1 });
      expect(tooLong.isError).toBe(true);
    } finally { stderr.mockRestore(); await staged.client.close(); await older.client.close(); }
  });
});

const copy = (() => { try { return findGameCopy(process.env.SCMJS_STARCRAFT); } catch { return null; } })();
/** A real replay, where one is at hand (none is committed): a path in SCMJS_TEST_REPLAY, else scm-sim's test replay beside this clone. */
const REPLAY = process.env.SCMJS_TEST_REPLAY ?? join(homedir(), "github", "scm-sim", "data", "replays", "legacy_cp949.rep");

describe("scmjs mcp: the picture and the replay's map", () => {
  it("lists map_preview and replay_map with their annotations", async () => {
    const { client } = await connected();
    const { tools } = await client.listTools();
    expect(tools.find((t) => t.name === "map_preview")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "replay_map")?.annotations?.destructiveHint).toBe(true);
    expect((tools.find((t) => t.name === "map_preview")?.inputSchema as { properties: Record<string, { maximum?: number }> }).properties.scale.maximum).toBe(8);
    await client.close();
  });

  it("map_preview without a copy of the game is a readable failure", async () => {
    const { client, call } = await connected();
    const r = await call("map_preview", { path: join(TEST_MAPS_DIR, "ums.scx"), starcraft: mkdtempSync(join(tmpdir(), "scmjs-no-game-")) });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/StarCraft/);
    const odd = await call("map_preview", { path: join(TEST_MAPS_DIR, "ums.scx"), scale: 3 });
    expect(odd.isError).toBe(true);
    expect(odd.content[0].text).toContain("scale takes 1, 2, 4 or 8");
    await client.close();
  });

  it.skipIf(!copy)("map_preview answers with a PNG of the map and its facts", async () => {
    const { client, call } = await connected();
    const r = await call("map_preview", { path: join(TEST_MAPS_DIR, "ums.scx"), scale: 2 });
    expect(r.isError).toBeFalsy();
    const image = r.content.find((c) => c.type === "image") as { data: string; mimeType: string };
    expect(image.mimeType).toBe("image/png");
    const png = Buffer.from(image.data, "base64");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe(128);
    expect(r.structuredContent?.picture).toMatchObject({ width: 128, height: 128, scale: 2 });
    expect(r.content.find((c) => c.type === "text")?.text).toMatch(/^ums\.scx: 64 × 64, badlands, drawn at 2 px a tile/);
    await client.close();
  });

  it.skipIf(!existsSync(REPLAY))("replay_map writes the replay's map, and refuses a file that is there", async () => {
    const { client, call } = await connected();
    const out = join(mkdtempSync(join(tmpdir(), "scmjs-replay-map-")), "game.scx");
    const r = await call("replay_map", { path: REPLAY, out });
    expect(r.isError).toBeFalsy();
    expect(r.content[0].text).toMatch(/: \d+ × \d+, from legacy_cp949\.rep\nWritten to /);
    expect((await call("map_info", { path: out })).isError).toBeFalsy();
    const again = await call("replay_map", { path: REPLAY, out });
    expect(again.isError).toBe(true);
    expect(again.content[0].text).toContain("is there already");
    await client.close();
  });
});
