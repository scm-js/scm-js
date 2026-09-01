import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Braces, Copy, MessageSquare, Pencil, Plus, Trash2, Zap } from "lucide-react";
import { TRIGGER_PLAYER_GROUPS } from "../../data/players";
import { ACTIONS, BRIEFING_ACTIONS, CONDITIONS, SAMPLE_TRIGGERS, SAMPLE_TRIGGER_TEXT } from "../../data/triggers";
import { Button, Check, ListBox, Select, Tabs, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── Classic Trigger Editor ─────────────────────────────── */

function TrigLine({ text }: { text: string }) {
  const m = /^([^(]+)\((.*)\)$/.exec(text);
  if (!m) return <div className="trig-line">{text}</div>;
  return (
    <div className="trig-line">
      <span className="kw">{m[1]}</span>
      <span className="faint">(</span>
      <span className="param">{m[2]}</span>
      <span className="faint">)</span>
    </div>
  );
}

function ListActions() {
  return (
    <div className="row" style={{ gap: 4 }}>
      <Button size="sm"><Plus size={11} /> New</Button>
      <Button size="sm"><Pencil size={11} /> Edit</Button>
      <Button size="sm"><Trash2 size={11} /> Delete</Button>
      <span className="grow" />
      <Button size="sm" icon title="Move up"><ArrowUp size={11} /></Button>
      <Button size="sm" icon title="Move down"><ArrowDown size={11} /></Button>
    </div>
  );
}

export function TriggerEditorDialog({ entry }: DialogProps) {
  const [filter, setFilter] = useState<Record<string, boolean>>({ "All Players": true, "Player 1": true, "Player 2": true, "Force 1": true, "Force 2": true, "Player 8": true });
  const [sel, setSel] = useState(0);
  const [q, setQ] = useState("");
  const list = useMemo(() => SAMPLE_TRIGGERS.filter((t) => t.players.some((p) => filter[p]) && (q ? JSON.stringify(t).toLowerCase().includes(q.toLowerCase()) : true)), [filter, q]);
  const cur = list[sel] ?? list[0];

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Trigger Editor"
      icon={<Zap size={14} />}
      size="full"
      footerLeft={<span>{SAMPLE_TRIGGERS.length} triggers · showing {list.length}</span>}
      showApply
    >
      <div className="split" style={{ ["--split" as string]: "180px", flex: 1 }}>
        {/* player filter */}
        <div className="col" style={{ gap: 6 }}>
          <div className="panel-head" style={{ borderRadius: 3 }}>Players</div>
          <div className="listbox" style={{ flex: 1, padding: 4 }}>
            <div className="col" style={{ gap: 0 }}>
              {TRIGGER_PLAYER_GROUPS.map((p) => (
                <Check key={p} label={p} checked={!!filter[p]} onChange={(e) => setFilter({ ...filter, [p]: e.target.checked })} />
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 4 }}>
            <Button size="sm" className="grow" onClick={() => setFilter(Object.fromEntries(TRIGGER_PLAYER_GROUPS.map((p) => [p, true])))}>All</Button>
            <Button size="sm" className="grow" onClick={() => setFilter({})}>None</Button>
          </div>
        </div>

        <div className="split" style={{ ["--split" as string]: "minmax(280px, 34%)" }}>
          {/* trigger list */}
          <div className="col" style={{ gap: 6 }}>
            <div className="row">
              <TextInput placeholder="Filter triggers…" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} />
            </div>
            <ListBox
              className="trig-list"
              style={{ flex: 1 }}
              items={list}
              selected={list.indexOf(cur)}
              onSelect={setSel}
              empty="No triggers match the current player filter."
              render={(t) => (
                <div className="body">
                  <span className="who">{t.players.join(", ")}{t.comment ? <span className="faint"> — {t.comment}</span> : null}</span>
                  <span className="summary">if {t.conditions.join(" && ")}</span>
                  <span className="summary">then {t.actions.join("; ")}</span>
                </div>
              )}
            />
            <div className="row" style={{ gap: 4 }}>
              <Button size="sm"><Plus size={11} /> New Trigger</Button>
              <Button size="sm"><Copy size={11} /> Duplicate</Button>
              <Button size="sm"><Trash2 size={11} /> Delete</Button>
              <span className="grow" />
              <Button size="sm" icon title="Move up"><ArrowUp size={11} /></Button>
              <Button size="sm" icon title="Move down"><ArrowDown size={11} /></Button>
            </div>
          </div>

          {/* trigger detail */}
          <div className="col" style={{ gap: 8, minHeight: 0 }}>
            {cur ? (
              <>
                <div className="row between">
                  <div className="row">
                    <span className="badge gold">Trigger {cur.id}</span>
                    <TextInput placeholder="Comment" defaultValue={cur.comment} key={cur.id} style={{ width: 260 }} />
                  </div>
                  <Check label="Preserve trigger" defaultChecked={cur.preserve} key={`p${cur.id}`} />
                </div>
                <Tabs
                  className="grow"
                  tabs={[
                    {
                      value: "players",
                      label: "Players",
                      content: (
                        <div className="listbox" style={{ padding: 8 }}>
                          <div className="player-check-grid">
                            {TRIGGER_PLAYER_GROUPS.map((p) => <Check key={p} label={p} defaultChecked={cur.players.includes(p)} />)}
                          </div>
                        </div>
                      ),
                    },
                    {
                      value: "conditions",
                      label: `Conditions (${cur.conditions.length})`,
                      content: (
                        <div className="col" style={{ height: "100%" }}>
                          <div className="listbox grow">
                            {cur.conditions.map((c, i) => <TrigLine key={i} text={c} />)}
                            <div className="trig-line faint">+ add condition…</div>
                          </div>
                          <div className="row">
                            <Select style={{ width: 240 }} options={CONDITIONS} />
                            <ListActions />
                          </div>
                        </div>
                      ),
                    },
                    {
                      value: "actions",
                      label: `Actions (${cur.actions.length})`,
                      content: (
                        <div className="col" style={{ height: "100%" }}>
                          <div className="listbox grow">
                            {cur.actions.map((a, i) => <TrigLine key={i} text={a} />)}
                            <div className="trig-line faint">+ add action…</div>
                          </div>
                          <div className="row">
                            <Select style={{ width: 240 }} options={ACTIONS} />
                            <ListActions />
                          </div>
                        </div>
                      ),
                    },
                  ]}
                  defaultValue="conditions"
                />
              </>
            ) : (
              <div className="props-empty">Select a trigger.</div>
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Text Trigger Editor (TrigEdit) ─────────────────────── */

export function TextTriggerEditorDialog({ entry }: DialogProps) {
  const [text, setText] = useState(SAMPLE_TRIGGER_TEXT);
  const lines = text.split("\n").length;
  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Text Trigger Editor"
      icon={<Braces size={14} />}
      size="full"
      okLabel="Compile & Close"
      footerLeft={<span>{lines} lines · TrigEdit syntax · errors will be listed here on compile</span>}
      showApply
    >
      <div className="row">
        <Button size="sm">Compile</Button>
        <Button size="sm">Insert Condition ▾</Button>
        <Button size="sm">Insert Action ▾</Button>
        <Button size="sm">Format</Button>
        <span className="grow" />
        <Check label="Word wrap" />
        <Check label="Line numbers" defaultChecked />
      </div>
      <div className="code-editor">
        <div className="gutter">{Array.from({ length: lines }, (_, i) => i + 1).join("\n")}</div>
        <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
    </DialogFrame>
  );
}

/* ── Mission Briefing ───────────────────────────────────── */

export function MissionBriefingDialog({ entry }: DialogProps) {
  const [player, setPlayer] = useState("Player 1");
  const sample = ["Wait(2000)", "Show Portrait(Jim Raynor (Marine), Slot 1)", "Transmission(Slot 1, \"Commander, we've located the beacon.\", 4000)", "Mission Objectives(\"• Bring a unit to Beacon Alpha\\n• Destroy all enemy structures\")", "Hide Portrait(Slot 1)"];
  return (
    <DialogFrame dialogKey={entry.key} title="Mission Briefing" icon={<MessageSquare size={14} />} size="lg" tall showApply footerLeft={<span>Briefing for {player} · {sample.length} actions</span>}>
      <div className="row">
        <span className="dim" style={{ fontSize: 11 }}>Player</span>
        <Select style={{ width: 160 }} value={player} onChange={(e) => setPlayer(e.target.value)} options={TRIGGER_PLAYER_GROUPS.slice(0, 8).concat("All Players")} />
        <span className="grow" />
        <Button size="sm">Preview Briefing</Button>
      </div>
      <div className="split" style={{ gridTemplateColumns: "1fr 220px", flex: 1 }}>
        <div className="col" style={{ height: "100%" }}>
          <div className="listbox grow">
            {sample.map((a, i) => <TrigLine key={i} text={a} />)}
          </div>
          <div className="row">
            <Select style={{ width: 220 }} options={BRIEFING_ACTIONS} />
            <ListActions />
          </div>
        </div>
        <div className="col">
          <div className="panel-head" style={{ borderRadius: 3 }}>Portrait slots</div>
          <div className="listbox" style={{ padding: 8, flex: 1 }}>
            {[1, 2, 3, 4].map((s) => (
              <div key={s} className="row" style={{ marginBottom: 6 }}>
                <span className="badge">Slot {s}</span>
                <span className="dim" style={{ fontSize: 11 }}>{s === 1 ? "Jim Raynor (Marine)" : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
