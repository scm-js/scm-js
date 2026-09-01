import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { combine } from "../src/formats/chk/reader";
import { parseScenario } from "../src/formats/chk/scenario";
import { getString } from "../src/formats/chk/sections/strings";
import {
  ActionFlag, ActionType, Comparison, ConditionFlag, ConditionType, emptyAction, emptyCondition, emptyTrigger, encodeTriggers,
  PlayerGroup, SetModifier, SwitchAction, SwitchState, TriggerFlag, UnitClass, type TriggerRecord,
} from "../src/formats/chk/sections/triggers";
import { aiScriptCode } from "../src/data/triggerDefs";
import { loadMap, readExtras, saveMap } from "../src/formats/mpq/scm";
import { generateDeclarations } from "../src/script/declarations";
import { compileScript } from "../src/script/compiler";
import { defaultScriptNames, identifier, scriptNames } from "../src/script/names";
import { printScript, printTrigger } from "../src/script/print";
import { buildScript, findBlock, hashTriggers, readManifest, readScript, relocateScriptBlock, resolveStrings, scriptState, triggerAtLine } from "../src/editor/script";
import { applyTriggers, insertTrigger, newTrigger, triggerNames } from "../src/editor/triggers";
import { createScenario } from "../src/formats/chk/create";

const DECLS = generateDeclarations();
const compile = (src: string, decls = DECLS) => compileScript(ts, src, decls);

function sample(): TriggerRecord {
  const t = emptyTrigger();
  t.players[PlayerGroup.Player1] = 1;
  t.players[PlayerGroup.Force2] = 1;
  t.conditions.push({ ...emptyCondition(), type: ConditionType.Bring, player: PlayerGroup.CurrentPlayer, unitId: UnitClass.Any, location: 64, comparison: Comparison.AtLeast, amount: 1, flags: ConditionFlag.UnitTypeUsed });
  t.conditions.push({ ...emptyCondition(), type: ConditionType.Switch, resource: 3, comparison: SwitchState.Set });
  t.actions.push({ ...emptyAction(), type: ActionType.DisplayText, text: 1, flags: ActionFlag.AlwaysDisplay });
  t.actions.push({ ...emptyAction(), type: ActionType.SetDeaths, player: PlayerGroup.Player1, unitId: 0, modifier: SetModifier.Add, target: 5, flags: ActionFlag.UnitTypeUsed });
  t.actions.push({ ...emptyAction(), type: ActionType.SetSwitch, target: 3, modifier: SwitchAction.Toggle });
  t.actions.push({ ...emptyAction(), type: ActionType.RunAiScript, target: aiScriptCode("TMCu") });
  t.actions.push({ ...emptyAction(), type: ActionType.PreserveTrigger, flags: ActionFlag.Disabled });
  t.flags = TriggerFlag.Preserve;
  return t;
}

describe("script names", () => {
  it("derives identifiers", () => {
    expect(identifier("Terran Siege Tank (Tank Mode)")).toBe("TerranSiegeTankTankMode");
    expect(identifier("Tassadar/Zeratul (Archon)")).toBe("TassadarZeratulArchon");
    expect(identifier("2nd base")).toBe("_2ndBase");
    expect(identifier("")).toBe("_");
  });

  it("keeps keys unique and pairs identifiers with display names", () => {
    const n = defaultScriptNames();
    const marine = n.units.entries.find((e) => e.value === 0)!;
    expect(marine.keys).toEqual(["TerranMarine", "Terran Marine"]);
    expect(n.units.entries.find((e) => e.value === UnitClass.Any)!.keys).toEqual(["AnyUnit", "Any unit", "Any Unit"]);
    const all = n.units.entries.flatMap((e) => e.keys);
    expect(new Set(all).size).toBe(all.length);
    expect(n.players.entries.find((e) => e.value === PlayerGroup.CurrentPlayer)!.keys).toEqual(["Current", "CurrentPlayer", "Current Player"]);
    expect(n.switches.entries[0].keys).toEqual(["Switch1", "Switch 1"]);
  });
});

describe("declarations", () => {
  it("type-check on their own under noLib", () => {
    const r = compile("");
    expect(r.diagnostics).toEqual([]);
    expect(DECLS).toContain("declare function Bring(player: PlayerId, unit: UnitId, location: LocationId, comparison: Comparison | number, amount: number): Condition;");
    expect(DECLS).toContain('readonly "Terran Marine": UnitId<0>;');
  });
});

describe("compiler", () => {
  it("lowers a trigger with every argument kind", () => {
    const r = compile(`
      const five = 5;
      trigger([P1, Players.Force2], [
        Bring(CurrentPlayer, Units.AnyUnit, Locations.Anywhere, ">=", 1),
        Switch(Switches.Switch4, "set"),
      ], [
        DisplayText("Always Display", "hello"),
        SetDeaths(P1, Units.TerranMarine, "Add", five),
        SetSwitch(Switches.Switch4, "toggle"),
        RunAiScript(AiScripts.TerranCustomLevel),
        disabled(PreserveTrigger()),
      ], ["Preserve"]);
    `);
    expect(r.diagnostics).toEqual([]);
    expect(r.strings).toEqual([{ text: "hello" }]);
    expect(r.lines).toEqual([3]);
    expect(r.triggers).toEqual([sample()]);
  });

  it("folds constants, follows const chains, spreads arrays", () => {
    const r = compile(`
      const base = 60 * 1000;
      const wait = base / 2 + 7;
      const both = [Always(), Never()];
      const acts = [Wait(wait), Wait(-1 >>> 0)] as const;
      trigger(AllPlayers, [...both, Always()], [...acts, Comment("a" + "b" + \`\${1 + 1}\`)]);
    `);
    expect(r.diagnostics).toEqual([]);
    const t = r.triggers[0];
    expect(t.conditions.map((c) => c.type)).toEqual([ConditionType.Always, ConditionType.Never, ConditionType.Always]);
    expect(t.actions[0].time).toBe(30007);
    expect(t.actions[1].time).toBe(0xffffffff);
    expect(r.strings).toEqual([{ text: "ab2" }]);
    expect(t.players[PlayerGroup.AllPlayers]).toBe(1);
  });

  it("raw numbers and raw forms pass through", () => {
    const r = compile(`
      trigger(3, [Deaths(7, 45, 10, 2), Condition(99, 1, 2, 3, 4, 5, 6)], [Action(200, 1, 2, 3, 4, 5, 6, 7, 8), CreateUnit(P1, Units.TerranMarine, "All", 5)], [0x40]);
    `);
    expect(r.diagnostics).toEqual([]);
    const t = r.triggers[0];
    expect(t.players[3]).toBe(1);
    expect(t.conditions[0]).toMatchObject({ type: ConditionType.Deaths, player: 7, unitId: 45, comparison: Comparison.Exactly, amount: 2 });
    expect(t.conditions[1]).toMatchObject({ type: 99, location: 1, player: 2, amount: 3, unitId: 4, comparison: 5, resource: 6 });
    expect(t.actions[0]).toMatchObject({ type: 200, location: 1, time: 4, player: 5, target: 6, unitId: 7, modifier: 8 });
    expect(r.strings).toEqual([{ index: 2 }, { index: 3 }]);
    expect(t.actions[0].text).toBe(1);
    expect(t.actions[0].wav).toBe(2);
    expect(t.actions[1].modifier).toBe(0);
    expect(t.actions[1].location).toBe(5);
    expect(t.flags).toBe(TriggerFlag.WaitSkipDisabled);
  });

  it("reports type errors and compiler errors with positions", () => {
    const r = compile(`trigger(P1, [Bring(P1, Locations.Anywhere, Units.TerranMarine, ">=", 1)], []);\ntrigger(P1, [], [Bring(P1, Units.AnyUnit, Locations.Anywhere, ">=", 1)]);`);
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.source === "typescript" && d.line === 1 && /LocationId/.test(d.message))).toBe(true);
    expect(r.diagnostics.some((d) => d.source === "compiler" && d.line === 2 && /Bring is a condition/.test(d.message))).toBe(true);
  });

  it("rejects what the raw level cannot express", () => {
    const r = compile(`let n = 1;\nfunction f() {}\nconst s = "x";\ntrigger(P1, [Bring(P1, Units.AnyUnit, Locations.Anywhere, ">=", 1)], [Wait(s as any), DisplayText("Always Display", "" + P1)]);\ntrigger(P1, [Always()], Array);`);
    const msgs = r.diagnostics.filter((d) => d.source === "compiler").map((d) => `${d.line}:${d.message}`);
    expect(msgs).toContain("1:Declare constants with const; variables belong to the structured level, which is not available yet.");
    expect(msgs).toContain("2:Only trigger(...) calls and const declarations are allowed at the top level.");
    expect(msgs.some((m) => m.startsWith("4:Expected a duration, got text."))).toBe(true);
    expect(msgs.some((m) => m.startsWith("5:Expected an array of actions."))).toBe(true);
    // "" + P1 folds to "0" — text is text.
    expect(r.strings).toEqual([{ text: "0" }]);
  });

  it("limits and unknown names", () => {
    const many = Array.from({ length: 17 }, () => "Always()").join(", ");
    const r = compile(`trigger(P1, [${many}], [Explode()]);\ntrigger(99, [], []);`);
    const msgs = r.diagnostics.filter((d) => d.source === "compiler").map((d) => d.message);
    expect(msgs).toContain("A trigger holds at most 16 conditions (got 17).");
    expect(msgs).toContain('Unknown action "Explode".');
    expect(msgs).toContain("Player group 99 is out of range (0–26).");
  });
});

describe("printer", () => {
  const ctx = { names: defaultScriptNames(), string: (i: number) => (i === 1 ? "hello" : null) };

  it("prints the sample as script that compiles back to itself", () => {
    const text = printTrigger(sample(), ctx);
    expect(text).toContain("trigger([P1, Players.Force2], [");
    expect(text).toContain('Bring(CurrentPlayer, Units.AnyUnit, Locations.Anywhere, "At least", 1),');
    expect(text).toContain('Switch(Switches.Switch4, "set"),');
    expect(text).toContain("disabled(PreserveTrigger()),");
    expect(text).toContain('RunAiScript(AiScripts.TerranCustomLevel),');
    expect(text).toContain('], ["Preserve"]);');
    const r = compile(printScript([sample()], ctx));
    expect(r.diagnostics).toEqual([]);
    expect(r.strings).toEqual([{ text: "hello" }]);
    expect(r.triggers).toEqual([sample()]);
  });

  it("prints unknown types and values as raw forms", () => {
    const t = emptyTrigger();
    t.actions.push({ ...emptyAction(), type: 200, location: 1, text: 2, wav: 3, time: 4, player: 5, target: 6, unitId: 7, modifier: 8 });
    t.conditions.push({ ...emptyCondition(), type: 99, location: 1, player: 2, amount: 3, unitId: 4, comparison: 5, resource: 6 });
    t.conditions.push({ ...emptyCondition(), type: ConditionType.Deaths, player: 40, unitId: 250, comparison: 7, amount: 1, flags: ConditionFlag.UnitTypeUsed });
    t.flags = 0x40 | 0x100;
    const text = printTrigger(t, ctx);
    expect(text).toContain("Condition(99, 1, 2, 3, 4, 5, 6)");
    expect(text).toContain("Action(200, 1, 2, 3, 4, 5, 6, 7, 8)");
    expect(text).toContain("Deaths(40, 250, 7, 1)");
    expect(text).toContain('["Wait Skip Disabled", 0x100]');
    const r = compile(printScript([t], ctx));
    expect(r.diagnostics).toEqual([]);
    expect(r.triggers[0].flags).toBe(t.flags);
    const scn = createScenario({ name: "x", description: "", width: 64, height: 64, tileset: 0 } as never);
    expect(encodeTriggers(resolveStrings(scn, r))).toEqual(encodeTriggers([t]));
  });
});

describe("build", () => {
  const fresh = () => createScenario({ name: "x", description: "", width: 64, height: 64, tileset: 0 } as never);

  it("appends a block, then replaces it in place, then relocates it", () => {
    const scn = fresh();
    applyTriggers(scn, [newTrigger([PlayerGroup.Player1])]);
    const src = 'trigger(P1, [Always()], [DisplayText("Always Display", "one")]);\n\ntrigger(P2, [Always()], [Victory()]);';
    const r = compile(src);
    expect(r.ok).toBe(true);
    let { extras, block } = buildScript(scn, new Map(), src, r);
    expect(block).toEqual({ start: 1, count: 2, lines: [1, 3] });
    expect(scn.triggers.length).toBe(3);
    expect(getString(scn.strings, scn.triggers[1].actions[0].text)).toBe("one");
    expect(readScript(extras)).toBe(src);
    expect(readManifest(extras)).toMatchObject({ version: 1, start: 1, count: 2 });
    expect(scriptState(scn, extras)).toMatchObject({ stale: false, block: { start: 1, count: 2 } });
    expect(triggerAtLine(block, 2)).toBe(1);
    expect(triggerAtLine(block, 3)).toBe(2);
    expect(triggerAtLine(block, 0)).toBe(null);

    // Rebuild with one trigger: the block shrinks in place.
    const src2 = "trigger(P3, [Always()], [Defeat()]);";
    ({ extras, block } = buildScript(scn, extras, src2, compile(src2)));
    expect(block).toEqual({ start: 1, count: 1, lines: [1] });
    expect(scn.triggers.length).toBe(2);
    expect(scn.triggers[1].players[2]).toBe(1);

    // A hand trigger inserted before the block: found by content, manifest relocated.
    applyTriggers(scn, insertTrigger(scn.triggers, 0, newTrigger([PlayerGroup.Player4])));
    expect(scriptState(scn, extras).block).toMatchObject({ start: 2, count: 1 });
    const moved = relocateScriptBlock(scn, extras)!;
    expect(readManifest(moved)!.start).toBe(2);
    expect(relocateScriptBlock(scn, moved)).toBe(null);

    // Editing inside the block makes it stale; the next build appends.
    scn.triggers[2].players[5] = 1;
    expect(scriptState(scn, moved)).toMatchObject({ stale: true, block: null });
    ({ extras, block } = buildScript(scn, moved, src2, compile(src2)));
    expect(block).toEqual({ start: 3, count: 1, lines: [1] });
    expect(scn.triggers.length).toBe(4);

    // Take-over: the whole list becomes the block.
    ({ extras, block } = buildScript(scn, extras, src, r, { takeOver: true }));
    expect(block).toEqual({ start: 0, count: 2, lines: [1, 3] });
    expect(scn.triggers.length).toBe(2);
    expect(hashTriggers(scn.triggers)).toBe(readManifest(extras)!.hash);
    expect(findBlock(scn.triggers, readManifest(extras)!)).toEqual({ start: 0, count: 2, lines: [1, 3] });
  });

  it("the source and manifest travel in the archive", async () => {
    const scn = fresh();
    const src = "trigger(P1, [Always()], [Victory()]);";
    const { extras } = buildScript(scn, new Map([["staredit\\wav\\a.wav", new Uint8Array([1, 2, 3])]]), src, compile(src));
    const chk = new Uint8Array([0, 0, 0, 0]);
    const back = await loadMap(await saveMap(chk, { extras }));
    const got = await readExtras(back.archive!, back.files);
    expect(readScript(got)).toBe(src);
    expect(readManifest(got)).toMatchObject({ start: 0, count: 1 });
    expect(got.get("staredit\\wav\\a.wav")).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("an empty script keeps an empty block", () => {
    const scn = fresh();
    const { extras, block } = buildScript(scn, new Map(), "", compile(""));
    expect(block).toEqual({ start: 0, count: 0, lines: [] });
    expect(scriptState(scn, extras)).toMatchObject({ stale: false, block: { start: 0, count: 0 } });
  });
});

const MAPS = join(import.meta.dirname, "..", "fixtures", "maps");
const mapFiles = existsSync(MAPS) ? readdirSync(MAPS).filter((f) => /\.sc[mx]$/i.test(f)) : [];

describe.skipIf(mapFiles.length === 0)("fixture maps", () => {
  for (const file of mapFiles) {
    it(`${file}: triggers eject to script and compile back`, async () => {
      const scn = parseScenario((await loadMap(new Uint8Array(readFileSync(join(MAPS, file))))).chk);
      if (!combine(scn.chk, "TRIG", "append")) return;
      const names = scriptNames(scn);
      const decls = generateDeclarations(names);
      const text = printScript(scn.triggers, { names, string: (i) => getString(scn.strings, i) });
      const r = compileScript(ts, text, decls);
      expect(r.diagnostics).toEqual([]);
      expect(r.triggers.length).toBe(scn.triggers.length);
      const hints = ConditionFlag.UnitPropertiesUsed | ConditionFlag.UnitTypeUsed | ConditionFlag.UnitIdUsed;
      const strip = (list: TriggerRecord[]) => list.map((t) => ({
        ...t,
        conditions: t.conditions.map((c) => ({ ...c, flags: c.flags & ~hints })),
        actions: t.actions.map((a) => ({ ...a, flags: a.flags & ~hints })),
      }));
      const back = resolveStrings(scn, r);
      // Compare through the text format so string indices that differ only by duplicates still agree.
      const tn = triggerNames(scn);
      const { formatTriggers } = await import("../src/formats/triggers/text");
      expect(formatTriggers(strip(back), tn)).toBe(formatTriggers(strip(scn.triggers), tn));
    });
  }
});
