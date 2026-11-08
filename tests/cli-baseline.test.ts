/**
 * `scmjs map check --baseline` and `--write-baseline` (cli/src/baseline.ts, main.ts): a finding's identity, the
 * matching against the known ones, the file, and the command end to end over the committed test maps — a trigger
 * added above the known findings changes none of them, a new finding fails the map, the CI forms list only new ones.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { baselineEntries, findingId, mapKey, matchBaseline, readBaseline, triggerHash, writeBaseline, type BaselineEntry } from "../cli/src/baseline";
import { program } from "../cli/src/main";
import { CliError, visible } from "../cli/src/ui";
import { openMapBytes } from "../src/editor/mapFile";
import type { Issue } from "../src/editor/validate";
import { testMap } from "./support/maps";

const tmp = () => mkdtempSync(join(tmpdir(), "scmjs-baseline-"));
const ums = async () => (await openMapBytes(new Uint8Array(readFileSync(testMap("ums.scx"))), "ums.scx")).scenario;

/** A command run as `scmjs …` would run it: what it printed, and its exit code. */
async function scmjs(...args: string[]): Promise<{ out: string; err: string; code: number }> {
  let out = "", err = "";
  const o = vi.spyOn(process.stdout, "write").mockImplementation((s) => { out += String(s); return true; });
  const e = vi.spyOn(process.stderr, "write").mockImplementation((s) => { err += String(s); return true; });
  process.exitCode = 0;
  try {
    await program.parseAsync(args, { from: "user" });
  } catch (x) {
    if (!(x instanceof CliError)) throw x;
    err += x.message;
    process.exitCode = x.exitCode;
  } finally { o.mockRestore(); e.mockRestore(); }
  const code = Number(process.exitCode ?? 0);
  process.exitCode = 0;
  return { out: visible(out), err: visible(err), code };
}
afterEach(() => { process.exitCode = 0; });

describe("map check --baseline: a finding's identity", () => {
  it("names a trigger by its text, not its place, and leaves counts and examples out", async () => {
    const scn = await ums();
    const hash = triggerHash(scn.triggers[1], scn);
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
    const issue = (text: string, where = "Triggers"): Issue => ({ level: "warn", text, where });
    expect(findingId(issue("Trigger 2: Create Unit uses location 9, which does not exist."), scn)).toBe(`Trigger @${hash}: Create Unit uses location 9, which does not exist.`);
    // The same trigger moved down a place is the same finding.
    const moved = { ...scn, triggers: [scn.triggers[0], scn.triggers[0], scn.triggers[1]] };
    expect(findingId(issue("Trigger 3: Create Unit uses location 9, which does not exist."), moved)).toBe(`Trigger @${hash}: Create Unit uses location 9, which does not exist.`);
    // A number past the list stays a number; a briefing trigger is named the same way.
    expect(findingId(issue("Trigger 40 is disabled."), scn)).toBe("Trigger 40 is disabled.");
    expect(findingId(issue("12 units belong to Player 9, whose slot is not in the game.", "Units"), scn)).toBe("# units belong to Player 9, whose slot is not in the game.");
    expect(findingId(issue("3 strings read as Korean in Remastered (the first: 'ÀÌ'): its letters…", "Strings"), scn)).toBe("# strings read as Korean in Remastered (the first …): its letters…");
    expect(findingId(issue("ISOM is behind the tiles on 12% of the map.", "Terrain"), scn)).toBe("ISOM is behind the tiles on #% of the map.");
    // What names the thing stays: the player, the location, the place a unit stands.
    expect(findingId(issue("Terran Marine (Player 1) at 100, 200 is outside the map.", "Units"), scn)).toBe("Terran Marine (Player 1) at 100, 200 is outside the map.");
  });

  it("matches each known finding to one finding, and counts the known ones that are gone as fixed", async () => {
    const scn = await ums();
    const a: Issue = { level: "warn", text: "Switch 3 is tested by a condition but no action ever sets it.", where: "Triggers" };
    const b: Issue = { level: "warn", text: "Switch 4 is tested by a condition but no action ever sets it.", where: "Triggers" };
    const known: BaselineEntry[] = [...baselineEntries([a, a], scn), { level: "error", where: "Units", text: "gone now" }];
    const m = matchBaseline(known, [a, a, a, b], scn);
    expect(m.suppressed).toEqual([a, a]);
    expect(m.fresh).toEqual([a, b]);
    expect(m.fixed).toEqual([{ level: "error", where: "Units", text: "gone now" }]);
    // The same text in another area is another finding.
    expect(matchBaseline(baselineEntries([a], scn), [{ ...a, where: "Units" }], scn).fresh).toHaveLength(1);
    expect(matchBaseline(undefined, [a], scn).fresh).toEqual([a]);
  });

  it("keeps the maps by their path from the file's folder, the others as they were, in a steady order", async () => {
    const dir = tmp(), file = join(dir, "ci", "known.json");
    expect(mapKey(file, join(dir, "maps", "a.scx"))).toBe("../maps/a.scx");
    expect(mapKey(join(dir, "known.json"), join(dir, "maps", "a.scx"))).toBe("maps/a.scx");
    const scn = await ums();
    const at = join(dir, "known.json");
    const t: Issue = { level: "warn", text: "Trigger 2: something", where: "Triggers" };
    writeBaseline(at, null, { "z.scx": [], "a.scx": baselineEntries([t, { level: "info", text: "A note.", where: "File" }], scn) });
    const first = readBaseline(at);
    expect(Object.keys(first.maps)).toEqual(["a.scx", "z.scx"]);
    // Sorted by area, the trigger's identity kept beside its text.
    expect(first.maps["a.scx"]).toEqual([{ level: "info", where: "File", text: "A note." }, { level: "warn", where: "Triggers", text: "Trigger 2: something", id: `Trigger @${triggerHash(scn.triggers[1], scn)}: something` }]);
    writeBaseline(at, first, { "z.scx": baselineEntries([t], scn) });
    expect(readBaseline(at).maps["a.scx"]).toHaveLength(2);
    expect(readBaseline(at).maps["z.scx"]).toHaveLength(1);
    expect(() => readBaseline(join(dir, "none.json"))).toThrow(/No baseline .*none\.json/);
    writeFileSync(join(dir, "bad.json"), "{ not json");
    expect(() => readBaseline(join(dir, "bad.json"))).toThrow(/is not JSON/);
    writeFileSync(join(dir, "other.json"), JSON.stringify({ name: "x" }));
    expect(() => readBaseline(join(dir, "other.json"))).toThrow(/has no "maps"/);
  });
});

describe("map check --baseline: the command", () => {
  /** ums.scx and original.scm (four warnings between them) in a folder, with the baseline file beside them. */
  function folder() {
    const dir = tmp();
    for (const m of ["ums.scx", "original.scm", "melee.scx"]) copyFileSync(testMap(m), join(dir, m));
    return { dir, maps: ["ums.scx", "original.scm", "melee.scx"].map((m) => join(dir, m)), file: join(dir, ".scmjs-baseline.json") };
  }

  it("writes today's findings, then fails only on new ones; a trigger added above changes none of the known", async () => {
    const { dir, maps, file } = folder();
    expect((await scmjs("map", "check", ...maps, "--strict")).code).toBe(1);
    const w = await scmjs("map", "check", ...maps, "--write-baseline", file);
    expect(w.code).toBe(0);
    expect(w.out).toContain("ums.scx  1 finding in the baseline");
    expect(w.out).toMatch(/✔ 3 findings of 3 maps written to .*\.scmjs-baseline\.json/);
    expect(Object.keys(readBaseline(file).maps)).toEqual(["melee.scx", "original.scm", "ums.scx"]);
    const clean = await scmjs("map", "check", ...maps, "--baseline", file, "--strict");
    expect(clean.code).toBe(0);
    expect(clean.out).toContain("ums.scx  ✔ no new problems · 1 known");
    expect(clean.out).toMatch(/✔ 3 maps checked, none failed · 3 known findings left out/);

    // A trigger at the top that names properties slot 0: one new warning, the old one still known.
    const text = (await scmjs("map", "triggers", "export", maps[0])).out;
    writeFileSync(join(dir, "t.txt"), `Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\tCreate Unit with Properties("Current Player", "Terran Marine", 1, "Base", 0);\n}\n\n${text}`);
    expect((await scmjs("map", "triggers", "import", maps[0], join(dir, "t.txt"))).code).toBe(0);
    const one = await scmjs("map", "check", ...maps, "--baseline", file, "--strict");
    expect(one.code).toBe(1);
    expect(one.out).toContain("ums.scx  ▲ 1 new warning · 1 known");
    expect(one.out).toContain("Trigger 1: Create Unit with Properties names properties slot 0");
    expect(one.out).toMatch(/✖ 1 map of 3 failed the check · 3 known findings left out/);
    // Without --strict a warning does not fail; the CI forms carry only the new finding.
    expect((await scmjs("map", "check", ...maps, "--baseline", file)).code).toBe(0);
    const gh = await scmjs("map", "check", ...maps, "--baseline", file, "--strict", "--format", "github");
    expect(gh.code).toBe(1);
    expect(gh.out.trim().split("\n")).toEqual([expect.stringMatching(/^::warning file=.*ums\.scx,title=Test Scenario · Triggers::Trigger 1: Create Unit with Properties names properties slot 0/)]);
    const junit = (await scmjs("map", "check", ...maps, "--baseline", file, "--strict", "--format", "junit")).out;
    expect(junit).toContain(`<testsuites name="scmjs map check" tests="3" failures="1">`);
    const json = JSON.parse((await scmjs("map", "check", maps[0], "--baseline", file, "--json")).out);
    expect(json.issues).toHaveLength(1);
    expect(json.baseline).toEqual({ file, suppressed: 1, fixed: 0, new: 1, fixedFindings: [] });

    // Written again: the new one is known from then on, and says what changed.
    const again = await scmjs("map", "check", maps[0], "--write-baseline", file);
    expect(again.out).toContain("ums.scx  2 findings in the baseline (1 new)");
    expect(readBaseline(file).maps["original.scm"]).toHaveLength(2);
    expect((await scmjs("map", "check", ...maps, "--baseline", file, "--strict")).code).toBe(0);
  });

  it("counts the known findings that are gone as fixed, and drops them when written again", async () => {
    const { dir, maps, file } = folder();
    await scmjs("map", "check", ...maps, "--write-baseline", file);
    // A Defeat for Player 1 settles ums.scx's one warning.
    writeFileSync(join(dir, "d.txt"), `Trigger("Player 1"){\nConditions:\n\tNever();\n\nActions:\n\tDefeat();\n}\n`);
    await scmjs("map", "triggers", "import", "--append", maps[0], join(dir, "d.txt"));
    const r = await scmjs("map", "check", maps[0], "--baseline", file);
    expect(r.out).toContain("ums.scx  ✔ no new problems · 1 fixed since the baseline");
    const json = JSON.parse((await scmjs("map", "check", maps[0], "--baseline", file, "--json")).out);
    expect(json.baseline).toMatchObject({ suppressed: 0, fixed: 1, new: 0 });
    expect(json.baseline.fixedFindings[0].text).toMatch(/^Nothing makes Player 1 lose/);
    const w = await scmjs("map", "check", maps[0], "--write-baseline", file);
    expect(w.out).toContain("ums.scx  0 findings in the baseline (1 fixed and dropped)");
    expect(readBaseline(file).maps["ums.scx"]).toEqual([]);
  });

  it("takes a map after --baseline as a map, and refuses what it cannot keep", async () => {
    const { dir, maps, file } = folder();
    // No baseline yet: said, with the line that writes one.
    const none = await scmjs("map", "check", maps[0], "--baseline", file);
    expect(none.code).toBe(2);
    expect(none.err).toMatch(/No baseline .*\.scmjs-baseline\.json/);
    await scmjs("map", "check", ...maps, "--write-baseline", file);
    // `--baseline <map>`: the optional value would read the map as the baseline file; a map is a map, and the file is the default.
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const r = await scmjs("map", "check", "--baseline", "ums.scx", "original.scm", "--strict");
      expect(r.code).toBe(0);
      expect(r.out).toContain("ums.scx  ✔ no new problems · 1 known");
      expect(r.out).toContain("original.scm  ✔ no new problems · 2 known");
      expect(existsSync(join(dir, ".scmjs-baseline.json"))).toBe(true);
    } finally { process.chdir(cwd); }
    expect((await scmjs("map", "check", "-", "--baseline", file)).err).toMatch(/A baseline keeps each map by its path/);
  });
});
