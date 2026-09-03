import { useEffect } from "react";
import { useStore } from "jotai";
import {
  activeLayerAtom, fogPlayersAtom, fogViewPlayerAtom, mapTilesetAtom, screenAtom, terrainModeAtom, TERRAIN_MODES, zoomAtom,
  type EditorLayer, type TerrainMode,
} from "../atoms/editorAtoms";
import { openDialogAtom, type DialogId } from "../atoms/uiAtoms";
import { TILESET_BY_ID, type TilesetId } from "../data/tilesets";
import { LAYERS } from "../components/chrome/MenuBar";
import { DIALOG_IDS } from "../components/dialogs/DialogHost";

let applied = false;

/** `subtile` and `index` were the two halves of today's single Tile mode. */
const LEGACY_MODES: Record<string, TerrainMode> = { subtile: "tile", index: "tile" };

function terrainMode(raw: string): TerrainMode | null {
  const mode = LEGACY_MODES[raw] ?? raw;
  return (TERRAIN_MODES as readonly string[]).includes(mode) ? (mode as TerrainMode) : null;
}

/**
 * Development deep-links, e.g. `/?nosplash&layer=units&dialog=playerSettings&zoom=0.5`.
 * Handy for screenshots and for jumping straight to a dialog while iterating on it.
 */
export function useDevDeepLinks() {
  const store = useStore();
  useEffect(() => {
    if (applied) return;
    applied = true;
    const p = new URLSearchParams(window.location.search);
    if (p.has("nosplash")) store.set(screenAtom, "editor");
    const layer = p.get("layer");
    if (layer) {
      if (LAYERS.some((l) => l.id === layer)) store.set(activeLayerAtom, layer as EditorLayer);
      else console.warn(`[deep link] no layer "${layer}" — one of ${LAYERS.map((l) => l.id).join(", ")}`);
    }
    const mode = p.get("mode") ? terrainMode(p.get("mode")!) : null;
    if (mode) store.set(terrainModeAtom, mode);
    const zoom = Number(p.get("zoom"));
    if (zoom > 0) store.set(zoomAtom, zoom);
    const tileset = p.get("tileset");
    if (tileset && tileset in TILESET_BY_ID) store.set(mapTilesetAtom, tileset as TilesetId);
    const fogPlayer = Number(p.get("fogPlayer"));
    if (fogPlayer >= 1 && fogPlayer <= 8) {
      store.set(fogViewPlayerAtom, fogPlayer - 1);
      store.set(fogPlayersAtom, 1 << (fogPlayer - 1));
    }
    for (const d of p.getAll("dialog")) {
      if (DIALOG_IDS.has(d)) store.set(openDialogAtom, d as DialogId);
      else console.warn(`[deep link] no dialog "${d}" — one of ${[...DIALOG_IDS].join(", ")}`);
    }
  }, [store]);
}
