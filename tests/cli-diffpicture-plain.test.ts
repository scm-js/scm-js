/**
 * `scmjs map diff --picture` on a computer with no copy of StarCraft (a CI runner): the ground drawn in plain greys
 * rather than refused. Its own file, since it stands in for the game files module (this computer may have a copy).
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import type { OpenedMap } from "../src/editor/mapFile";
import type { Input } from "../cli/src/files";
import { CliError, visible } from "../cli/src/ui";

vi.mock("../cli/src/gamefiles", async (actual) => ({
  ...(await actual<typeof import("../cli/src/gamefiles")>()),
  openGameFiles: async (named?: string) => {
    throw named ? new CliError(`${named} is not a copy of StarCraft.`) : new CliError("No copy of StarCraft was found on this computer.");
  },
}));
const { diffPicture, PLAIN_GROUND } = await import("../cli/src/diffpicture");

const opened = (name: string, tiles: (t: Uint16Array) => void): { input: Input; doc: OpenedMap } => {
  const scenario = createScenario({ width: 64, height: 64, era: 4, name: "t" });
  tiles(scenario.tiles);
  return { input: { path: name, name, bytes: new Uint8Array(), kind: "map" }, doc: { scenario, extras: new Map(), fileName: name } as unknown as OpenedMap };
};

describe("map diff --picture without the game", () => {
  it("draws the ground plain and says so; a copy named that is not one is still refused", async () => {
    const x = opened("a.scx", () => {}), y = opened("b.scx", (t) => { t[0] = 0x123; });
    const out = join(mkdtempSync(join(tmpdir(), "scmjs-plain-")), "d.png");
    const { report, lines } = await diffPicture(x, y, { out }, { columns: 80, depth: "none", unicode: true, inline: null });
    expect(report.copy).toBeNull();
    expect(report.picture).toMatchObject({ form: "png", width: 256, height: 256 });
    expect(report.counts.tiles).toBe(1);
    expect([...readFileSync(out).subarray(1, 4)].map((c) => String.fromCharCode(c)).join("")).toBe("PNG");
    expect(lines.map(visible).at(-1)).toContain(`drawn without the game: ${PLAIN_GROUND}`);
    const term = await diffPicture(x, y, {}, { columns: 80, depth: "none", unicode: true, inline: null });
    expect(term.lines.map(visible)[1]).toBe("No copy of StarCraft here, so the ground is plain greys: --starcraft names a copy");
    await expect(diffPicture(x, y, { starcraft: "/nowhere" }, { columns: 80, depth: "none", unicode: true, inline: null })).rejects.toThrow(/is not a copy/);
  });
});
