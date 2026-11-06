/**
 * The `scmjs` command's pieces (cli/src, docs/cli.md): what kind a file is, a map's report and its lines, Check Map's
 * lines, and StarCraft text in a terminal. picocolors may write colour (it does under CI), so lines are compared
 * without it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { kindOf, loadMapInput, type Input } from "../cli/src/files";
import { mapReport, printIssues, printMapInfo } from "../cli/src/map";
import { gameLines, gameText, rows, table, visible } from "../cli/src/ui";
import { TEST_MAPS_DIR } from "./support/maps";

/** The lines as the reader sees them, without colour. */
const plain = (lines: string[]) => lines.map(visible);

const input = (name: string): Input => {
  const bytes = new Uint8Array(readFileSync(join(TEST_MAPS_DIR, name)));
  return { path: join(TEST_MAPS_DIR, name), name, bytes, kind: kindOf(name, bytes) };
};

describe("scmjs: files", () => {
  it("knows a map, a replay and a bot file by their first bytes", () => {
    expect(input("melee.scx").kind).toBe("map");
    expect(kindOf("x.chk", new Uint8Array(8))).toBe("map");
    expect(kindOf("x.scmbot", new TextEncoder().encode("SCMBOT1\n\0\0\0\0"))).toBe("bot");
    expect(kindOf("notes.txt", new TextEncoder().encode("hello"))).toBeNull();
  });
});

describe("scmjs map info", () => {
  it("reports a map as the editor reads it", async () => {
    const i = input("ums.scx");
    const r = mapReport(i, await loadMapInput(i));
    expect(r.name).toBe("Test Scenario");
    expect([r.width, r.height, r.tileset]).toEqual([64, 64, "Badlands"]);
    expect(r.usedSlots).toEqual([0, 1]);
    expect(r.statistics.triggers.count).toBe(3);
    const lines = plain(printMapInfo(r)).join("\n");
    expect(lines).toMatch(/^Test Scenario\n/);
    expect(lines).toMatch(/ {2}Map +64 × 64 · Badlands · Brood War 1\.04/);
    expect(lines).toContain("1  Human     Terran  5 units  start location");
  });
  it("says the check in one line, and lists it worst first", async () => {
    const i = input("ums.scx");
    const r = mapReport(i, await loadMapInput(i));
    expect(plain(printMapInfo(r)).join("\n")).toContain("▲ 1 warning");
    const lines = plain(printIssues(r.issues, true));
    expect(lines[0]).toMatch(/^ {2}▲ Nothing makes Player 1 lose/);
    expect(lines.at(-1)).toMatch(/^ {2}ℹ /);
    expect(plain(printIssues(r.issues, false)).some((l) => l.includes("ℹ"))).toBe(false);
  });
  it("every committed map reads", async () => {
    for (const name of ["melee.scx", "ums.scx", "remastered.scx", "hybrid.scm", "original.scm"]) {
      const i = input(name);
      expect(printMapInfo(mapReport(i, await loadMapInput(i))).length).toBeGreaterThan(5);
    }
  });
});

describe("scmjs: terminal text", () => {
  it("StarCraft text: colour codes taken out where there is no colour, other control bytes dropped", () => {
    expect(gameText("\x03Lost \x04Temple\x13")).toBe("Lost Temple");
    expect(gameText("a\nb\tc")).toBe("a b c");
    expect(gameLines("Players: 2\r\n\r\n\r\n\x06Ice\x01 is nice")).toBe("Players: 2\n\nIce is nice");
  });
  it("rows line up, drop empty values and keep a group's gap", () => {
    expect(plain(rows([["Map", "64 × 64"], ["Built by", null], null, ["Strings", "20"]]))).toEqual(["  Map      64 × 64", "", "  Strings  20"]);
    expect(plain(table([["1", "Human", "Terran"], ["12", "Computer", "Zerg"]]))).toEqual(["    1   Human     Terran", "    12  Computer  Zerg"]);
  });
});
