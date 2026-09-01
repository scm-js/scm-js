/**
 * The Script editor: a Monaco TypeScript editor over the map's trigger script, checked
 * live against declarations generated from the map (src/script/declarations.ts) and
 * compiled in a worker (src/script/compileClient.ts). Build installs the result as the
 * script's block of `scenario.triggers` (src/editor/script.ts).
 *
 * The source is the map's: every edit is written straight into the archive extras (it is
 * a file in the .scx, like a WAV), so closing the dialog loses nothing — only Build
 * changes triggers. Monaco itself is `import()`ed on first open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { AlertTriangle, Code2, Download, Hammer } from "lucide-react";
import { archiveExtrasAtom, commitTriggersAtom, locationsRevisionAtom, scenarioAtom, scriptStateAtom, settingsRevisionAtom, triggersRevisionAtom } from "../../atoms/documentAtoms";
import { mapModifiedAtom } from "../../atoms/editorAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { getString } from "../../formats/chk/sections/strings";
import { buildScript, withScript } from "../../editor/script";
import { compileInBackground, CompileSuperseded } from "../../script/compileClient";
import type { CompileResult, ScriptDiagnostic } from "../../script/compiler";
import { generateDeclarations } from "../../script/declarations";
import { scriptNames } from "../../script/names";
import { printScript, SCRIPT_HEADER } from "../../script/print";
import type { ScriptEditor } from "../../script/monaco";
import { Button } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

type MonacoModule = typeof import("../../script/monaco");

const TEMPLATE = `${SCRIPT_HEADER}
// Names come from the map: Locations.*, Switches.*, Units.*, Players.* (or P1 … P12, CurrentPlayer, AllPlayers).
// Every value must be a constant; const declarations and array spreads are fine.

trigger(AllPlayers, [
  Bring(CurrentPlayer, Units.AnyUnit, Locations.Anywhere, "At least", 1),
], [
  DisplayText("Always Display", "Hello from the trigger script."),
  PreserveTrigger(),
]);
`;

const CHECK_DELAY_MS = 350;

function useDeclarations(scenario: ReturnType<typeof useAtomValue<typeof scenarioAtom>>) {
  const settingsRev = useAtomValue(settingsRevisionAtom);
  const locationsRev = useAtomValue(locationsRevisionAtom);
  const triggersRev = useAtomValue(triggersRevisionAtom);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (scenario ? { names: scriptNames(scenario), decls: generateDeclarations(scriptNames(scenario)) } : null), [scenario, settingsRev, locationsRev, triggersRev]);
}

export function ScriptEditorDialog({ entry }: DialogProps) {
  const scenario = useAtomValue(scenarioAtom);
  const state = useAtomValue(scriptStateAtom);
  const setExtras = useSetAtom(archiveExtrasAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const commit = useSetAtom(commitTriggersAtom);
  const close = useSetAtom(closeDialogAtom);
  const generated = useDeclarations(scenario);

  // Held in state, not a ref: the Radix portal mounts a commit after this component (see ExportImageDialog).
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const editorRef = useRef<ScriptEditor | null>(null);
  const monacoRef = useRef<MonacoModule | null>(null);
  const sourceRef = useRef<string>(state.source ?? TEMPLATE);
  const declsRef = useRef<string>(generated?.decls ?? "");
  const timerRef = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [diagnostics, setDiagnostics] = useState<ScriptDiagnostic[]>([]);
  const [status, setStatus] = useState<{ kind: "info" | "ok" | "error"; text: string }>({ kind: "info", text: "" });
  const [building, setBuilding] = useState(false);

  declsRef.current = generated?.decls ?? "";

  /** Type-check and compile in the background; markers land in the editor, the list below. */
  const check = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      compileInBackground(sourceRef.current, declsRef.current).then(
        (r) => {
          setDiagnostics(r.diagnostics);
          const ed = editorRef.current;
          if (ed && monacoRef.current) monacoRef.current.setCompilerMarkers(ed.model, r.diagnostics);
        },
        (err: Error) => { if (!(err instanceof CompileSuperseded)) setStatus({ kind: "error", text: `Compiler: ${err.message}` }); },
      );
    }, CHECK_DELAY_MS);
  };

  // Mount Monaco once the host exists.
  useEffect(() => {
    if (!host || !scenario) return;
    let cancelled = false;
    import("../../script/monaco").then((m) => {
      if (cancelled) return;
      monacoRef.current = m;
      m.setDeclarations(declsRef.current);
      const ed = m.createScriptEditor(host, sourceRef.current, (text) => {
        sourceRef.current = text;
        setExtras((prev) => withScript(prev, text));
        setModified(true);
        check();
      });
      editorRef.current = ed;
      const line = typeof entry.payload?.line === "number" ? entry.payload.line : null;
      if (line) {
        ed.editor.revealLineInCenter(line);
        ed.editor.setPosition({ lineNumber: line, column: 1 });
      }
      ed.editor.focus();
      setReady(true);
      check();
    }, (err: Error) => setStatus({ kind: "error", text: `The editor failed to load: ${err.message}` }));
    return () => {
      cancelled = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      editorRef.current?.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, scenario]);

  // The map's names changed under the open editor: refresh the declarations.
  useEffect(() => {
    if (!monacoRef.current || !generated) return;
    monacoRef.current.setDeclarations(generated.decls);
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated]);

  if (!scenario || !generated) {
    return (
      <DialogFrame dialogKey={entry.key} title="Script Editor" icon={<Code2 size={14} />} size="sm">
        <p className="hint">Open or create a map first.</p>
      </DialogFrame>
    );
  }

  const compileNow = async (): Promise<CompileResult | null> => {
    if (timerRef.current !== null) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    try {
      const r = await compileInBackground(sourceRef.current, declsRef.current);
      setDiagnostics(r.diagnostics);
      if (editorRef.current && monacoRef.current) monacoRef.current.setCompilerMarkers(editorRef.current.model, r.diagnostics);
      return r;
    } catch (err) {
      if (!(err instanceof CompileSuperseded)) setStatus({ kind: "error", text: `Compiler: ${(err as Error).message}` });
      return null;
    }
  };

  const build = async (takeOver = false): Promise<boolean> => {
    setBuilding(true);
    try {
      const r = await compileNow();
      if (!r) return false;
      if (!r.ok) {
        const n = r.diagnostics.length;
        setStatus({ kind: "error", text: `Not built: ${n} error${n === 1 ? "" : "s"}.` });
        return false;
      }
      const source = sourceRef.current;
      const stale = state.stale;
      let next: Map<string, Uint8Array> | null = null;
      setExtras((prev) => {
        // Inside the setter so the extras we build on are the current ones.
        const out = buildScript(scenario, prev, source, r, { takeOver });
        next = out.extras;
        const b = out.block;
        setStatus({
          kind: "ok",
          text: b.count === 0
            ? "Built: the script defines no triggers; the block is empty."
            : `Built ${b.count} trigger${b.count === 1 ? "" : "s"} → #${b.start + 1}–#${b.start + b.count}${stale ? " (appended: the previous block had been edited outside the script)" : ""}.`,
        });
        return out.extras;
      });
      if (next) commit();
      return true;
    } finally {
      setBuilding(false);
    }
  };

  /** Move the hand-made triggers into the script (in their list order around the block) and rebuild from it. */
  const importHand = async () => {
    const ed = editorRef.current;
    if (!ed) return;
    const list = scenario.triggers;
    const block = state.block;
    const before = block ? list.slice(0, block.start) : list.slice();
    const after = block ? list.slice(block.start + block.count) : [];
    if (before.length + after.length === 0) { setStatus({ kind: "info", text: "There are no hand-made triggers to import." }); return; }
    const ctx = { names: generated.names, string: (i: number) => getString(scenario.strings, i) };
    const current = sourceRef.current;
    const blank = current.trim() === "" || current === TEMPLATE;
    // Hand triggers keep their order around the script's own: those before the block go first, those after it last.
    const text = blank
      ? printScript([...before, ...after], ctx)
      : [
          before.length ? printScript(before, ctx, "").trimStart() : "",
          current.replace(/\s+$/, "") + "\n",
          after.length ? printScript(after, ctx, "").trimStart() : "",
        ].filter((s) => s !== "").join("\n");
    ed.model.setValue(text);
    sourceRef.current = text;
    const ok = await build(true);
    if (ok) setStatus({ kind: "ok", text: `Imported ${before.length + after.length} hand-made trigger${before.length + after.length === 1 ? "" : "s"}; every trigger is now generated by the script.` });
  };

  const goTo = (d: ScriptDiagnostic) => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.editor.revealLineInCenter(d.line);
    ed.editor.setPosition({ lineNumber: d.line, column: d.column });
    ed.editor.focus();
  };

  const errors = diagnostics.length;
  const block = state.block;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Script Editor"
      icon={<Code2 size={14} />}
      size="full"
      // Escape inside the editor dismisses its own popups (suggestions, parameter hints); it must not close the dialog.
      onEscapeKeyDown={(e) => { if (host && e.target instanceof Node && host.contains(e.target)) e.preventDefault(); }}
      footerLeft={
        <span className={status.kind === "error" ? "trig-error" : undefined}>
          {status.text || (block ? `Block: ${block.count} generated trigger${block.count === 1 ? "" : "s"} at #${block.start + 1}${state.unbuilt ? " · unbuilt changes" : ""}` : state.stale ? "The last build's triggers were edited outside the script" : "Not built yet")}
        </span>
      }
      footer={
        <>
          <Button variant="primary" onClick={() => { void build().then((ok) => { if (ok) close(entry.key); }); }} disabled={!ready || building}>Build &amp; Close</Button>
          <Button onClick={() => close(entry.key)}>Close</Button>
          <Button onClick={() => { void build(); }} disabled={!ready || building}>Build</Button>
        </>
      }
    >
      <div className="row">
        <Button size="sm" onClick={() => { void build(); }} disabled={!ready || building} title="Compile the script and install its triggers as the map's generated block"><Hammer size={11} /> Build</Button>
        <Button size="sm" onClick={() => { void importHand(); }} disabled={!ready || building} title="Rewrite the map's hand-made triggers as script, appended around the block, and rebuild"><Download size={11} /> Import map triggers</Button>
        <span className="grow" />
        <span className="hint">{errors ? `${errors} problem${errors === 1 ? "" : "s"}` : ready ? "No problems" : "Loading editor…"}</span>
      </div>
      {state.stale && (
        <div className="script-notice">
          <AlertTriangle size={12} /> The triggers from the last build were edited or removed outside the script. They stay as hand-made triggers; the next Build appends a fresh block.
        </div>
      )}
      <div className="script-editor">
        <div className="script-host" ref={setHost} />
        {errors > 0 && (
          <ul className="script-problems">
            {diagnostics.map((d, i) => (
              <li key={i} onClick={() => goTo(d)} title={d.message}>
                <span className="where">{d.line}:{d.column}</span>
                <span className="msg">{d.message.split("\n")[0]}</span>
                <span className="src">{d.source === "typescript" ? "types" : "compiler"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </DialogFrame>
  );
}
