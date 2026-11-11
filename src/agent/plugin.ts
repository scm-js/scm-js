/**
 * Claude Agent — a built-in plugin: a panel where Claude reads and edits the
 * open map with the user, through the same plugin API every plugin uses. Tools ▸ Claude
 * Agent (Ctrl+Alt+C) and the status-bar cell open it.
 *
 * This file is all that loads at startup. The controller, the tools, the Anthropic SDK and
 * the panel's UI are one chunk loaded the first time the panel opens.
 */
import type { PanelHandle, PanelSpec, PluginApi } from "../plugins/api";
import type { AgentController } from "./controller";
import type { Placement } from "./settings";

export function activate(api: PluginApi): void {
  let panel: PanelHandle | null = null;
  let controller: Promise<AgentController> | null = null;

  const status = api.ui.statusItem({ text: "Claude", title: "Claude Agent (Ctrl+Alt+C)", onClick: () => toggle() });

  const load = (): Promise<AgentController> => {
    controller ??= import("./controller").then((m) => new m.AgentController(api, status, reopen));
    return controller;
  };

  /** A floating window tall enough to read a conversation in; the docks size themselves. */
  const where = (): Pick<PanelSpec, "dock" | "grow" | "width" | "height" | "resizable" | "maximizable" | "flush"> => {
    const placement = api.storage.get<{ placement?: Placement }>("settings", {}).placement ?? "float";
    if (placement === "right") return { dock: "right", grow: true };
    if (placement === "bottom") return { dock: "bottom", height: 280 };
    return { dock: "float", width: 400, height: Math.max(360, Math.min(760, Math.round(window.innerHeight * 0.72))), resizable: true, maximizable: true };
  };

  const open = () => {
    if (panel?.isOpen()) return;
    panel = api.ui.panel({
      title: "Claude",
      ...where(),
      mount(body) {
        let cleanup: (() => void) | null = null;
        let gone = false;
        void Promise.all([load(), import("./ui/mount")]).then(([c, ui]) => {
          if (!gone) cleanup = ui.mountAgent(body, c);
        }).catch((err) => {
          body.textContent = `The Claude panel could not load: ${err instanceof Error ? err.message : String(err)}`;
        });
        return () => { gone = true; cleanup?.(); };
      },
      onClose: () => { panel = null; },
    });
  };

  /** Close and open again, after the placement setting changed. The conversations live in the controller and carry on. */
  function reopen(): void {
    panel?.close();
    panel = null;
    open();
  }

  const toggle = () => (panel?.isOpen() ? panel.close() : open());

  // Nothing opens by itself: a window appearing over the map on a first visit would be in
  // the way. The status-bar cell is always there to find it by.
  api.menu.add("Tools", { label: "Claude Agent", shortcut: "Ctrl+Alt+C", icon: "plugin", run: toggle });
  api.hotkeys.add("Ctrl+Alt+C", toggle);
}
