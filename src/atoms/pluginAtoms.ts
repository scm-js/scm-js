/**
 * Plugin state: what is installed (persisted), what is running, and the registries the
 * chrome reads to show a plugin's menu items, context-menu entries and hotkeys.
 *
 * The registries hold plain records with the plugin's id on them so disabling a plugin
 * can sweep its contributions out even when it forgot to dispose them itself.
 */
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type {
  ContextItemSpec, ContextMenuContext, ContextSurface, MapToolSpec, MapToolStopReason, MenuItemSpec, MenuPath, OverlaySpec, PanelHandle, PanelSpec, PluginIcon, PluginInfo, PluginManifest, TriggerClaimSpec } from "../plugins/api";
import type { Rect } from "../editor/terrain";
import type { Registry } from "../plugins/registry";
import { browserStorage } from "./storage";

/* ── Installed (persisted) ──────────────────────────────── */

export interface PluginInstall {
  /** `builtin:<name>`, `github:owner/repo[@ref][/dir]`, or a URL — see `plugins/loader.ts`. */
  spec: string;
  enabled: boolean;
  /**
   * Load the copy kept in `pluginCodeAtom` instead of fetching the plugin again. The
   * copy is made on the first load that has to go to the network, so this only means
   * "prefer the copy" until there is one; after that the plugin's address is never
   * touched again unless Reload asks for it.
   */
  local?: boolean;
}

/** Remote plugins the user added; built-ins are merged in by `usePlugins` and only remember an `enabled: false`. */
export const installedPluginsAtom = atomWithStorage<PluginInstall[]>("scmjs.plugins", [], createJSONStorage(browserStorage), { getOnInit: true });

/** What was last read out of a plugin's `plugin.json` — see `pluginManifestCacheAtom`. */
export interface CachedManifest {
  manifest: PluginManifest;
  icon: PluginIcon | null;
  /** When it was fetched (ms), so a stale entry can be spotted; nothing expires it today. */
  at: number;
}

/**
 * Manifests seen before, so Manage Plugins can name and describe a plugin that is *not*
 * running the moment it opens instead of showing a bare spec until the network answers.
 * `describePlugin` fills it from one `plugin.json` fetch (no code) and refreshes it in the
 * background; built-ins are never cached (nothing to fetch, and their icon URLs are
 * build-hashed).
 */
export const pluginManifestCacheAtom = atomWithStorage<Record<string, CachedManifest>>(
  "scmjs.plugin-manifests", {}, createJSONStorage(browserStorage), { getOnInit: true },
);

/** Everything one load of a plugin fetched: the manifest and each module's source, by URL. */
export interface PluginSnapshot {
  files: Record<string, string>;
  /** When the copy was made (ms). */
  at: number;
  /** Roughly what it costs in storage (characters). */
  size: number;
}

/**
 * The code of the plugins marked `local`, kept so they load without a network request.
 * Written by `activatePlugin` after a load that went to the network, read by the next
 * one. Nothing else expires it: a copy is replaced when the user presses Reload.
 */
export const pluginCodeAtom = atomWithStorage<Record<string, PluginSnapshot>>(
  "scmjs.plugin-code", {}, createJSONStorage(browserStorage), { getOnInit: true },
);

/* ── Registries (persisted) ─────────────────────────────── */

/**
 * Registries the user added, on top of `DEFAULT_REGISTRIES` — the lists Plugins ▸ Browse
 * offers to install from (`plugins/registry.ts`). A fork with plugins of its own points
 * the editor at them by adding one here rather than by changing any code.
 */
export const userRegistriesAtom = atomWithStorage<string[]>("scmjs.plugin-registries", [], createJSONStorage(browserStorage), { getOnInit: true });

/** The last index read from a registry, with when it was read. */
export interface CachedRegistry {
  registry: Registry;
  /** When it was fetched (ms). `REGISTRY_MAX_AGE` decides when to ask again. */
  at: number;
}

/**
 * The last list each registry gave, so Browse paints from storage while the refresh runs
 * and still has something to show when the network does not answer.
 */
export const registryCacheAtom = atomWithStorage<Record<string, CachedRegistry>>(
  "scmjs.plugin-registry", {}, createJSONStorage(browserStorage), { getOnInit: true },
);

/** How the last fetch of one registry went — the spinner and the error line under Browse. */
export interface RegistryState {
  status: "idle" | "loading" | "ok" | "error";
  error?: string | null;
}

export const registryStateAtom = atom<Record<string, RegistryState>>({});

/* ── Runtime ────────────────────────────────────────────── */

export type PluginStatus = "loading" | "active" | "error" | "disabled";

export interface PluginRuntime {
  spec: string;
  status: PluginStatus;
  manifest: PluginManifest | null;
  /** The manifest's `icon`, resolved by the loader; null when it declared none. */
  icon: PluginIcon | null;
  /** The message when `status` is `"error"`. */
  error: string | null;
  /** A `describePlugin` fetch is in flight (the manifest shown, if any, may be stale). */
  describing?: boolean;
  /** Where the code that is running came from, for a plugin the user asked to keep a copy of. */
  loadedFrom?: "network" | "browser";
  /** What the plugin added, for the Manage Plugins dialog. */
  contributions: { menu: number; contextMenu: number; hotkeys: number; events: number };
}

export const pluginRuntimesAtom = atom<Record<string, PluginRuntime>>({});

/* ── Contribution registries ────────────────────────────── */

let contributionSeq = 0;
/** A unique key per registered contribution, so React lists and removals have something to hold. */
export const nextContributionKey = () => ++contributionSeq;

/** A registered menu item: the spec with `icon: "plugin"` already resolved to the plugin's icon. */
export interface PluginMenuItem extends Omit<MenuItemSpec, "icon" | "run" | "command"> {
  key: number;
  pluginId: string;
  path: MenuPath;
  icon?: PluginIcon;
  /** Always resolved: an item registered with a `command` gets a `run` that calls it. */
  run: () => void;
}

export interface PluginContextItem extends Omit<ContextItemSpec, "run" | "command"> {
  key: number;
  pluginId: string;
  surface: ContextSurface;
  run: (ctx: ContextMenuContext) => void;
}

/**
 * A command a plugin registered: a named thing to do, which a menu item, a hotkey, a
 * context entry or another plugin can all reach by id (`commands.run`).
 */
export interface PluginCommand {
  key: number;
  pluginId: string;
  /** Namespaced under the plugin unless the plugin gave a dotted id of its own. */
  id: string;
  title: string;
  enabled?: () => boolean;
  run: (...args: unknown[]) => unknown;
}

export const pluginCommandsAtom = atom<PluginCommand[]>([]);

export interface PluginHotkey {
  key: number;
  pluginId: string;
  /** Normalised: modifiers sorted `Ctrl+Alt+Shift+Meta`, then the key name, e.g. `Ctrl+Shift+I`. */
  combo: string;
  run: () => void;
}

export const pluginMenuItemsAtom = atom<PluginMenuItem[]>([]);
export const pluginContextItemsAtom = atom<PluginContextItem[]>([]);
export const pluginHotkeysAtom = atom<PluginHotkey[]>([]);

/**
 * A hotkey combo in the registry's form, from a keyboard event or from the string a
 * plugin wrote (`"shift+ctrl+i"` and `"Ctrl+Shift+I"` are the same key).
 */
export function normalizeCombo(combo: string): string {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const mods = new Set<string>();
  let key = "";
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === "ctrl" || l === "control") mods.add("Ctrl");
    else if (l === "alt" || l === "option") mods.add("Alt");
    else if (l === "shift") mods.add("Shift");
    else if (l === "meta" || l === "cmd" || l === "command" || l === "win") mods.add("Meta");
    else key = p.length === 1 ? p.toUpperCase() : p;
  }
  const order = ["Ctrl", "Alt", "Shift", "Meta"].filter((m) => mods.has(m));
  return [...order, key].join("+");
}

export function comboOfEvent(e: KeyboardEvent): string {
  const key = e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(key);
  return parts.join("+");
}

/* ── Interactive picks on the map ───────────────────────── */

export type MapPickKind = "area" | "tile";

/**
 * A plugin waiting for the user to drag a rectangle (or click a tile) on the map —
 * `api.ui.pickArea` / `api.ui.pickTile`. While set, the viewport shows a crosshair,
 * draws the marquee and takes the gesture ahead of every layer's own tools; Esc or a
 * right-click cancels. `finish` is called exactly once (the host guards it) and clears
 * the atom itself.
 */
export interface MapPickRequest {
  key: number;
  kind: MapPickKind;
  /** What the HUD shows while picking. */
  prompt: string;
  pluginId: string;
  finish: (result: Rect | { x: number; y: number } | null) => void;
}

export const mapPickAtom = atom<MapPickRequest | null>(null);

/** Cancel the pick in progress, if any (Esc, right-click, a document change). */
export const cancelMapPickAtom = atom(null, (get) => {
  const pick = get(mapPickAtom);
  if (pick) pick.finish(null);
  return pick !== null;
});

/* ── Tools on the map ───────────────────────────────────── */

/**
 * A plugin's `api.ui.mapTool` in progress: the viewport hands it the pointer ahead of
 * every layer, hides the layer's brush ghost and calls its `draw` last. Like a pick,
 * `finish` runs once (the host guards it) and clears the atom itself; unlike a pick it
 * stays until something finishes it.
 */
export interface MapToolRequest {
  key: number;
  pluginId: string;
  spec: MapToolSpec;
  finish: (reason: MapToolStopReason) => void;
}

export const mapToolAtom = atom<MapToolRequest | null>(null);

/** Bumped by `MapToolHandle.redraw`; the viewport repaints when it changes. */
export const mapToolRevisionAtom = atom(0);

/**
 * Esc or a right-click while a tool runs: the tool's `onCancel` may keep it (it was
 * cancelling a gesture of its own); otherwise it stops. True when a tool was running.
 */
export const cancelMapToolAtom = atom(null, (get) => {
  const tool = get(mapToolAtom);
  if (!tool) return false;
  let keep = false;
  try { keep = tool.spec.onCancel?.() === true; } catch (err) { console.error("[plugins] map tool onCancel failed", err); }
  if (!keep) tool.finish("cancelled");
  return true;
});

/* ── Overlays ───────────────────────────────────────────── */

/**
 * One `api.ui.overlay`: a picture the viewport draws at the spec's slot while `visible`,
 * listed under View ▸ Overlays and in the Layers panel. The list is in registration
 * order; `visible` is the one field the chrome writes (through `setOverlayVisibleAtom`).
 */
export interface PluginOverlayEntry {
  key: number;
  plugin: PluginInfo;
  spec: OverlaySpec;
  visible: boolean;
}

export const pluginOverlaysAtom = atom<PluginOverlayEntry[]>([]);

/** Bumped by `OverlayHandle.redraw`; the viewport repaints when it changes. */
export const pluginOverlayRevisionAtom = atom(0);

/**
 * What the user last set each overlay to, by plugin and name, for the session — so a
 * plugin reloaded or re-enabled comes back the way it was left, like a panel's position.
 */
export const overlayVisibilityMemory = new Map<string, boolean>();

export const overlayMemoryKey = (pluginId: string, name: string) => `${pluginId}\u0000${name}`;

/**
 * Show or hide one overlay. Every writer goes through here — the View menu, the Layers
 * panel and the plugin's own handle — so the spec's `onToggle` fires once per change
 * whichever way it came, and the session memory is kept.
 */
export const setOverlayVisibleAtom = atom(null, (get, set, key: number, visible: boolean) => {
  const list = get(pluginOverlaysAtom);
  const entry = list.find((o) => o.key === key);
  if (!entry || entry.visible === visible) return false;
  set(pluginOverlaysAtom, list.map((o) => (o === entry ? { ...o, visible } : o)));
  overlayVisibilityMemory.set(overlayMemoryKey(entry.plugin.id, entry.spec.name), visible);
  try { entry.spec.onToggle?.(visible); } catch (err) { console.error(`[${entry.plugin.name}] overlay onToggle failed`, err); }
  set(pluginOverlayRevisionAtom, get(pluginOverlayRevisionAtom) + 1);
  return true;
});

/* ── Floating panels ────────────────────────────────────── */

/** The title of a plugin dialog or panel, changeable through its handle without touching the spec. */
export interface TitleBox {
  value: string;
  listeners: Set<() => void>;
}

/** One `api.ui.panel`, rendered by `PluginPanels` over the map. */
export interface PluginPanelEntry {
  key: number;
  plugin: PluginInfo;
  spec: PanelSpec;
  handle: PanelHandle;
  title: TitleBox;
}

export const pluginPanelsAtom = atom<PluginPanelEntry[]>([]);

/* ── Trigger claims ─────────────────────────────────────── */

/** A run of triggers a plugin generates and owns (`api.triggers.claim`), as the trigger editors see it. */
export interface PluginTriggerClaim {
  key: number;
  pluginId: string;
  pluginName: string;
  spec: TriggerClaimSpec;
  /** Bumped by the handle's `refresh`, so editors that memoised `locate` ask again. */
  revision: number;
}

/** Every live claim; `plugins/claims.ts#locateClaims` is how a list is read against them. */
export const pluginTriggerClaimsAtom = atom<PluginTriggerClaim[]>([]);
