import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { PREFERENCE_LIMITS } from "../app/preferences";
import { flushRecovery, startRecovery } from "../services/recoveryCopier";

/**
 * Keep a recovery copy of every map with unsaved changes (`Preferences.recovery`): every
 * few minutes, and when the page is hidden (another tab, the window minimised, the laptop
 * lid), each map changed since its last copy is written to IndexedDB. A copy goes as soon
 * as its map is saved or closed, and when copies are switched off. What a session leaves
 * behind is offered back at the next start (`offerRecoveryWhenClear`).
 */
export function useRecovery() {
  const store = useStore();
  const { enabled, minutes } = useAtomValue(preferencesAtom).recovery;

  useEffect(() => startRecovery(store), [store]);

  useEffect(() => {
    // Switched off: this session's copies go now.
    if (!enabled) { void flushRecovery(true); return; }
    const every = Math.min(PREFERENCE_LIMITS.recoveryMinutes.max, Math.max(PREFERENCE_LIMITS.recoveryMinutes.min, minutes)) * 60_000;
    const timer = setInterval(() => { void flushRecovery(); }, every);
    return () => clearInterval(timer);
  }, [enabled, minutes]);
}
