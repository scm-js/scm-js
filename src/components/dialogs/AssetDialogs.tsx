import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Eraser, Lock, Music, Pencil, Play, Plus, RefreshCw, Search, Square, SquareDashed, ToggleLeft, Trash2, Type, Upload } from "lucide-react";
import { closeDialogAtom, openDialogAtom } from "../../atoms/uiAtoms";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import { activeLayerAtom, mapDescriptionAtom, mapNameAtom, selectedLocationsAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, commitSettingsAtom, locationsAtom, scenarioAtom, settingsRevisionAtom } from "../../atoms/documentAtoms";
import { isAnywhereIntact, locationCapacity, locationName } from "../../editor/locations";
import { applyStrings, deleteUnused, readStrings, stringCapacity, stringUsages, type StringUsage } from "../../editor/strings";
import { addSound, applySounds, findMember, normalizeMember, orphanSounds, readWavs, removeSound, soundBytes, soundList, wavMemberName, type SoundRow } from "../../editor/sounds";
import { applySwitchNames, readSwitchNames, switchUsage } from "../../editor/switches";
import { hostTerms } from "../../editor/platform";
import { useLocationTools } from "../../hooks/useLocationTools";
import { useScenarioForm } from "../../hooks/useScenarioForm";
import { ANYWHERE_INDEX, ELEVATIONS, isLocationUsed } from "../../formats/chk/sections/objects";
import { WAV_SLOTS } from "../../formats/chk/sections/sounds";
import { canDecodeWav, decodeWav, isPlainPcm, parseWavHeader, wavDuration, wavFormatLabel, type WavInfo } from "../../formats/wav";
import { convertToWav, decodeAudio, DEFAULT_WAV_PRESET, IMPORT_EXTENSIONS, matchesTarget, toAudioBuffer, WAV_PRESETS, withWavExtension } from "../../services/audioConvert";
import { Button, Check, ListBox, Select, TextInput } from "../ui";
import { ColorTextField, InlineString } from "../ui/ColorCodes";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

function NoMap({ entry, title, icon }: { entry: DialogProps["entry"]; title: string; icon: React.ReactNode }) {
  return <DialogFrame dialogKey={entry.key} title={title} icon={icon} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
}

/* ── String Editor ──────────────────────────────────────── */

/**
 * Scenario ▸ String Editor: every entry of STR / STRx with where it is referenced. Edits
 * change the text at its index (triggers and locations keep pointing where they did);
 * "Delete unused" blanks slots nothing refers to, and only unused slots at the very end
 * are dropped on apply. Control bytes show as `<XX>` and can be typed that way.
 */
export function StringEditorDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const setName = useSetAtom(mapNameAtom);
  const setDescription = useSetAtom(mapDescriptionAtom);
  const [list, setList] = useScenarioForm(scenario, readStrings);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<number>(typeof entry.payload?.index === "number" ? (entry.payload.index as number) : 1);
  // Preview the string the way 1.16.1 drew it (colour reset at every line break) rather
  // than the way Remastered does; the difference is the whole point of the tick. It is
  // one setting rather than this dialog's own, since every preview in the chrome — the
  // list beside this field included — now draws by it.
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  // Usages are by index and indices never move, so the scenario's own picture stays right for the working copy.
  const usages = useMemo<Map<number, StringUsage[]>>(() => (scenario ? stringUsages(scenario) : new Map()), [scenario]);

  const rows = useMemo(() => {
    if (!list) return [];
    const needle = q.trim().toLowerCase();
    const out: { index: number; text: string | null; used: string }[] = [];
    for (let i = 1; i < list.length; i++) {
      const used = (usages.get(i) ?? []).map((u) => u.label).join(", ");
      if (needle && !(list[i] ?? "").toLowerCase().includes(needle) && !used.toLowerCase().includes(needle) && String(i) !== needle) continue;
      out.push({ index: i, text: list[i], used });
    }
    return out;
  }, [list, q, usages]);

  if (!scenario || !list) return <NoMap entry={entry} title="String Editor" icon={<Type size={14} />} />;

  const current = list[sel] ?? null;
  // StarEdit pads a table to 1024 with empty strings; count those apart from real text nothing uses.
  const unused = list.filter((s, i) => i > 0 && s !== null && s !== "" && !usages.has(i)).length;
  const empty = list.filter((s, i) => i > 0 && s === "" && !usages.has(i)).length;
  const capacity = stringCapacity(scenario);
  const count = list.length - 1;
  const setText = (index: number, text: string | null) => { const next = list.slice(); next[index] = text; setList(next); };

  const addString = () => { const next = [...list, ""]; setList(next); setSel(next.length - 1); setQ(""); };
  const apply = () => {
    if (applyStrings(scenario, list, usages)) {
      commit();
      // The chrome shows mirror atoms of the name and description; keep them in step with the table.
      const name = list[scenario.nameIndex];
      if (name) setName(name);
      setDescription(list[scenario.descriptionIndex] ?? "");
    }
    setList(readStrings(scenario));
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="String Editor"
      icon={<Type size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={<span className={count > capacity ? "error-text" : ""}>{count} strings · {unused} unused{empty > 0 ? ` · ${empty} empty` : ""} · capacity {capacity.toLocaleString()} ({scenario.strings.extended ? "STRx" : "STR"})</span>}
    >
      <div className="row">
        <Search size={12} className="faint" />
        <TextInput placeholder="Search text, usages or #…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button size="sm" onClick={addString} title="Append an empty string at the end of the table"><Plus size={12} /> Add string</Button>
        <Button size="sm" disabled={unused + empty === 0} onClick={() => setList(deleteUnused(list, usages))} title="Blank every string nothing refers to (slots keep their numbers)"><Trash2 size={12} /> Delete unused</Button>
      </div>
      <div className="split rows" style={{ ["--split" as string]: "1fr" }}>
        <div className="listbox">
          <table className="table">
            <thead><tr><th style={{ width: 50 }}>#</th><th>Text</th><th style={{ width: 220 }}>Used by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.index} className={sel === r.index ? "selected" : ""} onClick={() => setSel(r.index)}>
                  <td className="num">{r.index}</td>
                  <td className={r.text === null ? "faint" : ""} style={{ maxWidth: 360 }}>{r.text === null ? "(blank)" : <InlineString text={r.text} placeholder="(empty)" />}</td>
                  <td className={r.used ? "dim" : "faint"} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }} title={r.used}>{r.used || "unused"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} className="hint">{q ? "No strings match." : "The table is empty."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="dim" style={{ fontSize: 11 }}>
            String #{current === undefined ? "—" : sel} · {(usages.get(sel) ?? []).map((u) => u.label).join(", ") || (list[sel] === null ? "blank slot" : "not referenced")}
          </span>
          <ColorTextField
            value={current ?? ""}
            onChange={(text) => setText(sel, text)}
            multiline
            rows={5}
            codes="bar"
            preview="below"
            wrapClassName="grow"
            className="mono"
            style={{ minHeight: 90 }}
            disabled={sel <= 0 || sel >= list.length}
            placeholder={sel > 0 && sel < list.length ? "Empty string" : "Select a string to edit it"}
          />
          <div className="row between">
            <p className="hint" style={{ margin: 0 }}>Bytes below 0x20 are shown as &lt;XX&gt; and may be typed that way; tab and line breaks stay literal.</p>
            <Check
              label="1.16.1 colours"
              title="Reset the colour at every line break, the way 1.16.1 drew it. Remastered carries a colour onto the next line instead — if the string changes when you tick this, it renders differently now than when it was written. The setting is the editor's, so every preview in it follows."
              checked={prefs.classicText}
              onChange={(e) => setPrefs({ ...prefs, classicText: e.target.checked })}
            />
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}

/* ── Sound Editor ───────────────────────────────────────── */

interface SoundForm {
  wavs: number[];
  extras: Map<string, Uint8Array>;
}

/** What the last Import / Convert did to each file, shown under the buttons. */
interface SoundNote {
  name: string;
  text: string;
  level: "ok" | "warn";
}

const kb = (n: number) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
const KEEP = "keep";
const IMPORT_AS = [...WAV_PRESETS.map((p) => ({ value: p.id, label: p.label })), { value: KEEP, label: "Keep PCM WAV and Ogg files as they are" }];
const IMPORT_ACCEPT = [...IMPORT_EXTENSIONS, "audio/*"].join(",");

/** The format column: what a WAV header says, or the extension for anything else. */
function formatOf(bytes: Uint8Array | undefined, path: string): { label: string; wav: WavInfo | null } {
  if (!bytes) return { label: "—", wav: null };
  const wav = parseWavHeader(bytes);
  if (wav) return { label: wavFormatLabel(wav), wav };
  const ext = path.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  return { label: ext === "ogg" || ext === "oga" ? "Ogg" : ext ? ext.toUpperCase() : "?", wav: null };
}

/**
 * Scenario ▸ Sound Editor: the WAV table joined with the archive's sound members. Import
 * adds a member under `staredit\wav\` and a table entry, converting anything the browser can
 * decode (MP3, FLAC, AAC, Ogg, any WAV) to PCM WAV in the chosen format on the way in;
 * Convert does the same to a listed `.wav`; Remove clears the slot and, when nothing else
 * refers to the file, drops the member too. Playback and Convert decode a WAV with
 * `formats/wav.ts` first — the game's IMA ADPCM sounds included — and fall back to Web
 * Audio for everything else (MP3, Ogg, FLAC); the length column comes off the header.
 */
export function SoundEditorDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const extrasAtom = useAtomValue(archiveExtrasAtom);
  const setExtras = useSetAtom(archiveExtrasAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [form, setForm] = useScenarioForm<SoundForm>(scenario, (scn) => ({ wavs: readWavs(scn), extras: new Map(extrasAtom) }));
  const [sel, setSel] = useState(-1);
  const [playing, setPlaying] = useState<string | null>(null);
  const [durations, setDurations] = useState<Map<string, number | null>>(new Map());
  const [preset, setPreset] = useState(DEFAULT_WAV_PRESET.id);
  const [notes, setNotes] = useState<SoundNote[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [, bump] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const audio = useRef<{ ctx: AudioContext; source: AudioBufferSourceNode | null } | null>(null);

  const rows = useMemo(() => (scenario && form ? soundList(scenario, form.extras, form.wavs) : []), [scenario, form]);
  const orphans = useMemo(() => (scenario && form ? orphanSounds(scenario, form.extras, form.wavs) : []), [scenario, form]);

  const context = () => {
    if (!audio.current) audio.current = { ctx: new AudioContext(), source: null };
    return audio.current;
  };
  const stop = () => {
    const a = audio.current;
    if (a?.source) { try { a.source.stop(); } catch { /* already ended */ } a.source = null; }
    setPlaying(null);
  };
  useEffect(() => () => { const a = audio.current; if (a) { try { a.source?.stop(); } catch { /* ended */ } void a.ctx.close(); } }, []);

  // Each present member's length: off the WAV header where there is one, else decoded once
  // through Web Audio (an Ogg); failures show as "cannot decode".
  useEffect(() => {
    if (!form) return;
    const pending = rows.filter((r) => r.member && !durations.has(r.member));
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      const next = new Map(durations);
      for (const r of pending) {
        const bytes = form.extras.get(r.member!)!;
        const info = parseWavHeader(bytes);
        if (info && canDecodeWav(info)) { next.set(r.member!, wavDuration(info)); continue; }
        try {
          const buf = await decodeAudio(bytes);
          next.set(r.member!, buf.duration);
        } catch {
          next.set(r.member!, null);
        }
      }
      if (!cancelled) setDurations(next);
    })();
    return () => { cancelled = true; };
  }, [rows, form, durations]);

  if (!scenario || !form) return <NoMap entry={entry} title="Sound Editor" icon={<Music size={14} />} />;

  const row: SoundRow | undefined = rows.find((r) => r.slot === sel);
  const filled = form.wavs.filter((i) => i !== 0).length;
  const target = WAV_PRESETS.find((p) => p.id === preset)?.target ?? null;
  const rowBytes = row?.member ? form.extras.get(row.member) : undefined;
  const rowFormat = row ? formatOf(rowBytes, row.path) : null;
  const rowDecodes = row?.member ? durations.get(row.member) !== null : false;
  // Convert works in place on a `.wav` member the browser can decode; an Ogg keeps its name
  // and its Remastered-only playback, so it is re-imported instead.
  const canConvert = !!row?.member && /\.wav$/i.test(row.path) && rowDecodes && !busy
    && !!(target && rowFormat?.wav && !matchesTarget(rowFormat.wav, target));

  const play = async (r: SoundRow) => {
    if (!r.member) return;
    stop();
    const a = context();
    try {
      const bytes = form.extras.get(r.member)!;
      const own = decodeWav(bytes);
      const buf = own ? toAudioBuffer(a.ctx, own) : await a.ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
      const source = a.ctx.createBufferSource();
      source.buffer = buf;
      source.connect(a.ctx.destination);
      source.onended = () => { if (a.source === source) { a.source = null; setPlaying(null); } };
      a.source = source;
      source.start();
      setPlaying(r.member);
    } catch {
      setDurations(new Map(durations).set(r.member, null));
    }
  };

  /** Drop a member's cached length so the next render decodes the new bytes. */
  const forgetLength = (member: string) => setDurations((d) => { const n = new Map(d); n.delete(member); return n; });

  /**
   * The bytes to store for `file`: as they are when the preset says keep and the file is a
   * PCM WAV or an Ogg, else decoded and rendered to the preset (the game standard when keeping).
   */
  const prepare = async (name: string, bytes: Uint8Array): Promise<{ bytes: Uint8Array; name: string; note: SoundNote }> => {
    const wav = parseWavHeader(bytes);
    const isOgg = /\.(ogg|oga|opus)$/i.test(name);
    if (!target && ((wav && isPlainPcm(wav)) || isOgg)) {
      return { bytes, name, note: { name, level: "ok", text: wav ? `kept as it is (${wavFormatLabel(wav)})` : "kept as it is (Ogg plays in Remastered only)" } };
    }
    const t = target ?? DEFAULT_WAV_PRESET.target;
    const result = await convertToWav(bytes, t);
    const label = wavFormatLabel(parseWavHeader(result.bytes)!);
    if (!result.converted) return { bytes, name, note: { name, level: "ok", text: `already ${label}` } };
    const out = withWavExtension(name);
    const from = wav ? wavFormatLabel(wav) : (name.match(/\.([^.\\/]+)$/)?.[1] ?? "file").toUpperCase();
    return { bytes: result.bytes, name: out, note: { name, level: "ok", text: `${from} → ${label}, ${mmss(result.seconds)}, ${kb(result.bytes.length)}${out !== name ? `, stored as ${out.split(/[\\/]/).pop()}` : ""}` } };
  };

  const importFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const extras = new Map(form.extras);
    const wavs = form.wavs.slice();
    const done: SoundNote[] = [];
    let last = -1;
    setBusy("Importing…");
    try {
      for (const file of Array.from(files)) {
        setBusy(`Converting ${file.name}…`);
        try {
          const prepared = await prepare(file.name, new Uint8Array(await file.arrayBuffer()));
          const name = wavMemberName(prepared.name);
          const existing = findMember(extras, name);
          if (existing) forgetLength(existing);
          extras.set(existing ?? name, prepared.bytes);
          last = addSound(scenario, wavs, existing ?? name);
          done.push(prepared.note);
        } catch (err) {
          done.push({ name: file.name, level: "warn", text: `not imported: the ${hostTerms().noun} could not decode it${err instanceof Error && err.message ? ` (${err.message})` : ""}` });
        }
      }
    } finally {
      setBusy(null);
    }
    setForm({ wavs, extras });
    setNotes(done);
    if (last >= 0) setSel(last);
    bump((n) => n + 1);
  };

  const convertRow = async (r: SoundRow) => {
    if (!r.member || !target) return;
    if (playing === r.member) stop();
    setBusy(`Converting ${r.path.split(/[\\/]/).pop()}…`);
    try {
      const before = form.extras.get(r.member)!;
      const result = await convertToWav(before, target);
      const extras = new Map(form.extras);
      extras.set(r.member, result.bytes);
      forgetLength(r.member);
      setForm({ ...form, extras });
      setNotes([{ name: r.path, level: "ok", text: `${wavFormatLabel(parseWavHeader(before)!)} → ${wavFormatLabel(parseWavHeader(result.bytes)!)}, ${kb(before.length)} → ${kb(result.bytes.length)}` }]);
    } catch (err) {
      setNotes([{ name: r.path, level: "warn", text: `not converted: the ${hostTerms().noun} could not decode it${err instanceof Error && err.message ? ` (${err.message})` : ""}` }]);
    } finally {
      setBusy(null);
    }
  };

  const addOrphan = (name: string) => {
    const wavs = form.wavs.slice();
    const slot = addSound(scenario, wavs, name);
    setForm({ ...form, wavs });
    if (slot >= 0) setSel(slot);
  };

  const remove = (r: SoundRow) => {
    if (playing === r.member) stop();
    const wavs = removeSound(form.wavs, r.slot);
    const extras = new Map(form.extras);
    // Drop the file only when no other slot lists it and no trigger still plays the string.
    const stillListed = wavs.some((i) => i !== 0 && normalizeMember(scenario.strings.strings[i] ?? "") === normalizeMember(r.path));
    if (r.member && !stillListed && r.usedBy.length === 0) extras.delete(r.member);
    setForm({ wavs, extras });
    setSel(-1);
  };

  const apply = () => {
    const changed = applySounds(scenario, form.wavs);
    const extrasChanged = form.extras.size !== extrasAtom.size || [...form.extras].some(([k, v]) => extrasAtom.get(k) !== v);
    if (extrasChanged) setExtras(new Map(form.extras));
    if (changed || extrasChanged) commit();
  };

  const length = (r: SoundRow) => {
    if (!r.member) return <span className="faint">—</span>;
    const d = durations.get(r.member);
    if (d === undefined) return <span className="faint">…</span>;
    return d === null ? <span className="faint" title={`Neither the editor's WAV decoder nor the ${hostTerms().noun} could read this file`}>cannot decode</span> : mmss(d);
  };

  const format = (r: SoundRow) => {
    const f = formatOf(r.member ? form.extras.get(r.member) : undefined, r.path);
    const odd = f.wav && !isPlainPcm(f.wav);
    return <span className={odd ? "warn" : "dim"} title={odd ? (f.wav && canDecodeWav(f.wav) ? "Not plain PCM: the game plays its own ADPCM, other encodings it may not — Convert re-encodes it as PCM" : "Not plain PCM: the game may not play it, and this editor cannot convert it") : undefined}>{f.label}</span>;
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Sound Editor"
      icon={<Music size={14} />}
      size="lg"
      tall
      showApply
      onOk={apply}
      footerLeft={<span>{filled} / {WAV_SLOTS} sounds · {kb(soundBytes(form.extras))} in archive{scenario.wavs ? "" : " · no WAV section yet"}</span>}
    >
      <input ref={fileRef} type="file" accept={IMPORT_ACCEPT} multiple hidden onChange={(e) => { void importFiles(e.target.files); e.target.value = ""; }} />
      <div className="row">
        <Button size="sm" onClick={() => fileRef.current?.click()} disabled={filled >= WAV_SLOTS || !!busy}><Upload size={12} /> Import…</Button>
        <label className="row" style={{ gap: 6 }}>
          <span className="dim" style={{ fontSize: 11 }}>as</span>
          <Select value={preset} options={IMPORT_AS} onChange={(e) => setPreset(e.target.value)} disabled={!!busy} style={{ minWidth: 290 }} title={`Files are decoded by the ${hostTerms().noun} and written as PCM WAV in this format. The game's own sounds are 22050 Hz, 16-bit, mono.`} />
        </label>
        <Button size="sm" disabled={!canConvert} onClick={() => row && void convertRow(row)} title={target ? "Re-encode the selected .wav to the chosen format" : "Choose a format to convert to"}><RefreshCw size={12} /> Convert</Button>
        {playing && row?.member === playing
          ? <Button size="sm" onClick={stop}><Square size={12} /> Stop</Button>
          : <Button size="sm" disabled={!row?.member || !rowDecodes} onClick={() => row && void play(row)}><Play size={12} /> Play</Button>}
        <Button size="sm" disabled={!row || !!busy} onClick={() => row && remove(row)}><Trash2 size={12} /> Remove</Button>
        <span className="grow" />
        <span className="hint">{busy ?? <>Files go in <span className="mono">staredit\wav\</span> inside the .scx</>}</span>
      </div>
      {notes.length > 0 && (
        <div className="col" style={{ gap: 2, fontSize: 11 }}>
          {notes.map((n, i) => <div key={i} className={n.level === "warn" ? "warn" : "dim"}><span className="mono">{n.name.split(/[\\/]/).pop()}</span>: {n.text}</div>)}
        </div>
      )}
      <div className="listbox" style={{ flex: 1, minHeight: 200 }}>
        <table className="table">
          <thead><tr><th style={{ width: 40 }}>#</th><th>Path in archive</th><th style={{ width: 70 }}>Size</th><th style={{ width: 170 }}>Format</th><th style={{ width: 70 }}>Length</th><th style={{ width: 150 }}>Used by</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.slot} className={sel === r.slot ? "selected" : ""} onClick={() => setSel(r.slot)} onDoubleClick={() => void play(r)}>
                <td className="num">{r.slot}</td>
                <td className="mono">{r.path}{!r.present && <span className="badge warn" style={{ marginLeft: 6 }} title="The table lists this path but the archive has no such file">missing</span>}{playing === r.member && <span className="badge teal" style={{ marginLeft: 6 }}>playing</span>}</td>
                <td className="num">{r.present ? kb(r.size) : "—"}</td>
                <td>{format(r)}</td>
                <td className="num">{length(r)}</td>
                <td className={r.usedBy.length ? "dim" : "faint"} title={r.usedBy.join(", ")}>{r.usedBy.length ? r.usedBy.join(", ") : "not referenced"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="hint">No sounds in the table — import a file, or add one of the archive's files below.</td></tr>}
          </tbody>
        </table>
      </div>
      {orphans.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="dim" style={{ fontSize: 11 }}>In the archive but not in the table:</span>
          <div className="row wrap" style={{ gap: 4 }}>
            {orphans.map((name) => <Button key={name} size="sm" onClick={() => addOrphan(name)} title={`Add ${name} to the WAV table`}><Plus size={11} /> <span className="mono">{name}</span></Button>)}
          </div>
        </div>
      )}
      <p className="hint">Import takes MP3, FLAC, AAC, Ogg and WAV (anything the {hostTerms().noun} decodes) and writes PCM WAV in the chosen format, which every StarCraft build plays; keep an Ogg only for Remastered. Remove clears the slot; the file is dropped from the archive too unless another slot or a trigger still refers to it. Triggers play a sound by its string, so a removed slot leaves the string in the table until String Editor's Delete unused.</p>
    </DialogFrame>
  );
}
/* ── Switches ───────────────────────────────────────────── */

/** Scenario ▸ Switches: the 256 switch names (SWNM) with how many triggers use each. */
export function SwitchesDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const [names, setNames] = useScenarioForm(scenario, readSwitchNames);
  const [sel, setSel] = useState(0);
  const usage = useMemo(() => (scenario ? switchUsage(scenario) : []), [scenario]);

  if (!scenario || !names) return <NoMap entry={entry} title="Switches" icon={<ToggleLeft size={14} />} />;

  const named = names.filter((n) => n !== "").length;
  const referenced = usage.filter((n) => n > 0).length;
  const rename = (i: number, text: string) => { const next = names.slice(); next[i] = text; setNames(next); };
  const apply = () => { if (applySwitchNames(scenario, names)) commit(); setNames(readSwitchNames(scenario)); };

  return (
    <DialogFrame dialogKey={entry.key} title="Switches" icon={<ToggleLeft size={14} />} size="md" tall showApply onOk={apply} footerLeft={<span>256 switches · {named} named · {referenced} referenced by triggers</span>}>
      <div className="split rows" style={{ ["--split" as string]: "1fr" }}>
        <ListBox
          items={names}
          selected={sel}
          onSelect={setSel}
          render={(n, i) => (
            <>
              <span className="idx">{i + 1}</span>
              {n ? <span>{n}</span> : <span className="faint">Switch {i + 1}</span>}
              <span className="row" style={{ marginLeft: "auto", gap: 4 }}>
                {usage[i] > 0 && <span className="dim" style={{ fontSize: 10 }} title="Switch conditions and Set Switch actions">{usage[i]} use{usage[i] === 1 ? "" : "s"}</span>}
                {n && <span className="badge teal">named</span>}
              </span>
            </>
          )}
        />
        <div className="col" style={{ gap: 8, flex: "none" }}>
          <div className="form wide">
            <label>Switch {sel + 1}</label>
            <div className="row">
              <TextInput key={sel} placeholder={`Switch ${sel + 1}`} value={names[sel]} onChange={(e) => rename(sel, e.target.value)} maxLength={255} />
              <Button size="sm" disabled={names[sel] === ""} onClick={() => rename(sel, "")} title="Back to the default name"><Eraser size={12} /> Clear</Button>
            </div>
            <label>Used by</label>
            <span className="dim">{usage[sel] > 0 ? `${usage[sel]} condition${usage[sel] === 1 ? "" : "s"} / action${usage[sel] === 1 ? "" : "s"}` : "not referenced by any trigger"}</span>
          </div>
          <p className="hint">Names are stored in the string table (SWNM); an identical string is reused, a cleared name goes back to "Switch N". Text triggers and the script use the name.</p>
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
              <tr className={selected.includes(ANYWHERE_INDEX) ? "selected" : ""} onClick={(e) => tools.select([ANYWHERE_INDEX], e.shiftKey)} onDoubleClick={() => goTo(ANYWHERE_INDEX)}>
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
