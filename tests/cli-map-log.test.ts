/**
 * `scmjs map log` and `map blame` (cli/src/maplog.ts, blame.ts, history.ts): a map's history in git, read from a
 * repository made here in a temporary folder with the committed ums.scx edited across commits by the editor's own
 * functions — so it runs in CI with no game data.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { openMapBytes } from "../src/editor/mapFile";
import { readTriggers } from "../src/editor/triggers";
import { counted, listCounts, mapLog, printLog, unitCounts } from "../cli/src/maplog";
import { blameMap, matchItems, printBlame, splitRange, type BlameRow } from "../cli/src/blame";
import { exportTriggers, importStrings, importTriggers, writeBack } from "../cli/src/exchange";
import { resizeMap, setHeader } from "../cli/src/edit";
import { CliError, visible } from "../cli/src/ui";
import { testMap } from "./support/maps";
import type { UnitRecord } from "../src/formats/chk/sections/objects";

describe("map log's words", () => {
  it("says counts with the noun once", () => {
    expect(counted("trigger", "triggers", [[3, "added"], [1, "changed"], [0, "removed"]])).toBe("3 triggers added, 1 changed");
    expect(counted("trigger", "triggers", [[0, "added"], [1, "removed"]])).toBe("1 trigger removed");
    expect(counted("trigger", "triggers", [[0, "added"]])).toBeNull();
  });

  it("matches lists as map diff does: a moved item is no change, an edit in place is one", () => {
    expect(listCounts(["a", "b", "c"], ["c", "a", "b"])).toEqual({ added: 0, removed: 0, changed: 0, reordered: true });
    expect(listCounts(["a", "b", "c"], ["a", "x", "c"])).toEqual({ added: 0, removed: 0, changed: 1, reordered: false });
    expect(listCounts(["a", "b"], ["a", "b", "x", "y"])).toEqual({ added: 2, removed: 0, changed: 0, reordered: false });
    expect(listCounts(["a", "b", "c"], ["x", "b"])).toEqual({ added: 0, removed: 1, changed: 1, reordered: false });
    expect(listCounts(["a"], ["a"])).toEqual({ added: 0, removed: 0, changed: 0, reordered: false });
  });

  it("tells a unit moved from one changed, added or removed", () => {
    const u = (unitId: number, x: number, hp = 100): UnitRecord => ({ serial: 0, x, y: 32, unitId, relationFlags: 0, validStateFlags: 0, validProperties: 0, owner: 0, hitPointsPercent: hp, shieldPercent: 100, energyPercent: 100, resourceAmount: 0, hangarUnits: 0, stateFlags: 0, unused: 0, relatedSerial: 0 });
    expect(unitCounts([u(0, 32), u(0, 64), u(1, 32), u(2, 32)], [u(0, 96), u(0, 64), u(1, 32, 50), u(3, 32)])).toEqual({ added: 1, removed: 1, moved: 1, changed: 1 });
  });
});

describe("map blame's matching", () => {
  const it_ = (id: string, content = id) => ({ id, content, label: id, text: "" });
  it("pairs each item once, by id and content", () => {
    expect(matchItems([it_("a"), it_("a"), it_("b")], [it_("a"), it_("b")])).toEqual([0, -1, 1]);
    expect(matchItems([it_("1", "x")], [it_("1", "y")])).toEqual([-1]);
  });
  it("reads a range's two ends", () => {
    expect(splitRange("HEAD~3")).toEqual({ from: null, to: "HEAD~3" });
    expect(splitRange("main..HEAD")).toEqual({ from: "main", to: "HEAD" });
    expect(splitRange("v1..")).toEqual({ from: "v1", to: "HEAD" });
    expect(() => splitRange("a...b")).toThrow(CliError);
  });
});

const hasGit = spawnSync("git", ["--version"]).status === 0;
describe.skipIf(!hasGit)("map log and map blame in a repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "scmjs-log-"));
  const file = join(dir, "maps", "ridge.scx");
  const hashes: Record<string, string> = {};
  const git = (...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  };
  let day = 1;
  const commit = (who: string, subject: string) => {
    const date = `2026-11-0${day++}T10:00:00+09:00`;
    spawnSync("git", ["-C", dir, "commit", "-qam", subject], { env: { ...process.env, GIT_AUTHOR_NAME: who, GIT_AUTHOR_EMAIL: `${who}@x`, GIT_COMMITTER_NAME: who, GIT_COMMITTER_EMAIL: `${who}@x`, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
    hashes[subject] = git("rev-parse", "HEAD");
  };
  const edit = async (fn: (doc: Awaited<ReturnType<typeof openMapBytes>>) => void) => {
    const doc = await openMapBytes(new Uint8Array(readFileSync(file)), "ridge.scx");
    fn(doc);
    await writeBack(doc, file, null);
  };
  const triggerText = async () => exportTriggers(await openMapBytes(new Uint8Array(readFileSync(file)), "ridge.scx"), null).text!;
  const SEP = "\n//-----------------------------------------------------------------//\n\n";

  beforeAll(async () => {
    mkdirSync(join(dir, "maps"));
    writeFileSync(file, readFileSync(testMap("ums.scx")));
    git("init", "-q", "-b", "main");
    git("add", "maps/ridge.scx");
    commit("Jeany", "start");
    await edit((doc) => setHeader(doc, { name: "Ridge" }));
    commit("Mina", "name");
    const text = (await triggerText()).replace("At least, 1);", "At least, 4);") + SEP + 'Trigger("Player 2"){\nConditions:\n\tAlways();\n\nActions:\n\tDisplay Text Message(Always Display, "Wave one.");\n}\n';
    await edit((doc) => importTriggers(doc, "t.txt", new TextEncoder().encode(text)));
    commit("Jeany", "triggers");
    await edit((doc) => resizeMap(doc, { width: 96, height: 96, anchor: 4, clampLocations: true }));
    commit("Mina", "resize");
    writeFileSync(join(dir, "notes.txt"), "not the map\n");
    git("add", "notes.txt");
    commit("Jeany", "notes");
    const parts = (await triggerText()).trimEnd().split(SEP);
    [parts[0], parts[1]] = [parts[1], parts[0]];
    await edit((doc) => importTriggers(doc, "t.txt", new TextEncoder().encode(parts.join(SEP) + "\n")));
    commit("Jeany", "reorder");
    // A branch that renames a location's string, merged after a commit on main.
    git("checkout", "-q", "-b", "side");
    await edit((doc) => { importStrings(doc, "s.txt", "12\tRidge top\n"); });
    commit("Ari", "side");
    git("checkout", "-q", "main");
    await edit((doc) => setHeader(doc, { description: "Hold the ridge." }));
    commit("Mina", "description");
    // git cannot merge the binary file on its own (no driver here): the merge is made by hand, main's map with the
    // side's change, as the merge driver would write it.
    spawnSync("git", ["-C", dir, "merge", "-q", "--no-edit", "side"], { encoding: "utf8" });
    git("checkout", "-q", "--ours", "maps/ridge.scx");
    await edit((doc) => { importStrings(doc, "s.txt", "12\tRidge top\n"); });
    git("add", "maps/ridge.scx");
    commit("Jeany", "merge");
  });

  it("logs each commit that touched the map, in the map's terms", async () => {
    const log = await mapLog(file);
    expect(log.path).toBe("maps/ridge.scx");
    const by = Object.fromEntries(log.entries.map((e) => [e.subject, e]));
    expect(log.entries.map((e) => e.subject)).not.toContain("notes");
    expect(by.start.state).toBe("added");
    expect(by.start.changes[0]).toMatch(/^map added: 64 × 64 Badlands, 21 units/);
    expect(by.name.changes).toEqual(["name changed"]);
    expect(by.triggers.changes).toContain("1 trigger added, 1 changed");
    expect(by.resize.changes[0]).toBe("resized 64 × 64 → 96 × 96");
    expect(by.reorder.changes).toEqual(["triggers reordered"]);
    expect(by.description.changes).toEqual(["description changed"]);
    expect(by.side.changes).toEqual(["1 location changed"]);
    expect(by.side.author).toBe("Ari");
    // The merge, against its first parent: the side's change.
    expect(log.entries[0].hash).toBe(hashes.merge);
    expect(log.entries[0].changes).toEqual(["1 location changed"]);
    const text = printLog(log, 100).map(visible).join("\n");
    expect(text).toContain(`${hashes.resize.slice(0, 7)}  2026-11-04 10:00  Mina`);
  });

  it("takes -n and a range", async () => {
    const two = await mapLog(file, { limit: 2 });
    expect(two.entries).toHaveLength(2);
    expect(two.more).toBe(true);
    const range = await mapLog(file, { rev: `${hashes.name}..${hashes.resize}` });
    expect(range.entries.map((e) => e.subject)).toEqual(["resize", "triggers"]);
  });

  it("blames each trigger on the commit that last changed it; a reorder changes none", async () => {
    const b = await blameMap(file, ["triggers"]);
    const rows = b.kinds.triggers!;
    const subject = (r: BlameRow) => r.commit?.subject;
    expect(rows).toHaveLength(4);
    expect(rows.map(subject).sort()).toEqual(["start", "start", "triggers", "triggers"]);
    expect(rows.find((r) => r.text.includes("At least, 4"))!.commit!.author).toBe("Jeany");
    const lines = printBlame(b, 200).map(visible);
    expect(lines[0]).toBe("Triggers (4) · maps/ridge.scx");
    // git blame's columns: hash (author date number) text, all rows the same width up to the text.
    expect(new Set(lines.slice(1).map((l) => l.indexOf(")"))).size).toBe(1);
    expect(lines[1]).toMatch(/^[0-9a-f]{8} \(Jeany 2026-11-0\d 1\) /);
  });

  it("follows a merge to the branch that made the change, and says what is not committed", async () => {
    const before = readFileSync(file);
    try {
      await edit((doc) => { importStrings(doc, "s.txt", "11\tNorth nest\n"); });
      const b = await blameMap(file, ["locations", "settings", "units", "strings"]);
      const loc = (name: string) => b.kinds.locations!.find((r) => r.label === name)!;
      expect(loc("Ridge top").commit!.subject).toBe("side");
      expect(loc("North nest").commit).toBeNull();
      expect(loc("Base").commit!.subject).toBe("resize");
      const set = (label: string) => b.kinds.settings!.find((r) => r.label === label)!.commit!.subject;
      expect(set("Name")).toBe("name");
      expect(set("Description")).toBe("description");
      expect(set("Size")).toBe("resize");
      expect(set("Tileset")).toBe("start");
      expect(b.kinds.units!.every((r) => r.commit!.subject === "resize")).toBe(true);
      expect(printBlame(b, 200).map(visible).some((l) => l.startsWith("00000000 (Not committed yet "))).toBe(true);
      // With --rev the file on disk is not read.
      const at = await blameMap(file, ["locations"], { rev: "HEAD" });
      expect(at.kinds.locations!.find((r) => r.label === "Nest")!.commit!.subject).toBe("resize");
    } finally {
      writeFileSync(file, before);
    }
  });

  it("puts what is older than a range on the range's edge", async () => {
    const b = await blameMap(file, ["settings"], { rev: `${hashes.resize}..${hashes.description}` });
    const name = b.kinds.settings!.find((r) => r.label === "Name")!.commit!;
    expect(name.boundary).toBe(true);
    expect(name.hash).toBe(hashes.resize);
    expect(b.kinds.settings!.find((r) => r.label === "Description")!.commit!.subject).toBe("description");
    expect(printBlame(b, 200).map(visible)[1]).toMatch(/^\^[0-9a-f]{7} \(/);
  });

  it("stops walking when everything is explained", async () => {
    const b = await blameMap(file, ["settings"], { rev: hashes.name });
    expect(b.walked.of).toBe(2);
    const late = await blameMap(file, ["triggers"], { rev: hashes.triggers });
    expect(late.kinds.triggers!.map((r) => r.commit!.subject).sort()).toEqual(["start", "start", "triggers", "triggers"]);
    expect(readTriggers((await openMapBytes(new Uint8Array(readFileSync(file)), "ridge.scx")).scenario)).toHaveLength(4);
  });

  it("says plainly when there is no history", async () => {
    const loose = join(mkdtempSync(join(tmpdir(), "scmjs-loose-")), "loose.scx");
    writeFileSync(loose, readFileSync(testMap("ums.scx")));
    await expect(mapLog(loose)).rejects.toThrow(/not in a git repository/);
    const untracked = join(dir, "maps", "new.scx");
    writeFileSync(untracked, readFileSync(testMap("ums.scx")));
    await expect(mapLog(untracked)).rejects.toThrow(/no history in git: it is not committed/);
    await expect(blameMap(untracked, ["triggers"])).rejects.toThrow(/not committed/);
    await expect(mapLog(join(dir, "maps", "gone.scx"))).rejects.toThrow(/git has no history of maps\/gone\.scx/);
    await expect(mapLog(file, { rev: "no-such-branch" })).rejects.toThrow(/does not know the revision/);
    await expect(mapLog(file, { rev: "--all" })).rejects.toThrow(/is not a revision/);
  });
});
