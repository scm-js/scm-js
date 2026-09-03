/**
 * `scripts\iscript.bin` — the bytecode that animates every image in the game.
 *
 *   u16 at 0            offset of the entry table
 *   entry table         (u16 iscript id, u16 header offset) pairs, ended by id 0xFFFF
 *   header              "SCPE", u8 type, 3 unused bytes, then u16 animation offsets — how
 *                       many depends on the type (see ANIM_COUNT_BY_TYPE); 0 = no such animation
 *   code                one byte opcode followed by its arguments (see OPCODES)
 *
 * images.dat maps each image to an iscript id. Every unit's main image, its overlays and
 * its shadow each run their own script; opcodes like `imgol` spawn further images with
 * their own scripts. Opcode names and argument layouts follow the community
 * disassemblers (PyICE / IceCC / OpenBW), and `tests/iscript.test.ts` walks the real file
 * to confirm every reachable instruction decodes. These projects are format references;
 * their code is not included here. Sources and licenses: ../../../ATTRIBUTION.md
 *
 * This module has no imports on purpose: `scripts/extract-units.mjs` loads it straight
 * into Node (which strips the types) to work out which graphics the scripts can reach.
 */

/** Animation slots, in header order. */
export const Anim = {
  Init: 0,
  Death: 1,
  GndAttkInit: 2,
  AirAttkInit: 3,
  Unused1: 4,
  GndAttkRpt: 5,
  AirAttkRpt: 6,
  CastSpell: 7,
  GndAttkToIdle: 8,
  AirAttkToIdle: 9,
  Unused2: 10,
  Walking: 11,
  WalkingToIdle: 12,
  SpecialState1: 13,
  SpecialState2: 14,
  AlmostBuilt: 15,
  Built: 16,
  Landing: 17,
  LiftOff: 18,
  IsWorking: 19,
  WorkingToIdle: 20,
  WarpIn: 21,
  Unused3: 22,
  /** What StarEdit plays after Init — the tanks and Goliath have one, adding their turret as an overlay. */
  StarEditInit: 23,
  Disable: 24,
  Burrow: 25,
  UnBurrow: 26,
  Enable: 27,
} as const;

/** How many animation offsets a header of each type carries. */
export const ANIM_COUNT_BY_TYPE: Readonly<Record<number, number>> = {
  0: 2, 1: 2, 2: 4, 12: 14, 13: 14, 14: 16, 15: 16, 20: 22, 21: 22, 23: 24, 24: 26, 26: 28, 27: 28, 28: 30,
};

export const Op = {
  playfram: 0x00,
  playframtile: 0x01,
  sethorpos: 0x02,
  setvertpos: 0x03,
  setpos: 0x04,
  wait: 0x05,
  waitrand: 0x06,
  goto: 0x07,
  imgol: 0x08,
  imgul: 0x09,
  imgolorig: 0x0a,
  switchul: 0x0b,
  __0c: 0x0c,
  imgoluselo: 0x0d,
  imguluselo: 0x0e,
  sprol: 0x0f,
  highsprol: 0x10,
  lowsprul: 0x11,
  uflunstable: 0x12,
  spruluselo: 0x13,
  sprul: 0x14,
  sproluselo: 0x15,
  end: 0x16,
  setflipstate: 0x17,
  playsnd: 0x18,
  playsndrand: 0x19,
  playsndbtwn: 0x1a,
  domissiledmg: 0x1b,
  attackmelee: 0x1c,
  followmaingraphic: 0x1d,
  randcondjmp: 0x1e,
  turnccwise: 0x1f,
  turncwise: 0x20,
  turn1cwise: 0x21,
  turnrand: 0x22,
  setspawnframe: 0x23,
  sigorder: 0x24,
  attackwith: 0x25,
  attack: 0x26,
  castspell: 0x27,
  useweapon: 0x28,
  move: 0x29,
  gotorepeatattk: 0x2a,
  engframe: 0x2b,
  engset: 0x2c,
  __2d: 0x2d,
  nobrkcodestart: 0x2e,
  nobrkcodeend: 0x2f,
  ignorerest: 0x30,
  attkshiftproj: 0x31,
  tmprmgraphicstart: 0x32,
  tmprmgraphicend: 0x33,
  setfldirect: 0x34,
  call: 0x35,
  return: 0x36,
  setflspeed: 0x37,
  creategasoverlays: 0x38,
  pwrupcondjmp: 0x39,
  trgtrangecondjmp: 0x3a,
  trgtarccondjmp: 0x3b,
  curdirectcondjmp: 0x3c,
  imgulnextid: 0x3d,
  __3e: 0x3e,
  liftoffcondjmp: 0x3f,
  warpoverlay: 0x40,
  orderdone: 0x41,
  grdsprol: 0x42,
  __43: 0x43,
  dogrddamage: 0x44,
} as const;

/**
 * Argument layout per opcode: `b` u8, `s` s8, `w` u16, `N` a u8 count followed by that
 * many u16s. Indexed by opcode; a hole means the byte is not an opcode.
 */
export const OPCODE_ARGS: readonly (string | undefined)[] = [
  "w", "w", "s", "s", "ss", "b", "bb", "w", "wss", "wss", "w", "w", "", "wss", "wss", "wss",
  "wss", "wss", "w", "wss", "wss", "wb", "", "b", "w", "N", "ww", "", "N", "", "bw", "b",
  "b", "", "b", "b", "b", "b", "", "", "b", "b", "", "b", "b", "", "", "",
  "", "b", "", "", "b", "w", "", "w", "b", "w", "ww", "www", "www", "ss", "", "w",
  "w", "b", "wss", "", "",
];


export interface IscriptHeader {
  id: number;
  type: number;
  /** Code offset per animation slot (see `Anim`); 0 when the header has no such animation. */
  anims: number[];
}

export interface IscriptBin {
  data: Uint8Array;
  headers: Map<number, IscriptHeader>;
}

function u16(data: Uint8Array, at: number): number {
  return data[at] | (data[at + 1] << 8);
}

export function decodeIscript(data: Uint8Array): IscriptBin {
  if (data.length < 4) throw new Error("iscript.bin is too short");
  const headers = new Map<number, IscriptHeader>();
  let at = u16(data, 0);
  while (at + 4 <= data.length) {
    const id = u16(data, at);
    const offset = u16(data, at + 2);
    at += 4;
    if (id === 0xffff) break;
    if (offset + 8 > data.length) throw new Error(`iscript ${id}: header offset ${offset} is outside the file`);
    if (data[offset] !== 0x53 || data[offset + 1] !== 0x43 || data[offset + 2] !== 0x50 || data[offset + 3] !== 0x45) {
      throw new Error(`iscript ${id}: header at ${offset} is not "SCPE"`);
    }
    const type = data[offset + 4];
    const count = ANIM_COUNT_BY_TYPE[type];
    if (count === undefined) throw new Error(`iscript ${id}: unknown header type ${type}`);
    const anims: number[] = [];
    for (let a = 0; a < count; a++) anims.push(u16(data, offset + 8 + a * 2));
    headers.set(id, { id, type, anims });
  }
  return { data, headers };
}

/** Code offset of animation `anim` in script `id`, or 0 when absent. */
export function animOffset(bin: IscriptBin, id: number, anim: number): number {
  return bin.headers.get(id)?.anims[anim] ?? 0;
}

export interface Instruction {
  op: number;
  args: number[];
  /** Offset of the following instruction. */
  next: number;
}

/** Decode the instruction at `pc`, or null when the byte is not an opcode. */
export function readInstruction(data: Uint8Array, pc: number): Instruction | null {
  const op = data[pc];
  const layout = OPCODE_ARGS[op];
  if (layout === undefined || pc >= data.length) return null;
  const args: number[] = [];
  let at = pc + 1;
  if (layout === "N") {
    const count = data[at++];
    for (let i = 0; i < count; i++) { args.push(u16(data, at)); at += 2; }
  } else {
    for (const kind of layout) {
      if (kind === "b") args.push(data[at++]);
      else if (kind === "s") { const v = data[at++]; args.push(v > 127 ? v - 256 : v); }
      else { args.push(u16(data, at)); at += 2; }
    }
  }
  return { op, args, next: at };
}

/** The opcodes that create another image on the same sprite, with the image id in args[0]. */
export const IMAGE_SPAWN_OPS: ReadonlySet<number> = new Set([Op.imgol, Op.imgul, Op.imgolorig, Op.switchul, Op.imgoluselo, Op.imguluselo]);

/**
 * Every instruction reachable from animation `anim` of script `id`, following jumps and
 * calls but not falling through `end`/`return`. Used by the extract script and tests.
 */
export function walkAnimation(bin: IscriptBin, id: number, anim: number, visit: (ins: Instruction, pc: number) => void) {
  const start = animOffset(bin, id, anim);
  if (!start) return;
  const seen = new Set<number>();
  const todo = [start];
  while (todo.length > 0) {
    let pc = todo.pop()!;
    while (pc < bin.data.length && !seen.has(pc)) {
      seen.add(pc);
      const ins = readInstruction(bin.data, pc);
      if (!ins) throw new Error(`iscript ${id}: unknown opcode 0x${bin.data[pc].toString(16)} at ${pc}`);
      visit(ins, pc);
      if (ins.op === Op.goto) { pc = ins.args[0]; continue; }
      if (ins.op === Op.end || ins.op === Op.return) break;
      if (ins.op === Op.call || ins.op === Op.randcondjmp || ins.op === Op.pwrupcondjmp || ins.op === Op.trgtrangecondjmp
        || ins.op === Op.trgtarccondjmp || ins.op === Op.curdirectcondjmp || ins.op === Op.liftoffcondjmp) {
        todo.push(ins.args[ins.args.length - 1]);
      }
      pc = ins.next;
    }
  }
}
