import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { gameDataRevisionAtom } from "../atoms/gameDataAtoms";
import { getStockSounds, peekStockSounds } from "../formats/units/load";
import type { StockSounds } from "../editor/stockSounds";

export interface StockSoundsState {
  /** The game's own sounds, or null: still loading, or this copy of the game data has no list. */
  stock: StockSounds | null;
  loading: boolean;
}

/** The game's sound list, fetched on first use and again when the game data changes. */
export function useStockSounds(): StockSoundsState {
  const revision = useAtomValue(gameDataRevisionAtom);
  const [state, setState] = useState<StockSoundsState>(() => {
    const cached = peekStockSounds();
    return { stock: cached, loading: cached === null };
  });
  useEffect(() => {
    let cancelled = false;
    void getStockSounds().then((stock) => { if (!cancelled) setState({ stock, loading: false }); });
    return () => { cancelled = true; };
  }, [revision]);
  return state;
}
