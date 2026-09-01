import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { scenarioAtom } from "../atoms/documentAtoms";
import { mapTilesetAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { DEFAULT_NEW_MAP, useMapFileActions } from "./useMapFileActions";

/**
 * StarEdit opens on a blank Badlands map rather than an empty window, and so does this.
 * Runs once, and steps aside if something already opened a map — a dropped file that
 * beat it, or the `?tileset=` deep link picking the tileset to start on. Size and tileset
 * come from Preferences (`useApplyPreferences` has already put the tileset in
 * `mapTilesetAtom`, unless a deep link chose one).
 */
export function useStartupMap() {
  const store = useStore();
  const { newMap } = useMapFileActions();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || store.get(scenarioAtom)) return;
    started.current = true;
    const prefs = store.get(preferencesAtom).newMap;
    void newMap({ ...DEFAULT_NEW_MAP, width: prefs.width, height: prefs.height, tileset: store.get(mapTilesetAtom) }, true);
  }, [newMap, store]);
}
