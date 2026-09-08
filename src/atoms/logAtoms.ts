/**
 * The store side of the log (`editor/log.ts`): whether the Debug Console is open, whether
 * the chatty tier is recording, and the facts its header is built from.
 *
 * The entries themselves are *not* in an atom. They are written from `plugins/host.ts`,
 * the loader, the preload and a `window.onerror` handler — none of which have a store —
 * and putting them through Jotai would re-render the panel once per entry. The buffer is
 * a plain module with its own subscription; only these three flags live here.
 */
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { browserStorage } from "./storage";
import { setVerbose } from "../editor/log";
import { baseName } from "../editor/log";
import { diagnosticsHeader, shortAgent, type DiagnosticsFacts, type PluginFact } from "../editor/diagnostics";
import { APP_VERSION } from "../version";
import { desktopBridge } from "../gamedata/desktop";
import { DEFAULT_PROFILE } from "../gamedata/profiles";
import { documentsAtom, scenarioAtom } from "./documentAtoms";
import { mapFilePathAtom, mapHeightAtom, mapModifiedAtom, mapTilesetAtom, mapVersionAtom, mapWidthAtom } from "./editorAtoms";
import { gameDataProfileAtom, gameDataSourceAtom } from "./gameDataAtoms";
import { pluginRuntimesAtom } from "./pluginAtoms";
import { TILESET_BY_ID } from "../data/tilesets";
import { specLabel } from "../plugins/failures";

/** View ▸ Debug Console. Remembered, so a session spent debugging does not reopen it every reload. */
export const debugConsoleAtom = atomWithStorage<boolean>("scmjs.console", false, createJSONStorage(browserStorage), { getOnInit: true });

/** How tall the strip is, dragged by its top edge and remembered like the docks' widths. */
export const consoleHeightAtom = atomWithStorage<number>("scmjs.consoleHeight", 176, createJSONStorage(browserStorage), { getOnInit: true });

/**
 * The chatty tier. Not persisted: it is switched on to catch something in the next minute,
 * and a build left tracing every plugin call across sessions is a slow editor nobody
 * asked for. The write goes through to the buffer, which is where the flag actually lives.
 */
const verboseBox = atom(false);
export const logVerboseAtom = atom(
  (get) => get(verboseBox),
  (_get, set, on: boolean) => { set(verboseBox, on); setVerbose(on); },
);

const VERSION_LABEL: Record<string, string> = { original: "StarCraft 1.00", hybrid: "Hybrid 1.04", broodwar: "Brood War", remastered: "Remastered" };

/** What the header is built from, read live so a copy describes the editor as it is now. */
export const diagnosticsFactsAtom = atom<DiagnosticsFacts>((get) => {
  const bridge = desktopBridge();
  const source = get(gameDataSourceAtom);
  const profile = get(gameDataProfileAtom).profile;
  const scenario = get(scenarioAtom);
  const runtimes = get(pluginRuntimesAtom);

  const plugins: PluginFact[] = Object.values(runtimes)
    .filter((rt) => rt.status !== "disabled")
    .map((rt) => ({
      name: rt.manifest?.name ?? specLabel(rt.spec),
      version: rt.manifest?.version,
      status: rt.status,
      error: rt.error ?? undefined,
    }));

  return {
    version: APP_VERSION,
    host: bridge ? `desktop (${bridge.platform})` : "browser",
    agent: bridge ? undefined : typeof navigator === "undefined" ? undefined : shortAgent(navigator.userAgent),
    gameData: source && source.kind !== "none" ? source.label : undefined,
    // Only worth a line when it is not the game's own data: a total conversion explains
    // wrong-looking names and graphics, and the default explains nothing.
    profile: source && source.profile.id !== DEFAULT_PROFILE.id ? source.profile.id
      : profile !== DEFAULT_PROFILE.id ? `${profile} (chosen, not loaded)` : undefined,
    map: scenario
      ? {
          file: baseName(get(mapFilePathAtom)),
          width: get(mapWidthAtom),
          height: get(mapHeightAtom),
          tileset: TILESET_BY_ID[get(mapTilesetAtom)].name,
          version: VERSION_LABEL[get(mapVersionAtom)] ?? String(get(mapVersionAtom)),
          modified: get(mapModifiedAtom),
          open: get(documentsAtom).length,
        }
      : undefined,
    plugins,
  };
});

/** The header as text — what the console's Copy and Help ▸ Copy Bug Report both put above the entries. */
export const diagnosticsTextAtom = atom((get) => diagnosticsHeader(get(diagnosticsFactsAtom)));
