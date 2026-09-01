/**
 * Turn the plugin context-menu registry into the `{ label, disabled, onSelect }` rows a
 * surface's menu renders, for one right-click's context. A plugin callback that throws
 * hides or disables its item rather than breaking the menu.
 */
import type { PluginContextItem } from "../atoms/pluginAtoms";
import type { ContextMenuContext, ContextSurface } from "./api";

export interface ContextRow {
  key: number;
  label: string;
  disabled: boolean;
  onSelect: () => void;
}

export function pluginContextRows(items: readonly PluginContextItem[], surface: ContextSurface, ctx: ContextMenuContext): ContextRow[] {
  const rows: ContextRow[] = [];
  for (const it of items) {
    if (it.surface !== surface) continue;
    try {
      if (it.visible && !it.visible(ctx)) continue;
      rows.push({
        key: it.key,
        label: typeof it.label === "function" ? it.label(ctx) : it.label,
        disabled: it.enabled ? !it.enabled(ctx) : false,
        onSelect: () => { try { it.run(ctx); } catch (err) { console.error(`[plugins] context-menu item failed`, err); } },
      });
    } catch (err) {
      console.error(`[plugins] context-menu item failed`, err);
    }
  }
  return rows;
}
