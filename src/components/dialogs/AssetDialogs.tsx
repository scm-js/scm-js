import { useMemo, useState } from "react";
import { useSetAtom } from "jotai";
import { Music, Pencil, Play, Plus, Replace, Search, SquareDashed, ToggleLeft, Trash2, Type, Upload } from "lucide-react";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { SAMPLE_LOCATIONS, SAMPLE_SOUNDS, SAMPLE_STRINGS } from "../../data/samples";
import { Button, Check, ListBox, Select, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/* ── String Editor ──────────────────────────────────────── */

export function StringEditorDialog({ entry }: DialogProps) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const rows = useMemo(() => SAMPLE_STRINGS.filter((s) => s.text.toLowerCase().includes(q.toLowerCase()) || s.usage.toLowerCase().includes(q.toLowerCase())), [q]);
  const cur = rows[sel];
  return (
    <DialogFrame dialogKey={entry.key} title="String Editor" icon={<Type size={14} />} size="lg" tall showApply footerLeft={<span>{SAMPLE_STRINGS.length} strings · 0 unused · 65,535 max (STRx)</span>}>
      <div className="row">
        <Search size={12} className="faint" />
        <TextInput placeholder="Search strings and usages…" value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} />
        <Button size="sm"><Replace size={12} /> Replace…</Button>
        <Button size="sm"><Trash2 size={12} /> Delete Unused</Button>
      </div>
      <div className="split rows" style={{ ["--split" as string]: "1fr" }}>
        <div className="listbox">
          <table className="table">
            <thead><tr><th style={{ width: 50 }}>#</th><th>Text</th><th style={{ width: 200 }}>Used by</th></tr></thead>
            <tbody>
              {rows.map((s, i) => (
                <tr key={s.id} className={sel === i ? "selected" : ""} onClick={() => setSel(i)}>
                  <td className="num">{s.id}</td>
                  <td>{s.text}</td>
                  <td className="dim">{s.usage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="col">
          <div className="row between">
            <span className="dim" style={{ fontSize: 11 }}>String #{cur?.id ?? "—"} · {cur?.usage ?? ""}</span>
            <span className="row" style={{ gap: 4 }}>
              {["<01>", "<02>", "<03>", "<04>", "<07>", "<08>", "<0B>", "<1C>"].map((c) => <button key={c} className="kbd" title={`Insert colour code ${c}`}>{c}</button>)}
            </span>
          </div>
          <textarea className="textarea grow mono" defaultValue={cur?.text ?? ""} key={cur?.id} style={{ minHeight: 90 }} />
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Sound Editor ───────────────────────────────────────── */

export function SoundEditorDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(0);
  return (
    <DialogFrame dialogKey={entry.key} title="Sound Editor" icon={<Music size={14} />} size="lg" showApply footerLeft={<span>{SAMPLE_SOUNDS.length} / 512 sounds · 211 KB in archive</span>}>
      <div className="row">
        <Button size="sm"><Upload size={12} /> Import WAV/OGG…</Button>
        <Button size="sm" disabled={sel < 0}><Play size={12} /> Play</Button>
        <Button size="sm" disabled={sel < 0}><Trash2 size={12} /> Remove</Button>
        <span className="grow" />
        <Check label="Compress on save (ADPCM)" defaultChecked />
      </div>
      <div className="listbox" style={{ height: 240 }}>
        <table className="table">
          <thead><tr><th style={{ width: 40 }}>#</th><th>Path in archive</th><th style={{ width: 80 }}>Size</th><th style={{ width: 80 }}>Length</th><th style={{ width: 100 }}>Used by</th></tr></thead>
          <tbody>
            {SAMPLE_SOUNDS.map((s, i) => (
              <tr key={s.name} className={sel === i ? "selected" : ""} onClick={() => setSel(i)}>
                <td className="num">{i}</td>
                <td className="mono">{s.name}</td>
                <td className="num">{s.size}</td>
                <td className="num">{s.length}</td>
                <td className="dim">{i === 0 ? "Trigger 2" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="placeholder-note">Waveform preview and playback will use the Web Audio API once map I/O exists.</div>
    </DialogFrame>
  );
}

/* ── Switches ───────────────────────────────────────────── */

export function SwitchesDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(0);
  const names = useMemo(() => Array.from({ length: 256 }, (_, i) => (i === 0 ? "Round Started" : i === 1 ? "Boss Alive" : i === 2 ? "Timer Running" : "")), []);
  return (
    <DialogFrame dialogKey={entry.key} title="Switches" icon={<ToggleLeft size={14} />} size="md" tall showApply footerLeft={<span>256 switches · 3 named</span>}>
      <div className="split rows" style={{ ["--split" as string]: "1fr" }}>
        <ListBox
          items={names}
          selected={sel}
          onSelect={setSel}
          render={(n, i) => <><span className="idx">{i + 1}</span>{n ? <span>{n}</span> : <span className="faint">Switch {i + 1}</span>}{n && <span className="badge teal" style={{ marginLeft: "auto" }}>named</span>}</>}
        />
        <div className="col" style={{ gap: 8, flex: "none" }}>
          <div className="form wide">
            <label>Switch {sel + 1}</label>
            <TextInput key={sel} placeholder={`Switch ${sel + 1}`} defaultValue={names[sel]} />
            <label>Used by</label>
            <span className="dim">{sel < 3 ? `${sel + 1} trigger(s)` : "not referenced"}</span>
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Location list ──────────────────────────────────────── */

export function LocationListDialog({ entry }: DialogProps) {
  const [sel, setSel] = useState(1);
  const open = useSetAtom(openDialogAtom);
  const l = SAMPLE_LOCATIONS[sel];
  return (
    <DialogFrame dialogKey={entry.key} title="Locations" icon={<SquareDashed size={14} />} size="lg" tall footer={<Button variant="primary" onClick={undefined}>Close</Button>} footerLeft={<span>{SAMPLE_LOCATIONS.length} / 255 locations · slot 63 is "Anywhere"</span>}>
      <div className="row">
        <Button size="sm"><Plus size={12} /> New</Button>
        <Button size="sm" onClick={() => open("locationProperties", { location: l })}><Pencil size={12} /> Properties…</Button>
        <Button size="sm" disabled={l.id === 63}><Trash2 size={12} /> Delete</Button>
        <span className="grow" />
        <Select style={{ width: 160 }} options={["Sort by ID", "Sort by name", "Sort by size"]} />
      </div>
      <div className="listbox grow">
        <table className="table">
          <thead><tr><th style={{ width: 40 }}>ID</th><th>Name</th><th className="num" style={{ width: 70 }}>Left</th><th style={{ width: 70 }}>Top</th><th style={{ width: 70 }}>Right</th><th style={{ width: 70 }}>Bottom</th><th style={{ width: 90 }}>Tiles</th></tr></thead>
          <tbody>
            {SAMPLE_LOCATIONS.map((x, i) => (
              <tr key={x.id} className={sel === i ? "selected" : ""} onClick={() => setSel(i)} onDoubleClick={() => open("locationProperties", { location: x })}>
                <td className="num">{x.id}</td>
                <td>{x.name}</td>
                <td className="num">{x.x * 32}</td>
                <td className="num">{x.y * 32}</td>
                <td className="num">{(x.x + x.w) * 32}</td>
                <td className="num">{(x.y + x.h) * 32}</td>
                <td className="num">{x.w} × {x.h}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </DialogFrame>
  );
}
