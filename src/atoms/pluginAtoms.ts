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
  ContextItemSpec, ContextSurface, MapToolSpec, MapToolStopReason, MenuItemSpec, MenuPath, PanelHandle, PanelSpec, PluginIcon, PluginInfo, PluginManifest,
} from "../plugins/api";
import type { Rect } from "../editor/terrain";
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

export interface PluginMenuItem extends MenuItemSpec {
  key: number;
  pluginId: string;
  path: MenuPath;
}

export interface PluginContextItem extends ContextItemSpec {
  key: number;
  pluginId: string;
  surface: ContextSurface;
}

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
