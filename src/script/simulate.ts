/**
 * A trigger-cycle interpreter: runs a trigger list the way the game does for one player,
 * cycle by cycle, modelling exactly the state the structured level is built on — death
 * counters, switches, the preserve flag — and logging every other action as an event.
 *
 * It exists so the compiler can be *tested* (a program's triggers are run and the log
 * asserted, in `tests/script-structured.test.ts`) and so the Script editor can show what
 * a program does before the map is ever loaded in the game. It is not the game: Wait
 * takes no time, conditions about units (Bring, Command, …) are answered by a callback
 * (`false` by default), and only the one player runs.
 *
 * Semantics modelled: the list is walked in order once per cycle; a trigger runs when the
 * player owns it (or it is for All Players) and every enabled condition holds; actions run
 * in order; a trigger without the Preserve flag or a Preserve Trigger action runs once.
 * Deaths add wraps at 2³², subtract stops at 0 — the game's behaviour.
 */
import {
  ActionFlag, ActionType, Comparison, ConditionFlag, ConditionType, PlayerGroup, SetModifier, SWITCH_COUNT, SwitchAction, SwitchState, TriggerFlag,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../formats/chk/sections/triggers";
import type { ScriptString } from "./compiler";

export interface SimulationEvent {
  /** 0-based cycle. */
  cycle: number;
  /** Index of the trigger in the list. */
  trigger: number;
  action: ActionRecord;
  /** The action's text, when it has one and the simulation can resolve it. */
  text?: string;
}

export interface SimulationOptions {
  /** The player the triggers run as (0-based); default: the first player any trigger is owned by. */
  player?: number;
  /** Conditions the simulation does not model (Bring, Command, …). Default: false. */
  condition?: (c: ConditionRecord, sim: Simulation) => boolean;
  /** For Randomize Switch; default Math.random. */
  random?: () => number;
  /** Text of a string id — the compiler's local table, or a function over the map's. */
  strings?: ScriptString[] | ((index: number) => string | null);
  /** Stop a cycle after this many trigger runs (a runaway guard); default 100 000. */
  maxRunsPerCycle?: number;
}

export class Simulation {
  readonly triggers: TriggerRecord[];
  readonly player: number;
  readonly events: SimulationEvent[] = [];
  readonly switches = new Uint8Array(SWITCH_COUNT);
  private readonly deaths = new Map<number, number>();
  private readonly done = new Set<number>();
  private readonly options: SimulationOptions;
  cycle = 0;

  constructor(triggers: TriggerRecord[], options: SimulationOptions = {}) {
    this.triggers = triggers;
    this.options = options;
    this.player = options.player ?? (triggers.map((t) => t.players.findIndex((v, i) => v && i < 12)).find((p) => p >= 0) ?? 0);
  }

  death(player: number, unit: number): number {
    return this.deaths.get(unit * 4096 + this.resolvePlayer(player)) ?? 0;
  }

  setDeath(player: number, unit: number, value: number) {
    this.deaths.set(unit * 4096 + this.resolvePlayer(player), value >>> 0);
  }

  /** `CurrentPlayer` is the running player; groups fall back to the running player too. */
  private resolvePlayer(p: number): number {
    return p < 12 ? p : p === PlayerGroup.CurrentPlayer ? this.player : p;
  }

  text(index: number): string | undefined {
    const { strings } = this.options;
    if (!strings || index === 0) return undefined;
    if (typeof strings === "function") return strings(index) ?? undefined;
    const s = strings[index - 1];
    return s && "text" in s ? s.text : undefined;
  }

  /** Run one trigger cycle. */
  step() {
    let runs = 0;
    const limit = this.options.maxRunsPerCycle ?? 100_000;
    for (let i = 0; i < this.triggers.length; i++) {
      const t = this.triggers[i];
      if (this.done.has(i) || t.flags & TriggerFlag.Disabled) continue;
      if (!(t.players[this.player] || t.players[PlayerGroup.AllPlayers])) continue;
      if (!t.conditions.every((c) => this.condition(c))) continue;
      if (++runs > limit) throw new Error(`More than ${limit} trigger runs in one cycle.`);
      let preserve = (t.flags & TriggerFlag.Preserve) !== 0;
      for (const a of t.actions) {
        if (a.flags & ActionFlag.Disabled) continue;
        if (a.type === ActionType.PreserveTrigger) preserve = true;
        else this.action(a, i);
      }
      if (!preserve) this.done.add(i);
    }
    this.cycle++;
  }

  run(cycles: number) {
    for (let i = 0; i < cycles; i++) this.step();
    return this;
  }

  private condition(c: ConditionRecord): boolean {
    if (c.flags & ConditionFlag.Disabled) return true;
    switch (c.type) {
      case ConditionType.Always: return true;
      case ConditionType.Never: return false;
      case ConditionType.Deaths: return compare(this.death(c.player, c.unitId), c.comparison, c.amount);
      case ConditionType.Switch: return c.comparison === SwitchState.Set ? this.switches[c.resource] === 1 : this.switches[c.resource] === 0;
      default: return this.options.condition?.(c, this) ?? false;
    }
  }

  private action(a: ActionRecord, trigger: number) {
    switch (a.type) {
      case ActionType.SetDeaths: {
        const cur = this.death(a.player, a.unitId);
        const n = a.target >>> 0;
        const next = a.modifier === SetModifier.SetTo ? n : a.modifier === SetModifier.Add ? (cur + n) >>> 0 : Math.max(0, cur - n);
        this.setDeath(a.player, a.unitId, next);
        return;
      }
      case ActionType.SetSwitch: {
        const i = a.target;
        if (i < 0 || i >= SWITCH_COUNT) return;
        switch (a.modifier) {
          case SwitchAction.Set: this.switches[i] = 1; break;
          case SwitchAction.Clear: this.switches[i] = 0; break;
          case SwitchAction.Toggle: this.switches[i] ^= 1; break;
          case SwitchAction.Randomize: this.switches[i] = (this.options.random ?? Math.random)() < 0.5 ? 0 : 1; break;
        }
        return;
      }
      case ActionType.Comment:
        return;
      default: {
        const ev: SimulationEvent = { cycle: this.cycle, trigger, action: a };
        const text = this.text(a.text);
        if (text !== undefined) ev.text = text;
        this.events.push(ev);
      }
    }
  }
}

function compare(value: number, comparison: number, amount: number): boolean {
  const n = amount >>> 0;
  switch (comparison) {
    case Comparison.AtLeast: return value >= n;
    case Comparison.AtMost: return value <= n;
    case Comparison.Exactly: return value === n;
    default: return false;
  }
}

/** Compile-result convenience: run a script's triggers for `cycles` cycles. */
export function simulate(triggers: TriggerRecord[], cycles: number, options: SimulationOptions = {}): Simulation {
  return new Simulation(triggers, options).run(cycles);
}
