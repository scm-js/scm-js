/**
 * Terrain sections. MTXM is what the game renders; TILE is StarEdit's copy of the same
 * grid and ISOM is the isometric edit history that lets the ISOM brush keep working.
 * Editors that touch terrain must keep all three consistent or the map looks correct in
 * game but re-edits wrong.
 */

export function decodeTiles(data: Uint8Array, width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height);
  const count = Math.min(out.length, data.length >> 1);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

export function encodeTiles(tiles: Uint16Array): Uint8Array {
  const out = new Uint8Array(tiles.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < tiles.length; i++) view.setUint16(i * 2, tiles[i], true);
  return out;
}

/** ISOM is a (width/2 + 1) x (height + 1) grid of 4 uint16 per cell. */
export function isomSize(width: number, height: number): number {
  return (Math.floor(width / 2) + 1) * (height + 1) * 8;
}

export function decodeIsom(data: Uint8Array, width: number, height: number): Uint16Array {
  const out = new Uint16Array(isomSize(width, height) / 2);
  const count = Math.min(out.length, data.length >> 1);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

export function encodeIsom(isom: Uint16Array): Uint8Array {
  return encodeTiles(isom);
}

/** MASK is one byte per tile: bits 0-7 hide the tile from that player. */
export function decodeMask(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  out.set(data.subarray(0, Math.min(out.length, data.length)));
  return out;
}

/** Split an MTXM tile id into its CV5 group and the megatile slot within it. */
export function tileGroup(id: number): number { return id >> 4; }
export function tileSubIndex(id: number): number { return id & 0xf; }
