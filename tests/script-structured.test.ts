/**
 * The structured level: programs compile to death-counter state machines, and the
 * simulator (a trigger-cycle interpreter) proves they behave — one loop iteration per
 * cycle, straight-line code within a cycle, saturating counters, switches as booleans.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  ActionType, Comparison, ConditionType, PlayerGroup, SetModifier, SwitchState, TriggerFlag, type ConditionRecord, type TriggerRecord,
} from "../src/formats/chk/sections/triggers";
import { generateDeclarations } from "../src/script/declarations";
import { compileScript, DEATHS_TABLE_ADDRESS, type CompileOptions, type CompileResult } from "../src/script/compiler";
import { negateCondition, toDnf, cond, not, and, or, TRUE, FALSE, VARIABLE_UNITS } from "../src/script/lower";
import { Simulation } from "../src/script/simulate";
import { createScenario } from "../src/formats/chk/create";
import { buildScript, reservedStorage, resolveStrings } from "../src/editor/script";
import { applyTriggers, newTrigger } from "../src/editor/triggers";
import { unitName } from "../src/data/units";

const DECLS = generateDeclarations();
const compile = (src: string, options?: CompileOptions) => compileScript(ts, src, DECLS, options);

function ok(src: string, options?: CompileOptions): CompileResult {
  const r = compile(src, options);
  expect(r.diagnostics).toEqual([]);
  return r;
}

function run(r: CompileResult, cycles: number, extra: ConstructorParameters<typeof Simulation>[1] = {}): Simulation {
  return new Simulation(r.triggers, { strings: r.strings, ...extra }).run(cycles);
}

/** The value of a program variable after a simulation. */
function value(sim: Simulation, r: CompileResult, name: string): number {
  const v = r.variables.find((x) => x.name === name)!;
  return v.kind === "number" ? sim.death(v.player!, v.unit!) : sim.switches[v.switch!];
}

const texts = (sim: Simulation) => sim.events.filter((e) => e.action.type === ActionType.DisplayText).map((e) => `${e.cycle}:${e.text}`);

describe("structured: loops and branches", () => {
  it("a game loop runs once per cycle", () => {
    const r = ok(`
      let n = 0;
      while (true) {
        n += 1;
        if (n == 3) { Victory(); }
      }
    `);
    expect(r.program).toMatchObject({ owner: 0, start: 0, hyperTriggers: false });
    expect(r.variables.map((v) => v.name)).toEqual(["(program counter)", "n"]);
    expect(r.variables[0]).toMatchObject({ kind: "number", player: 0, unit: 181, storage: "P1 · Cantina (Unused)" });
    expect(r.variables[1]).toMatchObject({ player: 1, unit: 181 });
    // Every trigger is preserved, owned by P1, and tests the program counter first.
    for (const t of r.triggers) {
      expect(t.flags).toBe(TriggerFlag.Preserve);
      expect(t.players[PlayerGroup.Player1]).toBe(1);
      expect(t.conditions[0]).toMatchObject({ type: ConditionType.Deaths, player: 0, unitId: 181, comparison: Comparison.Exactly });
      expect(t.actions[0].type).toBe(ActionType.Comment);
    }
    expect(r.strings.map((s) => "text" in s && s.text)).toContain("L4: n += 1");
    const sim = run(r, 6);
    expect(sim.events.map((e) => `${e.cycle}:${ActionType.Victory === e.action.type ? "Victory" : e.action.type}`)).toEqual(["2:Victory"]);
    expect(value(sim, r, "n")).toBe(6);
  });

  it("if / else if / else, nested", () => {
    const r = ok(`
      let n = 0;
      let out = 0;
      while (true) {
        if (n == 0) { out = 10; }
        else if (n == 1) { out = 20; if (out >= 20) { out += 1; } }
        else { out = 30; }
        DisplayText("Always Display", "tick");
        n++;
      }
    `);
    const sim = new Simulation(r.triggers, { strings: r.strings });
    const outs: number[] = [];
    for (let i = 0; i < 4; i++) { sim.step(); outs.push(value(sim, r, "out")); }
    expect(outs).toEqual([10, 21, 30, 30]);
    expect(texts(sim)).toEqual(["0:tick", "1:tick", "2:tick", "3:tick"]);
  });

  it("for with break and continue; the code after the loop runs the cycle it exits", () => {
    const r = ok(`
      let sum = 0;
      for (let i = 0; i < 10; i++) {
        if (i == 2) continue;
        if (i == 5) break;
        sum += i;
      }
      DisplayText("Always Display", "done");
    `);
    const sim = run(r, 8);
    expect(texts(sim)).toEqual(["5:done"]);
    expect(value(sim, r, "sum")).toBe(8);
    expect(value(sim, r, "i")).toBe(5);
    // Halted: the program counter sits on a state no trigger tests.
    expect(sim.death(0, 181)).toBe(0xffffffff);
  });

  it("do … while and while (cond) with a variable condition", () => {
    const r = ok(`
      let n = 0;
      do { n++; } while (n < 3);
      let m = 10;
      while (m > 7) { m--; }
      Victory();
    `);
    const sim = run(r, 10);
    expect(sim.events.map((e) => e.cycle)).toEqual([5]);
    expect(value(sim, r, "n")).toBe(3);
    expect(value(sim, r, "m")).toBe(7);
  });

  it("an endless loop needs no halt and the first loop needs no jump", () => {
    const r = ok(`while (true) { Wait(100); }`);
    expect(r.triggers.length).toBe(1);
    expect(r.triggers[0].conditions).toEqual([expect.objectContaining({ amount: 0 })]);
    expect(r.triggers[0].actions.map((a) => a.type)).toEqual([ActionType.Comment, ActionType.Wait, ActionType.SetDeaths]);
    expect(run(r, 3).events.length).toBe(3);
  });
});

describe("structured: arithmetic", () => {
  it("copies, adds and subtracts between variables within one cycle", () => {
    const r = ok(`
      let a = 5;
      let b = 0;
      b = a;
      a += b;
      a = a - b + 2;
      b = a + b;
      let c = b - a;
      let d = a;
      d = 100 - d;
      if (a == 7 && b == 12 && c == 5 && d == 93) { Victory(); }
    `);
    const sim = run(r, 1);
    expect([value(sim, r, "a"), value(sim, r, "b"), value(sim, r, "c"), value(sim, r, "d")]).toEqual([7, 12, 5, 93]);
    expect(sim.events.map((e) => e.action.type)).toEqual([ActionType.Victory]);
    // Temporaries are zero again.
    for (const v of r.variables) if (v.name.startsWith("(temporary")) expect(sim.death(v.player!, v.unit!)).toBe(0);
  });

  it("x += x, x -= x, ++ / --, saturation and wrap", () => {
    const r = ok(`
      let x = 6;
      x += x;
      let y = x;
      y -= y;
      let z = 3;
      z -= 5;
      let w = 4294967295;
      w += 1;
      x++;
      x--;
      x--;
    `);
    const sim = run(r, 1);
    expect([value(sim, r, "x"), value(sim, r, "y"), value(sim, r, "z"), value(sim, r, "w")]).toEqual([11, 0, 0, 0]);
  });

  it("constant folding still works and consts stay constants", () => {
    const r = ok(`
      const k = 2 * 3;
      let x = k + 1;
      x += k * 2;
      if (x >= k * 3) { Victory(); }
    `);
    const sim = run(r, 1);
    expect(value(sim, r, "x")).toBe(19);
    expect(sim.events.length).toBe(1);
    // No temporaries were needed.
    expect(r.variables.map((v) => v.name)).toEqual(["(program counter)", "x"]);
  });
});

describe("structured: conditions", () => {
  it("compares variables with constants through one Deaths condition each", () => {
    const r = ok(`
      let x = 4;
      if (x >= 4) DisplayText("Always Display", "ge");
      if (x > 4) DisplayText("Always Display", "gt");
      if (x <= 4) DisplayText("Always Display", "le");
      if (x < 4) DisplayText("Always Display", "lt");
      if (x == 4) DisplayText("Always Display", "eq");
      if (x != 4) DisplayText("Always Display", "ne");
      if (5 > x) DisplayText("Always Display", "flip");
      if (x + 1 == 5) DisplayText("Always Display", "shift");
      if (x >= -1) DisplayText("Always Display", "unsigned");
      if (!(x < 4)) DisplayText("Always Display", "neg");
    `);
    expect(r.variables.map((v) => v.name)).toEqual(["(program counter)", "x"]);
    expect(texts(run(r, 1))).toEqual(["0:ge", "0:le", "0:eq", "0:flip", "0:shift", "0:unsigned", "0:neg"]);
    const ge = r.triggers.find((t) => t.conditions[1]?.amount === 4 && t.conditions[1].comparison === Comparison.AtLeast);
    expect(ge).toBeDefined();
  });

  it("compares variables with variables through saturating differences", () => {
    const r = ok(`
      let a = 3;
      let b = 5;
      if (a < b) DisplayText("Always Display", "lt");
      if (a >= b) DisplayText("Always Display", "ge");
      if (a == b) DisplayText("Always Display", "eq");
      if (a != b) DisplayText("Always Display", "ne");
      if (a + 2 == b) DisplayText("Always Display", "eq2");
      if (b - a > 1) DisplayText("Always Display", "gt");
      if (a <= b && b >= a) DisplayText("Always Display", "both");
      if (a - b == 0) DisplayText("Always Display", "never");
    `);
    const sim = run(r, 1);
    expect(texts(sim)).toEqual(["0:lt", "0:ne", "0:eq2", "0:gt", "0:both"]);
    expect([value(sim, r, "a"), value(sim, r, "b")]).toEqual([3, 5]);
  });

  it("booleans are switches; random() is a randomized switch", () => {
    const r = ok(`
      let x = 2;
      let f = false;
      let g = true;
      f = !f;
      if (f && g) DisplayText("Always Display", "both");
      if (f == g) DisplayText("Always Display", "same");
      g = x < 2;
      if (f != g) DisplayText("Always Display", "differ");
      if (!(f || g)) DisplayText("Always Display", "neither");
      g = x >= 2 || f;
      if (g) DisplayText("Always Display", "computed");
      let r = random();
      if (r) DisplayText("Always Display", "heads");
      if (random() && random()) DisplayText("Always Display", "twice");
      f = random();
    `);
    const f = r.variables.find((v) => v.name === "f")!;
    expect(f).toMatchObject({ kind: "boolean", switch: 255, storage: "Switch 256" });
    expect(r.variables.filter((v) => v.name.startsWith("(scratch")).length).toBe(2);
    expect(texts(run(r, 1, { random: () => 0.9 }))).toEqual(["0:both", "0:same", "0:differ", "0:computed", "0:heads", "0:twice"]);
    expect(texts(run(r, 1, { random: () => 0.1 }))).toEqual(["0:both", "0:same", "0:differ", "0:computed"]);
    const toggle = r.triggers.flatMap((t) => t.actions).find((a) => a.type === ActionType.SetSwitch && a.target === 255 && a.modifier === 6);
    expect(toggle).toBeDefined();
  });

  it("trigger conditions, negated where the game can and skipped where it cannot", () => {
    const r = ok(`
      const marines = Bring(P1, Units.TerranMarine, Locations.Anywhere, ">=", 1);
      if (!marines) DisplayText("Always Display", "none");
      if (marines) DisplayText("Always Display", "some");
      if (!CommandTheMost(Units.TerranMarine) && Always()) DisplayText("Always Display", "skip");
      if (CommandTheMost(Units.TerranMarine) || Switch(Switches.Switch1, "set")) DisplayText("Always Display", "or");
      if (!(Bring(P1, Units.AnyUnit, Locations.Anywhere, "Exactly", 3))) DisplayText("Always Display", "notExactly");
    `);
    const flipped = r.triggers.flatMap((t) => t.conditions).find((c) => c.type === ConditionType.Bring && c.comparison === Comparison.AtMost);
    expect(flipped).toMatchObject({ amount: 0, unitId: 0 });
    const exactly = r.triggers.flatMap((t) => t.conditions).filter((c) => c.type === ConditionType.Bring && c.unitId === 228);
    expect(exactly.map((c) => [c.comparison, c.amount])).toEqual([[Comparison.AtMost, 2], [Comparison.AtLeast, 4]]);
    // No units on the map: every "at most" holds, every "at least" fails.
    const sim = run(r, 1, { condition: (c) => c.type === ConditionType.Bring && c.comparison === Comparison.AtMost });
    expect(texts(sim)).toEqual(["0:none", "0:skip", "0:notExactly"]);
    // One marine on the map, and switch 1 set.
    const marine = (c: ConditionRecord) => c.type === ConditionType.Bring && (c.unitId === 0 ? c.comparison === Comparison.AtLeast && c.amount <= 1 : c.comparison === Comparison.AtMost && c.amount >= 1);
    const sim2 = new Simulation(r.triggers, { strings: r.strings, condition: marine });
    sim2.switches[0] = 1;
    sim2.run(1);
    expect(texts(sim2)).toEqual(["0:some", "0:skip", "0:or", "0:notExactly"]);
  });

  it("DNF: negation pushes to leaves, and/or distribute", () => {
    const a = cond({ type: ConditionType.Switch, resource: 1, comparison: SwitchState.Set } as ConditionRecord);
    const b = cond({ type: ConditionType.Always } as ConditionRecord);
    expect(toDnf(and([or([a, b]), or([a, b])])).length).toBe(4);
    expect(toDnf(not(and([a, b])))).toEqual([[{ cond: expect.objectContaining({ comparison: SwitchState.Cleared }), negative: false }], [{ cond: expect.objectContaining({ type: ConditionType.Never }), negative: false }]]);
    expect(toDnf(TRUE)).toEqual([[]]);
    expect(toDnf(not(FALSE))).toEqual([[]]);
    expect(toDnf(and([a, FALSE]))).toEqual([]);
    const most = { type: ConditionType.CommandTheMost, unitId: 0 } as ConditionRecord;
    expect(negateCondition(most)).toBe(null);
    expect(toDnf(not(cond(most)))).toEqual([[{ cond: most, negative: true }]]);
    expect(negateCondition({ type: ConditionType.Deaths, comparison: Comparison.AtLeast, amount: 0 } as ConditionRecord)).toEqual([expect.objectContaining({ type: ConditionType.Never })]);
  });
});

describe("structured: functions", () => {
  it("inline with constant and by-reference parameters, defaults and return", () => {
    const r = ok(`
      let total = 0;
      function add(v: number, n: number = 2) {
        if (n == 0) return;
        v += n;
      }
      function spawn(p: PlayerId, count: number) {
        CreateUnit(p, Units.ZergZergling, count, Locations.Anywhere);
        add(total, count);
      }
      add(total, 5);
      add(total);
      spawn(P2, 4);
      if (total == 11) Victory();
    `);
    const sim = run(r, 1);
    expect(value(sim, r, "total")).toBe(11);
    expect(sim.events.map((e) => e.action.type)).toEqual([ActionType.CreateUnit, ActionType.Victory]);
    expect(sim.events[0].action).toMatchObject({ player: 1, unitId: 37, modifier: 4 });
  });

  it("locals inside functions get their own storage per call", () => {
    const r = ok(`
      let out = 0;
      function twice(n: number) {
        let t = n;
        t += t;
        out += t;
      }
      twice(3);
      twice(4);
    `);
    expect(value(run(r, 1), r, "out")).toBe(14);
    expect(r.variables.filter((v) => v.name === "t").length).toBe(2);
  });
});

describe("structured: program options and layout", () => {
  it("owner, hyper triggers, comments off; raw triggers come first", () => {
    const r = ok(`
      program({ owner: P8, hyperTriggers: true, comments: false });
      trigger(AllPlayers, [Always()], [Defeat()]);
      let n = 0;
      while (true) { n++; if (n == 2) Victory(); }
    `);
    expect(r.program).toMatchObject({ owner: 7, start: 1, hyperTriggers: true });
    expect(r.triggers[0].actions[0].type).toBe(ActionType.Defeat);
    const hyper = r.triggers.slice(-3);
    for (const t of hyper) {
      expect(t.players[7]).toBe(1);
      expect(t.actions.length).toBe(64);
      expect(t.actions.filter((a) => a.type === ActionType.Wait && a.time === 0).length).toBe(63);
      expect(t.actions[63].type).toBe(ActionType.PreserveTrigger);
    }
    for (const t of r.triggers.slice(1, -3)) {
      expect(t.players[7]).toBe(1);
      expect(t.actions.some((a) => a.type === ActionType.Comment)).toBe(false);
    }
    expect(r.strings).toEqual([]);
    expect(r.lines.length).toBe(r.triggers.length);
    const sim = run(r, 3, { player: 7 });
    expect(sim.events.filter((e) => e.action.type === ActionType.Victory).map((e) => e.cycle)).toEqual([1]);
  });

  it("hyper triggers on another player, variableUnits override", () => {
    const r = ok(`
      program({ hyperTriggers: P4, variableUnits: [Units.ZergBeacon, Units.TerranBeacon] });
      let a = 0;
    `);
    expect(r.triggers.slice(-3).every((t) => t.players[3] === 1)).toBe(true);
    expect(r.variables[0]).toMatchObject({ unit: 194, player: 0 });
    expect(r.variables[1]).toMatchObject({ unit: 194, player: 1 });
  });

  it("variables avoid the death counters and switches hand triggers use", () => {
    const scn = createScenario({ name: "x", description: "", width: 64, height: 64, tileset: 0 } as never);
    const hand = newTrigger([PlayerGroup.Player1]);
    hand.conditions.push({ type: ConditionType.Deaths, player: 0, unitId: 181, comparison: 0, amount: 1, location: 0, resource: 0, flags: 0, mask: 0 });
    hand.actions.push({ type: ActionType.SetSwitch, target: 255, modifier: 4, location: 0, text: 0, wav: 0, time: 0, player: 0, unitId: 0, flags: 0, padding: 0, mask: 0 });
    applyTriggers(scn, [hand]);
    const reserved = reservedStorage(scn, null);
    expect(reserved).toEqual({ reservedDeaths: [[0, 181]], reservedSwitches: [255] });
    const r = ok("let n = 0;\nlet f = true;", reserved);
    expect(r.variables.map((v) => [v.player, v.unit, v.switch])).toEqual([[1, 181, undefined], [2, 181, undefined], [undefined, undefined, 254]]);
    // The whole thing builds into the map: comments intern, the block is the program.
    const { block } = buildScript(scn, new Map(), "let n = 0;\nlet f = true;", r);
    expect(block).toMatchObject({ start: 1, count: r.triggers.length });
    expect(scn.triggers[1].actions[0].type).toBe(ActionType.Comment);
    expect(resolveStrings(scn, r)[0].actions[0].text).toBeGreaterThan(0);
  });

  it("the default storage pool is made of units that cannot die", () => {
    for (const u of VARIABLE_UNITS) expect(unitName(u)).toMatch(/Unused/);
  });

  it("Memory / SetMemory are Deaths at the EPD player", () => {
    const r = ok(`trigger(P1, [Memory(${DEATHS_TABLE_ADDRESS} + 8, ">=", 1)], [SetMemory(0x6509B0, "Set To", 5)]);`);
    expect(r.triggers[0].conditions[0]).toMatchObject({ type: ConditionType.Deaths, player: 2, unitId: 0, comparison: Comparison.AtLeast, amount: 1 });
    expect(r.triggers[0].actions[0]).toMatchObject({ type: ActionType.SetDeaths, player: (0x6509b0 - DEATHS_TABLE_ADDRESS) / 4, unitId: 0, modifier: SetModifier.SetTo, target: 5 });
    const bad = compile("trigger(P1, [Memory(3, \">=\", 1)], []);");
    expect(bad.diagnostics.map((d) => d.message)).toContain("Expected a 4-byte-aligned memory address.");
  });
});

describe("structured: diagnostics", () => {
  const messages = (src: string) => compile(src).diagnostics.filter((d) => d.source === "compiler").map((d) => `${d.line}:${d.message}`);

  it("what the game cannot do", () => {
    const msgs = messages(`
      let x = 1;
      let y = 2;
      x *= 2;
      x = x * y;
      Wait(x);
      let s = "text";
      function f() { f(); }
      f();
      function g() { return 1; }
      g();
      break;
      if (x) { trigger(P1, [], []); }
      program({ owner: AllPlayers });
      switch (x) { default: }
    `);
    expect(msgs).toContain("4:The game can only add and subtract: there is no multiplication or division between variables.");
    expect(msgs).toContain("5:The game can only add and subtract variables; use * / % on constants only.");
    expect(msgs).toContain("6:x is a variable; this argument must be a constant. Compare or assign it in structured code instead.");
    expect(msgs.some((m) => m.startsWith("7:Variables hold numbers (death counters) or booleans (switches); s is string"))).toBe(true);
    expect(msgs).toContain("8:Functions nest too deeply (recursion is not possible: a call is inlined).");
    expect(msgs).toContain("10:Functions cannot return values; write the result into a variable instead.");
    expect(msgs).toContain("12:break outside a loop.");
    expect(msgs).toContain("13:trigger() is a top-level declaration; it cannot run inside structured code.");
    expect(msgs).toContain("14:The owner must be a single player, P1 … P12: the program is one thread running as that player.");
    expect(msgs).toContain("15:switch is not supported; use if / else if.");
  });

  it("type errors still come from TypeScript", () => {
    const r = compile("let n = 0;\nn = true;\nif (n == \"3\") Victory();");
    expect(r.diagnostics.filter((d) => d.source === "typescript").map((d) => d.line)).toEqual([2, 3]);
  });

  it("a script with only raw triggers has no program", () => {
    const r = ok("trigger(P1, [Always()], [Victory()]);");
    expect(r.program).toBe(null);
    expect(r.variables).toEqual([]);
    expect(r.triggers.length).toBe(1);
  });
});

describe("simulator", () => {
  it("runs a trigger once unless preserved, honours disabled and All Players", () => {
    const once = newTrigger([PlayerGroup.Player1]);
    once.conditions.push({ type: ConditionType.Always, location: 0, player: 0, amount: 0, unitId: 0, comparison: 0, resource: 0, flags: 0, mask: 0 });
    once.actions.push({ type: ActionType.Victory, location: 0, text: 0, wav: 0, time: 0, player: 0, target: 0, unitId: 0, modifier: 0, flags: 0, padding: 0, mask: 0 });
    const kept: TriggerRecord = { ...once, conditions: once.conditions.map((c) => ({ ...c })), actions: once.actions.map((a) => ({ ...a })), players: once.players.slice(), flags: TriggerFlag.Preserve };
    const off: TriggerRecord = { ...kept, players: kept.players.slice(), flags: TriggerFlag.Preserve | TriggerFlag.Disabled };
    const all = newTrigger([PlayerGroup.AllPlayers]);
    all.conditions.push({ ...once.conditions[0] });
    all.actions.push({ ...once.actions[0], type: ActionType.Defeat });
    const sim = new Simulation([once, kept, off, all], { player: 3 }).run(3);
    expect(sim.events.map((e) => `${e.cycle}:${e.trigger}`)).toEqual(["0:3"]);
    const sim2 = new Simulation([once, kept, off, all]).run(3);
    expect(sim2.player).toBe(0);
    expect(sim2.events.map((e) => `${e.cycle}:${e.trigger}`)).toEqual(["0:0", "0:1", "0:3", "1:1", "2:1"]);
  });
});
