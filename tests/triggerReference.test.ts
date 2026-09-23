/**
 * `docs/triggers.md`, the trigger reference: its generated blocks are the editor's own
 * tables, the byte offsets it gives are where the codec really writes each field, and
 * every example line parses in the text format the page says it is written in.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as defs from "../src/data/triggerDefs";
import { UNIT_NAMES } from "../src/data/units";
import { emptyAction, emptyCondition, emptyTrigger, encodeTriggers, type ActionRecord, type ConditionRecord } from "../src/formats/chk/sections/triggers";
import { parseTriggers, type TriggerNames } from "../src/formats/triggers/text";
// @ts-expect-error — a plain .mjs module shared with scripts/trigger-reference.mjs
import { ACTION_FIELDS, CONDITION_FIELDS, fillReference } from "../scripts/lib/trigger-reference.mjs";

const FILE = join(import.meta.dirname, "../docs/triggers.md");
const doc = readFileSync(FILE, "utf8");

/** Names that accept whatever an example calls a location or a string, and the real unit names. */
function exampleNames(): TriggerNames {
  const strings = [""];
  const locations: string[] = [];
  const lower = (s: string) => s.trim().toLowerCase();
  return {
    string: (i) => strings[i] ?? null,
    intern: (t) => { strings.push(t); return strings.length - 1; },
    location: (n) => locations[n - 1] ?? `Location ${n}`,
    locationByName: (name) => {
      if (lower(name) === "anywhere") return 64;
      let at = locations.indexOf(name);
      if (at < 0) at = locations.push(name) - 1;
      return at + 1;
    },
    unit: (id) => UNIT_NAMES[id] ?? `Unit #${id}`,
    unitByName: (name) => {
      const cls = defs.UNIT_CLASS_CHOICES.find((u) => lower(u.label) === lower(name));
      if (cls) return cls.value;
      const id = UNIT_NAMES.findIndex((n) => lower(n) === lower(name));
      return id >= 0 ? id : undefined;
    },
    switch: (i) => `Switch ${i + 1}`,
    switchByName: (name) => { const m = /^Switch (\d+)$/.exec(name.trim()); return m ? Number(m[1]) - 1 : undefined; },
  };
}

describe("the trigger reference", () => {
  it("is up to date with the editor's trigger tables (npm run docs:triggers)", () => {
    const { text, missing, unknown } = fillReference(doc, defs);
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
    expect(text === doc).toBe(true);
  });

  it("gives each field the offset the codec writes it at", () => {
    // Every field a distinct value; each must be found where the reference says.
    const condition = { ...emptyCondition() } as ConditionRecord;
    const action = { ...emptyAction() } as ActionRecord;
    let n = 1;
    for (const key of Object.keys(CONDITION_FIELDS)) (condition as unknown as Record<string, number>)[key] = n++;
    for (const key of Object.keys(ACTION_FIELDS)) (action as unknown as Record<string, number>)[key] = n++;
    const t = emptyTrigger();
    t.conditions.push(condition);
    t.actions.push(action);
    const bytes = encodeTriggers([t]);
    const read = (base: number, [offset, width]: [number, number]) => {
      let v = 0;
      for (let i = width - 1; i >= 0; i--) v = v * 256 + bytes[base + offset + i];
      return v;
    };
    for (const [key, field] of Object.entries(CONDITION_FIELDS) as [keyof ConditionRecord, [number, number]][]) {
      expect(read(0, field), `condition ${key}`).toBe(condition[key]);
    }
    for (const [key, field] of Object.entries(ACTION_FIELDS) as [keyof ActionRecord, [number, number]][]) {
      expect(read(320, field), `action ${key}`).toBe(action[key]);
    }
  });

  it("has examples that parse as text triggers", () => {
    const examples = [...doc.matchAll(/```trigedit\n([\s\S]*?)```/g)].flatMap((m) => m[1].trim().split("\n"));
    expect(examples.length).toBeGreaterThan(70);
    const failures: string[] = [];
    for (const line of examples) {
      const name = line.slice(0, line.indexOf("("));
      const isCondition = defs.conditionDefByName(name) !== undefined;
      const text = isCondition
        ? `Trigger("Player 1"){\nConditions:\n\t${line}\n\nActions:\n\tComment("x");\n}`
        : `Trigger("Player 1"){\nConditions:\n\tAlways();\n\nActions:\n\t${line}\n}`;
      try {
        parseTriggers(text, exampleNames());
      } catch (e) {
        failures.push(`${line} — ${(e as Error).message}`);
      }
    }
    expect(failures).toEqual([]);
  });
});
