import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { ANYWHERE_INDEX } from "../src/formats/chk/sections/objects";
import { PlayerType } from "../src/formats/chk/sections/players";
import { ActionType, ConditionType, SwitchAction, TriggerFlag } from "../src/formats/chk/sections/triggers";
import { START_LOCATION } from "../src/data/units";
import { makeUnit } from "../src/editor/units";
import { newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { issueCounts, triggerIssues, UNIT_LIMIT, validateScenario } from "../src/editor/validate";

function fresh() {
  const scn = createScenario({ width: 64, height: 64, era: 0, name: "v" });
  // Two human slots with start locations, the rest closed: a map with nothing to say.
  scn.playerTypes = scn.playerTypes.map((_, i) => (i < 2 ? PlayerType.Human : PlayerType.Inactive));
  scn.units.push(makeUnit(null, START_LOCATION, 0, 100, 100, 1), makeUnit(null, START_LOCATION, 1, 900, 900, 2));
  return scn;
}
const texts = (scn: ReturnType<typeof fresh>, ctx = {}) => validateScenario(scn, ctx).map((i) => `${i.level}: ${i.text}`);

describe("validateScenario", () => {
  it("is quiet on a sound map, apart from the revision note", () => {
    const issues = validateScenario(fresh());
    expect(issueCounts(issues)).toEqual({ error: 0, warn: 0, info: 1 });
    expect(issues[0].text).toMatch(/Brood War 1.04/);
  });

  it("reports missing required sections by revision", () => {
    // A Brood War map needs only the `x` settings layouts, like Blizzard's own.
    const bw = fresh();
    for (const n of ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"]) bw.dirty.delete(n);
    expect(texts(bw).some((t) => t.startsWith("error: Missing"))).toBe(false);
    bw.dirty.delete("UNIx");
    expect(texts(bw)).toContain("error: Missing UNIx — the game will not load this map.");
    // A hybrid map needs both; an original one only the original layouts.
    const ORIGINAL = ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"];
    const hybrid = fresh();
    hybrid.fileVersion = 63;
    for (const n of ORIGINAL) hybrid.dirty.add(n);
    expect(texts(hybrid).some((t) => t.startsWith("error: Missing"))).toBe(false);
    hybrid.dirty.delete("UPGS");
    hybrid.dirty.delete("PUPx");
    expect(texts(hybrid).some((t) => t.startsWith("error: Missing UPGS, PUPx"))).toBe(true);
    const orig = fresh();
    orig.fileVersion = 59;
    expect(texts(orig).some((t) => t.startsWith("error: Missing UNIS, UPGS, TECS, UPGR, PTEC"))).toBe(true);
    for (const n of ORIGINAL) orig.dirty.add(n);
    for (const n of ["UNIx", "UPGx", "TECx", "PUPx", "PTEx"]) orig.dirty.delete(n);
    expect(texts(orig).some((t) => t.startsWith("error: Missing"))).toBe(false);

    const scn = fresh();
    scn.dirty.delete("MTXM");
    scn.chk.sections = scn.chk.sections.filter((s) => s.name !== "VCOD");
    const out = texts(scn);
    expect(out.some((t) => t.startsWith("error: Missing MTXM, VCOD") || t.startsWith("error: Missing VCOD, MTXM"))).toBe(true);
    expect(validateScenario(scn)[0].target).toEqual({ kind: "dialog", id: "mapRevision" });
  });

  it("checks start locations against the player table", () => {
    const scn = fresh();
    scn.playerTypes[2] = PlayerType.Computer; // no start location
    scn.units.push(makeUnit(null, START_LOCATION, 0, 300, 300, 3)); // a second for player 1
    scn.units.push(makeUnit(null, START_LOCATION, 5, 500, 500, 4)); // an inactive slot
    const out = texts(scn);
    expect(out).toContain("error: No start location for Player 3 (slot is Computer).");
    expect(out).toContain("warn: Player 1 has 2 start locations; the game uses one.");
    expect(out).toContain("warn: Player 6 has a start location but its slot is not playable.");
    const second = validateScenario(scn).find((i) => i.text.includes("2 start locations"));
    expect(second?.target).toEqual({ kind: "unit", index: 2 });
  });

  it("checks units and locations", () => {
    const scn = fresh();
    scn.units.push(makeUnit(null, 0, 0, 64 * 32 + 5, 10, 9));
    scn.locations[ANYWHERE_INDEX] = { ...scn.locations[ANYWHERE_INDEX], right: 100 };
    scn.locations[0] = { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 1, elevationFlags: 0 };
    scn.locations[1] = { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 1, elevationFlags: 0 };
    const out = texts(scn);
    expect(out.some((t) => t.startsWith("error: Terran Marine (Player 1) is outside the map"))).toBe(true);
    expect(out.some((t) => t.startsWith("warn: Location 63 'Anywhere' is not the whole map"))).toBe(true);
    expect(out).toContain("info: Locations 0 and 1 are both named 'v'.");
    const empty = fresh();
    empty.units = [];
    empty.playerTypes = empty.playerTypes.map(() => PlayerType.Inactive);
    expect(texts(empty)).toContain("info: The map has no units.");
    const many = fresh();
    for (let i = 0; i < UNIT_LIMIT + 1; i++) many.units.push(makeUnit(null, 0, 0, 100, 100, 10 + i));
    expect(texts(many).some((t) => t.includes("the game holds at most 1700"))).toBe(true);
  });

  it("checks what triggers refer to", () => {
    const scn = fresh();
    const t = newTrigger();
    const bring = newCondition(ConditionType.Bring);
    bring.location = 5; // slot 4: unused
    const sw = newCondition(ConditionType.Switch);
    sw.resource = 3;
    t.conditions.push(bring, sw);
    const text = newAction(ActionType.DisplayText);
    text.text = 999;
    const wav = newAction(ActionType.PlayWav);
    wav.wav = 2; // the description string, "" → no path
    const set = newAction(ActionType.SetSwitch);
    set.target = 7;
    set.modifier = SwitchAction.Set;
    const clear = newAction(ActionType.SetSwitch);
    clear.target = 3;
    clear.modifier = SwitchAction.Clear;
    t.actions.push(text, wav, set, clear);
    scn.triggers.push(t);
    const off = newTrigger();
    off.flags |= TriggerFlag.Disabled;
    scn.triggers.push(off);
    scn.strings.strings[2] = "staredit\\wav\\boom.wav";
    const out = texts(scn, { extras: new Map([["staredit\\wav\\other.wav", new Uint8Array(1)]]) });
    expect(out).toContain("warn: Trigger 1: Bring uses location 4, which does not exist.");
    expect(out).toContain("error: Trigger 1: Display Text Message refers to string #999, past the end of the table.");
    expect(out).toContain("warn: Trigger 1: Play WAV plays 'staredit\\wav\\boom.wav', which is not in the archive.");
    expect(out).toContain("warn: Switch 4 is tested by a condition but no action ever sets it.");
    expect(out).toContain("info: Trigger 2 is disabled.");
    // Present in the archive: no complaint.
    const ok = texts(scn, { extras: new Map([["StarEdit/Wav/BOOM.wav", new Uint8Array(1)]]) });
    expect(ok.some((x) => x.includes("not in the archive"))).toBe(false);
    const only = triggerIssues(validateScenario(scn, { extras: new Map() }));
    expect(only.every((i) => i.where === "Triggers")).toBe(true);
    expect(only.length).toBe(5);
    expect(only.find((i) => i.text.startsWith("Trigger 2"))?.target).toEqual({ kind: "trigger", index: 1 });
  });

  it("reports ISOM health when given", () => {
    const scn = fresh();
    expect(texts(scn, { isom: { kind: "missing" } }).some((t) => t.includes("no ISOM section"))).toBe(true);
    expect(texts(scn, { isom: { kind: "ready", stale: true, check: { rects: 100, mismatched: 25 } } })).toContain("warn: ISOM disagrees with the tiles on 25% of the map (Tools ▸ Rebuild ISOM from Tiles).");
    expect(texts(scn, { isom: { kind: "ready", stale: false, check: { rects: 100, mismatched: 0 } } }).some((t) => t.includes("ISOM"))).toBe(false);
  });
});
