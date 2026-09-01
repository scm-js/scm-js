/**
 * Plugin state: what is installed (persisted), what is running, and the registries the
 * chrome reads to show a plugin's menu items, context-menu entries and hotkeys.
 *
 * The registries hold plain records with the plugin's id on them so disabling a plugin
 * can sweep its contributions out even when it forgot to dispose them itself.
 */
import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { ContextItemSpec, ContextSurface, MenuItemSpec, MenuPath, PluginIcon, PluginManifest } from "../plugins/api";

/* ── Installed (persisted) ──────────────────────────────── */

export interface PluginInstall {
  /** `builtin:<name>`, `github:owner/repo[@ref][/dir]`, or a URL — see `plugins/loader.ts`. */
  spec: string;
  enabled: boolean;
}

const memory = new Map<string, string>();
const memoryStorage: Storage = {
  get length() { return memory.size; },
  clear: () => memory.clear(),
  getItem: (k) => memory.get(k) ?? null,
  key: (i) => [...memory.keys()][i] ?? null,
  removeItem: (k) => { memory.delete(k); },
  setItem: (k, v) => { memory.set(k, v); },
};

function storage(): Storage {
  try {
    if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
  } catch {
    // Storage disabled; fall through.
  }
  return memoryStorage;
}

/** Remote plugins the user added; built-ins are merged in by `usePlugins` and only remember an `enabled: false`. */
export const installedPluginsAtom = atomWithStorage<PluginInstall[]>("scmjs.plugins", [], createJSONStorage(storage), { getOnInit: true });

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
