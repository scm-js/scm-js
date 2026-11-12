/**
 * The agent's settings, kept in the plugin's own storage (the browser's local storage,
 * listed under Preferences ▸ Storage). The API key is kept there only when the user ticks
 * "Remember the key on this device"; otherwise it lives in memory until the page closes.
 */
import type { PluginApi } from "../plugins/api";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
/** When to ask before a change: every change, only the ones that delete or replace work, or never. */
export type ApprovalMode = "all" | "destructive" | "never";
/** Where the panel sits: a window over the map, the right dock under the built-in panels, or a strip under the map. */
export type Placement = "float" | "right" | "bottom";

export interface ModelInfo {
  id: string;
  label: string;
  /** Dollars per million tokens. */
  price: { input: number; output: number; cacheRead: number };
  /** Whether the API can re-run a declined request on a fallback model (`fallbacks: "default"`). */
  fallbacks: boolean;
}

export const MODELS: readonly ModelInfo[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", price: { input: 4, output: 20, cacheRead: 0.2 }, fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", price: { input: 2, output: 10, cacheRead: 0.1 }, fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", price: { input: 0.1, output: 0.5, cacheRead: 0.01 }, fallbacks: false },
];

export const EFFORTS: readonly { id: Effort; label: string }[] = [
  { id: "low", label: "Quick" },
  { id: "medium", label: "Standard" },
  { id: "high", label: "Thorough" },
  { id: "xhigh", label: "Extra thorough" },
];

export interface AgentSettings {
  apiKey: string;
  rememberKey: boolean;
  /** Blank for api.anthropic.com; a proxy's address (which may add the key itself) otherwise. */
  baseURL: string;
  model: string;
  effort: Effort;
  approval: ApprovalMode;
  /** Bring each edit on screen while the user leaves the view alone. */
  followEdits: boolean;
  /** Show summaries of Claude's reasoning in the transcript. */
  showThinking: boolean;
  placement: Placement;
}

export const DEFAULTS: AgentSettings = {
  apiKey: "",
  rememberKey: false,
  baseURL: "",
  model: MODELS[0].id,
  effort: "high",
  approval: "destructive",
  followEdits: true,
  showThinking: true,
  placement: "float",
};

export class SettingsStore {
  private value: AgentSettings;
  private listeners = new Set<() => void>();
  private readonly api: PluginApi;

  constructor(api: PluginApi) {
    this.api = api;
    const stored = api.storage.get<Partial<AgentSettings>>("settings", {});
    this.value = { ...DEFAULTS, ...stored };
    if (!MODELS.some((m) => m.id === this.value.model)) this.value.model = DEFAULTS.model;
  }

  get(): AgentSettings {
    return this.value;
  }

  /** Whether a request can be made: a key, or a proxy that supplies one. */
  ready(): boolean {
    return this.value.apiKey.trim() !== "" || this.value.baseURL.trim() !== "";
  }

  set(patch: Partial<AgentSettings>): boolean {
    this.value = { ...this.value, ...patch };
    const ok = this.api.storage.set("settings", this.value.rememberKey ? this.value : { ...this.value, apiKey: "" });
    for (const fn of this.listeners) fn();
    return ok;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
