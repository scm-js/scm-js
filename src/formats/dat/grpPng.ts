/**
 * A GRP as a PNG sheet and back, against a palette the caller names (the game's palettes are its data —
 * `tileset\*.wpe`, `unit\cmdbtns\ticon.pcx` — and come from the person's own copy, never from here).
 *
 * The sheet is one PNG: every frame in a cell of the GRP's size, `columns` cells a row (17 for a GRP of facings).
 * It is written as a palette image with the palette's colours and index 0 transparent, so it reads back exactly; the
 * frames' boxes, the column count, the palette's name and whether the GRP is uncompressed are kept in `tEXt` chunks
 * (`scmjs:grp`), so the GRP that comes back is the same bytes. A PNG made elsewhere (RGBA, or another palette) is quantised: each colour to the
 * nearest of the palette's (index 0 is transparent, never chosen for an opaque pixel), and the report says which
 * colours had no exact match and how many pixels moved.
 */
import { decodePng, encodePng } from "../png";
import { decodeGrpImage, encodeGrpImage, frameFromPicture, framePicture, type GrpFramePixels, type GrpImage } from "./grpFile";

export interface NamedPalette {
  /** What the palette is (`units`, `tileset\\badlands.wpe`, …), written into the PNG and checked on the way back. */
  name: string;
  /** 256 × RGB (768 bytes; a `.wpe` is 256 × RGBX, 1024 bytes, also taken). */
  colours: Uint8Array;
}

function rgbOf(p: NamedPalette): Uint8Array {
  const c = p.colours;
  if (c.length === 768) return c;
  if (c.length === 1024) { const out = new Uint8Array(768); for (let i = 0; i < 256; i++) out.set(c.subarray(i * 4, i * 4 + 3), i * 3); return out; }
  throw new Error(`a palette is 256 colours (768 or 1024 bytes), not ${c.length} bytes`);
}

/** `raw` and `shares` are an uncompressed GRP's (`GrpImage`), so that it comes back uncompressed and shared as it was. */
interface SheetNote { v: 1; palette: string; width: number; height: number; columns: number; frames: [number, number, number, number][]; raw?: true; shares?: number[] }

/** The default number of cells a row: 17 for a GRP of facings, else about square. */
export function sheetColumns(frames: number): number {
  return frames >= 17 && frames % 17 === 0 ? 17 : Math.max(1, Math.ceil(Math.sqrt(frames)));
}

export interface GrpToPngOptions {
  /** Cells a row (default `sheetColumns`). */
  columns?: number;
  /** More `tEXt` chunks to write (Latin-1), beside `scmjs:grp`: what the sheet is, for a person or another tool. */
  text?: Record<string, string>;
}

export async function grpToPng(grpBytes: Uint8Array | GrpImage, palette: NamedPalette, options: GrpToPngOptions = {}): Promise<Uint8Array> {
  const grp = grpBytes instanceof Uint8Array ? decodeGrpImage(grpBytes) : grpBytes;
  const rgb = rgbOf(palette);
  const n = grp.frames.length;
  const columns = options.columns ?? sheetColumns(n);
  const rows = Math.max(1, Math.ceil(n / columns));
  const W = Math.max(1, grp.width * columns), H = Math.max(1, grp.height * rows);
  const indices = new Uint8Array(W * H);
  grp.frames.forEach((_, i) => {
    const pic = framePicture(grp, i);
    const ox = (i % columns) * grp.width, oy = Math.floor(i / columns) * grp.height;
    for (let y = 0; y < grp.height; y++) indices.set(pic.subarray(y * grp.width, (y + 1) * grp.width), (oy + y) * W + ox);
  });
  const pal = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) { pal.set(rgb.subarray(i * 3, i * 3 + 3), i * 4); pal[i * 4 + 3] = i === 0 ? 0 : 255; }
  const note: SheetNote = { v: 1, palette: palette.name, width: grp.width, height: grp.height, columns, frames: grp.frames.map((f) => [f.x, f.y, f.width, f.height]), ...(grp.raw ? { raw: true } : {}), ...(grp.shares ? { shares: grp.shares } : {}) };
  return encodePng({ width: W, height: H, indices, palette: pal, text: { ...options.text, "scmjs:grp": JSON.stringify(note) } });
}

export interface PngToGrpOptions {
  /** The frame size when the PNG was not written by `grpToPng` (it says its own). */
  frameWidth?: number;
  frameHeight?: number;
  /** How many frames (default: every cell of the sheet). */
  frames?: number;
}

export interface QuantiseReport {
  /** Distinct colours (`#rrggbb`) that are not in the palette, with how many pixels had each and the colour they became. */
  coloursLost: { colour: string; pixels: number; became: number }[];
  /** Opaque pixels whose colour was not exactly a palette colour. */
  pixelsChanged: number;
  /** Pixels with partial transparency, made opaque (alpha ≥ 128) or transparent. */
  pixelsAlphaRounded: number;
  /** The palette the PNG says it was made with, when that is not the one given. */
  paletteMismatch?: string;
}

/** A GRP from a PNG sheet, quantised to `palette`, with a report of what was lost. */
export async function pngToGrp(png: Uint8Array, palette: NamedPalette, options: PngToGrpOptions = {}): Promise<{ grp: Uint8Array; image: GrpImage; report: QuantiseReport }> {
  const img = await decodePng(png);
  const rgb = rgbOf(palette);
  let note: SheetNote | null = null;
  try { const parsed = img.text["scmjs:grp"] ? JSON.parse(img.text["scmjs:grp"]) : null; if (parsed && parsed.v === 1) note = parsed; } catch { note = null; }
  const fw = note?.width ?? options.frameWidth ?? img.width;
  const fh = note?.height ?? options.frameHeight ?? img.height;
  if (fw < 1 || fh < 1 || img.width % fw || img.height % fh) throw new Error(`a ${img.width} × ${img.height} sheet is not whole ${fw} × ${fh} frames`);
  const columns = note?.columns ?? img.width / fw;
  const count = note?.frames.length ?? options.frames ?? columns * (img.height / fh);
  const report: QuantiseReport = { coloursLost: [], pixelsChanged: 0, pixelsAlphaRounded: 0 };
  if (note && note.palette !== palette.name) report.paletteMismatch = note.palette;

  // Every pixel to a palette index: a palette image whose colours are the palette's maps exactly; anything else by colour.
  const exact = new Map<number, number>();
  for (let i = 255; i >= 1; i--) exact.set((rgb[i * 3] << 16) | (rgb[i * 3 + 1] << 8) | rgb[i * 3 + 2], i);
  const samePalette = !!img.indexed && img.indexed.palette.length >= 4 * 256 && Array.from({ length: 256 }, (_, i) => i).every((i) => i === 0 || (img.indexed!.palette[i * 4] === rgb[i * 3] && img.indexed!.palette[i * 4 + 1] === rgb[i * 3 + 1] && img.indexed!.palette[i * 4 + 2] === rgb[i * 3 + 2]));
  const lost = new Map<number, { pixels: number; became: number }>();
  const nearest = new Map<number, number>();
  const toIndex = (o: number): number => {
    if (samePalette) {
      const k = img.indexed!.indices[o / 4];
      if (img.indexed!.palette[k * 4 + 3] < 128) return 0;
      return k;
    }
    const a = img.rgba[o + 3];
    if (a !== 0 && a !== 255) report.pixelsAlphaRounded++;
    if (a < 128) return 0;
    const key = (img.rgba[o] << 16) | (img.rgba[o + 1] << 8) | img.rgba[o + 2];
    const hit = exact.get(key);
    if (hit !== undefined) return hit;
    let best = nearest.get(key);
    if (best === undefined) {
      let bestD = Infinity;
      best = 1;
      for (let i = 1; i < 256; i++) {
        const dr = rgb[i * 3] - img.rgba[o], dg = rgb[i * 3 + 1] - img.rgba[o + 1], db = rgb[i * 3 + 2] - img.rgba[o + 2];
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) { bestD = d; best = i; }
      }
      nearest.set(key, best);
    }
    report.pixelsChanged++;
    const l = lost.get(key) ?? { pixels: 0, became: best };
    l.pixels++;
    lost.set(key, l);
    return best;
  };

  const frames: GrpFramePixels[] = [];
  for (let f = 0; f < count; f++) {
    const ox = (f % columns) * fw, oy = Math.floor(f / columns) * fh;
    const pic = new Uint8Array(fw * fh);
    for (let y = 0; y < fh; y++) for (let x = 0; x < fw; x++) pic[y * fw + x] = toIndex(((oy + y) * img.width + ox + x) * 4);
    const box = note?.frames[f];
    if (box && fits(pic, fw, fh, box)) {
      const [bx, by, bw, bh] = box;
      const px = new Uint8Array(bw * bh);
      for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) px[y * bw + x] = by + y < fh && bx + x < fw ? pic[(by + y) * fw + bx + x] : 0;
      frames.push({ x: bx, y: by, width: bw, height: bh, pixels: px });
    } else frames.push(frameFromPicture(pic, fw, fh));
  }
  report.coloursLost = [...lost.entries()].map(([k, v]) => ({ colour: `#${k.toString(16).padStart(6, "0")}`, ...v })).sort((a, b) => b.pixels - a.pixels);
  const image: GrpImage = { width: fw, height: fh, frames, ...(note?.raw ? { raw: true } : {}), ...(note?.raw && Array.isArray(note.shares) ? { shares: note.shares } : {}) };
  return { grp: encodeGrpImage(image), image, report };
}

/** Whether every opaque pixel of a frame lies inside a kept box (so the box still describes the frame). */
function fits(pic: Uint8Array, w: number, h: number, [bx, by, bw, bh]: [number, number, number, number]): boolean {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (pic[y * w + x] && (x < bx || y < by || x >= bx + bw || y >= by + bh)) return false;
  }
  return true;
}
