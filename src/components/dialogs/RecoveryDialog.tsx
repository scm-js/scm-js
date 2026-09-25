/**
 * File ▸ Recover Maps… and the question at start: the recovery copies an earlier session
 * left behind (it ended with maps unsaved), each with Restore and Discard. Restoring opens
 * the map in its own tab, marked unsaved; Later closes the dialog and keeps the copies for
 * the next start. The copies of maps open in this window, or in another window still
 * running, are never listed.
 */
import { useEffect, useState } from "react";
import { useSetAtom, useStore } from "jotai";
import { History, RotateCcw, Trash2 } from "lucide-react";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { TILESET_BY_ID, type TilesetId } from "../../data/tilesets";
import { formatBytes } from "../../editor/save";
import { hostTerms } from "../../editor/platform";
import { discardCopy, leftoverEntries, restoreCopy } from "../../hooks/useRecovery";
import type { RecoveryEntry } from "../../services/recovery";
import { t, translate } from "../../i18n";
import { Button } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/** When the copy was made, in the reader's locale. */
function when(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(at).toLocaleString();
  }
}

export function RecoveryDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const [entries, setEntries] = useState<RecoveryEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let live = true;
    void leftoverEntries().then((e) => { if (live) setEntries(e); });
    return () => { live = false; };
  }, []);

  const left = (gone: string[]) => {
    const rest = (entries ?? []).filter((e) => !gone.includes(e.key));
    setEntries(rest);
    // At start the dialog is the question; with nothing left to answer it goes.
    if (rest.length === 0 && entry.payload?.auto) close(entry.key);
  };
  const restore = async (keys: string[]) => {
    setBusy(true);
    const done: string[] = [];
    try {
      for (const key of keys) if (await restoreCopy(store, key)) done.push(key);
    } finally {
      setBusy(false);
    }
    left(done);
    if (done.length === keys.length) close(entry.key);
  };
  const discard = async (keys: string[]) => {
    setBusy(true);
    try {
      for (const key of keys) await discardCopy(key);
    } finally {
      setBusy(false);
      setAsking(false);
    }
    left(keys);
  };
  const all = (entries ?? []).map((e) => e.key);

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Recover Maps")}
      icon={<History size={14} />}
      size="md"
      footerLeft={
        all.length > 1 && (asking ? (
          <>
            <span className="hint">{t("Discard {n, plural, one {# copy} other {all # copies}}?", { n: all.length })}</span>
            <Button size="sm" onClick={() => setAsking(false)}>{t("Keep")}</Button>
            <Button size="sm" variant="danger" disabled={busy} onClick={() => { void discard(all); }}><Trash2 size={11} /> {" "}{t("Discard")}</Button>
          </>
        ) : (
          <Button size="sm" variant="danger" disabled={busy} onClick={() => setAsking(true)}><Trash2 size={11} /> {" "}{t("Discard all…")}</Button>
        ))
      }
      footer={
        <>
          {all.length > 1 && <Button variant="primary" disabled={busy} onClick={() => { void restore(all); }}>{t("Restore all")}</Button>}
          <Button onClick={() => close(entry.key)}>{all.length > 0 ? t("Later") : t("Close")}</Button>
        </>
      }
    >
      <p>
        {entries === null ? t("Looking for recovery copies…")
          : entries.length === 0 ? t("There are no recovery copies to restore.")
          : t("scmJS closed before {n, plural, one {this map was} other {these maps were}} saved. A copy was kept of the changes up to the time shown.", { n: entries.length })}
      </p>
      {entries !== null && entries.length > 0 && (
        <div className="listbox recovery-list">
          {entries.map((e) => (
            <div key={e.key} className="item recovery-item">
              <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
                <strong className="ellipsis">{e.name}</strong>
                <span className="dim ellipsis">
                  {[e.fileName ?? t("Not saved to a file yet"), `${e.width}×${e.height} ${translate(TILESET_BY_ID[e.tileset as TilesetId]?.name ?? e.tileset)}`, formatBytes(e.size)].join(" · ")}
                </span>
                <span className="dim">{t("Copied {when}", { when: when(e.at) })}</span>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => { void restore([e.key]); }}><RotateCcw size={11} /> {" "}{t("Restore")}</Button>
              <Button size="sm" icon variant="ghost" disabled={busy} title={t("Discard this copy")} aria-label={t("Discard this copy")} onClick={() => { void discard([e.key]); }}>
                <Trash2 size={11} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {entries !== null && entries.length > 0 && (
        <p className="hint">
          {t("Restore opens each map in its own tab, with its changes unsaved. Later keeps the copies in {here} for the next start; File ▸ Recover Maps… lists them too.", { here: hostTerms().here })}
        </p>
      )}
    </DialogFrame>
  );
}
