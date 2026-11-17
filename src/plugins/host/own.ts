/**
 * What is the plugin's own: its translation catalogues and its storage.
 */
import { addPluginCatalogues, locale as currentLocale, makeTranslator } from "../../i18n";
import { browserStorage, STORAGE_PREFIX } from "../../app/storage";
import type { PluginInfo, I18nApi, StorageApi } from "../api";
import type { Contributions } from "./shared";

/**
 * The plugin's own catalogues, over the editor's translator (`i18n/index.ts`): the
 * same key rule and placeholder grammar as the chrome, so a plugin repository can run
 * the same extractor. Registered catalogues merge per language, later over earlier.
 */
export function i18nApi(info: PluginInfo, bag: Contributions): I18nApi {
  const catalogues = new Map<string, Record<string, string>[]>();
  const merged = (loc: string) => {
    const list = catalogues.get(loc);
    return list && list.length > 0 ? Object.assign({}, ...list) as Record<string, string> : undefined;
  };
  const translator = makeTranslator(merged);
  // Menu labels and the like are handed over in English and shown through `pluginText`,
  // which looks here while the plugin has a catalogue registered.
  let shown: (() => void) | null = null;
  return {
    get language() { return currentLocale(); },
    register: (added: Record<string, Record<string, string>>) => {
      const entries = Object.entries(added);
      for (const [loc, catalogue] of entries) catalogues.set(loc, [...(catalogues.get(loc) ?? []), catalogue]);
      shown ??= addPluginCatalogues(info.id, merged);
      return bag.add(() => {
        for (const [loc, catalogue] of entries) catalogues.set(loc, (catalogues.get(loc) ?? []).filter((c) => c !== catalogue));
        if (shown && [...catalogues.values()].every((list) => list.length === 0)) { shown(); shown = null; }
      });
    },
    t: translator.t,
    tc: translator.tc,
  };
}

/**
 * Keys live under `scmjs.plugin.<id>.`, so Preferences ▸ storage lists them per plugin and sweeps them
 * with the rest; `browserStorage()` is a memory stand-in when the browser has none.
 */
export function storageApi(info: PluginInfo): StorageApi {
  const prefix = `${STORAGE_PREFIX}plugin.${info.id}.`;
  return {
    get: (key, fallback) => {
      try {
        const raw = browserStorage().getItem(prefix + key);
        return raw === null ? fallback : (JSON.parse(raw) as typeof fallback);
      } catch {
        return fallback;
      }
    },
    set: (key, value) => {
      try { browserStorage().setItem(prefix + key, JSON.stringify(value)); return true; } catch { return false; /* quota */ }
    },
    remove: (key) => {
      try { browserStorage().removeItem(prefix + key); } catch { /* ignore */ }
    },
  };
}
