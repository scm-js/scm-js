import { decodeText, detectTextEncoding } from "../text/encoding";

/**
 * Blizzard `.tbl` string tables (images.tbl, stat_txt.tbl, …): a u16 count, that many u16
 * offsets from the start of the file, and NUL-terminated strings at those offsets. The
 * text is in whatever the game's own language used — the original files are Windows-1252,
 * a Remastered install's localized `stat_txt.tbl` is UTF-8, a Korean 1.16.1's is
 * EUC-KR — so the encoding is guessed from the whole file, as a map's string table is.
 */
export function decodeTbl(data: Uint8Array): string[] {
  return decodeTblEntries(data).map((parts) => parts[0] ?? "");
}

/**
 * The same table with every NUL-separated part of an entry kept. `stat_txt.tbl`'s unit
 * entries are `Name\0Subname\0Category\0` (`*` for no subname — "Terran Siege Tank",
 * "Tank Mode", "Ground Units"), and the plain `decodeTbl` only ever saw the first part.
 * An entry runs to the next entry's offset, or the end of the file for the last one; a
 * trailing empty part (the terminating NUL) is dropped.
 */
export function decodeTblEntries(data: Uint8Array): string[][] {
  if (data.length < 2) return [];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(0, true);
  const encoding = detectTextEncoding(data.subarray(Math.min(2 + count * 2, data.length)));
  const out: string[][] = [];
  const offsets: number[] = [];
  for (let i = 0; i < count; i++) {
    const at = 2 + i * 2;
    if (at + 2 > data.length) break;
    offsets.push(Math.min(view.getUint16(at, true), data.length));
  }
  for (let i = 0; i < offsets.length; i++) {
    const start = offsets[i];
    // Entries are written in order, but nothing forces it: an offset table that jumps
    // back would make the "next offset" end before the start, so fall back to the file end.
    const next = offsets[i + 1];
    const end = next !== undefined && next > start ? next : data.length;
    const parts = decodeText(data.subarray(start, end), encoding).split("\0");
    if (parts.length > 1 && parts[parts.length - 1] === "") parts.pop();
    out.push(parts);
  }
  return out;
}
