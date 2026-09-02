import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  Anim, ANIM_COUNT_BY_TYPE, animOffset, decodeIscript, Op, OPCODE_ARGS, OPCODE_NAMES, readInstruction, walkAnimation,
} from "../src/formats/dat/iscript";
import { decodeLo, loOffset, loSlotCount, loUsedSlots } from "../src/formats/dat/lo";
import { decodeImagesDat } from "../src/formats/dat/dat";

const PUBLIC = join(import.meta.dirname, "..", "public");
const ISCRIPT = join(PUBLIC, "scripts", "iscript.bin");
const IMAGES = join(PUBLIC, "arr", "images.dat");
const CC_LO = join(PUBLIC, "unit", "terran", "control.lof");

function bytes(...parts: (number[] | Uint8Array)[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const u16 = (v: number) => [v & 255, v >> 8];
const u32 = (v: number) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

describe("iscript opcode table", () => {
  it("names and argument layouts line up", () => {
    expect(OPCODE_NAMES).toHaveLength(OPCODE_ARGS.length);
    expect(OPCODE_NAMES[Op.playfram]).toBe("playfram");
    expect(OPCODE_NAMES[Op.dogrddamage]).toBe("dogrddamage");
    expect(OPCODE_ARGS[Op.imgol]).toBe("wss");
    expect(OPCODE_ARGS[Op.waitrand]).toBe("bb");
    expect(OPCODE_ARGS[Op.curdirectcondjmp]).toBe("www");
  });

  it("decodes arguments by kind, including signed and counted ones", () => {
    const code = bytes([Op.setpos, 0xff, 0x05], [Op.playsndrand, 2, ...u16(7), ...u16(9)], [Op.goto, ...u16(0x1234)]);
    const a = readInstruction(code, 0)!;
    expect(a).toEqual({ op: Op.setpos, args: [-1, 5], next: 3 });
    const b = readInstruction(code, a.next)!;
    expect(b).toEqual({ op: Op.playsndrand, args: [7, 9], next: 9 });
    expect(readInstruction(code, b.next)).toEqual({ op: Op.goto, args: [0x1234], next: 12 });
    expect(readInstruction(bytes([0x99]), 0)).toBeNull();
  });
});

describe("iscript container", () => {
  /** One type-1 header (Init + Death) for id 5: Init loops `playfram 0; wait 2`, Death ends. */
  const initAt = 16, deathAt = 24, headerAt = 28, tableAt = 40;
  const file = bytes(
    u16(tableAt), new Uint8Array(14),
    [Op.playfram, ...u16(0), Op.wait, 2, Op.goto, ...u16(initAt)],
    [Op.wait, 1, Op.end, 0],
    [0x53, 0x43, 0x50, 0x45, 1, 0, 0, 0, ...u16(initAt), ...u16(deathAt)],
    [...u16(5), ...u16(headerAt), ...u16(0xffff), ...u16(0)],
  );

  it("reads the entry table and header animations", () => {
    const bin = decodeIscript(file);
    expect([...bin.headers.keys()]).toEqual([5]);
    expect(bin.headers.get(5)).toEqual({ id: 5, type: 1, anims: [initAt, deathAt] });
    expect(animOffset(bin, 5, Anim.Init)).toBe(initAt);
    expect(animOffset(bin, 5, Anim.Built)).toBe(0);
    expect(animOffset(bin, 6, Anim.Init)).toBe(0);
  });

  it("walks an animation following its jumps once", () => {
    const bin = decodeIscript(file);
    const ops: number[] = [];
    walkAnimation(bin, 5, Anim.Init, (ins) => ops.push(ins.op));
    expect(ops).toEqual([Op.playfram, Op.wait, Op.goto]);
  });

  it("rejects a header without the magic", () => {
    const bad = new Uint8Array(file);
    bad[headerAt] = 0x58;
    expect(() => decodeIscript(bad)).toThrow(/SCPE/);
  });
});

describe(".lo overlay files", () => {
  it("reads per-frame slots and treats 127,127 as unused", () => {
    const lo = decodeLo(bytes(u32(2), u32(2), u32(16), u32(20), [3, 0xfe, 127, 127], [0xf6, 5, 1, 2]));
    expect(lo.frames).toBe(2);
    expect(loOffset(lo, 0, 0)).toEqual({ x: 3, y: -2 });
    expect(loOffset(lo, 0, 1)).toBeNull();
    expect(loSlotCount(lo, 0)).toBe(1);
    expect(loSlotCount(lo, 1)).toBe(2);
    // Used slots need not be contiguous.
    const gap = decodeLo(bytes(u32(1), u32(2), u32(12), [127, 127, 4, 4]));
    expect(loUsedSlots(gap, 0)).toEqual([1]);
    expect(loOffset(lo, 9, 0)).toEqual({ x: -10, y: 5 }); // clamps to the last frame
  });
});

// `if`, not `skipIf`: vitest runs a skipped describe's body to collect it, and this one reads the files.
if (existsSync(ISCRIPT) && existsSync(IMAGES)) describe("the real iscript.bin", () => {
  const bin = decodeIscript(new Uint8Array(readFileSync(ISCRIPT)));
  const images = decodeImagesDat(new Uint8Array(readFileSync(IMAGES)));

  it("has a few hundred scripts of the known header types", () => {
    expect(bin.headers.size).toBeGreaterThan(350);
    for (const h of bin.headers.values()) expect(ANIM_COUNT_BY_TYPE[h.type]).toBe(h.anims.length);
  });

  it("decodes every reachable instruction of every animation", () => {
    let count = 0;
    for (const h of bin.headers.values()) {
      for (let a = 0; a < h.anims.length; a++) walkAnimation(bin, h.id, a, () => { count++; });
    }
    expect(count).toBeGreaterThan(10000);
  });

  it("gives every image a script; only turreted vehicles have a StarEditInit", () => {
    const withStarEdit: number[] = [];
    for (let i = 0; i < images.iscript.length; i++) {
      const id = images.iscript[i];
      if (images.grp[i] === 0) continue;
      expect(bin.headers.has(id), `image ${i} → iscript ${id}`).toBe(true);
      if (animOffset(bin, id, Anim.StarEditInit)) withStarEdit.push(i);
    }
    // Goliath, tank and siege tank, their Brood War hero versions, and the tank/goliath turrets' hosts.
    expect(withStarEdit).toEqual([234, 250, 253, 735, 736, 738, 739, 740, 741, 742, 743, 750, 751, 754]);
  });

  it("plays the Hatchery's pulse from Built and the Nexus glow as a Built overlay", () => {
    // images 70 (zerg\hatchery.grp) and 179 (protoss\nexus.grp)
    const hatchery: number[] = [];
    walkAnimation(bin, images.iscript[70], Anim.Built, (ins) => { if (ins.op === Op.playfram) hatchery.push(ins.args[0]); });
    expect(hatchery).toEqual([0, 1, 2, 3, 2, 1, 0]);
    const nexus: number[] = [];
    walkAnimation(bin, images.iscript[179], Anim.Built, (ins) => { if (ins.op === Op.imgol) nexus.push(ins.args[0]); });
    expect(nexus).toEqual([181]);
  });

  it.skipIf(!existsSync(CC_LO))("names the Command Center's damage overlay positions", () => {
    const lo = decodeLo(new Uint8Array(readFileSync(CC_LO)));
    expect(lo.frames).toBe(6);
    expect(loUsedSlots(lo, 0)).toEqual([0, 1, 2]);
    expect(loOffset(lo, 0, 0)).toEqual({ x: -44, y: -30 });
  });

  it.skipIf(!existsSync(join(PUBLIC, "unit", "terran", "missile.lof")))("finds the Missile Turret's single fire in slot 1", () => {
    const lo = decodeLo(new Uint8Array(readFileSync(join(PUBLIC, "unit", "terran", "missile.lof"))));
    expect(loUsedSlots(lo, 2)).toEqual([1]);
  });
});
