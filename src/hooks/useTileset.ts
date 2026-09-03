import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataRevisionAtom } from "../atoms/gameDataAtoms";
import {
  ensureTileset,
  peekTileset,
  releaseTileset,
  type LoadedTileset,
  type TilesetFileName,
} from "../formats/tileset/load";

export interface TilesetState {
  loaded: LoadedTileset | null;
  loading: boolean;
  /** Set when the tileset files are missing — the viewport falls back to flat colours. */
  error: Error | null;
}

/** The tileset the state describes, so assets are never handed out for a different one. */
interface Internal extends TilesetState {
  name: TilesetFileName;
}

function initial(name: TilesetFileName): Internal {
  const cached = peekTileset(name);
  return { name, loaded: cached, loading: cached === null, error: null };
}

/**
 * Fetch and rasterise the tileset the open map uses. Missing files are a normal state
 * (nobody has run scripts/extract-tilesets.mjs yet), not a crash.
 *
 * Assets are only ever returned for the tileset currently asked for: opening a map of a
 * different era while the old atlas was still in state painted the new map's tile ids
 * through the previous tileset's graphics, which looked like scrambled terrain.
 */
export function useTileset(): TilesetState {
  const name = useAtomValue(tilesetFileNameAtom);
  // Bumped when Help ▸ Game Data… installs a source, so a tileset that failed is asked for again.
  const revision = useAtomValue(gameDataRevisionAtom);
  const [state, setState] = useState<Internal>(() => initial(name));
  const previous = useRef(name);

  // The map moved to another tileset: the one it left would otherwise stay decoded for the
  // session. Released here, on the transition, rather than by sweeping everything but the
  // current one, so a tileset a dialog is loading ahead of a change is never taken away.
  useEffect(() => {
    if (previous.current !== name) {
      releaseTileset(previous.current);
      previous.current = name;
    }
  }, [name]);

  useEffect(() => {
    void revision;
    const cached = peekTileset(name);
    if (cached) {
      setState({ name, loaded: cached, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ name, loaded: null, loading: true, error: null });
    ensureTileset(name).then(
      (loaded) => { if (!cancelled) setState({ name, loaded, loading: false, error: null }); },
      (error: Error) => { if (!cancelled) setState({ name, loaded: null, loading: false, error }); },
    );
    return () => { cancelled = true; };
  }, [name, revision]);

  // The effect has not run yet on the render where `name` changed, so derive that first
  // frame from the cache rather than showing the previous tileset's assets.
  const current = state.name === name ? state : initial(name);
  return { loaded: current.loaded, loading: current.loading, error: current.error };
}
