import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom, pluginUpdateCheckAtom } from "../atoms/pluginAtoms";
import { preferencesAtom } from "../atoms/preferencesAtoms";
import { openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import { activatePlugin, activePluginSpecs, deactivatePlugin, effectiveInstalls } from "../plugins/host";
import { failureToast, pluginFailures } from "../plugins/failures";
import { autoUpdateToast, runUpdatePass, shouldCheckPlugins, updateToast } from "../plugins/updates";

/**
 * How long after the activation pass the update check starts. Late enough that the
 * splash has gone and nothing of it competes with the startup map's own fetches; the
 * notice it may raise has no expiry, so nothing is lost by waiting.
 */
const UPDATE_CHECK_DELAY_MS = 5000;

/**
 * Keep the running plugins in step with the installed list: activate what is enabled,
 * deactivate what was turned off or removed. Activation is idempotent per spec, so
 * StrictMode's double effect and repeated list edits are harmless.
 *
 * When the pass is over, anything that failed gets said out loud once
 * (`plugins/failures.ts`). A default plugin is one the user never asked for and so never
 * thinks to check: an editor that could not load one started with Repair, Paint,
 * Walkability, scmscx.com or Terrain from Image quietly missing and no way to tell that
 * from them not existing. Reported specs are remembered for the session so a
 * later list edit does not repeat a notice the user has already dismissed; Reload and
 * turning a plugin off and on again go through `activatePlugin` and would be reported
 * again only if they failed again.
 *
 * Once the first pass is over, and once per session, the update check runs
 * (`plugins/updates.ts`) as Preferences ▸ Plugins says: a notice naming what is newer, an
 * install of what may be installed, or nothing at all. It waits for the pass because the
 * versions it compares are the ones the running plugins loaded.
 */
export function usePlugins() {
  const store = useStore();
  const installed = useAtomValue(installedPluginsAtom);
  const reported = useRef(new Set<string>());
  const updatesChecked = useRef(false);
  // Held outside the activation effect: that one is torn down on every list edit, and a
  // plugin toggled within the delay would otherwise cancel the one check the session gets.
  const updateTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(updateTimer.current), []);
  useEffect(() => {
    const wanted = effectiveInstalls(installed);
    const pass: Promise<void>[] = [];
    for (const p of wanted) {
      if (p.enabled) pass.push(activatePlugin(store, p.spec));
      else deactivatePlugin(store, p.spec);
    }
    for (const spec of activePluginSpecs(store)) if (!wanted.some((p) => p.spec === spec && p.enabled)) deactivatePlugin(store, spec);

    let live = true;
    void Promise.allSettled(pass).then(() => {
      if (!live) return;
      const openPlugins = () => store.set(openDialogAtom, "plugins", { tab: "installed" });
      const failures = pluginFailures(wanted, store.get(pluginRuntimesAtom), store.get(pluginManifestCacheAtom)).filter((f) => !reported.current.has(f.spec));
      const toast = failureToast(failures, openPlugins);
      if (toast) {
        for (const f of failures) reported.current.add(f.spec);
        store.set(pushToastAtom, toast);
      }
      if (updatesChecked.current) return;
      updatesChecked.current = true;
      const mode = store.get(preferencesAtom).plugins.updates;
      if (!shouldCheckPlugins(mode, store.get(pluginUpdateCheckAtom).at, Date.now())) return;
      updateTimer.current = setTimeout(() => {
        void runUpdatePass(store, mode).then(({ found, outcome }) => {
          // The button lands on the first row with an offer, which for one update is the row.
          const first = (outcome ? [...outcome.skipped.map((s) => s.update), ...outcome.failed.map((f) => f.update)] : found)[0];
          const openAt = first ? () => store.set(openDialogAtom, "plugins", { tab: "installed", focus: first.spec }) : openPlugins;
          const notice = outcome ? autoUpdateToast(outcome, openAt) : updateToast(found, openAt);
          if (notice) store.set(pushToastAtom, notice);
        });
      }, UPDATE_CHECK_DELAY_MS);
    });
    return () => { live = false; };
  }, [installed, store]);
}
