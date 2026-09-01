import { Fragment, type ReactNode } from "react";
import { Menubar } from "radix-ui";
import { Check, ChevronRight, Dot } from "lucide-react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import AppLogo from "../ui/AppLogo";
import {
  activeLayerAtom,
  brushSizeAtom,
  mapModifiedAtom,
  mapNameAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  viewFlagsAtom,
  zoomAtom,
  type EditorLayer,
  type ViewFlags,
} from "../../atoms/editorAtoms";
import {
  deleteSelectedDoodadsAtom, deleteSelectedLocationsAtom, deleteSelectedSpritesAtom, deleteSelectedUnitsAtom, recentFilesAtom, redoAtom, scenarioAtom, undoAtom,
} from "../../atoms/documentAtoms";
import { openDialogAtom, panelsAtom, statusMessageAtom, type DialogId, type PanelVisibility } from "../../atoms/uiAtoms";
import { useMapFileActions } from "../../hooks/useMapFileActions";
import { useIsomRebuild } from "../../hooks/useIsom";
import { useTerrainTools } from "../../hooks/useTerrainTools";
import { usedLocations } from "../../editor/locations";
import { ANYWHERE_INDEX } from "../../formats/chk/sections/objects";

const REPO_URL = "https://github.com/jeany55/scm-js";

/* ── Menu model ─────────────────────────────────────────── */

type Item =
  | { kind: "item"; label: string; shortcut?: string; disabled?: boolean; onSelect?: () => void; dialog?: DialogId; payload?: Record<string, unknown> }
  | { kind: "check"; label: string; shortcut?: string; checked: boolean; onChange: (v: boolean) => void }
  | { kind: "radio-group"; value: string; onChange: (v: string) => void; items: { value: string; label: string; shortcut?: string }[] }
  | { kind: "sub"; label: string; items: Item[] }
  | { kind: "sep" }
  | { kind: "label"; label: string };

const sep: Item = { kind: "sep" };

export const LAYERS: { id: EditorLayer; label: string; key: string }[] = [
  { id: "terrain", label: "Terrain", key: "T" },
  { id: "doodads", label: "Doodads", key: "D" },
  { id: "units", label: "Units", key: "U" },
  { id: "sprites", label: "Sprites", key: "S" },
  { id: "locations", label: "Locations", key: "L" },
  { id: "fog", label: "Fog of War", key: "F" },
  { id: "clipboard", label: "Cut / Copy / Paste", key: "C" },
];

export const ZOOM_LEVELS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function useMenus(): { label: string; items: Item[] }[] {
  const open = useSetAtom(openDialogAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const store = useStore();
  const hasMap = useAtomValue(scenarioAtom) !== null;
  const rebuildIsom = useIsomRebuild();
  const { fillMap } = useTerrainTools();
  const [recent, setRecent] = useAtom(recentFilesAtom);
  const deleteUnits = useSetAtom(deleteSelectedUnitsAtom);
  const deleteDoodads = useSetAtom(deleteSelectedDoodadsAtom);
  const deleteSprites = useSetAtom(deleteSelectedSpritesAtom);
  const deleteLocations = useSetAtom(deleteSelectedLocationsAtom);
  const [flags, setFlags] = useAtom(viewFlagsAtom);
  const [panels, setPanels] = useAtom(panelsAtom);
  const [layer, setLayer] = useAtom(activeLayerAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const [brush, setBrush] = useAtom(brushSizeAtom);
  const { save } = useMapFileActions();
  const [undoLabel, undo] = useAtom(undoAtom);
  const [redoLabel, redo] = useAtom(redoAtom);

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
  const dlgWith = (label: string, dialog: DialogId, payload: Record<string, unknown>): Item => ({ kind: "item", label, dialog, payload });
  const link = (label: string, url: string): Item => ({ kind: "item", label, onSelect: () => { window.open(url, "_blank", "noopener,noreferrer"); } });

  // Edit ▸ Delete / Select All / Deselect act on the active layer's selection, as the Del / Esc keys do.
  const deleteSelection = () => {
    const n = layer === "doodads" ? deleteDoodads() : layer === "sprites" ? deleteSprites() : layer === "locations" ? deleteLocations() : deleteUnits();
    setStatus(n > 0 ? `Deleted ${n} ${layer === "doodads" ? "doodad" : layer === "sprites" ? "sprite" : layer === "locations" ? "location" : "unit"}${n === 1 ? "" : "s"}` : "Nothing selected");
  };
  const selectAll = () => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const all = (n: number) => Array.from({ length: n }, (_, i) => i);
    let n = 0;
    if (layer === "doodads") { n = scn.doodads.length; store.set(selectedDoodadsAtom, all(n)); }
    else if (layer === "sprites") { n = scn.sprites.length; store.set(selectedSpritesAtom, all(n)); }
    else if (layer === "locations") { const used = usedLocations(scn).filter((i) => i !== ANYWHERE_INDEX); n = used.length; store.set(selectedLocationsAtom, used); }
    else { n = scn.units.length; store.set(selectedUnitsAtom, all(n)); if (layer !== "units") setLayer("units"); }
    setStatus(`Selected ${n} ${layer === "doodads" ? "doodad" : layer === "sprites" ? "sprite" : layer === "locations" ? "location" : "unit"}${n === 1 ? "" : "s"}`);
  };
  const deselect = () => {
    store.set(selectedUnitsAtom, []);
    store.set(selectedDoodadsAtom, []);
    store.set(selectedSpritesAtom, []);
    store.set(selectedLocationsAtom, []);
  };
  const stub = (label: string, shortcut?: string, disabled?: boolean): Item => ({
    kind: "item",
    label,
    shortcut,
    disabled,
    onSelect: () => open("notImplemented", { feature: label.replace(/…|\.\.\./g, "") }),
  });
  const zoomIn = () => setZoom(ZOOM_LEVELS.find((z) => z > zoom) ?? zoom);
  const zoomOut = () => setZoom([...ZOOM_LEVELS].reverse().find((z) => z < zoom) ?? zoom);

  return [
    {
      label: "File",
      items: [
        dlg("New…", "newMap", "Ctrl+N"),
        dlg("Open…", "openMap", "Ctrl+O"),
        {
          kind: "sub",
          label: "Open Recent",
          items: [
            // The browser hands over file contents, not handles, so a name can be remembered but not reopened by itself.
            ...(recent.length > 0
              ? recent.map<Item>((f) => ({ kind: "item", label: `${f} (reopen from disk)`, disabled: true }))
              : [{ kind: "item", label: "Nothing opened this session", disabled: true } as Item]),
            sep,
            { kind: "item", label: "Clear Recent", disabled: recent.length === 0, onSelect: () => setRecent([]) },
          ],
        },
        sep,
        { kind: "item", label: "Save", shortcut: "Ctrl+S", onSelect: () => { void save(); } },
        dlg("Save As…", "saveAs", "Ctrl+Shift+S"),
        dlg("Save Copy As…", "saveAs"),
        sep,
        {
          kind: "sub",
          label: "Import",
          items: [
            dlgWith("Triggers (.trg)…", "importTriggers", { format: "trg" }),
            dlgWith("Text Triggers (.txt)…", "importTriggers", { format: "txt" }),
            dlg("Strings (.txt)…", "importStrings"),
            stub("Terrain from Image…"),
          ],
        },
        {
          kind: "sub",
          label: "Export",
          items: [
            { kind: "item", label: "Image (.png)…", onSelect: () => open("exportImage") },
            sep,
            dlgWith("Triggers (.trg)…", "exportTriggers", { format: "trg" }),
            dlgWith("Text Triggers (.txt)…", "exportTriggers", { format: "txt" }),
            dlg("Strings (.txt)…", "exportStrings"),
          ],
        },
        sep,
        dlg("Map Properties…", "mapProperties", "Alt+Enter"),
        sep,
        dlg("Close Map", "confirmClose", "Ctrl+W"),
        sep,
        dlg("Exit", "confirmClose", "Alt+F4"),
      ],
    },
    {
      label: "Edit",
      items: [
        { kind: "item", label: undoLabel ? `Undo ${undoLabel}` : "Undo", shortcut: "Ctrl+Z", disabled: !undoLabel, onSelect: () => { const l = undo(); if (l) setStatus(`Undid: ${l}`); } },
        { kind: "item", label: redoLabel ? `Redo ${redoLabel}` : "Redo", shortcut: "Ctrl+Y", disabled: !redoLabel, onSelect: () => { const l = redo(); if (l) setStatus(`Redid: ${l}`); } },
        sep,
        stub("Cut", "Ctrl+X"),
        stub("Copy", "Ctrl+C"),
        stub("Paste", "Ctrl+V"),
        { kind: "item", label: "Delete", shortcut: "Del", disabled: !hasMap, onSelect: deleteSelection },
        sep,
        { kind: "item", label: "Select All", shortcut: "Ctrl+A", disabled: !hasMap, onSelect: selectAll },
        { kind: "item", label: "Deselect", shortcut: "Esc", disabled: !hasMap, onSelect: deselect },
        sep,
        dlg("Find…", "find", "Ctrl+F"),
        sep,
        dlg("Preferences…", "preferences", "Ctrl+,"),
      ],
    },
    {
      label: "View",
      items: [
        { kind: "item", label: "Zoom In", shortcut: "Ctrl++", onSelect: zoomIn },
        { kind: "item", label: "Zoom Out", shortcut: "Ctrl+−", onSelect: zoomOut },
        {
          kind: "sub",
          label: "Zoom",
          items: [{ kind: "radio-group", value: String(zoom), onChange: (v) => setZoom(Number(v)), items: ZOOM_LEVELS.map((z) => ({ value: String(z), label: `${Math.round(z * 100)}%`, shortcut: z === 1 ? "Ctrl+0" : undefined })) }],
        },
        { kind: "item", label: "Zoom to Fit", shortcut: "Ctrl+Shift+0", onSelect: () => setZoom(0.25) },
        sep,
        flag("grid", "Grid", "Ctrl+G"),
        dlg("Grid Settings…", "gridSettings"),
        sep,
        flag("units", "Units"),
        flag("doodads", "Doodads"),
        flag("sprites", "Sprites"),
        flag("locations", "Locations"),
        flag("locationNames", "Location Names"),
        flag("startLocations", "Start Locations"),
        flag("fog", "Fog of War"),
        flag("animateWater", "Animate Water"),
        flag("animateUnits", "Animate Units"),
        sep,
        flag("elevation", "Elevation Overlay"),
        flag("buildability", "Buildability Overlay"),
        sep,
        { kind: "sub", label: "Panels", items: [panel("palette", "Palette"), panel("minimap", "Minimap"), panel("layers", "Layers"), panel("properties", "Properties"), sep, panel("toolbar", "Toolbar"), panel("statusbar", "Status Bar")] },
        sep,
        { kind: "item", label: "Full Screen", shortcut: "F11", onSelect: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); } },
      ],
    },
    {
      label: "Layer",
      items: [
        { kind: "radio-group", value: layer, onChange: (v) => setLayer(v as EditorLayer), items: LAYERS.map((l) => ({ value: l.id, label: l.label, shortcut: l.key })) },
      ],
    },
    {
      label: "Scenario",
      items: [
        dlg("Map Properties…", "mapProperties"),
        dlg("Resize / Crop Map…", "resizeMap"),
        dlg("Map Revision…", "mapRevision"),
        sep,
        dlg("Player Settings…", "playerSettings"),
        dlg("Force Settings…", "forceSettings"),
        dlg("Player Colors…", "playerColors"),
        sep,
        dlg("Unit Settings…", "unitSettings"),
        dlg("Upgrade Settings…", "upgradeSettings"),
        dlg("Technology Settings…", "techSettings"),
        sep,
        dlg("String Editor…", "stringEditor"),
        dlg("Sound Editor…", "soundEditor"),
        dlg("Switches…", "switches"),
        dlg("Locations…", "locationList"),
        sep,
        dlg("Mission Briefing…", "missionBriefing"),
      ],
    },
    {
      label: "Triggers",
      items: [
        dlg("Trigger Editor…", "triggerEditor", "Ctrl+T"),
        dlg("Text Trigger Editor…", "textTriggerEditor", "Ctrl+Shift+T"),
        dlg("Script Editor…", "scriptEditor"),
        dlg("Mission Briefing Editor…", "missionBriefing"),
        sep,
        dlg("Import Triggers…", "importTriggers"),
        dlg("Export Triggers…", "exportTriggers"),
        sep,
        dlgWith("Validate Triggers", "validateMap", { only: "triggers" }),
      ],
    },
    {
      label: "Tools",
      items: [
        dlg("Symmetry…", "symmetry"),
        { kind: "sub", label: "Brush Size", items: [{ kind: "radio-group", value: String(brush), onChange: (v) => setBrush(Number(v)), items: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: String(n), label: `${n} × ${n}` })) }] },
        sep,
        { kind: "item", label: "Fill Terrain", disabled: !hasMap, onSelect: fillMap },
        stub("Replace Terrain…"),
        { kind: "item", label: "Rebuild ISOM from Tiles", disabled: !hasMap, onSelect: rebuildIsom },
        stub("Auto-place Start Locations"),
        sep,
        dlg("Check Map…", "validateMap"),
        dlg("Statistics…", "statistics"),
        sep,
        stub("Test Map", "Ctrl+F5", true),
      ],
    },
    {
      label: "Help",
      items: [
        dlg("Keyboard Shortcuts…", "shortcuts", "F1"),
        link("Documentation", `${REPO_URL}#readme`),
        link("Report an Issue…", `${REPO_URL}/issues/new`),
        sep,
        dlg("About scmJS…", "about"),
      ],
    },
  ];
}

/* ── Rendering ──────────────────────────────────────────── */

function Items({ items }: { items: Item[] }): ReactNode {
  const open = useSetAtom(openDialogAtom);
  return items.map((it, i) => {
    switch (it.kind) {
      case "sep":
        return <Menubar.Separator key={i} className="menu-separator" />;
      case "label":
        return <Menubar.Label key={i} className="menu-label">{it.label}</Menubar.Label>;
      case "item":
        return (
          <Menubar.Item key={i} className="menu-item" disabled={it.disabled} onSelect={() => (it.dialog ? open(it.dialog, it.payload) : it.onSelect?.())}>
            {it.label}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </Menubar.Item>
        );
      case "check":
        return (
          <Menubar.CheckboxItem key={i} className="menu-item" checked={it.checked} onCheckedChange={it.onChange}>
            <Menubar.ItemIndicator className="indicator"><Check size={12} /></Menubar.ItemIndicator>
            {it.label}
            {it.shortcut && <span className="shortcut">{it.shortcut}</span>}
          </Menubar.CheckboxItem>
        );
      case "radio-group":
        return (
          <Menubar.RadioGroup key={i} value={it.value} onValueChange={it.onChange}>
            {it.items.map((r) => (
              <Menubar.RadioItem key={r.value} value={r.value} className="menu-item">
                <Menubar.ItemIndicator className="indicator"><Dot size={18} strokeWidth={4} /></Menubar.ItemIndicator>
                {r.label}
                {r.shortcut && <span className="shortcut">{r.shortcut}</span>}
              </Menubar.RadioItem>
            ))}
          </Menubar.RadioGroup>
        );
      case "sub":
        return (
          <Menubar.Sub key={i}>
            <Menubar.SubTrigger className="menu-item">
              {it.label}
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
      <div className="brand" title="scmJS">
        <AppLogo size={16} />
        scmJS
      </div>
      {menus.map((m) => (
        <Fragment key={m.label}>
          <Menubar.Menu>
            <Menubar.Trigger className="menu-trigger">{m.label}</Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="menu-content" align="start" sideOffset={1}>
                <Items items={m.items} />
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        </Fragment>
      ))}
      <div className="menubar-doc" title={modified ? "Unsaved changes" : "No unsaved changes"}>
        <span className={`dot ${modified ? "" : "clean"}`} />
        <span>{name}{modified ? " *" : ""}</span>
      </div>
    </Menubar.Root>
  );
}
