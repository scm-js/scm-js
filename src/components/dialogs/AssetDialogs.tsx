import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Lock, Music, Pencil, Play, Plus, Replace, Search, SquareDashed, ToggleLeft, Trash2, Type, Upload } from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { activeLayerAtom, selectedLocationsAtom } from "../../atoms/editorAtoms";
import { locationsAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { isAnywhereIntact, locationCapacity, locationName } from "../../editor/locations";
import { useLocationTools } from "../../hooks/useLocationTools";
import { ANYWHERE_INDEX, ELEVATIONS, isLocationUsed } from "../../formats/chk/sections/objects";
import { SAMPLE_SOUNDS, SAMPLE_STRINGS } from "../../data/samples";
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

/**
 * Scenario ▸ Locations…: every slot in use as a table, Anywhere first. A row selects on
 * the map (Shift adds); double-click jumps the view to it and closes; the buttons make,
 * edit and delete like the palette does.
 */
export function LocationListDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const locations = useAtomValue(locationsAtom);
  const selected = useAtomValue(selectedLocationsAtom);
  const open = useSetAtom(openDialogAtom);
  const close = useSetAtom(closeDialogAtom);
  const setLayer = useSetAtom(activeLayerAtom);
  const tools = useLocationTools();
  const [sort, setSort] = useState<"slot" | "name" | "size">("slot");
  const rows = useMemo(() => {
    const r = [...locations];
    if (sort === "name") r.sort((a, b) => a.name.localeCompare(b.name) || a.index - b.index);
    if (sort === "size") r.sort((a, b) => b.w * b.h - a.w * a.h || a.index - b.index);
    return r;
  }, [locations, sort]);
  const first = selected[0];
  const anywhere = scenario?.locations[ANYWHERE_INDEX];
  const capacity = scenario ? locationCapacity(scenario) - 1 : 0;
  const goTo = (index: number) => {
    tools.select([index]);
    tools.centerOn(index);
    setLayer("locations");
    close(entry.key);
  };
  const cell = (v: number) => <td className="num">{v}</td>;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Locations"
      icon={<SquareDashed size={14} />}
      size="lg"
      tall
      footer={<Button variant="primary" onClick={() => close(entry.key)}>Close</Button>}
      footerLeft={<span>{locations.length} / {capacity} locations · slot 63 is Anywhere · double-click to go to one</span>}
    >
      <div className="row">
        <Button size="sm" disabled={!scenario} onClick={() => tools.createInView()}><Plus size={12} /> New</Button>
        <Button size="sm" disabled={first === undefined} onClick={() => open("locationProperties", { index: first })}><Pencil size={12} /> Properties…</Button>
        <Button size="sm" disabled={!selected.some((i) => i !== ANYWHERE_INDEX)} onClick={() => tools.deleteSelected()}><Trash2 size={12} /> Delete</Button>
        <span className="grow" />
        <Select style={{ width: 160 }} value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} options={[{ value: "slot", label: "Sort by slot" }, { value: "name", label: "Sort by name" }, { value: "size", label: "Sort by size" }]} />
      </div>
      <div className="listbox grow">
        <table className="table">
          <thead>
            <tr><th style={{ width: 40 }}>Slot</th><th>Name</th><th style={{ width: 66 }}>Left</th><th style={{ width: 66 }}>Top</th><th style={{ width: 66 }}>Right</th><th style={{ width: 66 }}>Bottom</th><th style={{ width: 90 }}>Tiles</th><th style={{ width: 60 }} title="Elevations the location applies on">Elev.</th></tr>
          </thead>
          <tbody>
            {scenario && anywhere && isLocationUsed(anywhere) && (
              <tr className={selected.includes(ANYWHERE_INDEX) ? "selected" : ""} onClick={(e) => tools.select([ANYWHERE_INDEX], e.shiftKey)} onDoubleClick={() => open("locationProperties", { index: ANYWHERE_INDEX })}>
                {cell(ANYWHERE_INDEX)}
                <td><span className="row" style={{ gap: 4 }}><Lock size={10} className="faint" />{locationName(scenario, ANYWHERE_INDEX)}{!isAnywhereIntact(scenario) && <span className="badge warn">off map</span>}</span></td>
                {cell(anywhere.left)}{cell(anywhere.top)}{cell(anywhere.right)}{cell(anywhere.bottom)}
                <td className="num">{scenario.width} × {scenario.height}</td>
                <td className="num">{6 - ELEVATIONS.filter((e) => anywhere.elevationFlags & e.bit).length} / 6</td>
              </tr>
            )}
            {rows.map((l) => (
              <tr key={l.index} className={selected.includes(l.index) ? "selected" : ""} onClick={(e) => tools.select([l.index], e.shiftKey)} onDoubleClick={() => goTo(l.index)}>
                {cell(l.index)}
                <td>{l.name}{l.inverted && <span className="faint"> · inverted</span>}</td>
                {cell(scenario!.locations[l.index].left)}{cell(scenario!.locations[l.index].top)}{cell(scenario!.locations[l.index].right)}{cell(scenario!.locations[l.index].bottom)}
                <td className="num">{l.w} × {l.h}</td>
                <td className="num">{6 - ELEVATIONS.filter((e) => l.elevationFlags & e.bit).length} / 6</td>
              </tr>
            ))}
            {locations.length === 0 && <tr><td colSpan={8} className="hint">No locations yet — drag on empty ground on the Locations layer to create one.</td></tr>}
          </tbody>
        </table>
      </div>
    </DialogFrame>
  );
}
