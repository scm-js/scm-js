import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { FolderOpen } from "lucide-react";
import { scenarioAtom, terrainRevisionAtom } from "../../atoms/documentAtoms";
import { pieceLearningAtom, pieceLearnReportAtom } from "../../atoms/pieceAtoms";
import { atlasSource, atlasTileSize } from "../../formats/tileset/atlas";
import { megatileForTile } from "../../formats/tileset/decode";
import type { LoadedTileset } from "../../formats/tileset/load";
import { pieceBlock, type Piece } from "../../editor/pieces";
import { collapsePieces, entryPieces, type FlagDifference, type PieceEntry } from "../../editor/tileCopies";
import { shelfLayout, shelvesIn } from "../../editor/pieceShelves";
import type { TileBlock } from "../../editor/tileSheet";
import { piecesInFront, useLearnedPieces } from "../../hooks/usePieces";
import { Button, Check } from "../ui";
import { t } from "../../i18n";

/** The tile size every piece is drawn at, unless it is wider than the panel. */
const PIECE_TILE = 16;
const PIECE_GAP = 6;
const PAD = 8;
const OVERSCAN_PX = 400;
/** How long the ground has to stay still before the pieces are cut again: a stroke bumps the revision on every cell. */
const RECUT_MS = 300;

const DIFFERENCE: Record<FlagDifference, () => string> = {
  height: () => t("another height"),
  walkable: () => t("walkable in other places"),
  buildable: () => t("buildable in other places"),
};

/** What the hover says of an entry: its size, how often it is laid, its group, and what copies it stands for. */
function entryTitle(entry: PieceEntry): string {
  const piece = entry.piece;
  const times = Math.max(1, Math.round(piece.laid / piece.tiles.length));
  const parts = [t("{cols}×{rows} · {n, plural, one {# tile} other {# tiles}} · laid about {times, plural, one {# time} other {# times}} · group {group}", { cols: piece.cols, rows: piece.rows, n: piece.tiles.length, times, group: piece.group })];
  if (entry.copies.length > 0) parts.push(t("Stands for {n, plural, one {# copy} other {# copies}} of the same tiles elsewhere in the tileset ({places}).", { n: entry.copies.length, places: entry.copies.slice(0, 6).map((c) => `g${c.group} s${c.slot}`).join(", ") + (entry.copies.length > 6 ? ", …" : "") }));
  if (entry.copyOf) parts.push(t("The same picture as the piece at group {group}, but {what}.", { group: entry.copyOf.piece.group, what: entry.copyOf.differs.map((d) => DIFFERENCE[d]()).join(", ") || t("other flags") }));
  return parts.join("\n");
}

const PieceThumb = memo(function PieceThumb({ loaded, entry, tile, selected, onPick, x, y }: {
  loaded: LoadedTileset; entry: PieceEntry; tile: number; selected: boolean; onPick: (p: Piece) => void; x: number; y: number;
}) {
  const piece = entry.piece;
  const ref = useRef<HTMLCanvasElement>(null);
  const w = piece.cols * tile, h = piece.rows * tile;
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
    for (const id of piece.tiles) {
      const megatile = megatileForTile(loaded.tileset, id);
      if (megatile <= 0) continue;
      const src = atlasSource(loaded.atlas, megatile);
      ctx.drawImage(src.image, src.sx, src.sy, src.size, src.size, ((id & 15) - piece.slot) * tile, ((id >> 4) - piece.group) * tile, tile, tile);
    }
  }, [loaded, piece, tile, w, h]);
  return (
    <canvas
      ref={ref}
      className={`piece-thumb ${selected ? "is-selected" : ""} ${entry.copyOf ? "is-flag-copy" : ""}`}
      style={{ left: x, top: y, width: w, height: h }}
      title={entryTitle(entry)}
      onClick={() => onPick(piece)}
    />
  );
});

export interface TilePiecesProps {
  loaded: LoadedTileset;
  /** The groups the palette's filter and search leave, or null for all. */
  listed: ReadonlySet<number> | null;
  /** With the "Added by" filter: where the data set's groups begin. A piece the same as one below it is left out. */
  addedFrom: number | null;
  block: TileBlock | null;
  onBlock: (block: TileBlock) => void;
  /** Told how many pieces are listed, for the palette's footer. */
  onCount?: (n: number) => void;
}

/**
 * The Tile tab's Pieces view: the parts of the tileset's sheet that maps lay whole, cut from the
 * map in front and what was learned from a folder of maps, each drawn in its own outline. A click
 * makes a piece the Tile brush's block.
 */
export function TilePieces({ loaded, listed, addedFrom, block, onBlock, onCount }: TilePiecesProps) {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const revision = useAtomValue(terrainRevisionAtom);
  const learning = useAtomValue(pieceLearningAtom);
  const report = useAtomValue(pieceLearnReportAtom);
  const { evidence } = useLearnedPieces();
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
  // One entry for pieces that are the same tiles cell for cell (a mod repeats its pictures and the game's).
  const entries = useMemo(() => (cut ? collapsePieces(loaded.tileset, cut.pieces) : []), [cut, loaded]);
  const shown = useMemo(() => {
    const kept = entries.filter((e) => {
      const members = entryPieces(e);
      if (addedFrom !== null && members.some((p) => p.group < addedFrom)) return false;
      return !listed || members.some((p) => listed.has(p.group));
    });
    const laid = (e: PieceEntry) => entryPieces(e).reduce((n, p) => n + p.laid, 0);
    return byLaid ? [...kept].sort((a, b) => laid(b) - laid(a) || a.piece.tiles[0] - b.piece.tiles[0]) : kept;
  }, [entries, listed, addedFrom, byLaid]);
  useEffect(() => { onCount?.(shown.length); }, [shown.length, onCount]);

  const inner = Math.max(PIECE_TILE * 2, width - PAD * 2);
  const layout = useMemo(() => shelfLayout(shown.map((e) => e.piece), inner, PIECE_TILE, PIECE_GAP), [shown, inner]);
  const range = shelvesIn(layout, scrollTop - OVERSCAN_PX, scrollTop + viewH + OVERSCAN_PX);
  const visible = range.last >= range.first ? layout.boxes.slice(layout.shelves[range.first].first, layout.shelves[range.last].last + 1) : [];

  const isActive = (e: PieceEntry) => entryPieces(e).some((p) => !!block?.origin && block.origin.group === p.group && block.origin.slot === p.slot && block.cols === p.cols && block.rows === p.rows);
  const learnedMaps = cut?.learnedMaps ?? 0;
  const learn = () => { void import("../../services/pieceLearning").then((m) => m.learnPiecesFromFolder(store)); };
  const forget = () => { void import("../../services/pieceLearning").then((m) => m.forgetPieces(store)); };
  const none = (cut?.pieces.length ?? 0) === 0;

  return (
    <>
      <div className="pieces-head">
        <div className="row" style={{ gap: 6 }}>
          <span className="grow dim">{learnedMaps > 0 ? t("From this map and {n, plural, one {# learned map} other {# learned maps}}", { n: learnedMaps }) : t("From this map")}</span>
          {learnedMaps > 0 && !learning && <Button size="sm" variant="ghost" onClick={forget} title={t("Forget the pieces learned from maps for this data set")}>{t("Forget")}</Button>}
          <Button size="sm" disabled={!!learning} onClick={learn} title={t("Read every map in a folder and learn the pieces they lay, for this data set")}><FolderOpen size={11} /> {" "}{t("Learn from Maps…")}</Button>
        </div>
        {learning && (
          <div className="progress">
            <div className="row">
              <span className="progress-track"><i style={{ width: `${(100 * learning.done) / Math.max(1, learning.total)}%` }} /></span>
              <span className="percent mono">{learning.done} / {learning.total}</span>
            </div>
          </div>
        )}
        {!learning && report && <div className="hint">{report}</div>}
        {!none && <Check label={t("Most laid first")} checked={byLaid} onChange={(e) => setByLaid(e.target.checked)} />}
      </div>
      <div ref={ref} className="palette-scroll tile-pieces" onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
        {none ? (
          <div className="hint" style={{ padding: 12 }}>
            {t("A piece is a part of the tileset's sheet that maps lay whole: a wall, a ramp, a ruin, tile beside tile as it is drawn. This map lays none, and ground laid with the Isometric and Rect brushes never makes one. Learn from a folder of maps made with the tileset to find its pieces.")}
          </div>
        ) : shown.length === 0 ? (
          <div className="hint" style={{ padding: 12 }}>{t("No pieces match.")}</div>
        ) : (
          <div style={{ position: "relative", height: layout.height, margin: PAD }}>
            {visible.map((b) => {
              const e = shown[b.index];
              return <PieceThumb key={e.piece.tiles[0]} loaded={loaded} entry={e} tile={b.tile} x={b.x} y={b.y} selected={isActive(e)} onPick={(piece) => onBlock(pieceBlock(piece))} />;
            })}
          </div>
        )}
      </div>
    </>
  );
}
