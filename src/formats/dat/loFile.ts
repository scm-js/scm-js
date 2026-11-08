/**
 * `.lo?` overlay offsets (`unit\terran\control.lof`, …) read and written, and PyLO's text form. `lo.ts` is the editor's
 * reader (offsets in one array, with lookup helpers); this module holds a file as frames of `[x, y]` pairs, the way
 * PyLO does, and writes it back.
 *
 *   u32 frames, u32 overlays per frame, u32 offset[frames], then each frame's `overlays × (s8 x, s8 y)`.
 *
 * PyLO text: `Frame:` then one `    (x, y)` line an overlay, a blank line after each frame; `#` starts a comment.
 */

export interface LoOverlays {
  /** frames[frame][overlay] = [x, y], each −128…127. */
  frames: [number, number][][];
  /** Where each frame's pairs were in the file, kept so a file whose frames share data or sit out of order comes back as it was. */
  offsets?: number[];
}

export function decodeLoFile(data: Uint8Array): LoOverlays {
  if (data.length < 8) throw new Error(`.lo file too short (${data.length} bytes)`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint32(0, true);
  const overlays = view.getUint32(4, true);
  if (8 + count * 4 > data.length) throw new Error(`.lo file declares ${count} frames but is only ${data.length} bytes`);
  const offsets: number[] = [];
  const frames: [number, number][][] = [];
  for (let f = 0; f < count; f++) {
    const at = view.getUint32(8 + f * 4, true);
    if (at + overlays * 2 > data.length) throw new Error(`.lo frame ${f} is outside the file`);
    offsets.push(at);
    const pairs: [number, number][] = [];
    for (let i = 0; i < overlays; i++) pairs.push([view.getInt8(at + i * 2), view.getInt8(at + i * 2 + 1)]);
    frames.push(pairs);
  }
  return { frames, offsets };
}

function sameLayout(lo: LoOverlays, overlays: number): boolean {
  const { offsets, frames } = lo;
  if (!offsets || offsets.length !== frames.length) return false;
  // Kept offsets are reused only when they still describe the frames: every pair inside the file, frames that share an
  // offset still equal, and nothing overlapping that would make one frame's edit show in another.
  const size = 8 + frames.length * 4;
  const at = new Map<number, string>();
  for (let f = 0; f < frames.length; f++) {
    const o = offsets[f];
    if (o < size) return false;
    const key = frames[f].map((p) => p.join(",")).join(";");
    const was = at.get(o);
    if (was !== undefined && was !== key) return false;
    at.set(o, key);
  }
  const starts = [...at.keys()].sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i++) if (starts[i] - starts[i - 1] < overlays * 2) return false;
  return true;
}

export interface EncodeLoOptions {
  /** A frame equal to an earlier one points at its pairs instead of a copy (default: PyLO's layout, every frame its own, in order). */
  share?: boolean;
}

/** Frame offsets for a fresh layout: in order, a frame equal to an earlier one pointing at it with `share`. */
function freshOffsets(lo: LoOverlays, overlays: number, share: boolean): number[] {
  let at = 8 + lo.frames.length * 4;
  const seen = new Map<string, number>();
  return lo.frames.map((frame) => {
    const key = frame.map((p) => p.join(",")).join(";");
    const again = share ? seen.get(key) : undefined;
    if (again !== undefined) return again;
    seen.set(key, at);
    at += overlays * 2;
    return at - overlays * 2;
  });
}

/** The file's bytes: the read file's own offsets when they still fit the frames, else a fresh layout. */
export function encodeLoFile(lo: LoOverlays, options: EncodeLoOptions = {}): Uint8Array {
  const overlays = lo.frames[0]?.length ?? 0;
  for (const [f, frame] of lo.frames.entries()) {
    if (frame.length !== overlays) throw new Error(`.lo frame ${f} has ${frame.length} overlays; frame 0 has ${overlays}`);
    for (const [x, y] of frame) if (x < -128 || x > 127 || y < -128 || y > 127) throw new Error(`.lo frame ${f}: (${x}, ${y}) is outside −128…127`);
  }
  const head = 8 + lo.frames.length * 4;
  const offsets = sameLayout(lo, overlays) ? lo.offsets! : freshOffsets(lo, overlays, !!options.share);
  const size = Math.max(head, ...offsets.map((o) => o + overlays * 2));
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, lo.frames.length, true);
  view.setUint32(4, overlays, true);
  lo.frames.forEach((frame, f) => {
    view.setUint32(8 + f * 4, offsets[f], true);
    frame.forEach(([x, y], i) => { view.setInt8(offsets[f] + i * 2, x); view.setInt8(offsets[f] + i * 2 + 1, y); });
  });
  return out;
}

const OFFSETS_NOTE = "# scmjs: offsets";

/**
 * PyLO text. When the file's frames are not laid out the way PyLO writes them (several of the game's share a frame's
 * pairs), a first comment line `# scmjs: offsets …` keeps where each frame was, so the text comes back to the same
 * bytes here; PyLO reads it as a comment.
 */
export function loToText(lo: LoOverlays): string {
  const overlays = lo.frames[0]?.length ?? 0;
  const packed = freshOffsets(lo, overlays, false);
  const note = lo.offsets && lo.offsets.length === lo.frames.length && lo.offsets.some((o, i) => o !== packed[i]) ? `${OFFSETS_NOTE} ${lo.offsets.join(" ")}\n` : "";
  return note + lo.frames.map((frame) => `Frame:\n${frame.map(([x, y]) => `    (${x}, ${y})\n`).join("")}\n`).join("");
}

/** PyLO text read: every frame must have as many overlays as the first. */
export function loFromText(text: string): LoOverlays {
  const frames: [number, number][][] = [];
  let overlays = -1;
  let offsets: number[] | undefined;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (raw.startsWith(OFFSETS_NOTE)) offsets = raw.slice(OFFSETS_NOTE.length).trim().split(/\s+/).map(Number);
    const line = raw.trim().split("#", 1)[0].trim();
    if (!line) return;
    if (line === "Frame:") {
      if (frames.length > 0) {
        const last = frames[frames.length - 1].length;
        if (overlays === -1) overlays = last;
        else if (last !== overlays) throw new Error(`line ${i + 1}: frame ${frames.length - 1} has ${last} overlays, the first has ${overlays}`);
      }
      frames.push([]);
      return;
    }
    const m = /^\((-?\d+),\s*(-?\d+)\)$/.exec(line);
    if (!m) throw new Error(`line ${i + 1}: expected "Frame:" or "(x, y)", got "${line}"`);
    if (frames.length === 0) throw new Error(`line ${i + 1}: an offset before any "Frame:"`);
    const x = Number(m[1]), y = Number(m[2]);
    if (x < -128 || x > 127 || y < -128 || y > 127) throw new Error(`line ${i + 1}: (${x}, ${y}) is outside −128…127`);
    frames[frames.length - 1].push([x, y]);
  });
  if (frames.length > 0 && overlays !== -1 && frames[frames.length - 1].length !== overlays) {
    throw new Error(`frame ${frames.length - 1} has ${frames[frames.length - 1].length} overlays, the first has ${overlays}`);
  }
  return offsets && offsets.length === frames.length && offsets.every(Number.isInteger) ? { frames, offsets } : { frames };
}
