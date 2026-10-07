/**
 * What is left when the editor's own tree could not render: the boundary around `App`
 * (`main.tsx`) shows this in its place.
 *
 * The Debug Console went with the tree, so this is the log's other reader — the tail on
 * screen, and the same copy and file the console's buttons make. It leans on as little as
 * it can: the log is a plain module, the store is read inside handlers and never during
 * render, and nothing here is shared with the chrome that just failed.
 *
 * The maps are still in the store. A recovery copy of each one with unsaved changes is
 * written on the way in, so Reload offers them back; Try again mounts the editor over the
 * same store, maps and all.
 */
import { useEffect, useState } from "react";
import { useStore } from "jotai";
import { diagnosticsTextAtom } from "../../atoms/logAtoms";
import { formatEntry, formatLog, logDropped, logEntries, logError, subscribeLog } from "../../editor/log";
import { writeCopiesNow } from "../../hooks/useRecovery";
import { saveBlob } from "../../services/mapIo";
import { t } from "../../i18n";
import { removeBootSplash } from "../splash/bootSplash";
import { Button } from "../ui";
import { errorText } from "../ui/ErrorBoundary";

/** Entries shown; the copy and the file carry the whole buffer. */
const TAIL = 80;

export default function CrashScreen({ error, retry }: { error: unknown; retry: () => void }) {
  const store = useStore();
  const [copies, setCopies] = useState(0);
  const [said, setSaid] = useState("");
  const [, bump] = useState(0);

  useEffect(() => subscribeLog(() => bump((n) => n + 1)), []);
  // A failure before the splash was taken down would leave it over this.
  useEffect(removeBootSplash, []);
  useEffect(() => {
    let live = true;
    writeCopiesNow(store).then((n) => { if (live) setCopies(n); }, (err) => logError("recovery", "No recovery copy after the editor failed", err));
    return () => { live = false; };
  }, [store]);

  const text = () => {
    // The header reads a dozen atoms, any of which may be what failed.
    let header = "";
    try { header = store.get(diagnosticsTextAtom); } catch { /* the entries alone, then */ }
    return formatLog(logEntries(), header, logDropped());
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text());
      setSaid(t("The log was copied — it names the map file, the plugins and the build."));
    } catch {
      setSaid(t("The browser refused the clipboard. Save it to a file instead."));
    }
  };

  const save = async () => {
    const stampName = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const out = await saveBlob(new Blob([text()], { type: "text/plain" }), `scm-js-log-${stampName}.txt`);
    if (out) setSaid(t("Log written to {fileName}", { fileName: out.fileName }));
  };

  return (
    <div className="crash-screen" role="alert">
      <div className="crash-card">
        <h1>{t("The editor hit an error and stopped drawing.")}</h1>
        <p className="crash-detail">{errorText(error)}</p>
        <p>{t("Your maps are still open behind this. Try again brings the editor back as it was; if the error comes straight back, reload.")}</p>
        {copies > 0 && (
          <p>{t("{n, plural, one {A recovery copy of # map with unsaved changes was written} other {Recovery copies of # maps with unsaved changes were written}}, and the editor offers them back after a reload.", { n: copies })}</p>
        )}
        <div className="crash-actions">
          <Button variant="primary" onClick={retry}>{t("Try again")}</Button>
          <Button onClick={() => window.location.reload()}>{t("Reload")}</Button>
          <span className="crash-spacer" />
          <Button onClick={copy}>{t("Copy the log")}</Button>
          <Button onClick={save}>{t("Save the log…")}</Button>
        </div>
        {said && <p className="crash-said">{said}</p>}
        <pre className="crash-log">{logEntries().slice(-TAIL).map(formatEntry).join("\n")}</pre>
      </div>
    </div>
  );
}
