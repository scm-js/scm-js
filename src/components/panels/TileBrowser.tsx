import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { atlasRect } from "../../formats/tileset/atlas";
import { megatileForTile, MEGATILE_PX } from "../../formats/tileset/decode";
import type { LoadedTileset } from "../../formats/tileset/load";
import type { TileGroupInfo } from "../../formats/tileset/palette";

/** Paint one tile id from the atlas; the null megatile and out-of-range ids draw as void. */
export function drawTile(ctx: CanvasRenderingContext2D, loaded: LoadedTileset, id: number, x: number, y: number, px: number) {
  const megatile = megatileForTile(loaded.tileset, id);
  if (megatile <= 0) {
    ctx.fillStyle = "#0a0c10";
    ctx.fillRect(x, y, px, px);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.moveTo(x, y + px);
    ctx.lineTo(x + px, y);
    ctx.stroke();
    return;
  }
  const { sx, sy } = atlasRect(loaded.atlas, megatile);
  ctx.drawImage(loaded.atlas.image, sx, sy, MEGATILE_PX, MEGATILE_PX, x, y, px, px);
}

/* ── Single tile thumbnail ──────────────────────────────── */

export const TileThumb = memo(function TileThumb({ loaded, id, size, className, title }: { loaded: LoadedTileset | null; id: number; size: number; className?: string; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = size < MEGATILE_PX;
    if (loaded) drawTile(ctx, loaded, id, 0, 0, size);
    else {
      ctx.fillStyle = "#2b313e";
      ctx.fillRect(0, 0, size, size);
    }
  }, [loaded, id, size]);
  return <canvas ref={ref} className={`tile-thumb ${className ?? ""}`} style={{ width: size, height: size }} title={title} />;
});

/* ── Group browser ──────────────────────────────────────── */

const COLUMNS = 8;
const LABEL_W = 52;
const ROW_GAP = 4;
const OVERSCAN = 6;

interface RowProps {
  loaded: LoadedTileset;
  group: TileGroupInfo;
  tilePx: number;
  top: number;
  selected: number;
  onSelect: (id: number) => void;
}

const GroupRow = memo(function GroupRow({ loaded, group, tilePx, top, selected, onSelect }: RowProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = COLUMNS * tilePx;
  const h = 2 * tilePx;
  const selectedSlot = selected >> 4 === group.group ? selected & 15 : -1;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = tilePx < MEGATILE_PX;
    ctx.fillStyle = "#12151b";
    ctx.fillRect(0, 0, w, h);
    const has = new Set(group.slots);
    for (let slot = 0; slot < 16; slot++) {
      const x = (slot % COLUMNS) * tilePx;
      const y = Math.floor(slot / COLUMNS) * tilePx;
      if (has.has(slot)) drawTile(ctx, loaded, (group.group << 4) | slot, x, y, tilePx);
    }
    if (selectedSlot >= 0) {
      const x = (selectedSlot % COLUMNS) * tilePx;
      const y = Math.floor(selectedSlot / COLUMNS) * tilePx;
      ctx.strokeStyle = "#e6b95c";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, tilePx - 2, tilePx - 2);
    }
  }, [loaded, group, tilePx, w, h, selectedSlot]);

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const col = Math.floor((e.clientX - r.left) / tilePx);
    const row = Math.floor((e.clientY - r.top) / tilePx);
    const slot = row * COLUMNS + col;
    if (slot < 0 || slot > 15 || !group.slots.includes(slot)) return;
    onSelect((group.group << 4) | slot);
  };

  return (
    <div className={`tile-row ${selectedSlot >= 0 ? "is-selected" : ""} kind-${group.kind}`} style={{ top, height: h }}>
      <div className="tile-row-lbl" title={`Group ${group.group} · ${group.label}`}>
        <span className="mono">{group.group}</span>
        <span className="name">{group.label}</span>
      </div>
      <canvas ref={ref} style={{ width: w, height: h }} onClick={onClick} />
    </div>
  );
});

export interface TileBrowserProps {
  loaded: LoadedTileset;
  groups: TileGroupInfo[];
  selected: number;
  onSelect: (id: number) => void;
}

/**
 * Every tile group as a row of 8x2 thumbnails, windowed so a 1,600-group tileset
 * costs a couple of dozen canvases rather than thousands.
 */
export function TileBrowser({ loaded, groups, selected, onSelect }: TileBrowserProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); setViewH(el.clientHeight); });
    ro.observe(el);
    setWidth(el.clientWidth);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const tilePx = Math.max(14, Math.min(MEGATILE_PX, Math.floor((width - LABEL_W - 12) / COLUMNS)));
  const rowH = tilePx * 2 + ROW_GAP;
  const total = groups.length * rowH;

  const rowOf = useMemo(() => new Map(groups.map((g, i) => [g.group, i])), [groups]);

  // Keep the selected group in view when the selection comes from elsewhere (the
  // Index box, the eyedropper); a click inside the browser is already visible.
  useEffect(() => {
    const el = ref.current;
    const row = rowOf.get(selected >> 4);
    if (!el || row === undefined) return;
    const top = row * rowH;
    if (top < el.scrollTop || top + rowH > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowH / 2);
      setScrollTop(el.scrollTop);
    }
  }, [selected, rowOf, rowH]);

  const first = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const last = Math.min(groups.length, Math.ceil((scrollTop + viewH) / rowH) + OVERSCAN);

  return (
    <div ref={ref} className="palette-scroll tile-browser" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ position: "relative", height: total }}>
        {width > 0 && groups.slice(first, last).map((g, i) => (
          <GroupRow key={g.group} loaded={loaded} group={g} tilePx={tilePx} top={(first + i) * rowH} selected={selected} onSelect={onSelect} />
        ))}
      </div>
      {groups.length === 0 && <div className="hint" style={{ padding: 12 }}>No tile groups match.</div>}
    </div>
  );
}
