import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadMap } from "../src/formats/mpq/scm";
import { parseScenario } from "../src/formats/chk/scenario";
import { forceViews } from "../src/editor/settings";
import {
  ActionFlag, ActionType, ConditionType, PlayerGroup, TriggerFlag, type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../src/formats/chk/sections/triggers";
import { addressOfEpd, newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { resolvePlayers, triggerReferences } from "../src/editor/triggerRefs";

const FORCES = [[0, 1], [2, 3], [], []];

function trigger(players: number[], conditions: Partial<ConditionRecord>[], actions: Partial<ActionRecord>[]): TriggerRecord {
  const t = newTrigger(players);
  t.conditions = conditions.map((c) => ({ ...newCondition(c.type ?? 0), ...c }));
  t.actions = actions.map((a) => ({ ...newAction(a.type ?? 0), ...a }));
  return t;
}

describe("resolvePlayers", () => {
  it("names a slot, a force, All Players and Current Player", () => {
    expect(resolvePlayers(3, [], FORCES)).toEqual({ players: [3], approximate: false });
    expect(resolvePlayers(PlayerGroup.Force2, [], FORCES)).toEqual({ players: [2, 3], approximate: false });
    expect(resolvePlayers(PlayerGroup.AllPlayers, [], FORCES).players).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(resolvePlayers(PlayerGroup.CurrentPlayer, [PlayerGroup.Force1, 6], FORCES)).toEqual({ players: [0, 1, 6], approximate: false });
    expect(resolvePlayers(PlayerGroup.None, [], FORCES).players).toEqual([]);
  });

  it("says when the group is only settled in the game", () => {
    expect(resolvePlayers(PlayerGroup.Foes, [], FORCES).approximate).toBe(true);
    expect(resolvePlayers(PlayerGroup.CurrentPlayer, [PlayerGroup.Allies], FORCES).approximate).toBe(true);
  });
});

describe("triggerReferences", () => {
  it("reads a switch in a condition and writes it in an action", () => {
    const [t] = triggerReferences([trigger([0], [{ type: ConditionType.Switch, resource: 4 }], [{ type: ActionType.SetSwitch, target: 9 }])], FORCES);
    expect(t.refs.map((r) => [r.kind, r.access, r.id, r.part, r.slot])).toEqual([
      ["switch", "read", 4, "condition", 0],
      ["switch", "write", 9, "action", 0],
    ]);
    expect(t.owners).toEqual([0]);
    expect(t.inert).toBe(false);
  });

  it("resolves Current Player in a death counter to the trigger's owners", () => {
    const [t] = triggerReferences([trigger([PlayerGroup.Force1], [{ type: ConditionType.Deaths, player: PlayerGroup.CurrentPlayer, unitId: 7 }], [])], FORCES);
    expect(t.refs).toEqual([expect.objectContaining({ kind: "deaths", access: "read", id: 7, players: [0, 1], group: PlayerGroup.CurrentPlayer })]);
  });

  it("makes an EUD player a memory reference with its address", () => {
    const player = 0x1234;
    const [t] = triggerReferences([trigger([0], [], [{ type: ActionType.SetDeaths, player, unitId: 0 }])], FORCES);
    expect(t.refs).toEqual([expect.objectContaining({ kind: "memory", access: "write", address: addressOfEpd(player, 0) })]);
  });

  it("carries a masked record's bits", () => {
    const [t] = triggerReferences([trigger([0], [{ type: ConditionType.Deaths, player: 0, unitId: 5, mask: 0x4353, location: 0xff00 }], [])], FORCES);
    expect(t.refs).toEqual([expect.objectContaining({ kind: "memory", address: addressOfEpd(0, 5), mask: 0xff00, players: [0] })]);
  });

  it("tells Move Location's destination from the place a unit is looked for", () => {
    const [t] = triggerReferences([trigger([0], [], [{ type: ActionType.MoveLocation, player: 0, unitId: 0, location: 3, target: 5 }])], FORCES);
    const locations = t.refs.filter((r) => r.kind === "location").map((r) => [r.id, r.access]);
    expect(locations).toEqual([[2, "use"], [4, "write"]]);
  });

  it("names strings, sounds and endings", () => {
    const [t] = triggerReferences([trigger([1], [{ type: ConditionType.Always }], [
      { type: ActionType.DisplayText, text: 12 },
      { type: ActionType.PlayWav, wav: 13 },
      { type: ActionType.Victory },
    ])], FORCES);
    expect(t.refs.map((r) => [r.kind, r.access, r.id, r.players])).toEqual([
      ["string", "use", 12, []],
      ["wav", "use", 13, []],
      ["outcome", "write", ActionType.Victory, [1]],
    ]);
  });

  it("marks a disabled action and an inert trigger", () => {
    const off = trigger([], [], [{ type: ActionType.SetSwitch, target: 0, flags: ActionFlag.Disabled }]);
    const disabled = trigger([0], [], []);
    disabled.flags |= TriggerFlag.Disabled;
    const [a, b] = triggerReferences([off, disabled], FORCES);
    expect(a.inert).toBe(true);
    expect(a.refs[0].disabled).toBe(true);
    expect(b.inert).toBe(true);
  });

  it("reads units of a class through Deaths as units, not a counter", () => {
    const [t] = triggerReferences([trigger([0], [{ type: ConditionType.Deaths, player: 0, unitId: 229 }], [])], FORCES);
    expect(t.refs).toEqual([expect.objectContaining({ kind: "units", id: 229, players: [0] })]);
  });

  it("reads only strings and sounds in a briefing", () => {
    const briefing = newTrigger([0]);
    briefing.actions = [{ ...newAction(3, true), text: 7 }, { ...newAction(5, true), player: 2 }];
    const [t] = triggerReferences([briefing], FORCES, true);
    expect(t.refs.map((r) => [r.kind, r.id])).toEqual([["string", 7]]);
  });
});

const ICE_FLOES = join(__dirname, "..", "fixtures", "maps", "(2)Ice Floes.scx");

describe.skipIf(!existsSync(ICE_FLOES))("a Blizzard map's melee triggers", () => {
  it("read as starting ore, then Defeat with no buildings and Victory when no enemy has any", async () => {
    const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(ICE_FLOES)))).chk);
    const refs = triggerReferences(scn.triggers, forceViews(scn).map((f) => f.players));
    const brief = refs.map((t) => t.refs.map((r) => `${r.kind} ${r.access} ${r.id}${r.approximate ? "?" : ""}`));
    expect(brief).toEqual([
      ["resources write 0"],
      ["units read 231", `outcome write ${ActionType.Defeat}`],
      ["units read 231?", `outcome write ${ActionType.Victory}`],
    ]);
    expect(refs.every((t) => t.owners.length === 8)).toBe(true);
  });
});
