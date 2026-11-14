import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { ArrowDownWideNarrow, Eraser, FolderOpen } from "lucide-react";
import { mapTilesetAtom } from "../../atoms/editorAtoms";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { pieceLearningAtom, providedPiecesAtom } from "../../atoms/pieceAtoms";
import { atlasSource, atlasTileSize } from "../../formats/tileset/atlas";
import { megatileForTile } from "../../formats/tileset/decode";
import type { LoadedTileset } from "../../formats/tileset/load";
import { entryPieces, type FlagDifference } from "../../editor/tileCopies";
import { pieceSections, type ListedPiece } from "../../editor/pieceList";
import { shelfLayout, shelvesIn, type ShelfBox, type ShelfLayout } from "../../editor/pieceShelves";
import { HOLE, type TileBlock } from "../../editor/tileSheet";
import { entriesOf, piecesInFront, useLearnedPieces } from "../../hooks/usePieces";
import { Button, Tip } from "../ui";
import { t } from "../../i18n";

/** The tile size every piece is drawn at, unless it is wider than the panel. */
const PIECE_TILE = 16;
const PIECE_GAP = 6;
const PAD = 8;
/** The line a provided set's label takes above its pieces. */
const HEADING = 20;
const OVERSCAN_PX = 400;
/** How long the ground has to stay still before the pieces are cut again: a stroke bumps the revision on every cell. */
const RECUT_MS = 300;

const DIFFERENCE: Record<FlagDifference, () => string> = {
  height: () => t("another height"),
  walkable: () => t("walkable in other places"),
  buildable: () => t("buildable in other places"),
};

/** What the hover says of a piece: its name, size, how often it is laid, its group, and what copies it stands for. */
function itemTitle(item: ListedPiece): string {
  const { block, entry } = item;
  const n = item.tiles.length;
  const parts: string[] = [];
  if (item.name) parts.push(item.category ? `${item.name} · ${item.category}` : item.name);
  if (entry) {
    const times = Math.max(1, Math.round(entry.piece.laid / n));
    parts.push(t("{cols}×{rows} · {n, plural, one {# tile} other {# tiles}} · laid about {times, plural, one {# time} other {# times}} · group {group}", { cols: block.cols, rows: block.rows, n, times, group: item.group }));
    if (entry.copies.length > 0) parts.push(t("Stands for {n, plural, one {# copy} other {# copies}} of the same tiles elsewhere in the tileset ({places}).", { n: entry.copies.length, places: entry.copies.slice(0, 6).map((c) => `g${c.group} s${c.slot}`).join(", ") + (entry.copies.length > 6 ? ", …" : "") }));
    if (entry.copyOf) parts.push(t("The same picture as the piece at group {group}, but {what}.", { group: entry.copyOf.piece.group, what: entry.copyOf.differs.map((d) => DIFFERENCE[d]()).join(", ") || t("other flags") }));
  } else {
    parts.push(t("{cols}×{rows} · {n, plural, one {# tile} other {# tiles}} · group {group}", { cols: block.cols, rows: block.rows, n, group: item.group }));
  }
  return parts.join("\n");
}

const PieceThumb = memo(function PieceThumb({ loaded, item, box, selected, onPick }: {
  loaded: LoadedTileset; item: ListedPiece; box: ShelfBox; selected: boolean; onPick: (block: TileBlock) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { block } = item;
  const { w, h, tile } = box;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = tile < atlasTileSize(loaded.atlas);
    // Holes stay empty: the piece is drawn in its own outline.
    block.ids.forEach((id, i) => {
      if (id === HOLE) return;
      const megatile = megatileForTile(loaded.tileset, id);
      if (megatile <= 0) return;
      const src = atlasSource(loaded.atlas, megatile);
      ctx.drawImage(src.image, src.sx, src.sy, src.size, src.size, (i % block.cols) * tile, Math.floor(i / block.cols) * tile, tile, tile);
    });
  }, [loaded, block, tile, w, h]);
  return (
    <canvas
      ref={ref}
      className={`piece-thumb ${selected ? "is-selected" : ""}`}
      style={{ left: box.x, top: box.y, width: w, height: h }}
      title={itemTitle(item)}
      onClick={() => onPick(block)}
    />
  );
});

export interface TilePiecesProps {
  loaded: LoadedTileset;
  /** The groups the palette's filter and search leave, or null for all. */
  listed: ReadonlySet<number> | null;
  /** The search box's text: a provided piece is also found by its name and category. */
  query: string;
  /** With the "Added by" filter: where the data set's groups begin. A piece the same as one below it is left out. */
  addedFrom: number | null;
  block: TileBlock | null;
  onBlock: (block: TileBlock) => void;
  /** Told how many pieces are listed, for the palette's footer. */
  onCount?: (n: number) => void;
}

/**
 * The Tile tab's Pieces view: the named pieces plugins provide, then the parts of the tileset's
 * sheet that maps lay whole, cut from the map in front and what was learned from a folder of
 * maps, each drawn in its own outline. A click makes a piece the Tile brush's block.
 */
export function TilePieces({ loaded, listed, query, addedFrom, block, onBlock, onCount }: TilePiecesProps) {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const revision = useAtomValue(terrainRevisionAtom);
  const learning = useAtomValue(pieceLearningAtom);
  const tilesetId = useAtomValue(mapTilesetAtom);
  const providedAll = useAtomValue(providedPiecesAtom);
  const { evidence } = useLearnedPieces(loaded.tileset);
  const [byLaid, setByLaid] = useState(false);
  const [settled, setSettled] = useState(revision);
  useEffect(() => {
    if (settled === revision) return;
    const id = setTimeout(() => setSettled(revision), RECUT_MS);
    return () => clearTimeout(id);
  }, [revision, settled]);

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

  const cut = useMemo(
    () => (scenario ? piecesInFront(scenario, settled, loaded.tileset, evidence ?? null) : null),
    [scenario, settled, loaded, evidence],
  );
  const sections = useMemo(() => {
    if (!cut) return [];
    const provided = providedAll.filter((s) => s.tileset === tilesetId);
    return pieceSections(loaded.tileset, entriesOf(loaded.tileset, cut.pieces), provided);
  }, [cut, loaded, providedAll, tilesetId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const named = (i: ListedPiece) => q !== "" && [i.name, i.category].some((s) => s?.toLowerCase().includes(q));
    const added = (i: ListedPiece) => addedFrom === null || (i.entry ? entryPieces(i.entry) : [i]).every((p) => p.tiles.every((t) => t >> 4 >= addedFrom));
    const inList = (i: ListedPiece) => !listed || named(i) || (i.entry ? entryPieces(i.entry).some((p) => listed.has(p.group)) : i.tiles.some((t) => listed.has(t >> 4)));
    const total = (i: ListedPiece) => (i.entry ? entryPieces(i.entry).reduce((n, p) => n + p.laid, 0) : i.laid);
    return sections
      .map((s) => {
        const items = s.items.filter((i) => added(i) && inList(i));
        return { ...s, items: byLaid && s.label === null ? [...items].sort((a, b) => total(b) - total(a) || a.tiles[0] - b.tiles[0]) : items };
      })
      .filter((s) => s.items.length > 0);
  }, [sections, query, listed, addedFrom, byLaid]);
  const count = shown.reduce((n, s) => n + s.items.length, 0);
  useEffect(() => { onCount?.(count); }, [count, onCount]);

  // The sections one under another: a heading for each provided set, then its shelves.
  const inner = Math.max(PIECE_TILE * 2, width - PAD * 2);
  const { layout, items, headings } = useMemo(() => {
    const boxes: ShelfBox[] = [];
    const shelves: ShelfLayout["shelves"] = [];
    const flat: ListedPiece[] = [];
    const heads: { label: string; y: number }[] = [];
    let top = 0;
    for (const s of shown) {
      if (s.label !== null) { heads.push({ label: s.label, y: top }); top += HEADING; }
      const part = shelfLayout(s.items.map((i) => i.block), inner, PIECE_TILE, PIECE_GAP);
      const base = boxes.length;
      for (const b of part.boxes) { boxes.push({ ...b, index: base + b.index, y: b.y + top }); flat.push(s.items[b.index]); }
      for (const sh of part.shelves) shelves.push({ top: sh.top + top, height: sh.height, first: sh.first + base, last: sh.last + base });
      top += part.height + PIECE_GAP * 2;
    }
    return { layout: { boxes, shelves, height: Math.max(0, top - PIECE_GAP * 2) }, items: flat, headings: heads };
  }, [shown, inner]);
  const range = shelvesIn(layout, scrollTop - OVERSCAN_PX, scrollTop + viewH + OVERSCAN_PX);
  const visible = range.last >= range.first ? layout.boxes.slice(layout.shelves[range.first].first, layout.shelves[range.last].last + 1) : [];

  const isActive = (i: ListedPiece) => !!block && (block === i.block || (!!block.origin && !!i.block.origin && block.origin.group === i.block.origin.group && block.origin.slot === i.block.origin.slot && block.cols === i.block.cols && block.rows === i.block.rows));
  const learnedMaps = cut?.learnedMaps ?? 0;
  const learn = () => { void import("../../services/pieceLearning").then((m) => m.learnPiecesFromFolder(store)); };
  const forget = () => { void import("../../services/pieceLearning").then((m) => m.forgetPieces(store)); };
  const none = sections.every((s) => s.items.length === 0);
  const source = learnedMaps > 0 ? t("From this map and {n, plural, one {# learned map} other {# learned maps}}", { n: learnedMaps }) : t("From this map");

  return (
    <>
      <div className="pieces-head row">
        {learning ? (
          <span className="grow row" style={{ gap: 6 }} title={t("Learning from maps")}>
            <span className="progress-track"><i style={{ width: `${(100 * learning.done) / Math.max(1, learning.total)}%` }} /></span>
            <span className="mono dim">{learning.done} / {learning.total}</span>
          </span>
        ) : (
          <span className="grow dim pieces-source" title={source}>{source}</span>
        )}
        {learnedMaps > 0 && !learning && (
          <Tip label={t("Forget the pieces learned from maps for these tilesets")}>
            <Button icon size="sm" onClick={forget} aria-label={t("Forget")}><Eraser size={13} /></Button>
          </Tip>
        )}
        <Button size="sm" disabled={!!learning} onClick={learn} title={t("Read every map in a folder and learn the pieces they lay")}><FolderOpen size={11} /> {" "}{t("Learn from Maps…")}</Button>
        {!none && (
          <Tip label={t("Most laid first")}>
            <Button icon size="sm" active={byLaid} onClick={() => setByLaid(!byLaid)} aria-label={t("Most laid first")}><ArrowDownWideNarrow size={13} /></Button>
          </Tip>
        )}
      </div>
      <div ref={ref} className="palette-scroll tile-pieces" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {none ? (
          <div className="hint" style={{ padding: 12 }}>
            {t("A piece is a part of the tileset's sheet that maps lay whole: a wall, a ramp, a ruin, tile beside tile as it is drawn. This map lays none, and ground laid with the Isometric and Rect brushes never makes one. Learn from a folder of maps made with the tileset to find its pieces.")}
          </div>
        ) : count === 0 ? (
          <div className="hint" style={{ padding: 12 }}>{t("No pieces match.")}</div>
        ) : (
          <div style={{ position: "relative", height: layout.height, margin: PAD }}>
            {headings.map((h) => <div key={`h${h.y}`} className="pieces-heading" style={{ top: h.y, height: HEADING }}>{h.label}</div>)}
            {visible.map((b) => {
              const item = items[b.index];
              return <PieceThumb key={`${item.source}:${b.index}:${item.tiles[0]}`} loaded={loaded} item={item} box={b} selected={isActive(item)} onPick={onBlock} />;
            })}
          </div>
        )}
      </div>
    </>
  );
}
