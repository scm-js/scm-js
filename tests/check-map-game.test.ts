/**
 * Check Map's rules that come from what the game does with a map (docs/chk-format.md,
 * docs/triggers.md), and the facts behind them in `formats/chk/game.ts`.
 */
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { gameReadSections, gameSizeRule, vcodHash, vcodPasses } from "../src/formats/chk/game";
import { parseChk } from "../src/formats/chk/reader";
import { parseScenario, serializeScenario, setMapVersion } from "../src/formats/chk/scenario";
import { PlayerRace, PlayerType } from "../src/formats/chk/sections/players";
import { defaultVcod } from "../src/formats/chk/sections/vcod";
import { ActionType, ConditionType, PlayerGroup, SwitchState, TriggerFlag } from "../src/formats/chk/sections/triggers";
import { START_LOCATION } from "../src/data/units";
import { makeUnit } from "../src/editor/units";
import { newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { triggersFromText, triggersToText } from "../src/editor/exchange";
import { validateScenario } from "../src/editor/validate";
import { GAME_READS, GAME_SIZES, GAME_VERSIONS, REMASTERED_SECTIONS } from "../scripts/lib/chk-game.mjs";

function fresh() {
  const scn = createScenario({ width: 64, height: 64, era: 0, name: "v" });
  scn.playerTypes = scn.playerTypes.map((_, i) => (i < 2 ? PlayerType.Human : PlayerType.Inactive));
  scn.playerRaces = scn.playerRaces.map((r, i) => (i < 2 ? PlayerRace.Terran : r));
  scn.editorPlayerTypes = scn.playerTypes.slice();
  scn.units.push(makeUnit(null, START_LOCATION, 0, 100, 100, 1), makeUnit(null, START_LOCATION, 1, 900, 900, 2));
  return scn;
}
/** A scenario: one trigger, so the map plays as Use Map Settings. */
function scenario() {
  const scn = fresh();
  scn.triggers.push(newTrigger([PlayerGroup.Player1]));
  return scn;
}
const texts = (scn: ReturnType<typeof fresh>) => validateScenario(scn).map((i) => `${i.level}: ${i.text}`);
const has = (scn: ReturnType<typeof fresh>, start: string) => texts(scn).some((t) => t.startsWith(start));

describe("the game's facts", () => {
  it("are the CHK reference's", () => {
    for (const v of GAME_VERSIONS) {
      for (const r of GAME_READS) {
        expect([r.id, v, [...gameReadSections(r.id, v)].sort()]).toEqual([r.id, v, r.sections[v].map((s: { name: string }) => s.name).sort()]);
      }
      for (const [name, rule] of Object.entries(GAME_SIZES) as [string, Record<string, unknown>][]) {
        const expected = name === "MRGN" ? { exactly: (rule.exactly as Record<number, number>)[v] } : rule;
        expect([name, gameSizeRule(name, v)]).toEqual([name, expected]);
      }
    }
    expect(gameSizeRule("CRGB", 206)).toEqual({ exactly: 32 });
    expect(REMASTERED_SECTIONS.CRGB.accepts).toMatch(/Exactly 32 bytes/);
  });

  it("checks VCOD the way the game does", () => {
    const table = defaultVcod();
    // StarEdit's table is the game's: it passes for any players.
    expect(vcodPasses(table, [5, 6, 3, 0, 0, 0, 0, 0, 7, 7, 7, 7], [1, 5, 2, 7, 7, 7, 7, 7, 4, 4, 4, 4])).toBe(true);
    // A changed seed the players' bytes pick fails; one they never pick does not matter.
    const view = new DataView(table.buffer);
    view.setUint32(3 * 4, view.getUint32(3 * 4, true) ^ 0x1234, true);
    expect(vcodPasses(table, [6, 6, 3, 0, 0, 0, 0, 0, 7, 7, 7, 7], [1, 1, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4])).toBe(false);
    expect(vcodPasses(table, [6, 6, 0, 0, 0, 0, 0, 0, 7, 7, 7, 7], [1, 1, 0, 0, 0, 0, 0, 0, 4, 4, 4, 4])).toBe(true);
    expect(vcodHash(defaultVcod(), new Uint8Array(4))).toBe(vcodHash(defaultVcod(), new Uint8Array(4)));
  });
});

describe("what the game refuses", () => {
  it("checks every copy's length against the read that takes it", () => {
    const scn = parseScenario(serializeScenario(fresh()));
    const side = scn.chk.sections.find((s) => s.name === "SIDE")!;
    side.data = new Uint8Array(13);
    expect(texts(scn)).toContain("error: SIDE has a copy of 13 bytes where the game takes exactly 12 bytes, so the map list shows the map as Invalid Scenario.");
    const unit = scn.chk.sections.find((s) => s.name === "UNIT")!;
    unit.data = new Uint8Array(37);
    expect(has(scn, "error: UNIT has a copy of 37 bytes where the game takes whole records of 36 bytes, so the game refuses to start the map")).toBe(true);
    // A section the save rewrites is right by then.
    scn.dirty.add("SIDE");
    expect(has(scn, "error: SIDE")).toBe(false);
  });

  it("replaces a VCOD that fails for the map's players on save", () => {
    const scn = parseScenario(serializeScenario(fresh()));
    const vcod = scn.chk.sections.find((s) => s.name === "VCOD")!;
    new DataView(vcod.data.buffer, vcod.data.byteOffset).setUint32(6 * 4, 0xdeadbeef, true); // seed 6: Human (6) picks it
    expect(has(scn, "warn: The map's VCOD fails the game's check")).toBe(true);
    const saved = parseChk(serializeScenario(scn)).sections.filter((s) => s.name === "VCOD");
    expect(saved).toHaveLength(1);
    expect(saved[0].data).toEqual(defaultVcod());
  });

  it("rewrites an MRGN of the wrong length for the revision", () => {
    const scn = parseScenario(serializeScenario(fresh()));
    setMapVersion(scn, "original");
    const wrong = parseScenario(serializeScenario(scn));
    Object.assign(wrong.chk.sections.find((s) => s.name === "MRGN")!, { data: new Uint8Array(5100), declaredSize: 5100 });
    const again = parseScenario(serializeScenario(wrong));
    expect(again.dirty.has("MRGN")).toBe(true);
    expect(parseChk(serializeScenario(again)).sections.find((s) => s.name === "MRGN")!.data.length).toBe(1280);
  });

  it("knows the tilesets and sizes the game refuses", () => {
    const desert = createScenario({ width: 64, height: 64, era: 5, name: "d" });
    setMapVersion(desert, "hybrid");
    expect(has(desert, "warn: The map is on Desert, a Brood War tileset")).toBe(true);
    const install = fresh();
    install.era = 2;
    expect(has(install, "warn: Installation maps play only as Use Map Settings")).toBe(true);
    const big = fresh();
    big.width = 300;
    expect(has(big, "error: The map is 300 × 64.")).toBe(true);
  });
});

describe("tiles and the fog", () => {
  it("notes creep-flagged tiles, and fills a short MASK with unexplored", () => {
    const scn = fresh();
    scn.tiles[5] |= 0x8000;
    expect(has(scn, "info: 1 tile carries the creep flag (bit 15)")).toBe(true);
    const saved = parseScenario(serializeScenario(fresh()));
    const mask = saved.chk.sections.find((s) => s.name === "MASK")!;
    Object.assign(mask, { data: new Uint8Array(10), declaredSize: 10 });
    const again = parseScenario(serializeScenario(saved));
    expect([again.mask![0], again.mask![9], again.mask![10], again.mask![64 * 64 - 1]]).toEqual([0, 0, 0xff, 0xff]);
  });
});

describe("units the game leaves out", () => {
  it("in Use Map Settings: User Selectable races and slots not in the game", () => {
    const scn = scenario();
    scn.units.push(makeUnit(null, 0, 0, 300, 300, 3), makeUnit(null, 0, 3, 400, 300, 4));
    expect(has(scn, "warn: Player 1's race is User Selectable")).toBe(false);
    scn.playerRaces[0] = PlayerRace.UserSelectable;
    expect(texts(scn)).toContain("warn: Player 1's race is User Selectable, so in a Use Map Settings game the game removes their 1 placed unit and gives them melee start units instead. Choose a race in Player Settings.");
    expect(has(scn, "warn: 1 unit belongs to Player 4, whose slot is not in the game")).toBe(true);
  });

  it("in melee: everything but start locations and Player 12's resources and critters", () => {
    const scn = fresh();
    scn.units.push(makeUnit(null, 176, 0, 300, 300, 3), makeUnit(null, 176, 11, 400, 300, 4), makeUnit(null, 0, 0, 500, 300, 5));
    expect(has(scn, "warn: 1 mineral field or geyser belongs to a player other than Player 12")).toBe(true);
    expect(has(scn, "info: This map has no triggers, so it plays as melee")).toBe(true);
  });

  it("resource amounts past 16 bits", () => {
    const scn = fresh();
    scn.units.push({ ...makeUnit(null, 176, 11, 300, 300, 3), resourceAmount: 70000 });
    expect(has(scn, "warn: 1 unit holds more than 65535 resources")).toBe(true);
  });
});

describe("triggers the game does not run as written", () => {
  it("a trigger ticked twice for a player runs twice", () => {
    const scn = scenario();
    scn.triggers[0].players[PlayerGroup.AllPlayers] = 1;
    expect(has(scn, "warn: Trigger 1 is ticked more than once for Player 1")).toBe(true);
  });

  it("actions that refuse Players 9–12, locations left empty, unknown types", () => {
    const scn = scenario();
    const create = newAction(ActionType.CreateUnit);
    create.player = PlayerGroup.Player12;
    create.location = 0;
    scn.triggers[0].actions.push(create, { ...newAction(ActionType.Comment), type: 70 });
    const out = texts(scn);
    expect(out).toContain("warn: Trigger 1: Create Unit does nothing for Player 12; the game takes only Players 1–8 there.");
    expect(out).toContain("warn: Trigger 1: Create Unit has no location, so it does nothing (a Transmission shows no text either).");
    expect(out).toContain("error: Trigger 1: action type 70 is not one the game has; StarCraft 1.16.1 crashes when the trigger reaches it.");
  });

  it("flag 0x02 defeats everyone else, and reads as Defeat Others", () => {
    const scn = scenario();
    scn.triggers[0].flags |= TriggerFlag.IgnoreGameEnd;
    expect(has(scn, "warn: Trigger 1 has flag 0x02 (Defeat Others)")).toBe(true);
    const text = 'Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\tComment("x");\n\nFlags:\n\tIgnore Game End;\n}\n';
    const [old] = triggersFromText(scn, text);
    expect(old.flags & TriggerFlag.IgnoreGameEnd).toBeTruthy();
    expect(triggersToText(scn, [old])).toContain("Defeat Others");
  });

  it("a switch tested for Cleared needs nothing to set it", () => {
    const scn = scenario();
    const sw = newCondition(ConditionType.Switch);
    sw.resource = 5;
    sw.comparison = SwitchState.Cleared;
    scn.triggers[0].conditions.push(sw);
    expect(has(scn, "warn: Switch 6 is tested")).toBe(false);
    sw.comparison = SwitchState.Set;
    expect(has(scn, "warn: Switch 6 is tested")).toBe(true);
  });

  it("a briefing plays only when it starts with Mission Briefing, which text import adds", () => {
    const scn = scenario();
    scn.briefing.push(newTrigger([PlayerGroup.AllPlayers]));
    expect(has(scn, "warn: Briefing 1 does not start with the Mission Briefing condition")).toBe(true);
    const [imported] = triggersFromText(scn, 'Trigger("All players"){\nActions:\n\tWait(1000);\n}\n', true);
    expect(imported.conditions[0].type).toBe(ConditionType.Briefing);
  });

  it("a one-shot Wait below the hyper triggers may never start", () => {
    const scn = scenario();
    const hyper = newTrigger([PlayerGroup.AllPlayers]);
    hyper.conditions = [newCondition(ConditionType.Always)];
    hyper.actions = [...Array.from({ length: 62 }, () => ({ ...newAction(ActionType.Wait), time: 0 })), newAction(ActionType.PreserveTrigger)];
    const once = newTrigger([PlayerGroup.Player1]);
    once.actions = [{ ...newAction(ActionType.Wait), time: 2000 }];
    scn.triggers.push(hyper, once);
    expect(has(scn, "warn: Trigger 3 waits (a Wait, or a Transmission for a person) below the hyper triggers")).toBe(true);
  });
});
