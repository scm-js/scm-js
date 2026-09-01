/**
 * Text triggers: SCMDraft 2's TrigEdit syntax, printed from and parsed into trigger records.
 *
 *     Trigger("Player 1", "Force 2"){
 *     Conditions:
 *       Bring("Current Player", "Any unit", "Beacon Alpha", At least, 1);
 *     Actions:
 *       Display Text Message(Always Display, "You found it!");
 *       Preserve Trigger();
 *     }
 *
 * Names (players, units, locations, switches, strings, AI scripts) resolve through a
 * `TriggerNames` context so this module knows nothing about the scenario. Anything the
 * context cannot name prints as a bare number and parses back from one, so a record with
 * an EUD player or an out-of-range unit still round-trips. A leading `;` disables a
 * condition or action (its `Disabled` flag); a `Flags:` block carries the trigger-level
 * flags SCMDraft has no syntax for, and is omitted when there are none.
 */
import {
  ActionFlag, ConditionFlag, TriggerFlag, cloneTrigger, emptyAction, emptyCondition, emptyTrigger,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../chk/sections/triggers";
import {
  actionDef, actionDefByName, aiScriptByName, aiScriptName, choiceLabel, choiceValue, conditionDef, conditionDefByName,
  PLAYER_GROUP_CHOICES, UNIT_CLASS_CHOICES, type ActionDef, type ArgDef, type ArgKind, type ConditionDef,
} from "../../data/triggerDefs";

/** How the text format names things it cannot know on its own. */
export interface TriggerNames {
  /** Text of a string-table entry, null when unset. */
  string(index: number): string | null;
  /** Index for `text` — an existing identical entry or a new one. Only called while parsing. */
  intern(text: string): number;
  /** Display name of a 1-based location number. */
  location(number: number): string;
  /** 1-based number for a location name (or `Location N` / `Anywhere`), undefined when unknown. */
  locationByName(name: string): number | undefined;
  unit(id: number): string;
  unitByName(name: string): number | undefined;
  /** Display name of a 0-based switch. */
  switch(index: number): string;
  switchByName(name: string): number | undefined;
}

export interface TextTrigger {
  trigger: TriggerRecord;
  /** 1-based line the `Trigger(` header starts on. */
  line: number;
}

export class TriggerTextError extends Error {
  readonly line: number;
  constructor(message: string, line: number) {
    super(`Line ${line}: ${message}`);
    this.name = "TriggerTextError";
    this.line = line;
  }
}

/* ── Printing ────────────────────────────────────────────── */

export function quote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t")}"`;
}

const SEPARATOR = "//-----------------------------------------------------------------//";

export const TRIGGER_FLAG_NAMES: [number, string][] = [
  [TriggerFlag.Preserve, "Preserve"],
  [TriggerFlag.Disabled, "Disabled"],
  [TriggerFlag.IgnoreGameEnd, "Ignore Game End"],
  [TriggerFlag.IgnoreDisplay, "Ignore Display"],
  [TriggerFlag.ConditionsMet, "Conditions Met"],
  [TriggerFlag.Paused, "Paused"],
  [TriggerFlag.WaitSkipDisabled, "Wait Skip Disabled"],
];

function formatValue(kind: ArgKind, value: number, names: TriggerNames): string {
  switch (kind) {
    case "player": { const label = choiceLabel("player", value); return label ? quote(label) : String(value); }
    case "unit": return quote(names.unit(value));
    case "location": return quote(names.location(value));
    case "switch": return quote(names.switch(value));
    case "text": case "wav": return quote(names.string(value) ?? "");
    case "aiScript": return quote(aiScriptName(value));
    case "count": return value === 0 ? "All" : String(value);
    case "number": case "amount": case "duration": case "percent": case "cuwp": case "slot":
      return String(value);
    default:
      return choiceLabel(kind, value) ?? String(value);
  }
}

function argValue<R>(record: R, arg: ArgDef<keyof R & string>): number {
  const raw = record[arg.field] as number;
  // The display argument is one bit of the flag byte.
  return arg.kind === "textFlags" ? raw & ActionFlag.AlwaysDisplay : raw;
}

export function formatCondition(c: ConditionRecord, names: TriggerNames): string {
  const def = conditionDef(c.type);
  const prefix = c.flags & ConditionFlag.Disabled ? ";" : "";
  if (!def) return `${prefix}Condition ${c.type}(${[c.location, c.player, c.amount, c.unitId, c.comparison, c.resource].join(", ")});`;
  const args = def.args.map((arg) => formatValue(arg.kind, argValue(c, arg), names));
  return `${prefix}${def.name}(${args.join(", ")});`;
}

export function formatAction(a: ActionRecord, names: TriggerNames, briefing = false): string {
  const def = actionDef(a.type, briefing);
  const prefix = a.flags & ActionFlag.Disabled ? ";" : "";
  if (!def) return `${prefix}Action ${a.type}(${[a.location, a.text, a.wav, a.time, a.player, a.target, a.unitId, a.modifier].join(", ")});`;
  const args = def.args.map((arg) => formatValue(arg.kind, argValue(a, arg), names));
  return `${prefix}${def.name}(${args.join(", ")});`;
}

export function formatTrigger(t: TriggerRecord, names: TriggerNames, briefing = false): string {
  const players: string[] = [];
  t.players.forEach((v, i) => { if (v) players.push(quote(PLAYER_GROUP_CHOICES[i]?.label ?? String(i))); });
  const flags = TRIGGER_FLAG_NAMES.filter(([bit]) => t.flags & bit).map(([, name]) => name);
  const unknownFlags = t.flags & ~TRIGGER_FLAG_NAMES.reduce((m, [bit]) => m | bit, 0);
  if (unknownFlags) flags.push(`0x${unknownFlags.toString(16)}`);
  const lines = [`Trigger(${players.join(", ")}){`, "Conditions:"];
  for (const c of t.conditions) lines.push(`\t${formatCondition(c, names)}`);
  lines.push("", "Actions:");
  for (const a of t.actions) lines.push(`\t${formatAction(a, names, briefing)}`);
  if (flags.length) lines.push("", "Flags:", `\t${flags.join(", ")};`);
  lines.push("}");
  return lines.join("\n");
}

export function formatTriggers(triggers: TriggerRecord[], names: TriggerNames, briefing = false): string {
  return triggers.map((t) => formatTrigger(t, names, briefing)).join(`\n\n${SEPARATOR}\n\n`) + (triggers.length ? "\n" : "");
}

/* ── Parsing ─────────────────────────────────────────────── */

interface Token {
  kind: "word" | "string" | "punct";
  text: string;
  line: number;
}

/**
 * Words are runs of anything but punctuation and quotes, so multi-word names ("Set To",
 * "Preserve Trigger") come out as one token; surrounding whitespace is trimmed.
 */
function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i];
    if (ch === "\n") { line++; i++; continue; }
    if (ch === " " || ch === "\t" || ch === "\r") { i++; continue; }
    if (ch === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (ch === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i++; }
      i += 2;
      continue;
    }
    if (ch === '"') {
      const start = line;
      let s = "";
      i++;
      for (;;) {
        if (i >= n) throw new TriggerTextError("Unterminated string.", start);
        const c = src[i++];
        if (c === '"') break;
        if (c === "\n") line++;
        if (c === "\\") {
          const e = src[i++];
          if (e === "n") s += "\n";
          else if (e === "r") s += "\r";
          else if (e === "t") s += "\t";
          else if (e === "x") { s += String.fromCharCode(parseInt(src.slice(i, i + 2), 16)); i += 2; }
          else if (e === undefined) throw new TriggerTextError("Unterminated string.", start);
          else s += e;
        } else s += c;
      }
      out.push({ kind: "string", text: s, line: start });
      continue;
    }
    if ("(){},;:".includes(ch)) { out.push({ kind: "punct", text: ch, line }); i++; continue; }
    const start = i;
    const startLine = line;
    while (i < n && !'(){},;:"\n'.includes(src[i]) && !(src[i] === "/" && (src[i + 1] === "/" || src[i + 1] === "*"))) i++;
    out.push({ kind: "word", text: src.slice(start, i).trim(), line: startLine });
  }
  return out;
}

class Parser {
  pos = 0;
  readonly tokens: Token[];
  readonly names: TriggerNames;
  readonly briefing: boolean;
  constructor(tokens: Token[], names: TriggerNames, briefing: boolean) {
    this.tokens = tokens;
    this.names = names;
    this.briefing = briefing;
  }

  get line() { return this.tokens[this.pos]?.line ?? this.tokens[this.tokens.length - 1]?.line ?? 1; }
  peek() { return this.tokens[this.pos]; }
  next(): Token {
    const t = this.tokens[this.pos++];
    if (!t) throw new TriggerTextError("Unexpected end of text.", this.line);
    return t;
  }
  expect(text: string): Token {
    const t = this.next();
    if (t.kind !== "punct" || t.text !== text) throw new TriggerTextError(`Expected "${text}" but found "${t.text}".`, t.line);
    return t;
  }
  isPunct(text: string) { const t = this.peek(); return !!t && t.kind === "punct" && t.text === text; }

  /** Comma-separated tokens up to the closing paren. Each argument is exactly one token. */
  args(): Token[] {
    this.expect("(");
    const out: Token[] = [];
    if (this.isPunct(")")) { this.next(); return out; }
    for (;;) {
      const t = this.next();
      if (t.kind === "punct") throw new TriggerTextError(`Unexpected "${t.text}" in an argument list.`, t.line);
      out.push(t);
      const sep = this.next();
      if (sep.kind === "punct" && sep.text === ")") return out;
      if (!(sep.kind === "punct" && sep.text === ",")) throw new TriggerTextError(`Expected "," or ")" but found "${sep.text}".`, sep.line);
    }
  }

  trigger(): TextTrigger {
    const head = this.next();
    if (!(head.kind === "word" && head.text.toLowerCase() === "trigger")) throw new TriggerTextError(`Expected "Trigger" but found "${head.text}".`, head.line);
    const t = emptyTrigger();
    for (const p of this.args()) {
      const v = p.kind === "string" || p.kind === "word" ? choiceValue("player", p.text) ?? (/^\d+$/.test(p.text) ? Number(p.text) : undefined) : undefined;
      if (v === undefined || v < 0 || v >= t.players.length) throw new TriggerTextError(`Unknown player "${p.text}".`, p.line);
      t.players[v] = 1;
    }
    this.expect("{");
    let section: "conditions" | "actions" | "flags" | null = null;
    while (!this.isPunct("}")) {
      const tok = this.next();
      if (tok.kind === "word" && this.isPunct(":")) {
        this.next();
        const name = tok.text.toLowerCase();
        if (name === "conditions") section = "conditions";
        else if (name === "actions") section = "actions";
        else if (name === "flags") section = "flags";
        else throw new TriggerTextError(`Unknown section "${tok.text}".`, tok.line);
        continue;
      }
      if (section === "flags") {
        this.pos--;
        t.flags |= this.flags();
        continue;
      }
      let disabled = false;
      let nameTok = tok;
      if (tok.kind === "punct" && tok.text === ";") {
        // A leading ";" disables the item — but a stray one after another item is just a separator.
        if (this.peek()?.kind !== "word") continue;
        disabled = true;
        nameTok = this.next();
      }
      if (nameTok.kind !== "word") throw new TriggerTextError(`Expected a condition or action name but found "${nameTok.text}".`, nameTok.line);
      if (section === "conditions") {
        if (t.conditions.length >= 16) throw new TriggerTextError("A trigger holds at most 16 conditions.", nameTok.line);
        t.conditions.push(this.condition(nameTok, disabled));
      } else if (section === "actions") {
        if (t.actions.length >= 64) throw new TriggerTextError("A trigger holds at most 64 actions.", nameTok.line);
        t.actions.push(this.action(nameTok, disabled));
      } else {
        throw new TriggerTextError(`"${nameTok.text}" appears before a "Conditions:" or "Actions:" label.`, nameTok.line);
      }
      if (this.isPunct(";")) this.next();
    }
    this.expect("}");
    return { trigger: t, line: head.line };
  }

  flags(): number {
    let flags = 0;
    while (!this.isPunct("}") && !(this.peek()?.kind === "word" && this.tokens[this.pos + 1]?.kind === "punct" && this.tokens[this.pos + 1].text === ":")) {
      const tok = this.next();
      if (tok.kind === "punct") continue;
      const key = tok.text.toLowerCase();
      const hit = TRIGGER_FLAG_NAMES.find(([, name]) => name.toLowerCase() === key);
      if (hit) flags |= hit[0];
      else if (/^0x[0-9a-f]+$/i.test(tok.text)) flags |= parseInt(tok.text, 16);
      else if (/^\d+$/.test(tok.text)) flags |= Number(tok.text);
      else throw new TriggerTextError(`Unknown trigger flag "${tok.text}".`, tok.line);
    }
    return flags;
  }

  condition(nameTok: Token, disabled: boolean): ConditionRecord {
    const c = emptyCondition();
    const args = this.args();
    const raw = /^condition\s+(\d+)$/i.exec(nameTok.text);
    if (raw) {
      c.type = Number(raw[1]);
      const nums = args.map((t) => this.number(t));
      [c.location, c.player, c.amount, c.unitId, c.comparison, c.resource] = [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0, nums[4] ?? 0, nums[5] ?? 0];
    } else {
      const def = conditionDefByName(nameTok.text);
      if (!def) throw new TriggerTextError(`Unknown condition "${nameTok.text}".`, nameTok.line);
      c.type = def.type;
      this.fill(c, def, args, nameTok);
    }
    if (disabled) c.flags |= ConditionFlag.Disabled;
    this.unitFlags(c, c.type, false);
    return c;
  }

  action(nameTok: Token, disabled: boolean): ActionRecord {
    const a = emptyAction();
    const args = this.args();
    const raw = /^action\s+(\d+)$/i.exec(nameTok.text);
    if (raw) {
      a.type = Number(raw[1]);
      const nums = args.map((t) => this.number(t));
      [a.location, a.text, a.wav, a.time, a.player, a.target, a.unitId, a.modifier] =
        [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0, nums[3] ?? 0, nums[4] ?? 0, nums[5] ?? 0, nums[6] ?? 0, nums[7] ?? 0];
    } else {
      const def = actionDefByName(nameTok.text, this.briefing);
      if (!def) throw new TriggerTextError(`Unknown action "${nameTok.text}".`, nameTok.line);
      a.type = def.type;
      this.fill(a, def, args, nameTok);
    }
    if (disabled) a.flags |= ActionFlag.Disabled;
    this.unitFlags(a, a.type, true);
    return a;
  }

  /** StarEdit sets "unit type used" on anything with a unit argument (the fixture maps' Command conditions carry 0x10). */
  private unitFlags(r: { flags: number }, type: number, isAction: boolean) {
    const def = isAction ? actionDef(type, this.briefing) : conditionDef(type);
    if (def?.args.some((arg) => arg.kind === "unit")) r.flags |= isAction ? ActionFlag.UnitTypeUsed : ConditionFlag.UnitTypeUsed;
  }

  private fill(record: ConditionRecord | ActionRecord, def: ConditionDef | ActionDef, args: Token[], nameTok: Token) {
    if (args.length !== def.args.length) {
      throw new TriggerTextError(`${def.name} takes ${def.args.length} argument${def.args.length === 1 ? "" : "s"}, got ${args.length}.`, nameTok.line);
    }
    def.args.forEach((arg, i) => {
      (record as unknown as Record<string, number>)[arg.field] = this.value(arg.kind, args[i]);
    });
  }

  private number(tok: Token): number {
    if (/^-?\d+$/.test(tok.text)) return Number(tok.text) >>> 0;
    if (/^0x[0-9a-f]+$/i.test(tok.text)) return parseInt(tok.text, 16) >>> 0;
    throw new TriggerTextError(`Expected a number but found "${tok.text}".`, tok.line);
  }

  private value(kind: ArgKind, tok: Token): number {
    const text = tok.text;
    const asNumber = () => (/^-?\d+$/.test(text) ? Number(text) >>> 0 : /^0x[0-9a-f]+$/i.test(text) ? parseInt(text, 16) >>> 0 : undefined);
    const fail = (what: string): never => { throw new TriggerTextError(`Unknown ${what} "${text}".`, tok.line); };
    switch (kind) {
      case "player": return choiceValue("player", text) ?? asNumber() ?? fail("player");
      case "unit": {
        if (tok.kind === "word") { const n = asNumber(); if (n !== undefined) return n; }
        return this.names.unitByName(text) ?? UNIT_CLASS_CHOICES.find((u) => u.label.toLowerCase() === text.toLowerCase() || u.aliases?.some((al) => al.toLowerCase() === text.toLowerCase()))?.value ?? fail("unit");
      }
      case "location": {
        if (tok.kind === "word") { const n = asNumber(); if (n !== undefined) return n; }
        if (/^no location$/i.test(text)) return 0;
        return this.names.locationByName(text) ?? fail("location");
      }
      case "switch": {
        if (tok.kind === "word") { const n = asNumber(); if (n !== undefined) return n; }
        return this.names.switchByName(text) ?? fail("switch");
      }
      case "text": case "wav":
        return this.names.intern(text);
      case "aiScript":
        return aiScriptByName(text) ?? asNumber() ?? fail("AI script");
      case "count":
        return /^all$/i.test(text) ? 0 : asNumber() ?? fail("count");
      case "number": case "amount": case "duration": case "percent": case "cuwp": case "slot":
        return asNumber() ?? fail("number");
      default:
        return choiceValue(kind, text) ?? asNumber() ?? fail(kind);
    }
  }
}

/** Parse a whole text into triggers; throws `TriggerTextError` with the offending line. */
export function parseTriggers(text: string, names: TriggerNames, briefing = false): TextTrigger[] {
  const parser = new Parser(tokenize(text), names, briefing);
  const out: TextTrigger[] = [];
  while (parser.peek()) out.push(parser.trigger());
  return out;
}

/** A one-line summary of a trigger for lists: its comment, else its first condition and action. */
export function summarizeTrigger(t: TriggerRecord, names: TriggerNames, briefing = false): { players: string; conditions: string; actions: string } {
  const players = t.players.map((v, i) => (v ? PLAYER_GROUP_CHOICES[i]?.label ?? String(i) : null)).filter((s): s is string => !!s).join(", ");
  const conditions = t.conditions.map((c) => formatCondition(c, names).replace(/;$/, "")).join(" && ");
  const actions = t.actions.map((a) => formatAction(a, names, briefing).replace(/;$/, "")).join("; ");
  return { players, conditions, actions };
}

/** Text of the trigger's Comment action, if it has one. */
export function triggerComment(t: TriggerRecord, names: TriggerNames): string | null {
  const c = t.actions.find((a) => a.type === 47);
  return c ? names.string(c.text) : null;
}

/** A copy of the trigger with its Comment action set to `text` (removed when empty). */
export function withComment(t: TriggerRecord, text: string, names: TriggerNames): TriggerRecord {
  const next = cloneTrigger(t);
  const at = next.actions.findIndex((a) => a.type === 47);
  if (text === "") {
    if (at >= 0) next.actions.splice(at, 1);
    return next;
  }
  const index = names.intern(text);
  if (at >= 0) next.actions[at].text = index;
  else next.actions.unshift({ ...emptyAction(), type: 47, text: index });
  return next;
}
