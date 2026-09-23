import { useEffect, useRef } from "react";
import { useAtomValue, useStore } from "jotai";
import { screenAtom } from "../atoms/editorAtoms";
import { installedPluginsAtom, pluginRuntimesAtom, pluginsStartedAtom } from "../atoms/pluginAtoms";
import { openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import { t } from "../i18n";
import { logWarn } from "../editor/log";
import { effectiveInstalls, enableWithRequirements } from "../plugins/host";
import { PLUGIN_PARAM, pluginLinkAction } from "../plugins/link";

/**
 * `?plugin=` (`plugins/link.ts`): once the installed plugins have started and the editor is
 * on screen, offer the linked plugin if it is missing or off. The parameter is taken out of
 * the address either way, so a reload does not ask again; the rest of the address — the
 * snippet a "Try it" link carries for the plugin itself — is left for the plugin to read.
 */
export function usePluginLink() {
  const store = useStore();
  const started = useAtomValue(pluginsStartedAtom);
  const screen = useAtomValue(screenAtom);
  const done = useRef(false);

  useEffect(() => {
    if (done.current || !started || screen !== "editor") return;
    done.current = true;
    const url = new URL(window.location.href);
    const spec = url.searchParams.get(PLUGIN_PARAM);
    if (spec === null) return;
    url.searchParams.delete(PLUGIN_PARAM);
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);

    const action = pluginLinkAction(spec, effectiveInstalls(store.get(installedPluginsAtom)));
    if (action.kind === "refused") logWarn("plugins", "A link asked for a plugin outside the scm-js organisation; it was ignored", { spec: action.spec });
    else if (action.kind === "install") store.set(openDialogAtom, "confirmPlugin", { spec: action.spec });
    else if (action.kind === "enable") {
      const name = store.get(pluginRuntimesAtom)[action.spec]?.manifest?.name ?? action.spec;
      store.set(pushToastAtom, {
        kind: "info",
        title: t("The link uses the {name} plugin, which is turned off.", { name }),
        ttl: 0,
        action: { label: t("Turn It On"), run: () => void enableWithRequirements(store, action.spec) },
      });
    }
  }, [started, screen, store]);
}
