/**
 * What outlives the panel: the settings and one conversation per open map, keyed by the
 * document's id, so closing the panel mid-turn does not stop Claude, and switching map tabs
 * brings back that map's conversation. Loaded the first time the panel opens, with the
 * Anthropic SDK behind it, so an editor that never opens the agent never loads either.
 */
import type { PluginApi, StatusItemHandle } from "../plugins/api";
import { AgentSession } from "./session";
import { SettingsStore } from "./settings";

export class AgentController {
  readonly api: PluginApi;
  readonly settings: SettingsStore;
  /** Close and open the panel again, where the placement setting now says. */
  readonly reopen: () => void;
  private readonly status: StatusItemHandle;
  private sessions = new Map<number | "none", AgentSession>();
  private listeners = new Set<() => void>();
  private busyCount = 0;

  constructor(api: PluginApi, status: StatusItemHandle, reopen: () => void) {
    this.api = api;
    this.status = status;
    this.reopen = reopen;
    this.settings = new SettingsStore(api);
    api.events.on("document", (e) => {
      if (e.reason === "close") {
        for (const id of this.sessions.keys()) {
          if (id !== "none" && !api.document.list().some((d) => d.id === id)) {
            this.sessions.get(id)?.stop();
            this.sessions.delete(id);
          }
        }
      }
      for (const fn of this.listeners) fn();
    });
  }

  /** The conversation about the map in front. */
  current(): AgentSession {
    const key = this.api.document.id() ?? "none";
    let s = this.sessions.get(key);
    if (!s) {
      s = new AgentSession(this.api, () => this.settings.get(), (busy) => this.busyChanged(busy));
      this.sessions.set(key, s);
    }
    return s;
  }

  /** Fires when the map in front changes, so the panel shows that map's conversation. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private busyChanged(busy: boolean): void {
    this.busyCount = Math.max(0, this.busyCount + (busy ? 1 : -1));
    this.status.set({ text: this.busyCount ? "Claude · working" : "Claude", busy: this.busyCount > 0 });
  }
}
