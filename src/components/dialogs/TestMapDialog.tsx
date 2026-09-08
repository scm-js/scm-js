import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { FolderOpen, Play, RefreshCw } from "lucide-react";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { preferencesAtom } from "../../atoms/preferencesAtoms";
import { closeDialogAtom, pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { desktopBridge, type DesktopGameInfo } from "../../gamedata/desktop";
import { handleStorePersists } from "../../services/handleStore";
import { canPickTestFolder, forgetTestFolder, pickTestFolder, runTestMap, storedTestFolder, testFileName, type TestFolderHandle } from "../../services/testMap";
import { Button, Check, Field, Group } from "../ui";
import DialogFrame from "../ui/DialogFrame";
import type { DialogProps } from "./DialogHost";
import { t } from "../../i18n";

/**
 * Tools ▸ Test Map (Ctrl+F5): where the map will be written for the game, and Run. The
 * desktop build finds the game's Maps folder (or takes one the user picks) and can start
 * the game; a browser writes into a folder picked once — the game's Maps folder, ideally —
 * or downloads where it has no folder picker. `payload.run` runs at once when a destination
 * is already known, which is what the hotkey and toolbar button do.
 */
export function TestMapDialog({ entry }: DialogProps) {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const [prefs, setPrefs] = useAtom(preferencesAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const bridge = desktopBridge();
  const [info, setInfo] = useState<DesktopGameInfo | null>(null);
  const [folder, setFolder] = useState<TestFolderHandle | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const name = testFileName(store);

  const refresh = (dir?: string) => {
    if (!bridge) return;
    void bridge.game.info(dir ?? (prefs.testMap.dir || undefined)).then(setInfo);
  };
  useEffect(() => {
    if (bridge) refresh();
    else void storedTestFolder().then((h) => setFolder(h));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ready = bridge ? info?.mapsDir !== null && info !== null : folder !== null && folder !== undefined || !canPickTestFolder();

  const run = async (download = false) => {
    if (!scenario) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await runTestMap(store, { launch: prefs.testMap.launch, download });
      if (!r) { setProblem(bridge ? t("No StarCraft folder is known — choose one.") : t("Choose a folder first.")); return; }
      const where = r.route === "download" ? t("{path} downloaded — move it into the game's Maps folder", { path: r.path }) : t("Wrote {path}", { path: r.path });
      const launched = r.launched ? t(" and started StarCraft") : r.message ? ` — ${r.message}` : "";
      setStatus(`${where}${launched}`);
      toast({ kind: r.message ? "warn" : "ok", title: r.launched ? t("Map sent to StarCraft") : r.route === "download" ? t("Map downloaded") : t("Map written"), detail: t("{where}{launched}. In the game: Single Player ▸ Custom Game ▸ scmJS ▸ {name}.", { where: where ?? "", launched: launched ?? "", name: name ?? "" }) });
      return true;
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The quick path: everything known, run and close without showing the form.
  const close = entry.payload?.run === true && ready;
  useEffect(() => {
    if (!close || busy) return;
    void run().then((ok) => { if (ok) store.set(closeDialogAtom, entry.key); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [close]);

  const chooseDesktop = async () => {
    const dir = await bridge!.game.pickFolder();
    if (!dir) return;
    setPrefs({ ...prefs, testMap: { ...prefs.testMap, dir } });
    refresh(dir);
  };
  const chooseBrowser = async () => {
    try {
      const h = await pickTestFolder();
      if (h) setFolder(h);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DialogFrame
      dialogKey={entry.key}
      title={t("Test Map")}
      icon={<Play size={14} />}
      size="md"
      okLabel={bridge && prefs.testMap.launch ? t("Write and start") : t("Write")}
      okDisabled={!scenario || busy || !ready}
      onOk={() => { void run(); }}
      footerLeft={<span className="hint">{name ? <>{t("Writes")} <span className="mono">{name}</span></> : t("Open or create a map first.")}</span>}
    >
      <Group title={t("Where the game will find it")}>
        {bridge ? (
          <div className="form wide">
            <Field label={t("StarCraft")}>
              <div className="row">
                <span className="mono" style={{ wordBreak: "break-all" }}>{info === null ? t("Looking…") : info.installDir ?? t("Not found")}</span>
                <Button size="sm" onClick={() => refresh()} title={t("Search the usual places again")}><RefreshCw size={12} /></Button>
                <Button size="sm" onClick={() => { void chooseDesktop(); }}><FolderOpen size={12} /> {" "}{t("Choose…")}</Button>
              </div>
            </Field>
            <Field label={t("Maps folder")}><span className="mono" style={{ wordBreak: "break-all" }}>{info?.mapsDir ? `${info.mapsDir}\\scmJS` : "—"}</span></Field>
            <Field label={t("Executable")}><span className="mono" style={{ wordBreak: "break-all" }}>{info?.exe ?? (info ? t("not found — the map is written, the game is not started") : "—")}</span></Field>
            {prefs.testMap.dir && (
              <Field label="">
                <Button size="sm" onClick={() => { setPrefs({ ...prefs, testMap: { ...prefs.testMap, dir: "" } }); refresh(""); }}>{t("Forget the chosen folder and search")}</Button>
              </Field>
            )}
            {info && !info.mapsDir && <p className="hint">{t("Searched: {join}", { join: info.searched.join(" · ") })}</p>}
          </div>
        ) : canPickTestFolder() ? (
          <div className="form wide">
            <Field label={t("Folder")}>
              <div className="row">
                <span className="mono">{folder === undefined ? "…" : folder ? folder.name : t("none chosen")}</span>
                <Button size="sm" onClick={() => { void chooseBrowser(); }}><FolderOpen size={12} /> {" "}{t("Choose…")}</Button>
                {folder && <Button size="sm" onClick={() => { void forgetTestFolder().then(() => setFolder(null)); }}>{t("Forget")}</Button>}
              </div>
            </Field>
            <p className="hint">
              {t("Pick the game's")}{" "}<span className="mono">{t("Maps")}</span> {" "}{t("folder (the map lands in it directly; the browser asks once per session before writing there).")}
              {handleStorePersists() ? t(" The choice is remembered in this browser.") : t(" This browser cannot remember the choice between sessions.")}
              {" "}{t("A browser tab cannot start the game — switch to it and open the map under Single Player ▸ Custom Game. The desktop app does both.")}
            </p>
            <div className="row"><Button size="sm" onClick={() => { void run(true); }} disabled={!scenario || busy}>{t("Download instead")}</Button></div>
          </div>
        ) : (
          <p className="hint">{t("This browser has no folder picker, so Run downloads the map; move it into the game's")}{" "}<span className="mono">{t("Maps")}</span> {" "}{t("folder and open it under Single Player ▸ Custom Game. Chrome and Edge can write into the folder directly, and the desktop app starts the game as well.")}</p>
        )}
      </Group>
      {bridge && (
        <Group title={t("After writing")}>
          <Check label={t("Start StarCraft")} checked={prefs.testMap.launch} onChange={(e) => setPrefs({ ...prefs, testMap: { ...prefs.testMap, launch: e.target.checked } })} />
          <p className="hint" style={{ marginTop: 6 }}>{t("The game has no way to open a map from the outside, so it starts on its menu; the map is under Single Player ▸ Custom Game ▸ scmJS. A running game is not restarted.")}</p>
        </Group>
      )}
      {problem && <p className="error">{problem}</p>}
    </DialogFrame>
  );
}
