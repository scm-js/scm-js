/**
 * CHK is a flat stream of chunks: 4-byte name, int32 length, then that many bytes.
 *
 * StarCraft applies chunks *sequentially into fixed-size buffers*, so a section that
 * appears twice is not "last one wins" — the later copy overwrites only as many bytes
 * as it carries. Protected maps lean on this constantly, so the reader keeps every
 * occurrence in file order and `layer()` reproduces the overwrite semantics.
 */

export interface ChkSection {
  /** 4-character chunk name, latin1. May contain junk in protected maps. */
  name: string;
  /** Byte offset of the chunk's *name* within the CHK. */
  offset: number;
  /** Length field as written, which may disagree with `data.length` when truncated. */
  declaredSize: number;
  data: Uint8Array;
  /** Set when the declared size ran past the end of the file. */
  truncated?: boolean;
}

export interface ChkFile {
  sections: ChkSection[];
  /** Bytes after the last parseable chunk header, if any. */
  trailing?: Uint8Array;
}

const MAX_SECTIONS = 20000;
const decoder = new TextDecoder("latin1");

export function parseChk(bytes: Uint8Array): ChkFile {
  const sections: ChkSection[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  while (pos + 8 <= bytes.length && sections.length < MAX_SECTIONS) {
    const offset = pos;
    const name = decoder.decode(bytes.subarray(pos, pos + 4));
    const declaredSize = view.getInt32(pos + 4, true);
    pos += 8;

    // A negative length makes the game seek backwards; nothing downstream can make
    // sense of that, so stop and keep the rest as trailing bytes.
    if (declaredSize < 0) {
      sections.push({ name, offset, declaredSize, data: new Uint8Array(0), truncated: true });
      return { sections, trailing: bytes.subarray(pos) };
    }

    const available = Math.min(declaredSize, bytes.length - pos);
    const data = bytes.subarray(pos, pos + available);
    sections.push({
      name,
      offset,
      declaredSize,
      data,
      ...(available < declaredSize ? { truncated: true } : {}),
    });
    pos += available;
  }

  return pos < bytes.length ? { sections, trailing: bytes.subarray(pos) } : { sections };
}

/**
 * The inverse of `parseChk`: `serializeChk(parseChk(bytes))` is `bytes`, malformed input
 * included. The length written is the section's *declared* size, not `data.length` — the
 * two differ only for a section the reader could not take whole (a length past the end of
 * the file, or a negative one), and a plain Save must leave such a header exactly as it
 * found it: a negative length is a protection trick the game acts on, and writing the
 * bytes actually present instead would change what it parses without any edit having been
 * made. Everything that re-encodes a section sets `declaredSize` to the new length; the
 * Repair plugin is where a bad header gets straightened out on purpose.
 */
export function serializeChk(file: ChkFile): Uint8Array {
  let total = 0;
  for (const s of file.sections) total += 8 + s.data.length;
  total += file.trailing?.length ?? 0;

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (const s of file.sections) {
    for (let i = 0; i < 4; i++) out[pos + i] = s.name.charCodeAt(i) & 0xff;
    view.setInt32(pos + 4, s.declaredSize, true);
    pos += 8;
    out.set(s.data, pos);
    pos += s.data.length;
  }
  if (file.trailing) out.set(file.trailing, pos);
  return out;
}

export function sectionsNamed(file: ChkFile, name: string): ChkSection[] {
  return file.sections.filter((s) => s.name === name);
}

/**
 * How the game combines repeated occurrences of a section. Which mode applies is a
 * per-section fact (see sections/registry.ts), not something the container can infer.
 */
export type CombineMode =
  /** Zeroed fixed buffer, each occurrence copied over the front in file order. */
  | "overlay"
  /** Every occurrence's records are kept, in file order. */
  | "append"
  /** Only the last occurrence is used. */
  | "last"
  /** Only the first occurrence is used. */
  | "first";

/**
 * Collapse repeated occurrences of a section into the bytes the game would act on.
 * Returns null when the section is absent entirely.
 *
 * For "overlay", `size` gives the game's fixed buffer width; omitted, the buffer grows
 * to the longest occurrence.
 */
export function combine(file: ChkFile, name: string, mode: CombineMode, size?: number): Uint8Array | null {
  const parts = sectionsNamed(file, name);
  if (parts.length === 0) return null;

  switch (mode) {
    case "first":
      return parts[0].data;
    case "last":
      return parts[parts.length - 1].data;
    case "append": {
      if (parts.length === 1) return parts[0].data;
      const total = parts.reduce((n, p) => n + p.data.length, 0);
      const out = new Uint8Array(total);
      let pos = 0;
      for (const p of parts) { out.set(p.data, pos); pos += p.data.length; }
      return out;
    }
    case "overlay": {
      const width = size ?? Math.max(...parts.map((p) => p.data.length));
      const buf = new Uint8Array(width);
      for (const part of parts) buf.set(part.data.subarray(0, width), 0);
      return buf;
    }
  }
}
