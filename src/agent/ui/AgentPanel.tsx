/**
 * The Claude panel in the editor's right dock: the conversation about the map in front,
 * the composer, the model and effort pickers, settings, and what the chat has cost.
 */
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { AlertTriangle, Ban, Check, ChevronDown, ChevronRight, Eye, Pencil, RotateCcw, Send, Settings, Square, Undo2, X } from "lucide-react";
import type { AgentController } from "../controller";
import type { AgentSession, TranscriptItem } from "../session";
import { EFFORTS, MODELS, type AgentSettings, type ApprovalMode, type Effort, type Placement } from "../settings";
import { Markdown } from "./Markdown";

const SUGGESTIONS = [
  "Describe this map: players, layout, and what its triggers do.",
  "Check the map for problems and fix the ones you safely can.",
  "Give every start location a standard mineral line and a geyser.",
  "Add a victory trigger for each player when all their enemies' buildings are destroyed.",
  "Make Player 2 a Zerg computer that runs a default AI script.",
];

/** Re-render whenever a source with a `subscribe` says it changed. */
function useRerender(source: { subscribe(fn: () => void): () => void }): void {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => source.subscribe(bump), [source]);
}

export function AgentPanel({ controller }: { controller: AgentController }) {
  const [session, setSession] = useState<AgentSession>(() => controller.current());
  useEffect(() => controller.subscribe(() => setSession(controller.current())), [controller]);
  useRerender(session);
  useRerender(controller.settings);
  const settings = controller.settings.get();
  const ready = controller.settings.ready();
  const [showSettings, setShowSettings] = useState(!ready);

  return (
    <div className="cla-root">
      <div className="cla-bar">
        <select className="select cla-model" value={settings.model} title="Model" onChange={(e) => controller.settings.set({ model: e.target.value })}>
          {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        <select className="select cla-effort" value={settings.effort} title="How hard Claude thinks: more is slower and costs more" onChange={(e) => controller.settings.set({ effort: e.target.value as Effort })}>
          {EFFORTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
        </select>
        <button type="button" className="btn icon sm ghost" title="New conversation" disabled={session.busy || session.items.length === 0} onClick={() => session.reset()}><RotateCcw size={14} /></button>
        <button type="button" className={`btn icon sm ghost${showSettings ? " is-active" : ""}`} title="Settings" onClick={() => setShowSettings(!showSettings)}><Settings size={14} /></button>
      </div>
      {showSettings && (
        <SettingsForm
          settings={settings}
          onChange={(p) => {
            controller.settings.set(p);
            if (p.placement !== undefined) controller.reopen();
          }}
          onClose={() => setShowSettings(false)}
          canClose={ready}
        />
      )}
      <Transcript session={session} onSuggestion={(s) => void session.send(s)} ready={ready} onSettings={() => setShowSettings(true)} />
      <Composer session={session} ready={ready} />
      <Footer session={session} />
    </div>
  );
}

/* ── Settings ───────────────────────────────────────────── */

function SettingsForm({ settings, onChange, onClose, canClose }: { settings: AgentSettings; onChange: (p: Partial<AgentSettings>) => void; onClose: () => void; canClose: boolean }) {
  const [key, setKey] = useState(settings.apiKey);
  const [baseURL, setBaseURL] = useState(settings.baseURL);
  const save = () => { onChange({ apiKey: key.trim(), baseURL: baseURL.trim().replace(/\/+$/, "") }); if (key.trim() || baseURL.trim()) onClose(); };
  return (
    <div className="cla-settings">
      <label className="cla-field">
        <span>Anthropic API key</span>
        <input className="input mono" type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
      </label>
      <label className="check">
        <input type="checkbox" checked={settings.rememberKey} onChange={(e) => onChange({ rememberKey: e.target.checked })} />
        <span>Remember the key on this device</span>
      </label>
      <p className="hint">The key goes from this browser straight to the API address below and nowhere else. Unticked, it is forgotten when the page closes. Ticked, it is kept in this browser's local storage, readable by anything that runs on this page (plugins included).</p>
      <label className="cla-field">
        <span>API address</span>
        <input className="input mono" placeholder="https://api.anthropic.com (default)" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
      </label>
      <p className="hint">Leave blank for Anthropic's API. A proxy on your own network that adds the key itself can go here instead, and then the key can stay empty.</p>
      <label className="cla-field">
        <span>Ask before a change</span>
        <select className="select" value={settings.approval} onChange={(e) => onChange({ approval: e.target.value as ApprovalMode })}>
          <option value="destructive">Only when it deletes or replaces work</option>
          <option value="all">Before every change</option>
          <option value="never">Never</option>
        </select>
      </label>
      <label className="cla-field">
        <span>Where the panel sits</span>
        <select className="select" value={settings.placement} onChange={(e) => onChange({ placement: e.target.value as Placement })}>
          <option value="float">A window over the map (drag, resize, maximize)</option>
          <option value="right">The right dock, under the built-in panels</option>
          <option value="bottom">A strip under the map</option>
        </select>
      </label>
      <label className="check"><input type="checkbox" checked={settings.followEdits} onChange={(e) => onChange({ followEdits: e.target.checked })} /><span>Bring each change on screen</span></label>
      <label className="check"><input type="checkbox" checked={settings.showThinking} onChange={(e) => onChange({ showThinking: e.target.checked })} /><span>Show Claude's reasoning</span></label>
      <div className="row end">
        {canClose && <button type="button" className="btn sm ghost" onClick={onClose}>Close</button>}
        <button type="button" className="btn sm primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

/* ── Transcript ─────────────────────────────────────────── */

function Transcript({ session, onSuggestion, ready, onSettings }: { session: AgentSession; onSuggestion: (s: string) => void; ready: boolean; onSettings: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  const onScroll = () => {
    const el = box.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };
  return (
    <div className="cla-transcript" ref={box} onScroll={onScroll}>
      {session.items.length === 0 && (
        <div className="cla-empty">
          <p>Ask Claude to read or change this map: terrain, units, locations, triggers, the briefing, players and forces, unit settings, strings. Every change is one undo step (Ctrl+Z).</p>
          {ready ? SUGGESTIONS.map((s) => <button key={s} type="button" className="cla-suggestion" onClick={() => onSuggestion(s)}>{s}</button>)
            : <button type="button" className="btn sm primary" onClick={onSettings}>Add your API key</button>}
        </div>
      )}
      {session.items.map((item) => <Item key={item.id} item={item} session={session} onSettings={onSettings} />)}
      {session.busy && !session.items.some((i) => (i.kind === "text" || i.kind === "thinking") && !i.done) && !session.items.some((i) => i.kind === "tool" && (i.status === "running" || i.status === "streaming" || i.status === "approval")) && (
        <div className="cla-working"><span className="spinner sm" /> Thinking…</div>
      )}
    </div>
  );
}

function Item({ item, session, onSettings }: { item: TranscriptItem; session: AgentSession; onSettings: () => void }) {
  switch (item.kind) {
    case "user": return <div className="cla-user">{item.text}</div>;
    case "text": return item.text.trim() ? <div className="cla-text"><Markdown text={item.text} /></div> : null;
    case "thinking": return <Thinking text={item.text} done={item.done} />;
    case "tool": return <ToolRow item={item} session={session} />;
    case "notice": return (
      <div className={`cla-notice ${item.level}`}>
        {item.level !== "info" && <AlertTriangle size={13} />}
        <span>{item.text}</span>
        {item.action === "settings" && <button type="button" className="btn sm ghost" onClick={onSettings}>Settings</button>}
      </div>
    );
    case "turn": return (
      <div className="cla-turn">
        <span>{item.edits ? `${item.edits} change${item.edits === 1 ? "" : "s"} · ` : ""}{item.seconds} s</span>
        {item.edits > 0 && !item.undone && !session.busy && (
          <button type="button" className="btn sm ghost" title="Undo the changes this reply made" onClick={() => session.undoTurn(item.id)}><Undo2 size={12} /> Undo these changes</button>
        )}
        {item.undone && <span className="cla-dim">undone</span>}
      </div>
    );
  }
}

function Thinking({ text, done }: { text: string; done: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="cla-thinking">
      <button type="button" className="cla-thinking-head" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {done ? "Reasoning" : "Reasoning…"}
      </button>
      {open && <div className="cla-thinking-body">{text}</div>}
    </div>
  );
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

function ToolRow({ item, session }: { item: Extract<TranscriptItem, { kind: "tool" }>; session: AgentSession }) {
  const [open, setOpen] = useState(false);
  const [big, setBig] = useState<string | null>(null);
  const icon = item.status === "streaming" || item.status === "running" ? <span className="spinner sm" />
    : item.status === "error" ? <X size={13} className="cla-bad" />
      : item.status === "denied" ? <Ban size={13} className="cla-bad" />
        : item.status === "stopped" ? <Square size={11} className="cla-dim" />
          : item.status === "approval" ? <AlertTriangle size={13} className="cla-warn" />
            : item.effect === "read" ? <Eye size={13} className="cla-dim" /> : item.effect === "destructive" ? <Check size={13} className="cla-warn" /> : <Pencil size={13} className="cla-ok" />;
  const hasDetail = item.input !== undefined || item.result;
  return (
    <div className={`cla-tool ${item.status} ${item.effect}`}>
      <button type="button" className="cla-tool-head" onClick={() => hasDetail && setOpen(!open)} title={item.name}>
        {icon}
        <span className="cla-tool-title">{item.title}</span>
        {hasDetail && (open ? <ChevronDown size={12} /> : <ChevronRight size={12} />)}
      </button>
      {item.status === "approval" && (
        <div className="cla-approve">
          <span>{item.effect === "destructive" ? "This removes or replaces existing work (it can be undone)." : "Allow this change?"}</span>
          <div className="row">
            <button type="button" className="btn sm primary" onClick={() => session.answer(item.id, true)}>Allow</button>
            <button type="button" className="btn sm" onClick={() => session.answer(item.id, true, true)}>Allow all this reply</button>
            <button type="button" className="btn sm ghost" onClick={() => session.answer(item.id, false)}>Deny</button>
          </div>
        </div>
      )}
      {item.images?.length ? (
        <div className="cla-images">
          {item.images.map((src, n) => <img key={n} src={src} alt="The map as Claude saw it" className={big === src ? "big" : ""} onClick={() => setBig(big === src ? null : src)} />)}
        </div>
      ) : null}
      {open && (
        <div className="cla-tool-detail">
          {item.input !== undefined && <pre>{clip(JSON.stringify(item.input, null, 1), 6000)}</pre>}
          {item.result && <pre className={item.status === "error" || item.status === "denied" ? "cla-bad" : ""}>{clip(item.result, 8000)}</pre>}
        </div>
      )}
    </div>
  );
}

/* ── Composer and footer ────────────────────────────────── */

function Composer({ session, ready }: { session: AgentSession; ready: boolean }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const t = text.trim();
    if (!t || session.busy || !ready) return;
    setText("");
    void session.send(t);
  };
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(180, Math.max(54, el.scrollHeight + 2))}px`;
  }, [text]);
  return (
    <div className="cla-composer">
      <textarea
        ref={area}
        className="textarea"
        placeholder={ready ? "Ask Claude to change the map…" : "Add your API key in settings first"}
        disabled={!ready}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
        }}
      />
      {session.busy
        ? <button type="button" className="btn sm danger" title="Stop" onClick={() => session.stop()}><Square size={12} /> Stop</button>
        : <button type="button" className="btn sm primary" title="Send (Enter)" disabled={!ready || !text.trim()} onClick={send}><Send size={12} /> Send</button>}
    </div>
  );
}

function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function Footer({ session }: { session: AgentSession }) {
  const u = session.usage;
  if (!u.input && !u.output && !u.cacheRead) return null;
  const detail = `Input ${tokens(u.input)}, cache read ${tokens(u.cacheRead)}, cache write ${tokens(u.cacheWrite)}, output ${tokens(u.output)}. The cost is an estimate at list prices.`;
  return (
    <div className="cla-footer" title={detail}>
      <span>{tokens(u.context)} tokens in context{u.context > 400_000 ? " — consider a new conversation" : ""}</span>
      <span>≈ ${u.cost < 0.01 ? u.cost.toFixed(3) : u.cost.toFixed(2)}</span>
    </div>
  );
}
