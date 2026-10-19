/**
 * The feature counts' startup (`services/usage.ts`): the preference applied, the plugins the
 * project's registry lists kept current for the plugins' names, and once the plugins have started, one
 * `start` line for the session — the editor's language, the game data in use — and one
 * `plugin.running` line for each plugin that is running. The layer, the terrain tool, the
 * mirror and a plugin's view in the map's place (a replay) are counted as they change,
 * however they were changed, and a replay dropped anywhere on the page is counted as opened.
 */
import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { pluginFileTypesAtom, pluginRuntimesAtom, pluginsStartedAtom, registryCacheAtom, shownMapViewAtom } from "../atoms/pluginAtoms";
import { activeLayerAtom, symmetryAtom, terrainModeAtom } from "../atoms/editorAtoms";
import { currentAssetSource } from "../gamedata/source";
import { locale } from "../i18n";
import { DEFAULT_REGISTRIES, pluginKey } from "../plugins/defaults";
import { count, countingHere, countingWanted, countReplays, gameDataOf, pluginName, setCounting, setListedPlugins } from "../services/usage";

let started = false;

export function useUsageCounts() {
  const store = useStore();
  const on = useAtomValue(preferencesAtom).counting;
  const registries = useAtomValue(registryCacheAtom);
  const pluginsStarted = useAtomValue(pluginsStartedAtom);

  // The site's privacy page can turn counting off (or on again) in this browser; at startup
  // the preference takes that answer before anything is written back.
  const synced = useRef(false);
  useEffect(() => {
    if (!synced.current) {
      synced.current = true;
      const wanted = countingWanted();
      if (countingHere() && wanted !== on) { store.set(preferencesAtom, { ...store.get(preferencesAtom), counting: wanted }); return; }
    }
    setCounting(on);
  }, [on, store]);

  useEffect(() => {
    // The project's own registry only: one the user added may list plugins nobody else has.
    const keys = new Set(DEFAULT_REGISTRIES.flatMap((url) => registries[url]?.registry.plugins ?? []).map((e) => pluginKey(e.spec)));
    setListedPlugins((spec) => keys.has(pluginKey(spec)));
  }, [registries]);

  useEffect(() => {
    if (!countingHere()) return;
    const subs = [
      store.sub(activeLayerAtom, () => count("layer", { id: store.get(activeLayerAtom) })),
      store.sub(terrainModeAtom, () => count("terrain.mode", { mode: store.get(terrainModeAtom) })),
      store.sub(symmetryAtom, () => count("symmetry", { mode: store.get(symmetryAtom) })),
      store.sub(shownMapViewAtom, () => {
        const view = store.get(shownMapViewAtom);
        if (view) count("plugin.view", { plugin: pluginName(view.plugin.source) });
      }),
    ];
    // A replay dropped anywhere, the map or a plugin's own panel, while a plugin that opens replays is running.
    // Capturing on the window sees it before a panel's handler can stop it.
    const onDrop = (e: DragEvent) => {
      if (!store.get(pluginFileTypesAtom).some((t) => t.extensions.includes(".rep"))) return;
      countReplays([...(e.dataTransfer?.files ?? [])], "drop");
    };
    window.addEventListener("drop", onDrop, true);
    return () => { for (const unsub of subs) unsub(); window.removeEventListener("drop", onDrop, true); };
  }, [store]);

  useEffect(() => {
    if (!pluginsStarted || started || !countingHere()) return;
    started = true;
    const runtimes = Object.values(store.get(pluginRuntimesAtom));
    count("start", { language: locale(), data: gameDataOf(currentAssetSource()), plugins: runtimes.filter((r) => r.status === "active").length });
    for (const r of runtimes) if (r.status === "active") count("plugin.running", { plugin: pluginName(r.spec) });
  }, [pluginsStarted, store]);
}
