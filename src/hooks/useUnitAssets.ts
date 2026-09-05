import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { gameDataRevisionAtom } from "../atoms/gameDataAtoms";
import { getUnitAssets, onGrpLoaded, peekUnitAssets, type UnitAssets } from "../formats/units/load";

export interface UnitAssetsState {
  loaded: UnitAssets | null;
  loading: boolean;
  /** Set when public/arr etc. are missing — units fall back to coloured markers. */
  error: Error | null;
}

/** The unit data tables, fetched on first use. Missing files are a normal state, not a crash. */
export function useUnitAssets(): UnitAssetsState {
  // Bumped when Help ▸ Game Data… installs a source (so tables that failed are asked for
  // again) or switches data sets (so the ones held are dropped for the new set's).
  const revision = useAtomValue(gameDataRevisionAtom);
  const [state, setState] = useState<UnitAssetsState>(() => {
    const cached = peekUnitAssets();
    return { loaded: cached, loading: cached === null, error: null };
  });

  useEffect(() => {
    // What the loader holds now is the truth on every bump: after a switch it is nothing,
    // and a `loaded` kept from before would draw the old set's units over the new terrain.
    const cached = peekUnitAssets();
    if (cached) {
      setState((s) => (s.loaded === cached ? s : { loaded: cached, loading: false, error: null }));
      return;
    }
    let cancelled = false;
    setState((s) => (s.loading && !s.loaded ? s : { loaded: null, loading: true, error: null }));
    getUnitAssets().then(
      (loaded) => { if (!cancelled) setState({ loaded, loading: false, error: null }); },
      (error: Error) => { if (!cancelled) setState({ loaded: null, loading: false, error }); },
    );
    return () => { cancelled = true; };
  }, [revision]);

  return state;
}

/** A counter that advances whenever a unit GRP finishes loading, so canvases repaint with it. */
export function useGrpRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => onGrpLoaded(() => setRev((r) => r + 1)), []);
  return rev;
}
