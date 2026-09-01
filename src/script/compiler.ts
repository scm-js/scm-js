/**
 * The trigger script compiler, raw level: a TypeScript program of `trigger(players,
 * conditions, actions)` calls and `const` declarations, checked against the generated
 * declarations and lowered to `TriggerRecord`s.
 *
 * The compiler owns no parser: it builds a real TypeScript program (`noLib`, the
 * declarations plus the script) and walks its AST, and it owns no name tables either —
 * `Units.TerranMarine` is a property whose *type* is the literal `0 & Brand<"unit">`, so
 * every argument is evaluated by asking the checker for the expression's literal type,
 * falling back to folding arithmetic and following `const` initialisers. Anything that is
 * not a compile-time constant is an error; there is no runtime.
 *
 * Strings are not interned here (the compiler may run in a worker, away from the
 * scenario): text/wav fields hold local ids into `strings`, resolved by the build step.
 * The `typescript` namespace is passed in so tests (Node) and the worker (bundled) share
 * one implementation.
 */
import type * as TS from "typescript";
import {
  ActionFlag, ConditionFlag, emptyAction, emptyCondition, emptyTrigger, MAX_ACTIONS, MAX_CONDITIONS, PLAYER_GROUP_COUNT,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../formats/chk/sections/triggers";
import { aiScriptByName, CHOICES, choiceValue, type ArgKind } from "../data/triggerDefs";
import { TRIGGER_FLAG_NAMES } from "../formats/triggers/text";
import { ACTION_IDENTS, CONDITION_IDENTS } from "./api";
import { ACTION_FIELDS, CONDITION_FIELDS } from "./record";
import { DECLARATIONS_FILE } from "./declarations";

export const SCRIPT_FILE = "triggers.ts";

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

export interface CompileResult {
  triggers: TriggerRecord[];
  /** Per trigger, the 1-based line of its `trigger(` call. */
  lines: number[];
  /** Local string table: a record's `text` / `wav` field `k > 0` means `strings[k - 1]`. */
  strings: ScriptString[];
  diagnostics: ScriptDiagnostic[];
  /** No errors: `triggers` is the complete program. */
  ok: boolean;
}

type Const = { n: number } | { s: string };

const MAX_DEPTH = 32;

class Compiler {
  readonly ts: typeof TS;
  readonly checker: TS.TypeChecker;
  readonly sf: TS.SourceFile;
  readonly diagnostics: ScriptDiagnostic[] = [];
  readonly strings: ScriptString[] = [];
  readonly triggers: TriggerRecord[] = [];
  readonly lines: number[] = [];

  constructor(ts: typeof TS, program: TS.Program, sf: TS.SourceFile) {
    this.ts = ts;
    this.checker = program.getTypeChecker();
    this.sf = sf;
  }

  error(node: TS.Node, message: string) {
    const start = this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf));
    const end = this.sf.getLineAndCharacterOfPosition(node.getEnd());
    this.diagnostics.push({ line: start.line + 1, column: start.character + 1, endLine: end.line + 1, endColumn: end.character + 1, message, source: "compiler" });
  }

  localString(s: ScriptString): number {
    const at = this.strings.findIndex((x) => ("text" in x && "text" in s ? x.text === s.text : "index" in x && "index" in s && x.index === s.index));
    if (at >= 0) return at + 1;
    this.strings.push(s);
    return this.strings.length;
  }

  run() {
    const { ts } = this;
    for (const stmt of this.sf.statements) {
      if (ts.isVariableStatement(stmt)) {
        if (!(stmt.declarationList.flags & ts.NodeFlags.Const)) this.error(stmt, "Declare constants with const; variables belong to the structured level, which is not available yet.");
        for (const d of stmt.declarationList.declarations) if (!d.initializer) this.error(d, "A constant needs a value.");
        continue;
      }
      if (ts.isEmptyStatement(stmt)) continue;
      if (ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) && ts.isIdentifier(stmt.expression.expression) && stmt.expression.expression.text === "trigger") {
        this.trigger(stmt.expression);
        continue;
      }
      this.error(stmt, "Only trigger(...) calls and const declarations are allowed at the top level.");
    }
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
    this.lines.push(this.sf.getLineAndCharacterOfPosition(call.getStart(this.sf)).line + 1);
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
    return decl && ts.isVariableDeclaration(decl) && decl.initializer ? decl.initializer : undefined;
  }

  /** Follow wrappers and `const` references down to the expression that carries the value. */
  resolve(expr: TS.Expression, depth = 0): TS.Expression {
    const e = this.unwrap(expr);
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
    if (!v) return fail("Expected a compile-time constant.");
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

/** Compile a script against a declaration file. Never throws for script errors — read `diagnostics`. */
export function compileScript(ts: typeof TS, source: string, declarations: string): CompileResult {
  const files = new Map<string, string>([[DECLARATIONS_FILE, declarations], [SCRIPT_FILE, source]]);
  const options: TS.CompilerOptions = {
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
  const program = ts.createProgram([DECLARATIONS_FILE, SCRIPT_FILE], options, host);
  const sf = program.getSourceFile(SCRIPT_FILE)!;
  const c = new Compiler(ts, program, sf);
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
  return { triggers: c.triggers, lines: c.lines, strings: c.strings, diagnostics: c.diagnostics, ok: c.diagnostics.length === 0 };
}
