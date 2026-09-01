import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { installedPluginsAtom } from "../atoms/pluginAtoms";
import { activatePlugin, activePluginSpecs, deactivatePlugin, effectiveInstalls } from "../plugins/host";

/**
 * Keep the running plugins in step with the installed list: activate what is enabled,
 * deactivate what was turned off or removed. Activation is idempotent per spec, so
 * StrictMode's double effect and repeated list edits are harmless.
 */
export function usePlugins() {
  const store = useStore();
  const installed = useAtomValue(installedPluginsAtom);
  useEffect(() => {
    const wanted = effectiveInstalls(installed);
    for (const p of wanted) {
      if (p.enabled) void activatePlugin(store, p.spec);
      else deactivatePlugin(store, p.spec);
    }
    for (const spec of activePluginSpecs(store)) if (!wanted.some((p) => p.spec === spec && p.enabled)) deactivatePlugin(store, spec);
  }, [installed, store]);
}
