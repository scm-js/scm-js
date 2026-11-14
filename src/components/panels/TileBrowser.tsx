import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { atlasSource, atlasTileSize } from "../../formats/tileset/atlas";
import { megatileForTile, MEGATILE_PX, tileGroupOf } from "../../formats/tileset/decode";
import type { LoadedTileset } from "../../formats/tileset/load";
import type { TileGroupInfo } from "../../formats/tileset/palette";
import {
  blockFromRect, blockRect, runBounds, SHEET_COLUMNS, sheetRows, type SheetRect, type SheetRow as SheetRowInfo, type TileBlock,
} from "../../editor/tileSheet";
import { t } from "../../i18n";

/** Paint one tile id from the atlas; the null megatile and out-of-range ids draw as void. */
export function drawTile(ctx: CanvasRenderingContext2D, loaded: LoadedTileset, id: number, x: number, y: number, px: number) {
  const megatile = megatileForTile(loaded.tileset, id);
  if (megatile <= 0) {
    drawVoid(ctx, x, y, px);
    return;
  }
  const { image, sx, sy, size } = atlasSource(loaded.atlas, megatile);
  ctx.drawImage(image, sx, sy, size, size, x, y, px, px);
}

/** A slot with nothing in it: dark, crossed by one faint diagonal. */
function drawVoid(ctx: CanvasRenderingContext2D, x: number, y: number, px: number) {
  ctx.fillStyle = "#0a0c10";
  ctx.fillRect(x, y, px, px);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(x, y + px);
  ctx.lineTo(x + px, y);
  ctx.stroke();
}

/* ── Single tile thumbnail ──────────────────────────────── */

export const TileThumb = memo(function TileThumb({ loaded, id, size, className, title, style }: { loaded: LoadedTileset | null; id: number; size: number; className?: string; title?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = size < (loaded ? atlasTileSize(loaded.atlas) : MEGATILE_PX);
    if (loaded) drawTile(ctx, loaded, id, 0, 0, size);
    else {
      ctx.fillStyle = "#2b313e";
      ctx.fillRect(0, 0, size, size);
    }
  }, [loaded, id, size]);
  return <canvas ref={ref} className={`tile-thumb ${className ?? ""}`} style={{ width: size, height: size, ...style }} title={title} />;
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
    ctx.imageSmoothingEnabled = tilePx < (loaded ? atlasTileSize(loaded.atlas) : MEGATILE_PX);
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
      <div className="tile-row-lbl" title={t("Group {group} · {label}", { group: group.group, label: group.label })}>
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
  // Tile # box, the eyedropper); a click inside the browser is already visible.
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
      {groups.length === 0 && <div className="hint" style={{ padding: 12 }}>{t("No tile groups match.")}</div>}
    </div>
  );
}

/* ── Sheet: a group a row, rows touching ────────────────── */

/** The group-number column at the left of the sheet. */
const SHEET_LABEL_W = 34;
/** The gap drawn between two runs of groups that are not consecutive. */
const SHEET_BREAK = 7;
/** Room left for the vertical scroll bar when the tiles are fitted to the panel. */
const SHEET_SCROLLBAR = 12;

/** Whether a CV5 group has no slot with a picture: the sheet lays it as a void row between listed groups. */
function emptyGroup(tileset: LoadedTileset["tileset"], group: number): boolean {
  const cv5 = tileset.groups[group];
  if (!cv5) return true;
  for (let s = 0; s < 16; s++) {
    const m = cv5.megatiles[s];
    if (m !== 0 && m < tileset.megatileCount) return false;
  }
  return true;
}

interface SheetLineProps {
  loaded: LoadedTileset;
  row: SheetRowInfo;
  tilePx: number;
  top: number;
  label: boolean;
}

const SheetLine = memo(function SheetLine({ loaded, row, tilePx, top, label }: SheetLineProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = SHEET_COLUMNS * tilePx;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(tilePx * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = tilePx < atlasTileSize(loaded.atlas);
    for (let slot = 0; slot < SHEET_COLUMNS; slot++) {
      // A blank row is an empty group: every slot void, as drawTile draws the null megatile.
      if (row.blank) drawVoid(ctx, slot * tilePx, 0, tilePx);
      else drawTile(ctx, loaded, (row.group << 4) | slot, slot * tilePx, 0, tilePx);
    }
  }, [loaded, row, tilePx, w]);
  return (
    <>
      {label && <span className="tile-sheet-lbl mono" style={{ top, height: tilePx, lineHeight: `${tilePx}px` }}>{row.group}</span>}
      <canvas ref={ref} className="tile-sheet-row" style={{ top, left: SHEET_LABEL_W, width: w, height: tilePx }} />
    </>
  );
});

export interface TileSheetProps {
  loaded: LoadedTileset;
  /** The listed groups, ascending. */
  groups: readonly number[];
  selected: number;
  block: TileBlock | null;
  /** Tiles at the atlas' own 32 px, scrolling sideways when the panel is narrower. */
  large: boolean;
  onSelect: (id: number) => void;
  onBlock: (block: TileBlock) => void;
}

/**
 * Every listed group as one row of its sixteen slots, rows touching, so a picture drawn across
 * slots and groups (a doodad, a mod's ruins) shows whole. A click picks one tile; a drag picks a
 * rectangle of slots × rows as a block, inside one run. Windowed by row like the other views.
 */
export function TileSheet({ loaded, groups, selected, block, large, onSelect, onBlock }: TileSheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [drag, setDrag] = useState<SheetRect | null>(null);
  const dragRef = useRef<{ rect: SheetRect; first: number; last: number; clientX: number; clientY: number } | null>(null);
  const [hover, setHover] = useState<string>("");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setWidth(el.clientWidth); setViewH(el.clientHeight); });
    ro.observe(el);
    setWidth(el.clientWidth);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  const tileset = loaded.tileset;
  const rows = useMemo(() => sheetRows(groups, (g) => emptyGroup(tileset, g)), [groups, tileset]);
  const tilePx = large ? MEGATILE_PX : Math.max(8, Math.min(MEGATILE_PX, Math.floor((width - SHEET_LABEL_W - SHEET_SCROLLBAR) / SHEET_COLUMNS)));
  const tops = useMemo(() => {
    const out = new Int32Array(rows.length);
    let breaks = 0;
    for (let i = 0; i < rows.length; i++) {
      if (i > 0 && rows[i].run !== rows[i - 1].run) breaks++;
      out[i] = i * tilePx + breaks * SHEET_BREAK;
    }
    return out;
  }, [rows, tilePx]);
  const total = rows.length === 0 ? 0 : tops[rows.length - 1] + tilePx;
  /** The last row starting at or above y (content pixels), or -1 above the first. */
  const rowAbove = useCallback((y: number): number => {
    let lo = 0, hi = rows.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tops[mid] <= y) { found = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  }, [rows, tops]);
  // Labels on every row while they fit, else on every fourth group and wherever a run starts.
  const labelStep = tilePx >= 14 ? 1 : 4;

  const rowOf = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => { if (!r.blank) m.set(r.group, i); });
    return m;
  }, [rows]);
  // Keep the picked tile in view when it was picked elsewhere (the Tile # box, the eyedropper).
  useEffect(() => {
    const el = ref.current;
    const row = rowOf.get(tileGroupOf(selected, tileset.groups.length));
    if (!el || row === undefined || dragRef.current) return;
    const top = tops[row];
    if (top < el.scrollTop || top + tilePx > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + tilePx / 2);
      setScrollTop(el.scrollTop);
    }
  }, [selected, rowOf, tops, tilePx, tileset]);

  const isVoid = useCallback((id: number) => megatileForTile(tileset, id) <= 0, [tileset]);

  /** The sheet cell under a client point: content coordinates turned to (row, col), not clamped. */
  const cellAt = (clientX: number, clientY: number) => {
    const r = contentRef.current!.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    return { col: Math.floor((x - SHEET_LABEL_W) / tilePx), y, row: rowAbove(y) };
  };

  const extendTo = (clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const c = cellAt(clientX, clientY);
    d.clientX = clientX;
    d.clientY = clientY;
    const col = Math.max(0, Math.min(SHEET_COLUMNS - 1, c.col));
    // A drag stays inside the run it started in: past a break it holds at the run's edge.
    const row = Math.max(d.first, Math.min(d.last, c.row < 0 ? d.first : c.row));
    if (row === d.rect.row1 && col === d.rect.col1) return;
    d.rect = { ...d.rect, row1: row, col1: col };
    setDrag(d.rect);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || rows.length === 0) return;
    const c = cellAt(e.clientX, e.clientY);
    if (c.col < 0 || c.col >= SHEET_COLUMNS || c.row < 0 || c.y >= tops[c.row] + tilePx) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { first, last } = runBounds(rows, c.row);
    const rect = { row0: c.row, col0: c.col, row1: c.row, col1: c.col };
    dragRef.current = { rect, first, last, clientX: e.clientX, clientY: e.clientY };
    setDrag(rect);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) { extendTo(e.clientX, e.clientY); return; }
    const c = cellAt(e.clientX, e.clientY);
    const row = rows[c.row];
    const text = row && !row.blank && c.col >= 0 && c.col < SHEET_COLUMNS && c.y < tops[c.row] + tilePx
      ? t("Group {group} · slot {slot} · {tile}", { group: row.group, slot: c.col, tile: `0x${((row.group << 4) | c.col).toString(16).toUpperCase().padStart(4, "0")}` })
      : "";
    if (text !== hover) setHover(text);
  };

  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const { rect } = d;
    if (rect.row0 === rect.row1 && rect.col0 === rect.col1) {
      const row = rows[rect.row0];
      const id = (row.group << 4) | rect.col0;
      if (!row.blank && !isVoid(id)) onSelect(id);
      return;
    }
    const picked = blockFromRect(rows, rect, isVoid);
    if (picked) onBlock(picked);
  };

  const first = Math.max(0, rowAbove(scrollTop) - OVERSCAN);
  const last = Math.min(rows.length, rowAbove(scrollTop + viewH) + 1 + OVERSCAN);

  // What the outline shows: the drag in progress, else the block picked, else the one tile.
  const outline = useMemo((): SheetRect | null => {
    if (drag) return drag;
    if (block) return blockRect(rows, block);
    const row = rowOf.get(tileGroupOf(selected, tileset.groups.length));
    return row === undefined ? null : { row0: row, col0: selected & 15, row1: row, col1: selected & 15 };
  }, [drag, block, rows, rowOf, selected, tileset]);
  const box = outline && (() => {
    const r0 = Math.min(outline.row0, outline.row1), r1 = Math.max(outline.row0, outline.row1);
    const c0 = Math.min(outline.col0, outline.col1), c1 = Math.max(outline.col0, outline.col1);
    return { left: SHEET_LABEL_W + c0 * tilePx, top: tops[r0], width: (c1 - c0 + 1) * tilePx, height: tops[r1] + tilePx - tops[r0], cols: c1 - c0 + 1, rows: r1 - r0 + 1 };
  })();

  return (
    <div
      ref={ref}
      className="palette-scroll tile-sheet"
      onScroll={(e) => {
        setScrollTop(e.currentTarget.scrollTop);
        // A wheel during a drag moves the sheet under a pointer that did not move.
        const d = dragRef.current;
        if (d) extendTo(d.clientX, d.clientY);
      }}
    >
      <div
        ref={contentRef}
        className="tile-sheet-content"
        style={{ height: total, width: SHEET_LABEL_W + SHEET_COLUMNS * tilePx }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; setDrag(null); }}
        title={hover}
      >
        {width > 0 && rows.slice(first, last).map((r, i) => {
          const at = first + i;
          const starts = at > 0 && rows[at - 1].run !== r.run;
          return (
            <Fragment key={r.group}>
              {starts && <div className="tile-sheet-break" style={{ top: tops[at] - SHEET_BREAK, height: SHEET_BREAK, left: SHEET_LABEL_W, width: SHEET_COLUMNS * tilePx }} />}
              <SheetLine loaded={loaded} row={r} tilePx={tilePx} top={tops[at]} label={!r.blank && (r.group % labelStep === 0 || starts || at === 0)} />
            </Fragment>
          );
        })}
        {box && (
          <div className={`tile-sheet-outline ${drag ? "is-dragging" : ""}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }}>
            {drag && (box.cols > 1 || box.rows > 1) && <span className="tile-sheet-size mono">{box.cols}×{box.rows}</span>}
          </div>
        )}
      </div>
      {rows.length === 0 && <div className="hint" style={{ padding: 12 }}>{t("No tile groups match.")}</div>}
    </div>
  );
}

/* ── Flat tile grid ─────────────────────────────────────── */

const GRID_PX = 24;

interface GridRowProps {
  loaded: LoadedTileset;
  tiles: number[];
  from: number;
  count: number;
  cols: number;
  top: number;
  /** Column of the selected tile within this row, or -1. */
  selectedCol: number;
  onSelect: (id: number) => void;
}

const GridRow = memo(function GridRow({ loaded, tiles, from, count, cols, top, selectedCol, onSelect }: GridRowProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = cols * GRID_PX;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = GRID_PX * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = GRID_PX < (loaded ? atlasTileSize(loaded.atlas) : MEGATILE_PX);
    ctx.fillStyle = "#12151b";
    ctx.fillRect(0, 0, w, GRID_PX);
    for (let i = 0; i < count; i++) drawTile(ctx, loaded, tiles[from + i], i * GRID_PX, 0, GRID_PX);
    if (selectedCol >= 0) {
      ctx.strokeStyle = "#e6b95c";
      ctx.lineWidth = 2;
      ctx.strokeRect(selectedCol * GRID_PX + 1, 1, GRID_PX - 2, GRID_PX - 2);
    }
  }, [loaded, tiles, from, count, cols, w, selectedCol]);

  const colAt = (e: React.MouseEvent<HTMLCanvasElement>) =>
    Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / GRID_PX);

  return (
    <canvas
      ref={ref}
      className="tile-grid-row"
      style={{ top, width: w, height: GRID_PX }}
      onClick={(e) => {
        const col = colAt(e);
        if (col >= 0 && col < count) onSelect(tiles[from + col]);
      }}
      onMouseMove={(e) => {
        const col = colAt(e);
        e.currentTarget.title = col >= 0 && col < count ? `${tiles[from + col]} · 0x${tiles[from + col].toString(16).toUpperCase().padStart(4, "0")}` : "";
      }}
    />
  );
});

export interface TileGridProps {
  loaded: LoadedTileset;
  /** Every drawable tile id to show, in order. */
  tiles: number[];
  selected: number;
  onSelect: (id: number) => void;
}

/**
 * Every tile in one dense grid, group boundaries ignored — the "wall of tiles" view.
 * Windowed by row like {@link TileBrowser}, so 25,000 tiles cost a handful of canvases.
 */
export function TileGrid({ loaded, tiles, selected, onSelect }: TileGridProps) {
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

  const cols = Math.max(2, Math.floor((width - 12) / GRID_PX));
  const rows = Math.ceil(tiles.length / cols);
  const selectedIdx = useMemo(() => tiles.indexOf(selected), [tiles, selected]);

  // Follow a selection made elsewhere (the Tile # box, the eyedropper, a search).
  useEffect(() => {
    const el = ref.current;
    if (!el || selectedIdx < 0 || cols < 1) return;
    const top = Math.floor(selectedIdx / cols) * GRID_PX;
    if (top < el.scrollTop || top + GRID_PX > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 2 + GRID_PX / 2);
      setScrollTop(el.scrollTop);
    }
  }, [selectedIdx, cols]);

  const first = Math.max(0, Math.floor(scrollTop / GRID_PX) - OVERSCAN);
  const last = Math.min(rows, Math.ceil((scrollTop + viewH) / GRID_PX) + OVERSCAN);
  const selectedRow = selectedIdx < 0 ? -1 : Math.floor(selectedIdx / cols);

  return (
    <div ref={ref} className="palette-scroll tile-grid" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <div style={{ position: "relative", height: rows * GRID_PX }}>
        {width > 0 && Array.from({ length: Math.max(0, last - first) }, (_, i) => {
          const row = first + i;
          const from = row * cols;
          return (
            <GridRow
              key={row}
              loaded={loaded}
              tiles={tiles}
              from={from}
              count={Math.min(cols, tiles.length - from)}
              cols={cols}
              top={row * GRID_PX}
              selectedCol={selectedRow === row ? selectedIdx - from : -1}
              onSelect={onSelect}
            />
          );
        })}
      </div>
      {tiles.length === 0 && <div className="hint" style={{ padding: 12 }}>{t("No tiles match.")}</div>}
    </div>
  );
}
