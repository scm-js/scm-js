/**
 * Commands and services, and the menus and keys that run them.
 */
import { nextContributionKey, normalizeCombo, pluginCommandsAtom, pluginContextItemsAtom, pluginServicesAtom, pluginHotkeysAtom, pluginMenuItemsAtom, pluginRuntimesAtom } from "../../atoms/pluginAtoms";
import { logError, logWarn } from "../../editor/log";
import { pluginIdOf, type CommandInfo, type ServiceInfo, type PluginInfo, type ContextMenuContext, type ContextMenuApi, type HotkeyApi, type MenuApi, type ServicesApi, type CommandsApi } from "../api";
import { countPluginUse, pluginName } from "../../services/usage";
import type { Store, Contributions } from "./shared";

/**
 * A command id is namespaced under the plugin unless it already carries a dot, so
 * `"convert"` from the Terrain from Image plugin is `image-to-terrain.convert` and a
 * plugin offering a shared name (`"triggers.open"`) keeps it.
 */
export function qualifyCommand(pluginId: string, id: string): string {
  const trimmed = id.trim();
  return trimmed.includes(".") ? trimmed : `${pluginId}.${trimmed}`;
}

function findService(store: Store, id: string) {
  return store.get(pluginServicesAtom).find((s) => s.id === id) ?? null;
}

function serviceInfo(s: { id: string; pluginId: string; version: number }): ServiceInfo {
  return { id: s.id, pluginId: s.pluginId, version: s.version };
}

export function runCommand(store: Store, id: string, args: unknown[] = []): unknown {
  const command = store.get(pluginCommandsAtom).find((c) => c.id === id);
  if (!command) {
    logWarn("plugins", `No such command: ${id}`);
    return undefined;
  }
  try {
    if (command.enabled && !command.enabled()) return undefined;
    return command.run(...args);
  } catch (err) {
    const owner = Object.values(store.get(pluginRuntimesAtom)).find((r) => r.manifest && pluginIdOf(r.manifest) === command.pluginId);
    logError("plugins", `Command ${id} failed`, err, undefined, { step: "command", plugin: owner ? pluginName(owner.spec) : "other" });
    return undefined;
  }
}

/** `api.menu`: items in the menu bar. */
export function menuApi(store: Store, info: PluginInfo, bag: Contributions): MenuApi {
  return {
    add: (path, item) => {
      const key = nextContributionKey();
      const { run: own, command, icon: wanted, ...rest } = item;
      const icon = wanted === "plugin" ? info.icon ?? { kind: "text", text: "⌘" } : wanted;
      const run = () => { countPluginUse(info, "menu", command ?? item.label); if (own) own(); else if (command) runCommand(store, qualifyCommand(info.id, command)); };
      store.set(pluginMenuItemsAtom, [...store.get(pluginMenuItemsAtom), { ...rest, run, icon, key, pluginId: info.id, path }]);
      return bag.add(() => store.set(pluginMenuItemsAtom, store.get(pluginMenuItemsAtom).filter((i) => i.key !== key)), "menu");
    },
  };
}

/** `api.contextMenu`: items in the map's right-click menu. */
export function contextMenuApi(store: Store, info: PluginInfo, bag: Contributions): ContextMenuApi {
  return {
    add: (surface, item) => {
      const key = nextContributionKey();
      const { run: own, command, ...rest } = item;
      const run = (ctx: ContextMenuContext) => { countPluginUse(info, "context", command ?? (typeof item.label === "string" ? item.label : undefined)); if (own) own(ctx); else if (command) runCommand(store, qualifyCommand(info.id, command), [ctx]); };
      store.set(pluginContextItemsAtom, [...store.get(pluginContextItemsAtom), { ...rest, run, key, pluginId: info.id, surface }]);
      return bag.add(() => store.set(pluginContextItemsAtom, store.get(pluginContextItemsAtom).filter((i) => i.key !== key)), "contextMenu");
    },
  };
}

/** `api.hotkeys`: keys the plugin binds. */
export function hotkeysApi(store: Store, info: PluginInfo, bag: Contributions): HotkeyApi {
  return {
    add: (combo, action) => {
      const key = nextContributionKey();
      const act = typeof action === "function" ? action : () => runCommand(store, qualifyCommand(info.id, action.command));
      const run = () => { countPluginUse(info, "key", typeof action === "function" ? combo : action.command); act(); };
      store.set(pluginHotkeysAtom, [...store.get(pluginHotkeysAtom), { key, pluginId: info.id, combo: normalizeCombo(combo), run }]);
      return bag.add(() => store.set(pluginHotkeysAtom, store.get(pluginHotkeysAtom).filter((i) => i.key !== key)), "hotkeys");
    },
  };
}

/** `api.commands`: commands under the plugin's namespace. */
export function commandsApi(store: Store, info: PluginInfo, bag: Contributions): CommandsApi {
  return {
    register: (spec) => {
      const key = nextContributionKey();
      const id = qualifyCommand(info.id, spec.id);
      if (store.get(pluginCommandsAtom).some((c) => c.id === id)) logWarn("plugins", `Command ${id} is already registered; the newer one wins`);
      store.set(pluginCommandsAtom, [...store.get(pluginCommandsAtom).filter((c) => c.id !== id), { key, pluginId: info.id, id, title: spec.title, enabled: spec.enabled, run: spec.run }]);
      return bag.add(() => store.set(pluginCommandsAtom, store.get(pluginCommandsAtom).filter((c) => c.key !== key)));
    },
    run: (id, ...args) => runCommand(store, qualifyCommand(info.id, id), args),
    has: (id) => store.get(pluginCommandsAtom).some((c) => c.id === qualifyCommand(info.id, id)),
    list: (): CommandInfo[] => store.get(pluginCommandsAtom).map((c) => ({ id: c.id, title: c.title, pluginId: c.pluginId, enabled: c.enabled ? c.enabled() : true })),
  };
}

/** `api.services`: objects one plugin provides and another uses. */
export function servicesApi(store: Store, info: PluginInfo, bag: Contributions): ServicesApi {
  return {
    provide: (id, service, options) => {
      const key = nextContributionKey();
      const name = qualifyCommand(info.id, id);
      if (store.get(pluginServicesAtom).some((s) => s.id === name)) logWarn("plugins", `Service ${name} is already provided; the newer one wins`);
      store.set(pluginServicesAtom, [...store.get(pluginServicesAtom).filter((s) => s.id !== name), { key, pluginId: info.id, id: name, version: options?.version ?? 1, service }]);
      return bag.add(() => store.set(pluginServicesAtom, store.get(pluginServicesAtom).filter((s) => s.key !== key)));
    },
    get: <T extends object>(id: string) => (findService(store, qualifyCommand(info.id, id))?.service as T | undefined) ?? null,
    has: (id) => findService(store, qualifyCommand(info.id, id)) !== null,
    watch: <T extends object>(id: string, listener: (service: T | null, info: ServiceInfo | null) => void) => {
      const name = qualifyCommand(info.id, id);
      // The registration's key, not the object: re-providing the same object under a new
      // version is a change the watcher wants to hear about, and a different object is a new key.
      let last: number | null = null;
      const tell = (entry: ReturnType<typeof findService>) => {
        try { listener((entry?.service as T | undefined) ?? null, entry ? serviceInfo(entry) : null); } catch (err) { logError(info.name, "A service watcher failed", err); }
      };
      const check = () => {
        const entry = findService(store, name);
        const now = entry?.key ?? null;
        if (now === last) return;
        last = now;
        tell(entry);
      };
      const first = findService(store, name);
      last = first?.key ?? null;
      tell(first);
      const unsub = store.sub(pluginServicesAtom, check);
      return bag.add(unsub, "events");
    },
    list: () => store.get(pluginServicesAtom).map(serviceInfo),
  };
}
