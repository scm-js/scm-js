import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ContextMenu } from "radix-ui";
import { Crosshair, Loader2 } from "lucide-react";
import {
  activeLayerAtom,
  activeTerrainAtom,
  activeTileAtom,
  brushSizeAtom,
  centerViewOnAtom,
  cursorTileAtom,
  gridSizeAtom,
  mapHeightAtom,
  mapTilesetAtom,
  mapWidthAtom,
  rectVariationAtom,
  terrainModeAtom,
  viewFlagsAtom,
  viewportRectAtom,
  zoomAtom,
} from "../../atoms/editorAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { locationsAtom, scenarioAtom, START_LOCATION_UNIT, startLocationsAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { useTileset } from "../../hooks/useTileset";
import { paintsTiles, useTerrainTools, type MapPoint } from "../../hooks/useTerrainTools";
import { linePoints } from "../../editor/terrain";
import { diamondAt } from "../../editor/isom";
import { atlasSource, setAtlasStep } from "../../formats/tileset/atlas";
import { cycleStepAt } from "../../formats/tileset/cycle";
import { megatileForTile } from "../../formats/tileset/decode";
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
  /** Pointer position in map pixels; the isometric brush needs finer than tile resolution. */
  const hoverPointRef = useRef<MapPoint | null>(null);
  /** Diamond under the pointer at the last redraw, so the isometric outline follows the pointer within a tile. */
  const hoverDiamondRef = useRef("");
  /** Last tile a stroke painted, so a fast drag fills the gap with a line. */
  const strokeRef = useRef<{ x: number; y: number } | null>(null);
  /** Tile under the pointer when the context menu opened. */
  const menuTileRef = useRef<{ x: number; y: number } | null>(null);
  const menuPointRef = useRef<MapPoint | null>(null);
  /** Whether the last paint blitted any cycling (water/lava) megatile, so the animation loop knows when a repaint shows anything. */
  const animatedInViewRef = useRef(false);
  const lastViewportRect = useRef({ x: -1, y: -1, w: -1, h: -1 });
  const [size, setSize] = useState({ w: 0, h: 0 });

  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const zoom = useAtomValue(zoomAtom);
  const tileset = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const flags = useAtomValue(viewFlagsAtom);
  const gridSize = useAtomValue(gridSizeAtom);
  const layer = useAtomValue(activeLayerAtom);
  const brush = useAtomValue(brushSizeAtom);
  const terrainMode = useAtomValue(terrainModeAtom);
  // Only read so the hover preview redraws when the brush changes.
  const activeTile = useAtomValue(activeTileAtom);
  const activeTerrain = useAtomValue(activeTerrainAtom);
  const rectVariation = useAtomValue(rectVariationAtom);
  const tools = useTerrainTools();
  const setCursor = useSetAtom(cursorTileAtom);
  const setViewportRect = useSetAtom(viewportRectAtom);
  const centerOn = useAtomValue(centerViewOnAtom);
  const clearCenterOn = useSetAtom(centerViewOnAtom);
  const open = useSetAtom(openDialogAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  const painting = layer === "terrain" && scenario !== null && (paintsTiles(terrainMode) || tools.isomReady);
  const mapLocations = useAtomValue(locationsAtom);
  const mapStarts = useAtomValue(startLocationsAtom);
  const locations = scenario ? mapLocations : SAMPLE_LOCATIONS.slice(1);
  const startLocations = scenario ? mapStarts : SAMPLE_START_LOCATIONS;
  const { loaded: tilesetAssets, loading: tilesetLoading, error: tilesetError } = useTileset();

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

    // terrain
    const tiles = scenario?.tiles;
    let animatedInView = false;
    if (tiles && tilesetAssets) {
      const { atlas, tileset: ts } = tilesetAssets;
      // Below ~4px a tile the atlas blit costs more than it shows, so fill with the
      // precomputed mean colour instead.
      const flat = tilePx < 4;
      ctx.imageSmoothingEnabled = tilePx < TILE;
      for (let ty = y0; ty < y1; ty++) {
        const row = ty * mapW;
        for (let tx = x0; tx < x1; tx++) {
          const megatile = megatileForTile(ts, tiles[row + tx]);
          const px = tx * tilePx - sx;
          const py = ty * tilePx - sy;
          if (megatile < 0) {
            ctx.fillStyle = "#000";
            ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);
            continue;
          }
          if (flat) {
            const rgb = atlas.averages[megatile];
            ctx.fillStyle = `rgb(${rgb >> 16},${(rgb >> 8) & 255},${rgb & 255})`;
            ctx.fillRect(px, py, tilePx + 0.5, tilePx + 0.5);
            continue;
          }
          const src = atlasSource(atlas, megatile);
          if (src.animated) animatedInView = true;
          ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
        }
      }
      ctx.imageSmoothingEnabled = true;
    } else if (tiles && tilesetLoading) {
      // Map open, graphics still coming: a calm plate under the loading overlay. Anything
      // tile-shaped here would just be wrong terrain for a moment.
      ctx.fillStyle = "#12161d";
      ctx.fillRect(-sx, -sy, worldW, worldH);
    } else {
      // No map or no tileset graphics installed: flat tileset colour with light noise.
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

    // placed units — markers only; unit graphics need GRP decoding, which is not in yet
    if (flags.units && scenario && tilePx >= 3) {
      for (const u of scenario.units) {
        if (u.unitId === START_LOCATION_UNIT) continue;
        const ux = (u.x / TILE) * tilePx - sx;
        const uy = (u.y / TILE) * tilePx - sy;
        if (ux < -tilePx || uy < -tilePx || ux > size.w + tilePx || uy > size.h + tilePx) continue;
        const r = Math.max(2, tilePx * 0.34);
        ctx.fillStyle = (PLAYER_COLORS[u.owner] ?? PLAYER_COLORS[0]).hex + "cc";
        ctx.fillRect(ux - r, uy - r, r * 2, r * 2);
        if (tilePx >= 12) {
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 1;
          ctx.strokeRect(Math.round(ux - r) + 0.5, Math.round(uy - r) + 0.5, Math.round(r * 2), Math.round(r * 2));
        }
      }
    }

    // locations
    if (flags.locations) {
      ctx.lineWidth = 1;
      ctx.font = `${Math.max(10, Math.min(13, tilePx * 0.4))}px ${getComputedStyle(document.body).getPropertyValue("--font-ui")}`;
      for (const l of locations) {
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

    // start locations
    if (flags.startLocations) {
      for (const s of startLocations) {
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

    // hover brush, with a preview of what the terrain brush would leave behind
    const hv = hoverRef.current;
    const hp = hoverPointRef.current;
    if (hv && hp && painting && terrainMode === "isom") {
      // The isometric brush works in diamonds — 4 tiles wide, 2 tall, centred on the
      // lattice — so outline the ones this stroke would set rather than a tile square.
      ctx.strokeStyle = "#e6b95c";
      ctx.fillStyle = "rgba(230,185,92,0.12)";
      ctx.lineWidth = 1.5;
      for (const d of tools.ghostDiamondsAt(hp)) {
        const cx = d.x * 2 * tilePx - sx, cy = d.y * tilePx - sy;
        ctx.beginPath();
        ctx.moveTo(cx - 2 * tilePx, cy);
        ctx.lineTo(cx, cy - tilePx);
        ctx.lineTo(cx + 2 * tilePx, cy);
        ctx.lineTo(cx, cy + tilePx);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (hv) {
      const b = layer === "terrain" || layer === "fog" ? brush : 1;
      const off = Math.floor((b - 1) / 2);
      const hx = (hv.x - off) * tilePx - sx, hy = (hv.y - off) * tilePx - sy;
      if (painting && tilesetAssets && tilePx >= 4 && !strokeRef.current) {
        const { atlas, tileset: ts } = tilesetAssets;
        ctx.globalAlpha = 0.75;
        ctx.imageSmoothingEnabled = tilePx < TILE;
        for (const g of tools.ghostAt(hv.x, hv.y)) {
          const megatile = megatileForTile(ts, g.id);
          const px = g.x * tilePx - sx, py = g.y * tilePx - sy;
          if (megatile <= 0) {
            ctx.fillStyle = "#000";
            ctx.fillRect(px, py, tilePx, tilePx);
            continue;
          }
          const src = atlasSource(atlas, megatile);
          if (src.animated) animatedInView = true;
          ctx.drawImage(src.image, src.sx, src.sy, TILE, TILE, px, py, tilePx, tilePx);
        }
        ctx.globalAlpha = 1;
        ctx.imageSmoothingEnabled = true;
      } else {
        ctx.fillStyle = "rgba(230,185,92,0.12)";
        ctx.fillRect(hx, hy, tilePx * b, tilePx * b);
      }
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

    animatedInViewRef.current = animatedInView;
    const rect = { x: sx / tilePx, y: sy / tilePx, w: size.w / tilePx, h: size.h / tilePx };
    const prev = lastViewportRect.current;
    if (rect.x !== prev.x || rect.y !== prev.y || rect.w !== prev.w || rect.h !== prev.h) {
      lastViewportRect.current = rect;
      setViewportRect(rect);
    }
  }, [size, tilePx, mapW, mapH, worldW, worldH, tileset, flags, gridSize, layer, brush, setViewportRect, scenario, tilesetAssets, terrainRevision, locations, startLocations, painting, tools, activeTile, activeTerrain, rectVariation, tilesetLoading]);

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

  /* ── water / lava animation ──────────────────────────── */
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);

  useEffect(() => {
    const anim = tilesetAssets?.atlas.animation;
    if (!flags.animateWater || !anim || !scenario) return;
    const { atlas, tileset: ts } = tilesetAssets;
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      // Palette rotations follow the wall clock, so the phase survives re-mounts and
      // stays in step with the tile browser. Only repaint when something on screen cycles.
      if (setAtlasStep(atlas, ts, cycleStepAt(performance.now(), anim.length)) && animatedInViewRef.current) drawRef.current();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [flags.animateWater, tilesetAssets, scenario]);

  /* minimap-driven recentring */
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || !centerOn) return;
    el.scrollLeft = centerOn.x * tilePx - el.clientWidth / 2;
    el.scrollTop = centerOn.y * tilePx - el.clientHeight / 2;
    clearCenterOn(null);
    draw();
  }, [centerOn, tilePx, clearCenterOn, draw]);

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
  const tileAt = (e: { clientX: number; clientY: number }) => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return {
      x: Math.floor((e.clientX - r.left + el.scrollLeft) / tilePx),
      y: Math.floor((e.clientY - r.top + el.scrollTop) / tilePx),
    };
  };
  const pointAt = (e: { clientX: number; clientY: number }): MapPoint => {
    const el = scrollerRef.current!;
    const r = el.getBoundingClientRect();
    return { px: (e.clientX - r.left + el.scrollLeft) / zoom, py: (e.clientY - r.top + el.scrollTop) / zoom };
  };
  const clampPoint = (p: MapPoint): MapPoint => ({
    px: Math.min(mapW * TILE - 1, Math.max(0, p.px)),
    py: Math.min(mapH * TILE - 1, Math.max(0, p.py)),
  });
  const inMap = (t: { x: number; y: number }) => t.x >= 0 && t.y >= 0 && t.x < mapW && t.y < mapH;
  const clampToMap = (t: { x: number; y: number }) => ({ x: Math.min(mapW - 1, Math.max(0, t.x)), y: Math.min(mapH - 1, Math.max(0, t.y)) });

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !painting) return;
    const t = tileAt(e);
    if (!inMap(t)) return;
    if (e.altKey) { tools.pickAt(t.x, t.y, pointAt(e)); return; }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current = t;
    tools.beginStroke(t.x, t.y, pointAt(e));
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = tileAt(e);
    const point = pointAt(e);
    const stroking = strokeRef.current;
    if (stroking) {
      // Dragging outside the map keeps painting along the edge, like StarEdit.
      const c = clampToMap(t);
      if (terrainMode === "isom") {
        // The brush itself fires once per diamond, so every move can be forwarded.
        tools.paintAt(c.x, c.y, clampPoint(point));
        strokeRef.current = c;
      } else if (c.x !== stroking.x || c.y !== stroking.y) {
        for (const p of linePoints(stroking.x, stroking.y, c.x, c.y).slice(1)) tools.paintAt(p.x, p.y);
        strokeRef.current = c;
      }
    }
    if (!inMap(t)) {
      if (hoverRef.current) { hoverRef.current = null; hoverPointRef.current = null; draw(); }
      return;
    }
    hoverPointRef.current = point;
    const diamondKey = terrainMode === "isom" ? `${diamondAt(point.px, point.py).x},${diamondAt(point.px, point.py).y}` : "";
    if (!hoverRef.current || hoverRef.current.x !== t.x || hoverRef.current.y !== t.y || diamondKey !== hoverDiamondRef.current) {
      hoverRef.current = t;
      hoverDiamondRef.current = diamondKey;
      setCursor(t);
      draw();
    }
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!strokeRef.current) return;
    strokeRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    tools.endStroke();
    draw();
  };

  const onLeave = () => { hoverRef.current = null; hoverPointRef.current = null; draw(); };
  const onContextMenu = () => { menuTileRef.current = hoverRef.current; menuPointRef.current = hoverPointRef.current; };

  const withMenuTile = (fn: (x: number, y: number) => void) => () => {
    const t = menuTileRef.current;
    if (t) fn(t.x, t.y);
  };

  const ctxItems: { label: string; onSelect?: () => void; disabled?: boolean; sep?: boolean }[] = [
    ...(layer === "units" ? [{ label: "Unit Properties…", onSelect: () => open("unitProperties") }] : []),
    ...(layer === "locations" ? [{ label: "Location Properties…", onSelect: () => open("locationProperties", { location: SAMPLE_LOCATIONS[1] }) }] : []),
    ...(layer === "sprites" ? [{ label: "Sprite Properties…", onSelect: () => open("spriteProperties") }] : []),
    ...(layer === "terrain"
      ? [
          { label: terrainMode === "rect" || terrainMode === "isom" ? "Pick Terrain" : "Pick Tile", onSelect: withMenuTile((x, y) => tools.pickAt(x, y, menuPointRef.current ?? undefined)), disabled: !scenario },
          { label: "Fill Area", onSelect: withMenuTile(tools.fillAt), disabled: !painting || terrainMode === "isom" },
        ]
      : []),
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
            <div
              className={`map-surface ${painting ? "painting" : ""}`}
              style={{ width: worldW, height: worldH }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onPointerLeave={onLeave}
              onContextMenu={onContextMenu}
            >
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
      {scenario && tilesetLoading && (
        <div className="viewport-loading" role="status" aria-live="polite">
          <Loader2 size={16} className="spin" aria-hidden />
          <span>Loading {tileset.name} terrain…</span>
        </div>
      )}
      {tilesetError && (
        <div className="viewport-notice" role="status">
          <strong>No tileset graphics.</strong> Run <code>node scripts/extract-tilesets.mjs</code> against a
          StarCraft install to fill <code>public/tileset/</code>; terrain is drawn as flat colour until then.
        </div>
      )}
      <div className="map-hud">
        <span className="hud-chip"><b>{tileset.name}</b></span>
        <span className="hud-chip">{mapW}×{mapH}</span>
        <span className="hud-chip">{Math.round(zoom * 100)}%</span>
        {tilesetLoading && <span className="hud-chip">loading tileset…</span>}
      </div>
    </div>
  );
}
