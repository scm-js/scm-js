import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap } from "../src/formats/mpq/scm";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { parseChk } from "../src/formats/chk/reader";
import { actionDef, BRIEFING_ACTION_DEFS } from "../src/data/triggerDefs";
import { BriefingActionType, encodeTriggers } from "../src/formats/chk/sections/triggers";
import { formatTriggers, parseTriggers } from "../src/formats/triggers/text";
import { triggerNames } from "../src/editor/triggers";
import { findInScenario } from "../src/editor/find";
import { mapStatistics } from "../src/editor/statistics";
import { getString } from "../src/formats/chk/sections/strings";

/**
 * Blizzard's own multiplayer maps carry a mission briefing — a Text Message or two and a
 * Mission Objectives — so the MBRF field layout `triggerDefs.ts` takes from the community
 * reference can be checked against files StarEdit wrote: every action type is one the
 * briefing set knows, every string index points into the table, portrait slots are 0..3,
 * and the text printer and parser reproduce the records exactly.
 */
const MAPS = join(__dirname, "..", "fixtures", "maps");
const BRIEFED = ["(6)Ground Zero.scm", "(4)Spring Thaw.scx"].filter((f) => existsSync(join(MAPS, f)));

describe.skipIf(BRIEFED.length === 0)("mission briefings on Blizzard's maps", () => {
  it.each(BRIEFED)("%s decodes to known briefing actions with valid arguments", async (name) => {
    const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(MAPS, name))))).chk);
    expect(scn.briefing.length).toBeGreaterThan(0);
    const known = new Set(BRIEFING_ACTION_DEFS.map((d) => d.type));
    let texts = 0;
    for (const t of scn.briefing) {
      // StarEdit writes one "Mission Briefing" condition (type 13) per record and nothing else.
      expect(t.conditions.map((c) => c.type)).toEqual([13]);
      expect(t.actions.length).toBeGreaterThan(0);
      for (const a of t.actions) {
        expect(known.has(a.type)).toBe(true);
        const def = actionDef(a.type, true)!;
        for (const arg of def.args) {
          const v = a[arg.field];
          if (arg.kind === "text" || arg.kind === "wav") { expect(v).toBeLessThan(scn.strings.strings.length); if (v > 0) texts++; }
          if (arg.kind === "slot") expect(v).toBeLessThanOrEqual(3);
          if (arg.kind === "duration") expect(v).toBeLessThan(600000);
        }
        if (a.type === BriefingActionType.TextMessage || a.type === BriefingActionType.MissionObjectives) {
          expect(getString(scn.strings, a.text)?.length ?? 0).toBeGreaterThan(0);
        }
      }
    }
    expect(texts).toBeGreaterThan(0);
  });

  it.each(BRIEFED)("%s prints and parses back to the same records, and re-encodes byte for byte", async (name) => {
    const bytes = new Uint8Array(readFileSync(join(MAPS, name)));
    const scn = parseScenario((await loadMap(bytes)).chk);
    const names = triggerNames(scn);
    const text = formatTriggers(scn.briefing, names, true);
    expect(text).toMatch(/Text Message|Mission Objectives/);
    const back = parseTriggers(text, names, true).map((t) => t.trigger);
    // Through the text, since a duplicated string interns to its first copy; the fields themselves must match exactly,
    // apart from the hint bits StarEdit sets on every briefing action (0x04 and the unit-type hints), which text does not carry.
    expect(formatTriggers(back, names, true)).toEqual(text);
    const blank = (list: typeof back) => list.map((t) => ({ ...t, actions: t.actions.map((a) => ({ ...a, text: 0, wav: 0, flags: a.flags & ~0x3c })) }));
    expect(encodeTriggers(blank(back))).toEqual(encodeTriggers(blank(scn.briefing)));
    const original = scn.chk.sections.find((s) => s.name === "MBRF")!.data;
    scn.dirty.add("MBRF");
    expect(parseChk(serializeScenario(scn)).sections.find((s) => s.name === "MBRF")!.data).toEqual(original);
  });

  it.each(BRIEFED)("%s: Find and Statistics see the briefing", async (name) => {
    const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(MAPS, name))))).chk);
    const first = scn.briefing[0].actions.map((a) => getString(scn.strings, a.text)).find((s) => s && s.length > 3)!;
    const word = first.split(/\s+/).find((w) => w.length > 3)!;
    expect(findInScenario(scn, { kind: "briefing", query: word }).length).toBeGreaterThan(0);
    expect(findInScenario(scn, { kind: "briefing", query: "1" })[0]).toMatchObject({ kind: "briefing", index: 0, label: "Briefing 1" });
    const stats = mapStatistics(scn, null, null, null);
    expect(stats.briefings.count).toBe(scn.briefing.length);
    expect(stats.briefings.actions).toBeGreaterThan(0);
  });
});
