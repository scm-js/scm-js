/**
 * StarCraft: Remastered's sprite files, `HD2/anim/main_NNN.anim`: one per images.dat
 * entry, in the GRP's place. Where a GRP is a list of palette-indexed frames, this is a
 * sprite sheet — several of them, one per *layer* (colour, team mask, normals, …), each
 * a DDS picture — and a table saying where each frame sits on the sheet and where in the
 * image's box it goes. Frame N is the GRP's frame N.
 *
 * This module has no imports, like `iscript.ts`, so the extraction can use it under
 * Node's type stripping. Only the 2x files (`0x0202`) are read: the 4x ones are the same
 * layout at twice the size, and the editor has no use for them.
 */

const MAGIC = 0x4d494e41; // 'ANIM'
/** The 2x files. Their frame table is in 4x pixels all the same; `parseAnim` halves it. */
export const ANIM_VERSION_HD2 = 0x0202;
const NAMES_AT = 12;
const NAME_SIZE = 32;
const NAME_SLOTS = 10;
const ENTRY_AT = NAMES_AT + NAME_SLOTS * NAME_SIZE;
const LAYER_SIZE = 12;
const FRAME_SIZE = 16;

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const i16 = (b: Uint8Array, o: number) => (u16(b, o) << 16) >> 16;
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** One layer's picture: a whole DDS file inside the anim. Absent layers have no size. */
export interface AnimLayer {
  name: string;
  offset: number;
  size: number;
  width: number;
  height: number;
}

/** A frame, in the 2x sheet's own pixels. */
export interface AnimFrame {
  /** Where the frame's pixels are on the sheet. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Where its top-left goes in the image's box. Halves are possible: the table is kept at 4x. */
  offsetX: number;
  offsetY: number;
}

export interface Anim {
  bytes: Uint8Array;
  /** The image's box in 2x pixels — the GRP's width and height, doubled, give or take a pixel. */
  width: number;
  height: number;
  frames: AnimFrame[];
  layers: AnimLayer[];
}

/** Whether these bytes are a 2x anim holding one image, which is all `parseAnim` reads. */
export function isAnim(bytes: Uint8Array): boolean {
  return bytes.length > ENTRY_AT + 12 && u32(bytes, 0) === MAGIC && u16(bytes, 4) === ANIM_VERSION_HD2 && u16(bytes, 10) === 1;
}

/** Read an anim's tables. Null when the bytes are not a 2x anim or point outside themselves. */
export function parseAnim(bytes: Uint8Array): Anim | null {
  if (!isAnim(bytes)) return null;
  const layerCount = u16(bytes, 8);
  if (layerCount > NAME_SLOTS) return null;
  const frameCount = u16(bytes, ENTRY_AT);
  const framesAt = u32(bytes, ENTRY_AT + 8);
  const layersAt = ENTRY_AT + 12;
  if (layersAt + layerCount * LAYER_SIZE > bytes.length || framesAt + frameCount * FRAME_SIZE > bytes.length) return null;

  const layers: AnimLayer[] = [];
  for (let i = 0; i < layerCount; i++) {
    let name = "";
    for (let j = 0; j < NAME_SIZE; j++) {
      const c = bytes[NAMES_AT + i * NAME_SIZE + j];
      if (c === 0) break;
      name += String.fromCharCode(c);
    }
    const at = layersAt + i * LAYER_SIZE;
    const offset = u32(bytes, at), size = u32(bytes, at + 4);
    if (size > 0 && offset + size > bytes.length) return null;
    layers.push({ name, offset, size, width: u16(bytes, at + 8), height: u16(bytes, at + 10) });
  }

  const frames: AnimFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    const at = framesAt + i * FRAME_SIZE;
    const x = u16(bytes, at), y = u16(bytes, at + 2), w = u16(bytes, at + 8), h = u16(bytes, at + 10);
    // The sheet is the 4x sheet halved, so a rectangle's edges are; an odd edge takes the pixel it shares.
    const x0 = x >> 1, y0 = y >> 1;
    frames.push({ x: x0, y: y0, width: ((x + w + 1) >> 1) - x0, height: ((y + h + 1) >> 1) - y0, offsetX: i16(bytes, at + 4) / 2, offsetY: i16(bytes, at + 6) / 2 });
  }
  return { bytes, width: u16(bytes, ENTRY_AT + 4) / 2, height: u16(bytes, ENTRY_AT + 6) / 2, frames, layers };
}

/** The layers the editor draws from: the colour picture, and the mask of what takes the player's colour. */
export const ANIM_KEPT_LAYERS = ["diffuse", "teamcolor"];

/**
 * The same anim with only `ANIM_KEPT_LAYERS` in it. The game's other layers (normals,
 * specular, ambient occlusion, a second colour picture) are three quarters of a file the
 * editor would otherwise copy for nothing. The header and both tables keep their layout,
 * the dropped layers simply have no size, so `parseAnim` reads either. Returns the input
 * when it is not an anim, or is already this.
 */
export function slimAnim(bytes: Uint8Array): Uint8Array {
  const anim = parseAnim(bytes);
  if (!anim) return bytes;
  if (anim.layers.every((layer) => layer.size === 0 || ANIM_KEPT_LAYERS.includes(layer.name))) return bytes;

  const frameCount = anim.frames.length;
  const layersAt = ENTRY_AT + 12;
  const framesFrom = u32(bytes, ENTRY_AT + 8);
  const head = layersAt + anim.layers.length * LAYER_SIZE;
  let size = head + frameCount * FRAME_SIZE;
  for (const layer of anim.layers) if (ANIM_KEPT_LAYERS.includes(layer.name)) size += layer.size;

  const out = new Uint8Array(size);
  out.set(bytes.subarray(0, head));
  const view = new DataView(out.buffer);
  let at = head;
  view.setUint32(ENTRY_AT + 8, at, true);
  out.set(bytes.subarray(framesFrom, framesFrom + frameCount * FRAME_SIZE), at);
  at += frameCount * FRAME_SIZE;
  anim.layers.forEach((layer, i) => {
    const entry = layersAt + i * LAYER_SIZE;
    if (layer.size > 0 && ANIM_KEPT_LAYERS.includes(layer.name)) {
      view.setUint32(entry, at, true);
      out.set(bytes.subarray(layer.offset, layer.offset + layer.size), at);
      at += layer.size;
    } else {
      // Offset, size and both dimensions: an absent layer, as the game writes one.
      out.fill(0, entry, entry + LAYER_SIZE);
    }
  });
  return out;
}

/** `HD2\anim\main_007.anim`, the member an image's 2x sprite is read from. */
export const animMember = (imageId: number) => `HD2\\anim\\main_${String(imageId).padStart(3, "0")}.anim`;
/** `unit/hd/main_007.anim`, where the extraction writes it. */
export const animPath = (imageId: number) => `unit/hd/main_${String(imageId).padStart(3, "0")}.anim`;
