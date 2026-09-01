import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario } from "../src/formats/chk/scenario";
import { ActionFlag, ActionType, PlayerGroup, TRIGGER_STRIDE, type TriggerRecord } from "../src/formats/chk/sections/triggers";
import { getString } from "../src/formats/chk/sections/strings";
import { TriggerTextError } from "../src/formats/triggers/text";
import {
  applyStringImport, decodeTrg, encodeTrg, escapeStringText, formatStringTable, parseStringTable, readTriggerFile, triggerFormatOf, triggersFromText, triggersToText, unescapeStringText,
} from "../src/editor/exchange";
import { internString } from "../src/editor/settings";
import { newAction, newTrigger } from "../src/editor/triggers";
import { loadMap } from "../src/formats/mpq/scm";

function fresh() {
  return createScenario({ width: 64, height: 64, era: 4, name: "T", description: "d" });
}

function sample(scn = fresh()): { scn: ReturnType<typeof fresh>; triggers: TriggerRecord[] } {
  const t = newTrigger([PlayerGroup.Player1]);
  const text = newAction(ActionType.DisplayText);
  text.text = internString(scn, "Hello <04>world");
  text.flags |= ActionFlag.AlwaysDisplay;
  t.actions.push(text, newAction(ActionType.PreserveTrigger));
  const u = newTrigger([PlayerGroup.AllPlayers]);
  u.actions.push(newAction(ActionType.Victory));
  return { scn, triggers: [t, u] };
}

describe("trigger files", () => {
  it("writes a .trg as the raw records and reads it back", () => {
    const { triggers } = sample();
    const bytes = encodeTrg(triggers);
    expect(bytes.length).toBe(2 * TRIGGER_STRIDE);
    expect(decodeTrg(bytes)).toEqual(triggers);
    expect(() => decodeTrg(bytes.subarray(0, 100))).toThrow(/multiple of 2400/);
    expect(() => decodeTrg(new Uint8Array(0))).toThrow();
  });

  it("round-trips text through the map's names and reports a bad line", () => {
    const { scn, triggers } = sample();
    const text = triggersToText(scn, triggers);
    expect(text).toContain("Display Text Message");
    expect(text).toContain("Hello");
    const back = triggersFromText(scn, text);
    expect(back.length).toBe(2);
    expect(back[0].actions[0].type).toBe(ActionType.DisplayText);
    expect(getString(scn.strings, back[0].actions[0].text)).toBe("Hello <04>world");
    expect(back[1].actions[0].type).toBe(ActionType.Victory);
    let err: unknown = null;
    try { triggersFromText(scn, "Trigger(\"Player 1\"){\nConditions:\nActions:\n  Bogus Action(1);\n}"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(TriggerTextError);
    expect((err as TriggerTextError).line).toBeGreaterThan(0);
  });

  it("picks the format by extension", () => {
    const { scn, triggers } = sample();
    expect(triggerFormatOf("a.TRG")).toBe("trg");
    expect(triggerFormatOf("a.txt")).toBe("txt");
    expect(triggerFormatOf("noext")).toBe("txt");
    expect(readTriggerFile(scn, "x.trg", encodeTrg(triggers))).toEqual(triggers);
    const bytes = new Uint8Array([...triggersToText(scn, triggers)].map((c) => c.charCodeAt(0)));
    expect(readTriggerFile(scn, "x.txt", bytes).length).toBe(2);
  });
});

describe("string files", () => {
  it("escapes control bytes, tabs, newlines, backslashes and angle brackets both ways", () => {
    const raw = "a\x04b\\c\nd\te<f>\x1f";
    const escaped = escapeStringText(raw);
    expect(escaped).toBe("a<04>b\\\\c\\nd\\te\\<f><1F>");
    expect(unescapeStringText(escaped)).toBe(raw);
    expect(unescapeStringText("plain <zz> text")).toBe("plain <zz> text");
  });

  it("formats and parses the table, skipping comments and reporting bad lines", () => {
    const scn = fresh();
    scn.strings.strings.push("Line\ntwo", null, "\x03Coloured");
    const text = formatStringTable(scn.strings);
    const lines = text.trimEnd().split("\n");
    expect(lines[0]).toBe("1\tT");
    expect(lines).toContain("8\tLine\\ntwo");
    expect(lines).toContain("10\t<03>Coloured");
    expect(lines.some((l) => l.startsWith("9\t"))).toBe(false);
    const parsed = parseStringTable("# comment\n" + text + "\nno tab here\n0\tzero\n");
    expect(parsed.entries.map((e) => e.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 10]);
    expect(parsed.entries.find((e) => e.index === 10)!.text).toBe("\x03Coloured");
    expect(parsed.errors.map((e) => e.line)).toEqual([12, 13]);
  });

  it("imports in place, appends past the end and marks the string section dirty", () => {
    const scn = fresh();
    scn.dirty.clear();
    const before = scn.strings.strings.length;
    const r = applyStringImport(scn, [{ index: 1, text: "Renamed" }, { index: 2, text: "d" }, { index: before + 1, text: "gap" }, { index: before, text: "next" }]);
    expect(r).toEqual({ replaced: 1, added: 2 });
    expect(getString(scn.strings, 1)).toBe("Renamed");
    expect(getString(scn.strings, before)).toBe("next");
    expect(getString(scn.strings, before + 1)).toBe("gap");
    expect(scn.dirty.has("STR ")).toBe(true);
    const untouched = fresh();
    untouched.dirty.clear();
    expect(applyStringImport(untouched, [{ index: 1, text: "T" }])).toEqual({ replaced: 0, added: 0 });
    expect(untouched.dirty.size).toBe(0);
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const fixtures = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.(scx|scm)$/i.test(f)) : [];

describe.skipIf(fixtures.length === 0)("fixture maps", () => {
  for (const file of fixtures) {
    it(`exports and re-imports the triggers and strings of ${file}`, async () => {
      const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAPS, file))));
      const scn = parseScenario(chk);
      const text = triggersToText(scn, scn.triggers);
      const back = triggersFromText(scn, text);
      expect(back.length).toBe(scn.triggers.length);
      expect(decodeTrg(encodeTrg(scn.triggers))).toEqual(scn.triggers);
      const strings = parseStringTable(formatStringTable(scn.strings));
      expect(strings.errors).toEqual([]);
      for (const { index, text: t } of strings.entries) expect(getString(scn.strings, index)).toBe(t);
    });
  }
});
