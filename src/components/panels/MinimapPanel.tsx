import { useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { mapHeightAtom, mapTilesetAtom, mapWidthAtom, viewFlagsAtom, viewportRectAtom } from "../../atoms/editorAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { SAMPLE_LOCATIONS, SAMPLE_START_LOCATIONS } from "../../data/samples";
import { PLAYER_COLORS } from "../../data/players";
import { hashNoise } from "../viewport/noise";

export default function MinimapPanel() {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = useAtomValue(mapWidthAtom);
  const h = useAtomValue(mapHeightAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const rect = useAtomValue(viewportRectAtom);
  const flags = useAtomValue(viewFlagsAtom);

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
    ctx.putImageData(img, ox, oy);

    if (flags.locations) {
      ctx.strokeStyle = "rgba(79,209,197,0.7)";
      ctx.lineWidth = 1;
      for (const l of SAMPLE_LOCATIONS.slice(1)) ctx.strokeRect(ox + l.x * scale + 0.5, oy + l.y * scale + 0.5, l.w * scale, l.h * scale);
    }
    if (flags.startLocations) {
      for (const s of SAMPLE_START_LOCATIONS) {
        ctx.fillStyle = PLAYER_COLORS[s.player].hex;
        ctx.beginPath();
        ctx.arc(ox + s.x * scale, oy + s.y * scale, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // viewport rectangle
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + rect.x * scale + 0.5, oy + rect.y * scale + 0.5, Math.max(2, rect.w * scale), Math.max(2, rect.h * scale));
  }, [w, h, tileset, rect, flags]);

  return (
    <div className="minimap-wrap">
      <canvas ref={ref} className="minimap" title="Minimap" />
    </div>
  );
}
