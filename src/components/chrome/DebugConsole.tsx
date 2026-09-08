/**
 * View ▸ Debug Console: the log (`editor/log.ts`) as a strip along the bottom of the
 * window, and the Copy button that turns a session into something a user can paste into a
 * bug report.
 *
 * The buffer records whether this is open or not, so opening it after something went
 * wrong still shows what happened — which is the whole point, since the interesting
 * failures do not repeat on request.
 *
 * It does not subscribe to a Jotai atom, and it does not re-render per entry: the log
 * coalesces its notifications and this holds one counter that a flush bumps. What it
 * renders is the tail after filtering (`SHOWN` rows), because a few thousand DOM rows
 * costs far more than the buffer ever does.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue } from "jotai";
import { consoleHeightAtom, debugConsoleAtom, diagnosticsTextAtom, logVerboseAtom } from "../../atoms/logAtoms";
import { pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { useSetAtom } from "jotai";
import { clearLog, formatData, formatLog, logDropped, logEntries, stamp, subscribeLog, type LogEntry, type LogLevel } from "../../editor/log";
import { saveBlob } from "../../services/mapIo";
import { t } from "../../i18n";

/** Rows put in the DOM. Everything older is in the buffer and in a copy; it is not on screen. */
const SHOWN = 400;

type Filter = "all" | "warn" | "error";

const PASSES: Record<Filter, (l: LogLevel) => boolean> = {
  all: () => true,
  warn: (l) => l !== "info",
  error: (l) => l === "error",
};

export default function DebugConsole() {
  const [open, setOpen] = useAtom(debugConsoleAtom);
  const [verbose, setVerboseFlag] = useAtom(logVerboseAtom);
  const [height, setHeight] = useAtom(consoleHeightAtom);
  const header = useAtomValue(diagnosticsTextAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const [filter, setFilter] = useState<Filter>("all");
  const [needle, setNeedle] = useState("");
  // The buffer is not an atom (see `atoms/logAtoms.ts`); a coalesced flush bumps this instead.
  const [tick, bump] = useState(0);
  const body = useRef<HTMLDivElement>(null);
  // Following the tail is the default and stops the moment the reader scrolls up, the way
  // a terminal behaves; scrolling back to the bottom starts it again.
  const following = useRef(true);

  useEffect(() => (open ? subscribeLog(() => bump((n) => n + 1)) : undefined), [open]);

  const entries = useMemo(() => {
    if (!open) return [];
    const text = needle.trim().toLowerCase();
    const passes = PASSES[filter];
    const out: LogEntry[] = [];
    // Backwards from the newest, stopping at a screenful: the tail is what is on screen,
    // so a long buffer costs the scan and nothing more.
    const all = logEntries();
    for (let i = all.length - 1; i >= 0 && out.length < SHOWN; i--) {
      const e = all[i];
      if (!passes(e.level)) continue;
      if (text && !`${e.source} ${e.message} ${formatData(e.data)}`.toLowerCase().includes(text)) continue;
      out.push(e);
    }
    return out.reverse();
  }, [open, filter, needle, tick]);

  useLayoutEffect(() => {
    const el = body.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const text = useCallback(() => formatLog(logEntries(), header, logDropped()), [header]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setStatus(t("The log was copied — it names the map file, the plugins and the build."));
    } catch {
      pushToast({ kind: "warn", title: t("Could not copy the log"), detail: t("The browser refused the clipboard. Save it to a file instead.") });
    }
  };

  const save = async () => {
    const stampName = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = await saveBlob(new Blob([text()], { type: "text/plain" }), `scm-js-log-${stampName}.txt`);
    if (out) setStatus(t("Log written to {fileName}", { fileName: out.fileName }));
  };

  // The grip on the top edge; the height is remembered like the docks' widths.
  const drag = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const move = (ev: PointerEvent) => setHeight(Math.max(80, Math.min(window.innerHeight - 200, startH - (ev.clientY - startY))));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  if (!open) return null;

  return (
    <section className="debug-console" style={{ height }} aria-label={t("Debug console")}>
      <div className="console-grip" onPointerDown={drag} role="separator" aria-orientation="horizontal" />
      <header className="console-head">
        <span className="console-title">{t("Debug Console")}</span>
        <div className="console-filters" role="group" aria-label={t("Level")}>
          {(["all", "warn", "error"] as const).map((f) => (
            <button key={f} type="button" className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
              {f === "all" ? t("All") : f === "warn" ? t("Warnings") : t("Errors")}
            </button>
          ))}
        </div>
        <input
          className="console-find"
          type="search"
          placeholder={t("Filter")}
          value={needle}
          onChange={(e) => setNeedle(e.target.value)}
          aria-label={t("Filter the log")}
        />
        <label className="console-check" title={t("Also record every plugin API call and every edit. Off between sessions.")}>
          <input type="checkbox" checked={verbose} onChange={(e) => setVerboseFlag(e.target.checked)} />
          {t("Verbose")}
        </label>
        <span className="console-spacer" />
        <button type="button" onClick={() => { clearLog(); bump((n) => n + 1); }}>{t("Clear")}</button>
        <button type="button" onClick={copy} title={t("Copy the whole log, with the build, the game data source and the plugins above it")}>{t("Copy")}</button>
        <button type="button" onClick={save}>{t("Save…")}</button>
        <button type="button" className="console-close" onClick={() => setOpen(false)} aria-label={t("Close the debug console")}>×</button>
      </header>
      <div
        className="console-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {entries.length === 0 ? (
          <p className="console-empty">
            {needle || filter !== "all" ? t("Nothing in the log matches.") : t("Nothing logged yet. Opens, saves, plugin activity and any error land here.")}
          </p>
        ) : (
          entries.map((e) => (
            <div key={e.seq} className={`console-row ${e.level}`}>
              <span className="console-at">{stamp(e.at)}</span>
              <span className="console-source">{e.source}</span>
              <span className="console-msg">
                {e.message}
                {e.data && <span className="console-data"> {formatData(e.data)}</span>}
                {e.repeat && <span className="console-repeat">×{e.repeat}</span>}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
