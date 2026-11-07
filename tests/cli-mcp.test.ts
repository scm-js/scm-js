/**
 * `scmjs mcp`: the map commands as an MCP server, driven here by the SDK's own client over an in-memory transport —
 * the tool list a client sees, a read, a round trip of triggers and strings as text, a change written to another
 * file, and a failure that comes back as text the model can act on.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { copyFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMcpServer, INSTRUCTIONS } from "../cli/src/mcp";
import { TEST_MAPS_DIR } from "./support/maps";

type Result = { content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

describe("scmjs mcp", () => {
  const client = new Client({ name: "test", version: "0" });
  let dir: string, ums: string;
  beforeAll(async () => {
    const { server } = createMcpServer();
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    dir = mkdtempSync(join(tmpdir(), "scmjs-mcp-"));
    ums = join(dir, "ums.scx");
    copyFileSync(join(TEST_MAPS_DIR, "ums.scx"), ums);
  });
  afterAll(async () => { await client.close(); });

  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Result;
  const text = (r: Result) => r.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");

  it("lists the tools with what each is for, and says how they fit together", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["map_build", "map_check", "map_diff", "map_dump", "map_find", "map_info", "map_new", "map_resize", "map_run", "map_set", "map_strings_export", "map_strings_import", "map_strings_prune", "map_triggers_export", "map_triggers_import", "replay_info"]);
    for (const t of tools) {
      expect(t.description?.length ?? 0, t.name).toBeGreaterThan(60);
      expect((t.inputSchema as { properties?: object }).properties, t.name).toBeDefined();
    }
    expect(tools.find((t) => t.name === "map_info")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === "map_set")?.annotations?.destructiveHint).toBe(true);
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
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
});
