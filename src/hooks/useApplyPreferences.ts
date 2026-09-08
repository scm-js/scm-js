import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { mapTilesetAtom, screenAtom, viewFlagsAtom } from "../atoms/editorAtoms";
import { localeAtom, preferencesAtom } from "../atoms/preferencesAtoms";
import { setLocale } from "../i18n";

/**
 * Put the persisted preferences into the session atoms once at startup: the splash (skip
 * it), the animation flags, and the tileset the startup map (and the preload) use. Runs
 * before `useDevDeepLinks` in App, so a `?tileset=` / `?nosplash` link still wins.
 * The language is applied here too, and again whenever the preference changes — it
 * lives outside the atoms (`i18n/index.ts`), since `t()` is called from code with no
 * store, and the document's `lang` follows it so fonts and hyphenation pick the right
 * rules.
 */
export function useApplyPreferences() {
  const store = useStore();
  const applied = useRef(false);
  useEffect(() => {
    const applyLanguage = () => {
      const loc = store.get(localeAtom);
      setLocale(loc);
      if (typeof document !== "undefined") document.documentElement.lang = loc;
    };
    applyLanguage();
    const unsubscribe = store.sub(localeAtom, applyLanguage);
    if (applied.current) return unsubscribe;
    applied.current = true;
    const prefs = store.get(preferencesAtom);
    if (!prefs.splash) store.set(screenAtom, "editor");
    store.set(viewFlagsAtom, { ...store.get(viewFlagsAtom), animateWater: prefs.animateWater, animateUnits: prefs.animateUnits });
    store.set(mapTilesetAtom, prefs.newMap.tileset);
    return unsubscribe;
  }, [store]);
}
