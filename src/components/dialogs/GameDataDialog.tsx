import { useEffect, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { FolderOpen, Globe, HardDrive, Search, Trash2 } from "lucide-react";
import { gameDataRevisionAtom, gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import { closeDialogAtom } from "../../atoms/uiAtoms";
import { retryTilesetParts } from "../../formats/tileset/load";
import { retryFailedParts } from "../../formats/units/load";
import { desktopBridge, type DesktopLocateResult } from "../../gamedata/desktop";
import { ARCHIVE_NAMES, installFromFiles, pickArchives, type InstallProgress } from "../../gamedata/install";
import {
  adoptGameDataUrl, adoptStoredCopy, BUILD_GAME_DATA_URL, resetAssetSource, resolveAssetSource, type AssetSource,
} from "../../gamedata/source";
import { clearStoredCopy } from "../../gamedata/store";
import { Button, Group, TextInput } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";

/**
 * Help ▸ Game Data…: where the graphics come from, and the three ways to get them when
 * this build has none — the two archives (or the StarCraft folder) picked here, the
 * desktop app's search of the disk, or a web address serving either the extracted files
 * or the archives. Opens on its own after the splash when the preload found nothing
 * (`payload.auto`).
 */

interface Busy {
  fraction: number;
  label: string;
}

/** What the dialog says under the current source. */
function explain(source: AssetSource | null): string {
  if (!source) return "Still looking.";
  switch (source.kind) {
    case "bundled": return source.desktop ? "Extracted into the app's data folder. Remove the copy to extract from somewhere else." : "The graphics ship with this build; nothing to do.";
    case "stored": return "Terrain and units draw from this copy. Remove it to install from somewhere else.";
    case "remote": return "Files are fetched from this address as the editor needs them.";
    case "none": return "The editor is running without graphics: flat terrain colours and marker units.";
  }
}

export function GameDataDialog({ entry }: DialogProps) {
  const close = useSetAtom(closeDialogAtom);
  const [source, setSource] = useAtom(gameDataSourceAtom);
  const bump = useSetAtom(gameDataRevisionAtom);
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const revision = useAtomValue(gameDataRevisionAtom);
  const [busy, setBusy] = useState<Busy | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [url, setUrl] = useState(prefs.gameDataUrl || BUILD_GAME_DATA_URL);
  const [searchDirs, setSearchDirs] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const desktop = desktopBridge();
  const auto = entry.payload?.auto === true;

  useEffect(() => {
    if (!desktop) return;
    desktop.gameData.searchDirs().then(setSearchDirs, () => {});
  }, [desktop]);

  const progress: InstallProgress = (fraction, label) => setBusy({ fraction, label });

  /** A new source is in place: repaint everything that gave up on the old one. */
  const adopted = (next: AssetSource, text: string) => {
    retryFailedParts();
    retryTilesetParts();
    setSource(next);
    bump((n) => n + 1);
    setMessage({ text });
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

  const fromFiles = (files: File[]) => run(async () => {
    pickArchives(files); // throws early, before the bytes are read
    const copy = await installFromFiles(files, progress);
    adopted(adoptStoredCopy(copy), `Installed: ${copy.summary}.${copy.where === "memory" ? " This browser keeps no site data, so the copy lasts until the tab closes." : ""}`);
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

  const fromUrl = () => run(async () => {
    const trimmed = url.trim();
    if (!trimmed) throw new Error("Enter an address first.");
    const next = await adoptGameDataUrl(trimmed, progress);
    if (!next) throw new Error(`Nothing at ${trimmed}.`);
    setPrefs({ ...prefs, gameDataUrl: trimmed === BUILD_GAME_DATA_URL ? "" : trimmed });
    adopted(next, next.kind === "remote" ? `Using the files at ${next.base}.` : `Installed: ${next.stored?.summary ?? "done"}.`);
  });

  const desktopResult = (found: DesktopLocateResult | null) => {
    if (!found) return;
    if (found.status === "ready") {
      resetAssetSource();
      return resolveAssetSource().then((next) => adopted(next, `Extracted from ${found.from}.`));
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

  const removable = source?.kind === "stored" || source?.desktop === true;

  return (
    <DialogFrame
      dialogKey={entry.key}
      title="Game Data"
      icon={<HardDrive size={14} />}
      size="lg"
      footer={<Button variant="primary" onClick={() => close(entry.key)}>Close</Button>}
    >
      <div className="stack">
        <p className="hint">
          {auto
            ? "No game data was found. The editor works without it, but terrain shows as flat colours and units as markers until it has StarCraft's graphics."
            : "The editor draws terrain and units with graphics from StarCraft's own archives. Blizzard's data cannot ship with it, so it comes from one of the places below."}
        </p>

        <Group title="Now">
          <div className="row" style={{ alignItems: "baseline" }}>
            <span className="grow">{source?.label ?? "Locating…"}</span>
            {removable && <Button size="sm" variant="danger" disabled={!!busy} onClick={remove}><Trash2 size={11} /> Remove copy</Button>}
          </div>
          <p className="hint" style={{ marginTop: 4 }}>{explain(source)}</p>
          {source?.kind === "none" && source.tried.length > 0 && (
            <ul className="hint" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {source.tried.map((t) => <li key={t}>{t}</li>)}
            </ul>
          )}
          {revision > 0 && source?.kind !== "none" && <p className="hint" style={{ marginTop: 4 }}>Open maps pick the graphics up as they arrive.</p>}
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

        <Group title="From your StarCraft installation">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {desktop && <Button size="sm" disabled={!!busy} onClick={desktopSearch}><Search size={11} /> Search this computer</Button>}
            {desktop && <Button size="sm" disabled={!!busy} onClick={desktopFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
            {!desktop && <Button size="sm" disabled={!!busy} onClick={() => fileInput.current?.click()}><FolderOpen size={11} /> Choose StarDat.mpq and BrooDat.mpq…</Button>}
            {!desktop && <Button size="sm" disabled={!!busy} onClick={chooseFolder}><FolderOpen size={11} /> Choose the StarCraft folder…</Button>}
          </div>
          <input ref={fileInput} type="file" accept=".mpq" multiple hidden onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
          <input ref={folderInput} type="file" hidden {...({ webkitdirectory: "" } as object)} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) void fromFiles(f); }} />
          <p className="hint" style={{ marginTop: 4 }}>
            A classic (1.16) installation keeps <span className="mono">StarDat.mpq</span> and <span className="mono">BrooDat.mpq</span> in the game folder. Remastered installs do not have them, so use an address below or copy the two files from a classic install.
            {desktop ? " The search also looks next to the app, so the two files dropped beside it are found." : " The extraction runs here, in the browser, and the result is kept for next time."}
          </p>
          {desktop && searchDirs.length > 0 && (
            <details className="hint" style={{ marginTop: 4 }}>
              <summary>Where the search looks</summary>
              <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{searchDirs.map((d) => <li key={d} className="mono">{d}</li>)}</ul>
            </details>
          )}
        </Group>

        <Group title="From a web address">
          <div className="row" style={{ gap: 6 }}>
            <TextInput className="grow mono" value={url} placeholder="https://…" spellCheck={false} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void fromUrl(); }} />
            <Button size="sm" disabled={!!busy || !url.trim()} onClick={fromUrl}><Globe size={11} /> Use</Button>
          </div>
          <p className="hint" style={{ marginTop: 4 }}>
            An address serving either the extracted files (with <span className="mono">tileset/manifest.json</span> at the top) or the two archives. The server has to allow cross-origin requests. The address is remembered in Preferences.
            {BUILD_GAME_DATA_URL && url.trim() !== BUILD_GAME_DATA_URL ? ` This build's default is ${BUILD_GAME_DATA_URL}.` : ""}
          </p>
        </Group>
      </div>
    </DialogFrame>
  );
}
