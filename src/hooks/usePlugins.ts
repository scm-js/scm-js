import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { installedPluginsAtom, pluginManifestCacheAtom, pluginRuntimesAtom } from "../atoms/pluginAtoms";
import { openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import { activatePlugin, activePluginSpecs, deactivatePlugin, effectiveInstalls } from "../plugins/host";
import { failureToast, pluginFailures } from "../plugins/failures";

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
 */
export function usePlugins() {
  const store = useStore();
  const installed = useAtomValue(installedPluginsAtom);
  const reported = useRef(new Set<string>());
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
      const failures = pluginFailures(wanted, store.get(pluginRuntimesAtom), store.get(pluginManifestCacheAtom)).filter((f) => !reported.current.has(f.spec));
      const toast = failureToast(failures, () => store.set(openDialogAtom, "plugins", { tab: "installed" }));
      if (!toast) return;
      for (const f of failures) reported.current.add(f.spec);
      store.set(pushToastAtom, toast);
    });
    return () => { live = false; };
  }, [installed, store]);
}
