/**
 * Blizzard `.tbl` string tables (images.tbl, stat_txt.tbl, …): a u16 count, that many u16
 * offsets from the start of the file, and NUL-terminated latin1 strings at those offsets.
 */
export function decodeTbl(data: Uint8Array): string[] {
  if (data.length < 2) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const decoder = new TextDecoder("latin1");
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 2;
    if (at + 2 > data.length) break;
    const start = Math.min(view.getUint16(at, true), data.length);
    let end = start;
    while (end < data.length && data[end] !== 0) end++;
    out.push(decoder.decode(data.subarray(start, end)));
  }
  return out;
}
