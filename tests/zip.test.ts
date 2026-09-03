import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { findMembers, httpRangeReader, readZipDirectory, readZipMember, ZipError, type RangeReader } from "../src/gamedata/zip";

/* ── A zip built here, so the reader is tested without a network or a fixture ── */

interface Member {
  name: string;
  data: Uint8Array;
  /** 0 stored, 8 deflated. */
  method?: number;
}

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

/** The smallest correct zip that carries `members`, with a comment to push the EOCD off the end. */
function buildZip(members: Member[], comment = ""): Uint8Array {
  const chunks: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  const put = (into: Uint8Array[], bytes: Uint8Array) => { into.push(bytes); return bytes.length; };
  const header = (size: number) => { const b = new Uint8Array(size); return { b, v: new DataView(b.buffer) }; };

  for (const member of members) {
    const method = member.method ?? 8;
    const stored = method === 0 ? member.data : new Uint8Array(deflateRawSync(member.data));
    const name = ascii(member.name);
    // Local header, with an extra field the central directory's copy does not have — a real
    // zip is allowed to differ here, and the reader has to measure the local one.
    const extra = new Uint8Array(4);
    const { b: local, v } = header(30);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(8, method, true);
    v.setUint32(18, stored.length, true);
    v.setUint32(22, member.data.length, true);
    v.setUint16(26, name.length, true);
    v.setUint16(28, extra.length, true);

    const localOffset = offset;
    offset += put(chunks, local) + put(chunks, name) + put(chunks, extra) + put(chunks, stored);

    const { b: central, v: cv } = header(46);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, stored.length, true);
    cv.setUint32(24, member.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, localOffset, true);
    directory.push(central, name);
  }

  const directoryOffset = offset;
  const directorySize = directory.reduce((n, c) => n + c.length, 0);
  const tail = ascii(comment);
  const { b: eocd, v: ev } = header(22);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, members.length, true);
  ev.setUint16(10, members.length, true);
  ev.setUint32(12, directorySize, true);
  ev.setUint32(16, directoryOffset, true);
  ev.setUint16(20, tail.length, true);

  const all = [...chunks, ...directory, eocd, tail];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

/** A reader over bytes in memory that records every range asked for. */
function memoryReader(bytes: Uint8Array): RangeReader & { reads: [number, number][] } {
  const reads: [number, number][] = [];
  return {
    reads,
    size: async () => bytes.length,
    read: async (from, to) => {
      reads.push([from, to]);
      return bytes.slice(from, to + 1);
    },
  };
}

const BIG = new Uint8Array(200_000).map((_, i) => (i * 7) & 0xff);

describe("reading a zip by range", () => {
  const zip = buildZip([
    { name: "StarEdit/BrooDat.mpq", data: ascii("brood archive") },
    { name: "StarEdit/StarDat.mpq", data: BIG },
    { name: "StarEdit/StarEdit.exe", data: ascii("not wanted") },
    { name: "StarEdit/patch_rt.mpq", data: ascii("deliberately ignored") },
  ]);

  it("reads the directory in two ranges, whatever the comment length", async () => {
    const reader = memoryReader(zip);
    const entries = await readZipDirectory(reader);
    expect([...entries.keys()]).toEqual(["StarEdit/BrooDat.mpq", "StarEdit/StarDat.mpq", "StarEdit/StarEdit.exe", "StarEdit/patch_rt.mpq"]);
    expect(reader.reads).toHaveLength(2);
    expect(entries.get("StarEdit/StarDat.mpq")).toMatchObject({ method: 8, size: BIG.length });
  });

  it("finds the EOCD behind a comment", async () => {
    const entries = await readZipDirectory(memoryReader(buildZip([{ name: "a.mpq", data: ascii("x") }], "y".repeat(4000))));
    expect([...entries.keys()]).toEqual(["a.mpq"]);
  });

  it("inflates a member without reading the rest of the archive", async () => {
    const reader = memoryReader(zip);
    const entries = await readZipDirectory(reader);
    const before = reader.reads.length;
    const bytes = await readZipMember(reader, entries.get("StarEdit/StarDat.mpq")!);
    expect(bytes).toEqual(BIG);
    // Its local header and its bytes, and nothing else.
    expect(reader.reads.length - before).toBe(2);
    const read = reader.reads.slice(before).reduce((n, [from, to]) => n + (to - from + 1), 0);
    expect(read).toBeLessThan(BIG.length);
  });

  it("measures the local header rather than trusting the directory's copy", async () => {
    // The builder gives every local header a 4-byte extra field the central copy lacks;
    // a reader that skipped it would land 4 bytes into the compressed data.
    const reader = memoryReader(zip);
    const entries = await readZipDirectory(reader);
    expect(await readZipMember(reader, entries.get("StarEdit/BrooDat.mpq")!)).toEqual(ascii("brood archive"));
  });

  it("reads a stored member too", async () => {
    const plain = buildZip([{ name: "s.mpq", data: ascii("stored, not deflated"), method: 0 }]);
    const reader = memoryReader(plain);
    const entries = await readZipDirectory(reader);
    expect(entries.get("s.mpq")!.method).toBe(0);
    expect(await readZipMember(reader, entries.get("s.mpq")!)).toEqual(ascii("stored, not deflated"));
  });

  it("matches members by file name, ignoring folder and case", async () => {
    const entries = await readZipDirectory(memoryReader(zip));
    const { found, missing } = findMembers(entries, ["StarDat.mpq", "BrooDat.mpq"]);
    expect(missing).toEqual([]);
    expect([...found.keys()]).toEqual(["StarDat.mpq", "BrooDat.mpq"]);
    expect(found.get("StarDat.mpq")!.name).toBe("StarEdit/StarDat.mpq");
  });

  it("names what it could not find", async () => {
    const entries = await readZipDirectory(memoryReader(buildZip([{ name: "StarDat.mpq", data: ascii("only one") }])));
    expect(findMembers(entries, ["StarDat.mpq", "BrooDat.mpq"]).missing).toEqual(["BrooDat.mpq"]);
  });
});

describe("refusing what it cannot read", () => {
  it("says so when the bytes are not a zip", async () => {
    await expect(readZipDirectory(memoryReader(new Uint8Array(500)))).rejects.toThrow(ZipError);
  });

  it("says so on an unsupported compression method", async () => {
    const zip = buildZip([{ name: "a.mpq", data: ascii("x") }]);
    const entries = await readZipDirectory(memoryReader(zip));
    const entry = { ...entries.get("a.mpq")!, method: 12 };
    await expect(readZipMember(memoryReader(zip), entry)).rejects.toThrow(/method 12/);
  });

  it("says so when the local header is not where the directory claims", async () => {
    const zip = buildZip([{ name: "a.mpq", data: ascii("x") }]);
    const entries = await readZipDirectory(memoryReader(zip));
    const entry = { ...entries.get("a.mpq")!, localHeaderOffset: 3 };
    await expect(readZipMember(memoryReader(zip), entry)).rejects.toThrow(/local header/);
  });
});

describe("the reader over HTTP", () => {
  const zip = buildZip([{ name: "StarDat.mpq", data: BIG }]);
  const server: typeof fetch = async (_url, init) => {
    const range = new Headers(init?.headers).get("range");
    if (!range) return new Response(null, { status: 200, headers: { "content-length": String(zip.length) } });
    const [from, to] = range.replace("bytes=", "").split("-").map(Number);
    return new Response(zip.slice(from, to + 1) as unknown as BodyInit, { status: 206 });
  };

  it("reads the length from a HEAD and asks it only once", async () => {
    let heads = 0;
    const reader = httpRangeReader("https://example.test/x.zip", {
      fetch: async (url, init) => {
        if (init?.method === "HEAD") heads++;
        return server(url, init);
      },
    });
    const entries = await readZipDirectory(reader);
    expect(await readZipMember(reader, entries.get("StarDat.mpq")!)).toEqual(BIG);
    expect(heads).toBe(1);
  });

  it("says so when the server will not answer ranges", async () => {
    const reader = httpRangeReader("https://example.test/x.zip", { fetch: async () => new Response(null, { status: 200, headers: { "content-length": "10" } }) });
    await expect(readZipDirectory(reader)).rejects.toThrow(/has to support ranges/);
  });
});
