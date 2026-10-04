import { useState } from "react";
import type { Scenario } from "../formats/chk/scenario";

/**
 * Whether a working copy has been edited since it was read or last applied — what
 * `DialogFrame`'s `guard` asks before a stray Escape throws the copy away.
 */
export interface FormGuard {
  dirty: boolean;
  /** For a copy edited in place (typed arrays), which the setter never hears about. */
  touch(): void;
  /** The copy is the map's again: `DialogFrame` calls this after OK / Apply. */
  clean(): void;
}

/**
 * A dialog's working copy of some scenario state: read once per scenario object, so a
 * dialog opened before the startup map exists (a `?dialog=` deep link) fills in when it
 * arrives, and one left open across File ▸ Open re-reads rather than writing stale
 * values into the new map. Edits go through the returned setter until Apply.
 */
export function useScenarioForm<T>(scenario: Scenario | null, read: (scn: Scenario) => T): [T | null, (next: T) => void, FormGuard] {
  const [state, setState] = useState<{ scn: Scenario | null; value: T | null; dirty: boolean }>(() => ({ scn: scenario, value: scenario ? read(scenario) : null, dirty: false }));
  const set = (next: T) => setState({ scn: scenario, value: next, dirty: true });
  const mark = (dirty: boolean) => setState((s) => (s.dirty === dirty ? s : { ...s, dirty }));
  const guard = (dirty: boolean): FormGuard => ({ dirty, touch: () => mark(true), clean: () => mark(false) });
  if (scenario !== state.scn) {
    // Derived-state reset during render, as React recommends over an effect.
    const value = scenario ? read(scenario) : null;
    setState({ scn: scenario, value, dirty: false });
    return [value, set, guard(false)];
  }
  return [state.value, set, guard(state.dirty)];
}
