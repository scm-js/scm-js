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
  // Bumped when Help ▸ Game Data… installs a source, so tables that failed are asked for again.
  const revision = useAtomValue(gameDataRevisionAtom);
  const [state, setState] = useState<UnitAssetsState>(() => {
    const cached = peekUnitAssets();
    return { loaded: cached, loading: cached === null, error: null };
  });

  useEffect(() => {
    if (state.loaded) return;
    let cancelled = false;
    if (revision > 0) setState((s) => (s.loading ? s : { ...s, loading: true, error: null }));
    getUnitAssets().then(
      (loaded) => { if (!cancelled) setState({ loaded, loading: false, error: null }); },
      (error: Error) => { if (!cancelled) setState({ loaded: null, loading: false, error }); },
    );
    return () => { cancelled = true; };
  }, [state.loaded, revision]);

  return state;
}

/** A counter that advances whenever a unit GRP finishes loading, so canvases repaint with it. */
export function useGrpRevision(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => onGrpLoaded(() => setRev((r) => r + 1)), []);
  return rev;
}
