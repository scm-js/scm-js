import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseChk } from "../src/formats/chk/reader";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { CUWP_SLOTS, CuwpField, CuwpState, CuwpValid, decodeCuwp, decodeCuwpUsed, describeCuwpSlot, encodeCuwp, encodeCuwpUsed, emptyCuwpSlot, UPRP_SIZE } from "../src/formats/chk/sections/cuwp";
import { applyCuwp, cuwpSlotView, cuwpUsage, patchCuwpSlot, readCuwp } from "../src/editor/cuwp";
import { newAction, newTrigger } from "../src/editor/triggers";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { validateScenario } from "../src/editor/validate";
import { scenarioAtom } from "../src/atoms/documentAtoms";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { loadMap } from "../src/formats/mpq/scm";

const FIXTURES = join(__dirname, "..", "fixtures", "maps");
const fixture = (name: string) => join(FIXTURES, name);

function sectionData(bytes: Uint8Array, name: string): Uint8Array | null {
  return parseChk(bytes).sections.find((s) => s.name === name)?.data ?? null;
}

describe("CUWP codec", () => {
  it("round-trips 64 slots of 20 bytes and the 64 used bytes", () => {
    const slots = Array.from({ length: CUWP_SLOTS }, (_, i) => ({
      ...emptyCuwpSlot(),
      validProperties: i & 0x1f, validFields: (i * 3) & 0x3f, hitPointsPercent: i, shieldsPercent: 100 - i, energyPercent: 50,
      resources: i * 1000, hangar: i, stateFlags: i & 0x1f, unused: i,
    }));
    const bytes = encodeCuwp(slots);
    expect(bytes.length).toBe(UPRP_SIZE);
    expect(decodeCuwp(bytes)).toEqual(slots);
    const used = slots.map((_, i) => i % 3 === 0);
    expect(decodeCuwpUsed(encodeCuwpUsed(used))).toEqual(used);
    // A short section pads with empty slots rather than throwing.
    expect(decodeCuwp(bytes.subarray(0, 25)).slice(1)).toEqual(Array.from({ length: CUWP_SLOTS - 1 }, emptyCuwpSlot));
  });

  it("describes what a slot sets", () => {
    const slot = patchCuwpSlot(emptyCuwpSlot(), { hitPointsPercent: 50, cloaked: true, invincible: false, resources: 750 });
    expect(slot.validFields).toBe(CuwpField.HitPoints | CuwpField.Resources);
    expect(slot.validProperties).toBe(CuwpValid.Cloak | CuwpValid.Invincible);
    expect(slot.stateFlags).toBe(CuwpState.Cloaked);
    expect(describeCuwpSlot(slot)).toBe("HP 50%, 750 resources, cloaked, not invincible");
    expect(describeCuwpSlot(patchCuwpSlot(slot, { hitPointsPercent: null, resources: null, cloaked: null, invincible: null }))).toBe("nothing set");
    expect(patchCuwpSlot(emptyCuwpSlot(), { hitPointsPercent: 300, hangar: -4 })).toMatchObject({ hitPointsPercent: 100, hangar: 0 });
  });
});

describe("CUWP in the scenario", () => {
  it("a new map carries empty modelled slots and writes both sections", () => {
    const scn = createScenario({ width: 8, height: 8, era: 0, name: "cuwp" });
    expect(scn.cuwp).toHaveLength(CUWP_SLOTS);
    expect(scn.cuwpUsed).toHaveLength(CUWP_SLOTS);
    const out = serializeScenario(scn);
    expect(sectionData(out, "UPRP")!.length).toBe(UPRP_SIZE);
    expect(sectionData(out, "UPUS")!.every((b) => b === 0)).toBe(true);
    const back = parseScenario(out);
    expect(back.cuwp).toEqual(scn.cuwp);
  });

  it("applyCuwp marks only what changed, and edits survive a save", () => {
    const scn = createScenario({ width: 8, height: 8, era: 0, name: "cuwp" });
    scn.dirty.clear();
    const table = readCuwp(scn);
    expect(applyCuwp(scn, table)).toEqual([]);
    table.slots[2] = patchCuwpSlot(table.slots[2], { shieldsPercent: 25, burrowed: true });
    table.used[2] = true;
    expect(applyCuwp(scn, table)).toEqual(["UPRP", "UPUS"]);
    expect(scn.dirty.has("UPRP") && scn.dirty.has("UPUS")).toBe(true);
    const back = parseScenario(serializeScenario(scn));
    expect(back.cuwp![2]).toMatchObject({ shieldsPercent: 25, validFields: CuwpField.Shields, validProperties: CuwpValid.Burrow, stateFlags: CuwpState.Burrowed });
    expect(back.cuwpUsed![2]).toBe(true);
    // A file with no UPUS gets one only when a tick goes on.
    scn.cuwpUsed = null;
    scn.dirty.clear();
    const again = readCuwp(scn);
    expect(applyCuwp(scn, again)).toEqual([]);
    again.used[5] = true;
    expect(applyCuwp(scn, again)).toEqual(["UPUS"]);
  });

  it("counts the actions naming each slot and Check Map reports empty and out-of-range ones", () => {
    const scn = createScenario({ width: 8, height: 8, era: 0, name: "cuwp" });
    const t = newTrigger();
    const a = newAction(ActionType.CreateUnitWithProperties);
    a.target = 3;
    const b = newAction(ActionType.CreateUnitWithProperties);
    b.target = 99;
    t.actions = [a, b];
    scn.triggers = [t];
    expect(cuwpUsage(scn)[2]).toBe(1);
    expect(cuwpSlotView(scn, 2)).toMatchObject({ index: 2, references: 1, hitPointsPercent: null, cloaked: null, summary: "nothing set" });
    const issues = validateScenario(scn);
    expect(issues.some((i) => i.level === "info" && /slot 3, which sets nothing/.test(i.text))).toBe(true);
    expect(issues.some((i) => i.level === "warn" && /slot 99/.test(i.text))).toBe(true);
    applyCuwp(scn, { ...readCuwp(scn), slots: readCuwp(scn).slots.map((s, i) => (i === 2 ? patchCuwpSlot(s, { hitPointsPercent: 10 }) : s)) });
    expect(validateScenario(scn).some((i) => /slot 3, which sets nothing/.test(i.text))).toBe(false);
  });

  it("the plugin API reads and patches slots through document.update", () => {
    const store = createStore();
    const scn = createScenario({ width: 8, height: 8, era: 0, name: "cuwp" });
    store.set(scenarioAtom, scn);
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    expect(api.settings.cuwpSlots()).toHaveLength(CUWP_SLOTS);
    const r = api.document.update("cuwp", (tx) => {
      expect(tx.cuwp.set(0, { energyPercent: 80, hallucinated: true })).toBe(true);
      expect(tx.cuwp.set(0, { energyPercent: 80 })).toBe(false);
      expect(tx.cuwp.get(0)).toMatchObject({ energyPercent: 80, hallucinated: true, used: true });
    });
    expect(r.changed).toBe(true);
    expect(r.sections).toEqual(["UPRP", "UPUS"]);
    expect(api.settings.cuwpSlot(0)!.summary).toBe("energy 80%, hallucinated");
    expect(api.document.update("clear", (tx) => { expect(tx.cuwp.clear(0)).toBe(true); }).sections).toEqual(["UPRP", "UPUS"]);
    expect(api.settings.cuwpSlot(0)!.summary).toBe("nothing set");
    expect(api.settings.cuwpSlot(64)).toBeNull();
  });
});

const FIXTURE_FILES = ["(2)Binary Burghs.scx", "(8)Big Game Hunters.scm"].filter((f) => existsSync(fixture(f)));

describe.skipIf(FIXTURE_FILES.length === 0)("CUWP on the fixture maps", () => {
  it.each(FIXTURE_FILES)("%s re-encodes UPRP / UPUS byte for byte", async (name) => {
    const bytes = new Uint8Array(readFileSync(fixture(name)));
    const scenario = parseScenario((await loadMap(bytes)).chk);
    for (const section of ["UPRP", "UPUS"]) {
      const original = scenario.chk.sections.find((s) => s.name === section);
      if (!original) continue;
      scenario.dirty.add(section);
      const out = serializeScenario(scenario);
      expect(sectionData(out, section)).toEqual(original.data);
    }
  });
});
