import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  centerViewOnAtom, fogViewPlayerAtom, mapHeightAtom, mapTilesetAtom, mapWidthAtom, viewFlagsAtom, viewportRectAtom,
  selectedLocationsAtom,
} from "../../atoms/editorAtoms";
import { fogImageData } from "../viewport/fog";
import { tilesetIndex } from "../../formats/chk/scenario";
import { TILESET_BY_ID } from "../../data/tilesets";
import { displayColorHex } from "../../data/players";
import { isResource, unitGeometry } from "../../editor/units";
import { useUnitAssets } from "../../hooks/useUnitAssets";
import { hashNoise } from "../viewport/noise";
import { locationsAtom, scenarioAtom, startLocationsAtom, terrainRevisionAtom, unitsRevisionAtom } from "../../atoms/documentAtoms";
import { useTileset } from "../../hooks/useTileset";
import { megatileForTile } from "../../formats/tileset/decode";

export default function MinimapPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  /** One pixel per tile; the fog image is scaled from it so the minimap stays one drawImage. */
  const fogCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const rect = useAtomValue(viewportRectAtom);
  const flags = useAtomValue(viewFlagsAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  const unitsRevision = useAtomValue(unitsRevisionAtom);
  const { loaded: tilesetAssets, loading: tilesetLoading } = useTileset();
  const { loaded: unitAssets } = useUnitAssets();
  const centerView = useSetAtom(centerViewOnAtom);
  const mapLocations = useAtomValue(locationsAtom);
  const mapStarts = useAtomValue(startLocationsAtom);
  const locations = mapLocations;
  const selectedLocations = useAtomValue(selectedLocationsAtom);
  const startLocations = scenario ? mapStarts : [];

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = 256;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, size, size);
    const scale = size / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;

    // terrain
    const img = ctx.createImageData(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    const tiles = scenario?.tiles;
    if (tiles && tilesetAssets) {
      // One mean colour per megatile is exactly what a minimap wants.
      const { atlas, tileset: ts } = tilesetAssets;
      for (let py = 0; py < img.height; py++) {
        const ty = Math.min(h - 1, Math.floor(py / scale));
        for (let px = 0; px < img.width; px++) {
          const tx = Math.min(w - 1, Math.floor(px / scale));
          const megatile = megatileForTile(ts, tiles[ty * w + tx]);
          const rgb = megatile < 0 ? 0 : atlas.averages[megatile];
          const i = (py * img.width + px) * 4;
          img.data[i] = rgb >> 16;
          img.data[i + 1] = (rgb >> 8) & 255;
          img.data[i + 2] = rgb & 255;
          img.data[i + 3] = 255;
        }
      }
    } else if (tiles && tilesetLoading) {
      // Graphics for the map just opened are still coming; a plain plate reads as
      // "loading" instead of pretending to be terrain.
      img.data.fill(255);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = 0x12; img.data[i + 1] = 0x16; img.data[i + 2] = 0x1d;
      }
    } else {
      const base = parseInt(tileset.color.slice(1), 16);
      const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
      for (let py = 0; py < img.height; py++) {
        for (let px = 0; px < img.width; px++) {
          const tx = Math.floor(px / scale), ty = Math.floor(py / scale);
          const n = (hashNoise(tx, ty) - 0.5) * 0.12 + (hashNoise(tx >> 2, ty >> 2) - 0.5) * 0.16;
          const k = 1 + n;
          const i = (py * img.width + px) * 4;
          img.data[i] = br * k;
          img.data[i + 1] = bg * k;
          img.data[i + 2] = bb * k;
          img.data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, ox, oy);

    if (flags.locations) {
      ctx.lineWidth = 1;
      for (const l of locations) {
        ctx.strokeStyle = selectedLocations.includes(l.index) ? "#f4d08a" : "rgba(79,209,197,0.7)";
        ctx.strokeRect(ox + l.x * scale + 0.5, oy + l.y * scale + 0.5, l.w * scale, l.h * scale);
      }
    }
    // units as the game's minimap does: a dot per unit in its owner's colour, resources in cyan
    if (flags.units && scenario) {
      const tables = unitAssets?.units ?? null;
      for (const u of scenario.units) {
        if (u.unitId === 214) continue;
        const g = unitGeometry(tables, u.unitId);
        const uw = Math.max(2, (g.placeW / 32) * scale), uh = Math.max(2, (g.placeH / 32) * scale);
        ctx.fillStyle = isResource(u.unitId) ? "#5fd7ff" : displayColorHex(scenario.playerColors, scenario.playerRgb, u.owner);
        ctx.fillRect(ox + (u.x / 32) * scale - uw / 2, oy + (u.y / 32) * scale - uh / 2, uw, uh);
      }
    }
    if (flags.startLocations) {
      for (const s of startLocations) {
        ctx.fillStyle = displayColorHex(scenario?.playerColors, scenario?.playerRgb, s.player);
        ctx.beginPath();
        ctx.arc(ox + s.x * scale, oy + s.y * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // fog of war: the viewed player's fogged tiles darkened the way the game's fog does
    if (scenario && flags.fog) {
      const fog = fogCanvasRef.current ?? (fogCanvasRef.current = document.createElement("canvas"));
      fog.width = w;
      fog.height = h;
      fog.getContext("2d")!.putImageData(fogImageData(scenario, tilesetIndex(scenario), fogViewPlayer), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = "multiply";
      ctx.drawImage(fog, ox, oy, w * scale, h * scale);
      ctx.globalCompositeOperation = "source-over";
      ctx.imageSmoothingEnabled = true;
    }
    // viewport rectangle
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + rect.x * scale + 0.5, oy + rect.y * scale + 0.5, Math.max(2, rect.w * scale), Math.max(2, rect.h * scale));
  }, [w, h, tileset, rect, flags, scenario, tilesetAssets, tilesetLoading, terrainRevision, unitsRevision, unitAssets, locations, selectedLocations, startLocations, fogViewPlayer]);

  /* ── click / drag to drive the main viewport ─────────── */
  // Same placement maths as the draw pass above, run in reverse.
  const tileAt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current;
    if (!c) return null;
    const box = c.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    const size = 256;
    const scale = size / Math.max(w, h);
    const ox = (size - w * scale) / 2;
    const oy = (size - h * scale) / 2;
    const px = ((e.clientX - box.left) / box.width) * size;
    const py = ((e.clientY - box.top) / box.height) * size;
    return {
      x: Math.min(w, Math.max(0, (px - ox) / scale)),
      y: Math.min(h, Math.max(0, (py - oy) / scale)),
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const t = tileAt(e);
    if (!t) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    centerView(t);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const t = tileAt(e);
    if (t) centerView(t);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="minimap-wrap">
      <canvas
        ref={ref}
        className="minimap"
        title="Minimap — click or drag to move the view"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}
