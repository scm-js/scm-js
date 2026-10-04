/**
 * The unit animator on a made-up script, so it runs without the game's files
 * (`tests/animate.test.ts` is the same class against the real ones, where they are installed).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { NO_UNIT, UnitFlag } from "../src/formats/dat/dat";
import { Op, OPCODE_ARGS, type IscriptBin } from "../src/formats/dat/iscript";
import { SpriteFlag, type SpriteRecord, type UnitRecord } from "../src/formats/chk/sections/objects";
import { UnitAnimator } from "../src/formats/units/animate";
import type { UnitAssets } from "../src/formats/units/load";

/** A tiny assembler: `at()` is the next offset, `op()` appends an instruction by the table's argument layout. */
function assembler() {
  const code: number[] = [0, 0, 0, 0]; // offset 0 means "no such animation"
  return {
    at: () => code.length,
    op(op: number, ...args: number[]) {
      code.push(op);
      [...OPCODE_ARGS[op]].forEach((kind, i) => {
        if (kind === "w") code.push(args[i] & 255, (args[i] >> 8) & 255);
        else code.push(args[i] & 255);
      });
    },
    bytes: () => new Uint8Array(code),
  };
}

const MARINE = 0, BEACON = 1; // unit types
const BODY = 0, SHADOW = 1, SPARK = 2, BASE = 3, LAMP = 4; // images, each with the script of the same id

/** A walker that turns and now and then throws a spark, a building that blinks, and a lamp sprite. */
function makeAssets(): UnitAssets {
  const a = assembler();
  const anims = new Map<number, number[]>();
  const header = (id: number, init: number, built = 0) => anims.set(id, [init, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, built, 0]);

  const bodyInit = a.at();
  a.op(Op.imgul, SHADOW, 0, 0);
  const bodyLoop = a.at();
  a.op(Op.playfram, 0);
  a.op(Op.waitrand, 2, 5);
  a.op(Op.turnrand, 2);
  a.op(Op.playfram, 17);
  a.op(Op.wait, 2);
  const jump = a.at();
  a.op(Op.randcondjmp, 100, 0);
  a.op(Op.goto, bodyLoop);
  const spark = a.at();
  a.op(Op.imgol, SPARK, 3, -4);
  a.op(Op.wait, 1);
  a.op(Op.goto, bodyLoop);
  header(BODY, bodyInit);

  const shadowInit = a.at();
  a.op(Op.followmaingraphic);
  const shadowWait = a.at();
  a.op(Op.wait, 125);
  a.op(Op.goto, shadowWait);
  header(SHADOW, shadowInit);

  const sparkInit = a.at();
  a.op(Op.playfram, 0);
  a.op(Op.wait, 2);
  a.op(Op.playfram, 1);
  a.op(Op.wait, 2);
  a.op(Op.end);
  header(SPARK, sparkInit);

  const baseInit = a.at();
  a.op(Op.playfram, 0);
  a.op(Op.wait, 1);
  const built = a.at();
  a.op(Op.playfram, 1);
  a.op(Op.wait, 4);
  a.op(Op.playfram, 2);
  a.op(Op.wait, 4);
  a.op(Op.imgol, SPARK, 0, 0);
  a.op(Op.tmprmgraphicstart);
  a.op(Op.wait, 1);
  a.op(Op.tmprmgraphicend);
  a.op(Op.goto, built);
  header(BASE, baseInit, built);

  const lampInit = a.at();
  a.op(Op.playfram, 0);
  a.op(Op.wait, 3);
  a.op(Op.playfram, 1);
  a.op(Op.wait, 3);
  a.op(Op.goto, lampInit);
  header(LAMP, lampInit);

  const data = a.bytes();
  data[jump + 2] = spark & 255;
  data[jump + 3] = spark >> 8;
  const iscript: IscriptBin = { data, headers: new Map([...anims].map(([id, list]) => [id, { id, type: 20, anims: list }])) };

  const units = 228;
  return {
    units: {
      flingy: Uint8Array.from({ length: units }, (_, i) => (i === BEACON ? 1 : 0)),
      subunit: new Uint16Array(units).fill(NO_UNIT),
      direction: new Uint8Array(units).fill(4),
      flags: Uint32Array.from({ length: units }, (_, i) => (i === BEACON ? UnitFlag.Building : 0)),
    },
    flingy: { sprite: Uint16Array.of(0, 1) },
    sprites: { image: Uint16Array.of(BODY, BASE, LAMP) },
    images: {
      grp: new Uint32Array(5),
      graphicTurns: Uint8Array.of(1, 0, 0, 0, 0),
      iscript: Uint32Array.of(BODY, SHADOW, SPARK, BASE, LAMP),
      lo: Array.from({ length: 6 }, () => new Uint32Array(5)),
    },
    imagePaths: [],
    iscript,
  } as unknown as UnitAssets;
}

let serial = 0;
const unit = (unitId: number, x: number, y: number): UnitRecord => ({ unitId, x, y, owner: 0, serial: ++serial, validStates: 0, stateFlags: 0, hitPointsPercent: 100 }) as unknown as UnitRecord;
const lamp = (x: number, y: number): SpriteRecord => ({ spriteId: 2, x, y, owner: 0, flags: SpriteFlag.PureSprite }) as unknown as SpriteRecord;

/** A repeatable `Math.random`, so two runs of a script make the same choices. */
function seedRandom(seed: number) {
  let s = seed >>> 0;
  vi.spyOn(Math, "random").mockImplementation(() => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe("unit animator on a made-up script", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("builds the stacks the scripts ask for and runs them", () => {
    seedRandom(1);
    const anim = new UnitAnimator(makeAssets());
    const marine = unit(MARINE, 100, 100), beacon = unit(BEACON, 300, 300);
    anim.sync([marine, beacon], 0);
    const m = anim.spriteFor(marine)!, b = anim.spriteFor(beacon)!;
    expect(m.images.map((i) => i.imageId)).toEqual([SHADOW, BODY]);
    expect(b.images.map((i) => i.imageId)).toEqual([BASE]);
    const bodyFrames = new Set<number>(), baseFrames = new Set<number>();
    let sparks = 0, hidden = 0;
    for (let t = 0; t < 400; t++) {
      anim.tick();
      bodyFrames.add(m.main.frameBase);
      baseFrames.add(b.main.frame);
      if (m.images.some((i) => i.imageId === SPARK) || b.images.some((i) => i.imageId === SPARK)) sparks++;
      if (b.main.hidden) hidden++;
      // The shadow follows the body, whatever way it has turned.
      expect(m.images[0].frame).toBe(m.main.frame);
    }
    expect([...bodyFrames].sort((x, y) => x - y)).toEqual([0, 17]);
    expect([...baseFrames].sort()).toEqual([1, 2]);
    expect(sparks).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
    // Sparks end and are dropped rather than piling up.
    expect(m.images.length).toBeLessThanOrEqual(4);
    expect(b.images.length).toBeLessThanOrEqual(3);
  });

  it("keeps a sprite across a replaced record, drops a removed one, and settles into doing nothing", () => {
    const anim = new UnitAnimator(makeAssets());
    const a = unit(MARINE, 10, 10), b = unit(MARINE, 50, 50), c = unit(BEACON, 90, 90);
    anim.sync([a, b, c], 0);
    const sa = anim.spriteFor(a)!, sb = anim.spriteFor(b)!;
    // The same list again: nothing is rebuilt.
    anim.sync([a, b, c], 0);
    expect(anim.spriteFor(a)).toBe(sa);
    // A moved unit is a fresh record with the same serial.
    const moved = { ...a, x: 400 } as UnitRecord;
    anim.sync([moved, b, c], 0);
    expect(anim.spriteFor(moved)).toBe(sa);
    expect(anim.spriteFor(a)).toBeUndefined();
    // One removed and one added in the same edit: the count is what it was.
    const d = unit(MARINE, 200, 200);
    anim.sync([moved, c, d], 0);
    expect(anim.spriteFor(b)).toBeUndefined();
    expect(anim.spriteFor(d)).toBeDefined();
    expect(anim.spriteFor(d)).not.toBe(sb);
    anim.sync([], 0);
    expect(anim.spriteFor(moved)).toBeUndefined();
    expect(anim.tick()).toBe(false);
  });

  it("does the same for THG2 sprites", () => {
    const anim = new UnitAnimator(makeAssets());
    const l1 = lamp(10, 10), l2 = lamp(900, 900), unknown = { ...lamp(5, 5), spriteId: 99 } as SpriteRecord;
    anim.syncSprites([l1, l2, unknown], 0);
    const s1 = anim.spriteForRecord(l1)!;
    expect(s1.images.map((i) => i.imageId)).toEqual([LAMP]);
    expect(anim.spriteForRecord(unknown)).toBeUndefined();
    const reowned = { ...l1, owner: 3 } as SpriteRecord;
    anim.syncSprites([reowned, l2, unknown], 0);
    expect(anim.spriteForRecord(reowned)).toBe(s1);
    expect(anim.spriteForRecord(l1)).toBeUndefined();
    anim.syncSprites([reowned, unknown], 0);
    expect(anim.spriteForRecord(l2)).toBeUndefined();
  });

  it("counts a change only inside the view it is given, and still advances what is outside", () => {
    const anim = new UnitAnimator(makeAssets());
    const far = lamp(5000, 5000);
    anim.syncSprites([far], 0);
    const s = anim.spriteForRecord(far)!;
    const here = { left: 0, top: 0, right: 1000, bottom: 1000 };
    const there = { left: 4000, top: 4000, right: 6000, bottom: 6000 };
    anim.tick(); // creation counts as a change once
    const frames: number[] = [];
    let seenHere = 0, seenThere = 0, seenAnywhere = 0;
    for (let t = 0; t < 24; t++) {
      // The three answers are asked of one tick each; the lamp blinks every third frame.
      const view = t % 3 === 0 ? here : t % 3 === 1 ? there : undefined;
      const changed = anim.tick(view);
      if (changed) { if (view === here) seenHere++; else if (view === there) seenThere++; else seenAnywhere++; }
      frames.push(s.main.frame);
    }
    expect(seenHere).toBe(0);
    expect(seenThere + seenAnywhere).toBeGreaterThan(0);
    expect(new Set(frames)).toEqual(new Set([0, 1]));
  });
});
