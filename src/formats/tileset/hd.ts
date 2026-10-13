/**
 * StarCraft: Remastered's terrain at twice the size: `HD2/TileSet/<name>.dds.vr4`, one
 * 64 × 64 picture per megatile where the classic tables compose a 32 × 32 one out of
 * minitiles. Picture N is megatile N of the same installation's tile tables, so nothing
 * about a map changes — only where a megatile's pixels come from.
 *
 * The file is a count and then, per picture, a small header and a whole DDS image
 * compressed as DXT1. A tileset has six to nine thousand of them and a map uses a few
 * hundred, so nothing is decoded up front: `hdSource` decodes a megatile the first time
 * it is asked for and keeps it in an atlas page, which is what the viewport blits from.
 */
import { MEGATILE_PX } from "./decode";

/** Source pixels per megatile in the 2x files. */
export const HD_TILE_PX = MEGATILE_PX * 2;
/**
 * Pixels of border around every megatile in a page, filled with its own edge pixels, for
 * the reason `ATLAS_GUTTER` gives. Two rather than one: at 100% these tiles are drawn at
 * half their size, and a smoothed sample at the edge reaches a whole source pixel out.
 */
export const HD_GUTTER = 2;
const PITCH = HD_TILE_PX + 2 * HD_GUTTER;
/** Megatiles per page row, and per page: a page is a 2176 × 2176 canvas, 19 MB. */
const PAGE_COLUMNS = 32;
const PAGE_CELLS = PAGE_COLUMNS * PAGE_COLUMNS;

const DDS_MAGIC = 0x20534444; // 'DDS '
const DDS_HEADER = 128;
const FOURCC_DXT1 = 0x31545844; // 'DXT1'
/** A 64 × 64 DXT1 image: 16 × 16 blocks of 8 bytes. */
const DXT1_BYTES = (HD_TILE_PX / 4) * (HD_TILE_PX / 4) * 8;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** A parsed `.dds.vr4`: where each megatile's compressed pixels start in `bytes`. */
export interface HdTileFile {
  bytes: Uint8Array;
  count: number;
  /** Offset of megatile N's DXT1 data (past its DDS header). */
  offsets: Uint32Array;
}

/**
 * Read the picture table of a 2x tile file. Null when the bytes are not one — a dev
 * server's index.html for a file that is not there — or hold anything but 64 × 64 DXT1
 * pictures, which is the only layout this draws.
 */
export function parseHdTiles(bytes: Uint8Array): HdTileFile | null {
  if (bytes.length < 8) return null;
  const count = u16(bytes, 4);
  if (count === 0) return null;
  const offsets = new Uint32Array(count);
  let p = 8;
  for (let i = 0; i < count; i++) {
    if (p + 12 + DDS_HEADER > bytes.length) return null;
    const width = u16(bytes, p + 4), height = u16(bytes, p + 6), size = u32(bytes, p + 8);
    const dds = p + 12;
    if (width !== HD_TILE_PX || height !== HD_TILE_PX || size < DDS_HEADER + DXT1_BYTES || dds + size > bytes.length) return null;
    if (u32(bytes, dds) !== DDS_MAGIC || u32(bytes, dds + 84) !== FOURCC_DXT1) return null;
    offsets[i] = dds + DDS_HEADER;
    p = dds + size;
  }
  return { bytes, count, offsets };
}

/** Cheap enough to run on every candidate before it is parsed: the first picture's header. */
export function looksLikeHdTiles(bytes: Uint8Array): boolean {
  return bytes.length > 20 + DDS_HEADER && u16(bytes, 4) > 0 && u32(bytes, 20) === DDS_MAGIC;
}

/**
 * Decode a DXT1 image of `width` × `height` (multiples of four) starting at `offset` into
 * an RGBA buffer `destWidth` wide, with its top-left at (`dx`, `dy`). Alpha is written
 * opaque: terrain has no holes, and the one-bit transparency DXT1 allows is not used.
 */
export function decodeDxt1(src: Uint8Array, offset: number, width: number, height: number, dest: Uint8ClampedArray | Uint8Array, destWidth: number, dx: number, dy: number): void {
  const r = [0, 0, 0, 0], g = [0, 0, 0, 0], b = [0, 0, 0, 0];
  let p = offset;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      const c0 = u16(src, p), c1 = u16(src, p + 2);
      // 5:6:5, widened to eight bits by repeating the high bits into the low ones.
      r[0] = ((c0 >> 11) << 3) | (c0 >> 13); g[0] = (((c0 >> 5) & 63) << 2) | ((c0 >> 9) & 3); b[0] = ((c0 & 31) << 3) | ((c0 >> 2) & 7);
      r[1] = ((c1 >> 11) << 3) | (c1 >> 13); g[1] = (((c1 >> 5) & 63) << 2) | ((c1 >> 9) & 3); b[1] = ((c1 & 31) << 3) | ((c1 >> 2) & 7);
      if (c0 > c1) {
        r[2] = ((2 * r[0] + r[1]) / 3) | 0; g[2] = ((2 * g[0] + g[1]) / 3) | 0; b[2] = ((2 * b[0] + b[1]) / 3) | 0;
        r[3] = ((r[0] + 2 * r[1]) / 3) | 0; g[3] = ((g[0] + 2 * g[1]) / 3) | 0; b[3] = ((b[0] + 2 * b[1]) / 3) | 0;
      } else {
        r[2] = (r[0] + r[1]) >> 1; g[2] = (g[0] + g[1]) >> 1; b[2] = (b[0] + b[1]) >> 1;
        r[3] = 0; g[3] = 0; b[3] = 0;
      }
      let bits = u32(src, p + 4);
      p += 8;
      for (let y = 0; y < 4; y++) {
        let at = ((dy + by + y) * destWidth + dx + bx) * 4;
        for (let x = 0; x < 4; x++) {
          const k = bits & 3;
          bits >>>= 2;
          dest[at] = r[k]; dest[at + 1] = g[k]; dest[at + 2] = b[k]; dest[at + 3] = 255;
          at += 4;
        }
      }
    }
  }
}

/** One megatile as RGBA with its gutter: (`HD_TILE_PX` + 2 × `HD_GUTTER`)² pixels, edges repeated outward. */
export function decodeHdCell(file: HdTileFile, megatile: number, dest: Uint8ClampedArray | Uint8Array): void {
  decodeDxt1(file.bytes, file.offsets[megatile], HD_TILE_PX, HD_TILE_PX, dest, PITCH, HD_GUTTER, HD_GUTTER);
  const last = HD_GUTTER + HD_TILE_PX - 1;
  const copy = (fromX: number, fromY: number, toX: number, toY: number) => {
    const from = (fromY * PITCH + fromX) * 4, to = (toY * PITCH + toX) * 4;
    dest[to] = dest[from]; dest[to + 1] = dest[from + 1]; dest[to + 2] = dest[from + 2]; dest[to + 3] = 255;
  };
  // Left and right first, then whole rows up and down, so the corners take the corner pixel.
  for (let y = HD_GUTTER; y <= last; y++) {
    for (let g = 1; g <= HD_GUTTER; g++) {
      copy(HD_GUTTER, y, HD_GUTTER - g, y);
      copy(last, y, last + g, y);
    }
  }
  for (let x = 0; x < PITCH; x++) {
    for (let g = 1; g <= HD_GUTTER; g++) {
      copy(x, HD_GUTTER, x, HD_GUTTER - g);
      copy(x, last, x, last + g);
    }
  }
}

/** The 2x pictures of one tileset, decoded as they are asked for. */
export interface HdTiles {
  file: HdTileFile;
  /** Source pixels per megatile. */
  tileSize: number;
  pages: HTMLCanvasElement[];
  /** Megatile → slot across the pages, or -1 while it has not been drawn. */
  slot: Int32Array;
  used: number;
  /** One cell's pixels, reused for every decode. */
  scratch: ImageData | null;
  /** The tileset's moving water or lava, where the data set has the files for it. */
  effects?: HdEffects | null;
}

export function createHdTiles(file: HdTileFile): HdTiles {
  return { file, tileSize: HD_TILE_PX, pages: [], slot: new Int32Array(file.count).fill(-1), used: 0, scratch: null };
}

/**
 * The page and source position to blit megatile `megatile` from, decoding it on first
 * use. Null when the file has no such picture (or there is no canvas here), in which case
 * the caller draws the classic one.
 */
export function hdSource(hd: HdTiles, megatile: number): { image: HTMLCanvasElement; sx: number; sy: number } | null {
  if (megatile < 0 || megatile >= hd.file.count) return null;
  let slot = hd.slot[megatile];
  if (slot < 0) {
    if (typeof document === "undefined") return null;
    slot = hd.used++;
    const index = Math.floor(slot / PAGE_CELLS);
    let page = hd.pages[index];
    if (!page) {
      page = document.createElement("canvas");
      page.width = page.height = PAGE_COLUMNS * PITCH;
      hd.pages[index] = page;
    }
    const ctx = page.getContext("2d");
    if (!ctx) {
      hd.used--;
      return null;
    }
    hd.scratch ??= new ImageData(PITCH, PITCH);
    decodeHdCell(hd.file, megatile, hd.scratch.data);
    const cell = slot % PAGE_CELLS;
    ctx.putImageData(hd.scratch, (cell % PAGE_COLUMNS) * PITCH, Math.floor(cell / PAGE_COLUMNS) * PITCH);
    hd.slot[megatile] = slot;
  }
  const cell = slot % PAGE_CELLS;
  return {
    image: hd.pages[Math.floor(slot / PAGE_CELLS)],
    sx: (cell % PAGE_COLUMNS) * PITCH + HD_GUTTER,
    sy: Math.floor(cell / PAGE_COLUMNS) * PITCH + HD_GUTTER,
  };
}

/* ── Water and lava ─────────────────────────────────────── */

/**
 * Remastered does not animate water by rotating the palette. It draws the terrain and
 * then bends it: water is the ground seen through moving ripples, lava the ground seen
 * through heat. What the files hold for that is *where* — a table from megatile to a
 * mask picture, and the mask pictures — and the textures the bending is read from.
 * `components/viewport/effectPass.ts` is the bending itself.
 */

/** Which megatiles take the effect, and with which mask: megatile → picture number in the mask file. */
export type TileMasks = Map<number, number>;

const TMSK_MAGIC = 0x544d534b; // 'KSMT'

/** `<name>.tmsk`: 'KSMT', a version, a count, then megatile and mask number pairs. Null when the bytes are not one. */
export function parseTileMasks(bytes: Uint8Array): TileMasks | null {
  if (bytes.length < 8 || u32(bytes, 0) !== TMSK_MAGIC) return null;
  const count = u16(bytes, 6);
  if (8 + count * 4 > bytes.length) return null;
  const out: TileMasks = new Map();
  for (let i = 0; i < count; i++) out.set(u16(bytes, 8 + i * 4), u16(bytes, 10 + i * 4));
  return out;
}

/** One picture of a `.dds.grp`: its size, and where its DXT1 blocks start. */
export interface GrpPicture {
  width: number;
  height: number;
  data: number;
  /** The blocks' length in bytes — what a compressed upload to the graphics card takes whole. */
  size: number;
}

/**
 * The pictures of any `.dds.grp` — the container the 2x tile and mask files share, here
 * without their fixed size: the ripple textures are 64 and 256 pixels square. DXT1 only.
 */
export function parseDdsGrp(bytes: Uint8Array): GrpPicture[] | null {
  if (bytes.length < 8) return null;
  const count = u16(bytes, 4);
  if (count === 0) return null;
  const out: GrpPicture[] = [];
  let p = 8;
  for (let i = 0; i < count; i++) {
    if (p + 12 + DDS_HEADER > bytes.length) return null;
    const width = u16(bytes, p + 4), height = u16(bytes, p + 6), size = u32(bytes, p + 8);
    const dds = p + 12;
    const blocks = Math.ceil(width / 4) * Math.ceil(height / 4) * 8;
    if (width === 0 || height === 0 || size < DDS_HEADER + blocks || dds + size > bytes.length) return null;
    if (u32(bytes, dds) !== DDS_MAGIC || u32(bytes, dds + 84) !== FOURCC_DXT1) return null;
    out.push({ width, height, data: dds + DDS_HEADER, size: blocks });
    p = dds + size;
  }
  return out;
}

/** An uncompressed 32-bit DDS as RGBA — the noise the heat shimmer is read from. Null for anything else. */
export function decodeRawDds(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } | null {
  if (bytes.length < DDS_HEADER || u32(bytes, 0) !== DDS_MAGIC) return null;
  const height = u32(bytes, 12), width = u32(bytes, 16);
  // Uncompressed, 32 bits, red in the low byte: the bytes are RGBA as they stand.
  if ((u32(bytes, 80) & 4) !== 0 || u32(bytes, 88) !== 32 || u32(bytes, 92) !== 0xff) return null;
  if (width === 0 || height === 0 || DDS_HEADER + width * height * 4 > bytes.length) return null;
  return { width, height, rgba: bytes.subarray(DDS_HEADER, DDS_HEADER + width * height * 4) };
}

/** How a tileset's masked ground moves: ripples over water, or shimmer over lava. */
export type HdEffectKind = "water" | "heat";

/** A sequence of pictures in one file, for the graphics card: the bytes and where each picture's blocks are. */
export interface PictureSequence {
  bytes: Uint8Array;
  pictures: GrpPicture[];
}

/** The textures an effect is read from, shared by every tileset that has it. */
export interface HdEffectTextures {
  /** Water: the slow, large ripples and the fine ones over them. */
  large?: PictureSequence;
  fine?: PictureSequence;
  /** Heat: the noise the shimmer follows. */
  noise?: { width: number; height: number; rgba: Uint8Array };
}

/** Everything the viewport needs to animate a tileset's water or lava. */
export interface HdEffects {
  kind: HdEffectKind;
  /** Megatile → picture number in `masks`, or -1 for ground that stands still. */
  maskOf: Int32Array;
  /** The mask pictures, decoded on first use like the tiles: white where the effect is. */
  masks: HdTiles;
  textures: HdEffectTextures;
}

/**
 * Put a tileset's effect together from its files. The mask table is numbered like the tile
 * tables, so a megatile past the end of this tileset's, or a mask the file lacks, is
 * dropped. Null when nothing is left, or the textures the kind needs are missing.
 */
export function buildHdEffects(kind: HdEffectKind, megatileCount: number, table: TileMasks, masks: HdTileFile, textures: HdEffectTextures): HdEffects | null {
  if (kind === "water" ? !textures.large || !textures.fine : !textures.noise) return null;
  const maskOf = new Int32Array(megatileCount).fill(-1);
  let any = false;
  for (const [megatile, mask] of table) {
    if (megatile >= megatileCount || mask >= masks.count) continue;
    maskOf[megatile] = mask;
    any = true;
  }
  return any ? { kind, maskOf, masks: createHdTiles(masks), textures } : null;
}
