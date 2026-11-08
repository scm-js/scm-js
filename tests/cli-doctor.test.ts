/**
 * `scmjs doctor`'s newer parts: the engine's runners in a fetched build, the ready summary read off the checks, and
 * whether Claude Code has `scmjs mcp` (a temp `~/.claude.json`). The older checks are in tests/cli.test.ts.
 */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctorJson, engineCheck, mcpCheck, MCP_ADD, readiness, readyLines, runnersIn, shortPath, type Check } from "../cli/src/doctor";
import type { RunnerKind } from "../cli/src/engine";
import { columns, visible } from "../cli/src/ui";

const temp = () => mkdtempSync(join(tmpdir(), "scmjs-doctor-"));
/** A cache folder with builds of the engine, each holding the files named, made `age` seconds old. */
function cacheWith(builds: Record<string, { files: string[]; age: number }>): string {
  const cache = temp();
  for (const [build, { files, age }] of Object.entries(builds)) {
    const dir = join(cache, "engine", build);
    mkdirSync(dir, { recursive: true });
    for (const f of ["core.js", "game.js", ...files]) writeFileSync(join(dir, f), "");
    const t = Date.now() / 1000 - age;
    utimesSync(dir, t, t);
  }
  return cache;
}

describe("scmjs doctor: the engine's runners", () => {
  it("knows each runner by the names ensureEngine fetches them under", () => {
    const dir = join(cacheWith({ b: { files: ["run-0a1b.mjs", "replay-2c3d.mjs", "map.cjs", "map-ff.mjs.part", "match-0e.mjs"], age: 0 } }), "engine", "b");
    expect(runnersIn(dir)).toEqual(["bot", "replay", "map", "match"]);
    expect(runnersIn(join(dir, "nothing"))).toEqual([]);
  });

  it("reads the newest build, and says which runners it lacks and what fetches them", () => {
    const cache = cacheWith({ old: { files: ["run-aa.mjs", "replay-bb.mjs", "map-cc.mjs", "match-ff.mjs"], age: 3600 }, new: { files: ["run-dd.mjs", "replay-ee.mjs", "match-11.mjs"], age: 0 } });
    const c = engineCheck(cache, undefined);
    expect(c.state).toBe("warn");
    expect(visible(c.detail)).toBe(`build new (the newest of 2) · ${join(cache, "engine")}`);
    expect(c.engine).toEqual({ dir: join(cache, "engine", "new"), build: "new", runners: ["bot", "replay", "match"] });
    expect(c.note).toBe("Runners for bot run, replay watch and bot ladder; none for map trace|cost in this build.");
    expect(c.fix).toBe("scmjs map trace <map> fetches it once the play page has one");
  });

  it("has nothing to fix when the build holds every runner", () => {
    const c = engineCheck(cacheWith({ b: { files: ["run-1.mjs", "replay-2.mjs", "map-3.mjs", "match-4.mjs"], age: 0 } }), undefined);
    expect(c.state).toBe("ok");
    expect(c.note).toBe("Runners for bot run, replay watch, map trace|cost and bot ladder.");
    const before = engineCheck(cacheWith({ b: { files: ["run-1.mjs", "replay-2.mjs", "map-3.mjs"], age: 0 } }), undefined);
    expect(before.fix).toBe("scmjs bot ladder <bots…> --maps <map> fetches it once the play page has one");
    expect(c.fix).toBeUndefined();
  });

  it("keeps the old wording when nothing is fetched, and looks in a folder SCMJS_PLAY_URL names", () => {
    const empty = engineCheck(temp(), undefined);
    expect(visible(empty.detail)).toBe("not fetched yet");
    expect(empty.engine?.build).toBeNull();
    const staged = temp();
    mkdirSync(join(staged, "abc"));
    writeFileSync(join(staged, "current.json"), JSON.stringify({ build: "abc" }));
    writeFileSync(join(staged, "abc", "run-1.mjs"), "");
    const c = engineCheck(temp(), staged);
    expect(c.engine).toEqual({ dir: join(staged, "abc"), build: "abc", runners: ["bot"] });
    expect(c.state).toBe("warn");
    expect(c.fix).toMatch(/^Stage a replay-<hash>\.mjs there/);
    expect(engineCheck(temp(), "https://example.com/play").engine?.build).toBeNull();
  });
});

describe("scmjs doctor: what is ready", () => {
  const engine = (runners: RunnerKind[], build: string | null = "b"): Check =>
    ({ what: "Game engine", state: "ok", detail: "", engine: { dir: "/x", build, runners } });
  const by = (checks: Check[]) => Object.fromEntries(readiness(checks).map((r) => [r.commands, r.ok ? "ok" : r.lacks]));

  it("reads each group's need off the checks", () => {
    expect(by([
      { what: "Node", state: "ok", detail: "" },
      { what: "TypeScript", state: "ok", detail: "" },
      { what: "Docker", state: "warn", detail: "not found" },
      { what: "StarCraft", state: "ok", detail: "" },
      { what: "Browser", state: "warn", detail: "not found" },
      engine(["bot", "replay"]),
    ])).toEqual({
      "map info|check|…": "ok", "replay info|open": "ok", mcp: "ok", "map build": "ok", "map preview|generate": "ok", "bot new|build": "Docker",
      "bot run": "ok", "replay watch": "ok", "replay export": "Browser", "map trace|cost": "engine runner", "bot ladder": "engine runner",
    });
  });

  it("names the copy of the game before the runner, waits for no engine never fetched, and blocks all on Node", () => {
    const r = by([{ what: "StarCraft", state: "warn", detail: "not found" }, engine([], null)]);
    expect([r["bot run"], r["map trace|cost"], r["bot ladder"], r["map preview|generate"], r["map build"]]).toEqual(["StarCraft", "StarCraft", "StarCraft", "StarCraft", "ok"]);
    expect(by([engine([], null)])["map trace|cost"]).toBe("ok");
    expect(Object.values(by([{ what: "Node", state: "bad", detail: "" }]))).toEqual(Array(11).fill("Node"));
  });

  it("lists only what is not ready, with the one thing it lacks, in 80 columns; the JSON has every group", () => {
    const checks: Check[] = [{ what: "Docker", state: "warn", detail: "not found" }, { what: "TypeScript", state: "warn", detail: "not found" }, engine(["bot"])];
    const lines = readyLines(readiness(checks), checks).map(visible);
    expect(lines).toEqual(["  Not ready", "  ✖ map build       TypeScript not found", "  ✖ bot new|build   Docker not found", "  ✖ replay watch    no runner for it in the fetched engine", "  ✖ map trace|cost  no runner for it in the fetched engine", "  ✖ bot ladder      no runner for it in the fetched engine"]);
    for (const l of lines) expect(columns(l), l).toBeLessThanOrEqual(80);
    expect(readyLines(readiness([engine(["bot", "replay", "map", "match"])])).map(visible)).toEqual(["  ✔ Every command is ready on this computer."]);
    expect(shortPath("/home/me/.cache/scmjs", 30, "/home/me")).toBe("~/.cache/scmjs");
    expect(shortPath("/a/very/long/path/to/somewhere", 12, "/home/me")).toBe("…o/somewhere");
    const j = doctorJson({ checks: [engine(["bot"])], blocked: false });
    expect(j.ready.find((g) => g.commands === "replay watch")).toEqual({ commands: "replay watch", ok: false, lacks: "engine runner" });
    expect(j.checks[0].engine?.runners).toEqual(["bot"]);
  });
});

describe("scmjs doctor: Claude Code", () => {
  const config = (json: unknown) => { const f = join(temp(), ".claude.json"); writeFileSync(f, typeof json === "string" ? json : JSON.stringify(json)); return f; };
  const scmjs = { type: "stdio", command: "npx", args: ["-y", "@scm-js/cli", "mcp"] };

  it("says quietly when there is no Claude Code", () => {
    for (const f of [join(temp(), ".claude.json"), config("{ not json")]) {
      const c = mcpCheck(f, "/maps");
      expect([c.state, visible(c.detail), c.fix]).toEqual(["ok", "Claude Code not found", undefined]);
    }
  });

  it("finds scmjs mcp for every folder, this folder or others, and only that", () => {
    expect(visible(mcpCheck(config({ mcpServers: { maps: scmjs } }), "/maps").detail)).toBe("registered with Claude Code · every folder");
    expect(visible(mcpCheck(config({ projects: { "/maps": { mcpServers: { s: { command: "scmjs", args: ["mcp"] } } } } }), "/maps").detail)).toBe("registered with Claude Code · this folder");
    expect(visible(mcpCheck(config({ projects: { "/maps": { mcpServers: { s: { command: "node", args: ["/src/cli/dist/scmjs.mjs", "mcp"] } } } } }), "/maps").detail)).toContain("this folder");
    const other = mcpCheck(config({ projects: { "/a": { mcpServers: { s: scmjs } }, "/b": { mcpServers: { s: scmjs } } } }), "/maps");
    expect([visible(other.detail), other.fix]).toEqual(["registered with Claude Code · 2 other folders", MCP_ADD]);
    const none = mcpCheck(config({ mcpServers: { other: { command: "npx", args: ["-y", "some-server"] }, half: { command: "scmjs", args: ["info"] } }, projects: { "/maps": null } }), "/maps");
    expect([none.state, none.detail, none.fix]).toEqual(["ok", "not registered", MCP_ADD]);
  });
});
