/**
 * The list of plugins to run: the defaults and the ones the user added.
 */
import type { PluginInstall } from "../../atoms/pluginAtoms";
import { isPinned } from "../loader";
import { defaultPlugins, pluginKey, type DefaultPlugin } from "../defaults";

export const builtinSpec = (name: string) => `builtin:${name}`;

/**
 * The plugins to run: every default (on or off as the stored list says, else as the
 * default itself says), then the ones the user added, in the order they were added. A
 * default is a spec like any other — the remote ones are fetched over the network on
 * every start — so the only thing being a default buys it is a place in the list and a
 * Remove button it does not get; see `defaults.ts`.
 *
 * Stored rows are matched to defaults by `pluginKey`, not by the spec, because the spec
 * of a default moves: an editor that fetched `github:scm-js/plugin-repair` last week
 * pins `…@v1.0.0` today and bundles it as `builtin:repair` on the desktop, and all three
 * are one plugin whose *enabled* the user may have answered. Matching on the string
 * would list it twice and run it twice — two Repair dialogs on every open. The default's
 * own spec wins, so a version the project moved forward reaches everyone, unless the
 * stored one is pinned: that is a version the user chose deliberately (the Update button
 * on a pinned row), and taking it away silently is the one thing this must not do.
 */
export function effectiveInstalls(stored: readonly PluginInstall[], defaults: readonly DefaultPlugin[] = defaultPlugins()): PluginInstall[] {
  const claimed = new Set<string>();
  const out: PluginInstall[] = defaults.map((d) => {
    const key = pluginKey(d.spec);
    const said = stored.find((p) => pluginKey(p.spec) === key);
    if (said) claimed.add(key);
    const spec = said && isPinned(said.spec) ? said.spec : d.spec;
    return { spec, enabled: said?.enabled ?? d.enabled, ...(said?.local ? { local: true } : {}) };
  });
  for (const p of stored) if (!claimed.has(pluginKey(p.spec))) out.push(p);
  return out;
}
