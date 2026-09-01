/**
 * The structured level's front end: walks the top-level statements that are not
 * `trigger()` calls — `let` variables, assignments, `if` / `while` / `do` / `for`,
 * `break` / `continue`, action calls, calls to the script's own functions — and drives
 * the trigger machine in `lower.ts`.
 *
 * What the language means, in the game's terms:
 *
 * - A `let` holding a number is a death counter (unsigned 32-bit, `-=` stops at 0); a
 *   `let` holding a boolean is a switch. `const`s stay compile-time constants.
 * - Statements run in order within one trigger cycle; a loop's back edge waits for the
 *   next cycle, so `while (true) { … }` is a game loop running once per cycle.
 * - `if (Bring(…) && x >= 3 || !flag)`: conditions are trigger conditions, comparisons
 *   of variables with constants, comparisons between variables (costly — see `lower.ts`),
 *   `&&`, `||`, `!`, and `random()`.
 * - `x = y + 3`, `x += y`, `x++`: linear arithmetic only; there is no multiplication
 *   between variables because the game has no instruction for it.
 * - Functions are inlined at each call — parameters bind to constants or, when an
 *   argument is a variable, to that variable (by reference). No recursion, no return
 *   values.
 *
 * Every trigger argument inside structured code is still a compile-time constant: the
 * point of variables is that *conditions and assignments* can read them.
 */
import type * as TS from "typescript";
import { SwitchAction } from "../formats/chk/sections/triggers";
import type { ActionRecord, ConditionRecord } from "../formats/chk/sections/triggers";
import { ACTION_IDENTS, CONDITION_IDENTS } from "./api";
import { Scope, type Compiler } from "./compiler";
import {
  and, compareConst, cond, FALSE, flipOp, LowerError, Machine, not, or, setSwitch, switchCondition, TRUE,
  type Bool, type CompareOp, type DcVar, type Linear, type SwVar,
} from "./lower";

interface Ctx {
  breakTo?: () => number;
  continueTo?: () => number;
  /** Inside an inlined function: where `return` goes. */
  fn?: { end: () => number };
}

const MAX_INLINE_DEPTH = 16;
const LABEL_LENGTH = 48;

export class Structured {
  private readonly c: Compiler;
  private readonly m: Machine;
  private readonly ts: typeof TS;
  /** After `break` / `continue` / `return` / an endless loop: the next statement needs a state of its own. */
  private dead = false;
  private inlineDepth = 0;
  private scratchUsed = 0;
  /** The program's outermost scope: what a function body closes over. */
  private topScope: Scope | null = null;

  constructor(c: Compiler, m: Machine) {
    this.c = c;
    this.m = m;
    this.ts = c.ts;
  }

  run(statements: TS.Statement[]) {
    this.topScope = new Scope(null);
    try {
      this.block(statements, {}, this.topScope);
      if (!this.dead) this.m.jump(this.m.halt, this.lastLine(statements), "end of program");
    } catch (err) {
      if (!(err instanceof LowerError)) throw err;
      this.c.error(statements[statements.length - 1] ?? this.c.sf, err.message);
    }
    this.c.scope = null;
  }

  private lastLine(statements: TS.Statement[]): number {
    const last = statements[statements.length - 1];
    return last ? this.c.sf.getLineAndCharacterOfPosition(last.getEnd()).line + 1 : 1;
  }

  /** "L12: while (x < 3)" — the comment a generated trigger carries. */
  private label(node: TS.Node): string {
    let text = node.getText(this.c.sf).replace(/\s+/g, " ").trim();
    const brace = text.indexOf("{");
    if (brace > 0) text = text.slice(0, brace).trim();
    if (text.length > LABEL_LENGTH) text = `${text.slice(0, LABEL_LENGTH - 1)}…`;
    return `L${this.c.lineOf(node)}: ${text}`;
  }

  private line(node: TS.Node): number {
    return this.c.lineOf(node);
  }

  private live() {
    if (this.dead) { this.m.enter(this.m.fresh()); this.dead = false; }
  }

  private block(statements: readonly TS.Statement[], ctx: Ctx, scope = new Scope(this.c.scope)) {
    const outer = this.c.scope;
    this.c.scope = scope;
    for (const s of statements) {
      try {
        this.statement(s, ctx);
      } catch (err) {
        if (!(err instanceof LowerError)) throw err;
        this.c.error(s, err.message);
      }
    }
    this.c.scope = outer;
  }

  /* ── Statements ── */

  private statement(s: TS.Statement, ctx: Ctx) {
    const { ts } = this;
    if (ts.isEmptyStatement(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s)) return;
    if (ts.isFunctionDeclaration(s)) {
      if (s.parent !== this.c.sf) this.c.error(s, "Declare functions at the top level of the script.");
      return;
    }
    this.live();
    if (ts.isVariableStatement(s)) { this.declare(s.declarationList); return; }
    if (ts.isBlock(s)) { this.block(s.statements, ctx); return; }
    if (ts.isExpressionStatement(s)) { this.expressionStatement(s.expression); return; }
    if (ts.isIfStatement(s)) { this.ifStatement(s, ctx); return; }
    if (ts.isWhileStatement(s)) { this.whileStatement(s, ctx); return; }
    if (ts.isDoStatement(s)) { this.doStatement(s, ctx); return; }
    if (ts.isForStatement(s)) { this.forStatement(s, ctx); return; }
    if (ts.isBreakStatement(s) || ts.isContinueStatement(s)) {
      if (s.label) { this.c.error(s, "Labelled break / continue is not supported."); return; }
      const target = ts.isBreakStatement(s) ? ctx.breakTo : ctx.continueTo;
      if (!target) { this.c.error(s, `${ts.isBreakStatement(s) ? "break" : "continue"} outside a loop.`); return; }
      this.m.jump(target(), this.line(s), this.label(s));
      this.dead = true;
      return;
    }
    if (ts.isReturnStatement(s)) {
      if (!ctx.fn) { this.c.error(s, "return outside a function."); return; }
      if (s.expression) { this.c.error(s.expression, "Functions cannot return values; write the result into a variable instead."); return; }
      this.m.jump(ctx.fn.end(), this.line(s), this.label(s));
      this.dead = true;
      return;
    }
    if (ts.isSwitchStatement(s)) { this.c.error(s, "switch is not supported; use if / else if."); return; }
    if (ts.isForOfStatement(s) || ts.isForInStatement(s)) { this.c.error(s, "for…of / for…in are not supported; count with a for (let i = 0; …) loop."); return; }
    this.c.error(s, "This statement is not supported in a trigger script.");
  }

  private declare(list: TS.VariableDeclarationList) {
    const { ts } = this;
    const isConst = (list.flags & ts.NodeFlags.Const) !== 0;
    for (const d of list.declarations) {
      if (!ts.isIdentifier(d.name)) { this.c.error(d.name, "Destructuring is not supported."); continue; }
      if (isConst) {
        // Constants resolve through their initialiser at every use (with this scope active); nothing to lower.
        if (!d.initializer) this.c.error(d, "A constant needs a value.");
        continue;
      }
      if (!d.initializer) { this.c.error(d, `Give ${d.name.text} an initial value: let ${d.name.text} = 0 or = false.`); continue; }
      const type = this.c.checker.getTypeAtLocation(d.name);
      const kind = this.kindOf(type);
      if (!kind) { this.c.error(d, `Variables hold numbers (death counters) or booleans (switches); ${d.name.text} is ${this.c.checker.typeToString(type)}.`); continue; }
      const v = kind === "number" ? this.m.allocator.dc(d.name.text) : this.m.allocator.switch(d.name.text);
      if (!v) { this.c.error(d, `No ${kind === "number" ? "death counter" : "switch"} is free for ${d.name.text}.`); continue; }
      if (v.kind === "dc") this.assignNumber(v, d.initializer, d);
      else this.assignBool(v, d.initializer, d);
      // Bound after the initialiser: `let x = x` is the checker's error, not a self-reference here.
      this.c.scope!.bind(d, { kind: "var", v });
    }
  }

  private kindOf(type: TS.Type): "number" | "boolean" | null {
    const { ts } = this;
    const isNumber = (t: TS.Type): boolean => (t.flags & ts.TypeFlags.NumberLike) !== 0 || (t.isIntersection() && t.types.some(isNumber));
    if (type.flags & ts.TypeFlags.BooleanLike) return "boolean";
    if (isNumber(type)) return "number";
    return null;
  }

  private expressionStatement(expr: TS.Expression) {
    const { ts } = this;
    const e = this.c.unwrap(expr);
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      const target = this.c.varOf(e.left);
      if (op === ts.SyntaxKind.EqualsToken || op === ts.SyntaxKind.PlusEqualsToken || op === ts.SyntaxKind.MinusEqualsToken) {
        if (!target) { this.c.error(e.left, "Only let variables can be assigned."); return; }
        if (target.kind === "switch") {
          if (op !== ts.SyntaxKind.EqualsToken) { this.c.error(e, "Booleans take = only."); return; }
          this.assignBool(target, e.right, e);
          return;
        }
        if (op === ts.SyntaxKind.EqualsToken) { this.assignNumber(target, e.right, e); return; }
        const rhs = this.linear(e.right);
        if (!rhs) return;
        const sign = op === ts.SyntaxKind.PlusEqualsToken ? 1 : -1;
        this.m.assign(target, { c: sign * rhs.c, terms: [{ v: target, sign: 1 }, ...rhs.terms.map((t) => ({ v: t.v, sign: (t.sign * sign) as 1 | -1 }))] }, this.line(e), this.label(e));
        return;
      }
      if (op === ts.SyntaxKind.AsteriskEqualsToken || op === ts.SyntaxKind.SlashEqualsToken || op === ts.SyntaxKind.PercentEqualsToken) {
        this.c.error(e, "The game can only add and subtract: there is no multiplication or division between variables.");
        return;
      }
      this.c.error(e, "Only assignments and calls can stand as statements.");
      return;
    }
    if ((ts.isPostfixUnaryExpression(e) || ts.isPrefixUnaryExpression(e)) && (e.operator === ts.SyntaxKind.PlusPlusToken || e.operator === ts.SyntaxKind.MinusMinusToken)) {
      const target = this.c.varOf(e.operand);
      if (!target || target.kind !== "dc") { this.c.error(e, "++ / -- apply to number variables."); return; }
      this.m.addConst(target, e.operator === ts.SyntaxKind.PlusPlusToken ? 1 : -1, this.line(e), this.label(e));
      return;
    }
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
      const name = e.expression.text;
      const decl = this.c.scriptDeclaration(e.expression);
      if (decl) {
        if (ts.isFunctionDeclaration(decl)) { this.inline(e, decl); return; }
        this.c.error(e, `${name} is not a function.`);
        return;
      }
      if (name === "trigger") { this.c.error(e, "trigger() is a top-level declaration; it cannot run inside structured code."); return; }
      if (name === "program") { this.c.error(e, "program() belongs at the top level."); return; }
      if (name === "PreserveTrigger") return; // Every generated trigger is preserved already.
      if (ACTION_IDENTS.has(name) || name === "Action" || name === "SetMemory") {
        const a = this.c.item(e, "action") as ActionRecord | null;
        if (a) this.m.action(a, this.line(e), this.label(e));
        return;
      }
      if (CONDITION_IDENTS.has(name) || name === "Condition" || name === "Memory") { this.c.error(e, `${name} is a condition; test it in an if or while.`); return; }
      if (name === "random" || name === "disabled") { this.c.error(e, `${name}() does nothing on its own.`); return; }
      this.c.error(e, `Unknown function "${name}".`);
      return;
    }
    this.c.error(e, "Only assignments and calls can stand as statements.");
  }

  private ifStatement(s: TS.IfStatement, ctx: Ctx) {
    const held = this.m.tempsHeld;
    const b = this.bool(s.expression);
    const join = this.m.fresh();
    const thenState = this.m.fresh();
    const elseState = s.elseStatement ? this.m.fresh() : join;
    this.m.branch(b, thenState, elseState, this.line(s), this.label(s));
    this.m.releaseTo(held);
    this.m.enter(thenState);
    this.dead = false;
    this.statement(s.thenStatement, ctx);
    if (!this.dead) this.m.jump(join, this.line(s), `L${this.line(s)}: end if`);
    if (s.elseStatement) {
      this.m.enter(elseState);
      this.dead = false;
      this.statement(s.elseStatement, ctx);
      if (!this.dead) this.m.jump(join, this.line(s), `L${this.line(s)}: end else`);
    }
    this.m.enter(join);
    this.dead = false;
  }

  private whileStatement(s: TS.WhileStatement, ctx: Ctx) {
    const header = this.m.loopHeader(this.line(s), this.label(s));
    const exit = this.m.fresh();
    let broke = false;
    const held = this.m.tempsHeld;
    const b = this.bool(s.expression);
    let body: number;
    if (b.kind === "const" && b.value) body = header;
    else {
      body = this.m.fresh();
      this.m.branch(b, body, exit, this.line(s), this.label(s));
      this.m.enter(body);
    }
    this.m.releaseTo(held);
    this.dead = false;
    this.statement(s.statement, { fn: ctx.fn, breakTo: () => { broke = true; return exit; }, continueTo: () => header });
    if (!this.dead) this.m.jump(header, this.line(s), `L${this.line(s)}: loop`);
    if (body === header && !broke) { this.dead = true; return; }
    this.m.enter(exit);
    this.dead = false;
  }

  private doStatement(s: TS.DoStatement, ctx: Ctx) {
    const body = this.m.loopHeader(this.line(s), this.label(s));
    // The condition is tested in a state of its own: a branch back to the state it runs in would fall through as well.
    const check = this.m.fresh();
    const exit = this.m.fresh();
    this.dead = false;
    this.statement(s.statement, { fn: ctx.fn, breakTo: () => exit, continueTo: () => check });
    if (!this.dead) this.m.jump(check, this.line(s), `L${this.line(s)}: while`);
    this.m.enter(check);
    this.dead = false;
    const held = this.m.tempsHeld;
    const b = this.bool(s.expression);
    this.m.branch(b, body, exit, this.line(s), `L${this.line(s)}: while (${s.expression.getText(this.c.sf).replace(/\s+/g, " ")})`);
    this.m.releaseTo(held);
    this.m.enter(exit);
  }

  private forStatement(s: TS.ForStatement, ctx: Ctx) {
    const { ts } = this;
    const outer = this.c.scope;
    this.c.scope = new Scope(outer);
    if (s.initializer) {
      if (ts.isVariableDeclarationList(s.initializer)) this.declare(s.initializer);
      else this.expressionStatement(s.initializer);
    }
    const header = this.m.loopHeader(this.line(s), this.label(s));
    const exit = this.m.fresh();
    let broke = false;
    let incr: number | null = null;
    const held = this.m.tempsHeld;
    const b = s.condition ? this.bool(s.condition) : TRUE;
    let body: number;
    if (b.kind === "const" && b.value) body = header;
    else {
      body = this.m.fresh();
      this.m.branch(b, body, exit, this.line(s), this.label(s));
      this.m.enter(body);
    }
    this.m.releaseTo(held);
    this.dead = false;
    this.statement(s.statement, { fn: ctx.fn, breakTo: () => { broke = true; return exit; }, continueTo: () => (s.incrementor ? (incr ??= this.m.fresh()) : header) });
    if (incr !== null) {
      if (!this.dead) this.m.jump(incr, this.line(s), `L${this.line(s)}: continue`);
      this.m.enter(incr);
      this.dead = false;
    }
    if (!this.dead) {
      if (s.incrementor) this.expressionStatement(s.incrementor);
      this.m.jump(header, this.line(s), `L${this.line(s)}: loop`);
    }
    this.c.scope = outer;
    if (body === header && !broke) { this.dead = true; return; }
    this.m.enter(exit);
    this.dead = false;
  }

  /* ── Functions ── */

  private inline(call: TS.CallExpression, decl: TS.FunctionDeclaration) {
    const { ts } = this;
    if (!decl.body) { this.c.error(call, "The function has no body."); return; }
    if (this.inlineDepth >= MAX_INLINE_DEPTH) { this.c.error(call, "Functions nest too deeply (recursion is not possible: a call is inlined)."); return; }
    if (decl.asteriskToken || decl.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) { this.c.error(decl, "Generators and async functions are not supported."); return; }
    const scope = new Scope(this.topScope);
    let ok = true;
    decl.parameters.forEach((p, i) => {
      if (!ts.isIdentifier(p.name)) { this.c.error(p, "Destructured parameters are not supported."); ok = false; return; }
      if (p.dotDotDotToken) { this.c.error(p, "Rest parameters are not supported."); ok = false; return; }
      const arg = call.arguments[i];
      if (!arg) {
        if (!p.initializer) { this.c.error(call, `Missing argument ${p.name.text}.`); ok = false; return; }
        const v = this.c.value(p.initializer);
        if (!v) { this.c.error(p.initializer, "A default value must be a constant."); ok = false; return; }
        scope.bind(p, { kind: "const", value: v });
        return;
      }
      const v = this.c.value(arg);
      if (v) { scope.bind(p, { kind: "const", value: v }); return; }
      const variable = this.c.varOf(arg);
      if (variable) { scope.bind(p, { kind: "var", v: variable }); return; }
      const literal = this.c.unwrap(arg);
      const bool = literal.kind === ts.SyntaxKind.TrueKeyword ? 1 : literal.kind === ts.SyntaxKind.FalseKeyword ? 0 : null;
      if (bool !== null) { scope.bind(p, { kind: "const", value: { n: bool } }); return; }
      this.c.error(arg, "Arguments are constants or variables (a variable is passed by reference).");
      ok = false;
    });
    if (!ok) return;
    if (call.arguments.length > decl.parameters.length) { this.c.error(call, `${decl.name?.text ?? "The function"} takes ${decl.parameters.length} argument${decl.parameters.length === 1 ? "" : "s"}.`); return; }
    const saved = this.c.scope;
    this.c.scope = scope;
    this.inlineDepth++;
    let end: number | null = null;
    this.block(decl.body.statements, { fn: { end: () => (end ??= this.m.fresh()) } });
    this.inlineDepth--;
    this.c.scope = saved;
    if (end !== null) {
      if (!this.dead) this.m.jump(end, this.line(call), `L${this.line(call)}: end of ${decl.name?.text ?? "function"}`);
      this.m.enter(end);
      this.dead = false;
    }
  }

  /* ── Numbers ── */

  private assignNumber(v: DcVar, expr: TS.Expression, at: TS.Node) {
    const rhs = this.linear(expr);
    if (rhs) this.m.assign(v, rhs, this.line(at), this.label(at));
  }

  /** `c + Σ ±v` over death counters, or null (with a diagnostic). */
  private linear(expr: TS.Expression): Linear | null {
    const { ts } = this;
    const e = this.c.unwrap(expr);
    const k = this.c.value(e);
    if (k) {
      if ("s" in k) { this.c.error(e, "Expected a number, got text."); return null; }
      if (!Number.isInteger(k.n)) { this.c.error(e, "Only whole numbers exist in the game."); return null; }
      return { c: k.n, terms: [] };
    }
    if (ts.isIdentifier(e)) {
      const b = this.c.binding(e);
      if (b?.kind === "var") {
        if (b.v.kind === "switch") { this.c.error(e, `${b.v.name} is a boolean.`); return null; }
        return { c: 0, terms: [{ v: b.v, sign: 1 }] };
      }
      const init = this.c.initializer(e);
      if (init) return this.linear(init);
      this.c.error(e, `${e.text} is not a variable or a constant.`);
      return null;
    }
    if (ts.isPrefixUnaryExpression(e)) {
      const inner = this.linear(e.operand);
      if (!inner) return null;
      if (e.operator === ts.SyntaxKind.PlusToken) return inner;
      if (e.operator === ts.SyntaxKind.MinusToken) return { c: -inner.c, terms: inner.terms.map((t) => ({ v: t.v, sign: -t.sign as 1 | -1 })) };
      this.c.error(e, "Only + and - apply to variables.");
      return null;
    }
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.PlusToken || op === ts.SyntaxKind.MinusToken) {
        const l = this.linear(e.left);
        const r = this.linear(e.right);
        if (!l || !r) return null;
        const sign = op === ts.SyntaxKind.PlusToken ? 1 : -1;
        return { c: l.c + sign * r.c, terms: [...l.terms, ...r.terms.map((t) => ({ v: t.v, sign: (t.sign * sign) as 1 | -1 }))] };
      }
      this.c.error(e, "The game can only add and subtract variables; use * / % on constants only.");
      return null;
    }
    if (ts.isCallExpression(e)) { this.c.error(e, "Functions have no return value; write the result into a variable."); return null; }
    this.c.error(e, "Expected a number: a constant, a variable, or a sum of them.");
    return null;
  }

  /* ── Booleans ── */

  private assignBool(v: SwVar, expr: TS.Expression, at: TS.Node) {
    const { ts } = this;
    const e = this.c.unwrap(expr);
    const line = this.line(at);
    const label = this.label(at);
    if (e.kind === ts.SyntaxKind.TrueKeyword) { this.m.action(setSwitch(v, SwitchAction.Set), line, label); return; }
    if (e.kind === ts.SyntaxKind.FalseKeyword) { this.m.action(setSwitch(v, SwitchAction.Clear), line, label); return; }
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken && this.c.varOf(e.operand) === v) { this.m.action(setSwitch(v, SwitchAction.Toggle), line, label); return; }
    if (this.c.isRuntimeCall(e, "random")) { this.m.action(setSwitch(v, SwitchAction.Randomize), line, label); return; }
    const held = this.m.tempsHeld;
    const b = this.bool(e);
    if (b.kind === "const") { this.m.action(setSwitch(v, b.value ? SwitchAction.Set : SwitchAction.Clear), line, label); this.m.releaseTo(held); return; }
    const on = this.m.fresh();
    const off = this.m.fresh();
    const join = this.m.fresh();
    this.m.branch(b, on, off, line, label);
    this.m.releaseTo(held);
    this.m.enter(on);
    this.m.action(setSwitch(v, SwitchAction.Set), line, label);
    this.m.jump(join, line, label);
    this.m.enter(off);
    this.m.action(setSwitch(v, SwitchAction.Clear), line, label);
    this.m.jump(join, line, label);
    this.m.enter(join);
  }

  /** A condition as a `Bool` tree; may emit steps (temps for variable comparisons, a randomize). */
  private bool(expr: TS.Expression): Bool {
    this.scratchUsed = 0;
    return this.boolInner(expr, 0);
  }

  private boolInner(expr: TS.Expression, depth: number): Bool {
    const { ts } = this;
    const e = this.c.unwrap(expr);
    if (depth > 64) { this.c.error(e, "The condition nests too deeply."); return FALSE; }
    if (e.kind === ts.SyntaxKind.TrueKeyword) return TRUE;
    if (e.kind === ts.SyntaxKind.FalseKeyword) return FALSE;
    if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return not(this.boolInner(e.operand, depth + 1));
    if (ts.isBinaryExpression(e)) {
      const op = e.operatorToken.kind;
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) return and([this.boolInner(e.left, depth + 1), this.boolInner(e.right, depth + 1)]);
      if (op === ts.SyntaxKind.BarBarToken) return or([this.boolInner(e.left, depth + 1), this.boolInner(e.right, depth + 1)]);
      const cmp = compareOp(ts, op);
      if (cmp) return this.comparison(e, cmp, depth);
      this.c.error(e, "Expected a condition.");
      return FALSE;
    }
    if (ts.isIdentifier(e)) {
      const b = this.c.binding(e);
      if (b?.kind === "var") return b.v.kind === "switch" ? cond(switchCondition(b.v, true)) : compareConst(b.v, ">=", 1);
      if (b?.kind === "const") return "n" in b.value ? (b.value.n !== 0 ? TRUE : FALSE) : b.value.s !== "" ? TRUE : FALSE;
      const init = this.c.initializer(e);
      if (init) return this.boolInner(init, depth + 1);
      this.c.error(e, `${e.text} is not a variable, a constant or a condition.`);
      return FALSE;
    }
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression)) {
      const name = e.expression.text;
      if (this.c.scriptDeclaration(e.expression)) { this.c.error(e, "Functions have no return value; test a variable the function sets instead."); return FALSE; }
      if (name === "random") {
        const s = this.m.scratch(this.scratchUsed++);
        this.m.action(setSwitch(s, SwitchAction.Randomize), this.line(e), `L${this.line(e)}: random()`);
        return cond(switchCondition(s, true));
      }
      if (ACTION_IDENTS.has(name) || name === "Action" || name === "SetMemory") { this.c.error(e, `${name} is an action, not a condition.`); return FALSE; }
      const r = this.c.item(e, "condition") as ConditionRecord | null;
      return r ? cond(r) : FALSE;
    }
    const k = this.c.value(e);
    if (k) return ("n" in k ? k.n !== 0 : k.s !== "") ? TRUE : FALSE;
    this.c.error(e, "Expected a condition: a trigger condition, a comparison, a boolean variable, or a combination with && || !.");
    return FALSE;
  }

  private comparison(e: TS.BinaryExpression, op: CompareOp, depth: number): Bool {
    const { ts } = this;
    // Boolean equality: `flag == true`, `a != b` over switches.
    const isBool = (x: TS.Expression) => {
      const u = this.c.unwrap(x);
      if (u.kind === ts.SyntaxKind.TrueKeyword || u.kind === ts.SyntaxKind.FalseKeyword) return true;
      const v = this.c.varOf(u);
      return v?.kind === "switch";
    };
    if (isBool(e.left) || isBool(e.right)) {
      if (op !== "==" && op !== "!=") { this.c.error(e, "Booleans compare with == and != only."); return FALSE; }
      const l = this.boolInner(e.left, depth + 1);
      const r = this.boolInner(e.right, depth + 1);
      const same = or([and([l, r]), and([not(l), not(r)])]);
      return op === "==" ? same : not(same);
    }
    const l = this.linear(e.left);
    const r = this.linear(e.right);
    if (!l || !r) return FALSE;
    // l − r  op  0
    const d: Linear = { c: l.c - r.c, terms: [...l.terms, ...r.terms.map((t) => ({ v: t.v, sign: -t.sign as 1 | -1 }))] };
    // Cancel a variable that appears on both sides with opposite signs.
    for (let i = 0; i < d.terms.length; i++) {
      const j = d.terms.findIndex((t, k) => k > i && t.v === d.terms[i].v && t.sign !== d.terms[i].sign);
      if (j >= 0) { d.terms.splice(j, 1); d.terms.splice(i, 1); i--; }
    }
    if (d.terms.length === 0) return compareNumbers(d.c, op, 0) ? TRUE : FALSE;
    if (d.terms.length === 1) {
      const t = d.terms[0];
      return t.sign > 0 ? compareConst(t.v, op, -d.c) : compareConst(t.v, flipOp(op), d.c);
    }
    // Two sides to compute: `a + c  op  b` with the constant on whichever side keeps it non-negative.
    const line = this.line(e);
    const label = `L${line}: ${e.getText(this.c.sf).replace(/\s+/g, " ")}`;
    const left: Linear = { c: Math.max(0, d.c), terms: d.terms.filter((t) => t.sign > 0) };
    const right: Linear = { c: Math.max(0, -d.c), terms: d.terms.filter((t) => t.sign < 0).map((t) => ({ v: t.v, sign: 1 as const })) };
    const side = (x: Linear): DcVar => {
      if (x.c === 0 && x.terms.length === 1) return x.terms[0].v;
      const t = this.m.temp();
      this.m.evaluate(t, x, line, label);
      return t;
    };
    const a = side(left);
    const b = side(right);
    return this.m.compareVars(a, op, b, line, label).bool;
  }
}

function compareOp(ts: typeof TS, kind: TS.SyntaxKind): CompareOp | null {
  switch (kind) {
    case ts.SyntaxKind.LessThanToken: return "<";
    case ts.SyntaxKind.LessThanEqualsToken: return "<=";
    case ts.SyntaxKind.GreaterThanToken: return ">";
    case ts.SyntaxKind.GreaterThanEqualsToken: return ">=";
    case ts.SyntaxKind.EqualsEqualsToken: case ts.SyntaxKind.EqualsEqualsEqualsToken: return "==";
    case ts.SyntaxKind.ExclamationEqualsToken: case ts.SyntaxKind.ExclamationEqualsEqualsToken: return "!=";
    default: return null;
  }
}

function compareNumbers(a: number, op: CompareOp, b: number): boolean {
  switch (op) {
    case "<": return a < b;
    case "<=": return a <= b;
    case ">": return a > b;
    case ">=": return a >= b;
    case "==": return a === b;
    case "!=": return a !== b;
  }
}
