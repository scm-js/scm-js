/**
 * Blocks and pieces on the plugin API (`api.terrain.sheet` / `blockFrom` / `pieces` / `pieceAt` /
 * `blockOf` / `cutPieces` / `providePieces` / `provideTypes`, the `block` of `active()`, and the
 * checks `tx.placeBlock` / `tx.fillPattern` run). Over the same functions the Tile palette uses:
 * `editor/tileSheet.ts`, `pieces.ts`, `tileCopies.ts`, `pieceList.ts`, `services/pieces.ts`.
 */
import type { createStore } from "jotai";
import { mapTilesetAtom } from "../atoms/editorAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { providedPiecesAtom, providedTypesAtom } from "../atoms/pieceAtoms";
import { addedGroupsFrom } from "../data/remasteredTiles";
import { TILESET_BY_ID, TILESETS } from "../data/tilesets";
import { megatileForTile } from "../formats/tileset/decode";
import { peekTileset } from "../formats/tileset/load";
import { cutPieces, emptyEvidence, gatherEvidence, pieceBlock, type Piece } from "../editor/pieces";
import { collapsePieces } from "../editor/tileCopies";
import { laidPieceAt } from "../editor/piecePick";
import type { ListedPiece } from "../editor/pieceList";
import { blockFromRect, HOLE, sheetRows, SHEET_COLUMNS, type TileBlock } from "../editor/tileSheet";
import { piecesFromStore, sectionsFromStore } from "../services/pieces";
import type { Disposable, PieceSetSpec, TerrainApi, TerrainPiece, TerrainTypeSpec } from "./api";

type Store = ReturnType<typeof createStore>;
interface Bag { add(dispose: () => void): Disposable }

/** A block as a plugin hands it in, checked: whole numbers, `cols × rows` ids, each a tile id or -1. Throws in words. */
export function checkedBlock(block: unknown, what = "block"): TileBlock {
  const b = block as Partial<TileBlock> | null;
  const whole = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= max;
  if (!b || typeof b !== "object" || !whole(b.cols, 4096) || !whole(b.rows, 4096) || !Array.isArray(b.ids) || b.ids.length !== b.cols! * b.rows!) {
    throw new Error(`${what} needs whole cols and rows and cols × rows ids.`);
  }
  if (!b.ids.every((id) => Number.isInteger(id) && id >= HOLE && id <= 0xffff)) throw new Error(`${what}'s ids must be tile ids (0–65535) or -1 for a hole.`);
  const origin = b.origin && Number.isInteger(b.origin.group) && Number.isInteger(b.origin.slot) ? { group: b.origin.group, slot: b.origin.slot } : undefined;
  return { cols: b.cols!, rows: b.rows!, ids: [...b.ids], ...(origin ? { origin } : {}) };
}

/** The block's ids handed out as a copy, so a plugin keeping one cannot change the brush's. */
const copyBlock = (b: TileBlock): TileBlock => ({ cols: b.cols, rows: b.rows, ids: [...b.ids], ...(b.origin ? { origin: { ...b.origin } } : {}) });

/** The blocks of the pieces handed out, so `blockOf` gives a provided piece back as it was given. */
const blocks = new WeakMap<TerrainPiece, TileBlock>();

function outOfListed(i: ListedPiece): TerrainPiece {
  const p: TerrainPiece = {
    tiles: [...i.tiles], slot: i.slot, group: i.group, cols: i.block.cols, rows: i.block.rows, laid: i.laid,
    ...(i.name !== undefined ? { name: i.name } : {}), ...(i.category !== undefined ? { category: i.category } : {}),
    copies: i.entry?.copies.length ?? 0, source: i.source,
  };
  blocks.set(p, i.block);
  return p;
}

function outOfPiece(piece: Piece, copies = 0): TerrainPiece {
  const p: TerrainPiece = { tiles: [...piece.tiles], slot: piece.slot, group: piece.group, cols: piece.cols, rows: piece.rows, laid: piece.laid, copies, source: "maps" };
  blocks.set(p, pieceBlock(piece));
  return p;
}

/** `blockOf`: the block kept for a piece handed out, else its rectangle in the sheet from its tiles. */
export function blockOfPiece(piece: TerrainPiece): TileBlock {
  const kept = blocks.get(piece);
  if (kept) return copyBlock(kept);
  const ids = Array.from({ length: piece.cols * piece.rows }, () => HOLE);
  for (const t of piece.tiles) {
    const row = (t >> 4) - piece.group, col = (t & 15) - piece.slot;
    if (row >= 0 && row < piece.rows && col >= 0 && col < piece.cols) ids[row * piece.cols + col] = t;
  }
  return { cols: piece.cols, rows: piece.rows, ids, origin: { group: piece.group, slot: piece.slot } };
}

type PieceCalls = Pick<TerrainApi, "sheet" | "blockFrom" | "pieces" | "pieceAt" | "blockOf" | "cutPieces" | "providePieces" | "provideTypes">;

export function pieceCalls(store: Store, pluginId: string, bag: Bag): PieceCalls {
  const loaded = () => peekTileset(store.get(tilesetFileNameAtom));
  const era = () => Math.max(0, TILESETS.findIndex((t) => t.id === store.get(mapTilesetAtom)));
  const tilesetOf = (id: unknown, call: string) => {
    if (typeof id !== "string" || !(id in TILESET_BY_ID)) throw new Error(`${call} needs a tileset id: ${TILESETS.map((t) => t.id).join(", ")}.`);
    return id as keyof typeof TILESET_BY_ID;
  };
  const idOf = (id: unknown, call: string) => {
    if (typeof id !== "string" || id === "") throw new Error(`${call} needs an id.`);
    return id;
  };
  return {
    sheet: () => {
      const l = loaded();
      return l ? { columns: SHEET_COLUMNS, groups: l.tileset.groups.length, addedFrom: addedGroupsFrom(era(), l.tileset.groups.length) } : null;
    },
    blockFrom: ({ group, slot, cols, rows }) => {
      const l = loaded();
      if (!l || ![group, slot, cols, rows].every(Number.isInteger) || cols < 1 || rows < 1 || group < 0 || slot < 0) return null;
      if (slot + cols > SHEET_COLUMNS || group + rows > l.tileset.groups.length) return null;
      const rowsOf = sheetRows(Array.from({ length: rows }, (_, i) => group + i));
      return blockFromRect(rowsOf, { row0: 0, col0: slot, row1: rows - 1, col1: slot + cols - 1 }, (id) => megatileForTile(l.tileset, id) <= 0);
    },
    pieces: () => sectionsFromStore(store, loaded()?.tileset ?? null).flatMap((s) => s.items.map(outOfListed)),
    pieceAt: (x, y) => {
      const l = loaded(), scn = store.get(scenarioAtom);
      const cut = piecesFromStore(store, l?.tileset ?? null);
      if (!l || !scn || !cut) return null;
      const piece = laidPieceAt(scn, l.tileset.groups.length, cut.index, x, y);
      return piece ? outOfPiece(piece) : null;
    },
    blockOf: (piece) => blockOfPiece(piece),
    cutPieces: (maps) => {
      const l = loaded();
      if (!l) return [];
      const evidence = emptyEvidence();
      for (const m of maps) {
        if (!m || !Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 1 || m.height < 1 || !m.tiles || m.tiles.length < m.width * m.height) continue;
        gatherEvidence(evidence, m.tiles, m.width, m.height, l.tileset);
      }
      return collapsePieces(l.tileset, cutPieces(evidence)).map((e) => outOfPiece(e.piece, e.copies.length));
    },
    providePieces: (spec) => {
      const id = idOf(spec?.id, "providePieces");
      const tileset = tilesetOf(spec.tileset, "providePieces");
      if (!Array.isArray(spec.pieces)) throw new Error("providePieces needs a list of pieces.");
      const pieces = spec.pieces.map((p: PieceSetSpec["pieces"][number], i: number) => ({
        ...(typeof p?.name === "string" ? { name: p.name } : {}),
        ...(typeof p?.category === "string" ? { category: p.category } : {}),
        block: checkedBlock(p?.block, `providePieces: piece ${i + 1}`),
      }));
      const key = `${pluginId}:${id}`;
      const others = store.get(providedPiecesAtom).filter((s) => s.key !== key);
      const set = { key, source: pluginId, label: String(spec.label || id), tileset, pieces };
      store.set(providedPiecesAtom, [...others, set]);
      // By the set itself, not its key: disposing an earlier handle must not take a later set of the same id away.
      return bag.add(() => store.set(providedPiecesAtom, store.get(providedPiecesAtom).filter((s) => s !== set)));
    },
    provideTypes: (spec: TerrainTypeSpec) => {
      const id = idOf(spec?.id, "provideTypes");
      const tileset = tilesetOf(spec.tileset, "provideTypes");
      if (!Array.isArray(spec.types)) throw new Error("provideTypes needs a list of types.");
      const types = spec.types
        .filter((d) => d && typeof d.name === "string" && d.name !== "" && Number.isInteger(d.group) && d.group >= 0 && d.group % 2 === 0)
        .map((d) => ({ name: d.name, group: d.group }));
      const key = `${pluginId}:${id}`;
      const others = store.get(providedTypesAtom).filter((s) => s.key !== key);
      const set = { key, source: pluginId, tileset, types };
      store.set(providedTypesAtom, [...others, set]);
      return bag.add(() => store.set(providedTypesAtom, store.get(providedTypesAtom).filter((s) => s !== set)));
    },
  };
}

export { copyBlock };
