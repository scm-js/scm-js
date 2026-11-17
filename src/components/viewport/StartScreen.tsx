import { useEffect } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { FilePlus2, FolderOpen, Upload } from "lucide-react";
import { recentFilesAtom, scenarioAtom, type RecentEntry } from "../../atoms/documentAtoms";
import { pluginFileTypesAtom } from "../../atoms/pluginAtoms";
import { preloadStepAtom } from "../../atoms/preloadAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { isOnSite } from "../../app/platform";
import { useMapFileActions } from "../../hooks/useMapFileActions";
import { clearRecents } from "../../services/documentActions";
import { locale, t } from "../../i18n";
import { opensFolders, opensReplays, pickerFileTypes } from "../../plugins/fileTypes";
import { pickMapFile } from "../../services/mapIo";
import { SITE_PAGES } from "../../site";
import { Button } from "../ui";

/**
 * A map has been open since the page loaded. Kept outside the component because `App`
 * mounts everything again on a language change and after the crash screen's Try again.
 */
let mapSeen = false;

/**
 * What the map's area shows while no map is open (after File ▸ Close Map on the last one):
 * where to drop a file, the ways to start, and the recent files. It is there only while
 * `scenarioAtom` is null, so it never covers a map, and not before the editor has started
 * — a map has been open, or the preload is done, whose last step waits for the startup
 * map — so a start does not flash it.
 *
 * Nothing here opens anything itself. A drop is the window's (`App.tsx#openDropped`, which
 * also lights the zone through `.app.drop-target`); New is File ▸ New's dialog; Open is the
 * picker File ▸ Open's Browse uses, through the same `guard`; a recent file is
 * `openRecent`, as in File ▸ Open Recent.
 */
export default function StartScreen() {
  const open = useAtomValue(scenarioAtom) !== null;
  const preloaded = useAtomValue(preloadStepAtom).done;
  useEffect(() => { if (open) mapSeen = true; }, [open]);
  if (open || !(mapSeen || preloaded)) return null;
  return <Start />;
}

function Start() {
  const store = useStore();
  const openDialog = useSetAtom(openDialogAtom);
  const recents = useAtomValue(recentFilesAtom);
  const types = useAtomValue(pluginFileTypesAtom);
  const { guard, openRecent } = useMapFileActions();
  const site = isOnSite();
  // What a drop takes besides a map depends on the plugins running: a replay where one opens replays, a folder where one opens folders.
  const replays = opensReplays(types);
  const folders = opensFolders(types);

  const browse = () => {
    void pickMapFile(pickerFileTypes(store)).then((picked) => { if (picked) guard({ action: "open", file: picked.file, handle: picked.handle }); });
  };
  // A file the browser kept no handle for cannot be read again without being picked: its row is a reminder that leads to the picker.
  const reopen = (r: RecentEntry) => { if (r.handleKey) void openRecent(r); else browse(); };

  return (
    <div className="start-screen">
      <div className="start-body">
        <section className="dropzone start-drop" aria-labelledby="start-drop-title">
          <Upload size={22} aria-hidden />
          <h2 id="start-drop-title">{t("Drop a map to edit it")}</h2>
          <p>
            {folders ? t("A .scm, .scx or .chk file, or a mod's folder.") : t("A .scm, .scx or .chk file.")}
            {replays && <>{" "}{site ? t("A replay dropped here opens in Replays, as a tab beside your maps.") : t("A replay dropped here opens as a tab beside your maps.")}</>}
          </p>
          <div className="start-actions">
            <Button variant="primary" onClick={() => openDialog("newMap")}><FilePlus2 size={13} aria-hidden /> {t("New map…")}</Button>
            <Button onClick={browse}><FolderOpen size={13} aria-hidden /> {t("Open a file…")}</Button>
            {site && <a className="btn" href={SITE_PAGES.library}>{t("From your library")}</a>}
          </div>
        </section>
        <section className="start-recent" aria-labelledby="start-recent-title">
          <h3 id="start-recent-title">{t("Recent")}</h3>
          {recents.length === 0 ? (
            <p className="hint">{t("Nothing opened yet.")}</p>
          ) : (
            <>
              <ul>
                {recents.map((r) => (
                  <li key={r.name}>
                    <button
                      type="button"
                      className={r.handleKey ? "" : "no-handle"}
                      title={r.handleKey ? t("Open {name}", { name: r.name }) : t("{name} cannot be reopened from here — browse for it.", { name: r.name })}
                      onClick={() => reopen(r)}
                    >
                      <FolderOpen size={12} aria-hidden />
                      <span className="start-recent-name">{r.name}</span>
                      <span className="start-recent-when">{r.handleKey ? when(r.at) : t("browse for it")}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" onClick={() => clearRecents(store)}>{t("Clear Recent")}</Button>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/** A recent file's day, short: "Nov 9", with the year once it is not this one. */
function when(at: number): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(locale(), sameYear ? { month: "short", day: "numeric" } : { year: "numeric", month: "short", day: "numeric" });
}
