import { useEffect } from "react";
import { useAtomValue, useStore } from "jotai";
import { screenAtom } from "../atoms/editorAtoms";
import { installedPluginsAtom, pluginRuntimesAtom, pluginsStartedAtom } from "../atoms/pluginAtoms";
import { openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import { t } from "../i18n";
import { logInfo, logWarn } from "../editor/log";
import { effectiveInstalls, enableWithRequirements, isPluginActive, reloadPlugin } from "../plugins/host";
import { devEventsUrl, devPluginSpec, PLUGIN_DEV_PARAM } from "../plugins/devLink";
import { installFor } from "../plugins/requires";
import { pluginKey } from "../plugins/defaults";

/**
 * Read once, when the module loads: React's StrictMode runs effects twice in development, and the address is the
 * one the page opened with. The parameter stays in the address, so reloading the page keeps the plugin reloading.
 */
const SPEC = typeof window !== "undefined" ? devPluginSpec(new URL(window.location.href).searchParams.get(PLUGIN_DEV_PARAM)) : null;

/**
 * `?plugin-dev=` (`plugins/devLink.ts`, `scmjs plugin dev`): once the installed plugins have started and the editor
 * is on screen, add the plugin being written (the usual confirmation), turn it on, or reload it; then reload it
 * each time the command says its files changed, until the command stops.
 */
export function usePluginDev() {
  const store = useStore();
  const started = useAtomValue(pluginsStartedAtom);
  const screen = useAtomValue(screenAtom);
  const ready = started && screen === "editor";

  useEffect(() => {
    if (!SPEC || !ready) return;
    const spec = SPEC;
    const nameOf = () => store.get(pluginRuntimesAtom)[spec]?.manifest?.name ?? spec;
    const found = installFor(spec, effectiveInstalls(store.get(installedPluginsAtom)), pluginKey);
    if (!found) store.set(openDialogAtom, "confirmPlugin", { spec });
    else if (!found.enabled) void enableWithRequirements(store, found.spec);
    else void reloadPlugin(store, found.spec);

    const events = new EventSource(devEventsUrl(spec));
    events.addEventListener("hello", () => logInfo("plugins", "scmjs plugin dev is serving a plugin to this page", { spec }));
    events.addEventListener("reload", () => {
      if (!isPluginActive(store, spec)) return;
      void reloadPlugin(store, spec).then(() => store.set(pushToastAtom, { kind: "ok", title: t("Reloaded {name}", { name: nameOf() }), ttl: 2500 }));
    });
    events.addEventListener("failed", (e) => {
      const text = (() => { try { return String(JSON.parse((e as MessageEvent).data).text ?? ""); } catch { return ""; } })();
      store.set(pushToastAtom, { kind: "error", title: t("{name} did not build", { name: nameOf() }), detail: text, ttl: 8000 });
    });
    // When the command stops, the browser would try again every few seconds for as long as the page is open.
    let misses = 0;
    events.addEventListener("open", () => { misses = 0; });
    events.addEventListener("error", () => {
      if (++misses < 3) return;
      events.close();
      logWarn("plugins", "scmjs plugin dev stopped; the plugin is no longer reloaded", { spec });
    });
    return () => events.close();
  }, [ready, store]);
}
