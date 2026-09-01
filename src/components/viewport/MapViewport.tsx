import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ContextMenu } from "radix-ui";
import { Crosshair } from "lucide-react";
import {
  activeLayerAtom,
  brushSizeAtom,
  cursorTileAtom,
  gridSizeAtom,
  mapHeightAtom,
  mapTilesetAtom,
  mapWidthAtom,
  viewFlagsAtom,
  viewportRectAtom,
  zoomAtom,
} from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { PLAYER_COLORS } from "../../data/players";
import { SAMPLE_LOCATIONS, SAMPLE_START_LOCATIONS } from "../../data/samples";
import { hashNoise } from "./noise";

const TILE = 32;

export default function MapViewport() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const zoom = useAtomValue(zoomAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const flags = useAtomValue(viewFlagsAtom);
  const gridSize = useAtomValue(gridSizeAtom);
  const layer = useAtomValue(activeLayerAtom);
  const brush = useAtomValue(brushSizeAtom);
  const setCursor = useSetAtom(cursorTileAtom);
  const setViewportRect = useSetAtom(viewportRectAtom);
  const open = useSetAtom(openDialogAtom);

  const tilePx = TILE * zoom;
  const worldW = mapW * tilePx;
  const worldH = mapH * tilePx;

  /* ── drawing ─────────────────────────────────────────── */
  const draw = useCallback(() => {
    const scroller = scrollerRef.current;
    const canvas = canvasRef.current;
    if (!scroller || !canvas || size.w === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const sx = scroller.scrollLeft;
    const sy = scroller.scrollTop;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(0, 0, size.w, size.h);

    const x0 = Math.max(0, Math.floor(sx / tilePx));
    const y0 = Math.max(0, Math.floor(sy / tilePx));
    const x1 = Math.min(mapW, Math.ceil((sx + size.w) / tilePx));
    const y1 = Math.min(mapH, Math.ceil((sy + size.h) / tilePx));

    // terrain placeholder
    const base = parseInt(tileset.color.slice(1), 16);
    const br = (base >> 16) & 255, bg = (base >> 8) & 255, bb = base & 255;
    ctx.fillStyle = tileset.color;
    ctx.fillRect(-sx, -sy, worldW, worldH);
    if (tilePx >= 4) {
      for (let ty = y0; ty < y1; ty++) {
        for (let tx = x0; tx < x1; tx++) {
          const n = (hashNoise(tx, ty) - 0.5) * 0.12 + (hashNoise(tx >> 2, ty >> 2) - 0.5) * 0.16;
          const k = 1 + n;
          ctx.fillStyle = `rgb(${br * k | 0},${bg * k | 0},${bb * k | 0})`;
          ctx.fillRect(tx * tilePx - sx, ty * tilePx - sy, tilePx + 0.5, tilePx + 0.5);
        }
      }
    }

    // grid
    if (flags.grid) {
      const step = (gridSize / TILE) * tilePx;
      if (step >= 6) {
        ctx.strokeStyle = step >= 16 ? "rgba(0,0,0,0.28)" : "rgba(0,0,0,0.18)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = Math.floor(sx / step) * step; gx <= Math.min(worldW, sx + size.w); gx += step) {
          const px = Math.round(gx - sx) + 0.5;
          ctx.moveTo(px, Math.max(0, -sy));
          ctx.lineTo(px, Math.min(size.h, worldH - sy));
        }
        for (let gy = Math.floor(sy / step) * step; gy <= Math.min(worldH, sy + size.h); gy += step) {
          const py = Math.round(gy - sy) + 0.5;
          ctx.moveTo(Math.max(0, -sx), py);
          ctx.lineTo(Math.min(size.w, worldW - sx), py);
        }
        ctx.stroke();
      }
    }

    // fog overlay
    if (flags.fog) {
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(-sx, -sy, worldW, worldH);
    }

    // sample locations
    if (flags.locations) {
      ctx.lineWidth = 1;
      ctx.font = `${Math.max(10, Math.min(13, tilePx * 0.4))}px ${getComputedStyle(document.body).getPropertyValue("--font-ui")}`;
      for (const l of SAMPLE_LOCATIONS.slice(1)) {
        const lx = l.x * tilePx - sx, ly = l.y * tilePx - sy, lw = l.w * tilePx, lh = l.h * tilePx;
        if (lx > size.w || ly > size.h || lx + lw < 0 || ly + lh < 0) continue;
        ctx.fillStyle = "rgba(79,209,197,0.12)";
        ctx.fillRect(lx, ly, lw, lh);
        ctx.strokeStyle = "rgba(79,209,197,0.85)";
        ctx.strokeRect(Math.round(lx) + 0.5, Math.round(ly) + 0.5, Math.round(lw), Math.round(lh));
        if (flags.locationNames && tilePx >= 8) {
          const tw = ctx.measureText(l.name).width + 8;
          ctx.fillStyle = "rgba(10,12,16,0.8)";
          ctx.fillRect(lx + 1, ly + 1, tw, 16);
          ctx.fillStyle = "#bff5ef";
          ctx.fillText(l.name, lx + 5, ly + 13);
        }
      }
    }

    // sample start locations
    if (flags.startLocations) {
      for (const s of SAMPLE_START_LOCATIONS) {
        const cx = s.x * tilePx - sx, cy = s.y * tilePx - sy, r = tilePx * 1.5;
        if (cx + r < 0 || cy + r < 0 || cx - r > size.w || cy - r > size.h) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = PLAYER_COLORS[s.player].hex + "55";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = PLAYER_COLORS[s.player].hex;
        ctx.stroke();
        if (tilePx >= 12) {
          ctx.fillStyle = "#fff";
          ctx.font = `bold ${Math.max(10, tilePx * 0.5)}px ${getComputedStyle(document.body).getPropertyValue("--font-ui")}`;
          ctx.textAlign = "center";
          ctx.fillText(String(s.player + 1), cx, cy + tilePx * 0.18);
          ctx.textAlign = "left";
        }
      }
    }

    // map boundary
    ctx.strokeStyle = "rgba(230,185,92,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(-sx + 0.5, -sy + 0.5, worldW - 1, worldH - 1);

    // hover brush
    const hv = hoverRef.current;
    if (hv) {
      const b = layer === "terrain" || layer === "fog" ? brush : 1;
      const off = Math.floor((b - 1) / 2);
      const hx = (hv.x - off) * tilePx - sx, hy = (hv.y - off) * tilePx - sy;
      ctx.fillStyle = "rgba(230,185,92,0.12)";
      ctx.fillRect(hx, hy, tilePx * b, tilePx * b);
      ctx.strokeStyle = "#e6b95c";
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(hx) + 0.5, Math.round(hy) + 0.5, Math.round(tilePx * b) - 1, Math.round(tilePx * b) - 1);
    }

    // rulers
    const labelEvery = [1, 2, 4, 8, 16, 32].find((n) => n * tilePx >= 40) ?? 32;
    const tick = tilePx >= 8 ? 1 : labelEvery / 2;
    const drawRuler = (c: HTMLCanvasElement | null, horizontal: boolean) => {
      if (!c) return;
      const len = horizontal ? size.w : size.h;
      c.width = (horizontal ? len : 20) * dpr;
      c.height = (horizontal ? 20 : len) * dpr;
      const rc = c.getContext("2d")!;
      rc.setTransform(dpr, 0, 0, dpr, 0, 0);
      rc.fillStyle = "#191d25";
      rc.fillRect(0, 0, horizontal ? len : 20, horizontal ? 20 : len);
      rc.font = `9.5px ${getComputedStyle(document.body).getPropertyValue("--font-mono")}`;
      rc.fillStyle = "#99a2b3";
      rc.strokeStyle = "#3b4453";
      rc.beginPath();
      const scroll = horizontal ? sx : sy;
      const tiles = horizontal ? mapW : mapH;
      for (let t = Math.floor(scroll / tilePx / tick) * tick; t <= tiles; t += tick) {
        const p = Math.round(t * tilePx - scroll) + 0.5;
        if (p < 0 || p > len) continue;
        const major = t % labelEvery === 0;
        const l = major ? 8 : 4;
        if (horizontal) { rc.moveTo(p, 20); rc.lineTo(p, 20 - l); } else { rc.moveTo(20, p); rc.lineTo(20 - l, p); }
        if (major && t < tiles) {
          if (horizontal) rc.fillText(String(t), p + 3, 9);
          else {
            rc.save();
            rc.translate(9, p + 3);
            rc.rotate(-Math.PI / 2);
            rc.textAlign = "right";
            rc.fillText(String(t), 0, 0);
            rc.restore();
          }
        }
      }
      rc.stroke();
      // hover marker
      if (hv) {
        rc.fillStyle = "rgba(230,185,92,0.35)";
        const p = (horizontal ? hv.x : hv.y) * tilePx - scroll;
        if (horizontal) rc.fillRect(p, 0, tilePx, 20); else rc.fillRect(0, p, 20, tilePx);
      }
    };
    drawRuler(topRef.current, true);
    drawRuler(leftRef.current, false);

    setViewportRect({ x: sx / tilePx, y: sy / tilePx, w: size.w / tilePx, h: size.h / tilePx });
  }, [size, tilePx, mapW, mapH, worldW, worldH, tileset, flags, gridSize, layer, brush, setViewportRect]);

  /* ── sizing ──────────────────────────────────────────── */
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    c.style.width = `${size.w}px`;
    c.style.height = `${size.h}px`;
    draw();
  }, [size, draw]);

  /* keep the view centred when zooming */
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || prevZoom.current === zoom) return;
    const ratio = zoom / prevZoom.current;
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    el.scrollLeft = cx * ratio - el.clientWidth / 2;
    el.scrollTop = cy * ratio - el.clientHeight / 2;
    prevZoom.current = zoom;
    draw();
  }, [zoom, draw]);

  /* ── pointer ─────────────────────────────────────────── */
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left + el.scrollLeft) / tilePx);
    const y = Math.floor((e.clientY - r.top + el.scrollTop) / tilePx);
    if (x < 0 || y < 0 || x >= mapW || y >= mapH) {
      if (hoverRef.current) { hoverRef.current = null; draw(); }
      return;
    }
    if (!hoverRef.current || hoverRef.current.x !== x || hoverRef.current.y !== y) {
      hoverRef.current = { x, y };
      setCursor({ x, y });
      draw();
    }
  };
  const onLeave = () => { hoverRef.current = null; draw(); };

  const ctxItems: { label: string; onSelect?: () => void; disabled?: boolean; sep?: boolean }[] = [
    ...(layer === "units" ? [{ label: "Unit Properties…", onSelect: () => open("unitProperties") }] : []),
    ...(layer === "locations" ? [{ label: "Location Properties…", onSelect: () => open("locationProperties", { location: SAMPLE_LOCATIONS[1] }) }] : []),
    ...(layer === "sprites" ? [{ label: "Sprite Properties…", onSelect: () => open("spriteProperties") }] : []),
    ...(layer === "terrain" ? [{ label: "Pick Terrain", onSelect: () => open("notImplemented", { feature: "Pick Terrain" }) }, { label: "Fill Area", onSelect: () => open("notImplemented", { feature: "Fill Area" }) }] : []),
    { label: "", sep: true },
    { label: "Cut", onSelect: () => open("notImplemented", { feature: "Cut" }) },
    { label: "Copy", onSelect: () => open("notImplemented", { feature: "Copy" }) },
    { label: "Paste", onSelect: () => open("notImplemented", { feature: "Paste" }) },
    { label: "Delete", disabled: true },
    { label: "", sep: true },
    { label: "Center Minimap Here", onSelect: () => open("notImplemented", { feature: "Center Minimap" }) },
    { label: "Map Properties…", onSelect: () => open("mapProperties") },
  ];

  return (
    <div className="viewport">
      <div className="ruler-corner"><Crosshair size={11} /></div>
      <div className="ruler top"><canvas ref={topRef} /></div>
      <div className="ruler left"><canvas ref={leftRef} /></div>
      <ContextMenu.Root>
        <ContextMenu.Trigger asChild>
          <div ref={scrollerRef} className="scroller" onScroll={draw} tabIndex={0}>
            <div className="map-surface" style={{ width: worldW, height: worldH }} onMouseMove={onMove} onMouseLeave={onLeave}>
              <canvas ref={canvasRef} style={{ position: "sticky", top: 0, left: 0 }} />
            </div>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Content className="menu-content">
            {ctxItems.map((it, i) =>
              it.sep ? (
                <ContextMenu.Separator key={i} className="menu-separator" />
              ) : (
                <ContextMenu.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect}>
                  {it.label}
                </ContextMenu.Item>
              ),
            )}
          </ContextMenu.Content>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      <div className="map-hud">
        <span className="hud-chip"><b>{tileset.name}</b></span>
        <span className="hud-chip">{mapW}×{mapH}</span>
        <span className="hud-chip">{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
