/**
 * The `.d.ts` a trigger script is checked against: a fixed runtime (the trigger API and
 * the handful of global types TypeScript needs under `noLib`) plus tables generated from
 * the map — its locations, switches, forces and custom unit names — so Monaco completes
 * `Locations.` with what the map actually has and a misspelt name is a type error, not a
 * bare number.
 *
 * Deliberately `noLib`: there is no `Math`, no `console`, no `Array.prototype`; the
 * language is a subset and the declarations *are* its whole surface. Every value a
 * script passes must be a compile-time constant — see `compiler.ts`.
 */
import { ACTION_FIELDS, CONDITION_FIELDS } from "./record";
import { ACTION_IDENTS, argType, CHOICE_TYPES, choiceSpellings, CONDITION_IDENTS, paramName, propertyKey } from "./api";
import { TRIGGER_FLAG_NAMES } from "../formats/triggers/text";
import type { ActionDef, ArgKind, ConditionDef } from "../data/triggerDefs";
import { defaultScriptNames, type NameTable, type ScriptNames } from "./names";

export const DECLARATIONS_FILE = "scm-triggers.d.ts";

const RUNTIME = `// ── scm-js trigger script runtime ─────────────────────────────────────────
// Generated for the open map. Do not edit: it is rebuilt whenever the map's names change.

interface Array<T> { readonly length: number; readonly [n: number]: T; }
interface ReadonlyArray<T> { readonly length: number; readonly [n: number]: T; }
interface Boolean {}
interface Number {}
interface String { readonly length: number; }
interface Object {}
interface Function {}
interface CallableFunction extends Function {}
interface NewableFunction extends Function {}
interface IArguments {}
interface RegExp {}

type Brand<K extends string> = { readonly __kind?: K };
/** A player or player group (a \`Players.*\` constant, or a raw group number). */
type PlayerId<N extends number = number> = N & Brand<"player">;
/** A unit type (a \`Units.*\` constant, or a raw units.dat id). */
type UnitId<N extends number = number> = N & Brand<"unit">;
/** A location (a \`Locations.*\` constant, or a raw 1-based location number; 0 = none). */
type LocationId<N extends number = number> = N & Brand<"location">;
/** A switch (a \`Switches.*\` constant, or a raw 0-based switch number). */
type SwitchId<N extends number = number> = N & Brand<"switch">;
/** An AI script (an \`AiScripts.*\` constant; a four-character code or StarEdit name as a string also works). */
type AiScriptId<N extends number = number> = N & Brand<"aiScript">;
/** A unit count: a number, or "All". */
type Count = number | "All";

/** A condition, as returned by Bring(...), Deaths(...), …; only trigger() consumes it. */
interface Condition { readonly __condition: true; }
/** An action, as returned by DisplayText(...), SetDeaths(...), …; only trigger() consumes it. */
interface Action { readonly __action: true; }

/**
 * Define one trigger. The script's triggers become a contiguous, generated block of the
 * map's trigger list in source order; hand-made triggers around it are left alone.
 * @param players The player groups the trigger runs for.
 * @param conditions Up to 16 conditions; a trigger with none never fires.
 * @param actions Up to 64 actions.
 * @param flags Trigger flags: "Preserve" (same as a Preserve Trigger action), "Disabled", "Ignore Game End", …
 */
declare function trigger(players: PlayerId | readonly PlayerId[], conditions: readonly Condition[], actions: readonly Action[], flags?: readonly (TriggerFlag | number)[]): void;
/** Keep a condition or action in the trigger but switched off (StarEdit's disabled state). */
declare function disabled<T extends Condition | Action>(item: T): T;
/** A condition by raw type number and record fields, for types the editor does not know. */
declare function Condition(${CONDITION_FIELDS.map((f) => `${f}?: number`).join(", ")}): Condition;
/** An action by raw type number and record fields, for types the editor does not know. */
declare function Action(${ACTION_FIELDS.map((f) => `${f}?: number`).join(", ")}): Action;
/** EUD: compare the 32-bit value at a memory address (1.16.1 layout; Remastered emulates it). Deaths at player EPD(address). */
declare function Memory(address: number, comparison: Comparison | number, value: number): Condition;
/** EUD: set / add to / subtract from the 32-bit value at a memory address (1.16.1 layout; Remastered emulates it). */
declare function SetMemory(address: number, modifier: Modifier | number, value: number): Action;

// ── Structured code ──────────────────────────────────────────────────────
// Statements other than trigger() calls form one program: \`let\` variables (numbers are
// death counters, booleans are switches), assignments, if / while / do / for, functions
// (inlined at each call), and action calls as statements. Statements run in order within
// one trigger cycle; a loop's back edge waits for the next cycle, so
// \`while (true) { … }\` runs its body once per cycle (every frame with hyper triggers).

interface ProgramOptions {
  /** The single player the program's triggers run as (default P1). It must be in the game for the program to run. */
  owner?: PlayerId;
  /** Emit hyper triggers so the trigger loop runs every frame: true (owned by \`owner\`) or the player to own them. */
  hyperTriggers?: boolean | PlayerId;
  /** Put a Comment action naming the source line on every generated trigger (default true). */
  comments?: boolean;
  /** Unit types whose death counters hold the variables (default: the "(Unused)" units, Cantina first). */
  variableUnits?: readonly UnitId[];
}
/** Configure the structured program. Optional; call it once, anywhere at the top level. */
declare function program(options: ProgramOptions): void;
/** A coin toss (Randomize Switch): \`flag = random()\`, \`if (random() && …)\`. */
declare function random(): boolean;
`;

function union(values: string[]): string {
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

function choiceTypes(): string {
  const out: string[] = [];
  for (const [kind, name] of Object.entries(CHOICE_TYPES) as [ArgKind, string][]) {
    out.push(`type ${name} = ${union(choiceSpellings(kind))};`);
  }
  out.push(`type TriggerFlag = ${union(TRIGGER_FLAG_NAMES.map(([, n]) => n))};`);
  return out.join("\n");
}

function tableDecl(t: NameTable): string {
  const lines = [`/** ${t.doc} */`, `declare const ${t.object}: {`];
  for (const e of t.entries) for (const k of e.keys) lines.push(`  readonly ${propertyKey(k)}: ${t.type}<${e.value}>;`);
  lines.push("};");
  return lines.join("\n");
}

function playerAliases(names: ScriptNames): string {
  const lines: string[] = [];
  for (const e of names.players.entries) {
    if (e.value < 12) lines.push(`/** ${e.keys[1]} */\ndeclare const ${e.keys[0]}: PlayerId<${e.value}>;`);
  }
  lines.push("/** The player the trigger is running for. */\ndeclare const CurrentPlayer: PlayerId<13>;");
  lines.push("/** Every player. */\ndeclare const AllPlayers: PlayerId<17>;");
  return lines.join("\n");
}

function signature(ident: string, def: ConditionDef | ActionDef, returns: "Condition" | "Action"): string {
  const used = new Set<string>();
  const params = def.args.map((a) => {
    let p = paramName(a.label);
    while (used.has(p)) p = `${p}_`;
    used.add(p);
    return `${p}: ${argType(a.kind)}`;
  });
  const doc = def.args.length ? `${def.name} — ${def.args.map((a) => a.label).join(", ")}` : def.name;
  return `/** ${doc} */\ndeclare function ${ident}(${params.join(", ")}): ${returns};`;
}

/** The whole declaration file for a set of names. */
export function generateDeclarations(names: ScriptNames = defaultScriptNames()): string {
  const parts = [
    RUNTIME,
    choiceTypes(),
    "",
    "// ── Conditions ──",
    ...[...CONDITION_IDENTS].map(([ident, def]) => signature(ident, def, "Condition")),
    "",
    "// ── Actions ──",
    ...[...ACTION_IDENTS].map(([ident, def]) => signature(ident, def, "Action")),
    "",
    "// ── The map ──",
    playerAliases(names),
    tableDecl(names.players),
    tableDecl(names.units),
    tableDecl(names.locations),
    tableDecl(names.switches),
    tableDecl(names.aiScripts),
    "",
  ];
  return parts.join("\n");
}
