import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { mapTilesetAtom, screenAtom, viewFlagsAtom } from "../atoms/editorAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";

/**
 * Put the persisted preferences into the session atoms once at startup: the splash (skip
 * it), the animation flags, and the tileset the startup map (and the preload) use. Runs
 * before `useDevDeepLinks` in App, so a `?tileset=` / `?nosplash` link still wins.
 */
export function useApplyPreferences() {
  const store = useStore();
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    applied.current = true;
    const prefs = store.get(preferencesAtom);
    if (!prefs.splash) store.set(screenAtom, "editor");
    store.set(viewFlagsAtom, { ...store.get(viewFlagsAtom), animateWater: prefs.animateWater, animateUnits: prefs.animateUnits });
    store.set(mapTilesetAtom, prefs.newMap.tileset);
  }, [store]);
}
