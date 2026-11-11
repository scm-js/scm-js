/**
 * Archive members kept as they are stored, and moved.
 *
 * StarEdit stores a map's sounds with IMA ADPCM and Huffman sectors (the first sector PKWARE, for the WAV header):
 * lossy, about a quarter of the PCM. mopaq reads those sectors, so a member opens as a plain WAV; but the writer
 * compresses only with PKWARE or zlib, so a map saved with the sound written afresh grew about 2.7 times, and nothing
 * could shrink it back. So a member stored in a form the writer cannot make is remembered with its bytes when it is
 * read (`keepStoredForm`), and a save that is handed the same bytes again carries the member as it was stored
 * (`storedFormOf`) — moved to where the new archive has room, which for an encrypted member means a new key.
 *
 * Why moving needs a new key: StarEdit encrypts with an *offset-adjusted* key — the hash of the file's name plus its
 * offset, xor its size. Moving one means decrypting its sector table and sectors with the old key and encrypting them
 * with the new one; the compressed bytes themselves do not change. The cipher is MPQ's, as mopaq has it
 * (`src/crypto.ts`, MIT, by the same author): only the parts needed to read a sector's method and to change a key,
 * since mopaq does not export them.
 */
import type { HashEntry, StoredMember } from "mopaq";

const FILE_IMPLODE = 0x100, FILE_COMPRESS = 0x200, FILE_ENCRYPTED = 0x10000, FILE_ADJUST_KEY = 0x20000;
/** Flags of later MPQ versions that StarCraft's maps never use and mopaq does not read: such a member is not moved. */
const FILE_SINGLE_UNIT = 0x1000000, FILE_SECTOR_CRC = 0x4000000;
const HASH_FILE_KEY = 0x300, KEY2_MIX = 0x400;
/** A compressed sector's first byte names its methods: these two are the ones the writer makes. */
const WRITTEN_METHODS = 0x02 /* zlib */ | 0x08 /* PKWARE */;
/** Where an archive's first member can start: after the 32-byte header (the archive `Creator` writes is version 1). */
export const FIRST_MEMBER_AT = 32;

const CRYPT = (() => {
  const table = new Uint32Array(0x500);
  let seed = 0x00100001;
  for (let i = 0; i < 0x100; i++) for (let j = 0; j < 5; j++) {
    seed = (seed * 125 + 3) % 0x2aaaab;
    const hi = (seed & 0xffff) << 16;
    seed = (seed * 125 + 3) % 0x2aaaab;
    table[i + j * 0x100] = (hi | (seed & 0xffff)) >>> 0;
  }
  return table;
})();

/** The file key of a member: the hash of its name after the last slash, as the game takes it (ASCII upper case). */
export function fileKey(name: string, offset: number, size: number, adjusted: boolean): number {
  const plain = name.slice(Math.max(name.lastIndexOf("\\"), name.lastIndexOf("/")) + 1);
  let s1 = 0x7fed7fed, s2 = 0xeeeeeeee;
  for (let i = 0; i < plain.length; i++) {
    let c = plain.charCodeAt(i) & 0xff;
    if (c >= 0x61 && c <= 0x7a) c -= 0x20;
    s1 = (CRYPT[HASH_FILE_KEY + c] ^ ((s1 + s2) >>> 0)) >>> 0;
    s2 = (c + s1 + s2 + ((s2 << 5) >>> 0) + 3) >>> 0;
  }
  return adjusted ? ((s1 + offset) ^ size) >>> 0 : s1;
}

/** Decrypts (`encrypt` false) or encrypts the whole 32-bit words of `data` in place with `key`. */
function crypt(data: Uint8Array, key: number, encrypt: boolean): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let k2 = 0xeeeeeeee;
  for (let at = 0; at + 4 <= data.length; at += 4) {
    k2 = (k2 + CRYPT[KEY2_MIX + (key & 0xff)]) >>> 0;
    const word = view.getUint32(at, true);
    const out = (word ^ ((key + k2) >>> 0)) >>> 0;
    view.setUint32(at, out, true);
    key = ((((~key << 0x15) >>> 0) + 0x11111111) | (key >>> 0x0b)) >>> 0;
    k2 = ((encrypt ? word : out) + k2 + ((k2 << 5) >>> 0) + 3) >>> 0;
  }
}

/** Whether `relocate` can move the member (anything but the later MPQ versions' single-unit and checksummed files). */
export const movable = (m: StoredMember): boolean => (m.block.flags & (FILE_SINGLE_UNIT | FILE_SECTOR_CRC)) === 0;

/** The member's key where it is stored, or null when it is not encrypted. */
const keyOf = (m: StoredMember, name: string): number | null =>
  m.block.flags & FILE_ENCRYPTED ? fileKey(name, m.block.filePos, m.block.uncompressedSize, !!(m.block.flags & FILE_ADJUST_KEY)) : null;

/** A compressed member's sector bounds, its table decrypted; null when the table does not make sense. */
function sectorBounds(m: StoredMember, key: number | null): number[] | null {
  const sectors = Math.ceil(m.block.uncompressedSize / m.sectorSize);
  const table = m.data.slice(0, (sectors + 1) * 4);
  if (table.length < (sectors + 1) * 4) return null;
  if (key !== null) crypt(table, (key - 1) >>> 0, false);
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const bounds = Array.from({ length: sectors + 1 }, (_, i) => view.getUint32(i * 4, true));
  for (let i = 0; i < sectors; i++) if (bounds[i] > bounds[i + 1] || bounds[i + 1] > m.data.length) return null;
  return bounds;
}

/**
 * Whether a member is stored in a form the writer cannot make: a compressed sector that uses a method other than
 * PKWARE or zlib — StarEdit's ADPCM and Huffman for sounds, or bzip2. Written afresh, such a member comes out larger
 * (ADPCM is lossy) or in another method; carried as stored it stays as it was.
 */
export function storedInOtherForm(m: StoredMember, name: string): boolean {
  if (!(m.block.flags & FILE_COMPRESS) || !movable(m) || m.sectorSize <= 0) return false;
  const key = keyOf(m, name);
  const bounds = sectorBounds(m, key);
  if (!bounds) return false;
  for (let i = 0; i + 1 < bounds.length; i++) {
    const length = bounds[i + 1] - bounds[i];
    const plain = Math.min(m.sectorSize, m.block.uncompressedSize - i * m.sectorSize);
    // A sector as long as its plain bytes was stored uncompressed and has no method byte.
    if (length === 0 || length >= plain) continue;
    const head = m.data.slice(bounds[i], bounds[i] + Math.min(4, length));
    if (key !== null && head.length === 4) crypt(head, (key + i) >>> 0, false);
    if (head.length < 4 && key !== null) continue; // a sector shorter than a word is not encrypted, and is not ADPCM either
    if (head[0] & ~WRITTEN_METHODS) return true;
  }
  return false;
}

/**
 * The member as it would be stored at `offset`: the same bytes when its key does not depend on where it is, else its
 * sector table and sectors decrypted with the old key and encrypted with the new.
 */
export function relocate(m: StoredMember, name: string, offset: number): StoredMember {
  const { flags, filePos, uncompressedSize } = m.block;
  const moved = { ...m, block: { ...m.block, filePos: offset } };
  if (!(flags & FILE_ENCRYPTED) || !(flags & FILE_ADJUST_KEY) || offset === filePos) return moved;
  if (!movable(m)) throw new Error(`${name} is stored in a form this does not move`);
  const oldKey = fileKey(name, filePos, uncompressedSize, true), newKey = fileKey(name, offset, uncompressedSize, true);
  const data = new Uint8Array(m.data);
  const sectors = Math.ceil(uncompressedSize / m.sectorSize);
  if (flags & (FILE_COMPRESS | FILE_IMPLODE)) {
    // The sector table: one offset a sector and one for the end, encrypted with the key less one.
    const table = data.subarray(0, (sectors + 1) * 4);
    crypt(table, (oldKey - 1) >>> 0, false);
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
    const bounds = Array.from({ length: sectors + 1 }, (_, i) => view.getUint32(i * 4, true));
    crypt(table, (newKey - 1) >>> 0, true);
    for (let i = 0; i < sectors; i++) {
      const sector = data.subarray(bounds[i], bounds[i + 1]);
      crypt(sector, (oldKey + i) >>> 0, false);
      crypt(sector, (newKey + i) >>> 0, true);
    }
  } else {
    for (let i = 0; i < sectors; i++) {
      const sector = data.subarray(i * m.sectorSize, Math.min(data.length, (i + 1) * m.sectorSize));
      crypt(sector, (oldKey + i) >>> 0, false);
      crypt(sector, (newKey + i) >>> 0, true);
    }
  }
  return { ...moved, data };
}

/**
 * Named members laid one after another from the archive's start, round the members with no name (which cannot be
 * re-keyed and stay where they are); a member that cannot be moved stays where it was too.
 */
export function packStored(named: { member: StoredMember; name: string }[], pinned: readonly StoredMember[]): StoredMember[] {
  const taken = [...pinned, ...named.filter((n) => !movable(n.member)).map((n) => n.member)].map((m) => [m.block.filePos, m.block.filePos + m.data.length] as const).sort((a, b) => a[0] - b[0]);
  const out: StoredMember[] = named.filter((n) => !movable(n.member)).map((n) => n.member);
  let at = FIRST_MEMBER_AT;
  for (const { member, name } of named.filter((n) => movable(n.member))) {
    for (;;) {
      const clash = taken.find(([s, e]) => at < e && s < at + member.data.length);
      if (!clash) break;
      at = clash[1];
    }
    out.push(relocate(member, name, at));
    taken.push([at, at + member.data.length]);
    taken.sort((a, b) => a[0] - b[0]);
    at += member.data.length;
  }
  return out;
}

/** A member's stored form, kept with the bytes it decodes to: what a save needs to carry it again. */
export interface StoredForm {
  /** The member's name in the archive it came from (its key and its hash-table slot are the name's). */
  name: string;
  member: StoredMember;
  /** The hash table of the archive it came from, which the slot belongs to; one array for every member of that archive. */
  hashTable: readonly HashEntry[];
}

/**
 * The stored forms by the decoded bytes they stand for. Keyed by the array itself, so the form goes wherever the
 * bytes go — the editor's document, a recovery copy made in the same session, the command line's map — and is gone
 * the moment a member is given new bytes (the Sound Editor's replace, an import). A save checks the bytes are still
 * what was read (`sameBytes`), in case an array was changed in place.
 */
const FORMS = new WeakMap<Uint8Array, { form: StoredForm; check: number }>();

/** A cheap fingerprint of the bytes (FNV-1a), to tell an array changed in place. */
function fingerprint(bytes: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h ^ bytes.length) >>> 0;
}

/** Remember that `bytes` were read from `form`, so a save that is handed them unchanged can carry the member as stored. */
export function keepStoredForm(bytes: Uint8Array, form: StoredForm): void {
  FORMS.set(bytes, { form, check: fingerprint(bytes) });
}

/** The stored form `bytes` were read from, while they are unchanged; null otherwise. */
export function storedFormOf(bytes: Uint8Array): StoredForm | null {
  const kept = FORMS.get(bytes);
  return kept && kept.check === fingerprint(bytes) ? kept.form : null;
}
