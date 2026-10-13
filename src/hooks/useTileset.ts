import { useEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { parkedTilesetsAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { viewFlagsAtom } from "../atoms/editorAtoms";
import { gameDataRevisionAtom } from "../atoms/gameDataAtoms";
import { pushToastAtom } from "../atoms/uiAtoms";
import {
  ensureTileset,
  hdTerrainMissing,
  peekTileset,
  releaseTileset,
  setHdTerrain,
  tilesetSettled,
  type LoadedTileset,
  type TilesetFileName,
} from "../formats/tileset/load";
import { t } from "../i18n";

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
 * Remastered Graphics was asked for and the data set has no such pictures: said once per
 * game data revision, however many panels are showing the tileset.
 */
let toldMissingAt = -1;
function tellHdMissing(store: ReturnType<typeof useStore>, revision: number) {
  if (toldMissingAt === revision) return;
  toldMissingAt = revision;
  store.set(pushToastAtom, {
    kind: "info",
    title: t("No Remastered graphics here"),
    detail: t("The game data in use has only the classic pictures. Help ▸ Game Data… adds StarCraft: Remastered from your installation."),
  });
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
  const store = useStore();
  const name = useAtomValue(tilesetFileNameAtom);
  // Bumped when Help ▸ Game Data… installs a source, so a tileset that failed is asked for again.
  const revision = useAtomValue(gameDataRevisionAtom);
  // View ▸ Remastered Graphics: the loader answers with the tileset's 2x variant while it is on.
  const hd = useAtomValue(viewFlagsAtom).hdGraphics;
  const [state, setState] = useState<Internal>(() => initial(name));
  const previous = useRef(name);

  // The map moved to another tileset: the one it left would otherwise stay decoded for the
  // session. Released here, on the transition, rather than by sweeping everything but the
  // current one, so a tileset a dialog is loading ahead of a change is never taken away —
  // and kept while another open map still draws with it, so switching between two maps
  // never rasterises an atlas twice. It goes when the last map using it closes or changes.
  useEffect(() => {
    if (previous.current !== name) {
      if (!store.get(parkedTilesetsAtom).has(previous.current)) releaseTileset(previous.current);
      previous.current = name;
    }
  }, [name, store]);

  useEffect(() => {
    // Every instance of this hook sets it, to the same value; the first one to run decides.
    setHdTerrain(hd);
    const cached = peekTileset(name);
    if (cached && tilesetSettled(name)) {
      setState({ name, loaded: cached, loading: false, error: null });
      if (hd && hdTerrainMissing(name)) tellHdMissing(store, revision);
      return;
    }

    let cancelled = false;
    // The classic pictures keep drawing while the 2x file is fetched.
    setState({ name, loaded: cached, loading: cached === null, error: null });
    ensureTileset(name).then(
      (loaded) => {
        if (cancelled) return;
        setState({ name, loaded, loading: false, error: null });
        if (hd && hdTerrainMissing(name)) tellHdMissing(store, revision);
      },
      (error: Error) => { if (!cancelled) setState({ name, loaded: null, loading: false, error }); },
    );
    return () => { cancelled = true; };
  }, [name, revision, hd, store]);

  // The effect has not run yet on the render where `name` changed, so derive that first
  // frame from the cache rather than showing the previous tileset's assets.
  const current = state.name === name ? state : initial(name);
  return { loaded: current.loaded, loading: current.loading, error: current.error };
}
