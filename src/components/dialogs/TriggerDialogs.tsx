/**
 * The three trigger editors over `scenario.triggers` / `scenario.briefing`:
 *
 * - Classic (StarEdit-style forms) and Mission Briefing share `TriggerListEditor`, a
 *   three-pane list ▸ trigger ▸ condition/action editor whose argument widgets are driven
 *   entirely by `data/triggerDefs.ts`.
 * - Text (TrigEdit syntax) prints the list through `formats/triggers/text.ts` and parses
 *   it back on Compile.
 *
 * All three are dialog transactions (OK / Apply / Cancel over a working copy) like the
 * settings dialogs, committed through `commitTriggersAtom`.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ArrowDown, ArrowUp, Braces, Code2, Copy, MessageSquare, Plus, Trash2, Zap } from "lucide-react";
import { commitTriggersAtom, locationsRevisionAtom, scenarioAtom, settingsRevisionAtom, triggersRevisionAtom } from "../../atoms/documentAtoms";
import { pluginTriggerClaimsAtom, type PluginTriggerClaim } from "../../atoms/pluginAtoms";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { claimAt, claimBadge, claimDescription, locateClaims, type ClaimedRange } from "../../plugins/claims";
import {
  ACTION_DEFS, AI_SCRIPT_CHOICES, aiScriptCode, aiScriptId, BRIEFING_ACTION_DEFS, CHOICES, CONDITION_DEFS, DEATHS_TABLE_ADDRESS, PLAYER_GROUP_CHOICES,
  UNIT_CLASS_CHOICES, actionDef, conditionDef, type ActionDef, type ArgDef, type ArgKind, type ConditionDef,
} from "../../data/triggerDefs";
import { UNIT_NAMES } from "../../data/units";
import type { Scenario } from "../../formats/chk/scenario";
import {
  ActionFlag, ConditionFlag, ConditionType, MAX_ACTIONS, MAX_CONDITIONS, PlayerGroup, SWITCH_COUNT, cloneTrigger,
  type ActionRecord, type ConditionRecord, type TriggerRecord,
} from "../../formats/chk/sections/triggers";
import { formatAction, formatCondition, formatTriggers, parseTriggers, summarizeTrigger, TriggerTextError, triggerComment, withComment, type TriggerNames } from "../../formats/triggers/text";
import { cuwpSlotLabel, CUWP_SLOTS } from "../../editor/cuwp";
import { usedLocations } from "../../editor/locations";
import { unitCustomName } from "../../editor/settings";
import {
  applyBriefing, applyTriggers, insertTrigger, isPreserved, moveTrigger, newAction, newCondition, newTrigger, readBriefing, readTriggers,
  removeTriggers, setPreserved, triggerNames,
} from "../../editor/triggers";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { Button, Check, ListBox, NumberInput, Select, Tabs, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Shared ─────────────────────────────────────────────── */

function useNames(scenario: Scenario | null): TriggerNames | null {
  // Locations, unit names and switch names can all change under an open dialog.
  const settingsRev = useAtomValue(settingsRevisionAtom);
  const locationsRev = useAtomValue(locationsRevisionAtom);
  const triggersRev = useAtomValue(triggersRevisionAtom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (scenario ? triggerNames(scenario) : null), [scenario, settingsRev, locationsRev, triggersRev]);
}

function NoMap({ entry, title, icon }: DialogProps & { title: string; icon: ReactNode }) {
  return (
    <DialogFrame dialogKey={entry.key} title={title} icon={icon} size="sm">
      <p className="hint">Open or create a map first.</p>
    </DialogFrame>
  );
}

/** The player groups worth listing: the common 22, plus any the list actually uses. */
function visibleGroups(list: TriggerRecord[]): number[] {
  const hidden = new Set<number>([PlayerGroup.None, PlayerGroup.Unused1, PlayerGroup.Unused2, PlayerGroup.Unused3, PlayerGroup.Unused4]);
  for (const t of list) t.players.forEach((v, i) => { if (v) hidden.delete(i); });
  return PLAYER_GROUP_CHOICES.map((c) => c.value).filter((v) => !hidden.has(v));
}

/* ── Argument widgets ───────────────────────────────────── */

interface ArgProps {
  kind: ArgKind;
  value: number;
  onChange: (v: number) => void;
  names: TriggerNames;
  scenario: Scenario;
}

/** A select whose current value is kept selectable even when the table does not list it. */
function ChoiceSelect({ value, onChange, options, width }: { value: number; onChange: (v: number) => void; options: { value: number; label: string }[]; width?: number }) {
  const opts = options.map((o) => ({ value: String(o.value), label: o.label }));
  if (!options.some((o) => o.value === value)) opts.push({ value: String(value), label: `${value} (raw)` });
  return <Select value={String(value)} onChange={(e) => onChange(Number(e.target.value))} options={opts} style={width ? { width } : undefined} />;
}

/** The player value a Deaths condition or Set Deaths action needs to reach a memory address (EUD): the address's offset into the deaths table, in dwords. */
export function epdOf(address: number): number {
  return ((address - DEATHS_TABLE_ADDRESS) / 4) >>> 0;
}

/** The address a player value reaches through the deaths table, for the tooltip. */
export function addressOfEpd(player: number): number {
  return (DEATHS_TABLE_ADDRESS + player * 4) >>> 0;
}

/**
 * The player pick, with an EUD helper: a raw value stands for a memory address in a Deaths
 * condition or Set Deaths action, and the address box turns one into the other.
 */
function PlayerArg({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const raw = !PLAYER_GROUP_CHOICES.some((c) => c.value === value);
  const parsed = (() => {
    const t = text.trim().replace(/^0x/i, "");
    return /^[0-9a-f]+$/i.test(t) ? parseInt(t, 16) : null;
  })();
  return (
    <span className="row" style={{ gap: 6 }}>
      <ChoiceSelect value={value} onChange={onChange} options={PLAYER_GROUP_CHOICES} width={200} />
      <Button size="sm" onClick={() => { setEditing(!editing); setText(raw ? addressOfEpd(value).toString(16).toUpperCase() : ""); }} title={raw ? `EUD: this player value reads memory at 0x${addressOfEpd(value).toString(16).toUpperCase()} through the deaths table` : "EUD: set the player to the value that reaches a memory address through the deaths table (Deaths and Set Deaths only)"}>EPD…</Button>
      {editing && (
        <span className="row" style={{ gap: 4 }}>
          <TextInput className="mono" style={{ width: 110 }} placeholder="58A364" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && parsed !== null) { onChange(epdOf(parsed)); setEditing(false); } }} />
          <Button size="sm" disabled={parsed === null} onClick={() => { onChange(epdOf(parsed!)); setEditing(false); }}>Set</Button>
          <span className="hint">{parsed === null ? "hex address" : `player ${epdOf(parsed)}`}</span>
        </span>
      )}
    </span>
  );
}

function ArgWidget({ kind, value, onChange, names, scenario }: ArgProps) {
  const open = useSetAtom(openDialogAtom);
  switch (kind) {
    case "cuwp": {
      // The action stores the slot 1-based; 0 is what StarEdit writes for "no slot yet".
      const options = [{ value: 0, label: "No slot" }, ...Array.from({ length: CUWP_SLOTS }, (_, i) => ({ value: i + 1, label: cuwpSlotLabel(i, scenario.cuwp?.[i], scenario.cuwpUsed?.[i]) }))];
      return (
        <span className="row" style={{ gap: 6 }}>
          <ChoiceSelect value={value} onChange={onChange} options={options} width={300} />
          <Button size="sm" onClick={() => open("cuwpEditor", { slot: value > 0 ? value : 1 })} title="Edit the slots (Triggers ▸ Unit Properties Slots…)">Edit…</Button>
        </span>
      );
    }
    case "player":
      return <PlayerArg value={value} onChange={onChange} />;
    case "unit": {
      const options = [
        ...UNIT_CLASS_CHOICES,
        ...UNIT_NAMES.map((n, id) => ({ value: id, label: unitCustomName(scenario, id) || n })),
      ];
      return <ChoiceSelect value={value} onChange={onChange} options={options} width={260} />;
    }
    case "location": {
      const options = [{ value: 0, label: "No Location" }, ...usedLocations(scenario).map((i) => ({ value: i + 1, label: names.location(i + 1) }))];
      return <ChoiceSelect value={value} onChange={onChange} options={options} width={200} />;
    }
    case "switch":
      return <ChoiceSelect value={value} onChange={onChange} options={Array.from({ length: SWITCH_COUNT }, (_, i) => ({ value: i, label: names.switch(i) }))} width={200} />;
    case "aiScript": {
      const options = AI_SCRIPT_CHOICES.map((s) => ({ value: aiScriptCode(s.id), label: s.name }));
      if (!options.some((o) => o.value === value)) options.push({ value, label: `${aiScriptId(value)} (raw)` });
      return <ChoiceSelect value={value} onChange={onChange} options={options} width={280} />;
    }
    case "text": case "wav":
      return (
        <TextInput
          style={{ width: 360 }}
          value={names.string(value) ?? ""}
          placeholder={kind === "wav" ? "sound\\file.wav" : "Text"}
          onChange={(e) => onChange(names.intern(e.target.value))}
        />
      );
    case "textFlags":
      return <Check label="Always display" checked={(value & ActionFlag.AlwaysDisplay) !== 0} onChange={(e) => onChange(e.target.checked ? ActionFlag.AlwaysDisplay : 0)} />;
    case "count":
      return (
        <span className="row" style={{ gap: 6 }}>
          <NumberInput value={value} onChange={onChange} min={0} max={255} width={90} />
          <span className="hint">{value === 0 ? "all" : ""}</span>
        </span>
      );
    case "number": case "amount": case "duration": case "percent": case "slot":
      return <NumberInput value={value} onChange={onChange} min={0} max={kind === "percent" ? 100 : 4294967295} width={120} unit={kind === "duration" ? "ms" : undefined} />;
    default: {
      const options = CHOICES[kind] ?? [];
      return <ChoiceSelect value={value} onChange={onChange} options={options} width={160} />;
    }
  }
}

/** Argument rows for one condition or action, editing the record in place through `onChange`. */
function ItemEditor<R extends ConditionRecord | ActionRecord>({ record, def, onChange, names, scenario }: {
  record: R;
  def: ConditionDef | ActionDef | undefined;
  onChange: (next: R) => void;
  names: TriggerNames;
  scenario: Scenario;
}) {
  if (!def) return <p className="hint">Unknown type {record.type}; edit it through the text editor.</p>;
  const r = record as unknown as Record<string, number>;
  const set = (arg: ArgDef<string>, v: number) => {
    const next = { ...record } as unknown as Record<string, number>;
    if (arg.kind === "textFlags") next.flags = (next.flags & ~ActionFlag.AlwaysDisplay) | v;
    else next[arg.field] = v;
    onChange(next as unknown as R);
  };
  return (
    <div className="trig-args">
      {def.args.length === 0 && <span className="hint">No arguments.</span>}
      {def.args.map((arg, i) => (
        <label key={i} className="trig-arg">
          <span className="lbl">{arg.label}</span>
          <ArgWidget kind={arg.kind} value={arg.kind === "textFlags" ? r.flags & ActionFlag.AlwaysDisplay : r[arg.field]} onChange={(v) => set(arg, v)} names={names} scenario={scenario} />
        </label>
      ))}
    </div>
  );
}

/* ── Condition / action lists ───────────────────────────── */

function ItemList<R extends ConditionRecord | ActionRecord>({ items, setItems, kind, briefing, names, scenario }: {
  items: R[];
  setItems: (next: R[]) => void;
  kind: "condition" | "action";
  briefing: boolean;
  names: TriggerNames;
  scenario: Scenario;
}) {
  const [sel, setSel] = useState<number | null>(items.length ? 0 : null);
  const defs = kind === "condition" ? CONDITION_DEFS : briefing ? BRIEFING_ACTION_DEFS : ACTION_DEFS;
  const [addType, setAddType] = useState(defs[0].type);
  const max = kind === "condition" ? MAX_CONDITIONS : MAX_ACTIONS;
  const cur = sel !== null ? items[sel] : undefined;
  const defOf = (r: R) => (kind === "condition" ? conditionDef(r.type) : actionDef(r.type, briefing));
  const line = (r: R) => (kind === "condition" ? formatCondition(r as ConditionRecord, names) : formatAction(r as ActionRecord, names, briefing));
  const disabledBit = kind === "condition" ? ConditionFlag.Disabled : ActionFlag.Disabled;

  const replace = (i: number, r: R) => setItems(items.map((x, j) => (j === i ? r : x)));
  const add = () => {
    if (items.length >= max) return;
    const r = (kind === "condition" ? newCondition(addType) : newAction(addType, briefing)) as R;
    const at = sel === null ? items.length : sel + 1;
    const next = items.slice();
    next.splice(at, 0, r);
    setItems(next);
    setSel(at);
  };
  const remove = () => {
    if (sel === null) return;
    const next = items.filter((_, i) => i !== sel);
    setItems(next);
    setSel(next.length ? Math.min(sel, next.length - 1) : null);
  };
  const move = (d: -1 | 1) => {
    if (sel === null) return;
    const to = sel + d;
    if (to < 0 || to >= items.length) return;
    const next = items.slice();
    [next[sel], next[to]] = [next[to], next[sel]];
    setItems(next);
    setSel(to);
  };

  return (
    <div className="col" style={{ height: "100%", gap: 6 }}>
      <ListBox
        className="trig-items grow"
        items={items}
        selected={sel}
        onSelect={setSel}
        empty={`No ${kind}s. ${kind === "condition" ? "A trigger with no conditions never fires." : ""}`}
        render={(r) => {
          const text = line(r);
          const m = /^;?([^(]+)\((.*)\);$/.exec(text);
          const off = (r.flags & disabledBit) !== 0;
          return (
            <div className={`trig-line ${off ? "off" : ""}`}>
              <span className="kw">{m ? m[1] : text}</span>
              {m && (m[2] ? <><span className="faint">(</span><span className="param">{m[2]}</span><span className="faint">)</span></> : <span className="faint">()</span>)}
            </div>
          );
        }}
      />
      <div className="row" style={{ gap: 4 }}>
        <Select style={{ width: 240 }} value={String(addType)} onChange={(e) => setAddType(Number(e.target.value))} options={defs.map((d) => ({ value: String(d.type), label: d.name }))} />
        <Button size="sm" onClick={add} disabled={items.length >= max} title={items.length >= max ? `At most ${max} ${kind}s` : undefined}><Plus size={11} /> Add</Button>
        <Button size="sm" onClick={remove} disabled={sel === null}><Trash2 size={11} /> Delete</Button>
        <span className="grow" />
        <span className="hint">{items.length} / {max}</span>
        <Button size="sm" icon title="Move up" onClick={() => move(-1)} disabled={sel === null || sel === 0}><ArrowUp size={11} /></Button>
        <Button size="sm" icon title="Move down" onClick={() => move(1)} disabled={sel === null || sel >= items.length - 1}><ArrowDown size={11} /></Button>
      </div>
      {cur && sel !== null && (
        <div className="trig-item-editor">
          <div className="row between">
            <Select
              style={{ width: 240 }}
              value={String(cur.type)}
              onChange={(e) => replace(sel, (kind === "condition" ? newCondition(Number(e.target.value)) : newAction(Number(e.target.value), briefing)) as R)}
              options={[...defs.map((d) => ({ value: String(d.type), label: d.name })), ...(defOf(cur) ? [] : [{ value: String(cur.type), label: `${cur.type} (raw)` }])]}
            />
            <Check label="Disabled" checked={(cur.flags & disabledBit) !== 0} onChange={(e) => replace(sel, { ...cur, flags: e.target.checked ? cur.flags | disabledBit : cur.flags & ~disabledBit })} />
          </div>
          <ItemEditor record={cur} def={defOf(cur)} onChange={(r) => replace(sel, r)} names={names} scenario={scenario} />
        </div>
      )}
    </div>
  );
}

/* ── Trigger list editor ────────────────────────────────── */

function TriggerListEditor({ list, setList, briefing, names, scenario, claims, initial }: {
  list: TriggerRecord[];
  setList: (next: TriggerRecord[]) => void;
  briefing: boolean;
  names: TriggerNames;
  scenario: Scenario;
  /** Runs of triggers plugins generate (`api.triggers.claim`): shown locked, found by content so they follow local edits. */
  claims?: readonly PluginTriggerClaim[];
  /** The row to open on — Check Map's and Find's go-to. */
  initial?: number;
}) {
  const groups = useMemo(() => visibleGroups(list), [list]);
  const ranges: ClaimedRange[] = useMemo(() => (claims?.length ? locateClaims(claims, list) : []), [list, claims]);
  const rangeAt = (i: number) => claimAt(ranges, i);
  const [filter, setFilter] = useState<Set<number> | null>(null); // null = every group
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number | null>(initial !== undefined && initial >= 0 && initial < list.length ? initial : list.length ? 0 : null);

  const shown = useMemo(() => {
    const out: number[] = [];
    const needle = q.trim().toLowerCase();
    list.forEach((t, i) => {
      if (filter && !t.players.some((v, g) => v && filter.has(g))) return;
      if (needle) {
        const s = summarizeTrigger(t, names, briefing);
        if (!`${s.players} ${s.conditions} ${s.actions} ${triggerComment(t, names) ?? ""}`.toLowerCase().includes(needle)) return;
      }
      out.push(i);
    });
    return out;
  }, [list, filter, q, names, briefing]);

  const cur = sel !== null ? list[sel] : undefined;
  const lockedRange = sel !== null ? rangeAt(sel) : null;
  const locked = lockedRange !== null;
  const replace = (t: TriggerRecord) => { if (sel !== null && !locked) setList(list.map((x, i) => (i === sel ? t : x))); };
  const create = () => {
    const t = newTrigger(briefing ? [PlayerGroup.Player1] : undefined);
    if (briefing) t.conditions.push(newCondition(ConditionType.Briefing));
    // Never inside a generated run: a new trigger after a generated one goes after the run.
    const at = sel === null ? list.length : lockedRange ? lockedRange.start + lockedRange.count : sel + 1;
    setList(insertTrigger(list, at, t));
    setSel(at);
  };
  const duplicate = () => {
    if (!cur || sel === null || locked) return;
    setList(insertTrigger(list, sel + 1, cloneTrigger(cur)));
    setSel(sel + 1);
  };
  const remove = () => {
    if (sel === null || locked) return;
    const next = removeTriggers(list, [sel]);
    setList(next);
    setSel(next.length ? Math.min(sel, next.length - 1) : null);
  };
  const move = (d: -1 | 1) => {
    if (sel === null || locked) return;
    const to = sel + d;
    if (to < 0 || to >= list.length) return;
    setList(moveTrigger(list, sel, to));
    setSel(to);
  };

  const label = briefing ? "briefing" : "trigger";

  return (
    <div className="split" style={{ ["--split" as string]: "180px", flex: 1, minHeight: 0 }}>
      <div className="col" style={{ gap: 6, minHeight: 0 }}>
        <div className="panel-head" style={{ borderRadius: 3 }}>Players</div>
        <div className="listbox" style={{ flex: 1, padding: 4, overflow: "auto" }}>
          <div className="col" style={{ gap: 0 }}>
            {groups.map((g) => (
              <Check
                key={g}
                label={PLAYER_GROUP_CHOICES[g].label}
                checked={filter === null || filter.has(g)}
                onChange={(e) => {
                  const next = new Set(filter ?? groups);
                  if (e.target.checked) next.add(g); else next.delete(g);
                  setFilter(next.size === groups.length ? null : next);
                }}
              />
            ))}
          </div>
        </div>
        <div className="row" style={{ gap: 4 }}>
          <Button size="sm" className="grow" onClick={() => setFilter(null)}>All</Button>
          <Button size="sm" className="grow" onClick={() => setFilter(new Set())}>None</Button>
        </div>
      </div>

      <div className="split" style={{ ["--split" as string]: "minmax(280px, 34%)", minHeight: 0 }}>
        <div className="col" style={{ gap: 6, minHeight: 0 }}>
          <TextInput placeholder={`Filter ${label}s…`} value={q} onChange={(e) => setQ(e.target.value)} />
          <ListBox
            className="trig-list"
            style={{ flex: 1 }}
            items={shown}
            selected={sel !== null ? shown.indexOf(sel) : null}
            onSelect={(_, i) => setSel(i)}
            empty={list.length ? `No ${label}s match the current filter.` : `No ${label}s yet.`}
            render={(i) => {
              const t = list[i];
              const s = summarizeTrigger(t, names, briefing);
              const comment = triggerComment(t, names);
              return (
                <div className="body">
                  <span className="who">{i + 1}. {s.players || <span className="faint">no players</span>}{comment ? <span className="faint"> — {comment}</span> : null}{(() => { const r = rangeAt(i); return r ? <span className="badge teal" title={`Generated by ${r.claim.spec.label}`}>{claimBadge(r)}</span> : null; })()}</span>
                  {!briefing && <span className="summary">if {s.conditions || "—"}</span>}
                  <span className="summary">{briefing ? "" : "then "}{s.actions || "—"}</span>
                </div>
              );
            }}
          />
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" onClick={create}><Plus size={11} /> New</Button>
            <Button size="sm" onClick={duplicate} disabled={!cur || locked}><Copy size={11} /> Duplicate</Button>
            <Button size="sm" onClick={remove} disabled={!cur || locked}><Trash2 size={11} /> Delete</Button>
            <span className="grow" />
            <Button size="sm" icon title="Move up" onClick={() => move(-1)} disabled={sel === null || sel === 0 || locked}><ArrowUp size={11} /></Button>
            <Button size="sm" icon title="Move down" onClick={() => move(1)} disabled={sel === null || sel >= list.length - 1 || locked}><ArrowDown size={11} /></Button>
          </div>
        </div>

        <div className="col" style={{ gap: 8, minHeight: 0 }}>
          {cur && sel !== null && lockedRange ? (
            <div className="trig-generated">
              <div className="row"><span className="badge gold">Trigger {sel + 1}</span><span className="badge teal">{claimBadge(lockedRange)}</span></div>
              <span>{claimDescription(lockedRange, sel, list)}</span>
              {lockedRange.claim.spec.open && (
                <Button size="sm" onClick={() => { try { lockedRange.claim.spec.open!(sel, list); } catch (err) { console.error(`[${lockedRange.claim.pluginName}] trigger claim open failed`, err); } }}>
                  <Code2 size={11} /> {lockedRange.claim.spec.openLabel ?? `Open ${lockedRange.claim.pluginName}`}
                </Button>
              )}
            </div>
          ) : cur && sel !== null ? (
            <>
              <div className="row between">
                <div className="row">
                  <span className="badge gold">{briefing ? "Briefing" : "Trigger"} {sel + 1}</span>
                  {!briefing && (
                    <TextInput
                      placeholder="Comment"
                      value={triggerComment(cur, names) ?? ""}
                      onChange={(e) => replace(withComment(cur, e.target.value, names))}
                      style={{ width: 260 }}
                    />
                  )}
                </div>
                {!briefing && <Check label="Preserve trigger" checked={isPreserved(cur)} onChange={(e) => replace(setPreserved(cur, e.target.checked))} />}
              </div>
              <Tabs
                key={sel}
                className="grow"
                defaultValue={briefing ? "actions" : "conditions"}
                tabs={[
                  {
                    value: "players",
                    label: "Players",
                    content: (
                      <div className="listbox" style={{ padding: 8, overflow: "auto" }}>
                        <div className="player-check-grid">
                          {PLAYER_GROUP_CHOICES.map((p) => (
                            <Check
                              key={p.value}
                              label={p.label}
                              checked={!!cur.players[p.value]}
                              onChange={(e) => replace({ ...cur, players: cur.players.map((v, i) => (i === p.value ? (e.target.checked ? 1 : 0) : v)) })}
                            />
                          ))}
                        </div>
                      </div>
                    ),
                  },
                  ...(briefing ? [] : [{
                    value: "conditions",
                    label: `Conditions (${cur.conditions.length})`,
                    content: <ItemList items={cur.conditions} setItems={(c) => replace({ ...cur, conditions: c })} kind="condition" briefing={false} names={names} scenario={scenario} />,
                  }]),
                  {
                    value: "actions",
                    label: `Actions (${cur.actions.length})`,
                    content: <ItemList items={cur.actions} setItems={(a) => replace({ ...cur, actions: a })} kind="action" briefing={briefing} names={names} scenario={scenario} />,
                  },
                ]}
              />
            </>
          ) : (
            <div className="props-empty">Select a {label}.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Classic Trigger Editor ─────────────────────────────── */

export function TriggerEditorDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(triggersRevisionAtom);
  const claims = useAtomValue(pluginTriggerClaimsAtom);
  const commit = useSetAtom(commitTriggersAtom);
  const names = useNames(scenario);
  const [local, setLocal] = useScenarioForm(scenario, readTriggers);
  if (!scenario || !local || !names) return <NoMap entry={entry} title="Trigger Editor" icon={<Zap size={14} />} />;

  const apply = () => { applyTriggers(scenario, local); commit(); };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Trigger Editor"
      icon={<Zap size={14} />}
      size="full"
      onOk={apply}
      showApply
      footerLeft={<span>{local.length} trigger{local.length === 1 ? "" : "s"}</span>}
    >
      <TriggerListEditor list={local} setList={setLocal} briefing={false} names={names} scenario={scenario} claims={claims} initial={typeof entry.payload?.index === "number" ? entry.payload.index : undefined} />
    </DialogFrame>
  );
}

/* ── Mission Briefing ───────────────────────────────────── */

export function MissionBriefingDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(triggersRevisionAtom);
  const commit = useSetAtom(commitTriggersAtom);
  const names = useNames(scenario);
  const [local, setLocal] = useScenarioForm(scenario, readBriefing);
  if (!scenario || !local || !names) return <NoMap entry={entry} title="Mission Briefing" icon={<MessageSquare size={14} />} />;

  const apply = () => { applyBriefing(scenario, local); commit(); };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Mission Briefing"
      icon={<MessageSquare size={14} />}
      size="full"
      onOk={apply}
      showApply
      footerLeft={<span>{local.length} briefing{local.length === 1 ? "" : "s"} · one per player, played before the map starts</span>}
    >
      <TriggerListEditor list={local} setList={setLocal} briefing names={names} scenario={scenario} initial={typeof entry.payload?.index === "number" ? entry.payload.index : undefined} />
    </DialogFrame>
  );
}

/* ── Text Trigger Editor (TrigEdit) ─────────────────────── */

/** The map's triggers as text, with every plugin-generated run fenced in comments (parsed back as plain triggers). */
function textOf(scn: Scenario, ranges: ClaimedRange[]): string {
  const names = triggerNames(scn);
  const runs = ranges.filter((r) => r.count > 0);
  if (runs.length === 0) return formatTriggers(scn.triggers, names);
  const parts: string[] = [];
  let at = 0;
  for (const { claim, start, count } of runs) {
    if (start < at) continue; // overlapping claims: the first wins
    parts.push(formatTriggers(scn.triggers.slice(at, start), names));
    parts.push(`//== Generated by ${claim.spec.label}: ${count} trigger${count === 1 ? "" : "s"}. Edit them there instead — changes here take them out of its hands. ==//\n\n`);
    parts.push(formatTriggers(scn.triggers.slice(start, start + count), names));
    parts.push("//== End of the generated run ==//\n");
    at = start + count;
  }
  parts.push(formatTriggers(scn.triggers.slice(at), names));
  return parts.filter((p) => p !== "").join("\n");
}

/**
 * The Text Trigger Editor edits either list: TRIG, or — with `payload.briefing` or the
 * Briefing tab — MBRF in the same syntax with the briefing action set. Switching tabs
 * re-reads the map, so compile (Apply) first.
 */
export function TextTriggerEditorDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(triggersRevisionAtom);
  const claims = useAtomValue(pluginTriggerClaimsAtom);
  const commit = useSetAtom(commitTriggersAtom);
  const close = useSetAtom(closeDialogAtom);
  const names = useNames(scenario);
  const [briefing, setBriefing] = useState(entry.payload?.briefing === true);
  const sourceOf = (scn: Scenario, brief: boolean) => (brief ? formatTriggers(scn.briefing, triggerNames(scn), true) : textOf(scn, locateClaims(claims, scn.triggers)));
  const [form, setForm] = useScenarioForm(scenario, (scn) => ({ text: sourceOf(scn, briefing), error: null as TriggerTextError | null, status: "" }));
  const [wrap, setWrap] = useState(false);
  if (!scenario || !form || !names) return <NoMap entry={entry} title="Text Trigger Editor" icon={<Braces size={14} />} />;

  const lines = form.text.split("\n").length;
  const what = briefing ? "briefing" : "trigger";

  /** Parse the text; on success replace the scenario's list. Returns whether it compiled. */
  const compile = (): boolean => {
    try {
      const parsed = parseTriggers(form.text, names, briefing).map((t) => t.trigger);
      if (briefing) applyBriefing(scenario, parsed); else applyTriggers(scenario, parsed);
      commit();
      setForm({ ...form, error: null, status: `Compiled ${parsed.length} ${what}${parsed.length === 1 ? "" : "s"}.` });
      return true;
    } catch (e) {
      if (e instanceof TriggerTextError) setForm({ ...form, error: e, status: "" });
      else setForm({ ...form, error: null, status: `Error: ${(e as Error).message}` });
      return false;
    }
  };
  const format = () => {
    try {
      const parsed = parseTriggers(form.text, names, briefing).map((t) => t.trigger);
      setForm({ ...form, text: formatTriggers(parsed, names, briefing), error: null, status: "Formatted." });
    } catch (e) {
      if (e instanceof TriggerTextError) setForm({ ...form, error: e, status: "" });
    }
  };
  const switchTo = (brief: boolean) => {
    setBriefing(brief);
    setForm({ text: sourceOf(scenario, brief), error: null, status: "" });
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Text Trigger Editor"
      icon={<Braces size={14} />}
      size="full"
      footerLeft={
        form.error
          ? <span className="trig-error">{form.error.message}</span>
          : <span>{lines} lines · TrigEdit syntax · {briefing ? "mission briefing (MBRF)" : "triggers (TRIG)"}{form.status ? ` · ${form.status}` : ""}</span>
      }
      footer={
        <>
          <Button variant="primary" onClick={() => { if (compile()) close(entry.key); }}>Compile &amp; Close</Button>
          <Button onClick={() => close(entry.key)}>Cancel</Button>
          <Button onClick={compile}>Apply</Button>
        </>
      }
    >
      <div className="row">
        <Check radio label="Triggers" checked={!briefing} onChange={() => switchTo(false)} title="TRIG — the map's triggers" />
        <Check radio label="Briefing" checked={briefing} onChange={() => switchTo(true)} title="MBRF — the mission briefing, in the same syntax with the briefing actions" />
        <Button size="sm" onClick={compile}>Compile</Button>
        <Button size="sm" onClick={format}>Format</Button>
        <Button size="sm" onClick={() => setForm({ ...form, text: sourceOf(scenario, briefing), error: null, status: "Reloaded from the map." })}>Reload</Button>
        <span className="grow" />
        <Check label="Word wrap" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
      </div>
      <div className={`code-editor ${wrap ? "wrap" : ""}`}>
        <div className="gutter">{Array.from({ length: lines }, (_, i) => (form.error && form.error.line === i + 1 ? `▶${i + 1}` : String(i + 1))).join("\n")}</div>
        <textarea spellCheck={false} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value, status: "" })} />
      </div>
    </DialogFrame>
  );
}
