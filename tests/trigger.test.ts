import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Writer } from "../src/formats/chk/binary";
import { createScenario } from "../src/formats/chk/create";
import { combine, parseChk } from "../src/formats/chk/reader";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import {
  ActionFlag, ActionType, Comparison, ConditionFlag, ConditionType, decodeTriggers, emptyAction, emptyCondition, emptyTrigger,
  encodeTriggers, PlayerGroup, SetModifier, SwitchAction, SwitchState, TRIGGER_STRIDE, TriggerFlag, UnitClass, type TriggerRecord,
} from "../src/formats/chk/sections/triggers";
import { ACTION_DEFS, aiScriptCode, aiScriptId, BRIEFING_ACTION_DEFS, CONDITION_DEFS } from "../src/data/triggerDefs";
import { formatTrigger, formatTriggers, parseTriggers, summarizeTrigger, TriggerTextError, triggerComment, withComment, type TriggerNames } from "../src/formats/triggers/text";
import { applyTriggers, moveTrigger, newTrigger, removeTriggers, switchName, triggerNames } from "../src/editor/triggers";
import { loadMap } from "../src/formats/mpq/scm";

/** A name context over fixed tables, so the format can be tested without a scenario. */
function fakeNames(): TriggerNames & { strings: string[] } {
  const strings: string[] = [""];
  const locations = ["Beacon Alpha", "Base", "Anywhere"];
  const units = ["Terran Marine", "Terran Ghost"];
  const switches = ["Door open"];
  return {
    strings,
    string: (i) => (i > 0 && i < strings.length ? strings[i] : null),
    intern: (t) => { const at = strings.indexOf(t, 1); if (at > 0) return at; strings.push(t); return strings.length - 1; },
    location: (n) => (n === 0 ? "No Location" : locations[n - 1] ?? `Location ${n - 1}`),
    locationByName: (name) => { const i = locations.indexOf(name); return i >= 0 ? i + 1 : undefined; },
    unit: (id) => (id === UnitClass.Any ? "Any unit" : units[id] ?? `Unit #${id}`),
    unitByName: (name) => { const i = units.indexOf(name); return i >= 0 ? i : undefined; },
    switch: (i) => switches[i] ?? `Switch ${i + 1}`,
    switchByName: (name) => { const i = switches.indexOf(name); if (i >= 0) return i; const m = /^Switch (\d+)$/.exec(name); return m ? Number(m[1]) - 1 : undefined; },
  };
}

function sample(): TriggerRecord {
  const t = emptyTrigger();
  t.players[PlayerGroup.Player1] = 1;
  t.players[PlayerGroup.Force2] = 1;
  t.conditions.push({ ...emptyCondition(), type: ConditionType.Bring, player: PlayerGroup.CurrentPlayer, unitId: UnitClass.Any, location: 1, comparison: Comparison.AtLeast, amount: 1, flags: ConditionFlag.UnitTypeUsed });
  t.conditions.push({ ...emptyCondition(), type: ConditionType.Switch, resource: 0, comparison: SwitchState.Set });
  t.actions.push({ ...emptyAction(), type: ActionType.DisplayText, text: 1, flags: ActionFlag.AlwaysDisplay });
  t.actions.push({ ...emptyAction(), type: ActionType.SetDeaths, player: PlayerGroup.Player1, unitId: 0, modifier: SetModifier.Add, target: 5, flags: ActionFlag.UnitTypeUsed });
  t.actions.push({ ...emptyAction(), type: ActionType.SetSwitch, target: 0, modifier: SwitchAction.Toggle });
  t.actions.push({ ...emptyAction(), type: ActionType.RunAiScript, target: aiScriptCode("TMCu") });
  t.actions.push({ ...emptyAction(), type: ActionType.PreserveTrigger });
  return t;
}

describe("TRIG codec", () => {
  it("encodes one trigger as 2400 bytes and decodes it back", () => {
    const t = sample();
    t.flags = TriggerFlag.Preserve;
    t.currentAction = 3;
    const bytes = encodeTriggers([t]);
    expect(bytes.length).toBe(TRIGGER_STRIDE);
    expect(decodeTriggers(bytes)).toEqual([t]);
  });

  it("keeps entries after an empty slot but drops trailing ones", () => {
    const t = emptyTrigger();
    t.actions.push(emptyAction(), { ...emptyAction(), type: ActionType.Victory });
    const [back] = decodeTriggers(encodeTriggers([t]));
    expect(back.actions).toHaveLength(2);
    expect(back.actions[0].type).toBe(0);
    expect(back.conditions).toHaveLength(0);
  });

  it("refuses more than 16 conditions or 64 actions", () => {
    const t = emptyTrigger();
    for (let i = 0; i < 17; i++) t.conditions.push({ ...emptyCondition(), type: ConditionType.Always });
    expect(() => encodeTriggers([t])).toThrow(/16 conditions/);
  });

  it("writes TRIG on save and reads it back from the scenario", () => {
    const scn = parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "T", description: "d" })));
    expect(scn.triggers).toEqual([]);
    applyTriggers(scn, [sample()]);
    expect(scn.dirty.has("TRIG")).toBe(true);
    const saved = serializeScenario(scn);
    const trig = combine(parseChk(saved), "TRIG", "append")!;
    expect(trig.length).toBe(TRIGGER_STRIDE);
    expect(parseScenario(saved).triggers).toEqual([sample()]);
    // Re-applying the same list is not a change.
    const again = parseScenario(saved);
    applyTriggers(again, [sample()]);
    expect(again.dirty.has("TRIG")).toBe(false);
  });
});

describe("trigger definitions", () => {
  it("cover every condition and action type once", () => {
    const ctypes = CONDITION_DEFS.map((d) => d.type).sort((a, b) => a - b);
    expect(ctypes).toEqual(Array.from({ length: 23 }, (_, i) => i + 1));
    const atypes = ACTION_DEFS.map((d) => d.type).sort((a, b) => a - b);
    expect(atypes).toEqual(Array.from({ length: 59 }, (_, i) => i + 1));
    expect(BRIEFING_ACTION_DEFS.map((d) => d.type).sort((a, b) => a - b)).toEqual(Array.from({ length: 9 }, (_, i) => i + 1));
  });

  it("round-trips AI script codes", () => {
    expect(aiScriptId(aiScriptCode("+Vi3"))).toBe("+Vi3");
    const w = new Writer(4).u32(aiScriptCode("TMCu")).finish();
    expect(String.fromCharCode(...w)).toBe("TMCu");
  });
});

describe("text triggers", () => {
  it("prints SCMDraft-style text", () => {
    const names = fakeNames();
    names.intern("You found the beacon!");
    const text = formatTrigger(sample(), names);
    expect(text).toBe([
      'Trigger("Player 1", "Force 2"){',
      "Conditions:",
      '\tBring("Current Player", "Any unit", "Beacon Alpha", At least, 1);',
      '\tSwitch("Door open", set);',
      "",
      "Actions:",
      '\tDisplay Text Message(Always Display, "You found the beacon!");',
      '\tSet Deaths("Player 1", "Terran Marine", Add, 5);',
      '\tSet Switch("Door open", toggle);',
      '\tRun AI Script("Terran Custom Level");',
      "\tPreserve Trigger();",
      "}",
    ].join("\n"));
  });

  it("parses what it prints, byte for byte", () => {
    const names = fakeNames();
    names.intern("You found the beacon!");
    const t = sample();
    const [back] = parseTriggers(formatTrigger(t, names), names);
    expect(encodeTriggers([back.trigger])).toEqual(encodeTriggers([t]));
  });

  it("parses hand-written text with comments, disabled items and flags", () => {
    const names = fakeNames();
    const text = `
      // starting resources
      Trigger("All Players", "Player 3"){
      Conditions:
        Always();
        ;Countdown Timer(Exactly, 0);   // disabled
      Actions:
        Set Resources("Current Player", Set To, 50, ore);
        Comment("Starting resources");
        Create Unit("Player 1", "Terran Ghost", All, "Base");
        Move Location("Player 1", "Terran Marine", "Base", "Beacon Alpha");
        Wait(2000);
      Flags:
        Preserve, Ignore Game End;
      }
      //-----------------//
      Trigger("Force 1"){
      Conditions:
        Command("Current Player", "Terran Marine", At most, 0);
      Actions:
        Defeat();
      }`;
    const list = parseTriggers(text, names);
    expect(list).toHaveLength(2);
    const t = list[0].trigger;
    expect(list[0].line).toBe(3);
    expect(t.players[PlayerGroup.AllPlayers]).toBe(1);
    expect(t.players[PlayerGroup.Player3]).toBe(1);
    expect(t.conditions[1].type).toBe(ConditionType.CountdownTimer);
    expect(t.conditions[1].flags & ConditionFlag.Disabled).toBeTruthy();
    expect(t.conditions[1].comparison).toBe(Comparison.Exactly);
    expect(t.actions[0]).toMatchObject({ type: ActionType.SetResources, player: PlayerGroup.CurrentPlayer, modifier: SetModifier.SetTo, target: 50, unitId: 0 });
    expect(names.string(t.actions[1].text)).toBe("Starting resources");
    expect(t.actions[2]).toMatchObject({ type: ActionType.CreateUnit, unitId: 1, modifier: 0, location: 2, flags: ActionFlag.UnitTypeUsed });
    expect(t.actions[3]).toMatchObject({ type: ActionType.MoveLocation, location: 2, target: 1 });
    expect(t.actions[4]).toMatchObject({ type: ActionType.Wait, time: 2000 });
    expect(t.flags).toBe(TriggerFlag.Preserve | TriggerFlag.IgnoreGameEnd);
    expect(triggerComment(t, names)).toBe("Starting resources");
    expect(list[1].trigger.conditions[0]).toMatchObject({ type: ConditionType.Command, unitId: 0, comparison: Comparison.AtMost, amount: 0, flags: ConditionFlag.UnitTypeUsed });
  });

  it("accepts bare numbers where a name is unknown and prints them back", () => {
    const names = fakeNames();
    const [t] = parseTriggers('Trigger(25){ Actions: Set Deaths(200, 7, Set To, 1); Create Unit("Player 1", 7, 1, 9); }', names);
    expect(t.trigger.players[25]).toBe(1);
    expect(() => parseTriggers("Trigger(30){}", names)).toThrow(/Unknown player "30"/);
    expect(t.trigger.actions[0]).toMatchObject({ player: 200, unitId: 7 });
    expect(t.trigger.actions[1]).toMatchObject({ location: 9 });
    expect(formatTrigger(t.trigger, names)).toContain('Set Deaths(200, "Unit #7", Set To, 1);');
    expect(formatTrigger(t.trigger, names)).toContain('"Location 8"');
  });

  it("reports the line of an error", () => {
    const names = fakeNames();
    expect(() => parseTriggers('Trigger("Player 1"){\nConditions:\n\tBring("Player 1", "Nobody", "Base", At least, 1);\n}', names)).toThrow(TriggerTextError);
    try {
      parseTriggers('Trigger("Player 1"){\nConditions:\n\tBring("Player 1", "Nobody", "Base", At least, 1);\n}', names);
    } catch (e) {
      expect((e as TriggerTextError).line).toBe(3);
      expect((e as TriggerTextError).message).toMatch(/Unknown unit "Nobody"/);
    }
    expect(() => parseTriggers('Trigger("Player 1"){ Actions: Wait(); }', names)).toThrow(/takes 1 argument, got 0/);
    expect(() => parseTriggers('Trigger("Player 1"){ Actions: Explode(); }', names)).toThrow(/Unknown action "Explode"/);
  });

  it("prints unknown types as raw records that parse back", () => {
    const names = fakeNames();
    const t = emptyTrigger();
    t.actions.push({ ...emptyAction(), type: 200, location: 1, text: 2, wav: 3, time: 4, player: 5, target: 6, unitId: 7, modifier: 8 });
    t.conditions.push({ ...emptyCondition(), type: 99, location: 1, player: 2, amount: 3, unitId: 4, comparison: 5, resource: 6 });
    const text = formatTrigger(t, names);
    expect(text).toContain("Action 200(1, 2, 3, 4, 5, 6, 7, 8);");
    expect(text).toContain("Condition 99(1, 2, 3, 4, 5, 6);");
    const [back] = parseTriggers(text, names);
    expect(encodeTriggers([back.trigger])).toEqual(encodeTriggers([t]));
  });

  it("summarises and comments", () => {
    const names = fakeNames();
    const t = withComment(sample(), "Beacon", names);
    expect(t.actions[0].type).toBe(ActionType.Comment);
    expect(triggerComment(t, names)).toBe("Beacon");
    expect(withComment(t, "", names).actions.some((a) => a.type === ActionType.Comment)).toBe(false);
    const s = summarizeTrigger(sample(), names);
    expect(s.players).toBe("Player 1, Force 2");
    expect(s.conditions).toMatch(/^Bring\(.*\) && Switch\(/);
  });
});

describe("trigger list operations", () => {
  it("move, remove and create", () => {
    const a = newTrigger([PlayerGroup.Player1]);
    const b = newTrigger([PlayerGroup.Player2]);
    const c = newTrigger();
    expect(c.players[PlayerGroup.AllPlayers]).toBe(1);
    expect(moveTrigger([a, b, c], 0, 2)).toEqual([b, c, a]);
    expect(moveTrigger([a, b, c], 2, 0)).toEqual([c, a, b]);
    expect(removeTriggers([a, b, c], [0, 2])).toEqual([b]);
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const mapFiles = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.sc[mx]$/i.test(f)) : [];

describe.skipIf(mapFiles.length === 0)("fixture maps", () => {
  for (const file of mapFiles) {
    it(`${file}: triggers re-encode byte for byte, through text too`, async () => {
      const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(MAPS, file))))).chk);
      const original = combine(scn.chk, "TRIG", "append");
      if (!original) return;
      expect(encodeTriggers(scn.triggers)).toEqual(original);
      const names = triggerNames(scn);
      const text = formatTriggers(scn.triggers, names);
      expect(text).toContain("Trigger(");
      // Text cannot carry StarEdit's "unit type used" hint bits — the fixtures disagree with
      // *themselves* about them (Binary Burghs sets 0x10 on Command, Isolation does not).
      const hints = ConditionFlag.UnitPropertiesUsed | ConditionFlag.UnitTypeUsed | ConditionFlag.UnitIdUsed;
      const strip = (list: TriggerRecord[]) => list.map((t) => ({
        ...t,
        conditions: t.conditions.map((c) => ({ ...c, flags: c.flags & ~hints })),
        actions: t.actions.map((a) => ({ ...a, flags: a.flags & ~hints })),
      }));
      const back = parseTriggers(text, names).map((t) => t.trigger);
      // Compared through the text, since a table with duplicate strings (Ground Zero) makes
      // the parser's intern pick the first copy — a different index for the same words.
      expect(formatTriggers(strip(back), names)).toEqual(formatTriggers(strip(scn.triggers), names));
      expect(strip(back).map((t) => ({ ...t, actions: t.actions.map((a) => ({ ...a, text: 0, wav: 0 })) }))).toEqual(strip(scn.triggers).map((t) => ({ ...t, actions: t.actions.map((a) => ({ ...a, text: 0, wav: 0 })) })));
      if (scn.switchNames) expect(switchName(scn, 0)).toBeTypeOf("string");
    });
  }
});
