import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeUnitsDat } from "../src/formats/dat/dat";
import { decodeIscript } from "../src/formats/dat/iscript";
import { decodePcx } from "../src/formats/dat/pcx";
import { decodeTbl } from "../src/formats/dat/tbl";
import { UnitAnimator } from "../src/formats/units/animate";
import type { UnitAssets } from "../src/formats/units/load";
import { makeUnit } from "../src/editor/units";

const PUBLIC = join(import.meta.dirname, "..", "public");
const FILES = ["arr/units.dat", "arr/flingy.dat", "arr/sprites.dat", "arr/images.dat", "arr/images.tbl", "game/tunit.pcx", "scripts/iscript.bin"];
const have = FILES.every((f) => existsSync(join(PUBLIC, f)));

/** The tables the way the browser loader assembles them, read from disk instead. */
function loadAssets(): UnitAssets {
  const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
  return {
    units: decodeUnitsDat(read("arr/units.dat")),
    flingy: decodeFlingyDat(read("arr/flingy.dat")),
    sprites: decodeSpritesDat(read("arr/sprites.dat")),
    images: decodeImagesDat(read("arr/images.dat")),
    imagePaths: decodeTbl(read("arr/images.tbl")),
    teamColors: decodePcx(read("game/tunit.pcx")).pixels,
    iscript: decodeIscript(read("scripts/iscript.bin")),
  };
}

describe.skipIf(!have)("unit animator on the real scripts", () => {
  const assets = loadAssets();
  const JUNGLE = 4;

  it("gives a Hatchery its shadow underlay and pulses it from the Built animation", () => {
    const anim = new UnitAnimator(assets);
    const hatchery = makeUnit(assets.units, 131, 0, 64, 48, 1);
    anim.sync([hatchery], JUNGLE);
    const s = anim.spriteFor(hatchery)!;
    expect(s.images.map((i) => i.imageId)).toEqual([71, 70]); // zerg\hatchery shadow under the main graphic
    expect(s.main.frame).toBe(0);
    const frames = new Set<number>();
    for (let t = 0; t < 40; t++) { anim.tick(); frames.add(s.main.frame); }
    expect([...frames].sort()).toEqual([0, 1, 2, 3]);
  });

  it("adds the Missile Turret's turret overlay and spins it one step per frame", () => {
    const anim = new UnitAnimator(assets);
    const turret = makeUnit(assets.units, 124, 0, 32, 32, 1);
    anim.sync([turret], JUNGLE);
    const s = anim.spriteFor(turret)!;
    const overlay = s.images.find((i) => i.imageId === 297)!;
    expect(overlay).toBeDefined();
    expect(s.images.indexOf(overlay)).toBeGreaterThan(s.images.indexOf(s.main));
    const before = s.direction;
    expect(anim.tick()).toBe(true);
    expect(s.direction).toBe((before + 1) & 31);
    // The base does not turn (its graphic has no facings); the turret frame follows the direction.
    expect(s.main.frame).toBe(2);
  });

  it("draws a tank's turret through StarEditInit rather than as a subunit", () => {
    const anim = new UnitAnimator(assets);
    const tank = makeUnit(assets.units, 5, 0, 32, 32, 1);
    anim.sync([tank], JUNGLE);
    const s = anim.spriteFor(tank)!;
    expect(s.turret).toBeNull();
    expect(s.images.some((i) => i.imageId === 251)).toBe(true); // terran\tankt.grp overlay
  });

  it("keeps a sprite across a moved record and drops removed ones", () => {
    const anim = new UnitAnimator(assets);
    const marine = makeUnit(assets.units, 0, 0, 100, 100, 7);
    anim.sync([marine], JUNGLE);
    const s = anim.spriteFor(marine)!;
    for (let t = 0; t < 5; t++) anim.tick();
    const moved = { ...marine, x: 140 };
    anim.sync([moved], JUNGLE);
    expect(anim.spriteFor(moved)).toBe(s);
    expect(anim.spriteFor(marine)).toBeUndefined();
    anim.sync([], JUNGLE);
    expect(anim.spriteFor(moved)).toBeUndefined();
  });

  it("does nothing without the bytecode", () => {
    const anim = new UnitAnimator({ ...assets, iscript: null });
    expect(anim.enabled).toBe(false);
    const marine = makeUnit(assets.units, 0, 0, 100, 100, 1);
    anim.sync([marine], JUNGLE);
    expect(anim.spriteFor(marine)!.images).toHaveLength(1);
    expect(anim.tick()).toBe(false);
  });
});
