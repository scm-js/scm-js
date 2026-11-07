/**
 * `scmjs map test <map> [tests…]`: unit tests for a map's triggers, played in the game itself. A tests file (JSON,
 * `<map>.tests.json` beside the map unless others are named) holds scenarios: what the game starts with (units made,
 * switches set, resources given), what happens at a time (units killed, a switch flipped, the person's units ordered
 * somewhere, a chat line), how long it runs, and what must hold at the end (a trigger fired or never did, a switch, a
 * death count, units in a location, a line shown, who won). Each scenario is one game.
 *
 * The setup and the timed effects become triggers of a copy of the map, written here with the editor's code: the setup
 * one trigger before the map's own (owned by the first player in the game, so it runs first in the first pass), each
 * timed effect one after them on an Elapsed Time condition. So the game's replay — saved for every scenario that
 * fails — holds them too, and plays back as the test ran. The person's own commands and what stands at the end are the
 * map runner's (scm-sim's `src/exact/mapTest.ts`, `runMap.ts --test`): the commands handed over at their frames as
 * the play page hands them, the end read with the game's own Bring and Command conditions.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { createInterface } from "node:readline";
import { readArchive, writeArchiveBytes } from "../../src/editor/mapFile";
import { mapVersionOf, parseScenario, serializeScenario, type Scenario } from "../../src/formats/chk/scenario";
import { changeMapVersion } from "../../src/editor/settings";
import { applyTriggers, newAction, newCondition, newTrigger, readTriggers, triggerNames } from "../../src/editor/triggers";
import { parseTriggers, triggerComment, TriggerTextError, type TriggerNames } from "../../src/formats/triggers/text";
import { ActionType, Comparison, ConditionType, PlayerGroup, ResourceType, SetModifier, SwitchAction, UnitClass, type ActionRecord, type TriggerRecord } from "../../src/formats/chk/sections/triggers";
import { PlayerType } from "../../src/formats/chk/sections/players";
import { conditionDef } from "../../src/data/triggerDefs";
import { plainText } from "../../src/editor/textColors";
import { ensureEngine, findGameCopy, runnerFor, startRunner } from "./engine";
import { unitByName } from "./rush";
import { summarizeRows, type CopyLine } from "./trace";
import { CliError, dot, mark, num, pc, plural } from "./ui";

/* ── The runner's lines (scm-sim's src/exact/mapTest.ts, through runMap.ts --test) ──────── */

/** One of the person's commands, as the runner takes it. */
export type RunnerStep =
  | { frame: number; kind: "order"; order: OrderKind; unit: number; location: number; to: number }
  | { frame: number; kind: "chat"; text: string };
export interface RunnerCount { player: number; unit: number; location: number }
/** What the runner is handed for one scenario (`--test <file>`). */
export interface RunnerSpec { frames: number; steps: RunnerStep[]; counts: RunnerCount[] }

export interface TestStartLine { kind: "start"; mode?: "test"; map: { name: string; width: number; height: number; tileset: string }; copy: string; seed: number; rows: number; copies: number; remastered: boolean; localPlayer: number; ms: { load: number; start: number } }
export interface Observed {
  switches: number[];
  deaths: [number, number, number][];
  resources: [number, number][];
  counts: number[];
  texts: { frame: number; text: string }[];
  outcomes: ("victory" | "defeat" | "draw" | null)[];
  steps: { frame: number; kind: string; units?: number }[];
}
export interface TestEndLine { kind: "end"; mode?: "test"; frame: number; ended: boolean; reason: string | null; passes: number; trace: CopyLine[]; observed: Observed; replay: string | null; ms: { load: number; start: number; game: number; total: number } }
type RunnerLine = TestStartLine | TestEndLine | { kind: "error"; message: string } | { kind: "progress" };

/* ── The tests file ─────────────────────────────────────────── */

export type OrderKind = "move" | "attack" | "patrol" | "stop" | "hold";
const ORDERS: readonly OrderKind[] = ["move", "attack", "patrol", "stop", "hold"];
export type Op = "=" | "!=" | "<" | "<=" | ">" | ">=";
export interface Compare { op: Op; n: number }

/** One thing a scenario expects at the end, resolved against the map. */
export type Expectation = { what: string } & (
  | { kind: "trigger"; row: number; fired: Compare }
  | { kind: "switch"; index: number; set: boolean }
  | { kind: "deaths"; player: number; unit: number; is: Compare }
  | { kind: "minerals" | "gas"; player: number; is: Compare }
  | { kind: "units"; query: number; is: Compare }
  | { kind: "text"; text: string; shown: boolean }
  | { kind: "outcome"; player: number; is: "victory" | "defeat" | "draw" | null }
  | { kind: "ended"; ended: boolean }
);

/** A scenario made ready to run: the map copy's triggers, the runner's spec, the expectations. */
export interface PlannedScenario {
  name: string;
  /** The tests file it came from, and the line its name is on (for CI's annotations). */
  file: string;
  line: number | null;
  frames: number;
  seed: number;
  /** The scenario's triggers: the setup's (before the map's own) and the timed effects' (after them). */
  before: TriggerRecord[];
  after: TriggerRecord[];
  /** The map's own trigger rows. */
  rows: number;
  spec: RunnerSpec;
  expect: Expectation[];
  /** The copy of the map's scenario with the scenario's triggers in: what the game is handed. */
  scenario: Scenario;
  /** The map is in the StarCraft 1.00 form, and the copy was converted to Brood War, as `map trace` runs one. */
  converted: boolean;
}

type Raw = Record<string, unknown>;
const isObject = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
/** Frames from a number, or `m:ss` of play at Fastest (24 frames a second). */
export function framesOf(v: unknown, where: string): number {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  const m = typeof v === "string" ? /^(\d+):([0-5]\d)$/.exec(v.trim()) : null;
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 24;
  throw bad(where, `takes frames (24 a second) or m:ss, not ${JSON.stringify(v)}`);
}
const bad = (where: string, message: string) => new CliError(`${where}: ${message}`, null, 2);

/** A comparison: a number (exactly), or a string such as ">= 3"; true is "at least 1", false "0". */
export function compareOf(v: unknown, where: string): Compare {
  if (v === true) return { op: ">=", n: 1 };
  if (v === false || v === "never") return { op: "=", n: 0 };
  if (typeof v === "number" && Number.isInteger(v)) return { op: "=", n: v };
  const m = typeof v === "string" ? /^\s*(==|=|!=|<=|>=|<|>)?\s*(-?\d+)\s*$/.exec(v) : null;
  if (m) return { op: (m[1] === "==" ? "=" : m[1] ?? "=") as Op, n: Number(m[2]) };
  throw bad(where, `takes a number or a comparison such as ">= 3", not ${JSON.stringify(v)}`);
}
export function holds(c: Compare, x: number): boolean {
  switch (c.op) { case "=": return x === c.n; case "!=": return x !== c.n; case "<": return x < c.n; case "<=": return x <= c.n; case ">": return x > c.n; case ">=": return x >= c.n; }
}
/** A comparison in words: "at least 3", "exactly 0", "fewer than 2". */
export function compareWords(c: Compare): string {
  return { "=": "exactly", "!=": "not", "<": "fewer than", "<=": "at most", ">": "more than", ">=": "at least" }[c.op] + ` ${num(c.n)}`;
}
const firedWords = (c: Compare) => (c.op === ">=" && c.n === 1 ? "fired" : c.op === "=" && c.n === 0 ? "never fired" : `fired ${compareWords(c).replace(/ 1$/, " once")}${c.n === 1 ? "" : " times"}`);

/** Reading the map's names, for one scenario's copy of it. */
class Names {
  readonly t: TriggerNames;
  readonly scn: Scenario;
  readonly rows: number;
  constructor(scn: Scenario, rows: number) { this.scn = scn; this.rows = rows; this.t = triggerNames(scn); }

  /** A player (0–11) or, with `groups`, a group as a condition or action names one. */
  player(v: unknown, where: string, groups = false): number {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 12) return v - 1;
    const s = typeof v === "string" ? v.trim().toLowerCase() : "";
    const m = /^(?:p|player\s*)(\d{1,2})$/.exec(s);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return Number(m[1]) - 1;
    if (groups) {
      const f = /^force\s*([1-4])$/.exec(s);
      if (f) return PlayerGroup.Force1 + Number(f[1]) - 1;
      const g = ({ "all players": PlayerGroup.AllPlayers, all: PlayerGroup.AllPlayers, foes: PlayerGroup.Foes, allies: PlayerGroup.Allies, "neutral players": PlayerGroup.NeutralPlayers, "current player": PlayerGroup.CurrentPlayer } as Record<string, number>)[s];
      if (g !== undefined) return g;
    }
    throw bad(where, `takes a player, 1 to 12 or "Player 1"${groups ? ', or "All Players", "Force 1"…' : ""}, not ${JSON.stringify(v)}`);
  }
  playerName(p: number): string {
    return p < 12 ? `Player ${p + 1}` : p === PlayerGroup.AllPlayers ? "All Players" : p >= PlayerGroup.Force1 && p <= PlayerGroup.Force4 ? `Force ${p - PlayerGroup.Force1 + 1}` : ({ [PlayerGroup.Foes]: "Foes", [PlayerGroup.Allies]: "Allies", [PlayerGroup.NeutralPlayers]: "Neutral Players", [PlayerGroup.CurrentPlayer]: "Current Player" } as Record<number, string>)[p] ?? `group ${p}`;
  }
  /** A unit type or class: the trigger window's name ("Terran Marine", "Any unit", "Men"), without the race, or a units.dat id. */
  unit(v: unknown, where: string): number {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= UnitClass.Factories) return v;
    if (typeof v !== "string") throw bad(where, `takes a unit's name, not ${JSON.stringify(v)}`);
    const known = this.t.unitByName(v);
    if (known !== undefined) return known;
    try { return unitByName(v); } catch (e) { throw bad(where, e instanceof Error ? e.message : String(e)); }
  }
  unitName(u: number): string { return this.t.unit(u); }
  /** A location, 1-based: its name in the map, "Anywhere", or its number. */
  location(v: unknown, where: string): number {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 255) return v;
    const n = typeof v === "string" ? this.t.locationByName(v) : undefined;
    if (n !== undefined) return n;
    const names = this.scn.locations.map((_, i) => this.t.location(i + 1)).filter((s, i) => i !== 63 && this.scn.locations[i] && !/^Location \d+$/.test(s));
    throw bad(where, `the map has no location ${JSON.stringify(v)}${names.length ? ` (it has ${names.slice(0, 8).map((s) => `"${s}"`).join(", ")}${names.length > 8 ? ", …" : ""})` : ""}`);
  }
  locationName(l: number): string { return this.t.location(l); }
  /** A switch, 0-based: its name, "Switch 3", or its number from 1. */
  switch(v: unknown, where: string): number {
    if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 256) return v - 1;
    const n = typeof v === "string" ? this.t.switchByName(v) : undefined;
    if (n !== undefined) return n;
    throw bad(where, `the map has no switch ${JSON.stringify(v)}: name one as the trigger window does, or by number from 1 to 256`);
  }
  switchName(i: number): string { return this.t.switch(i); }
  /** One of the map's triggers, 0-based: its number as `map trace` prints it, or the text of its Comment. */
  trigger(v: unknown, where: string): number {
    if (typeof v === "number" && Number.isInteger(v)) {
      if (v >= 1 && v <= this.rows) return v - 1;
      throw bad(where, `the map has ${plural(this.rows, "trigger")}: ${v} is not one of them`);
    }
    if (typeof v === "string") {
      const key = v.trim().toLowerCase(), list = readTriggers(this.scn).slice(0, this.rows);
      const rows = list.map((t, i) => [i, triggerComment(t, this.t)?.trim().toLowerCase()] as const).filter(([, c]) => c === key);
      if (rows.length === 1) return rows[0][0];
      if (rows.length > 1) throw bad(where, `${rows.length} triggers have the comment ${JSON.stringify(v)} (#${rows.map(([i]) => i + 1).join(", #")}): name one by number`);
      const m = /^#?(\d+)$/.exec(key);
      if (m) return this.trigger(Number(m[1]), where);
      const comments = list.map((t) => triggerComment(t, this.t)).filter((c): c is string => !!c);
      throw bad(where, `no trigger has the comment ${JSON.stringify(v)}${comments.length ? ` (the map's comments: ${comments.slice(0, 6).map((c) => JSON.stringify(c)).join(", ")}${comments.length > 6 ? ", …" : ""})` : " — the map's triggers have no comments; name one by its number, as map trace prints it"}`);
    }
    throw bad(where, `takes a trigger's number or its comment, not ${JSON.stringify(v)}`);
  }
  triggerLabel(row: number): string {
    const c = triggerComment(readTriggers(this.scn)[row], this.t);
    return `trigger #${row + 1}${c ? ` "${c}"` : ""}`;
  }
}

/** An amount an action sets: a number sets it, "+n" adds and "-n" subtracts. */
function amountOf(v: unknown, where: string): { modifier: number; amount: number } {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return { modifier: SetModifier.SetTo, amount: v };
  const m = typeof v === "string" ? /^\s*([+-])?\s*(\d+)\s*$/.exec(v) : null;
  if (m) return { modifier: m[1] === "+" ? SetModifier.Add : m[1] === "-" ? SetModifier.Subtract : SetModifier.SetTo, amount: Number(m[2]) };
  throw bad(where, `takes an amount: a number to set, "+n" to add or "-n" to take away, not ${JSON.stringify(v)}`);
}
/** How many units an action takes: a number, or "all" (the game's 0). */
function countOf(v: unknown, where: string, all: boolean): number {
  if (v === undefined) return all ? 0 : 1;
  if (all && (v === "all" || v === "All")) return 0;
  if (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 255) return v;
  throw bad(where, `takes a count from 1 to 255${all ? ' or "all"' : ""}, not ${JSON.stringify(v)}`);
}

/** The verbs an action (setup or a step) is written with; one per entry. */
const ACTION_VERBS = ["create", "kill", "remove", "give", "switch", "minerals", "gas", "deaths", "action"] as const;
const STEP_VERBS = [...ACTION_VERBS, "order", "chat"] as const;

/** The trigger actions an entry of the setup or of a step stands for. */
function actionsOf(e: Raw, names: Names, where: string): ActionRecord[] {
  const verbs = ACTION_VERBS.filter((v) => v in e);
  if (verbs.length !== 1) throw bad(where, verbs.length ? `does ${verbs.join(" and ")} at once: one thing an entry` : `does nothing the tests know (${ACTION_VERBS.join(", ")})`);
  const verb = verbs[0];
  const loc = () => (e.location === undefined ? 64 : names.location(e.location, `${where}.location`));
  const make = (type: number, fields: Partial<ActionRecord>): ActionRecord => ({ ...newAction(type), ...fields });
  switch (verb) {
    case "create":
      return [make(ActionType.CreateUnit, { player: names.player(e.player, `${where}.player`), unitId: names.unit(e.create, `${where}.create`), modifier: countOf(e.count, `${where}.count`, false), location: loc() })];
    case "kill": case "remove":
      return [make(verb === "kill" ? ActionType.KillUnitAt : ActionType.RemoveUnitAt, { player: names.player(e.player, `${where}.player`, true), unitId: names.unit(e[verb] === true ? "Any unit" : e[verb], `${where}.${verb}`), modifier: countOf(e.count, `${where}.count`, true), location: loc() })];
    case "give":
      return [make(ActionType.GiveUnits, { player: names.player(e.player, `${where}.player`, true), target: names.player(e.to, `${where}.to`), unitId: names.unit(e.give === true ? "Any unit" : e.give, `${where}.give`), modifier: countOf(e.count, `${where}.count`, true), location: loc() })];
    case "switch": {
      const state = e.state ?? "set";
      const modifier = ({ set: SwitchAction.Set, clear: SwitchAction.Clear, cleared: SwitchAction.Clear, toggle: SwitchAction.Toggle } as Record<string, number>)[String(state)];
      if (modifier === undefined) throw bad(`${where}.state`, `takes "set", "clear" or "toggle", not ${JSON.stringify(state)}`);
      return [make(ActionType.SetSwitch, { target: names.switch(e.switch, `${where}.switch`), modifier })];
    }
    case "minerals": case "gas": {
      const a = amountOf(e[verb], `${where}.${verb}`);
      return [make(ActionType.SetResources, { player: names.player(e.player, `${where}.player`, true), modifier: a.modifier, target: a.amount, unitId: verb === "minerals" ? ResourceType.Ore : ResourceType.Gas })];
    }
    case "deaths": {
      const a = amountOf(e.count, `${where}.count`);
      return [make(ActionType.SetDeaths, { player: names.player(e.player, `${where}.player`, true), unitId: names.unit(e.deaths, `${where}.deaths`), modifier: a.modifier, target: a.amount })];
    }
    case "action": {
      const lines = Array.isArray(e.action) ? e.action : [e.action];
      if (!lines.every((l) => typeof l === "string")) throw bad(`${where}.action`, "takes an action as the trigger window's text writes it, or a list of them");
      const text = `Trigger("Player 1"){\nConditions:\n\tAlways();\nActions:\n${lines.map((l) => `\t${(l as string).trim().replace(/;?$/, ";")}`).join("\n")}\n}\n`;
      try { return parseTriggers(text, names.t)[0].trigger.actions; } catch (err) {
        throw bad(`${where}.action`, err instanceof TriggerTextError ? err.message.replace(/^Line \d+: /, "") : String(err));
      }
    }
  }
}

/** The person's command an entry of a step stands for, or null when it is a trigger action. */
function commandOf(e: Raw, at: number, names: Names, where: string): RunnerStep | null {
  if ("chat" in e) {
    if (typeof e.chat !== "string") throw bad(`${where}.chat`, "takes the line to send");
    return { frame: at, kind: "chat", text: e.chat };
  }
  if (!("order" in e)) return null;
  const order = String(e.order).toLowerCase() as OrderKind;
  if (!ORDERS.includes(order)) throw bad(`${where}.order`, `takes ${ORDERS.join(", ")}, not ${JSON.stringify(e.order)}`);
  const to = order === "stop" || order === "hold" ? 0 : e.to === undefined ? (() => { throw bad(where, `a ${order} order needs "to": the location to ${order} to`); })() : names.location(e.to, `${where}.to`);
  return { frame: at, kind: "order", order, unit: e.unit === undefined ? UnitClass.Any : names.unit(e.unit, `${where}.unit`), location: e.location === undefined ? 0 : names.location(e.location, `${where}.location`), to };
}

/** What an entry of `expect` holds the end to. */
function expectationOf(e: Raw, names: Names, counts: RunnerCount[], where: string): Expectation {
  if ("trigger" in e) {
    const row = names.trigger(e.trigger, `${where}.trigger`);
    const fired = compareOf(e.fired ?? true, `${where}.fired`);
    return { kind: "trigger", row, fired, what: `${names.triggerLabel(row)} ${firedWords(fired)}` };
  }
  if ("switch" in e) {
    const index = names.switch(e.switch, `${where}.switch`);
    const is = e.is ?? "set";
    if (!["set", "clear", "cleared", true, false].includes(is as string)) throw bad(`${where}.is`, `takes "set" or "clear", not ${JSON.stringify(is)}`);
    const set = is === "set" || is === true;
    return { kind: "switch", index, set, what: `switch "${names.switchName(index)}" is ${set ? "set" : "clear"}` };
  }
  if ("deaths" in e) {
    const player = names.player(e.player, `${where}.player`), unit = names.unit(e.deaths, `${where}.deaths`), is = compareOf(e.is, `${where}.is`);
    return { kind: "deaths", player, unit, is, what: `${names.playerName(player)}'s deaths of ${names.unitName(unit)} are ${compareWords(is)}` };
  }
  for (const kind of ["minerals", "gas"] as const) if (kind in e) {
    const player = names.player(e.player, `${where}.player`), is = compareOf(e[kind], `${where}.${kind}`);
    return { kind, player, is, what: `${names.playerName(player)} has ${compareWords(is)} ${kind}` };
  }
  if ("units" in e) {
    const player = e.player === undefined ? PlayerGroup.AllPlayers : names.player(e.player, `${where}.player`, true);
    const unit = names.unit(e.units === true ? "Any unit" : e.units, `${where}.units`);
    const location = e.location === undefined ? 0 : names.location(e.location, `${where}.location`);
    const is = compareOf(e.is ?? true, `${where}.is`);
    counts.push({ player, unit, location });
    return { kind: "units", query: counts.length - 1, is, what: `${names.playerName(player)} has ${compareWords(is)} ${names.unitName(unit)}${location ? ` in ${names.locationName(location)}` : ""}` };
  }
  if ("text" in e) {
    if (typeof e.text !== "string" || !e.text) throw bad(`${where}.text`, "takes the text to look for");
    const shown = e.shown === undefined ? true : !!e.shown;
    return { kind: "text", text: e.text, shown, what: `${JSON.stringify(e.text)} was ${shown ? "" : "not "}shown` };
  }
  if ("outcome" in e) {
    const player = e.player === undefined ? 0 : names.player(e.player, `${where}.player`);
    if (player > 7) throw bad(`${where}.player`, "an outcome is a player's from 1 to 8");
    const is = e.outcome === "none" || e.outcome === null ? null : e.outcome;
    if (is !== null && is !== "victory" && is !== "defeat" && is !== "draw") throw bad(`${where}.outcome`, `takes "victory", "defeat", "draw" or "none", not ${JSON.stringify(e.outcome)}`);
    return { kind: "outcome", player, is, what: is ? `${names.playerName(player)}'s game ended in ${is}` : `${names.playerName(player)}'s game has no outcome` };
  }
  if ("ended" in e) return { kind: "ended", ended: !!e.ended, what: e.ended ? "the game ended" : "the game was still going" };
  throw bad(where, "expects nothing the tests know (trigger, switch, deaths, minerals, gas, units, text, outcome, ended)");
}

/** The first slot in the game: the map's first computer or person, whose triggers run before anyone else's. */
export function firstInGame(scn: Scenario): number {
  for (let p = 0; p < 8; p++) if (scn.playerTypes[p] === PlayerType.Computer || scn.playerTypes[p] === PlayerType.Human) return p;
  throw new CliError("The map has no slot for a person or a computer: the game would not start it.", null, 2);
}

/** Game seconds: the game's clock counts one every 16 frames, and Elapsed Time compares it. */
export const secondOf = (frame: number) => Math.ceil(frame / 16);

/** A scenario read and resolved against a fresh copy of the map's scenario, its triggers in place. */
export function planScenario(chk: Uint8Array, raw: Raw, file: string, index: number, defaults: { frames: number; seed: number }, text = ""): PlannedScenario {
  const where = `${basename(file)}: scenario ${index + 1}`;
  if (!isObject(raw)) throw bad(where, "is not an object");
  const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : `scenario ${index + 1}`;
  const at = typeof raw.name === "string" ? `${basename(file)}: "${name}"` : where;
  const scenario = parseScenario(chk);
  const converted = mapVersionOf(scenario.fileVersion) === "original";
  if (converted) changeMapVersion(scenario, "broodwar");
  const rows = scenario.triggers.length;
  const names = new Names(scenario, rows);
  const frames = raw.frames === undefined ? defaults.frames : framesOf(raw.frames, `${at}: frames`);
  if (frames < 1) throw bad(`${at}: frames`, "a scenario runs for at least one frame");
  const seed = raw.seed === undefined ? defaults.seed : Number(raw.seed);
  if (!Number.isInteger(seed) || seed < 0) throw bad(`${at}: seed`, `takes a whole number, not ${JSON.stringify(raw.seed)}`);
  const list = (key: string): Raw[] => {
    const v = raw[key];
    if (v === undefined) return [];
    if (!Array.isArray(v) || !v.every(isObject)) throw bad(`${at}: ${key}`, "is a list of objects");
    return v;
  };
  const owner = firstInGame(scenario);
  const setup = list("setup").flatMap((e, i) => actionsOf(e, names, `${at}: setup[${i}]`));
  const before: TriggerRecord[] = [];
  // Sixty-four actions a trigger.
  for (let i = 0; i < setup.length; i += 64) {
    const t = newTrigger([owner]);
    t.conditions.push(newCondition(ConditionType.Always));
    t.actions.push(...setup.slice(i, i + 64));
    before.push(t);
  }
  const steps: RunnerStep[] = [], after: TriggerRecord[] = [];
  list("steps").forEach((e, i) => {
    const w = `${at}: steps[${i}]`;
    if (e.at === undefined) throw bad(w, `says when with "at": a frame, or m:ss`);
    const when = framesOf(e.at, `${w}.at`);
    if (when >= frames) throw bad(`${w}.at`, `is at frame ${num(when)}, and the scenario runs ${num(frames)} frames`);
    const verbs = STEP_VERBS.filter((v) => v in e);
    if (verbs.length !== 1) throw bad(w, verbs.length ? `does ${verbs.join(" and ")} at once: one thing a step` : `does nothing the tests know (${STEP_VERBS.join(", ")})`);
    const command = commandOf(e, when, names, w);
    if (command) { steps.push(command); return; }
    const t = newTrigger([owner]);
    t.conditions.push({ ...newCondition(ConditionType.ElapsedTime), comparison: Comparison.AtLeast, amount: secondOf(when) });
    t.actions.push(...actionsOf(e, names, w));
    after.push(t);
  });
  const counts: RunnerCount[] = [];
  const expect = list("expect").map((e, i) => expectationOf(e, names, counts, `${at}: expect[${i}]`));
  if (before.length || after.length) applyTriggers(scenario, [...before, ...readTriggers(scenario), ...after]);
  return { name, file, line: lineOf(text, name), frames, seed, before, after, rows, spec: { frames, steps: steps.sort((a, b) => a.frame - b.frame), counts }, expect, scenario, converted };
}

/** The line a scenario's name is on in its file, for an annotation; null when it cannot be told. */
function lineOf(text: string, name: string): number | null {
  const at = text.indexOf(JSON.stringify(name));
  return at < 0 ? null : text.slice(0, at).split("\n").length;
}

/** A tests file read: its scenarios planned against the map's scenario as the game runs it. */
export function readTests(file: string, text: string, chk: Uint8Array, defaults: { frames: number; seed: number }): PlannedScenario[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch (e) { throw new CliError(`${basename(file)} is not JSON: ${e instanceof Error ? e.message : e}`, null, 2); }
  const top = Array.isArray(raw) ? { scenarios: raw } : raw;
  if (!isObject(top) || !Array.isArray(top.scenarios)) throw new CliError(`${basename(file)} has no "scenarios" list.`, 'A tests file is { "scenarios": [ { "name": …, "setup": […], "steps": […], "expect": […] } ] }.', 2);
  const d = { frames: top.frames === undefined ? defaults.frames : framesOf(top.frames, `${basename(file)}: frames`), seed: top.seed === undefined ? defaults.seed : Number(top.seed) };
  return top.scenarios.map((s, i) => planScenario(chk, s as Raw, file, i, d, text));
}

/** The tests a map has when none are named: `<map>.tests.json` beside it. */
export function defaultTests(map: string): string {
  return join(dirname(map), `${basename(map).replace(/\.(scm|scx|chk)$/i, "")}.tests.json`);
}
/** Where the replays of the failing scenarios go when `--out` does not say: `<map>.tests/` beside it. */
export function defaultOut(map: string): string {
  return join(dirname(map), `${basename(map).replace(/\.(scm|scx|chk)$/i, "")}.tests`);
}

/* ── Judging the end ────────────────────────────────────────── */

export interface ExpectationResult { kind: Expectation["kind"]; what: string; ok: boolean; actual: string }

/** Each expectation against what the game left: held or not, and what was there instead. */
export function judge(p: PlannedScenario, end: Pick<TestEndLine, "frame" | "ended" | "trace" | "observed">): ExpectationResult[] {
  const shift = p.before.length;
  const rows = summarizeRows(end.trace.filter((l) => l.row >= shift && l.row < shift + p.rows).map((l) => ({ ...l, row: l.row - shift })), p.rows);
  const o = end.observed;
  return p.expect.map((x): ExpectationResult => {
    const r = (ok: boolean, actual: string): ExpectationResult => ({ kind: x.kind, what: x.what, ok, actual });
    switch (x.kind) {
      case "trigger": {
        const s = rows[x.row];
        const ok = holds(x.fired, s.fired);
        if (s.fired) return r(ok, `it fired ${s.fired === 1 ? "once" : `${num(s.fired)} times`}, first at frame ${num(s.firstFired ?? 0)}`);
        const why = !s.players.length ? "no player in the game owns it" : s.lastFail ? `${conditionDef(s.lastFail.type)?.name ?? `condition ${s.lastFail.type}`} (condition ${s.lastFail.slot + 1}) said no last, at frame ${num(s.lastFail.frame)}` : "it was never asked";
        return r(ok, `it never fired: ${why}`);
      }
      case "switch": { const set = o.switches.includes(x.index); return r(set === x.set, `it is ${set ? "set" : "clear"}`); }
      case "deaths": { const n = o.deaths.find(([p, u]) => p === x.player && u === x.unit)?.[2] ?? 0; return r(holds(x.is, n), `they are ${num(n)}`); }
      case "minerals": case "gas": { const n = o.resources[x.player]?.[x.kind === "minerals" ? 0 : 1] ?? 0; return r(holds(x.is, n), `it has ${num(n)}`); }
      case "units": { const n = o.counts[x.query] ?? 0; return r(holds(x.is, n), `it has ${num(n)}`); }
      case "text": {
        const seen = o.texts.find((t) => plainText(t.text).includes(x.text));
        if (seen) return r(x.shown, `shown at frame ${num(seen.frame)}`);
        const lines = o.texts.length;
        return r(!x.shown, lines ? `it was not; ${plural(lines, "line")} shown, the last ${JSON.stringify(plainText(o.texts[lines - 1].text))}` : "nothing was shown");
      }
      case "outcome": { const got = o.outcomes[x.player] ?? null; return r(got === x.is, got ? `it ended in ${got}` : `it has none${end.ended ? "" : `: the game was still going at frame ${num(end.frame)}`}`); }
      case "ended": return r(end.ended === x.ended, end.ended ? `it ended at frame ${num(end.frame)}` : `it was still going at frame ${num(end.frame)}`);
    }
  });
}

/* ── Running ────────────────────────────────────────────────── */

export interface ScenarioResult {
  name: string;
  file: string;
  line: number | null;
  ok: boolean;
  frame: number;
  ended: boolean;
  seed: number;
  results: ExpectationResult[];
  /** The replay kept for a scenario that failed. */
  replay: string | null;
  /** What the game itself said at the start, which explains many a failure: a unit it could not place. */
  notices: string[];
  steps: Observed["steps"];
  ms: number;
}

export interface TestRunOptions {
  /** Where the replays of failing scenarios go. */
  out: string;
  starcraft?: string;
  engine?: string;
  /** Each line as it comes, already worded; absent, nothing is printed as it goes. */
  live?: (line: string) => void;
  /** The first game's start line, once it has come (the map's size and the copy of the game, for a header). */
  onStart?: (start: TestStartLine) => void;
  signal?: AbortSignal;
  node?: string;
}

export interface TestRun {
  engine: { build: string; dir: string; fetched: number };
  game: { folder: string; kind: "remastered" | "classic" };
  start: TestStartLine | null;
  scenarios: ScenarioResult[];
  ms: number;
}

const cancelled = () => new CliError("The run was cancelled: the game was stopped before it finished.", null);

/** A file name from a scenario's name. */
export function slug(name: string): string {
  return name.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "scenario";
}

/**
 * Plays each scenario in a game of its own (one game a process) and judges it. `archive` is the map file's members,
 * carried into each copy. The replay of a scenario that failed is moved to `out`; the copies and the rest go with
 * their temporary folder.
 */
export async function runTests(mapName: string, scenarios: PlannedScenario[], members: Pick<Awaited<ReturnType<typeof readArchive>>, "extras" | "stored">, o: TestRunOptions): Promise<TestRun> {
  const t0 = performance.now();
  const game = findGameCopy(o.starcraft);
  const engine = await ensureEngine(o.engine, undefined, o.live ?? (() => {}));
  const runner = runnerFor(engine, "map");
  const out: ScenarioResult[] = [];
  let first: TestStartLine | null = null;
  const taken = new Set<string>();
  for (const p of scenarios) {
    if (o.signal?.aborted) throw cancelled();
    const dir = mkdtempSync(join(tmpdir(), "scmjs-test-"));
    try {
      const map = join(dir, `${mapName.replace(/\.(scm|scx|chk)$/i, "")}.scx`), spec = join(dir, "spec.json"), rep = join(dir, "game.rep");
      writeFileSync(map, await writeArchiveBytes(serializeScenario(p.scenario), { extras: members.extras, stored: members.stored }));
      writeFileSync(spec, JSON.stringify(p.spec));
      const { start, end } = await runScenario(runner, [map, "--test", spec, "--replay", rep, "--engine", engine.dir, "--starcraft", game.folder, "--seed", String(p.seed)], engine.dir, o);
      if (!first) { first = start; o.onStart?.(start); }
      const results = judge(p, end);
      const ok = results.every((x) => x.ok);
      let replay: string | null = null;
      if (!ok && end.replay && existsSync(rep)) {
        mkdirSync(o.out, { recursive: true });
        let name = slug(p.name), n = 1;
        while (taken.has(name)) name = `${slug(p.name)}-${++n}`;
        taken.add(name);
        replay = join(o.out, `${name}.rep`);
        copyFileSync(rep, replay);
      }
      const notices = end.observed.texts.filter((t) => /^WARNING:/i.test(plainText(t.text))).map((t) => plainText(t.text));
      const r: ScenarioResult = { name: p.name, file: p.file, line: p.line, ok, frame: end.frame, ended: end.ended, seed: p.seed, results, replay, notices: [...new Set(notices)], steps: end.observed.steps, ms: end.ms.total };
      out.push(r);
      o.live?.(scenarioLines(r).join("\n"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return { engine: { build: engine.build, dir: engine.dir, fetched: engine.fetched }, game, start: first, scenarios: out, ms: performance.now() - t0 };
}

async function runScenario(runner: string, args: string[], engineDir: string, o: TestRunOptions): Promise<{ start: TestStartLine; end: TestEndLine }> {
  const child = startRunner(runner, args, { node: o.node });
  const exited = new Promise<number>((done) => { child.on("error", () => done(2)); child.on("close", (c) => done(c ?? 2)); });
  const stop = () => { child.kill(); };
  o.signal?.addEventListener("abort", stop, { once: true });
  let stderr = "";
  child.stderr!.on("data", (d) => { stderr += d; });
  let start: TestStartLine | null = null, end: TestEndLine | null = null, error: string | null = null, older = false;
  try {
    for await (const raw of createInterface({ input: child.stdout! })) {
      let l: RunnerLine;
      try { l = JSON.parse(raw) as RunnerLine; } catch { continue; }
      if (l.kind === "start") {
        // A runner from before `--test` ignores the flag and runs the triggers: its start has no mode.
        if (l.mode !== "test") { older = true; child.kill(); break; }
        start = l;
      } else if (l.kind === "end") end = l as TestEndLine;
      else if (l.kind === "error") error = l.message;
    }
  } finally { o.signal?.removeEventListener("abort", stop); }
  const exitCode = await exited;
  if (o.signal?.aborted) throw cancelled();
  if (older) throw new CliError(`The engine at ${engineDir} has a map runner from before map test.`, "A play page deployed since has one; the next run fetches it (or name a newer one with --engine).");
  if (error) throw new CliError(error, "The runner is scm-sim's; a map StarCraft itself opens, with a slot for a person, and your own copy of the game are what it needs.", 2);
  if (!start || !end) throw new CliError(`The game did not finish: the runner stopped without a result (exit ${exitCode}).${stderr.trim() ? `\n${stderr.trim().split("\n").slice(-6).join("\n")}` : ""}`);
  return { start, end };
}

/* ── The report ─────────────────────────────────────────────── */

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const shown = (path: string) => { const r = relative(process.cwd(), path); return r && !r.startsWith("..") ? r : path; };

/** A scenario's lines: ✔ or ✖ and its name, then for a failure what did not hold, what the game said, and its replay. */
export function scenarioLines(r: ScenarioResult): string[] {
  const failed = r.results.filter((x) => !x.ok);
  const head = `  ${r.ok ? mark.ok : mark.error} ${r.ok ? r.name : pc.bold(r.name)}  ${pc.dim(`${seconds(r.ms)}${r.results.length ? `${dot}${r.results.length - failed.length} of ${plural(r.results.length, "expectation")} held` : `${dot}expects nothing`}`)}`;
  if (r.ok) return [head];
  const out = [head];
  for (const x of failed) out.push(`      ${mark.error} ${x.what} ${pc.dim("—")} ${x.actual}`);
  for (const n of r.notices.slice(0, 3)) out.push(`      ${pc.dim(`the game said: ${n}`)}`);
  if (r.notices.length > 3) out.push(`      ${pc.dim(`… and ${r.notices.length - 3} more such ${r.notices.length === 4 ? "line" : "lines"}`)}`);
  if (r.replay) out.push(`      ${pc.dim("replay:")} ${shown(r.replay)}${pc.dim(", open it with")} scmjs replay open ${shown(r.replay)}`);
  return out;
}

/** The line before the scenarios: the map, its triggers, how many scenarios from where, the game's files. */
export function testHeader(mapName: string, rows: number, scenarios: PlannedScenario[], start: TestStartLine | null): string {
  const files = [...new Set(scenarios.map((s) => basename(s.file)))];
  return `${pc.bold(mapName)}${start ? ` ${pc.dim(`${start.map.width} × ${start.map.height}, ${start.map.tileset}`)}` : ""}${dot}${plural(rows, "trigger")}${dot}${plural(scenarios.length, "scenario")} ${pc.dim(`(${files.join(", ")})`)}${start ? `${dot}${start.copy === "remastered" ? "Remastered" : "1.16.1"} files` : ""}`;
}

/** The closing line: all passed, or how many failed. */
export function testSummary(run: Pick<TestRun, "scenarios" | "ms">): string {
  const failed = run.scenarios.filter((s) => !s.ok).length, n = run.scenarios.length;
  return failed ? `${mark.error} ${n === 1 ? "the scenario" : `${failed} of ${plural(n, "scenario")}`} failed ${pc.dim(`(${seconds(run.ms)})`)}` : `${mark.ok} ${n === 1 ? "the scenario" : n === 2 ? "both scenarios" : `all ${n} scenarios`} passed ${pc.dim(`(${seconds(run.ms)})`)}`;
}

/** `map test --json`: every scenario with its results, and where the engine and the game came from. */
export function testJson(mapFile: string, run: TestRun) {
  const failed = run.scenarios.filter((s) => !s.ok).length;
  return { file: mapFile, passed: run.scenarios.length - failed, failed, scenarios: run.scenarios, engine: run.engine, game: run.game, ms: run.ms };
}

/** The map file's scenario as the game runs it (a built map's built one) and its other members, for the copies. */
export async function readMapForTests(bytes: Uint8Array) {
  const a = await readArchive(bytes);
  return { chk: a.chk, extras: a.extras, stored: a.stored };
}
