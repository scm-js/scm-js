import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import { SpriteFlag, type SpriteRecord } from "../src/formats/chk/sections/objects";
import { decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeUnitsDat, NO_UNIT } from "../src/formats/dat/dat";
import { decodeTbl } from "../src/formats/dat/tbl";
import type { UnitAssets } from "../src/formats/units/load";
import { SPRITE_COUNT, spriteCatalogue, spriteLabel } from "../src/data/sprites";
import {
  addSprites, applySpriteChanges, clampSprite, frameSize, makeSprite, moveSprites, removeSprites, spriteAt, spriteBox, spriteDrawOrder,
  spriteKind, spritesInBox, updateSprites,
} from "../src/editor/sprites";

function fresh() {
  const scn = createScenario({ name: "t", description: "", width: 64, height: 64, tileset: 4 });
  scn.sprites = [];
  scn.dirty.clear();
  return scn;
}

const size = { width: 64, height: 32 };
const sizeOf = () => size;

const setSpriteFlag = (scn: Parameters<typeof updateSprites>[0], indices: number[], bit: number, on: boolean) =>
  updateSprites(scn, indices, (r) => ({ flags: on ? r.flags | bit : r.flags & ~bit }));

describe("sprite records", () => {
  it("writes StarEdit's flags for each kind", () => {
    expect(makeSprite("pure", 20, 3, 100, 200)).toEqual({ spriteId: 20, x: 100, y: 200, owner: 3, unused: 0, flags: SpriteFlag.PureSprite });
    expect(makeSprite("pure", 20, 0, 0, 0, { flipped: true }).flags).toBe(SpriteFlag.PureSprite | SpriteFlag.Flipped);
    // A unit sprite has no PureSprite bit; Disabled only means something there.
    expect(makeSprite("unit", 209, 11, 32, 32).flags).toBe(0);
    expect(makeSprite("unit", 209, 11, 32, 32, { disabled: true }).flags).toBe(SpriteFlag.Disabled);
    expect(makeSprite("pure", 20, 0, 0, 0, { disabled: true }).flags).toBe(SpriteFlag.PureSprite);
    expect(spriteKind(makeSprite("pure", 1, 0, 0, 0))).toBe("pure");
    expect(spriteKind(makeSprite("unit", 1, 0, 0, 0))).toBe("unit");
  });

  it("clamps positions to the map", () => {
    expect(clampSprite(100.4, 77.6, 64, 64)).toEqual({ x: 100, y: 78 });
    expect(clampSprite(-5, 99999, 64, 64)).toEqual({ x: 0, y: 64 * 32 - 1 });
  });

  it("centres the graphic's box on the position", () => {
    expect(spriteBox({ spriteId: 0, x: 100, y: 50, owner: 0, unused: 0, flags: 0 }, size)).toEqual({ left: 68, top: 34, right: 132, bottom: 66 });
  });
});

describe("sprite change lists", () => {
  it("adds, removes (highest index first) and undoes in reverse, marking THG2 dirty", () => {
    const scn = fresh();
    const mk = (x: number) => makeSprite("pure", 20, 0, x, 32);
    const add = addSprites(scn, [mk(10), mk(20), mk(30)]);
    applySpriteChanges(scn, add);
    expect(scn.sprites.map((s) => s.x)).toEqual([10, 20, 30]);
    expect(scn.dirty.has("THG2")).toBe(true);

    const rm = removeSprites(scn, [0, 2, 2, 99]);
    expect(rm.map((c) => c.index)).toEqual([2, 0]);
    applySpriteChanges(scn, rm);
    expect(scn.sprites.map((s) => s.x)).toEqual([20]);

    applySpriteChanges(scn, rm, "undo");
    expect(scn.sprites.map((s) => s.x)).toEqual([10, 20, 30]);
    applySpriteChanges(scn, add, "undo");
    expect(scn.sprites).toHaveLength(0);
  });

  it("moves with clamping, skips no-op updates and toggles flag bits", () => {
    const scn = fresh();
    applySpriteChanges(scn, addSprites(scn, [makeSprite("pure", 20, 0, 100, 100)]));
    const mv = moveSprites(scn, [0], 5.4, -3);
    expect(mv).toHaveLength(1);
    applySpriteChanges(scn, mv);
    expect([scn.sprites[0].x, scn.sprites[0].y]).toEqual([105, 97]);
    expect(moveSprites(scn, [0], -500, 0)[0].after!.x).toBe(0);
    expect(updateSprites(scn, [0], () => ({ owner: 0 }))).toEqual([]);

    const flip = setSpriteFlag(scn, [0], SpriteFlag.Flipped, true);
    applySpriteChanges(scn, flip);
    expect(scn.sprites[0].flags).toBe(SpriteFlag.PureSprite | SpriteFlag.Flipped);
    applySpriteChanges(scn, setSpriteFlag(scn, [0], SpriteFlag.PureSprite, false));
    expect(spriteKind(scn.sprites[0])).toBe("unit");
    expect(setSpriteFlag(scn, [0], SpriteFlag.Flipped, true)).toEqual([]);
    applySpriteChanges(scn, flip, "undo");
    expect(scn.sprites[0].flags).toBe(SpriteFlag.PureSprite); // undo restores the record wholesale
  });
});

describe("picking", () => {
  const scn = fresh();
  scn.sprites = [
    makeSprite("pure", 1, 0, 100, 100), // index 0
    makeSprite("pure", 2, 0, 110, 120), // index 1: lower on screen, drawn later
    makeSprite("pure", 3, 0, 110, 120), // index 2: same spot, later index wins
    makeSprite("pure", 4, 0, 1000, 1000),
  ];

  it("orders by y then index and picks the topmost", () => {
    expect(spriteDrawOrder(scn)).toEqual([0, 1, 2, 3]);
    expect(spriteAt(scn, 110, 120, sizeOf)).toBe(2);
    expect(spriteAt(scn, 70, 90, sizeOf)).toBe(0); // only sprite 0's box (68..132 × 84..116) covers it
    expect(spriteAt(scn, 500, 500, sizeOf)).toBe(-1);
  });

  it("box-selects intersecting sprites in any corner order", () => {
    // Sprite 0's box is 68..132 × 84..116, sprites 1–2 sit at 78..142 × 104..136.
    expect(spritesInBox(scn, { left: 0, top: 0, right: 90, bottom: 90 }, sizeOf)).toEqual([0]);
    expect(spritesInBox(scn, { left: 0, top: 0, right: 90, bottom: 110 }, sizeOf)).toEqual([0, 1, 2]);
    expect(spritesInBox(scn, { left: 1100, top: 1100, right: 990, bottom: 990 }, sizeOf)).toEqual([3]);
    expect(spritesInBox(scn, { left: 300, top: 300, right: 400, bottom: 400 }, sizeOf)).toEqual([]);
  });
});

describe("THG2 round trip", () => {
  it("survives serialize → parse with every field intact", () => {
    const scn = fresh();
    const placed: SpriteRecord[] = [
      makeSprite("pure", 300, 7, 1234, 567, { flipped: true }),
      makeSprite("unit", 209, 11, 64, 96, { disabled: true }),
    ];
    applySpriteChanges(scn, addSprites(scn, placed));
    const again = parseScenario(serializeScenario(scn));
    expect(again.sprites).toEqual(placed);
  });
});

const ARR = join(import.meta.dirname, "..", "public", "arr");
const haveTables = ["units.dat", "flingy.dat", "sprites.dat", "images.dat", "images.tbl"].every((f) => existsSync(join(ARR, f)));

// `if`, not `skipIf`: vitest runs a skipped describe's body to collect it, and this one reads the files.
if (haveTables) describe("sprite names from the real tables", () => {
  const read = (f: string) => new Uint8Array(readFileSync(join(ARR, f)));
  const assets = {
    units: decodeUnitsDat(read("units.dat")),
    flingy: decodeFlingyDat(read("flingy.dat")),
    sprites: decodeSpritesDat(read("sprites.dat")),
    images: decodeImagesDat(read("images.dat")),
    imagePaths: decodeTbl(read("images.tbl")),
    teamColors: new Uint8Array(0),
    iscript: null,
  } as unknown as UnitAssets;

  it("labels unit sprites after their unit and doodad sprites after their tileset", () => {
    const cat = spriteCatalogue(assets);
    expect(cat.entries).toHaveLength(SPRITE_COUNT);
    // Sprite 130 (zerg\avenger.grp) is the Scourge, unit 47: its flingy is the first to use it.
    expect(cat.entries[130].unitId).toBe(47);
    expect(spriteLabel(assets, 130)).toBe(cat.entries[130].label);
    expect(cat.entries[130].group).toBe("Units");
    // Sprite 0 is the Ash World rock doodad graphic; no unit draws with it.
    expect(cat.entries[0]).toMatchObject({ unitId: NO_UNIT, group: "Doodads · Ash World", label: "rock01" });
    expect(cat.groups[0].label).toBe("Units");
    expect(cat.groups.map((g) => g.ids.length).reduce((a, b) => a + b, 0)).toBe(SPRITE_COUNT);
    expect(spriteLabel(null, 5)).toBe("Sprite #5");
  });
});

describe("frame rectangles", () => {
  it("places a frame's opaque rectangle inside the centred GRP box, mirrored when flipped", () => {
    const at = { spriteId: 0, x: 200, y: 100, owner: 0, unused: 0, flags: 0 };
    // A 128×128 box whose frame 0 covers 50..70 × 60..84.
    const plain = frameSize(128, 128, { x: 50, y: 60, width: 20, height: 24 }, false);
    expect(spriteBox(at, plain)).toEqual({ left: 200 - 64 + 50, top: 100 - 64 + 60, right: 200 - 64 + 70, bottom: 100 - 64 + 84 });
    const flipped = frameSize(128, 128, { x: 50, y: 60, width: 20, height: 24 }, true);
    expect(spriteBox(at, flipped).left).toBe(200 - 64 + (128 - 70));
  });
});
