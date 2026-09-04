import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { Download, FileText, Upload } from "lucide-react";
import { commitSettingsAtom, commitTriggersAtom, scenarioAtom, settingsRevisionAtom, triggersRevisionAtom } from "../../atoms/documentAtoms";
import { pluginTriggerClaimsAtom } from "../../atoms/pluginAtoms";
import { locateClaims } from "../../plugins/claims";
import { mapDescriptionAtom, mapFilePathAtom, mapNameAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom, pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import {
  applyStringImport, encodeTrg, formatStringTable, parseStringTable, readTriggerFile, triggersToText, type TriggerFileFormat,
} from "../../editor/exchange";
import { applyBriefing, applyTriggers } from "../../editor/triggers";
import { hostTerms } from "../../editor/platform";
import { getString } from "../../formats/chk/sections/strings";
import type { TriggerRecord } from "../../formats/chk/sections/triggers";
import { saveBytes } from "../../services/mapIo";
import { Button, Check, Field, Group, Select } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

function NoMap({ entry, title, icon }: { entry: DialogProps["entry"]; title: string; icon: React.ReactNode }) {
  return <DialogFrame dialogKey={entry.key} title={title} icon={icon} size="sm"><p className="hint">Open or create a map first.</p></DialogFrame>;
}

/** A file name to suggest: the open file's stem, else the scenario name, made safe. */
function useFileStem(): string {
  const path = useAtomValue(mapFilePathAtom);
  const name = useAtomValue(mapNameAtom);
  const plain = [...(path ?? name).replace(/\.(scm|scx|chk)$/i, "")].filter((c) => c.charCodeAt(0) >= 0x20).join("");
  const stem = plain.replace(/[\\/:*?"<>|]/g, "_").trim();
  return stem || "scenario";
}

/** A picked file, via a hidden input (the picker API's type filter is fussier than a plain accept). */
function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    input.click();
  });
}

const encodeText = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0) & 0xff));

/* ── Triggers ────────────────────────────────────────────── */

type Target = "triggers" | "briefing";
const TARGETS: { value: Target; label: string }[] = [{ value: "triggers", label: "Triggers (TRIG)" }, { value: "briefing", label: "Mission briefing (MBRF)" }];
const FORMATS: { value: TriggerFileFormat; label: string }[] = [{ value: "txt", label: "Text (.txt, TrigEdit syntax)" }, { value: "trg", label: "Binary (.trg, raw records)" }];

export function ExportTriggersDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(triggersRevisionAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const stem = useFileStem();
  const [format, setFormat] = useState<TriggerFileFormat>((entry.payload?.format as TriggerFileFormat) ?? "txt");
  const [target, setTarget] = useState<Target>("triggers");
  if (!scenario) return <NoMap entry={entry} title="Export Triggers" icon={<Download size={14} />} />;

  const list = target === "triggers" ? scenario.triggers : scenario.briefing;
  const fileName = `${stem}${target === "briefing" ? "-briefing" : "-triggers"}.${format}`;
  const doExport = async () => {
    const bytes = format === "trg" ? encodeTrg(list) : encodeText(triggersToText(scenario, list, target === "briefing"));
    const out = await saveBytes(bytes, fileName);
    if (out) {
      const text = `Exported ${list.length} ${target === "briefing" ? "briefing" : "trigger"}${list.length === 1 ? "" : "s"} to ${out.fileName}`;
      setStatus(text);
      toast({ kind: "ok", title: out.route === "download" ? "Triggers downloaded" : "Triggers exported", detail: out.route === "download" ? `${text} — in ${hostTerms().downloads}.` : text });
    }
  };

  return (
    <DialogFrame dialogKey={entry.key} title="Export Triggers" icon={<Download size={14} />} size="sm" okLabel="Export" onOk={() => { void doExport(); }} footerLeft={<span className="mono hint">{fileName}</span>}>
      <Group title="What">
        <div className="form wide">
          <Field label="Export"><Select value={target} onChange={(e) => setTarget(e.target.value as Target)} options={TARGETS} /></Field>
          <Field label="Format"><Select value={format} onChange={(e) => setFormat(e.target.value as TriggerFileFormat)} options={FORMATS} /></Field>
        </div>
      </Group>
      <p className="hint">
        {format === "txt"
          ? "Text triggers name units, locations and switches as this map does and carry their strings, so they can be read into another map. Unknown names print as numbers."
          : "A .trg is the section's own bytes (2400 per record), as SCMDraft exports them. It holds string indices, not text, so it only fits a copy of this map."}
        {" "}{list.length} record{list.length === 1 ? "" : "s"} to write.
      </p>
    </DialogFrame>
  );
}

interface ImportState {
  fileName: string;
  triggers: TriggerRecord[] | null;
  error: string | null;
}

export function ImportTriggersDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(triggersRevisionAtom);
  const claims = useAtomValue(pluginTriggerClaimsAtom);
  const commit = useSetAtom(commitTriggersAtom);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const [target, setTarget] = useState<Target>("triggers");
  const [replace, setReplace] = useState(false);
  const [state, setState] = useState<ImportState | null>(null);
  const [busy, setBusy] = useState(false);
  if (!scenario) return <NoMap entry={entry} title="Import Triggers" icon={<Upload size={14} />} />;

  const accept = entry.payload?.format === "trg" ? ".trg" : entry.payload?.format === "txt" ? ".txt" : ".txt,.trg";
  const pick = async () => {
    const file = await pickFile(accept);
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const triggers = readTriggerFile(scenario, file.name, bytes, target === "briefing");
      setState({ fileName: file.name, triggers, error: null });
    } catch (err) {
      setState({ fileName: file.name, triggers: null, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };
  const apply = () => {
    if (!state?.triggers) return;
    const existing = target === "triggers" ? scenario.triggers : scenario.briefing;
    const next = replace ? state.triggers : [...existing, ...state.triggers];
    if (target === "triggers") applyTriggers(scenario, next); else applyBriefing(scenario, next);
    commit();
    const text = `Imported ${state.triggers.length} ${target === "briefing" ? "briefing" : "trigger"}${state.triggers.length === 1 ? "" : "s"} from ${state.fileName}${replace ? " (replaced the list)" : ""}`;
    setStatus(text);
    toast({ kind: "ok", title: "Triggers imported", detail: text });
    close(entry.key);
  };
  const count = target === "triggers" ? scenario.triggers.length : scenario.briefing.length;

  return (
    <DialogFrame dialogKey={entry.key} title="Import Triggers" icon={<Upload size={14} />} size="sm" footerLeft={<span className="hint">{count} in the map now</span>}
      footer={<><Button variant="primary" disabled={!state?.triggers} onClick={apply}>Import</Button><CloseButton entry={entry} /></>}
    >
      <Group title="File">
        <div className="row">
          <Button size="sm" onClick={() => { void pick(); }} disabled={busy}><Upload size={12} /> Choose file…</Button>
          <span className={`hint ${state?.error ? "error-text" : ""}`} style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
            {busy ? "Reading…" : state ? state.error ? `${state.fileName}: ${state.error}` : `${state.fileName}: ${state.triggers!.length} record${state.triggers!.length === 1 ? "" : "s"}` : `A .txt in TrigEdit syntax or a .trg from SCMDraft (${accept}).`}
          </span>
        </div>
      </Group>
      <Group title="Into">
        <div className="form wide">
          <Field label="List"><Select value={target} onChange={(e) => { setTarget(e.target.value as Target); setState(null); }} options={TARGETS} /></Field>
          <Field label="Mode">
            <div className="col" style={{ gap: 2 }}>
              <Check radio name="import-mode" label={`Append after the existing ${target === "briefing" ? "briefings" : "triggers"}`} checked={!replace} onChange={() => setReplace(false)} />
              <Check radio name="import-mode" label="Replace the whole list" checked={replace} onChange={() => setReplace(true)} />
            </div>
          </Field>
        </div>
        {replace && target === "triggers" && locateClaims(claims, scenario.triggers).map((c) => <p key={c.claim.key} className="hint" style={{ marginTop: 6 }}>Replacing removes the {c.count} trigger{c.count === 1 ? "" : "s"} generated by {c.claim.spec.label}; {c.claim.pluginName} can build them again.</p>)}
      </Group>
      <p className="hint">Text names are resolved against this map's units, locations and switches; the first line that does not resolve is reported above. Strings in the text are added to the string table as needed.</p>
    </DialogFrame>
  );
}

function CloseButton({ entry }: { entry: DialogProps["entry"] }) {
  const close = useSetAtom(closeDialogAtom);
  return <Button onClick={() => close(entry.key)}>Close</Button>;
}

/* ── Strings ─────────────────────────────────────────────── */

const STRING_FORMAT_HINT = "One line per string: the index, a tab, the text. \\n, \\t and \\\\ are escaped; other control characters (the colour codes) are written as <XX> in hex and a literal < as \\<. Lines starting with # are ignored.";

export function ExportStringsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const stem = useFileStem();
  if (!scenario) return <NoMap entry={entry} title="Export Strings" icon={<FileText size={14} />} />;
  const fileName = `${stem}-strings.txt`;
  const count = scenario.strings.strings.filter((s, i) => i > 0 && s !== null).length;
  const doExport = async () => {
    const out = await saveBytes(encodeText(formatStringTable(scenario.strings)), fileName);
    if (out) {
      setStatus(`Exported ${count} strings to ${out.fileName}`);
      toast({ kind: "ok", title: out.route === "download" ? "Strings downloaded" : "Strings exported", detail: `${count} strings — ${out.fileName}${out.route === "download" ? `, in ${hostTerms().downloads}` : ""}` });
    }
  };
  return (
    <DialogFrame dialogKey={entry.key} title="Export Strings" icon={<Download size={14} />} size="sm" okLabel="Export" onOk={() => { void doExport(); }} footerLeft={<span className="mono hint">{fileName}</span>}>
      <p>{count} string{count === 1 ? "" : "s"} of {scenario.strings.strings.length - 1} slots are set.</p>
      <p className="hint">{STRING_FORMAT_HINT}</p>
    </DialogFrame>
  );
}

interface StringImportState {
  fileName: string;
  entries: { index: number; text: string }[];
  errors: { line: number; message: string }[];
}

export function ImportStringsDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  useAtomValue(settingsRevisionAtom);
  const commit = useSetAtom(commitSettingsAtom);
  const close = useSetAtom(closeDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const setName = useSetAtom(mapNameAtom);
  const setDescription = useSetAtom(mapDescriptionAtom);
  const [state, setState] = useState<StringImportState | null>(null);
  if (!scenario) return <NoMap entry={entry} title="Import Strings" icon={<Upload size={14} />} />;

  const pick = async () => {
    const file = await pickFile(".txt");
    if (!file) return;
    const text = new TextDecoder("latin1").decode(new Uint8Array(await file.arrayBuffer()));
    setState({ fileName: file.name, ...parseStringTable(text) });
  };
  const apply = () => {
    if (!state) return;
    const { replaced, added } = applyStringImport(scenario, state.entries);
    if (replaced > 0 || added > 0) commit();
    // The chrome shows mirror atoms of the name and description; keep them in step with the table.
    const name = getString(scenario.strings, scenario.nameIndex);
    if (name !== null) setName(name);
    setDescription(getString(scenario.strings, scenario.descriptionIndex) ?? "");
    setStatus(`Imported strings from ${state.fileName}: ${replaced} replaced, ${added} added`);
    toast({ kind: "ok", title: "Strings imported", detail: `${state.fileName}: ${replaced} replaced, ${added} added` });
    close(entry.key);
  };
  const size = scenario.strings.strings.length;
  const replacing = state ? state.entries.filter((e) => e.index < size).length : 0;

  return (
    <DialogFrame dialogKey={entry.key} title="Import Strings" icon={<Upload size={14} />} size="sm"
      footer={<><Button variant="primary" disabled={!state || state.entries.length === 0} onClick={apply}>Import</Button><CloseButton entry={entry} /></>}
      footerLeft={<span className="hint">{size - 1} slots in the map now</span>}
    >
      <Group title="File">
        <div className="row">
          <Button size="sm" onClick={() => { void pick(); }}><Upload size={12} /> Choose file…</Button>
          <span className="hint" style={{ minWidth: 0 }}>
            {state ? `${state.fileName}: ${state.entries.length} string${state.entries.length === 1 ? "" : "s"} — ${replacing} replace existing slots, ${state.entries.length - replacing} append` : "A .txt written by Export Strings."}
          </span>
        </div>
        {state && state.errors.length > 0 && <p className="error-text" style={{ marginTop: 6 }}>{state.errors.length} line{state.errors.length === 1 ? "" : "s"} skipped — first: line {state.errors[0].line}, {state.errors[0].message}.</p>}
      </Group>
      <p className="hint">Each string goes to the index on its line, so triggers and locations that use it pick up the new text; an index past the end of the table appends. Nothing is renumbered or removed.</p>
      <p className="hint">{STRING_FORMAT_HINT}</p>
    </DialogFrame>
  );
}
