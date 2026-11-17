/**
 * One plugin's `PluginApi`, assembled from the parts beside this file.
 */
import { logError, logInfo } from "../../editor/log";
import { createGraphicsApi } from "../graphics";
import { PLUGIN_API_VERSION, type PluginApi, type PluginInfo } from "../api";
import { type Store, Contributions } from "./shared";
import { documentApi, syncApi } from "./document";
import { triggersWithClaims } from "./triggers";
import { queryApi } from "./query";
import { viewApi } from "./view";
import { dataApi, gameDataApi } from "./data";
import { menuApi, contextMenuApi, hotkeysApi, commandsApi, servicesApi } from "./commands";
import { clipboardApi, exchangeApi } from "./clipboard";
import { eventsApi } from "./events";
import { settingsApi } from "./settings";
import { selectionApi, paletteApi } from "./palette";
import { terrainApi, tilesetApi } from "./terrain";
import { constsApi, namesApi, textApi } from "./names";
import { i18nApi, storageApi } from "./own";
import { uiApi } from "./ui";
import { printable, instrument } from "./instrument";

/** Build one plugin's view of the editor. Everything it registers lands in `bag`. */
export function createPluginApi(store: Store, info: PluginInfo, bag: Contributions): PluginApi {
  /**
   * The bag is disposed when the plugin is deactivated; a callback it left behind — a fetch
   * that landed late, a timer — finds every write refused here, with a line in the console,
   * so that nothing changes the map or the chrome on behalf of a plugin that is off. The
   * contributions refuse themselves in `Contributions.add`.
   */
  const gone = (what: string): boolean => {
    if (!bag.disposed) return false;
    logError(info.name, `${what} was called after ${bag.scoped ? "its scope was disposed" : "the plugin was deactivated"}; nothing was done`);
    return true;
  };

  const api: PluginApi = {
    apiVersion: PLUGIN_API_VERSION,
    plugin: info,
    settings: settingsApi(store),
    document: documentApi(store, info, bag, gone),
    triggers: triggersWithClaims(store, info, bag),
    query: queryApi(store),
    view: viewApi(store),
    data: dataApi(),
    gameData: gameDataApi(store),
    consts: constsApi(),
    graphics: createGraphicsApi(store, bag),
    names: namesApi(store),
    i18n: i18nApi(info, bag),
    text: textApi(),
    terrain: terrainApi(store, info, bag),
    tileset: tilesetApi(store),
    selection: selectionApi(store),
    clipboard: clipboardApi(store),
    exchange: exchangeApi(store),
    palette: paletteApi(store),
    sync: syncApi(store, info, bag, gone),
    ui: uiApi(store, info, bag),
    menu: menuApi(store, info, bag),
    contextMenu: contextMenuApi(store, info, bag),
    hotkeys: hotkeysApi(store, info, bag),
    commands: commandsApi(store, info, bag),
    services: servicesApi(store, info, bag),
    events: eventsApi(store, info, bag),
    storage: storageApi(info),

    log: (...args) => {
      console.log(`[${info.name}]`, ...args);
      logInfo(info.name, args.map(printable).join(" "));
    },

    // A child bag inside this one: disposing the scope sweeps the child and leaves the
    // parent's entry, and the parent's own sweep (the plugin turned off) reaches the child.
    scope: () => {
      const child = new Contributions(true);
      const childApi = createPluginApi(store, info, child);
      const entry = bag.add(() => child.dispose());
      return { api: childApi, get disposed() { return child.disposed; }, dispose: () => entry.dispose() };
    },
  };
  instrument(api as unknown as Record<string, unknown>, info);
  return api;
}
