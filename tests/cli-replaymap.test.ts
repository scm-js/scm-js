/**
 * `scmjs replay map`: the scenario a replay carries, written out as a map file — an archive like a new map's, a bare
 * `.chk`, or standard output — and opening again as the map it was. The replay here is a stub: `chk` is all the
 * writer reads.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Replay } from "@scm-js/replay";
import { describe, expect, it } from "vitest";
import { mapFileFor, writeReplayMap } from "../cli/src/replaymap";
import { openMapBytes } from "../src/editor/mapFile";
import { scenarioName, serializeScenario } from "../src/formats/chk/scenario";
import { TEST_MAPS_DIR } from "./support/maps";

describe("scmjs replay map", () => {
  const dir = mkdtempSync(join(tmpdir(), "scmjs-replay-map-"));
  const replay = async (): Promise<Replay> => {
    const opened = await openMapBytes(new Uint8Array(readFileSync(join(TEST_MAPS_DIR, "ums.scx"))), "ums.scx");
    return { chk: serializeScenario(opened.scenario) } as unknown as Replay;
  };

  it("names the map after the replay, beside it", () => {
    expect(mapFileFor("/games/one.rep")).toBe(join("/games", "one.scx"));
    expect(mapFileFor("two.REP")).toBe("two.scx");
  });

  it("writes an archive that opens as the map, with the scenario's bytes as they were", async () => {
    const rep = await replay();
    const out = join(dir, "one.scx");
    const r = await writeReplayMap(rep, out);
    expect([r.name, r.width, r.height, r.chkBytes]).toEqual(["Test Scenario", 64, 64, rep.chk.length]);
    expect(r.written).toEqual({ path: out, bytes: readFileSync(out).length });
    const again = await openMapBytes(new Uint8Array(readFileSync(out)), "one.scx");
    expect(scenarioName(again.scenario)).toBe("Test Scenario");
    expect(again.origin?.compression).toBe("pkware");
    expect(again.origin?.encrypted).toBe(true);
  });

  it("a .chk is the bare scenario, and - goes to the stream", async () => {
    const rep = await replay();
    const chk = join(dir, "one.chk");
    await writeReplayMap(rep, chk);
    expect(new Uint8Array(readFileSync(chk))).toEqual(rep.chk);
    const out = new PassThrough();
    const chunks: Buffer[] = [];
    out.on("data", (c: Buffer) => chunks.push(c));
    const r = await writeReplayMap(rep, "-", out);
    expect(r.written.path).toBe("-");
    expect(Buffer.concat(chunks).length).toBe(r.written.bytes);
  });
});
