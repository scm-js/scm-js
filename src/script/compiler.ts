/**
 * The trigger script compiler: a TypeScript program checked against the generated
 * declarations and lowered to `TriggerRecord`s, at two levels.
 *
 * The *raw* level is `trigger(players, conditions, actions)` calls and `const`s — one
 * call, one record. The *structured* level is everything else at the top level: `let`
 * variables, assignments, `if` / `while` / `for`, functions, action calls as statements.
 * Those statements form one program that `structured.ts` walks and `lower.ts` turns into a
 * death-counter state machine — a run of preserved triggers owned by one player, appended
 * after the raw triggers (see `lower.ts` for the execution model).
 *
 * The compiler owns no parser: it builds a real TypeScript program (`noLib`, the
 * declarations plus the script) and walks its AST, and it owns no name tables either —
 * `Units.TerranMarine` is a property whose *type* is the literal `0 & Brand<"unit">`, so
 * every argument is evaluated by asking the checker for the expression's literal type,
 * falling back to folding arithmetic and following `const` initialisers. Anything that is
 * not a compile-time constant is an error, except a `let` variable where structured code
 * allows one.
 *
 * Strings are not interned here (the compiler may run in a worker, away from the
 * scenario): text/wav fields hold local ids into `strings`, resolved by the build step.
 * The `typescript` namespace is passed in so tests (Node) and the worker (bundled) share
 * one implementation.
 */
import type * as TS from "typescript";
import {
  ActionFlag, ConditionFlag, ConditionType, ActionType, emptyAction, emptyCondition, emptyTrigger, MAX_ACTIONS, MAX_CONDITIONS, PLAYER_GROUP_COUNT,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../formats/chk/sections/triggers";
import { aiScriptByName, CHOICES, choiceValue, type ArgKind } from "../data/triggerDefs";
import { TRIGGER_FLAG_NAMES } from "../formats/triggers/text";
import { ACTION_IDENTS, CONDITION_IDENTS } from "./api";
import { ACTION_FIELDS, CONDITION_FIELDS } from "./record";
import { DECLARATIONS_FILE } from "./declarations";
import { Allocator, hyperTriggers, LowerError, Machine, PLAYER_SLOTS, storageLabel, type Var } from "./lower";
import { Structured } from "./structured";

export const SCRIPT_FILE = "triggers.ts";

/** `Memory(address, …)` reads `Deaths` at player `EPD(address)`, unit 0: the deaths table starts here in 1.16.1's memory. */
export const DEATHS_TABLE_ADDRESS = 0x58a364;

export interface ScriptDiagnostic {
  /** 1-based. */
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  source: "typescript" | "compiler";
}

/** A string a record refers to: text to intern, or an existing string-table index (raw forms). */
export type ScriptString = { text: string } | { index: number };

export interface VariableInfo {
  name: string;
  kind: "number" | "boolean";
  /** Where it lives: "P3 · Cantina (Unused)" or "Switch 256". */
  storage: string;
  /** Death counter (numbers). */
  player?: number;
  unit?: number;
  /** Switch index (booleans). */
  switch?: number;
}

export interface ProgramInfo {
  /** The player the program runs as (0-based). */
  owner: number;
  /** Index into `triggers` of the program's first trigger. */
  start: number;
  /** Program triggers, hyper triggers excluded. */
  count: number;
  hyperTriggers: boolean;
}

export interface CompileResult {
  triggers: TriggerRecord[];
  /** Per trigger, the 1-based line of its `trigger(` call or of the statement it came from. */
  lines: number[];
  /** Local string table: a record's `text` / `wav` field `k > 0` means `strings[k - 1]`. */
  strings: ScriptString[];
  diagnostics: ScriptDiagnostic[];
  /** The structured program's variables (temporaries and the program counter included), in allocation order. */
  variables: VariableInfo[];
  /** The structured program, when the script has one. */
  program: ProgramInfo | null;
  /** No errors: `triggers` is the complete program. */
  ok: boolean;
}

export interface CompileOptions {
  /** Death counters (player, unit) the map's hand triggers use; variables avoid them. */
  reservedDeaths?: readonly (readonly [number, number])[];
  /** Switches the map's hand triggers use or name; variables avoid them. */
  reservedSwitches?: readonly number[];
}

export type Const = { n: number } | { s: string };

/** What an identifier means inside structured code: a constant (function parameter) or a variable. */
export type Binding = { kind: "const"; value: Const } | { kind: "var"; v: Var };

/** Bindings keyed by declaration node, so shadowing and inlined functions resolve exactly as the checker does. */
export class Scope {
  private readonly map = new Map<TS.Node, Binding>();
  readonly parent: Scope | null;
  constructor(parent: Scope | null) { this.parent = parent; }
  bind(decl: TS.Node, b: Binding) { this.map.set(decl, b); }
  lookup(decl: TS.Node): Binding | undefined {
    return this.map.get(decl) ?? this.parent?.lookup(decl);
  }
}

export interface ProgramOptions {
  owner: number;
  hyperTriggers: number | null;
  comments: boolean;
  variableUnits: number[];
}

const MAX_DEPTH = 32;

export class Compiler {
  readonly ts: typeof TS;
  readonly checker: TS.TypeChecker;
  readonly sf: TS.SourceFile;
  readonly diagnostics: ScriptDiagnostic[] = [];
  readonly strings: ScriptString[] = [];
  readonly triggers: TriggerRecord[] = [];
  readonly lines: number[] = [];
  readonly variables: VariableInfo[] = [];
  program: ProgramInfo | null = null;
  readonly options: CompileOptions;
  /** The structured program's innermost scope while it is being lowered; null in raw code. */
  scope: Scope | null = null;

  constructor(ts: typeof TS, program: TS.Program, sf: TS.SourceFile, options: CompileOptions) {
    this.ts = ts;
    this.checker = program.getTypeChecker();
    this.sf = sf;
    this.options = options;
  }

  error(node: TS.Node, message: string) {
    const start = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf));
    const end = this.sf.getLineAndCharacterOfPosition(node.getEnd());
    this.diagnostics.push({ line: start.line + 1, column: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1, message, source: "compiler" });
  }

  lineOf(node: TS.Node): number {
    return this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1;
  }

  localString(s: ScriptString): number {
    const at = this.strings.findIndex((x) => ("text" in x && "text" in s ? x.text === s.text : "index" in x && "index" in s && x.index === s.index));
    if (at >= 0) return at + 1;
    this.strings.push(s);
    return this.strings.length;
  }

  /** Is this call to one of the runtime's functions (declared in the generated file), by name? */
  isRuntimeCall(e: TS.Node, name: string): e is TS.CallExpression {
    const { ts } = this;
    return ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name && !this.scriptDeclaration(e.expression);
  }

  /** The script's own declaration an identifier refers to (a `let`, a parameter, a function), if any. */
  scriptDeclaration(id: TS.Identifier): TS.Declaration | undefined {
    const decl = this.checker.getSymbolAtLocation(id)?.valueDeclaration;
    return decl && decl.getSourceFile() === this.sf ? decl : undefined;
  }

  /** The structured binding of an identifier, if it has one. */
  binding(expr: TS.Expression): Binding | undefined {
    const e = this.unwrap(expr);
    if (!this.ts.isIdentifier(e) || !this.scope) return undefined;
    const decl = this.scriptDeclaration(e);
    return decl ? this.scope.lookup(decl) : undefined;
  }

  varOf(expr: TS.Expression): Var | undefined {
    const b = this.binding(expr);
    return b?.kind === "var" ? b.v : undefined;
  }

  run() {
    const { ts } = this;
    const structured: TS.Statement[] = [];
    let programCall: TS.CallExpression | null = null;
    for (const stmt of this.sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        if (stmt.declarationList.flags & ts.NodeFlags.Const) {
          for (const d of stmt.declarationList.declarations) if (!d.initializer) this.error(d, "A constant needs a value.");
        } else structured.push(stmt);
        continue;
      }
      if (ts.isEmptyStatement(stmt) || ts.isFunctionDeclaration(stmt)) continue;
      if (ts.isExpressionStatement(stmt) && this.isRuntimeCall(stmt.expression, "trigger")) {
        this.trigger(stmt.expression);
        continue;
      }
      if (ts.isExpressionStatement(stmt) && this.isRuntimeCall(stmt.expression, "program")) {
        if (programCall) this.error(stmt, "program() may be called once.");
        programCall = stmt.expression;
        continue;
      }
      if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
      if (ts.isImportDeclaration(stmt) || ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt) || ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isModuleDeclaration(stmt)) {
        this.error(stmt, "Imports, exports, classes, enums and namespaces are not part of the trigger script.");
        continue;
      }
      structured.push(stmt);
    }
    if (structured.length === 0 && !programCall) return;
    const options = this.programOptions(programCall);
    const allocator = new Allocator({ units: options.variableUnits, reservedDeaths: this.options.reservedDeaths, reservedSwitches: this.options.reservedSwitches });
    const comment = options.comments ? (text: string) => this.localString({ text }) : undefined;
    let machine: Machine;
    try {
      machine = new Machine({ owner: options.owner, allocator, comment });
    } catch (err) {
      this.error(programCall ?? structured[0], (err as Error).message);
      return;
    }
    const start = this.triggers.length;
    new Structured(this, machine).run(structured);
    this.triggers.push(...machine.triggers);
    this.lines.push(...machine.lines);
    this.program = { owner: options.owner, start, count: machine.triggers.length, hyperTriggers: options.hyperTriggers !== null };
    if (options.hyperTriggers !== null) {
      const line = programCall ? this.lineOf(programCall) : 1;
      for (const t of hyperTriggers(options.hyperTriggers, comment)) { this.triggers.push(t); this.lines.push(line); }
    }
    for (const v of allocator.variables) {
      this.variables.push(v.kind === "dc"
        ? { name: v.name, kind: "number", storage: storageLabel(v), player: v.player, unit: v.unit }
        : { name: v.name, kind: "boolean", storage: storageLabel(v), switch: v.index });
    }
  }

  /** `program({ owner, hyperTriggers, comments, variableUnits })`, defaults filled in. */
  programOptions(call: TS.CallExpression | null): ProgramOptions {
    const { ts } = this;
    const out: ProgramOptions = { owner: 0, hyperTriggers: null, comments: true, variableUnits: [] };
    if (!call) return out;
    const arg = call.arguments[0] ? this.resolve(call.arguments[0]) : undefined;
    if (!arg || !ts.isObjectLiteralExpression(arg)) { if (arg) this.error(arg, "program() takes an options object literal."); return out; }
    let hyper: boolean | number = false;
    for (const p of arg.properties) {
      if (!ts.isPropertyAssignment(p) || !(ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) { this.error(p, "Write program options as name: value."); continue; }
      const name = p.name.text;
      const init = this.unwrap(p.initializer);
      const bool = init.kind === ts.SyntaxKind.TrueKeyword ? true : init.kind === ts.SyntaxKind.FalseKeyword ? false : undefined;
      const v = this.value(init);
      const player = v && "n" in v && Number.isInteger(v.n) && v.n >= 0 && v.n < PLAYER_SLOTS ? v.n : undefined;
      switch (name) {
        case "owner":
          if (player !== undefined) out.owner = player;
          else this.error(init, `The owner must be a single player, P1 … P${PLAYER_SLOTS}: the program is one thread running as that player.`);
          break;
        case "hyperTriggers":
          if (bool !== undefined) hyper = bool;
          else if (player !== undefined) hyper = player;
          else this.error(init, "hyperTriggers is true, false, or the player to own them.");
          break;
        case "comments":
          if (bool !== undefined) out.comments = bool;
          else this.error(init, "comments is true or false.");
          break;
        case "variableUnits": {
          const list = this.list(init);
          if (!list) { this.error(init, "variableUnits is an array of unit types."); break; }
          for (const el of list) {
            const u = this.value(el);
            if (u && "n" in u && Number.isInteger(u.n) && u.n >= 0) out.variableUnits.push(u.n);
            else this.error(el, "Expected a unit type.");
          }
          break;
        }
        default:
          this.error(p, `Unknown program option "${name}".`);
      }
    }
    out.hyperTriggers = hyper === true ? out.owner : hyper === false ? null : hyper;
    return out;
  }

  trigger(call: TS.CallExpression) {
    const [playersArg, condArg, actArg, flagsArg] = call.arguments;
    if (!playersArg || !condArg || !actArg) { this.error(call, "trigger() takes players, conditions and actions."); return; }
    const t = emptyTrigger();
    const players = this.list(playersArg) ?? [playersArg];
    for (const p of players) {
      const v = this.value(p);
      if (!v || !("n" in v)) { this.error(p, "Expected a player group."); continue; }
      if (v.n < 0 || v.n >= PLAYER_GROUP_COUNT || !Number.isInteger(v.n)) { this.error(p, `Player group ${v.n} is out of range (0–${PLAYER_GROUP_COUNT - 1}).`); continue; }
      t.players[v.n] = 1;
    }
    t.conditions = this.items(condArg, "condition") as ConditionRecord[];
    t.actions = this.items(actArg, "action") as ActionRecord[];
    if (t.conditions.length > MAX_CONDITIONS) this.error(condArg, `A trigger holds at most ${MAX_CONDITIONS} conditions (got ${t.conditions.length}).`);
    if (t.actions.length > MAX_ACTIONS) this.error(actArg, `A trigger holds at most ${MAX_ACTIONS} actions (got ${t.actions.length}).`);
    if (flagsArg) {
      for (const f of this.list(flagsArg) ?? [flagsArg]) {
        const v = this.value(f);
        if (v && "n" in v) { t.flags |= v.n >>> 0; continue; }
        const hit = v && "s" in v ? TRIGGER_FLAG_NAMES.find(([, name]) => name.toLowerCase() === v.s.trim().toLowerCase()) : undefined;
        if (hit) t.flags |= hit[0];
        else this.error(f, `Unknown trigger flag${v && "s" in v ? ` "${v.s}"` : ""}.`);
      }
    }
    this.triggers.push(t);
    this.lines.push(this.lineOf(call));
  }

  /** Strip parentheses, `as`, `satisfies`, `!` — the wrappers that change nothing at compile time. */
  unwrap(expr: TS.Expression): TS.Expression {
    const { ts } = this;
    for (;;) {
      if (ts.isParenthesizedExpression(expr) || ts.isAsExpression(expr) || ts.isTypeAssertionExpression(expr) || ts.isNonNullExpression(expr) || ts.isSatisfiesExpression(expr)) expr = expr.expression;
      else return expr;
    }
  }

  /** The `const` initialiser an identifier refers to, if it is one. */
  initializer(expr: TS.Expression): TS.Expression | undefined {
    const { ts } = this;
    if (!ts.isIdentifier(expr)) return undefined;
    const sym = this.checker.getSymbolAtLocation(expr);
    const decl = sym?.valueDeclaration;
    if (!decl || !ts.isVariableDeclaration(decl) || !decl.initializer) return undefined;
    return ts.isVariableDeclarationList(decl.parent) && decl.parent.flags & ts.NodeFlags.Const ? decl.initializer : undefined;
  }

  /** Follow wrappers and `const` references down to the expression that carries the value. */
  resolve(expr: TS.Expression, depth = 0): TS.Expression {
    const e = this.unwrap(expr);
    if (this.binding(e)) return e;
    const init = depth < MAX_DEPTH ? this.initializer(e) : undefined;
    return init ? this.resolve(init, depth + 1) : e;
  }

  /** The elements of an array expression (spreads flattened), or null when it is not an array. */
  list(expr: TS.Expression, depth = 0): TS.Expression[] | null {
    const { ts } = this;
    const e = this.resolve(expr);
    if (!ts.isArrayLiteralExpression(e)) return null;
    const out: TS.Expression[] = [];
    for (const el of e.elements) {
      if (ts.isSpreadElement(el)) {
        const inner = depth < MAX_DEPTH ? this.list(el.expression, depth + 1) : null;
        if (inner) out.push(...inner);
        else this.error(el, "Only arrays can be spread here.");
      } else if (!ts.isOmittedExpression(el)) out.push(el);
    }
    return out;
  }

  items(expr: TS.Expression, kind: "condition" | "action"): (ConditionRecord | ActionRecord)[] {
    const elements = this.list(expr);
    if (!elements) { this.error(expr, `Expected an array of ${kind}s.`); return []; }
    const out: (ConditionRecord | ActionRecord)[] = [];
    for (const el of elements) {
      const r = this.item(el, kind);
      if (r) out.push(r);
    }
    return out;
  }

  item(expr: TS.Expression, kind: "condition" | "action", depth = 0): ConditionRecord | ActionRecord | null {
    const { ts } = this;
    const e = this.resolve(expr);
    if (!ts.isCallExpression(e) || !ts.isIdentifier(e.expression)) {
      this.error(expr, `Expected a ${kind} such as ${kind === "condition" ? "Bring(...)" : "DisplayText(...)"}.`);
      return null;
    }
    const name = e.expression.text;
    const args = e.arguments;
    if (name === "disabled") {
      if (args.length !== 1) { this.error(e, "disabled() takes one condition or action."); return null; }
      const r = depth < MAX_DEPTH ? this.item(args[0], kind, depth + 1) : null;
      if (r) r.flags |= kind === "condition" ? ConditionFlag.Disabled : ActionFlag.Disabled;
      return r;
    }
    if (name === "Condition" || name === "Action") {
      if ((name === "Condition") !== (kind === "condition")) { this.error(e, `${name}(...) is ${name === "Condition" ? "a condition" : "an action"}; it belongs in the ${name === "Condition" ? "conditions" : "actions"} list.`); return null; }
      const record = (kind === "condition" ? emptyCondition() : emptyAction()) as unknown as Record<string, number>;
      const fields: readonly string[] = kind === "condition" ? CONDITION_FIELDS : ACTION_FIELDS;
      args.forEach((a, i) => {
        const v = this.value(a);
        if (!v || !("n" in v)) this.error(a, "Expected a number.");
        else if (i < fields.length) record[fields[i]] = v.n >>> 0;
      });
      // Raw text / wav numbers are string-table indices as written.
      if (kind === "action") for (const f of ["text", "wav"] as const) if (record[f]) record[f] = this.localString({ index: record[f] });
      return record as unknown as ConditionRecord | ActionRecord;
    }
    if (name === "Memory" || name === "SetMemory") {
      if ((name === "Memory") !== (kind === "condition")) { this.error(e, `${name}(...) is ${name === "Memory" ? "a condition" : "an action"}; it belongs in the ${name === "Memory" ? "conditions" : "actions"} list.`); return null; }
      if (args.length !== 3) { this.error(e, `${name} takes an address, a ${kind === "condition" ? "comparison" : "modifier"} and a value.`); return null; }
      const addr = this.value(args[0]);
      if (!addr || !("n" in addr) || !Number.isInteger(addr.n) || addr.n % 4 !== 0) { this.error(args[0], "Expected a 4-byte-aligned memory address."); return null; }
      const epd = ((addr.n - DEATHS_TABLE_ADDRESS) / 4) >>> 0;
      const op = this.arg(kind === "condition" ? "comparison" : "modifier", args[1]);
      const value = this.arg("amount", args[2]);
      if (op === undefined || value === undefined) return null;
      if (kind === "condition") return { ...emptyCondition(), type: ConditionType.Deaths, player: epd, unitId: 0, comparison: op, amount: value };
      return { ...emptyAction(), type: ActionType.SetDeaths, player: epd, unitId: 0, modifier: op, target: value };
    }
    const table = kind === "condition" ? CONDITION_IDENTS : ACTION_IDENTS;
    const other = kind === "condition" ? ACTION_IDENTS : CONDITION_IDENTS;
    const def = table.get(name);
    if (!def) {
      if (other.has(name)) this.error(e, `${name} is ${kind === "condition" ? "an action" : "a condition"}; it belongs in the ${kind === "condition" ? "actions" : "conditions"} list.`);
      else this.error(e.expression, `Unknown ${kind} "${name}".`);
      return null;
    }
    if (args.length !== def.args.length) {
      this.error(e, `${name} takes ${def.args.length} argument${def.args.length === 1 ? "" : "s"}, got ${args.length}.`);
      return null;
    }
    const record = (kind === "condition" ? { ...emptyCondition(), type: def.type } : { ...emptyAction(), type: def.type }) as unknown as Record<string, number>;
    def.args.forEach((arg, i) => {
      const v = this.arg(arg.kind, args[i]);
      if (v === undefined) return;
      if (arg.kind === "textFlags") record.flags = (record.flags & ~ActionFlag.AlwaysDisplay) | (v & ActionFlag.AlwaysDisplay);
      else record[arg.field] = v;
    });
    if (def.args.some((a) => a.kind === "unit")) record.flags |= kind === "condition" ? ConditionFlag.UnitTypeUsed : ActionFlag.UnitTypeUsed;
    return record as unknown as ConditionRecord | ActionRecord;
  }

  /** One argument's record value, by kind; undefined (with a diagnostic) when it is not a usable constant. */
  arg(kind: ArgKind, expr: TS.Expression): number | undefined {
    const v = this.value(expr);
    const fail = (what: string) => { this.error(expr, what); return undefined; };
    if (!v) {
      const variable = this.varOf(expr);
      return fail(variable ? `${variable.name} is a variable; this argument must be a constant. Compare or assign it in structured code instead.` : "Expected a compile-time constant.");
    }
    switch (kind) {
      case "text": case "wav":
        return "s" in v ? (v.s === "" ? 0 : this.localString({ text: v.s })) : fail("Expected text.");
      case "count":
        return "s" in v ? (v.s.trim().toLowerCase() === "all" ? 0 : fail(`Expected a count or "All", got "${v.s}".`)) : v.n >>> 0;
      case "aiScript":
        return "s" in v ? aiScriptByName(v.s) ?? fail(`Unknown AI script "${v.s}".`) : v.n >>> 0;
      default:
        if ("n" in v) return v.n >>> 0;
        if (CHOICES[kind]) return choiceValue(kind, v.s) ?? fail(`Unknown ${kind} "${v.s}".`);
        return fail(`Expected a ${kind}, got text.`);
    }
  }

  /** The constant an expression evaluates to, or undefined. */
  value(expr: TS.Expression, depth = 0): Const | undefined {
    const { ts } = this;
    const e = this.unwrap(expr);
    if (ts.isNumericLiteral(e)) return { n: Number(e.text) };
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { s: e.text };
    if (ts.isPrefixUnaryExpression(e)) {
      const v = this.value(e.operand, depth + 1);
      if (!v || !("n" in v)) return undefined;
      switch (e.operator) {
        case ts.SyntaxKind.MinusToken: return { n: -v.n };
        case ts.SyntaxKind.PlusToken: return { n: v.n };
        case ts.SyntaxKind.TildeToken: return { n: ~v.n };
        default: return undefined;
      }
    }
    if (ts.isBinaryExpression(e)) {
      const l = this.value(e.left, depth + 1);
      const r = this.value(e.right, depth + 1);
      if (!l || !r) return undefined;
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken && ("s" in l || "s" in r)) return { s: `${"s" in l ? l.s : l.n}${"s" in r ? r.s : r.n}` };
      if (!("n" in l) || !("n" in r)) return undefined;
      switch (op) {
        case ts.SyntaxKind.PlusToken: return { n: l.n + r.n };
        case ts.SyntaxKind.MinusToken: return { n: l.n - r.n };
        case ts.SyntaxKind.AsteriskToken: return { n: l.n * r.n };
        case ts.SyntaxKind.SlashToken: return { n: r.n === 0 ? 0 : Math.trunc(l.n / r.n) };
        case ts.SyntaxKind.PercentToken: return { n: r.n === 0 ? 0 : l.n % r.n };
        case ts.SyntaxKind.AsteriskAsteriskToken: return { n: l.n ** r.n };
        case ts.SyntaxKind.LessThanLessThanToken: return { n: l.n << r.n };
        case ts.SyntaxKind.GreaterThanGreaterThanToken: return { n: l.n >> r.n };
        case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken: return { n: l.n >>> r.n };
        case ts.SyntaxKind.AmpersandToken: return { n: l.n & r.n };
        case ts.SyntaxKind.BarToken: return { n: l.n | r.n };
        case ts.SyntaxKind.CaretToken: return { n: l.n ^ r.n };
        default: return undefined;
      }
    }
    if (ts.isTemplateExpression(e)) {
      let s = e.head.text;
      for (const span of e.templateSpans) {
        const v = this.value(span.expression, depth + 1);
        if (!v) return undefined;
        s += ("s" in v ? v.s : String(v.n)) + span.literal.text;
      }
      return { s };
    }
    // Structured bindings first: a variable is never a constant, whatever the checker narrowed it to.
    const b = this.binding(e);
    if (b) return b.kind === "const" ? b.value : undefined;
    // Names: the checker knows literal types (`Units.TerranMarine: UnitId<0>`, `const n = 5`).
    const lit = literalOf(this.checker.getTypeAtLocation(e));
    if (lit) return lit;
    // A const whose type widened (`const n = 5 * 2`): fold its initialiser.
    const init = depth < MAX_DEPTH ? this.initializer(e) : undefined;
    return init ? this.value(init, depth + 1) : undefined;
  }
}

function literalOf(type: TS.Type): Const | undefined {
  if (type.isNumberLiteral()) return { n: type.value };
  if (type.isStringLiteral()) return { s: type.value };
  if (type.isIntersection()) {
    for (const t of type.types) {
      const v = literalOf(t);
      if (v) return v;
    }
  }
  return undefined;
}

export { LowerError };

/** Compile a script against a declaration file. Never throws for script errors — read `diagnostics`. */
export function compileScript(ts: typeof TS, source: string, declarations: string, options: CompileOptions = {}): CompileResult {
  const files = new Map<string, string>([[DECLARATIONS_FILE, declarations], [SCRIPT_FILE, source]]);
  const compilerOptions: TS.CompilerOptions = {
    noLib: true, strict: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    noEmit: true, types: [], allowNonTsExtensions: true,
  };
  const host: TS.CompilerHost = {
    getSourceFile: (name) => {
      const text = files.get(name);
      return text === undefined ? undefined : ts.createSourceFile(name, text, ts.ScriptTarget.ESNext, true);
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile: () => {},
    getCurrentDirectory: () => "",
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => files.has(f),
    readFile: (f) => files.get(f),
  };
  const program = ts.createProgram([DECLARATIONS_FILE, SCRIPT_FILE], compilerOptions, host);
  const sf = program.getSourceFile(SCRIPT_FILE)!;
  const c = new Compiler(ts, program, sf, options);
  // The whole program, not just the script: a broken declaration file is a bug worth seeing.
  for (const d of ts.getPreEmitDiagnostics(program)) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const file = d.file;
    const at = file && d.start !== undefined ? file.getLineAndCharacterOfPosition(d.start) : { line: 0, character: 0 };
    const end = file && d.start !== undefined ? file.getLineAndCharacterOfPosition(d.start + (d.length ?? 0)) : at;
    const where = file && file.fileName !== SCRIPT_FILE ? `${file.fileName}: ` : "";
    c.diagnostics.push({
      line: at.line + 1, column: at.character + 1, endLine: end.line + 1, endColumn: end.character + 1,
      message: where + ts.flattenDiagnosticMessageText(d.messageText, "\n"), source: "typescript",
    });
  }
  c.run();
  c.diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);
  return { triggers: c.triggers, lines: c.lines, strings: c.strings, diagnostics: c.diagnostics, variables: c.variables, program: c.program, ok: c.diagnostics.length === 0 };
}
