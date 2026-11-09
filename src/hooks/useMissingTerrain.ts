import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { archiveExtrasAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { peekTileset, type LoadedTileset } from "../formats/tileset/load";
import { updateMissingTerrain } from "../services/missingTerrain";

/**
 * Say when the map in front uses terrain the loaded tileset has not got
 * (`services/missingTerrain.ts`). `loaded` is what `useTileset` hands the viewport; it only
 * tells this when to look again. On the render after a data set switch it can still be the
 * old set's tileset, which the switch has already dropped from the cache, so the cache's
 * entry is what is read, and nothing is decided until the two agree.
 */
export function useMissingTerrain(loaded: LoadedTileset | null): void {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const name = useAtomValue(tilesetFileNameAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  useEffect(() => {
    const current = peekTileset(name);
    const groups = current && loaded && current.tileset === loaded.tileset ? current.tileset.groups.length : null;
    void updateMissingTerrain(store, scenario, groups);
  }, [store, scenario, name, source, extras, loaded]);
}
