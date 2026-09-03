/**
 * Just enough of the zip format to pull named members out of a remote archive without
 * downloading it.
 *
 * Blizzard's StarEdit package is 101 MB and carries 152 members, of which the editor wants
 * two — `StarDat.mpq` and `BrooDat.mpq`, 82 MB between them. A zip's directory lives at its
 * *end* and every member records where its own bytes start, so a reader that can ask for
 * byte ranges can take those two and never see the rest. That is the whole of this module:
 * read the end-of-central-directory record, read the directory, then read and inflate one
 * member at a time.
 *
 * Nothing here is specific to that file or to HTTP — the input is a `RangeReader`, so the
 * tests drive it over a zip held in memory. `httpRangeReader` is the one over `fetch`,
 * which needs the server to answer `206` (see `install.ts#installFromZipUrl`).
 *
 * Only the 32-bit format is handled, which every zip below 4 GB is; a Zip64 record is
 * reported rather than misread.
 */

/** Somewhere bytes can be read from by range. `to` is inclusive, as HTTP's `Range` is. */
export interface RangeReader {
  /** The archive's total length in bytes. */
  size(): Promise<number>;
  read(from: number, to: number): Promise<Uint8Array>;
}

export interface ZipEntry {
  /** The member's path inside the archive, e.g. `StarEdit/StarDat.mpq`. */
  name: string;
  /** 0 stored, 8 deflated; anything else this module refuses. */
  method: number;
  compressedSize: number;
  size: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const EOCD_SIGNATURE = 0x06054b50;
const EOCD64_SIGNATURE = 0x06064b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** The record is 22 bytes plus a comment of at most 65535. */
const EOCD_MAX = 22 + 0xffff;

const u16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

/** The member names are UTF-8 when bit 11 of the flags is set and CP437 otherwise; both agree on ASCII, which these are. */
const decodeName = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);

/**
 * Every member of the archive, by name. Two reads: the tail, for the record that says
 * where the directory is, and the directory itself.
 */
export async function readZipDirectory(reader: RangeReader): Promise<Map<string, ZipEntry>> {
  const total = await reader.size();
  if (!Number.isFinite(total) || total <= 0) throw new ZipError("The archive's length is unknown, so its directory cannot be found.");

  const tailLength = Math.min(EOCD_MAX, total);
  const tail = await reader.read(total - tailLength, total - 1);

  let eocd = -1;
  for (let at = tail.length - 22; at >= 0; at--) {
    if (u32(tail, at) === EOCD_SIGNATURE) { eocd = at; break; }
  }
  if (eocd < 0) throw new ZipError("No end-of-central-directory record: this is not a zip archive.");

  const count = u16(tail, eocd + 10);
  const directorySize = u32(tail, eocd + 12);
  const directoryOffset = u32(tail, eocd + 16);
  // Zip64 parks 0xffffffff in the 32-bit fields and puts the real numbers in its own record.
  if (directoryOffset === 0xffffffff || directorySize === 0xffffffff || count === 0xffff) {
    const has64 = tail.length >= 4 && (() => { for (let at = tail.length - 4; at >= 0; at--) if (u32(tail, at) === EOCD64_SIGNATURE) return true; return false; })();
    throw new ZipError(`This is a Zip64 archive${has64 ? "" : " (or a damaged one)"}, which is not supported.`);
  }

  const directory = await reader.read(directoryOffset, directoryOffset + directorySize - 1);
  const entries = new Map<string, ZipEntry>();
  let at = 0;
  while (at + 46 <= directory.length && u32(directory, at) === CENTRAL_SIGNATURE) {
    const nameLength = u16(directory, at + 28);
    const extraLength = u16(directory, at + 30);
    const commentLength = u16(directory, at + 32);
    const name = decodeName(directory.subarray(at + 46, at + 46 + nameLength));
    entries.set(name, {
      name,
      method: u16(directory, at + 10),
      compressedSize: u32(directory, at + 20),
      size: u32(directory, at + 24),
      localHeaderOffset: u32(directory, at + 42),
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.size === 0) throw new ZipError("The archive's directory is empty or could not be read.");
  return entries;
}

/**
 * One member's bytes, inflated. Two reads: its local header, whose name and extra fields
 * are allowed to differ in length from the directory's copy and so have to be measured,
 * and the compressed bytes that follow it.
 */
export async function readZipMember(reader: RangeReader, entry: ZipEntry, progress?: (fraction: number) => void): Promise<Uint8Array> {
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError(`${entry.name} uses compression method ${entry.method}, which is not supported.`);

  const header = await reader.read(entry.localHeaderOffset, entry.localHeaderOffset + 29);
  if (header.length < 30 || u32(header, 0) !== LOCAL_SIGNATURE) throw new ZipError(`${entry.name}: its local header is not where the directory says it is.`);
  const start = entry.localHeaderOffset + 30 + u16(header, 26) + u16(header, 28);

  progress?.(0);
  const raw = await reader.read(start, start + entry.compressedSize - 1);
  if (raw.length !== entry.compressedSize) throw new ZipError(`${entry.name}: read ${raw.length} bytes of ${entry.compressedSize}.`);
  progress?.(1);

  const bytes = entry.method === 0 ? raw : await inflateRaw(raw);
  if (bytes.length !== entry.size) throw new ZipError(`${entry.name}: inflated to ${bytes.length} bytes, expected ${entry.size}.`);
  return bytes;
}

/** Deflate without a zlib wrapper, which is what a zip member is. */
async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") throw new ZipError("This browser cannot decompress zip members (no DecompressionStream).");
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Find members by file name, ignoring the folders they sit in and their case — the two
 * archives are `StarEdit/StarDat.mpq` and `StarEdit/BrooDat.mpq` today, and the editor
 * should not care if that folder is ever renamed.
 */
export function findMembers(entries: Map<string, ZipEntry>, names: readonly string[]): { found: Map<string, ZipEntry>; missing: string[] } {
  const byBaseName = new Map<string, ZipEntry>();
  for (const entry of entries.values()) {
    const base = (entry.name.split(/[\\/]/).pop() ?? "").toLowerCase();
    // A member deeper in the tree does not displace one nearer the top.
    if (base && !byBaseName.has(base)) byBaseName.set(base, entry);
  }
  const found = new Map<string, ZipEntry>();
  const missing: string[] = [];
  for (const name of names) {
    const entry = byBaseName.get(name.toLowerCase());
    if (entry) found.set(name, entry);
    else missing.push(name);
  }
  return { found, missing };
}

export interface HttpRangeOptions {
  fetch?: typeof fetch;
  /**
   * Called as a range arrives, with the bytes read so far out of the bytes asked for. A
   * member is one range of tens of megabytes, so without this the progress bar would sit
   * still for the whole download.
   */
  onProgress?(received: number, expected: number): void;
}

/** A `RangeReader` over an HTTP server that answers range requests. */
export function httpRangeReader(url: string, options: HttpRangeOptions = {}): RangeReader {
  const fetchImpl = options.fetch ?? fetch;
  let known: number | null = null;
  return {
    async size() {
      if (known !== null) return known;
      const res = await fetchImpl(url, { method: "HEAD" });
      if (!res.ok) throw new ZipError(`${url}: HTTP ${res.status}`);
      const length = Number(res.headers.get("content-length"));
      if (!Number.isFinite(length) || length <= 0) throw new ZipError(`${url} did not say how long it is, so its members cannot be found.`);
      known = length;
      return length;
    },
    async read(from, to) {
      const res = await fetchImpl(url, { headers: { Range: `bytes=${from}-${to}` } });
      if (res.status !== 206) throw new ZipError(`${url} answered ${res.status} to a range request; the server has to support ranges.`);
      const expected = to - from + 1;
      if (!options.onProgress || !res.body) return new Uint8Array(await res.arrayBuffer());

      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        options.onProgress(Math.min(received, expected), expected);
      }
      const out = new Uint8Array(received);
      let at = 0;
      for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
      return out;
    },
  };
}
