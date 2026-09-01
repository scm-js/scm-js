import { useState } from "react";
import type { Scenario } from "../formats/chk/scenario";

/**
 * A dialog's working copy of some scenario state: read once per scenario object, so a
 * dialog opened before the startup map exists (a `?dialog=` deep link) fills in when it
 * arrives, and one left open across File ▸ Open re-reads rather than writing stale
 * values into the new map. Edits go through the returned setter until Apply.
 */
export function useScenarioForm<T>(scenario: Scenario | null, read: (scn: Scenario) => T): [T | null, (next: T) => void] {
  const [state, setState] = useState<{ scn: Scenario | null; value: T | null }>(() => ({ scn: scenario, value: scenario ? read(scenario) : null }));
  const set = (next: T) => setState({ scn: scenario, value: next });
  if (scenario !== state.scn) {
    // Derived-state reset during render, as React recommends over an effect.
    const value = scenario ? read(scenario) : null;
    setState({ scn: scenario, value });
    return [value, set];
  }
  return [state.value, set];
}
