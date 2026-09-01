/** Little-endian readers/writers over a Uint8Array. StarCraft data is LE throughout. */

export class Reader {
  private view: DataView;
  readonly bytes: Uint8Array;
  pos = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get remaining() {
    return this.bytes.length - this.pos;
  }

  u8() { return this.view.getUint8(this.pos++); }
  i8() { return this.view.getInt8(this.pos++); }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i16() { const v = this.view.getInt16(this.pos, true); this.pos += 2; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }

  slice(len: number) {
    const out = this.bytes.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  skip(len: number) { this.pos += len; }
}

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private len = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  /** Bytes written so far. */
  get length() { return this.len; }

  private need(extra: number) {
    if (this.len + extra <= this.buf.length) return;
    let cap = this.buf.length * 2 || 256;
    while (cap < this.len + extra) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number) { this.need(1); this.view.setUint8(this.len, v); this.len += 1; return this; }
  i8(v: number) { this.need(1); this.view.setInt8(this.len, v); this.len += 1; return this; }
  u16(v: number) { this.need(2); this.view.setUint16(this.len, v, true); this.len += 2; return this; }
  i16(v: number) { this.need(2); this.view.setInt16(this.len, v, true); this.len += 2; return this; }
  u32(v: number) { this.need(4); this.view.setUint32(this.len, v >>> 0, true); this.len += 4; return this; }
  i32(v: number) { this.need(4); this.view.setInt32(this.len, v | 0, true); this.len += 4; return this; }

  bytes(src: Uint8Array) { this.need(src.length); this.buf.set(src, this.len); this.len += src.length; return this; }

  /** Repeat a byte `count` times. */
  fill(value: number, count: number) {
    this.need(count);
    this.buf.fill(value, this.len, this.len + count);
    this.len += count;
    return this;
  }

  finish() { return this.buf.slice(0, this.len); }
}
