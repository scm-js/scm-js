import { buildStockSounds } from "../src/editor/stockSounds";
import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { ANYWHERE_INDEX } from "../src/formats/chk/sections/objects";
import { PlayerType } from "../src/formats/chk/sections/players";
import { ActionType, ConditionType, PlayerGroup, SwitchAction, TriggerFlag } from "../src/formats/chk/sections/triggers";
import { START_LOCATION } from "../src/data/units";
import { makeUnit } from "../src/editor/units";
import { newAction, newCondition, newTrigger } from "../src/editor/triggers";
import { issueCounts, triggerIssues, UNIT_LIMIT, validateScenario } from "../src/editor/validate";

function fresh() {
  const scn = createScenario({ width: 64, height: 64, era: 0, name: "v" });
  // Two human slots with start locations, the rest closed: a map with nothing to say.
  scn.playerTypes = scn.playerTypes.map((_, i) => (i < 2 ? PlayerType.Human : PlayerType.Inactive));
  scn.editorPlayerTypes = scn.playerTypes.slice();
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

  it("reports missing required sections by revision and game type", () => {
    const missing = (scn: ReturnType<typeof fresh>) => texts(scn).filter((t) => /^(error|warn): Missing/.test(t));
    const UMS = "— a Use Map Settings game of this map stops as it starts. Melee and the other game types do not need them.";
    // A Brood War map needs only the `x` settings layouts, like Blizzard's own, and only
    // for Use Map Settings: a melee game never reads them.
    const bw = fresh();
    for (const n of ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"]) bw.dirty.delete(n);
    expect(missing(bw)).toEqual([]);
    bw.dirty.delete("UNIx");
    bw.dirty.delete("MASK");
    expect(missing(bw)).toEqual([`warn: Missing MASK, UNIx ${UMS}`]);
    bw.triggers.push(newTrigger());
    expect(missing(bw)).toEqual([`error: Missing MASK, UNIx ${UMS}`]);
    // And COLR, which every game of a Brood War file reads, and TRIG, which Remastered's map list needs.
    const colr = fresh();
    colr.dirty.delete("COLR");
    colr.dirty.delete("TRIG");
    expect(missing(colr)).toEqual(["error: Missing TRIG, COLR — the game will not load this map."]);
    // A hybrid or original map needs the original layouts; the `x` ones are read on top when present.
    const ORIGINAL = ["UNIS", "UPGS", "TECS", "UPGR", "PTEC"];
    const hybrid = fresh();
    hybrid.fileVersion = 63;
    for (const n of ORIGINAL) hybrid.dirty.add(n);
    expect(missing(hybrid)).toEqual([]);
    hybrid.dirty.delete("UPGS");
    hybrid.dirty.delete("PUPx");
    expect(missing(hybrid)).toEqual([`warn: Missing UPGS ${UMS}`]);
    const orig = fresh();
    orig.fileVersion = 59;
    expect(missing(orig)).toEqual([`warn: Missing UNIS, UPGS, TECS, UPGR, PTEC ${UMS}`]);
    for (const n of ORIGINAL) orig.dirty.add(n);
    for (const n of ["UNIx", "UPGx", "TECx", "PUPx", "PTEx", "COLR"]) orig.dirty.delete(n);
    expect(missing(orig)).toEqual([]);

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
    // No triggers: a melee map, where a player without one is eliminated at once.
    expect(out).toContain("warn: No start location for Player 3 (slot is Computer): in a melee game that player gets no start units and is eliminated at once.");
    expect(out).toContain("warn: Player 1 has 2 start locations; the game uses the last one in the unit list.");
    expect(out).toContain("warn: Player 6 has a start location but its slot is not playable.");
    const second = validateScenario(scn).find((i) => i.text.includes("2 start locations"));
    expect(second?.target).toEqual({ kind: "unit", index: 2 });
    // In a Use Map Settings game it is only where the view starts; Players 9–12 never get one.
    scn.triggers.push(newTrigger());
    scn.units.push(makeUnit(null, START_LOCATION, 9, 600, 600, 5));
    const ums = texts(scn);
    expect(ums).toContain("info: No start location for Player 3 (slot is Computer): in a Use Map Settings game the view starts at the top-left corner.");
    expect(ums.some((t) => t.startsWith("error: Player 10 has a start location. Only Players 1–8 can"))).toBe(true);
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
    expect(out).toContain("warn: Trigger 1: Display Text Message refers to string #999, past the end of the table, so the game shows nothing.");
    expect(out).toContain("warn: Trigger 1: Play WAV plays 'staredit\\wav\\boom.wav', which is not in the archive.");
    expect(out).toContain("warn: Switch 4 is tested by a condition but no action ever sets it.");
    expect(out).toContain("info: Trigger 2 is disabled.");
    // Present in the archive: no complaint.
    const ok = texts(scn, { extras: new Map([["StarEdit/Wav/BOOM.wav", new Uint8Array(1)]]) });
    expect(ok.some((x) => x.includes("not in the archive"))).toBe(false);
    // One of the game's own sounds needs no file; a path into its folder the list does not have is a typo.
    scn.strings.strings[2] = "sound\\Terran\\Marine\\TMaYes00.wav";
    const stockSounds = buildStockSounds(["Terran\\MARINE\\TMaYes00.WAV"], null, null);
    expect(texts(scn, { extras: new Map() }).some((x) => x.includes("not in the archive"))).toBe(false);
    expect(texts(scn, { extras: new Map(), stockSounds }).some((x) => x.includes("not in the archive"))).toBe(false);
    scn.strings.strings[2] = "sound\\Terran\\Marine\\TMaYes99.wav";
    expect(texts(scn, { extras: new Map(), stockSounds })).toContain("warn: Trigger 1: Play WAV plays 'sound\\Terran\\Marine\\TMaYes99.wav', which is not in the archive and not one of the sounds the game lists.");
    scn.strings.strings[2] = "staredit\\wav\\boom.wav";
    const only = triggerIssues(validateScenario(scn, { extras: new Map() }));
    expect(only.every((i) => i.where === "Triggers")).toBe(true);
    // The five about these triggers, plus the scenario checks (no Victory, no Defeat, no objectives) a map with triggers earns.
    expect(only.length).toBe(8);
    expect(only.find((i) => i.text.startsWith("Trigger 2"))?.target).toEqual({ kind: "trigger", index: 1 });
  });

  it("reports ISOM health when given", () => {
    const scn = fresh();
    expect(texts(scn, { isom: { kind: "missing" } }).some((t) => t.includes("no ISOM section"))).toBe(true);
    // Only what a rebuild would recover is warned about: 25 mismatched of which 5 no
    // lattice can describe is a 20% repair, and the 5 are nobody's to fix.
    const ready = (stale: boolean, mismatched: number, inherent: number) =>
      ({ isom: { kind: "ready", report: { rects: 100, mismatched, inherent, stale } } }) as const;
    expect(texts(scn, ready(true, 25, 5))).toContain("warn: ISOM is behind the tiles on 20% of the map (the Repair plugin rebuilds it: Tools ▸ Repair Map…).");
    expect(texts(scn, ready(false, 14, 14)).some((t) => t.includes("ISOM"))).toBe(false);
    expect(texts(scn, ready(false, 0, 0)).some((t) => t.includes("ISOM"))).toBe(false);
  });
});

describe("scenario (UMS) checks", () => {
  const running = (groups: number[]) => { const players = Array.from({ length: 27 }, () => 0); for (const g of groups) players[g] = 1; return players; };
  const action = (type: number, extra: Partial<ReturnType<typeof newAction>> = {}) => ({ ...newAction(), type, ...extra });
  const trigger = (groups: number[], actions: ReturnType<typeof newAction>[], conditions = [newCondition()]) => ({ ...newTrigger(), players: running(groups), conditions, actions });

  it("says nothing about a map with no triggers", () => {
    expect(texts(fresh()).some((t) => /Victory|Defeat|Objectives/.test(t))).toBe(false);
  });

  it("wants a Victory, a Defeat and objectives for every human player, through the groups", () => {
    const scn = fresh();
    scn.triggers.push(trigger([PlayerGroup.Player1], [action(ActionType.Victory)]));
    let out = texts(scn);
    expect(out).toContain("warn: No trigger gives Player 2 Victory; in a scenario a player wins only when a trigger says so.");
    // Player 1's Victory defeats Player 2; nothing makes Player 1 lose.
    expect(out).toContain("warn: Nothing makes Player 1 lose: no Defeat, and no Victory or Draw for another player. A scenario does not end when a player's units are gone.");
    expect(out.some((t) => t.startsWith("info: No Set Mission Objectives for Player 1, Player 2"))).toBe(true);
    // All Players covers everyone; a force covers its members.
    scn.triggers.push(trigger([PlayerGroup.AllPlayers], [action(ActionType.Defeat)]));
    scn.forces.playerForce[1] = 2;
    scn.triggers.push(trigger([PlayerGroup.Force3], [action(ActionType.Victory), action(ActionType.SetMissionObjectives, { text: 1 })]));
    scn.triggers.push(trigger([PlayerGroup.Player1], [action(ActionType.SetMissionObjectives, { text: 1 })]));
    out = texts(scn);
    expect(out.some((t) => /Victory|Defeat|Objectives/.test(t))).toBe(false);
  });

  it("recognises hyper triggers and warns about a Wait in a preserved trigger beside them", () => {
    const scn = fresh();
    const hyper = trigger([PlayerGroup.AllPlayers], [...Array.from({ length: 62 }, () => action(ActionType.Wait, { time: 0 })), action(ActionType.PreserveTrigger)], [{ ...newCondition(), type: ConditionType.Always }]);
    scn.triggers.push(trigger([PlayerGroup.AllPlayers], [action(ActionType.Victory), action(ActionType.Defeat), action(ActionType.SetMissionObjectives, { text: 1 })]));
    scn.triggers.push(hyper);
    scn.triggers.push(trigger([PlayerGroup.Player1], [action(ActionType.Wait, { time: 2000 }), action(ActionType.PreserveTrigger)]));
    const out = texts(scn);
    expect(out).toContain("info: Hyper triggers present (1 trigger): the game goes through the triggers every 2 frames instead of every 31, about twelve times a second at Fastest.");
    expect(out.some((t) => t.startsWith("warn: Trigger 3 has a Wait and Preserve Trigger below the hyper triggers"))).toBe(true);
    // Above them, it holds them up instead; a player who runs no hyper triggers is not affected.
    const above = fresh();
    above.triggers.push(trigger([PlayerGroup.Player1], [action(ActionType.Wait, { time: 2000 }), action(ActionType.PreserveTrigger)]));
    above.triggers.push(hyper);
    expect(texts(above).some((t) => t.startsWith("warn: Trigger 1 has a Wait and Preserve Trigger above the hyper triggers"))).toBe(true);
    const apart = fresh();
    apart.triggers.push({ ...hyper, players: hyper.players.map((v, i) => (i === PlayerGroup.AllPlayers ? 0 : i === PlayerGroup.Player2 ? 1 : v)) });
    apart.triggers.push(trigger([PlayerGroup.Player1], [action(ActionType.Wait, { time: 2000 }), action(ActionType.PreserveTrigger)]));
    expect(texts(apart).some((t) => t.includes("has a Wait and Preserve Trigger"))).toBe(false);
    const issues = validateScenario(scn);
    expect(issues.find((i) => i.text.startsWith("Hyper triggers"))?.target).toEqual({ kind: "trigger", index: 1 });
    // Without hyper triggers a preserved Wait is an ordinary timer.
    scn.triggers.splice(1, 1);
    expect(texts(scn).some((t) => /Wait and Preserve/.test(t))).toBe(false);
  });
});

describe("tiles only StarCraft: Remastered has", () => {
  const remastered = (scn: ReturnType<typeof fresh>) => texts(scn).filter((line) => line.includes("StarCraft: Remastered added"));

  it("says nothing of a map that keeps to the 1.16 tiles", () => {
    const scn = fresh(); // Badlands
    scn.tiles[0] = (1664 << 4) | 3; // the last group the 1.16 Badlands table has
    scn.tiles[1] = (1023 << 4) | 0; // a low group, which Badlands never had filled in
    expect(remastered(scn)).toEqual([]);
  });

  it("counts the tiles past the 1.16 table and says where the first is", () => {
    const scn = fresh();
    scn.tiles[5 * scn.width + 7] = (1665 << 4) | 0; // the first group Remastered added to Badlands
    scn.tiles[9 * scn.width + 2] = (1978 << 4) | 15; // and the last
    scn.tiles[9 * scn.width + 3] = (1979 << 4) | 0; // past Remastered's own table: not its tile either
    expect(remastered(scn)).toEqual([expect.stringMatching(/^info: 2 tiles are from what StarCraft: Remastered added to this tileset \(the first at 7, 5\)/)]);
    scn.tiles[9 * scn.width + 2] = 0;
    expect(remastered(scn)[0]).toMatch(/^info: 1 tile is from/);
  });

  it("knows the low groups Remastered filled in on the three tilesets where it did", () => {
    const desert = createScenario({ width: 64, height: 64, era: 5, name: "v" });
    desert.tiles[0] = (769 << 4) | 0; // the last low group Desert had in 1.16
    expect(validateScenario(desert).some((i) => i.text.includes("Remastered added"))).toBe(false);
    desert.tiles[0] = (770 << 4) | 0; // the first Remastered filled
    desert.tiles[1] = (1023 << 4) | 0;
    desert.tiles[2] = (1024 << 4) | 0; // an ordinary 1.16 doodad group
    expect(validateScenario(desert).find((i) => i.text.includes("Remastered added"))!.text).toMatch(/^2 tiles are/);
    // The same on Space Platform and Twilight, each from its own group.
    for (const [tilesetEra, from] of [[1, 933], [7, 797]]) {
      const scn = createScenario({ width: 64, height: 64, era: tilesetEra, name: "v" });
      scn.tiles[0] = ((from - 1) << 4) | 0;
      expect(validateScenario(scn).some((i) => i.text.includes("Remastered added")), `era ${tilesetEra}`).toBe(false);
      scn.tiles[0] = (from << 4) | 0;
      expect(validateScenario(scn).some((i) => i.text.includes("Remastered added")), `era ${tilesetEra}`).toBe(true);
    }
    // Installation gained nothing.
    const install = createScenario({ width: 64, height: 64, era: 2, name: "v" });
    install.tiles.fill((1264 << 4) | 0);
    install.tiles[0] = (1265 << 4) | 0;
    expect(validateScenario(install).some((i) => i.text.includes("Remastered added"))).toBe(false);
  });
});
