/**
 * The New Scenario dialog's pictures: a patch of terrain as a thumbnail, and the map
 * itself drawn at the size and terrain about to be created.
 *
 * Both draw from `TerrainPatch` pixels (`formats/tileset/preview.ts`) rather than the
 * megatile atlas, so picturing all eight tilesets costs kilobytes instead of the atlas's
 * ~20 MB apiece. Without game data they fall back to the tileset's flat reference colour,
 * which is what the viewport itself does.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TerrainPatch } from "../../formats/tileset/preview";

/** A patch as an offscreen canvas, ready to blit or tile. */
function patchCanvas(patch: TerrainPatch): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = patch.width;
  c.height = patch.height;
  c.getContext("2d")!.putImageData(new ImageData(patch.pixels, patch.width, patch.height), 0, 0);
  return c;
}

/* ── Thumbnail ──────────────────────────────────────────── */

export const PatchThumb = memo(function PatchThumb({ patch, color, width, height, className, style, title }: {
  patch: TerrainPatch | null;
  /** Drawn instead while the tileset has no graphics. */
  color: string;
  /** Omit to fill whatever the layout gives the canvas; the backing then follows it. */
  width?: number;
  height: number;
  className?: string;
  style?: CSSProperties;
  title?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [measured, setMeasured] = useState(0);
  const box = width ?? measured;

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c || width !== undefined) return;
    const measure = () => setMeasured(c.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, [width]);

  useEffect(() => {
    const c = ref.current;
    if (!c || box === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!patch) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, box, height);
      return;
    }
    // Cover the box: the patch's own aspect rarely matches the slot it goes in.
    const scale = Math.max(box / patch.width, height / patch.height);
    const w = patch.width * scale, h = patch.height * scale;
    ctx.imageSmoothingEnabled = scale < 1;
    ctx.drawImage(patchCanvas(patch), (box - w) / 2, (height - h) / 2, w, h);
  }, [patch, color, box, height]);

  return <canvas ref={ref} className={className} style={{ width: width ?? "100%", height, ...style }} title={title} />;
});

/* ── Map preview ────────────────────────────────────────── */

export interface PreviewStart { x: number; y: number }

/** Tiles from the map edge to the sheet's edge, as a share of the box. */
const INSET = 0.94;
const TILE_PX = 32;

/**
 * The scenario as it will be created: the terrain tiled at the map's own scale, so a
 * 64x64 map reads as coarser ground than a 256x256 one, with the start locations the
 * dialog is about to place marked on it.
 */
export const MapPreview = memo(function MapPreview({ patch, color, width, height, starts }: {
  patch: TerrainPatch | null;
  color: string;
  /** Map size in tiles. */
  width: number;
  height: number;
  starts: readonly PreviewStart[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const image = useMemo(() => (patch ? patchCanvas(patch) : null), [patch]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || box.w === 0 || box.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(box.w * dpr);
    c.height = Math.round(box.h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.w, box.h);

    const px = INSET * Math.min(box.w / width, box.h / height);
    const w = px * width, h = px * height;
    const ox = Math.round((box.w - w) / 2), oy = Math.round((box.h - h) / 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, w, h);
    ctx.clip();
    if (image && patch) {
      const step = patch.cols * px, stepY = patch.rows * px;
      ctx.imageSmoothingEnabled = true;
      for (let y = oy; y < oy + h; y += stepY) {
        for (let x = ox; x < ox + w; x += step) ctx.drawImage(image, x, y, step + 0.5, stepY + 0.5);
      }
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(ox, oy, w, h);
    }
    // Start locations, where `idealStarts` puts them before the fit search moves them.
    for (const s of starts) {
      const cx = ox + (s.x / (width * TILE_PX)) * w, cy = oy + (s.y / (height * TILE_PX)) * h;
      const r = Math.max(3, Math.min(6, px * 2));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#f2c14b";
      ctx.stroke();
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + 0.5, oy + 0.5, w - 1, h - 1);
  }, [box, image, patch, color, width, height, starts]);

  return (
    <div ref={hostRef} className="map-preview" style={{ aspectRatio: `${width} / ${height}` }}>
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
});
