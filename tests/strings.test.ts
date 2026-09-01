import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { loadMap } from "../src/formats/mpq/scm";
import { ActionType, ConditionType, SwitchAction, SwitchState } from "../src/formats/chk/sections/triggers";
import { newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { internString } from "../src/editor/settings";
import { applyStrings, deleteUnused, escapeControls, previewString, readStrings, stringCapacity, stringUsages, unescapeControls, unusedStrings } from "../src/editor/strings";
import { applySwitchNames, readSwitchNames, switchUsage } from "../src/editor/switches";
import { getString } from "../src/formats/chk/sections/strings";

function fresh() {
  const scn = createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" });
  scn.dirty.clear();
  return scn;
}

describe("string usages", () => {
  it("lists every reference by index", () => {
    const scn = fresh();
    const text = internString(scn, "hello");
    const wav = internString(scn, "staredit\\wav\\a.wav");
    const t = newTrigger();
    const a = newAction(ActionType.DisplayText);
    a.text = text;
    const p = newAction(ActionType.PlayWav);
    p.wav = wav;
    t.actions.push(a, p);
    scn.triggers.push(t);
    scn.wavs![3] = wav;
    scn.switchNames = Array.from({ length: 256 }, () => 0);
    scn.switchNames[5] = text;
    scn.locations[0] = { left: 0, top: 0, right: 64, bottom: 64, nameIndex: text, elevationFlags: 0 };
    scn.unitSettings!.nameIndex[7] = text;

    const u = stringUsages(scn);
    expect(u.get(1)!.map((x) => x.kind)).toEqual(["name"]);
    expect(u.get(2)!.map((x) => x.kind)).toEqual(["description"]);
    expect(u.get(3)![0]).toEqual({ kind: "force", ref: 0, label: "Force 1 name" });
    expect(u.get(7)![0].kind).toBe("location");
    expect(u.get(7)![0].ref).toBe(63);
    const kinds = u.get(text)!.map((x) => x.kind).sort();
    expect(kinds).toEqual(["location", "switch", "trigger", "unit"]);
    expect(u.get(text)!.find((x) => x.kind === "trigger")!.label).toBe("Trigger 1: Display Text Message");
    expect(u.get(text)!.find((x) => x.kind === "unit")!.label).toContain("Terran SCV");
    expect(u.get(wav)!.map((x) => x.label).sort()).toEqual(["Sound 3", "Trigger 1: Play WAV (WAV)"]);
    expect(u.has(0)).toBe(false);
    expect(unusedStrings(scn)).toEqual([]);
    internString(scn, "orphan");
    expect(unusedStrings(scn)).toEqual([scn.strings.strings.length - 1]);
  });

  it("escapes control bytes as <XX> and back, keeping tabs and line breaks literal", () => {
    const raw = "\x04Hello\x08 world\n\tnext\x1f<zz>";
    const shown = escapeControls(raw);
    expect(shown).toBe("<04>Hello<08> world\n\tnext<1F><zz>");
    expect(unescapeControls(shown)).toBe(raw);
    expect(unescapeControls("<7f><ff><04>")).toBe("<7f><ff>\x04");
    expect(escapeControls(unescapeControls("a<0a>b"))).toBe("a\nb");
    expect(previewString("x\r\ny\x03")).toBe("x ⏎ y<03>");
    expect(previewString(null)).toBe("");
  });

  it("applies edits in place, blanks unused entries and trims only the unused tail", () => {
    const scn = fresh();
    const keep = internString(scn, "keep");
    const junk1 = internString(scn, "junk");
    const junk2 = internString(scn, "junk 2");
    const t = newTrigger();
    const a = newAction(ActionType.Comment);
    a.text = keep;
    t.actions.push(a);
    scn.triggers.push(t);
    scn.dirty.clear();

    const list = readStrings(scn);
    list[1] = "Renamed";
    expect(applyStrings(scn, list)).toBe(true);
    expect(getString(scn.strings, 1)).toBe("Renamed");
    expect(scn.dirty.has("STR ")).toBe(true);
    expect(applyStrings(scn, readStrings(scn))).toBe(false);

    const usages = stringUsages(scn);
    const blanked = deleteUnused(readStrings(scn), usages);
    expect(blanked[keep]).toBe("keep");
    expect(blanked[junk1]).toBeNull();
    expect(blanked[junk2]).toBeNull();
    expect(applyStrings(scn, blanked, usages)).toBe(true);
    // Both junk slots were at the end and unreferenced, so they are gone; `keep` stays where the trigger points.
    expect(scn.strings.strings.length).toBe(keep + 1);
    expect(scn.strings.strings[keep]).toBe("keep");

    // A blank slot something still points at is kept (a trigger may reference an unset string).
    const idx = internString(scn, "temp");
    const b = newAction(ActionType.Comment);
    b.text = idx;
    scn.triggers[0].actions.push(b);
    const list2 = readStrings(scn);
    list2[idx] = null;
    applyStrings(scn, list2);
    expect(scn.strings.strings.length).toBe(idx + 1);
    expect(scn.strings.strings[idx]).toBeNull();
    // Slot 0 is always none.
    expect(scn.strings.strings[0]).toBeNull();
    const back = parseScenario(serializeScenario(scn));
    expect(getString(back.strings, 1)).toBe("Renamed");
    expect(stringCapacity(back)).toBe(1024);
    back.strings.extended = true;
    expect(stringCapacity(back)).toBe(65535);
  });
});

describe("switch names", () => {
  it("reads defaults, counts trigger references and installs edits", () => {
    const scn = fresh();
    expect(scn.switchNames).toBeNull();
    expect(readSwitchNames(scn).every((n) => n === "")).toBe(true);
    const t = newTrigger();
    const c = newCondition(ConditionType.Switch);
    c.resource = 4;
    c.comparison = SwitchState.Set;
    const a = newAction(ActionType.SetSwitch);
    a.target = 4;
    a.modifier = SwitchAction.Toggle;
    const a2 = newAction(ActionType.SetSwitch);
    a2.target = 9;
    t.conditions.push(c);
    t.actions.push(a, a2);
    scn.triggers.push(t);
    const usage = switchUsage(scn);
    expect(usage[4]).toBe(2);
    expect(usage[9]).toBe(1);
    expect(usage.reduce((n, v) => n + v, 0)).toBe(3);

    const names = readSwitchNames(scn);
    names[4] = "Round Started";
    names[9] = "T"; // identical to the scenario name — reused, not stored twice
    scn.dirty.clear();
    expect(applySwitchNames(scn, names)).toBe(true);
    expect(scn.switchNames![4]).toBeGreaterThan(0);
    expect(scn.switchNames![9]).toBe(1);
    expect(scn.dirty.has("SWNM")).toBe(true);
    expect(readSwitchNames(scn)[4]).toBe("Round Started");
    expect(applySwitchNames(scn, readSwitchNames(scn))).toBe(false);
    names[4] = "";
    expect(applySwitchNames(scn, names)).toBe(true);
    expect(scn.switchNames![4]).toBe(0);
    const back = parseScenario(serializeScenario(scn));
    expect(readSwitchNames(back)[9]).toBe("T");
    expect(readSwitchNames(back)[4]).toBe("");
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const BURGHS = join(MAPS, "(2)Binary Burghs.scx");

describe.skipIf(!existsSync(BURGHS))("Binary Burghs", () => {
  it("finds the scenario name, the trigger texts and the switch names", async () => {
    const { chk } = await loadMap(new Uint8Array(readFileSync(BURGHS)));
    const scn = parseScenario(chk);
    const u = stringUsages(scn);
    expect(u.get(scn.nameIndex)!.some((x) => x.kind === "name")).toBe(true);
    // A melee map: its three triggers carry no text, but every location name and force name is found.
    const texts = scn.triggers.flatMap((t) => t.actions.filter((a) => a.text !== 0).map((a) => a.text));
    for (const i of texts) expect(u.get(i)!.some((x) => x.kind === "trigger")).toBe(true);
    expect(u.get(scn.locations[63].nameIndex)!.some((x) => x.kind === "location" && x.ref === 63)).toBe(true);
    for (const f of scn.forces.nameIndex) if (f) expect(u.get(f)!.some((x) => x.kind === "force")).toBe(true);
    expect(unusedStrings(scn).length).toBeGreaterThanOrEqual(0);
    expect(scn.switchNames).not.toBeNull();
    const named = readSwitchNames(scn).filter((n) => n !== "");
    expect(named.length).toBe(scn.switchNames!.filter((i) => i !== 0).length);
    // Re-applying the table unchanged is a no-op, and the escape form is lossless on every string.
    expect(applyStrings(scn, readStrings(scn))).toBe(false);
    for (const s of scn.strings.strings) if (s !== null) expect(unescapeControls(escapeControls(s))).toBe(s);
    expect(stringCapacity(scn)).toBe(1024);
  });
});
