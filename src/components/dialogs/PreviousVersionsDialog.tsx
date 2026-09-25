/**
 * File ▸ Previous Versions…: the files a save wrote over, as the browser kept them
 * (`services/previousVersions.ts`). Open puts one in its own tab with no file handle, so
 * Save asks where to write it; Save As writes the bytes out as they are; Discard forgets it.
 * The desktop app keeps a `.bak` beside the file instead, so this is usually empty there.
 */
import { useEffect, useState } from "react";
import { useSetAtom, useStore } from "jotai";
import { Download, FolderOpen, History, Trash2 } from "lucide-react";
import { closeDialogAtom, pushToastAtom } from "../../atoms/uiAtoms";
import { formatBytes } from "../../editor/save";
import { isDesktop } from "../../editor/platform";
import { openFileInto } from "../../hooks/useMapFileActions";
import { saveBytes } from "../../services/mapIo";
import { KEEP_PER_FILE, listPrevious, loadPrevious, removePrevious, type PreviousEntry } from "../../services/previousVersions";
import { t } from "../../i18n";
import { Button } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

function when(at: number): string {
  try {
    return new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return new Date(at).toLocaleString();
  }
}

/** `map.scx` → `map (previous).scx`. */
export function previousName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? `${fileName.slice(0, dot)} (previous)${fileName.slice(dot)}` : `${fileName} (previous)`;
}

export function PreviousVersionsDialog({ entry }: DialogProps) {
  const store = useStore();
  const close = useSetAtom(closeDialogAtom);
  const [entries, setEntries] = useState<PreviousEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void listPrevious().then((e) => { if (live) setEntries(e); });
    return () => { live = false; };
  }, []);

  const withVersion = async (key: string, run: (bytes: Uint8Array, fileName: string) => Promise<void>) => {
    setBusy(true);
    try {
      const v = await loadPrevious(key);
      if (!v) {
        store.set(pushToastAtom, { kind: "warn", title: t("That version is gone"), detail: t("It was discarded in another window.") });
        setEntries((e) => (e ?? []).filter((x) => x.key !== key));
        return;
      }
      await run(v.bytes, v.fileName);
    } finally {
      setBusy(false);
    }
  };
  const open = (key: string) => withVersion(key, async (bytes, fileName) => {
    // No handle, and a name of its own: the version is not the file on disk any more, so Save
    // asks where it goes and does not suggest writing over the file it came from.
    if (await openFileInto(store, new File([bytes as unknown as BlobPart], previousName(fileName)), null, "new")) close(entry.key);
  });
  const saveAs = (key: string) => withVersion(key, async (bytes, fileName) => {
    const out = await saveBytes(bytes, fileName, null);
    if (out) store.set(pushToastAtom, { kind: "ok", title: t("Saved"), detail: `${out.fileName} (${formatBytes(bytes.length)})` });
  });
  const discard = async (key: string) => {
    await removePrevious(key);
    setEntries((e) => (e ?? []).filter((x) => x.key !== key));
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Previous Versions")}
      icon={<History size={14} />}
      size="md"
      footer={<Button onClick={() => close(entry.key)}>{t("Close")}</Button>}
    >
      <p>
        {entries === null ? t("Looking for previous versions…")
          : entries.length === 0 ? (isDesktop() ? t("None kept here. The desktop app keeps the file a save replaces as a .bak beside it.") : t("None kept yet. Each time a save writes over a file, the version it replaced is kept here."))
          : t("The files your saves wrote over, as they were just before. The last {n} of each file name are kept.", { n: KEEP_PER_FILE })}
      </p>
      {entries !== null && entries.length > 0 && (
        <div className="listbox recovery-list">
          {entries.map((e) => (
            <div key={e.key} className="item recovery-item">
              <div className="grow col" style={{ gap: 1, minWidth: 0 }}>
                <strong className="ellipsis">{e.fileName}</strong>
                <span className="dim">{t("Replaced {when}", { when: when(e.at) })} · {formatBytes(e.size)}</span>
              </div>
              <Button size="sm" variant="primary" disabled={busy} onClick={() => { void open(e.key); }}><FolderOpen size={11} /> {" "}{t("Open")}</Button>
              <Button size="sm" disabled={busy} onClick={() => { void saveAs(e.key); }}><Download size={11} /> {" "}{t("Save As…")}</Button>
              <Button size="sm" icon variant="ghost" disabled={busy} title={t("Discard this version")} aria-label={t("Discard this version")} onClick={() => { void discard(e.key); }}>
                <Trash2 size={11} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {entries !== null && entries.length > 0 && (
        <p className="hint">{t("Open puts the version in its own tab, with “(previous)” added to its name; Save then asks where to write it. Save As writes the version out unchanged.")}</p>
      )}
    </DialogFrame>
  );
}
