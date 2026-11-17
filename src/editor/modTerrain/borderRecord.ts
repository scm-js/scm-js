/**
 * The record a borrowed stroke keeps beside its lattice (`borrowLattice.ts`), so borders can be drawn and taken back:
 *
 * - **the host tile under every cell the borrowed brush wrote** (interior, border or hard edge), as it was before the
 *   first borrowed stroke there. A stroke rebuilds the map as it was from it, lays interior and border afresh, writes
 *   only the difference and drops every cell that is back at its host tile — so taking ground back leaves no border.
 * - **the diamonds the borrowed brush painted**, each with the terrain painted. The lattice member stores only the
 *   diamonds that differ from the source's base ground (Floor for Installation), so a patch of the base ground itself
 *   is invisible to it, and it cannot tell a painted diamond from one the brush turned into an edge around a patch;
 *   these say where the patch is, which is what a border runs around.
 *
 * A member of its own (`scmjs\borders-<id>.bin`, "BRD1") rather than a new version of the lattice's: an editor that
 * knows only the lattice member reads and writes it as before and carries this one along untouched, as it does any
 * file of the archive it does not know. A record that such an editor left stale is read with care (`BorrowStroke`
 * drops a cell another tool has since laid the tileset's own ground on).
 *
 * "BRD1", width and height (u16 LE), the source's ERA (u8), a zero byte, the diamond count and the cell count (u32 LE),
 * then each diamond's index (u32, `y * (isomWidth + 1) + x`) and terrain (u16, the source's CV5 index), and each cell's
 * index (u32) and host tile (u16).
 * Pure; `tests/borders.test.ts`.
 */
import type { Scenario } from "../../formats/chk/scenario";
import { TILESETS } from "../../data/tilesets";
import { isomHeight, isomWidth } from "../isom";

type Size = Pick<Scenario, "width" | "height">;

/** The member holding the border record for tileset `sourceEra` (`scmjs\borders-install.bin`). */
export const bordersMember = (sourceEra: number): string => `scmjs\\borders-${TILESETS[sourceEra & 7].id}.bin`;
export const BORDER_MEMBERS: readonly string[] = TILESETS.map((_, era) => bordersMember(era));

const MAGIC = [0x42, 0x52, 0x44, 0x31];
const HEADER = 18;

export interface BorderRecord {
  /** Diamonds (`y * (isomWidth + 1) + x`) the borrowed brush painted and nothing took back → the terrain painted. */
  painted: Map<number, number>;
  /** Cell → the host tile it had before the borrowed brush first wrote it. */
  cells: Map<number, number>;
}

export const emptyRecord = (): BorderRecord => ({ painted: new Map(), cells: new Map() });

export function encodeBorderRecord(size: Size, sourceEra: number, r: BorderRecord): Uint8Array | null {
  if (r.painted.size === 0 && r.cells.size === 0) return null;
  const out = new Uint8Array(HEADER + r.painted.size * 6 + r.cells.size * 6);
  const v = new DataView(out.buffer);
  out.set(MAGIC);
  v.setUint16(4, size.width, true);
  v.setUint16(6, size.height, true);
  out[8] = sourceEra & 7;
  v.setUint32(10, r.painted.size, true);
  v.setUint32(14, r.cells.size, true);
  let at = HEADER;
  for (const [d, t] of [...r.painted].sort((a, b) => a[0] - b[0])) { v.setUint32(at, d, true); v.setUint16(at + 4, t, true); at += 6; }
  for (const [c, t] of [...r.cells].sort((a, b) => a[0] - b[0])) { v.setUint32(at, c, true); v.setUint16(at + 4, t, true); at += 6; }
  return out;
}

/** The record a member holds for a map of this size and source; null when it is not one, or for another size. */
export function decodeBorderRecord(member: Uint8Array | null | undefined, size: Size, sourceEra: number): BorderRecord | null {
  if (!member || member.length < HEADER || MAGIC.some((b, i) => member[i] !== b)) return null;
  const v = new DataView(member.buffer, member.byteOffset, member.byteLength);
  if (v.getUint16(4, true) !== size.width || v.getUint16(6, true) !== size.height || member[8] !== (sourceEra & 7)) return null;
  const nd = v.getUint32(10, true), nc = v.getUint32(14, true);
  if (member.length !== HEADER + nd * 6 + nc * 6) return null;
  const r = emptyRecord();
  let at = HEADER;
  for (let i = 0; i < nd; i++, at += 6) r.painted.set(v.getUint32(at, true), v.getUint16(at + 4, true));
  const cells = size.width * size.height;
  for (let i = 0; i < nc; i++, at += 6) { const c = v.getUint32(at, true); if (c < cells) r.cells.set(c, v.getUint16(at + 4, true)); }
  return r;
}

/** The member after a resize that moved the old top-left tile to (dx, dy); null when nothing is left or `dx` is odd. */
export function resizeBorderRecord(member: Uint8Array | null, from: Size, to: Size, sourceEra: number, dx: number, dy: number): Uint8Array | null {
  const r = decodeBorderRecord(member, from, sourceEra);
  if (!r || dx % 2 !== 0) return null;
  const fw = isomWidth(from) + 1, tw = isomWidth(to) + 1, th = isomHeight(to);
  const out = emptyRecord();
  for (const [d, t] of r.painted) {
    const x = (d % fw) + dx / 2, y = Math.floor(d / fw) + dy;
    if (x >= 0 && y >= 0 && x < tw && y <= th) out.painted.set(y * tw + x, t);
  }
  for (const [c, t] of r.cells) {
    const x = (c % from.width) + dx, y = Math.floor(c / from.width) + dy;
    if (x >= 0 && y >= 0 && x < to.width && y < to.height) out.cells.set(y * to.width + x, t);
  }
  return encodeBorderRecord(to, sourceEra, out);
}
