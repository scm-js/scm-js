import { useSyncExternalStore } from "react";
import { locale, onLocaleChange, t, tc } from "./index";

/**
 * The current locale, re-rendering the component when it changes. `App` keys its tree
 * on it, so everything below is remounted in the new language and a component can call
 * the module's `t` without subscribing itself.
 */
export function useLocale() {
  return useSyncExternalStore(onLocaleChange, locale, locale);
}

/** `t` for a component that re-renders on its own when the language changes (a tree not under `App`'s key). */
export function useT(): typeof t {
  useLocale();
  return t;
}

export function useTc(): typeof tc {
  useLocale();
  return tc;
}
