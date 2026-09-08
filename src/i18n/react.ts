import { useSyncExternalStore } from "react";
import { locale, onLocaleChange, t, tc } from "./index";

/**
 * `t` for a component: the same function, but the component re-renders when the
 * language changes. Destructure `tc` from the second value where a context is needed.
 */
export function useT(): typeof t {
  useSyncExternalStore(onLocaleChange, locale, locale);
  return t;
}

export function useTc(): typeof tc {
  useSyncExternalStore(onLocaleChange, locale, locale);
  return tc;
}
