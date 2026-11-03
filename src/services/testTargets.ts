/**
 * Where Tools ▸ Test Map sends the map. The editor's own target is StarCraft — the file
 * written where the game lists it (`services/testMap.ts`, through the Test Map dialog,
 * which asks for a folder the first time). A plugin may add one more with
 * `api.ui.testTarget` (scm-sim's: a tab of the site's play page). The preference
 * `testMap.target` picks between them for Test Map, Ctrl+F5 and the toolbar; each also
 * has a Tools menu item of its own whatever the choice.
 *
 * A plugin target is run inside the click or key press, before the map is built, so it
 * can open a window — a browser lets a click open a tab, not what follows it later. That
 * is why this does not go through a dialog the way StarCraft does.
 */
import type { createStore } from "jotai";
import { scenarioAtom } from "../atoms/documentAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { pluginTestTargetsAtom, type PluginTestTargetEntry } from "../atoms/pluginAtoms";
import { openDialogAtom, pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { logWarn } from "../editor/log";
import type { TestMapFile } from "../plugins/api";
import { pluginText, t } from "../i18n";
import { count } from "./usage";

type Store = ReturnType<typeof createStore>;

/** The editor's own target's id in `testMap.target`. */
export const STARCRAFT = "starcraft";

/**
 * The target a preference names among the ones running: `"starcraft"` is StarCraft, a
 * plugin's id its target, and `""` the first plugin target where there is one — the
 * browser at scmjs.dev, nothing on the desktop. A plugin that is not running (turned off,
 * or no play page here) is StarCraft. Null is StarCraft.
 */
export function resolveTarget(chosen: string, targets: readonly PluginTestTargetEntry[]): PluginTestTargetEntry | null {
  if (chosen === STARCRAFT) return null;
  if (chosen === "") return targets[0] ?? null;
  return targets.find((e) => e.plugin.id === chosen) ?? null;
}

/** The target Test Map uses now. */
export function chosenTarget(store: Store): PluginTestTargetEntry | null {
  return resolveTarget(store.get(preferencesAtom).testMap.target, store.get(pluginTestTargetsAtom));
}

/**
 * Test the open map: `"chosen"` where the preference says, `"starcraft"` there, or a
 * plugin's id at its target. Call it from the click or key press itself.
 */
export function startTest(store: Store, which: string = "chosen"): void {
  const targets = store.get(pluginTestTargetsAtom);
  const target = which === "chosen" ? chosenTarget(store) : which === STARCRAFT ? null : targets.find((e) => e.plugin.id === which) ?? null;
  if (!target) { store.set(openDialogAtom, "testMap", { run: true }); return; }
  if (!store.get(scenarioAtom)) { store.set(statusMessageAtom, t("Open or create a map first.")); return; }
  const name = (s: string) => pluginText(target.plugin.id, s);
  // Built as Save would write it; the import keeps the build code off the startup path.
  const map: Promise<TestMapFile | null> = import("./testMap").then(async (m) => {
    const bytes = await m.testMapBytes(store);
    const fileName = m.testFileName(store);
    return bytes && fileName ? { bytes, name: fileName } : null;
  });
  // The target may never look at the map; its failure is still told, once, below.
  map.catch(() => {});
  const failed = (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    // Mostly the user's situation (a blocked pop-up, no game files), not a fault: a warning, not an error count.
    logWarn(target.plugin.name, `Test target did not start: ${message}`);
    store.set(pushToastAtom, { kind: "error", title: t("The map was not tested"), detail: t("{target}: {message}", { target: name(target.spec.label), message }) });
  };
  count("map.test", { route: "plugin", target: target.plugin.id });
  try {
    const ran = target.spec.run(map);
    if (ran && typeof (ran as Promise<unknown>).then === "function") {
      (ran as Promise<string | void>).then((line) => { if (typeof line === "string" && line) store.set(statusMessageAtom, line); }, failed);
    } else {
      // A target that does not answer still hears of a build that failed.
      map.catch(failed);
    }
  } catch (err) {
    failed(err);
  }
}
