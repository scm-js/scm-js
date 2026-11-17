import { useEffect, useRef } from "react";
import { useStore } from "jotai";
import { brushSizeAtom, mapTilesetAtom, screenAtom, unitOwnerAtom } from "../atoms/editorAtoms";
import { interfaceSizeAtom, keepNoticesAtom, localeAtom, preferencesAtom } from "../atoms/preferencesAtoms";
import { toastLimitAtom } from "../atoms/uiAtoms";
import { applyInterfaceSize } from "../app/interfaceSize";
import { toastLimit } from "../app/view";
import { setLocale } from "../i18n";

/**
 * Put the persisted preferences into the session atoms once at startup: the splash (skip
 * it), the palettes' owner and brush size, and the tileset the startup map (and the
 * preload) use. (The View menu's remembered ticks are their own stored atom,
 * `viewMemoryAtom`, and need nothing here.) Runs
 * before `useDevDeepLinks` in App, so a `?tileset=` / `?nosplash` link still wins.
 * The language is applied here too, and again whenever the preference changes — it
 * lives outside the atoms (`i18n/index.ts`), since `t()` is called from code with no
 * store, and the document's `lang` follows it so fonts and hyphenation pick the right
 * rules. The interface size likewise: `index.html` puts the stored one on the page before
 * the first paint, and this keeps it on the preference from then on (OK / Apply, a reset, an
 * import). How many notices may be up at once follows Keep notices until I close them
 * the same way (`toastLimitAtom`).
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
    const applySize = () => { if (typeof document !== "undefined") applyInterfaceSize(store.get(interfaceSizeAtom)); };
    applySize();
    // Kept notices pile up instead of pushing the oldest out, which would leave unseen.
    const applyNotices = () => store.set(toastLimitAtom, toastLimit(store.get(keepNoticesAtom)));
    applyNotices();
    const stopLanguage = store.sub(localeAtom, applyLanguage);
    const stopSize = store.sub(interfaceSizeAtom, applySize);
    const stopNotices = store.sub(keepNoticesAtom, applyNotices);
    const unsubscribe = () => { stopLanguage(); stopSize(); stopNotices(); };
    if (applied.current) return unsubscribe;
    applied.current = true;
    const prefs = store.get(preferencesAtom);
    if (!prefs.splash) store.set(screenAtom, "editor");
    store.set(mapTilesetAtom, prefs.newMap.tileset);
    store.set(unitOwnerAtom, prefs.placement.owner);
    store.set(brushSizeAtom, prefs.placement.brushSize);
    return unsubscribe;
  }, [store]);
}
