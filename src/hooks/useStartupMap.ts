import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { recentFilesAtom, scenarioAtom, type RecentEntry } from "../atoms/documentAtoms";
import { mapTilesetAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { pushToastAtom } from "../atoms/uiAtoms";
import { isDesktop } from "../editor/platform";
import { t } from "../i18n";
import { loadHandle, type StoredHandle } from "../services/handleStore";
import { DEFAULT_NEW_MAP, openRecentInto, useMapFileActions } from "./useMapFileActions";

/**
 * StarEdit opens on a blank Badlands map rather than an empty window, and so does this.
 * Runs once, and steps aside if something already opened a map — a dropped file that
 * beat it, or the `?tileset=` deep link picking the tileset to start on. Size and tileset
 * come from Preferences (`useApplyPreferences` has already put the tileset in
 * `mapTilesetAtom`, unless a deep link chose one).
 *
 * With `Preferences.startup.reopenLast` the most recent file comes back in place of the
 * blank map, which it replaces the way any first open does. The desktop app, and a
 * browser that still remembers the permission, open it straight away; a browser that
 * would have to ask cannot without a click, so a notice offers it instead.
 */
export function useStartupMap() {
  const store = useStore();
  const { newMap } = useMapFileActions();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || store.get(scenarioAtom)) return;
    started.current = true;
    const prefs = store.get(preferencesAtom);
    void newMap({ ...DEFAULT_NEW_MAP, width: prefs.newMap.width, height: prefs.newMap.height, tileset: store.get(mapTilesetAtom) }, true).then(() => {
      if (prefs.startup.reopenLast) void reopenLast(store, store.get(recentFilesAtom)[0]);
    });
  }, [newMap, store]);
}

type Store = ReturnType<typeof useStore>;

async function reopenLast(store: Store, last: RecentEntry | undefined) {
  if (!last?.handleKey) return;
  const handle = await loadHandle<StoredHandle>(last.handleKey);
  if (!handle) return;
  let granted = isDesktop();
  if (!granted) {
    try { granted = !handle.queryPermission || (await handle.queryPermission({ mode: "read" })) === "granted"; } catch { granted = false; }
  }
  if (granted) { void openRecentInto(store, last); return; }
  store.set(pushToastAtom, {
    kind: "info",
    ttl: 0,
    title: t("Reopen {name}?", { name: last.name }),
    detail: t("The browser asks before a file is read again, so it takes a click."),
    action: { label: t("Reopen"), run: () => { void openRecentInto(store, last); } },
  });
}
