/**
 * `scmjs map test --clips` (cli/src/clips.ts): the stretch of the game a clip shows, its name, one clip per failed
 * scenario through `replay export`'s machinery (stood in for here: it needs a browser, the play page and the game),
 * what happens without a browser or when the first clip cannot be made, and the clip named in the CI forms.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FRAME_MS } from "@scm-js/replay";
import { chk, cmds, writeReplay } from "@scm-js/replay/write";
import { describe, expect, it } from "vitest";
import { clipName, clipsDir, clipsSummary, clipWindow, CLIP_AFTER_MS, CLIP_BEFORE_MS, makeClips } from "../cli/src/clips";
import type { ExportOptions, ExportResult } from "../cli/src/export";
import { program } from "../cli/src/main";
import type { ScenarioResult } from "../cli/src/maptest";
import { githubTestAnnotations, junitTestXml } from "../cli/src/report";
import { CliError, visible } from "../cli/src/ui";

const BEFORE = Math.round(CLIP_BEFORE_MS / FRAME_MS), AFTER = Math.round(CLIP_AFTER_MS / FRAME_MS);

function scenario(name: string, o: Partial<ScenarioResult> = {}): ScenarioResult {
  return {
    name, file: "/maps/ums.tests.json", index: 0, line: 3, ok: false, playing: null, parted: null, updated: [], frame: 600, ended: false, seed: 1,
    results: [{ kind: "switch", what: "switch 1 set", ok: false, actual: "it is clear", value: "clear" }], replay: null, notices: [], steps: [], ms: 1900, ...o,
  };
}

/** A replay of `frames` frames, written where a failed scenario keeps one. */
function replayFile(dir: string, name: string, frames: number): string {
  const path = join(dir, name);
  writeFileSync(path, writeReplay({ format: "legacy", gameType: 10, frames, players: [{ index: 0, id: 0, name: "scmjs", type: 2 }], commands: cmds([]), chk: chk(64, 64) }));
  return path;
}

/** Stands in for exportReplay: notes what it was asked, writes nothing, answers as it would. */
function stub(asked: ExportOptions[], fail?: (n: number) => CliError | null) {
  return async (_input: unknown, _rep: unknown, o: ExportOptions): Promise<ExportResult> => {
    asked.push(o);
    const e = fail?.(asked.length);
    if (e) throw e;
    const pictures = Math.floor(((o.toFrame! - o.fromFrame!) * FRAME_MS * 12.5) / 1000) + 1;
    return { file: o.out!, bytes: 1234567, format: "gif", width: 640, height: 360, fps: 12.5, speed: 1, pictures, from: o.fromFrame!, to: o.toFrame!, seconds: pictures / 12.5, camera: "following scmjs", ms: { load: 1, record: 1, convert: 0, total: 2 }, browser: "chromium", encodedBy: "scmjs" };
  };
}

describe("map test --clips", () => {
  it("shows the eight seconds before the end frame and two after, within the game", () => {
    expect(clipWindow(600, 600)).toEqual({ from: 600 - BEFORE, to: 600 });
    expect(clipWindow(400, 2000)).toEqual({ from: 400 - BEFORE, to: 400 + AFTER });
    expect(clipWindow(100, 2000)).toEqual({ from: 0, to: 100 + AFTER });
    expect(clipWindow(0, 0)).toEqual({ from: 0, to: 1 });
    expect(clipWindow(900, 600)).toEqual({ from: 600 - BEFORE, to: 600 }); // an end past the replay's last frame
  });

  it("names a clip after the tests file and the scenario, in a folder beside the map", () => {
    expect(clipName("/maps/ums.tests.json", "Marine placed, at once!", "gif")).toBe("ums.tests.marine-placed-at-once.gif");
    expect(clipName("bunker.json", "리마스터 테스트", "webm")).toBe("bunker.리마스터-테스트.webm");
    expect(clipsDir("/maps/ums.scx", "ums.scx", true)).toBe("/maps/ums.clips");
    expect(clipsDir("-", "ums.scx", "/out/clips")).toBe("/out/clips");
  });

  it("makes a clip of each failed scenario that kept a replay, and says why the others have none", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-clips-"));
    const asked: ExportOptions[] = [], lines: string[] = [];
    const run = await makeClips([
      scenario("passes", { ok: true, replay: replayFile(dir, "a.rep", 600) }),
      scenario("switch set", { replay: replayFile(dir, "b.rep", 600), frame: 600 }),
      scenario("Switch set!", { replay: replayFile(dir, "c.rep", 2000), frame: 400 }), // the same slug: -2
      scenario("from a bug report", { playing: join(dir, "bug.rep"), replay: null }),
    ], { dir: join(dir, "clips"), kind: "gif", exporter: stub(asked), browserFound: "/usr/bin/chromium", live: (l) => lines.push(visible(l)) });
    expect(asked.map((o) => [o.out, o.fromFrame, o.toFrame])).toEqual([
      [join(dir, "clips", "ums.tests.switch-set.gif"), 600 - BEFORE, 600],
      [join(dir, "clips", "ums.tests.switch-set-2.gif"), 400 - BEFORE, 400 + AFTER],
    ]);
    expect(run.missing).toBeNull();
    expect(run.clips.map((c) => [c.scenario, c.cause])).toEqual([["switch set", "made"], ["Switch set!", "made"], ["from a bug report", "replay"]]);
    expect(lines[0]).toMatch(/^ {2}✔ .*ums\.tests\.switch-set\.gif · 1\.2 MB · 0:08 · 0:17–0:25 of the game$/);
    expect(lines[2]).toBe("  · no clip of from a bug report: it plays bug.rep; scmjs replay export draws that game");
    expect(clipsSummary(run).map(visible)).toEqual([expect.stringMatching(/^ {2}2 clips of the failed scenarios in /)]);
  });

  it("says once when no clip can be made, and leaves the rest untried", async () => {
    const dir = mkdtempSync(join(tmpdir(), "scmjs-clips-"));
    const failed = [scenario("one", { replay: replayFile(dir, "a.rep", 600) }), scenario("two", { replay: replayFile(dir, "b.rep", 600) })];
    const asked: ExportOptions[] = [];
    const none = await makeClips(failed, { dir, kind: "gif", exporter: stub(asked), browserFound: null });
    expect(asked).toEqual([]);
    expect(none.missing).toMatch(/^No clips: no browser to draw them with was found/);
    expect(none.clips.map((c) => c.cause)).toEqual(["computer", "computer"]);
    expect(clipsSummary(none).map(visible)).toEqual([`▲ ${none.missing}`]);
    const old = await makeClips(failed, { dir, kind: "webm", exporter: stub(asked, () => new CliError("The play page at http://x/ cannot record: it is older than replay export.")), browserFound: "chromium" });
    expect(asked).toHaveLength(1);
    expect(old.missing).toBe("No clips: The play page at http://x/ cannot record: it is older than replay export.");
    expect(old.clips.map((c) => c.file)).toEqual([null, null]);
  });

  it("names the clip in the annotation and the JUnit failure, and is an option of map test", () => {
    const report = { map: "ums.scx", name: "ums.scx", cases: [{ name: "switch set", file: "ums.tests.json", line: 3, ok: false, ms: 1900, failures: [{ kind: "switch", what: "switch 1 set", actual: "it is clear" }], replay: "ums.tests/switch-set.rep", clip: "ums.clips/ums.tests.switch-set.gif" }] };
    expect(githubTestAnnotations([report])[0]).toContain("%0Aclip: ums.clips/ums.tests.switch-set.gif");
    expect(junitTestXml([report])).toContain("clip: ums.clips/ums.tests.switch-set.gif</failure>");
    const test = program.commands.find((c) => c.name() === "map")!.commands.find((c) => c.name() === "test")!;
    expect(test.options.map((o) => o.long)).toEqual(expect.arrayContaining(["--clips", "--clips-format"]));
  });
});
