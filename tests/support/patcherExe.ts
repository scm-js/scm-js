// Mod exes made byte by byte for the tests (no mod is needed): a Windows program, a tiny library naming itself in its
// export directory, FireGraft's patcher overlay (`PEGF`, u32 count, u32 form, then each plugin's id, size, 0 and
// bytes), and an archive whose tables lie before its header with the header's sizes 0xFFFFFFFF, as one patcher writes it.
import { Archive, Creator } from "mopaq";

export const concat = (...parts: Uint8Array[]): Uint8Array => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out; };
export const words = (...w: number[]): Uint8Array => { const b = new Uint8Array(w.length * 4), v = new DataView(b.buffer); w.forEach((x, i) => v.setUint32(i * 4, x >>> 0, true)); return b; };

/** A Windows program of one section, 0x400 bytes, never run; `overlayAt` is written where FireGraft's patcher keeps its overlay's offset. */
export function program(overlayAt = 0): Uint8Array {
  const b = new Uint8Array(0x400), v = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a; v.setUint32(0x18, overlayAt, true); v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true); v.setUint16(0x46, 1, true); v.setUint16(0x54, 0, true);
  const section = 0x40 + 24;
  b.set([0x2e, 0x74, 0x65, 0x78, 0x74], section);
  v.setUint32(section + 16, 0x200, true); v.setUint32(section + 20, 0x200, true);
  return b;
}

/** A library of 0x400 bytes whose export directory names it `name` (or one with no exports for null). */
export function library(name: string | null): Uint8Array {
  const b = new Uint8Array(0x400), v = new DataView(b.buffer);
  b[0] = 0x4d; b[1] = 0x5a; v.setUint32(0x3c, 0x40, true);
  v.setUint32(0x40, 0x00004550, true); v.setUint16(0x44, 0x14c, true); v.setUint16(0x46, 1, true); v.setUint16(0x54, 0xe0, true); v.setUint16(0x56, 0x2102, true);
  const opt = 0x58;
  v.setUint16(opt, 0x10b, true); v.setUint32(opt + 92, 16, true);
  if (name) { v.setUint32(opt + 96, 0x1000, true); v.setUint32(opt + 100, 40, true); }
  const section = opt + 0xe0;
  b.set([0x2e, 0x65, 0x64, 0x61, 0x74, 0x61], section);
  v.setUint32(section + 8, 0x100, true); v.setUint32(section + 12, 0x1000, true); v.setUint32(section + 16, 0x200, true); v.setUint32(section + 20, 0x200, true);
  if (name) { v.setUint32(0x200 + 12, 0x1000 + 40, true); b.set(new TextEncoder().encode(name), 0x228); }
  return b;
}

/** A small archive: a table, and a FireGraft project named by its datalist. `list: false` leaves out the (listfile). */
export function modArchive(list = true): Uint8Array {
  const c = new Creator({ sectorSize: 4096, listfile: list });
  c.addFile("arr\\weapons.dat", new Uint8Array([1, 2, 3, 4, 5]), { compress: "pkware" });
  c.addFile("Firegraft\\datalist.txt", new TextEncoder().encode("Firegraft\\1161.fgd\r\nFiregraft\\Made.fgp\r\n"));
  c.addFile("Firegraft\\Made.fgp", new Uint8Array([9, 9]));
  c.addFile("Firegraft\\1161.fgd", new Uint8Array([7]));
  return c.write();
}

/**
 * `archive` laid out with its tables first, `gap` bytes before its header (the tables, then padding): the header's table
 * positions become negative 32-bit offsets, its header size and archive size 0xFFFFFFFF. Returns the bytes from the
 * tables on; the header is at `bytes.length - (archive's length without its tables)`.
 */
export function tablesBefore(archive: Uint8Array, pad = 0): { bytes: Uint8Array; header: number } {
  const v = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const hashAt = v.getUint32(16, true), blockAt = v.getUint32(20, true), hashN = v.getUint32(24, true), blockN = v.getUint32(28, true);
  const hash = archive.slice(hashAt, hashAt + hashN * 16), block = archive.slice(blockAt, blockAt + blockN * 16);
  const body = archive.slice(0, Math.min(hashAt, blockAt));
  const header = hash.length + block.length + pad;
  const out = concat(hash, block, new Uint8Array(pad), body);
  const w = new DataView(out.buffer);
  w.setUint32(header + 4, 0xffffffff, true); w.setUint32(header + 8, 0xffffffff, true);
  w.setUint32(header + 16, (0 - header) >>> 0, true); w.setUint32(header + 20, (hash.length - header) >>> 0, true);
  return { bytes: out, header };
}

/**
 * A FireGraft patcher exe: the program, the overlay at its end (its offset in the program's header) with `plugins` one
 * after the other, then the archive at the next 512-byte boundary (`tablesFirst`: its tables before its header, in the
 * space up to that boundary and beyond). Returns the exe and where the archive's header is.
 */
export function patcherExe(plugins: { id: number; bytes: Uint8Array }[], archive: Uint8Array, o: { form?: number; tablesFirst?: boolean } = {}): { exe: Uint8Array; at: number } {
  const overlay = concat(new Uint8Array([0x50, 0x45, 0x47, 0x46]), words(plugins.length, o.form ?? 1), ...plugins.flatMap((p) => [words(p.id, p.bytes.length, 0), p.bytes]));
  const head = concat(program(0x400), overlay);
  if (!o.tablesFirst) {
    const at = Math.ceil(head.length / 512) * 512;
    return { exe: concat(head, new Uint8Array(at - head.length), archive), at };
  }
  const plain = tablesBefore(archive);
  const at = Math.ceil((head.length + plain.header) / 512) * 512;
  const laid = tablesBefore(archive, at - head.length - plain.header);
  return { exe: concat(head, laid.bytes), at };
}

/** The archive's weapons.dat, read as a game would. */
export const weaponsOf = (exe: Uint8Array, at: number): number[] => Array.from(Archive.open(exe, { offset: at }).readFile("arr\\weapons.dat"));
