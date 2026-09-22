/**
 * Where Test Map writes, shared by Tools ▸ Test Map and Preferences ▸ Testing. The desktop
 * build keeps a folder path in the preferences (`""` = search the usual places); a browser
 * keeps a directory handle in IndexedDB (`services/testMap.ts`), which is why the two rows
 * differ: one edits a string the caller owns, the other a stored handle of its own.
 */
import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw } from "lucide-react";
import { desktopBridge, type DesktopGameInfo } from "../../gamedata/desktop";
import { canPickTestFolder, forgetTestFolder, pickTestFolder, storedTestFolder, type TestFolderHandle } from "../../services/testMap";
import { t } from "../../i18n";
import { Button } from "../ui";

/** What the desktop build knows about the game for `dir` (`""` = searched), refetched when it changes. */
export function useGameInfo(dir: string): { info: DesktopGameInfo | null; refresh: () => void } {
  const bridge = desktopBridge();
  const [info, setInfo] = useState<DesktopGameInfo | null>(null);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!bridge) return;
    let live = true;
    setInfo(null);
    void bridge.game.info(dir || undefined).then((i) => { if (live) setInfo(i); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dir, run]);
  return { info, refresh: () => setRun((n) => n + 1) };
}

/** The browser's stored test folder: `undefined` while loading, `null` when none is chosen. */
export function useTestFolder(): [TestFolderHandle | null | undefined, (h: TestFolderHandle | null) => void] {
  const [folder, setFolder] = useState<TestFolderHandle | null | undefined>(undefined);
  useEffect(() => { void storedTestFolder().then(setFolder); }, []);
  return [folder, setFolder];
}

/** Desktop: the game folder in use, with Choose… and, once one is chosen, the way back to searching. */
export function GameFolderRow({ dir, info, onDir, onRefresh }: { dir: string; info: DesktopGameInfo | null; onDir: (dir: string) => void; onRefresh: () => void }) {
  const bridge = desktopBridge();
  const choose = async () => {
    const chosen = await bridge?.game.pickFolder();
    if (chosen) onDir(chosen);
  };
  return (
    <div className="row">
      <span className="mono" style={{ wordBreak: "break-all" }}>{info === null ? t("Looking…") : info.installDir ?? t("Not found")}</span>
      <Button size="sm" onClick={onRefresh} title={t("Search the usual places again")}><RefreshCw size={12} /></Button>
      <Button size="sm" onClick={() => { void choose(); }}><FolderOpen size={12} /> {" "}{t("Choose…")}</Button>
      {dir && <Button size="sm" onClick={() => onDir("")}>{t("Forget")}</Button>}
    </div>
  );
}

/** Browser: the chosen Maps folder by name, with Choose… and Forget; the choice is stored at once. */
export function TestFolderRow({ folder, onFolder, onProblem }: { folder: TestFolderHandle | null | undefined; onFolder: (h: TestFolderHandle | null) => void; onProblem?: (message: string) => void }) {
  if (!canPickTestFolder()) return <span className="hint">{t("This browser has no folder picker, so Test Map downloads the map.")}</span>;
  const choose = async () => {
    try {
      const h = await pickTestFolder();
      if (h) onFolder(h);
    } catch (err) {
      onProblem?.(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <div className="row">
      <span className="mono">{folder === undefined ? "…" : folder ? folder.name : t("none chosen")}</span>
      <Button size="sm" onClick={() => { void choose(); }}><FolderOpen size={12} /> {" "}{t("Choose…")}</Button>
      {folder && <Button size="sm" onClick={() => { void forgetTestFolder().then(() => onFolder(null)); }}>{t("Forget")}</Button>}
    </div>
  );
}
