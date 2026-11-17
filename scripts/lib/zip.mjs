// Zip files written and read by hand (node:zlib's deflate and crc32), for the executables' archives and the MCP bundles
// (scripts/build-cli-binary.mjs) and for the check that unpacks a bundle (scripts/check-cli-binary.mjs). No folder
// entries, no zip64: every file is well under 4 GB.
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/**
 * A .zip of `files` (deflated, no folders, no zip64: each well under 4 GB), for Windows, whose Explorer opens one. A
 * file with a `mode` is marked as made on Unix with that mode, so an app unpacking an MCP bundle on a Mac keeps the
 * executable runnable (as `mcpb pack` does).
 */
export function zip(files, when = new Date()) {
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const locals = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const data = deflateRawSync(f.bytes, { level: 9 });
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8);
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc32(f.bytes), 14);
    head.writeUInt32LE(data.length, 18); head.writeUInt32LE(f.bytes.length, 22); head.writeUInt16LE(name.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(f.mode === undefined ? 20 : (3 << 8) | 20, 4); dir.writeUInt16LE(20, 6); head.copy(dir, 8, 6, 30);
    if (f.mode !== undefined) dir.writeUInt32LE(((0o100000 | f.mode) << 16) >>> 0, 38);
    dir.writeUInt32LE(offset, 42);
    locals.push(head, name, data);
    central.push(dir, name);
    offset += head.length + name.length + data.length;
  }
  const size = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...central, end]);
}

/** The files of a .zip, with each one's Unix mode where the zip has one (stored or deflated; no zip64). */
export function readZip(bytes) {
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip: no end of central directory");
  const count = bytes.readUInt16LE(end + 10);
  let p = bytes.readUInt32LE(end + 16);
  const files = [];
  for (let i = 0; i < count; i++) {
    if (bytes.readUInt32LE(p) !== 0x02014b50) throw new Error("not a zip: bad central directory");
    const madeBy = bytes.readUInt16LE(p + 4) >> 8, method = bytes.readUInt16LE(p + 10), size = bytes.readUInt32LE(p + 20);
    const nameLength = bytes.readUInt16LE(p + 28), extra = bytes.readUInt16LE(p + 30), comment = bytes.readUInt16LE(p + 32);
    const external = bytes.readUInt32LE(p + 38), local = bytes.readUInt32LE(p + 42);
    const name = bytes.toString("utf8", p + 46, p + 46 + nameLength);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const raw = bytes.subarray(start, start + size);
    files.push({ name, bytes: method === 8 ? inflateRawSync(raw) : Buffer.from(raw), mode: madeBy === 3 ? (external >>> 16) & 0o777 : null });
    p += 46 + nameLength + extra + comment;
  }
  return files;
}
