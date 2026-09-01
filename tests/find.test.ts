import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { makeUnit } from "../src/editor/units";
import { makeSprite } from "../src/editor/sprites";
import { newAction, newTrigger } from "../src/editor/triggers";
import { findInScenario, triggerStrings } from "../src/editor/find";

function sample() {
  const scn = createScenario({ width: 64, height: 64, era: 0, name: "Find Me", description: "Zerg rush" });
  scn.units.push(makeUnit(null, 0, 0, 64, 64, 1)); // Terran Marine, Player 1
  scn.units.push(makeUnit(null, 37, 2, 320, 320, 2)); // Zerg Zergling, Player 3
  scn.sprites.push(makeSprite("pure", 12, 0, 96, 96));
  scn.locations[0] = { left: 0, top: 0, right: 64, bottom: 64, nameIndex: 1, elevationFlags: 0 };
  const t = newTrigger();
  const a = newAction(ActionType.DisplayText);
  a.text = 2;
  t.actions.push(a);
  scn.triggers.push(t, newTrigger());
  return scn;
}

describe("findInScenario", () => {
  it("finds units by name, id and owner", () => {
    const scn = sample();
    expect(findInScenario(scn, { kind: "units", query: "marine" }).map((r) => r.index)).toEqual([0]);
    expect(findInScenario(scn, { kind: "units", query: "37" }).map((r) => r.label)).toEqual(["Zerg Zergling"]);
    expect(findInScenario(scn, { kind: "units", query: "player 3" })[0]).toMatchObject({ index: 1, x: 10, y: 10, detail: "Player 3 · 10, 10" });
    expect(findInScenario(scn, { kind: "units", query: "MARINE", matchCase: true })).toEqual([]);
    expect(findInScenario(scn, { kind: "units", query: "  " })).toEqual([]);
  });

  it("finds locations, sprites, strings and triggers", () => {
    const scn = sample();
    expect(findInScenario(scn, { kind: "locations", query: "find" })[0]).toMatchObject({ index: 0, label: "Find Me", x: 1, y: 1 });
    expect(findInScenario(scn, { kind: "locations", query: "anywhere" })[0].index).toBe(63);
    expect(findInScenario(scn, { kind: "sprites", query: "12" })[0]).toMatchObject({ index: 0, label: "Sprite #12" });
    expect(findInScenario(scn, { kind: "sprites", query: "bush", spriteName: () => "Bush" })[0].label).toBe("Bush");
    expect(findInScenario(scn, { kind: "strings", query: "rush" })[0]).toMatchObject({ index: 2, label: "Zerg rush" });
    expect(findInScenario(scn, { kind: "strings", query: "3" })[0].index).toBe(3);
    expect(triggerStrings(scn.triggers[0])).toEqual([2]);
    expect(findInScenario(scn, { kind: "triggers", query: "zerg" })).toEqual([{ kind: "triggers", index: 0, label: "Trigger 1", detail: "Zerg rush" }]);
    expect(findInScenario(scn, { kind: "triggers", query: "2" })[0]).toMatchObject({ index: 1, detail: "0 conditions · 0 actions" });
  });
});
