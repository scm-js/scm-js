import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { tilesetFileNameAtom } from "../atoms/documentAtoms";
import { ensureTileset, peekTileset, type LoadedTileset } from "../formats/tileset/load";

export interface TilesetState {
  loaded: LoadedTileset | null;
  loading: boolean;
  /** Set when the tileset files are missing — the viewport falls back to flat colours. */
  error: Error | null;
}

/**
 * Fetch and rasterise the tileset the open map uses. Missing files are a normal state
 * (nobody has run scripts/extract-tilesets.mjs yet), not a crash.
 */
export function useTileset(): TilesetState {
  const name = useAtomValue(tilesetFileNameAtom);
  const [state, setState] = useState<TilesetState>(() => ({
    loaded: peekTileset(name),
    loading: peekTileset(name) === null,
    error: null,
  }));

  useEffect(() => {
    const cached = peekTileset(name);
    if (cached) {
      setState({ loaded: cached, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    ensureTileset(name).then(
      (loaded) => { if (!cancelled) setState({ loaded, loading: false, error: null }); },
      (error: Error) => { if (!cancelled) setState({ loaded: null, loading: false, error }); },
    );
    return () => { cancelled = true; };
  }, [name]);

  return state;
}
