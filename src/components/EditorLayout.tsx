import { useAtom, useAtomValue } from "jotai";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  activeToolAtom,
  mapNameAtom,
  mapWidthAtom,
  mapHeightAtom,
  cursorTileAtom,
  zoomAtom,
  type EditorTool,
} from "../atoms/editorAtoms";
import "./EditorLayout.css";

/* ── Tool definitions ───────────────────────────────────── */

const TOOLS: { id: EditorTool; label: string; icon: string }[] = [
  { id: "select", label: "Select", icon: "🖱" },
  { id: "terrain", label: "Terrain", icon: "🌿" },
  { id: "doodads", label: "Doodads", icon: "🪨" },
  { id: "units", label: "Units", icon: "⚙" },
  { id: "locations", label: "Locations", icon: "📍" },
  { id: "sprites", label: "Sprites", icon: "✨" },
  { id: "fog", label: "Fog", icon: "🌫" },
];

/* ── Classic StarEdit menu definitions ──────────────────── */

interface MenuItem {
  label: string;
  shortcut?: string;
  separator?: boolean;
  disabled?: boolean;
}

const MENUS: { label: string; items: MenuItem[] }[] = [
  {
    label: "File",
    items: [
      { label: "New...", shortcut: "Ctrl+N" },
      { label: "Open...", shortcut: "Ctrl+O" },
      { label: "separator", separator: true },
      { label: "Save", shortcut: "Ctrl+S" },
      { label: "Save As...", shortcut: "Ctrl+Shift+S" },
      { label: "separator", separator: true },
      { label: "Close Map" },
      { label: "separator", separator: true },
      { label: "Test Map", shortcut: "Ctrl+T", disabled: true },
      { label: "separator", separator: true },
      { label: "Exit" },
    ],
  },
  {
    label: "Edit",
    items: [
      { label: "Undo", shortcut: "Ctrl+Z" },
      { label: "Redo", shortcut: "Ctrl+Y" },
      { label: "separator", separator: true },
      { label: "Cut", shortcut: "Ctrl+X" },
      { label: "Copy", shortcut: "Ctrl+C" },
      { label: "Paste", shortcut: "Ctrl+V" },
      { label: "Delete", shortcut: "Del" },
      { label: "separator", separator: true },
      { label: "Select All", shortcut: "Ctrl+A" },
    ],
  },
  {
    label: "View",
    items: [
      { label: "Zoom In", shortcut: "+" },
      { label: "Zoom Out", shortcut: "-" },
      { label: "Zoom 100%", shortcut: "Ctrl+1" },
      { label: "separator", separator: true },
      { label: "Show Grid" },
      { label: "Show Locations" },
      { label: "Show Fog of War" },
      { label: "Show Sprites" },
      { label: "separator", separator: true },
      { label: "Minimap" },
      { label: "Palette" },
      { label: "Properties" },
    ],
  },
  {
    label: "Map",
    items: [
      { label: "Map Properties..." },
      { label: "Map Size..." },
      { label: "separator", separator: true },
      { label: "Player Settings..." },
      { label: "Force Settings..." },
      { label: "separator", separator: true },
      { label: "Terrain Types..." },
      { label: "Tilesets..." },
    ],
  },
  {
    label: "Layer",
    items: [
      { label: "Terrain" },
      { label: "Doodads" },
      { label: "Units" },
      { label: "Sprites" },
      { label: "Locations" },
      { label: "Fog of War" },
    ],
  },
  {
    label: "Triggers",
    items: [
      { label: "Trigger Editor...", shortcut: "Ctrl+G" },
      { label: "Mission Briefing..." },
      { label: "separator", separator: true },
      { label: "Conditions..." },
      { label: "Actions..." },
      { label: "separator", separator: true },
      { label: "AI Scripts..." },
      { label: "Switch List..." },
      { label: "Location List..." },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "StarEdit Help...", shortcut: "F1" },
      { label: "separator", separator: true },
      { label: "About JS Edit..." },
    ],
  },
];

function MenuDropdown({ label, items }: { label: string; items: MenuItem[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="menu-item">{label}</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="dropdown-content" sideOffset={2} align="start">
          {items.map((item, i) =>
            item.separator ? (
              <DropdownMenu.Separator key={i} className="dropdown-separator" />
            ) : (
              <DropdownMenu.Item
                key={item.label}
                className="dropdown-item"
                disabled={item.disabled}
                onSelect={() => {/* no-op for now */}}
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="dropdown-shortcut">{item.shortcut}</span>}
              </DropdownMenu.Item>
            )
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* ── Component ──────────────────────────────────────────── */

export default function EditorLayout() {
  const [activeTool, setActiveTool] = useAtom(activeToolAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const mapName = useAtomValue(mapNameAtom);
  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const cursor = useAtomValue(cursorTileAtom);

  return (
    <div className="editor">
      {/* ── Menu bar ──────────────────────────────────────── */}
      <header className="editor-menubar">
        {MENUS.map((menu) => (
          <MenuDropdown key={menu.label} label={menu.label} items={menu.items} />
        ))}
        <span className="menubar-title">{mapName}</span>
      </header>

      {/* ── Toolbar ───────────────────────────────────────── */}
      <div className="editor-toolbar">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`tool-btn${activeTool === t.id ? " active" : ""}`}
            onClick={() => setActiveTool(t.id)}
            title={t.label}
          >
            <span className="tool-icon">{t.icon}</span>
            <span className="tool-label">{t.label}</span>
          </button>
        ))}

        <span className="toolbar-spacer" />

        {/* Zoom controls */}
        <button
          className="tool-btn small"
          onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
          title="Zoom out"
        >
          −
        </button>
        <span className="zoom-display">{Math.round(zoom * 100)}%</span>
        <button
          className="tool-btn small"
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
          title="Zoom in"
        >
          +
        </button>
      </div>

      {/* ── Main body ─────────────────────────────────────── */}
      <div className="editor-body">
        {/* Left palette panel */}
        <aside className="editor-palette">
          <h3 className="panel-heading">Palette</h3>
          <div className="palette-grid">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="palette-swatch" title={`Tile ${i}`} />
            ))}
          </div>
        </aside>

        {/* Map viewport (placeholder canvas area) */}
        <main className="editor-viewport">
          <div className="viewport-canvas" style={{ transform: `scale(${zoom})` }}>
            <p className="viewport-placeholder">
              Map Viewport
              <br />
              <small>
                {mapW}×{mapH} tiles
              </small>
            </p>
          </div>
        </main>

        {/* Right panel: minimap + properties */}
        <aside className="editor-sidebar">
          <div className="minimap-container">
            <h3 className="panel-heading">Minimap</h3>
            <div className="minimap-box" />
          </div>

          <div className="properties-container">
            <h3 className="panel-heading">Properties</h3>
            <div className="props-placeholder">
              <p>No selection</p>
            </div>
          </div>
        </aside>
      </div>

      {/* ── Status bar ────────────────────────────────────── */}
      <footer className="editor-statusbar">
        <span>
          Tile: ({cursor.x}, {cursor.y})
        </span>
        <span>
          Map: {mapW}×{mapH}
        </span>
        <span>Tool: {activeTool}</span>
        <span>Zoom: {Math.round(zoom * 100)}%</span>
      </footer>
    </div>
  );
}
