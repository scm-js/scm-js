import { Fragment, type ReactNode } from "react";
import { Menubar } from "radix-ui";
import { Check, ChevronRight, Dot } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import AppLogo from "../ui/AppLogo";
import { isDesktop } from "../../editor/platform";
import {
  activeLayerAtom,
  brushSizeAtom,
  clipboardAtom,
  mapModifiedAtom,
  mapNameAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  viewFlagsAtom,
  zoomAtom,
  ZOOM_STEPS,
  zoomToFitAtom,
  type EditorLayer,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import { desktopBridge } from "../../gamedata/desktop";
import {
  activeDocumentIdAtom, deleteSelectedDoodadsAtom, deleteSelectedLocationsAtom, deleteSelectedSpritesAtom, deleteSelectedUnitsAtom, documentTabsAtom, recentFilesAtom, redoAtom, scenarioAtom,
  selectAllAtom, undoAtom,
} from "../../atoms/documentAtoms";
import { openDialogAtom, panelsAtom, statusMessageAtom, type DialogId, type PanelVisibility } from "../../atoms/uiAtoms";
import { debugConsoleAtom, diagnosticsTextAtom } from "../../atoms/logAtoms";
import { BUG_REPORT_BUDGET, formatLog, logDropped, logEntries } from "../../editor/log";
import { pluginMenuItemsAtom, pluginOverlaysAtom, setOverlayVisibleAtom, type PluginMenuItem } from "../../atoms/pluginAtoms";
import type { PluginIcon } from "../../plugins/api";
import { PluginIconView } from "../ui/PluginIconView";
import { activateDocumentIn, clearRecents, quitGuard, stepDocumentIn, useMapFileActions } from "../../hooks/useMapFileActions";
import { useTerrainTools } from "../../hooks/useTerrainTools";
import { useClipboardTools } from "../../hooks/useClipboardTools";
import { msg, t, translate } from "../../i18n";
import { useT } from "../../i18n/react";

const REPO_URL = "https://github.com/scm-js/scm-js";

/* ── Menu model ─────────────────────────────────────────── */

/**
 * A `label` is the item's English name and its identity: plugins place items by it
 * (`api.menu.add("File/Import", { after: "Open Recent" })`), whatever language the menu
 * is showing, and the renderer shows `translate(label)`. Built-in labels are marked with
 * `msg()` so the extractor lists them; a label built at run time (Undo *what*, a recent
 * file) is translated where it is built and passes through `translate` unchanged.
 */
type Item =
  | { kind: "item"; label: string; shortcut?: string; disabled?: boolean; icon?: PluginIcon; onSelect?: () => void; dialog?: DialogId; payload?: Record<string, unknown> }
  | { kind: "check"; label: string; shortcut?: string; checked: boolean; onChange: (v: boolean) => void }
  | { kind: "radio-group"; value: string; onChange: (v: string) => void; items: { value: string; label: string; shortcut?: string }[] }
  | { kind: "sub"; label: string; items: Item[] }
  | { kind: "sep" }
  | { kind: "label"; label: string };

const sep: Item = { kind: "sep" };

export interface Menu {
  label: string;
  items: Item[];
}

/**
 * Merge what plugins registered into the menu model: each item goes to the end of the
 * top-level menu or submenu its path names (`"File/Import"`), after one separator — or,
 * when `after` names an item or submenu in that menu, directly under it. A path whose
 * last segment names no submenu gets one made for it (`"Tools/AI"` — a submenu of the
 * plugin's own, at the end of Tools); a top-level menu that does not exist is made for
 * the plugin, before Help (`"Account"`), holding only what plugins put there. Pure, so it
 * is testable.
 */
export function withPluginItems(menus: Menu[], plugin: readonly PluginMenuItem[]): Menu[] {
  if (plugin.length === 0) return menus;
  const out = menus.map((m) => ({ ...m, items: [...m.items] }));
  const findSub = (items: Item[], label: string): Extract<Item, { kind: "sub" }> | null => {
    for (const it of items) {
      if (it.kind !== "sub") continue;
      if (it.label === label) return it;
      const deeper = findSub(it.items, label);
      if (deeper) return deeper;
    }
    return null;
  };
  const separated = new Set<Item[]>();
  const copied = new Set<Item>();
  const placed = new Set<Item>();
  for (const p of plugin) {
    const [top, ...rest] = p.path.split("/");
    let target: Item[] | null = null;
    let menu = out.find((m) => m.label === top) ?? null;
    if (!menu && top.trim()) {
      // A top-level menu of the plugin's own, before Help so the built-in order stays readable.
      menu = { label: top, items: [] };
      separated.add(menu.items);
      const help = out.findIndex((m) => m.label === "Help");
      out.splice(help >= 0 ? help : out.length, 0, menu);
    }
    if (menu) {
      target = menu.items;
      for (const label of rest) {
        let sub = findSub(target, label);
        if (!sub) {
          // A submenu of the plugin's own: created at the end of the menu, after a separator, on first use.
          if (label !== rest[rest.length - 1]) { target = null; break; }
          sub = { kind: "sub", label, items: [] };
          copied.add(sub);
          // Its items are all the plugin's: no separator before the first, only the ones it asks for.
          separated.add(sub.items);
          if (!separated.has(target) && target.length > 0) { target.push(sep); separated.add(target); }
          target.push(sub);
          target = sub.items;
          continue;
        }
        if (copied.has(sub)) { target = sub.items; continue; }
        // Copy the submenu once so the caller's model is untouched.
        const copy = { ...sub, items: [...sub.items] };
        copied.add(copy);
        target.splice(target.indexOf(sub), 1, copy);
        target = copy.items;
      }
      if (!target) target = menu.items;
    }
    if (!target) continue;
    const item: Item = {
      kind: "item",
      label: p.label,
      shortcut: p.shortcut,
      icon: p.icon,
      disabled: p.enabled ? !safely(p.enabled, true) : false,
      onSelect: () => { safely(p.run, undefined); },
    };
    // `after`: under the named built-in (or an earlier plugin item that landed there), no separator.
    const anchor = p.after ? target.findIndex((it) => (it.kind === "item" || it.kind === "sub") && it.label === p.after) : -1;
    if (anchor >= 0) {
      let at = anchor + 1;
      while (at < target.length && placed.has(target[at])) at++;
      target.splice(at, 0, item);
      placed.add(item);
      continue;
    }
    if (!separated.has(target) && target.length > 0) { target.push(sep); separated.add(target); }
    else if (p.separator && target.length > 0 && target[target.length - 1].kind !== "sep") target.push(sep);
    target.push(item);
  }
  return out;
}

function safely<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch (err) { console.error("[plugins] menu item failed", err); return fallback; }
}

/** The layers by id, `label` English (show it through `translate`). */
export const LAYERS: { id: EditorLayer; label: string; key: string }[] = [
  { id: "terrain", label: msg("Terrain"), key: "T" },
  { id: "doodads", label: msg("Doodads"), key: "D" },
  { id: "units", label: msg("Units"), key: "U" },
  { id: "sprites", label: msg("Sprites"), key: "S" },
  { id: "locations", label: msg("Locations"), key: "L" },
  { id: "fog", label: msg("Fog of War"), key: "F" },
  { id: "clipboard", label: msg("Cut / Copy / Paste"), key: "C" },
];

export const ZOOM_LEVELS = ZOOM_STEPS;

function useMenus(): Menu[] {
  const t = useT();
  const open = useSetAtom(openDialogAtom);
  const pluginItems = useAtomValue(pluginMenuItemsAtom);
  const overlays = useAtomValue(pluginOverlaysAtom);
  const setOverlayVisible = useSetAtom(setOverlayVisibleAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  // Beside Report an Issue, and the only copy most map makers will find — so it carries the
  // log as well as the header, capped at what a GitHub issue body will take (`log.ts`).
  const copyBugReport = () => {
    void navigator.clipboard.writeText(formatLog(logEntries(), diagnostics, logDropped(), BUG_REPORT_BUDGET)).then(
      () => setStatus(t("Bug report copied — the build, the game data source, the plugins and the log.")),
      () => setStatus(t("The browser did not allow copying; open View ▸ Debug Console and save the log instead.")),
    );
  };
  const store = useStore();
  const desktop = desktopBridge();
  const zoomToFit = useSetAtom(zoomToFitAtom);
  const hasMap = useAtomValue(scenarioAtom) !== null;
  const { fillMap } = useTerrainTools();
  const recent = useAtomValue(recentFilesAtom);
  const deleteUnits = useSetAtom(deleteSelectedUnitsAtom);
  const deleteDoodads = useSetAtom(deleteSelectedDoodadsAtom);
  const deleteSprites = useSetAtom(deleteSelectedSpritesAtom);
  const deleteLocations = useSetAtom(deleteSelectedLocationsAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const [consoleOpen, setConsoleOpen] = useAtom(debugConsoleAtom);
  const diagnostics = useAtomValue(diagnosticsTextAtom);
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const [brush, setBrush] = useAtom(brushSizeAtom);
  const { save, openRecent } = useMapFileActions();
  const tabs = useAtomValue(documentTabsAtom);
  const activeId = useAtomValue(activeDocumentIdAtom);
  const [undoLabel, undo] = useAtom(undoAtom);
  const [redoLabel, redo] = useAtom(redoAtom);
  const clipTools = useClipboardTools();
  const hasClip = useAtomValue(clipboardAtom) !== null;

  const flag = (k: keyof ViewFlags, label: string, shortcut?: string): Item => ({
    kind: "check",
    label,
    shortcut,
    checked: flags[k],
    onChange: (v) => setFlags({ ...flags, [k]: v }),
  });
  const panel = (k: keyof PanelVisibility, label: string): Item => ({
    kind: "check",
    label,
    checked: panels[k],
    onChange: (v) => setPanels({ ...panels, [k]: v }),
  });
  const dlg = (label: string, dialog: DialogId, shortcut?: string, disabled?: boolean): Item => ({ kind: "item", label, dialog, shortcut, disabled });
  const dlgWith = (label: string, dialog: DialogId, payload: Record<string, unknown>, shortcut?: string): Item => ({ kind: "item", label, dialog, payload, shortcut });
  const link = (label: string, url: string): Item => ({ kind: "item", label, onSelect: () => { window.open(url, "_blank", "noopener,noreferrer"); } });

  // Edit ▸ Delete / Select All / Deselect act on the active layer's selection, as the Del / Esc keys do.
  const deleteSelection = () => {
    if (layer === "clipboard") { clipTools.deleteRegion(); return; }
    const n = layer === "doodads" ? deleteDoodads() : layer === "sprites" ? deleteSprites() : layer === "locations" ? deleteLocations() : deleteUnits();
    if (n === 0) { setStatus(t("Nothing selected")); return; }
    setStatus(layer === "doodads" ? t("Deleted {n, plural, one {# doodad} other {# doodads}}", { n })
      : layer === "sprites" ? t("Deleted {n, plural, one {# sprite} other {# sprites}}", { n })
        : layer === "locations" ? t("Deleted {n, plural, one {# location} other {# locations}}", { n })
          : t("Deleted {n, plural, one {# unit} other {# units}}", { n }));
  };
  const selectAll = () => {
    if (!store.get(scenarioAtom)) return;
    if (layer === "clipboard") { clipTools.selectAll(); return; }
    const n = store.set(selectAllAtom, layer);
    if (!["doodads", "sprites", "locations", "units"].includes(layer)) setLayer("units");
    setStatus(layer === "doodads" ? t("Selected {n, plural, one {# doodad} other {# doodads}}", { n })
      : layer === "sprites" ? t("Selected {n, plural, one {# sprite} other {# sprites}}", { n })
        : layer === "locations" ? t("Selected {n, plural, one {# location} other {# locations}}", { n })
          : t("Selected {n, plural, one {# unit} other {# units}}", { n }));
  };
  const deselect = () => {
    clipTools.stopPasting();
    clipTools.clearSelection();
    store.set(selectedUnitsAtom, []);
    store.set(selectedDoodadsAtom, []);
    store.set(selectedSpritesAtom, []);
    store.set(selectedLocationsAtom, []);
  };
  const zoomIn = () => setZoom(ZOOM_LEVELS.find((z) => z > zoom) ?? zoom);
  const zoomOut = () => setZoom([...ZOOM_LEVELS].reverse().find((z) => z < zoom) ?? zoom);

  const menus: Menu[] = [
    {
      label: msg("File"),
      items: [
        dlg(msg("New…"), "newMap", "Ctrl+N"),
        dlg(msg("Open…"), "openMap", "Ctrl+O"),
        {
          kind: "sub",
          label: msg("Open Recent"),
          items: [
            // An entry reopens from the handle kept for it (Chromium, the desktop app); without one the name is a reminder and Open… is the way.
            ...(recent.length > 0
              ? recent.map<Item>((r) => ({ kind: "item", label: r.handleKey ? r.name : t("{name} (open with File ▸ Open…)", { name: r.name }), disabled: !r.handleKey, onSelect: () => { void openRecent(r); } }))
              : [{ kind: "item", label: msg("Nothing opened yet"), disabled: true } as Item]),
            sep,
            { kind: "item", label: msg("Clear Recent"), disabled: recent.length === 0, onSelect: () => clearRecents(store) },
          ],
        },
        sep,
        { kind: "item", label: msg("Save"), shortcut: "Ctrl+S", onSelect: () => { void save(); } },
        dlg(msg("Save As…"), "saveAs", "Ctrl+Shift+S"),
        dlgWith(msg("Save Copy As…"), "saveAs", { copy: true }),
        sep,
        {
          kind: "sub",
          label: msg("Import"),
          items: [
            dlgWith(msg("Triggers (.trg)…"), "importTriggers", { format: "trg" }),
            dlgWith(msg("Text Triggers (.txt)…"), "importTriggers", { format: "txt" }),
            dlg(msg("Strings (.txt)…"), "importStrings"),
          ],
        },
        {
          kind: "sub",
          label: msg("Export"),
          items: [
            { kind: "item", label: msg("Image (.png)…"), onSelect: () => open("exportImage") },
            sep,
            dlgWith(msg("Triggers (.trg)…"), "exportTriggers", { format: "trg" }),
            dlgWith(msg("Text Triggers (.txt)…"), "exportTriggers", { format: "txt" }),
            dlg(msg("Strings (.txt)…"), "exportStrings"),
          ],
        },
        sep,
        dlg(msg("Map Properties…"), "mapProperties", "Alt+Enter"),
        sep,
        // Ctrl+W is the browser's own (it closes the tab); only the desktop build can take it.
        dlg(msg("Close Map"), "confirmClose", desktop ? "Ctrl+W" : undefined),
        // A browser tab cannot close itself; the desktop build quits through the same unsaved-changes gate as its close button, one open map at a time.
        ...(desktop ? [sep, { kind: "item", label: msg("Exit"), shortcut: desktop.platform === "darwin" ? "Cmd+Q" : "Alt+F4", onSelect: () => { void quitGuard(store, true).then((quit) => { if (quit) desktop.window.respondClose(true); }); } } as Item] : []),
      ],
    },
    {
      label: msg("Edit"),
      items: [
        { kind: "item", label: undoLabel ? t("Undo {what}", { what: undoLabel }) : msg("Undo"), shortcut: "Ctrl+Z", disabled: !undoLabel, onSelect: () => { const l = undo(); if (l) setStatus(t("Undid: {what}", { what: l })); } },
        { kind: "item", label: redoLabel ? t("Redo {what}", { what: redoLabel }) : msg("Redo"), shortcut: "Ctrl+Y", disabled: !redoLabel, onSelect: () => { const l = redo(); if (l) setStatus(t("Redid: {what}", { what: l })); } },
        sep,
        { kind: "item", label: msg("Cut"), shortcut: "Ctrl+X", disabled: !hasMap, onSelect: () => { clipTools.cut(); } },
        { kind: "item", label: msg("Copy"), shortcut: "Ctrl+C", disabled: !hasMap, onSelect: () => { clipTools.copy(); } },
        { kind: "item", label: msg("Paste"), shortcut: "Ctrl+V", disabled: !hasMap || !hasClip, onSelect: () => { clipTools.paste(); } },
        { kind: "item", label: msg("Delete"), shortcut: "Del", disabled: !hasMap, onSelect: deleteSelection },
        sep,
        { kind: "item", label: msg("Select All"), shortcut: "Ctrl+A", disabled: !hasMap, onSelect: selectAll },
        { kind: "item", label: msg("Deselect"), shortcut: "Esc", disabled: !hasMap, onSelect: deselect },
        sep,
        dlg(msg("Find…"), "find", "Ctrl+F"),
        sep,
        dlg(msg("Preferences…"), "preferences", "Ctrl+,"),
      ],
    },
    {
      label: msg("View"),
      items: [
        { kind: "item", label: msg("Zoom In"), shortcut: "Ctrl++", onSelect: zoomIn },
        { kind: "item", label: msg("Zoom Out"), shortcut: "Ctrl+−", onSelect: zoomOut },
        {
          kind: "sub",
          label: msg("Zoom"),
          items: [{ kind: "radio-group", value: String(zoom), onChange: (v) => setZoom(Number(v)), items: ZOOM_LEVELS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%`, shortcut: z === 1 ? "Ctrl+0" : undefined })) }],
        },
        { kind: "item", label: msg("Zoom to Fit"), shortcut: "Ctrl+Shift+0", onSelect: () => { zoomToFit(); } },
        sep,
        flag("grid", msg("Grid"), "Ctrl+G"),
        dlg(msg("Grid Settings…"), "gridSettings"),
        sep,
        flag("units", msg("Units")),
        flag("doodads", msg("Doodads")),
        flag("sprites", msg("Sprites")),
        flag("locations", msg("Locations")),
        flag("locationNames", msg("Location Names")),
        flag("startLocations", msg("Start Locations")),
        flag("fog", msg("Fog of War")),
        flag("animateWater", msg("Animate Water")),
        flag("animateUnits", msg("Animate Units")),
        sep,
        flag("elevation", msg("Elevation Overlay")),
        flag("buildability", msg("Buildability Overlay")),
        // Plugin overlays (`api.ui.overlay`), each a tick like the built-in ones.
        ...overlays.map((o): Item => ({ kind: "check", label: o.spec.name, checked: o.visible, onChange: (v) => { setOverlayVisible(o.key, v); } })),
        sep,
        { kind: "sub", label: msg("Panels"), items: [panel("palette", msg("Palette")), panel("minimap", msg("Minimap")), panel("layers", msg("Layers")), panel("properties", msg("Properties")), sep, panel("toolbar", msg("Toolbar")), panel("statusbar", msg("Status Bar"))] },
        // Not in Panels: it is not one of the map's panels, and it is off unless something is wrong.
        { kind: "check", label: msg("Debug Console"), checked: consoleOpen, onChange: setConsoleOpen },
        sep,
        { kind: "item", label: msg("Full Screen"), shortcut: "F11", onSelect: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } },
      ],
    },
    {
      label: msg("Layer"),
      items: [
        { kind: "radio-group", value: layer, onChange: (v) => setLayer(v as EditorLayer), items: LAYERS.map((l) => ({ value: l.id, label: l.label, shortcut: l.key })) },
      ],
    },
    {
      label: msg("Scenario"),
      items: [
        dlg(msg("Map Properties…"), "mapProperties"),
        dlg(msg("Resize / Crop Map…"), "resizeMap"),
        dlg(msg("Map Revision…"), "mapRevision"),
        sep,
        dlg(msg("Player Settings…"), "playerSettings"),
        dlg(msg("Force Settings…"), "forceSettings"),
        dlg(msg("Player Colors…"), "playerColors"),
        sep,
        dlg(msg("Unit Settings…"), "unitSettings"),
        dlg(msg("Upgrade Settings…"), "upgradeSettings"),
        dlg(msg("Technology Settings…"), "techSettings"),
        sep,
        dlg(msg("String Editor…"), "stringEditor"),
        dlg(msg("Sound Editor…"), "soundEditor"),
        dlg(msg("Switches…"), "switches"),
        dlg(msg("Locations…"), "locationList"),
        sep,
        dlg(msg("Mission Briefing…"), "missionBriefing"),
      ],
    },
    {
      label: msg("Triggers"),
      items: [
        dlg(msg("Trigger Editor…"), "triggerEditor", "Ctrl+T"),
        dlg(msg("Mission Briefing Editor…"), "missionBriefing"),
        dlg(msg("Unit Properties Slots…"), "cuwpEditor"),
        sep,
        dlg(msg("Import Triggers…"), "importTriggers"),
        dlg(msg("Export Triggers…"), "exportTriggers"),
        sep,
        dlgWith(msg("Validate Triggers"), "validateMap", { only: "triggers" }),
      ],
    },
    {
      label: msg("Tools"),
      items: [
        dlg(msg("Symmetry…"), "symmetry"),
        { kind: "sub", label: msg("Brush Size"), items: [{ kind: "radio-group", value: String(brush), onChange: (v) => setBrush(Number(v)), items: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n} × ${n}` })) }] },
        sep,
        { kind: "item", label: msg("Fill Terrain"), disabled: !hasMap, onSelect: fillMap },
        dlg(msg("Replace Terrain…"), "replaceTerrain"),
        dlg(msg("Auto-place Start Locations…"), "autoStarts"),
        sep,
        dlg(msg("Check Map…"), "validateMap"),
        dlg(msg("Statistics…"), "statistics"),
        sep,
        dlgWith(msg("Test Map"), "testMap", { run: true }, "Ctrl+F5"),
        dlg(msg("Test Map Settings…"), "testMap"),
      ],
    },
    {
      label: msg("Plugins"),
      items: [
        dlgWith(msg("Browse Plugins…"), "plugins", { tab: "browse" }),
        dlg(msg("Manage Plugins…"), "plugins"),
      ],
    },
    {
      label: msg("Window"),
      items: [
        // Ctrl+Tab belongs to the browser's own tabs; only the desktop build can take it.
        { kind: "item", label: msg("Next Map"), shortcut: desktop ? "Ctrl+Tab" : undefined, disabled: tabs.length < 2, onSelect: () => { stepDocumentIn(store, 1); } },
        { kind: "item", label: msg("Previous Map"), shortcut: desktop ? "Ctrl+Shift+Tab" : undefined, disabled: tabs.length < 2, onSelect: () => { stepDocumentIn(store, -1); } },
        sep,
        ...(tabs.length > 0
          ? [{
            kind: "radio-group", value: String(activeId ?? ""), onChange: (v) => { activateDocumentIn(store, Number(v)); },
            items: tabs.map((t) => ({ value: String(t.id), label: `${t.modified ? "*" : ""}${t.fileName ?? t.name}` })),
          } as Item]
          : [{ kind: "item", label: msg("No map open"), disabled: true } as Item]),
      ],
    },
    {
      label: msg("Help"),
      items: [
        dlg(msg("Keyboard Shortcuts…"), "shortcuts", "F1"),
        dlg(msg("Game Data…"), "gameData"),
        // Desktop only: the web build has nothing to update.
        ...(isDesktop() ? [dlg(msg("Check for Updates…"), "update")] : []),
        link(msg("Documentation"), `${REPO_URL}#readme`),
        sep,
        // The whole of a bug report: the build, the game data source, the plugins and the
        // log. Beside Report an Issue, which is where it is pasted.
        { kind: "item", label: msg("Copy Bug Report"), onSelect: copyBugReport },
        link(msg("Report an Issue…"), `${REPO_URL}/issues/new`),
        sep,
        dlg(msg("About scmJS…"), "about"),
      ],
    },
  ];
  return withPluginItems(menus, pluginItems);
}

/* ── Rendering ──────────────────────────────────────────── */

function Items({ items }: { items: Item[] }): ReactNode {
  const open = useSetAtom(openDialogAtom);
  return items.map((it, i) => {
    switch (it.kind) {
      case "sep":
        return <Menubar.Separator key={i} className="menu-separator" />;
      case "label":
        return <Menubar.Label key={i} className="menu-label">{translate(it.label)}</Menubar.Label>;
      case "item":
        return (
          <Menubar.Item key={i} className="menu-item" disabled={it.disabled} onSelect={() => (it.dialog ? open(it.dialog, it.payload) : it.onSelect?.())}>
            {it.icon && <span className="indicator menu-icon"><PluginIconView icon={it.icon} size={14} /></span>}
            {translate(it.label)}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </Menubar.Item>
        );
      case "check":
        return (
          <Menubar.CheckboxItem key={i} className="menu-item" checked={it.checked} onCheckedChange={it.onChange}>
            <Menubar.ItemIndicator className="indicator"><Check size={12} /></Menubar.ItemIndicator>
            {translate(it.label)}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </Menubar.CheckboxItem>
        );
      case "radio-group":
        return (
          <Menubar.RadioGroup key={i} value={it.value} onValueChange={it.onChange}>
            {it.items.map((r) => (
              <Menubar.RadioItem key={r.value} value={r.value} className="menu-item">
                <Menubar.ItemIndicator className="indicator"><Dot size={18} strokeWidth={4} /></Menubar.ItemIndicator>
                {translate(r.label)}
                {r.shortcut && <span className="shortcut">{r.shortcut}</span>}
              </Menubar.RadioItem>
            ))}
          </Menubar.RadioGroup>
        );
      case "sub":
        return (
          <Menubar.Sub key={i}>
            <Menubar.SubTrigger className="menu-item">
              {translate(it.label)}
              <ChevronRight className="chev" size={13} />
            </Menubar.SubTrigger>
            <Menubar.Portal>
              <Menubar.SubContent className="menu-content" sideOffset={4} alignOffset={-5}>
                <Items items={it.items} />
              </Menubar.SubContent>
            </Menubar.Portal>
          </Menubar.Sub>
        );
    }
  });
}

export default function MenuBar() {
  const menus = useMenus();
  const name = useAtomValue(mapNameAtom);
  const modified = useAtomValue(mapModifiedAtom);

  return (
    <Menubar.Root className="menubar">
      <div className="brand" title={t("scmJS")}>
        <AppLogo size={16} />
        {t("scmJS")}
      </div>
      {menus.map((m) => (
        <Fragment key={m.label}>
          <Menubar.Menu>
            <Menubar.Trigger className="menu-trigger">{translate(m.label)}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu-content" align="start" sideOffset={1}>
                <Items items={m.items} />
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        </Fragment>
      ))}
      <div className="menubar-doc" title={modified ? translate("Unsaved changes") : translate("No unsaved changes")}>
        <span className={`dot ${modified ? "" : "clean"}`} />
        <span>{name}{modified ? " *" : ""}</span>
      </div>
    </Menubar.Root>
  );
}
