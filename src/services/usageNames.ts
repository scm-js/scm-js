/**
 * The feature counts' names for what a plugin contributed, from the plugin's id: its
 * repository name when it is one the project publishes, `other` otherwise
 * (`usage.ts#pluginCountName`).
 */
import type { getDefaultStore } from "jotai";
import { pluginRuntimesAtom } from "../atoms/pluginAtoms";
import { pluginName } from "./usage";

type Store = ReturnType<typeof getDefaultStore>;

/** A running plugin's name in the counts, by its manifest id. */
export function pluginNameOf(store: Store, pluginId: string): string {
  const runtime = Object.values(store.get(pluginRuntimesAtom)).find((r) => r.manifest?.id === pluginId);
  return runtime ? pluginName(runtime.spec) : "other";
}

/** A build step (`plugin id/step id`) in the counts: the plugin's name and the step's id, or `other`. */
export function buildStepName(store: Store, id: string): string {
  const slash = id.indexOf("/");
  const plugin = pluginNameOf(store, slash < 0 ? id : id.slice(0, slash));
  return plugin === "other" || slash < 0 ? plugin : `${plugin}/${id.slice(slash + 1)}`.slice(0, 100);
}
