import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  activeToolAtom,
  mapNameAtom,
  mapWidthAtom,
  mapHeightAtom,
  cursorTileAtom,
  zoomAtom,
  screenAtom,
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

/* ── Component ──────────────────────────────────────────── */

export default function EditorLayout() {
  const [activeTool, setActiveTool] = useAtom(activeToolAtom);
  const [zoom, setZoom] = useAtom(zoomAtom);
  const mapName = useAtomValue(mapNameAtom);
  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const cursor = useAtomValue(cursorTileAtom);
  const setScreen = useSetAtom(screenAtom);

  return (
    <div className="editor">
      {/* ── Menu bar ──────────────────────────────────────── */}
      <header className="editor-menubar">
        <button className="menu-item" onClick={() => setScreen("splash")}>
          ← Back
        </button>
        <span className="menu-item">File</span>
        <span className="menu-item">Edit</span>
        <span className="menu-item">View</span>
        <span className="menu-item">Map</span>
        <span className="menu-item">Layer</span>
        <span className="menu-item">Triggers</span>
        <span className="menu-item">Help</span>
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
