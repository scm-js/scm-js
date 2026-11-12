/**
 * Triggers and the mission briefing, read and written as text in SCMDraft 2's TrigEdit
 * syntax: the same text File ▸ Export ▸ Triggers writes and the Text Trigger Editor shows.
 * Writing goes through the editor's own parser, which resolves unit, location and switch
 * names against the open map and interns the strings the text mentions, so a trigger
 * Claude writes is exactly what the user would get by typing it there.
 */
import type { PluginApi, ReadonlyTrigger } from "../../plugins/api";
import { parseTriggers, type TriggerNames } from "../../formats/triggers/text";
import { arr, int, obj, str } from "../schema";
import { cap, json, requireMap, runUpdate } from "./common";
import { ToolError, type AgentTool } from "./types";

type ListName = "triggers" | "briefing";
const listSchema = str("\"triggers\" (the default) or \"briefing\" (the mission briefing, which has its own actions).", ["triggers", "briefing"]);

function listOf(api: PluginApi, which: ListName | undefined): { name: ListName; items: ReadonlyTrigger[]; briefing: boolean } {
  const name = which ?? "triggers";
  return { name, items: name === "briefing" ? api.triggers.briefing() : api.triggers.list(), briefing: name === "briefing" };
}

function playerGroupValue(api: PluginApi, label: string): number {
  const v = api.triggers.defs.choiceValue("player", label) ?? api.triggers.defs.choiceValue("player", label.replace(/^p(\d+)$/i, "Player $1"));
  if (v === undefined) throw new ToolError(`"${label}" is not a player or group (Player 1–12, Force 1–4, All Players, Current Player, Foes, Allies, Neutral Players…).`);
  return v;
}

/**
 * Parse the text against the map's names without changing anything, so a mistake is
 * reported (with its line) before the real parse interns a single string. The editor's
 * parser interns as it goes, and a parse that then fails leaves those strings in the table
 * with no undo entry to take them back.
 */
function checkText(api: PluginApi, text: string, briefing: boolean): number {
  const names = api.triggers.names();
  const dry: TriggerNames = {
    string: (i) => names.string(i),
    intern: () => 1,
    location: (n) => names.location(n),
    locationByName: (s) => names.locationByName(s),
    unit: (id) => names.unit(id),
    unitByName: (s) => names.unitByName(s),
    switch: (i) => names.switch(i),
    switchByName: (s) => names.switchByName(s),
  };
  try {
    const parsed = parseTriggers(text, dry, briefing);
    if (parsed.length === 0) throw new ToolError("The text holds no Trigger(…) block.");
    return parsed.length;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError(`${err instanceof Error ? err.message : String(err)}. Nothing was changed. trigger_signatures and read_docs show the right form.`);
  }
}

function printed(api: PluginApi, items: readonly ReadonlyTrigger[], indices: readonly number[], briefing: boolean): string {
  return indices.map((n) => `// #${n}\n${api.triggers.text.one(items[n], { briefing })}`).join("\n\n");
}

export const triggerTools: AgentTool[] = [
  {
    name: "list_triggers",
    description: "The trigger list (or the briefing) as one line per trigger: its index, the players it runs for, a summary of its conditions and actions, and its comment. Filter by a player or group it runs for, or by text. Read the full text of the ones you need with read_triggers.",
    schema: obj({
      list: listSchema,
      runsFor: str("Only triggers ticked for this player or group (\"Player 1\", \"Force 2\", \"All Players\"). A trigger ticked for a force or All Players also runs for its members, which this filter does not expand."),
      search: str("Only triggers whose summary or comment contains this, any case."),
      offset: int(undefined, 0),
      limit: int("Default 150.", 1, 2000),
    }),
    effect: "read",
    describe: (i) => `List the ${i.list === "briefing" ? "briefing" : "triggers"}`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const { items, briefing } = listOf(api, i.list as ListName | undefined);
      let indices = items.map((_, n) => n);
      if (i.runsFor) indices = api.triggers.triggersFor(items, [playerGroupValue(api, i.runsFor as string)]);
      const rows = indices.map((n) => {
        const s = api.triggers.summarize(items[n], briefing);
        const comment = api.triggers.comment(items[n]);
        return { index: n, players: s.players, conditions: s.conditions, actions: s.actions, ...(comment ? { comment } : {}) };
      });
      const q = (i.search as string | undefined)?.toLowerCase();
      const hits = q ? rows.filter((r) => `${r.conditions} ${r.actions} ${r.comment ?? ""} ${r.players}`.toLowerCase().includes(q)) : rows;
      const offset = (i.offset as number | undefined) ?? 0;
      const limit = (i.limit as number | undefined) ?? 150;
      return cap(json({ total: items.length, matched: hits.length, offset, triggers: hits.slice(offset, offset + limit) }));
    },
  },
  {
    name: "read_triggers",
    description: "The full text of triggers in TrigEdit syntax, each headed `// #index`. Give indices, or start and count; with neither, the whole list (long lists are cut, so page through them).",
    schema: obj({
      list: listSchema,
      indices: arr(int(undefined, 0), undefined, 500),
      start: int(undefined, 0),
      count: int(undefined, 1, 2000),
    }),
    effect: "read",
    describe: (i) => i.indices ? `Read trigger(s) ${(i.indices as number[]).map((n) => `#${n}`).join(", ")}` : i.start !== undefined ? `Read triggers from #${i.start}` : "Read every trigger",
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const { items, briefing } = listOf(api, i.list as ListName | undefined);
      let indices: number[];
      if (i.indices) {
        indices = i.indices as number[];
        const bad = indices.filter((n) => n >= items.length);
        if (bad.length) throw new ToolError(`No trigger #${bad.join(", #")}: the list has ${items.length} (0–${items.length - 1}).`);
      } else {
        const start = (i.start as number | undefined) ?? 0;
        const count = (i.count as number | undefined) ?? items.length;
        indices = items.map((_, n) => n).slice(start, start + count);
      }
      if (indices.length === 0) return `The ${briefing ? "briefing" : "trigger list"} has ${items.length} trigger(s); none in that range.`;
      return cap(printed(api, items, indices, briefing), 60_000, "Read the rest with start / count.");
    },
  },
  {
    name: "add_triggers",
    description: "Add triggers written in TrigEdit text (one or more `Trigger(\"Player 1\"){ Conditions: … Actions: … }` blocks). They are appended, or inserted at `at`. Names of units, locations and switches resolve against this map; quoted text becomes new strings. The text is parsed whole first: if any line is wrong nothing is added and the error names the line. One undo step.",
    schema: obj({ list: listSchema, text: str("The trigger text."), at: int("Insert before this index (default: at the end).", 0) }, ["text"]),
    effect: "write",
    describe: (i) => {
      const n = ((i.text as string).match(/\bTrigger\s*\(/g) ?? []).length;
      return `Add ${n} trigger${n === 1 ? "" : "s"}${i.list === "briefing" ? " to the briefing" : ""}`;
    },
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const briefing = i.list === "briefing";
      let added = 0, first = 0;
      const n = checkText(api, i.text as string, briefing);
      runUpdate(ctx, `Add ${n} trigger(s)${briefing ? " to the briefing" : ""}`, (tx) => {
        const list = briefing ? tx.briefing : tx.triggers;
        const before = list.count();
        added = list.fromText(i.text as string);
        first = before;
        const at = i.at as number | undefined;
        if (at !== undefined && at < before) {
          for (let k = 0; k < added; k++) list.move(before + k, at + k);
          first = at;
        }
      });
      if (added === 0) throw new ToolError("The text held no Trigger(…) block.");
      return json({ added, indices: Array.from({ length: added }, (_, k) => first + k), total: listOf(api, briefing ? "briefing" : "triggers").items.length });
    },
  },
  {
    name: "replace_triggers",
    description: "Replace a run of triggers (start, count) with new text, in place: the new triggers take the old ones' position. The text is parsed before anything is removed, so a parse error leaves the list untouched. One undo step.",
    schema: obj({ list: listSchema, start: int(undefined, 0), count: int("How many existing triggers to replace.", 1), text: str("The new trigger text.") }, ["start", "count", "text"]),
    effect: (i) => ((i as { count: number }).count > 5 ? "destructive" : "write"),
    describe: (i) => `Rewrite trigger(s) #${i.start}${(i.count as number) > 1 ? `–#${(i.start as number) + (i.count as number) - 1}` : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const briefing = i.list === "briefing";
      const start = i.start as number, count = i.count as number;
      const total = listOf(api, briefing ? "briefing" : "triggers").items.length;
      if (start + count > total) throw new ToolError(`#${start}–#${start + count - 1} runs past the end of the list (${total} triggers).`);
      checkText(api, i.text as string, briefing);
      let added = 0;
      runUpdate(ctx, `Rewrite ${count} trigger(s)`, (tx) => {
        const list = briefing ? tx.briefing : tx.triggers;
        const before = list.count();
        added = list.fromText(i.text as string);
        for (let k = 0; k < added; k++) list.move(before + k, start + k);
        list.remove(Array.from({ length: count }, (_, k) => start + added + k));
      });
      return json({ replaced: count, added, indices: Array.from({ length: added }, (_, k) => start + k) });
    },
  },
  {
    name: "delete_triggers",
    description: "Delete triggers by index. Indices after them shift down. One undo step.",
    schema: obj({ list: listSchema, indices: arr(int(undefined, 0), undefined, 5000) }, ["indices"]),
    effect: "destructive",
    describe: (i) => `Delete trigger(s) ${(i.indices as number[]).slice(0, 8).map((n) => `#${n}`).join(", ")}${(i.indices as number[]).length > 8 ? "…" : ""}`,
    run(i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const briefing = i.list === "briefing";
      const total = listOf(api, briefing ? "briefing" : "triggers").items.length;
      const indices = [...new Set(i.indices as number[])];
      const bad = indices.filter((n) => n >= total);
      if (bad.length) throw new ToolError(`No trigger #${bad.join(", #")}: the list has ${total}.`);
      let removed = 0;
      runUpdate(ctx, `Delete ${indices.length} trigger(s)`, (tx) => { removed = (briefing ? tx.briefing : tx.triggers).remove(indices); });
      return json({ removed, remaining: total - removed });
    },
  },
  {
    name: "move_trigger",
    description: "Move one trigger to another position in the list (order matters: the game runs a player's triggers top to bottom).",
    schema: obj({ list: listSchema, from: int(undefined, 0), to: int(undefined, 0) }, ["from", "to"]),
    effect: "write",
    describe: (i) => `Move trigger #${i.from} to #${i.to}`,
    run(i, ctx) {
      requireMap(ctx.api);
      let ok = false;
      runUpdate(ctx, `Move trigger #${i.from} to #${i.to}`, (tx) => { ok = (i.list === "briefing" ? tx.briefing : tx.triggers).move(i.from as number, i.to as number); });
      if (!ok) throw new ToolError("That move is out of range.");
      return "Moved.";
    },
  },
  {
    name: "trigger_signatures",
    description: "The text form of conditions, actions or briefing actions: each one's name and arguments in the order the text takes them, with the kind of value each argument is (player, unit, location, comparison, amount, text…). For what one really does in the game, and an example, read_docs triggers with its name.",
    schema: obj({ kind: str(undefined, ["conditions", "actions", "briefing_actions"]), search: str("Only names containing this.") }, ["kind"]),
    effect: "read",
    describe: (i) => `Read the ${String(i.kind).replace("_", " ")} signatures`,
    run(i, ctx) {
      const defs = ctx.api.triggers.defs;
      const all = i.kind === "conditions" ? defs.conditions() : defs.actions(i.kind === "briefing_actions");
      const q = (i.search as string | undefined)?.toLowerCase();
      return cap(all.filter((d) => !q || d.name.toLowerCase().includes(q))
        .map((d) => `${d.name}(${d.args.map((a) => `${a.label}: ${a.kind}`).join(", ")});`).join("\n"));
    },
  },
  {
    name: "trigger_usage",
    description: "What the triggers use: every switch with its name and how many conditions and actions mention it, the death-counter cells (player, unit) they read or write, and switches no trigger touches — so new triggers can take a free switch or counter without colliding.",
    schema: obj({}),
    effect: "read",
    describe: () => "Check which switches and death counters are in use",
    run(_i, ctx) {
      const api = ctx.api;
      requireMap(api);
      const names = api.triggers.switchNames();
      const counts = api.triggers.switchUsage();
      const usage = api.triggers.usage();
      const used = new Set(usage.switches);
      const named = (n: number) => names[n] !== undefined && names[n] !== "" && !/^Switch \d+$/.test(names[n]);
      return cap(json({
        switches: counts.map((c, n) => ({ number: n + 1, name: named(n) ? names[n] : `Switch ${n + 1}`, mentions: c })).filter((s, n) => s.mentions > 0 || named(n)),
        freeSwitches: names.map((_, n) => n).filter((n) => !used.has(n)).slice(0, 40).map((n) => n + 1),
        deathCounters: usage.cells.map(([p, u]) => ({ player: p + 1, unit: api.names.unit(u), unitId: u })),
      }));
    },
  },
  {
    name: "rename_switches",
    description: "Name switches (1–256), so triggers can refer to them by name. An empty name puts back the default \"Switch N\".",
    schema: obj({ switches: arr(obj({ number: int(undefined, 1, 256), name: str() }, ["number", "name"]), undefined, 256) }, ["switches"]),
    effect: "write",
    describe: (i) => `Name ${(i.switches as unknown[]).length} switch(es)`,
    run(i, ctx) {
      requireMap(ctx.api);
      const list = i.switches as { number: number; name: string }[];
      runUpdate(ctx, `Name ${list.length} switch(es)`, (tx) => { for (const s of list) tx.switches.setName(s.number - 1, s.name); });
      return "Named.";
    },
  },
];
