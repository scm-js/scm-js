import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Download, FolderOpen, HardDrive, Search, Trash2 } from "lucide-react";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { closeDialogAtom, pushToastAtom } from "../../atoms/uiAtoms";
import { retryTilesetParts } from "../../formats/tileset/load";
import { retryFailedParts } from "../../formats/units/load";
import { desktopBridge, type DesktopLocateResult } from "../../gamedata/desktop";
import {
  ARCHIVE_NAMES, BLIZZARD_ZIP_URL, installFromFiles, installFromZipUrl, pickArchives, type InstallProgress,
} from "../../gamedata/install";
import { adoptStoredCopy, resetAssetSource, resolveAssetSource, type AssetSource } from "../../gamedata/source";
import { clearStoredCopy } from "../../gamedata/store";
import { Button, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/**
 * Help ▸ Game Data…: where the graphics come from, and — only when there are none — the
 * two ways to get them.
 *
 * The dialog used to list every route the editor knows at all times: pick the archives,
 * pick a folder, search the disk, or type a web address, whether or not any of it was
 * needed. It shows one thing at a time now. With data in place it is a status line and a
 * way to remove the copy; without, it is the download and the file picker, in that order,
 * because the download is the one that works for someone who has never owned a copy of
 * the 1.16 game. The desktop's search of the disk sits with them, since a user who has
 * just installed StarCraft wants it re-run rather than a fresh download.
 *
 * It opens on its own after the splash when the preload found nothing (`payload.auto`), and
 * in that case closes itself once something has been installed — the whole of it is then a
 * prompt, a button, a progress bar, and the editor drawing real terrain behind it.
 */

interface Busy {
  fraction: number;
  label: string;
}

/** What the dialog says under the current source. */
function explain(source: AssetSource | null): string {
  if (!source) return "Still looking.";
  switch (source.kind) {
    case "bundled": return source.desktop ? "Extracted into the app's data folder from your StarCraft installation." : "The graphics ship with this build.";
    case "stored": return "Terrain and units draw from this copy, and it is here next time.";
    case "none": return "The editor is running without graphics: flat terrain colours and marker units.";
  }
}

export function GameDataDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const toast = useSetAtom(pushToastAtom);
  const [source, setSource] = useAtom(gameDataSourceAtom);
  const bump = useSetAtom(gameDataRevisionAtom);
  const revision = useAtomValue(gameDataRevisionAtom);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [searchDirs, setSearchDirs] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  /** The handle of the "it opened itself, now it can go" timer, so unmounting cancels it. */
  const leaving = useRef<number | null>(null);
  const desktop = desktopBridge();
  const auto = entry.payload?.auto === true;
  const have = source !== null && source.kind !== "none";

  const [desktopCopy, setDesktopCopy] = useState<DesktopLocateResult | null>(null);
  useEffect(() => {
    if (!desktop) return;
    desktop.gameData.searchDirs().then(setSearchDirs, () => {});
    // What the app already holds, read off its stamp — no search, no extraction.
    desktop.gameData.status().then(setDesktopCopy, () => {});
  }, [desktop, source]);

  const progress: InstallProgress = (fraction, label) => setBusy({ fraction, label });

  /** A new source is in place: repaint everything that gave up on the old one. */
  const adopted = (next: AssetSource, text: string) => {
    retryFailedParts();
    retryTilesetParts();
    setSource(next);
    bump((n) => n + 1);
    setMessage({ text });
    toast({ kind: "ok", title: "Game data ready", detail: text });
    // The dialog that opened itself because there was nothing has nothing left to say once
    // there is: it closes and leaves the editor, now drawing real terrain, in front. Long
    // enough that the finished bar and the message are seen rather than flashing past; the
    // toast repeats it for anyone who looked away. A dialog the user opened themselves is
    // theirs to close.
    if (auto && next.kind !== "none") leaving.current = window.setTimeout(() => close(entry.key), 900);
  };

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setMessage(null);
    setBusy({ fraction: 0, label: "Starting" });
    try {
      await work();
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : String(err), error: true });
    } finally {
      setBusy(null);
    }
  };

  const installed = (copy: Awaited<ReturnType<typeof installFromFiles>>, from: string) =>
    adopted(adoptStoredCopy(copy), `Installed ${copy.summary} from ${from}.${copy.where === "memory" ? " This browser keeps no site data, so the copy lasts until the tab closes." : ""}`);

  const fromBlizzard = () => run(async () => {
    installed(await installFromZipUrl(BLIZZARD_ZIP_URL, progress), "Blizzard's StarEdit download");
  });

  const fromFiles = (files: File[]) => run(async () => {
    pickArchives(files); // throws early, before the bytes are read
    installed(await installFromFiles(files, progress), files.length === 1 ? files[0].name : "the archives you picked");
  });

  const chooseFolder = async () => {
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    if (!picker) {
      folderInput.current?.click();
      return;
    }
    let dir: FileSystemDirectoryHandle;
    try {
      dir = await picker();
    } catch {
      return; // dismissed
    }
    const files: File[] = [];
    for (const name of ARCHIVE_NAMES) {
      for (const variant of [name, name.toLowerCase(), name.toUpperCase()]) {
        try {
          files.push(await (await dir.getFileHandle(variant)).getFile());
          break;
        } catch {
          // not under this spelling
        }
      }
    }
    void fromFiles(files);
  };

  const desktopResult = (found: DesktopLocateResult | null) => {
    if (!found) return;
    if (found.status === "ready") {
      resetAssetSource();
      const problems = found.problems?.length ? ` ${found.problems.length} archive${found.problems.length === 1 ? "" : "s"} could not be opened: ${found.problems.join("; ")}` : "";
      return resolveAssetSource().then((next) => adopted(next, `Extracted from ${found.from}.${problems}`));
    }
    throw new Error(found.status === "missing" ? `No StarCraft archives in the ${found.searched.length} places searched.` : found.message);
  };
  const desktopSearch = () => run(async () => desktopResult(await desktop!.gameData.locate()));
  const desktopFolder = () => run(async () => desktopResult(await desktop!.gameData.pickFolder()));

  const remove = () => run(async () => {
    await clearStoredCopy();
    if (desktop) await desktop.gameData.clear();
    resetAssetSource();
    const next = await resolveAssetSource(undefined, { search: false });
    setSource(next);
    bump((n) => n + 1);
    setMessage({ text: "Removed. " + explain(next) });
  });

  useEffect(() => {
    if (!desktop) return;
    return desktop.gameData.onProgress((fraction, label) => setBusy((b) => (b ? { fraction, label } : b)));
  }, [desktop]);

  useEffect(() => () => { if (leaving.current) window.clearTimeout(leaving.current); }, []);

  const removable = source?.kind === "stored" || source?.desktop === true;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Game Data"
      icon={<HardDrive size={14} />}
      size={have ? "md" : "lg"}
      footer={<Button variant="primary" onClick={() => close(entry.key)}>Close</Button>}
    >
      <div className="stack">
        <Group title="Now">
          <div className="row" style={{ alignItems: "baseline" }}>
            <span className="grow">{source?.label ?? "Locating…"}</span>
            {removable && <Button size="sm" variant="danger" disabled={!!busy} onClick={remove}><Trash2 size={11} /> Remove copy</Button>}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{explain(source)}</p>
          {revision > 0 && have && <p className="hint" style={{ marginTop: 4 }}>Open maps pick the graphics up as they arrive.</p>}
        </Group>

        {busy && (
          <div className="col" style={{ gap: 4 }}>
            <div className="row between"><span>{busy.label}</span><span className="dim mono">{Math.round(busy.fraction * 100)}%</span></div>
            <div style={{ position: "relative", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--bg-0)", border: "1px solid var(--border)" }}>
              <div style={{ height: "100%", width: `${(busy.fraction * 100).toFixed(1)}%`, background: "var(--gold)", transition: "width 90ms linear" }} />
            </div>
          </div>
        )}
        {message && <p className={message.error ? "hint error" : "hint"} style={{ color: message.error ? "var(--danger, #e66)" : undefined }}>{message.text}</p>}

        {!have && (
          <>
            <p className="hint">
              {auto
                ? "The editor works without StarCraft's graphics, but terrain shows as flat colours and units as markers. There are two ways to give it them."
                : "The editor draws terrain and units with graphics from StarCraft's own archives. Blizzard's data cannot ship with it, so it comes from one of these."}
            </p>

            <Group title="Download from Blizzard">
              <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <Button size="sm" variant="primary" disabled={!!busy} onClick={fromBlizzard}><Download size={11} /> Download the graphics</Button>
                <span className="hint">About 82 MB.</span>
              </div>
              <p className="hint" style={{ marginTop: 4 }}>
                Blizzard offers the StarCraft map editor as a free download, and it carries the two archives the graphics come from.
                Nothing is asked of you and no account is needed. The files are extracted here and kept in this browser, so this happens once.
              </p>
            </Group>

            <Group title="Use your own StarCraft files">
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {desktop && <Button size="sm" disabled={!!busy} onClick={desktopSearch}><Search size={11} /> Search this computer</Button>}
                {desktop && <Button size="sm" disabled={!!busy} onClick={desktopFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
                {!desktop && <Button size="sm" disabled={!!busy} onClick={() => fileInput.current?.click()}><FolderOpen size={11} /> Choose StarDat.mpq and BrooDat.mpq…</Button>}
                {!desktop && <Button size="sm" disabled={!!busy} onClick={chooseFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
              </div>
              <input ref={fileInput} type="file" accept=".mpq" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
              <input ref={folderInput} type="file" hidden {...({ webkitdirectory: "" } as object)} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
              <p className="hint" style={{ marginTop: 4 }}>
                A classic (1.16) installation keeps <span className="mono">StarDat.mpq</span> and <span className="mono">BrooDat.mpq</span> in the game folder.
                Remastered installs do not have them, so download above instead.
                {desktop ? " The search also looks next to the app, so the two files dropped beside it are found." : ""}
              </p>
              {desktop && desktopCopy?.status === "ready" && (
                <p className="hint" style={{ marginTop: 4 }}>App copy: {desktopCopy.files} files from {desktopCopy.from}, {new Date(desktopCopy.at).toLocaleDateString()}</p>
              )}
              {desktop && searchDirs.length > 0 && (
                <details className="hint" style={{ marginTop: 4 }}>
                  <summary>Where the search looks</summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{searchDirs.map((d) => <li key={d} className="mono">{d}</li>)}</ul>
                </details>
              )}
            </Group>

            {source?.kind === "none" && source.tried.length > 0 && (
              <details className="hint">
                <summary>What was tried</summary>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{source.tried.map((t) => <li key={t}>{t}</li>)}</ul>
              </details>
            )}
          </>
        )}
      </div>
    </DialogFrame>
  );
}
