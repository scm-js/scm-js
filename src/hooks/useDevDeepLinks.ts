import { useEffect } from "react";
import { useStore } from "jotai";
import { activeLayerAtom, mapTilesetAtom, screenAtom, zoomAtom, type EditorLayer } from "../atoms/editorAtoms";
import { openDialogAtom, type DialogId } from "../atoms/uiAtoms";
import { TILESET_BY_ID, type TilesetId } from "../data/tilesets";

let applied = false;

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
    if (layer) store.set(activeLayerAtom, layer as EditorLayer);
    const zoom = Number(p.get("zoom"));
    if (zoom > 0) store.set(zoomAtom, zoom);
    const tileset = p.get("tileset");
    if (tileset && tileset in TILESET_BY_ID) store.set(mapTilesetAtom, tileset as TilesetId);
    for (const d of p.getAll("dialog")) store.set(openDialogAtom, d as DialogId);
  }, [store]);
}
