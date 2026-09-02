import { useEffect, useRef } from "react";
import { useSetAtom, useStore } from "jotai";
import { preloadLogAtom, preloadStepAtom } from "../atoms/preloadAtoms";
import { scenarioAtom } from "../atoms/documentAtoms";
import { mapTilesetAtom } from "../atoms/editorAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { openDialogAtom } from "../atoms/uiAtoms";
import { currentAssetSource, onAssetSource } from "../gamedata/source";
import { runPreload, warmRemainingTilesets, type PreloadTask } from "../services/preload";
import type { getDefaultStore } from "jotai";

type Store = ReturnType<typeof getDefaultStore>;

/**
 * The last preload task: the startup map itself. `useStartupMap` builds it as its own
 * effect, so the splash waits for it here rather than racing it — otherwise the bar can
 * finish while the viewport still has no document to draw.
 */
function documentReady(store: Store): PreloadTask {
  return {
    label: "Preparing workspace",
    run: () => new Promise<void>((resolve) => {
      if (store.get(scenarioAtom)) { resolve(); return; }
      const off = store.sub(scenarioAtom, () => {
        if (!store.get(scenarioAtom)) return;
        off();
        resolve();
      });
    }),
  };
}

/**
 * Kick off the real startup preload once, from the app root rather than from the splash,
 * so `?nosplash` still gets warm assets and the background tileset warm-up still runs.
 * Must be called after useDevDeepLinks so a `?tileset=` link picks which tileset is the
 * one worth blocking on, and before useStartupMap so the document task is subscribed
 * before the map is made.
 *
 * Also mirrors the game data source into `gameDataSourceAtom` for the chrome, and opens
 * Help ▸ Game Data… once the splash is done when the preload found no source at all —
 * the editor runs without one, but nobody should have to guess why the map is flat.
 */
export function usePreload() {
  const store = useStore();
  const setStep = useSetAtom(preloadStepAtom);
  const setLog = useSetAtom(preloadLogAtom);
  const setSource = useSetAtom(gameDataSourceAtom);
  const started = useRef(false);

  useEffect(() => onAssetSource((source) => setSource(source)), [setSource]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const tileset = store.get(mapTilesetAtom);

    void runPreload(tileset, (step) => {
      setStep(step);
      if (step.justFinished) setLog((log) => [...log, step.justFinished!]);
    }, [documentReady(store)]).then(() => {
      warmRemainingTilesets(tileset);
      if (currentAssetSource()?.kind === "none") store.set(openDialogAtom, "gameData", { auto: true });
    });
  }, [setLog, setSource, setStep, store]);
}
