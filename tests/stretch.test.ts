import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadTileset, megatileForTile, TileFlag, type Tileset } from "../src/formats/tileset/decode";
import { buildDoodadCatalogue } from "../src/formats/tileset/doodads";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { decodeTbl } from "../src/formats/dat/tbl";
import { TILESETS } from "../src/data/tilesets";
import type { Scenario } from "../src/formats/chk/scenario";
import { baseTerrain, flatTerrain } from "../src/formats/tileset/terrain";
import { paintIsom } from "../src/editor/isom";
import { checkDoodadPlacement, DEFAULT_DOODAD_PLACEMENT } from "../src/editor/doodads";
import { SEAM_SHOWS, seamStep } from "../src/editor/blend";
import { clipPicture, DEFAULT_CLIP_PARTS, pasteClip, STRETCHED_CLIP_PARTS, stretchClip, type Clip } from "../src/editor/clipboard";
import { createScenario } from "../src/formats/chk/create";
import { doodadTwin } from "../src/editor/doodadTwin";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import {
  isStretched, soundAxes, STRETCH_AXES, STRETCH_STEP, stretchDoodad, stretchFromDrag, stretchPiece, stretchPlan, VISIBLE_SEAM, type TilePiece,
} from "../src/editor/stretch";

/* ── A synthetic tileset: solid colours and two-colour halves ── */

const RED = 1, GREEN = 2, BLUE = 3;

/**
 * Megatiles: 1 red, 2 green, 3 blue, 4 red over green, 5 green over blue, 6 red beside
 * green, 7 green beside blue. All of them sit in group 2, so megatile `m` is tile
 * `0x20 + m - 1`. Green is floor a unit walks; red and blue are wall. Megatile 8 is floor
 * with one minitile of rock in the middle of it.
 */
function synthetic(): Tileset {
  const palette = new Uint8Array(256 * 4);
  const set = (i: number, r: number, g: number, b: number) => { palette[i * 4] = r; palette[i * 4 + 1] = g; palette[i * 4 + 2] = b; palette[i * 4 + 3] = 255; };
  set(RED, 255, 0, 0);
  set(GREEN, 0, 255, 0);
  set(BLUE, 0, 0, 255);
  const minitiles = new Uint8Array(4 * 64);
  minitiles.fill(RED, 64, 128);
  minitiles.fill(GREEN, 128, 192);
  minitiles.fill(BLUE, 192, 256);
  const megatileCount = 9;
  const refs = new Uint32Array(megatileCount * 16);
  const paint = (m: number, colour: (col: number, row: number) => number) => { for (let i = 0; i < 16; i++) refs[m * 16 + i] = colour(i % 4, i >> 2) << 1; };
  paint(1, () => RED);
  paint(2, () => GREEN);
  paint(3, () => BLUE);
  paint(4, (_c, r) => (r < 2 ? RED : GREEN));
  paint(5, (_c, r) => (r < 2 ? GREEN : BLUE));
  paint(6, (c) => (c < 2 ? RED : GREEN));
  paint(7, (c) => (c < 2 ? GREEN : BLUE));
  paint(8, (c, r) => (c === 1 && r === 1 ? BLUE : GREEN));
  const cv5 = new Uint8Array(3 * 52);
  const view = new DataView(cv5.buffer);
  view.setUint16(2 * 52, 2, true);
  for (let s = 0; s < 8; s++) view.setUint16(2 * 52 + 20 + s * 2, s + 1, true);
  const vx4 = new Uint8Array(megatileCount * 32);
  const v = new DataView(vx4.buffer);
  refs.forEach((ref, i) => v.setUint16(i * 2, ref, true));
  const vf4 = new Uint8Array(megatileCount * 32);
  const flags = new DataView(vf4.buffer);
  refs.forEach((ref, i) => flags.setUint16(i * 2, ref >> 1 === GREEN ? 1 : 0, true));
  return loadTileset({ cv5, vf4, vr4: minitiles, vx4, wpe: palette.slice(0, 1024) });
}

/** A repeatable stand-in for Math.random. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}

const ts = synthetic();
const [R, G, B, RG_V, GB_V, RG_H, GB_H, ROCK] = [0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27];
const piece = (width: number, height: number, tiles: number[], required?: number[]): TilePiece =>
  ({ width, height, tiles: Uint16Array.from(tiles), required: required && Uint16Array.from(required) });
const rows = (g: { width: number; height: number; tiles: Uint16Array }) =>
  Array.from({ length: g.height }, (_, r) => [...g.tiles.subarray(r * g.width, (r + 1) * g.width)]);

describe("the cut", () => {
  it("repeats the cell that joins itself, wherever in the line it is", () => {
    // A column: red fading to green, green, green fading to blue, blue. Only the green repeats without a seam.
    const column = piece(1, 4, [RG_V, G, GB_V, B]);
    const plan = stretchPlan(ts, column, "s");
    expect(plan.lines).toEqual([[0, 1, 2, 3]]);
    expect(plan.cut).toEqual([1]);
    expect(plan.seam).toBe(0);
    expect(rows(stretchPiece(column, plan, 2))).toEqual([[RG_V], [G], [G], [G], [GB_V], [B]]);
  });

  it("goes through the middle when every cell would do", () => {
    const plan = stretchPlan(ts, piece(1, 5, [G, G, G, G, G]), "s");
    expect(plan.cut).toEqual([2]);
  });

  it("does not open a hole where the piece has a tile, nor fill one it has", () => {
    // Two columns side by side; the right one is bare in its middle row, and the piece ships with
    // green beside that bare cell, so the bare cell repeats with it.
    const holed = piece(2, 3, [RG_V, RG_V, G, 0, GB_V, GB_V]);
    const plan = stretchPlan(ts, holed, "s");
    expect(plan.cut).toEqual([1, 1]);
    expect(rows(stretchPiece(holed, plan, 1))).toEqual([[RG_V, RG_V], [G, 0], [G, 0], [GB_V, GB_V]]);
    // A hole at the end of a line is not what repeats when a tile that joins itself is on offer.
    const capped = piece(1, 3, [0, G, GB_V]);
    expect(stretchPlan(ts, capped, "s").cut).toEqual([1]);
  });

  it("reports the seams a stretch adds", () => {
    // Nothing here joins itself top to bottom: any cut leaves red against green or green against blue.
    const plan = stretchPlan(ts, piece(1, 2, [RG_V, GB_V]), "s");
    expect(plan.seam).toBeGreaterThan(VISIBLE_SEAM);
    expect(plan.seamsPerStep).toBe(1);
    // And it is one the Seam Overlay draws; a piece that joins itself has none.
    expect(plan.shownPerStep).toBe(1);
    expect(stretchPlan(ts, piece(1, 3, [RG_V, G, GB_V]), "s").shownPerStep).toBe(0);
  });

  it("is worked out once for a piece and an axis", () => {
    const p = piece(1, 3, [RG_V, G, GB_V]);
    expect(stretchPlan(ts, p, "s")).toBe(stretchPlan(ts, p, "s"));
    expect(stretchPlan(ts, p, "e")).not.toBe(stretchPlan(ts, p, "s"));
  });
});

describe("the axes a piece stretches along", () => {
  it("are those where the added joins keep wall against wall and floor against floor", () => {
    // Wall, floor, wall down a column: the floor repeats, and floor meets floor.
    const passage = piece(1, 3, [RG_V, G, GB_V]);
    expect(stretchPlan(ts, passage, "s").walkBreaks).toBe(0);
    expect(soundAxes(ts, passage)).toContain("s");
    // Two halves with no floor between them that could repeat: whichever is laid again,
    // its wall lands on the other's floor.
    const halves = piece(1, 2, [RG_V, GB_V]);
    expect(stretchPlan(ts, halves, "s").walkBreaks).toBe(1);
    expect(soundAxes(ts, halves)).not.toContain("s");
    // Side by side the same two carry on cleanly: red beside red, green beside green.
    expect(soundAxes(ts, halves)).toContain("e");
  });

  it("are, for a ramp, those its ground carries on along, where it has a middle to lay again", () => {
    // Wall, floor, wall as a ramp that wants one ground under all three cells: it stretches
    // down the column, where that ground carries on, and nowhere else.
    const onOneGround = { ...piece(1, 3, [RG_V, G, GB_V], [5, 5, 5]), ramp: true };
    expect(stretchPlan(ts, onOneGround, "s").groundContinues).toBe(1);
    expect(stretchPlan(ts, onOneGround, "e").groundContinues).toBeNull();
    expect(soundAxes(ts, onOneGround)).toEqual(["s"]);
    const onThreeGrounds = { ...piece(1, 3, [RG_V, G, GB_V], [5, 6, 7]), ramp: true };
    expect(stretchPlan(ts, onThreeGrounds, "s").groundContinues).toBe(0);
    expect(soundAxes(ts, onThreeGrounds)).toEqual([]);
    // With no floor between its two walls, a ramp on the right ground still does not stretch:
    // every step would stand a strip of wall across it.
    const noMiddle = { ...piece(1, 2, [RG_V, GB_V], [5, 5]), ramp: true };
    expect(stretchPlan(ts, noMiddle, "s").groundContinues).toBe(1);
    expect(soundAxes(ts, noMiddle)).toEqual([]);
  });

  it("counts the pieces of wall and floor a step leaves behind", () => {
    // Laid again, either half leaves a strip of wall and a strip of floor cut off from the rest.
    expect(stretchPlan(ts, piece(1, 2, [RG_V, GB_V]), "s").islandsPerStep).toBe(2);
    expect(stretchPlan(ts, piece(1, 3, [RG_V, G, GB_V]), "s").islandsPerStep).toBe(0);
  });
});

describe("a rock on the walking surface", () => {
  // Wall, floor with a rock in it, wall, and a tile of clean floor at the far end. On looks
  // the rock tile is the one to repeat: it joins itself, and it is nearer the middle.
  const rocky = piece(1, 4, [RG_V, ROCK, GB_V, G], [7, 8, 9, 10]);

  it("is not laid again: the added cells borrow a tile of the piece that walks wherever the repeated one does", () => {
    const plan = stretchPlan(ts, rocky, "s");
    expect(plan.cut).toEqual([1]);
    expect(plan.fill).toEqual([G]);
    expect(plan.islandsPerStep).toBe(0);
    const g = stretchPiece(rocky, plan, 2);
    expect(rows(g)).toEqual([[RG_V], [ROCK], [G], [G], [GB_V], [G]]);
    // The borrowed tiles stand on the ground the repeated cell stands on.
    expect([...g.required]).toEqual([7, 8, 8, 8, 9, 10]);
  });

  it("stays where the piece has no cleaner tile to lend, and is counted", () => {
    const plan = stretchPlan(ts, piece(1, 3, [RG_V, ROCK, GB_V]), "s");
    expect(plan.fill).toEqual([ROCK]);
    expect(plan.islandsPerStep).toBe(1);
  });

  it("is told from the edge of a wall that carries on, which is left as drawn", () => {
    // Floor on the left, a rail on the right, all the way down: trading the rail's tile for
    // floor would cut the rail in two.
    const railed = piece(2, 3, [G, GB_H, G, GB_H, G, GB_H]);
    const plan = stretchPlan(ts, railed, "s");
    expect(plan.fill).toEqual([G, GB_H]);
    expect(plan.islandsPerStep).toBe(0);
  });
});

describe("a stretched piece", () => {
  it("steps two tiles across, so left and right halves stay on their columns", () => {
    // Left and right halves alternate; a one-tile step would put two left halves together.
    const row = piece(4, 1, [RG_H, GB_H, RG_H, GB_H]);
    const plan = stretchPlan(ts, row, "e");
    expect(plan.lines).toEqual([[0, 2], [1, 3]]);
    const g = stretchPiece(row, plan, 2);
    expect(g.width).toBe(8);
    expect(rows(g)).toEqual([[RG_H, GB_H, RG_H, GB_H, RG_H, GB_H, RG_H, GB_H]]);
  });

  it("runs two across and one down on a diagonal, and marks what it added", () => {
    const p = piece(4, 2, [R, R, G, G, B, B, R, R]);
    const plan = stretchPlan(ts, p, "se");
    // (0,0)→(2,1) and (1,0)→(3,1) are the two-cell lines; the other four cells stand alone.
    expect(plan.lines.map((l) => l.length).sort()).toEqual([1, 1, 1, 1, 2, 2]);
    const g = stretchPiece(p, plan, 3);
    expect([g.width, g.height]).toEqual([4 + 2 * 3, 2 + 3]);
    expect(g.offset).toEqual({ x: 0, y: 0 });
    expect(g.added.reduce((s, v) => s + v, 0)).toBe(6 * 3);
    // The top-left cell has not moved, and its line carries on down the diagonal.
    expect(g.tiles[0]).toBe(R);
    expect(g.tiles[4 * g.width + 8]).toBe(R);
  });

  it("climbs on the other diagonal, with its top-left tile that much higher", () => {
    const p = piece(4, 2, [R, R, G, G, B, B, R, R]);
    const g = stretchPiece(p, stretchPlan(ts, p, "ne"), 2);
    expect([g.width, g.height]).toEqual([8, 4]);
    expect(g.offset).toEqual({ x: 0, y: -2 });
    // The bottom-left cell of the piece stays where it was: two rows down in the taller grid.
    expect(g.tiles[3 * g.width]).toBe(B);
  });

  it("stretches back from the far end with a negative count", () => {
    const p = piece(4, 2, [R, R, G, G, B, B, R, R]);
    const forward = stretchPiece(p, stretchPlan(ts, p, "se"), 2), back = stretchPiece(p, stretchPlan(ts, p, "se"), -2);
    expect(back.tiles).toEqual(forward.tiles);
    expect(back.offset).toEqual({ x: -4, y: -2 });
    expect(stretchPiece(p, stretchPlan(ts, p, "ne"), -2).offset).toEqual({ x: -4, y: 0 });
    expect(stretchPiece(p, stretchPlan(ts, p, "s"), -3).offset).toEqual({ x: 0, y: -3 });
  });

  it("carries what each cell needs under it along with the cell", () => {
    const column = piece(1, 3, [RG_V, G, GB_V], [7, 8, 9]);
    const g = stretchPiece(column, stretchPlan(ts, column, "s"), 2);
    expect([...g.required]).toEqual([7, 8, 8, 8, 9]);
  });

  it("is the piece itself at no steps", () => {
    const p = piece(4, 2, [R, R, G, G, B, B, R, R]);
    for (const axis of STRETCH_AXES) {
      const g = stretchPiece(p, stretchPlan(ts, p, axis), 0);
      expect(g.tiles).toEqual(p.tiles);
      expect(g.offset.x === 0 && g.offset.y === 0).toBe(true);
    }
  });
});

describe("a clip stretched", () => {
  const record = { doodadId: 1, x: 16, y: 16, owner: 0, disabled: 0 };
  const clip: Clip = {
    width: 1, height: 3, era: 0,
    tiles: Uint16Array.from([RG_V, G, GB_V]), ground: Uint16Array.from([R, G, B]),
    doodads: [record], units: [], sprites: [], locations: [], fog: new Uint8Array(3),
  };

  it("is its picture with the middle laid again, as terrain and nothing else", () => {
    const long = stretchClip(ts, clip, { ...DEFAULT_CLIP_PARTS, doodads: true }, "s", 2)!;
    expect([long.clip.width, long.clip.height]).toEqual([1, 5]);
    expect([...long.clip.tiles!]).toEqual([RG_V, G, G, G, GB_V]);
    // The picture goes into both tile sections, and the objects and the fog stay behind.
    expect(long.clip.ground).toBe(long.clip.tiles);
    expect(long.clip.doodads).toEqual([]);
    expect(long.clip.fog).toBeNull();
    expect(long.offset).toEqual({ x: 0, y: 0 });
    expect(stretchClip(ts, clip, { ...DEFAULT_CLIP_PARTS, doodads: true }, "s", -2)!.offset).toEqual({ x: 0, y: -2 });
  });

  it("is the ground under the doodads when the doodads are not being pasted", () => {
    expect(clipPicture(clip, { ...DEFAULT_CLIP_PARTS, doodads: false })).toBe(clip.ground);
    const long = stretchClip(ts, clip, { ...DEFAULT_CLIP_PARTS, doodads: false }, "s", 1)!;
    expect([...long.clip.tiles!]).toEqual([R, G, G, B]);
  });

  it("is nothing for a clip pasted without its terrain", () => {
    expect(stretchClip(ts, clip, { ...DEFAULT_CLIP_PARTS, terrain: false }, "s", 2)).toBeNull();
    expect(stretchClip(ts, { ...clip, tiles: null, ground: null }, DEFAULT_CLIP_PARTS, "s", 2)).toBeNull();
  });

  it("pastes like any clip: its tiles into both sections, one undo step", () => {
    const scn = createScenario({ name: "t", description: "", width: 4, height: 8, era: 0, tiles: new Uint16Array(32).fill(R) });
    const long = stretchClip(ts, clip, { ...DEFAULT_CLIP_PARTS, doodads: true }, "s", 2)!;
    const result = pasteClip(scn, long.clip, 1, 1, { parts: STRETCHED_CLIP_PARTS, mode: "merge", catalogue: NO_DOODADS, tileset: ts });
    expect(result.counts.tiles).toBe(5);
    for (const [row, tile] of [RG_V, G, G, G, GB_V].entries()) {
      expect(scn.tiles[(1 + row) * 4 + 1]).toBe(tile);
      expect(scn.editorTiles[(1 + row) * 4 + 1]).toBe(tile);
    }
    expect(scn.doodads).toEqual([]);
  });
});

describe("the stretch a drag asks for", () => {
  it("takes the axis the drag lies along and a step for each step's length", () => {
    expect(stretchFromDrag(64 * 3, 32 * 3)).toEqual({ axis: "se", steps: 3 });
    expect(stretchFromDrag(64 * 2, -32 * 2)).toEqual({ axis: "ne", steps: 2 });
    expect(stretchFromDrag(64 * 4, 0)).toEqual({ axis: "e", steps: 4 });
    expect(stretchFromDrag(0, 32 * 5)).toEqual({ axis: "s", steps: 5 });
  });

  it("goes against the axis for a drag the other way", () => {
    expect(stretchFromDrag(-64 * 2, -32 * 2)).toEqual({ axis: "se", steps: -2 });
    expect(stretchFromDrag(0, -70)).toEqual({ axis: "s", steps: -2 });
  });

  it("is nothing for a drag shorter than half a step", () => {
    expect(stretchFromDrag(10, 4).steps).toBe(0);
    expect(stretchFromDrag(0, 0).steps).toBe(0);
  });

  it("forgives a drag that strays from the axis", () => {
    expect(stretchFromDrag(64 * 3 + 9, 32 * 3 - 11)).toEqual({ axis: "se", steps: 3 });
  });
});

/* ── The game's own tilesets, where they are installed ── */

const TILESET_DIR = join(import.meta.dirname, "..", "public", "tileset");
const installed = TILESET_FILENAMES.filter((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)) && existsSync(join(TILESET_DIR, `${n}.dddata.bin`)));
const haveNames = existsSync(join(TILESET_DIR, "stat_txt.tbl"));

function real(name: string) {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${name}.${ext}`)));
  const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
  const names = haveNames ? decodeTbl(new Uint8Array(readFileSync(join(TILESET_DIR, "stat_txt.tbl")))) : null;
  return { tileset, catalogue: buildDoodadCatalogue(tileset, part("dddata.bin"), names) };
}

/** The share of the added cells' minitiles a unit can walk. */
function walkable(tileset: Tileset, g: { tiles: Uint16Array; added: Uint8Array }): number {
  let walk = 0, cells = 0;
  for (let i = 0; i < g.tiles.length; i++) {
    if (!g.added[i] || !g.tiles[i]) continue;
    cells++;
    const m = megatileForTile(tileset, g.tiles[i]);
    for (let q = 0; q < 16; q++) if (tileset.megatileFlags[m * 16 + q] & TileFlag.Walkable) walk += 1 / 16;
  }
  return cells ? walk / cells : 0;
}

describe.skipIf(installed.length === 0)("stretching the game's doodads", () => {
  it("keeps every doodad whole on every axis: the tiles it ships with are all still there", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const def of catalogue.doodads) {
        const shipped = new Map<number, number>();
        for (const id of def.tiles) if (id) shipped.set(id, (shipped.get(id) ?? 0) + 1);
        for (const axis of STRETCH_AXES) {
          const long = stretchDoodad(tileset, def, axis, 3);
          const { dx, dy } = STRETCH_STEP[axis];
          expect([long.width, long.height], `${name} #${def.id} ${axis}`).toEqual([def.width + dx * 3, def.height + Math.abs(dy) * 3]);
          const got = new Map<number, number>();
          for (const id of long.tiles) if (id) got.set(id, (got.get(id) ?? 0) + 1);
          for (const [id, n] of shipped) expect(got.get(id) ?? 0, `${name} #${def.id} ${axis} tile ${id}`).toBeGreaterThanOrEqual(n);
          // Nothing but the doodad's own tiles.
          for (const id of got.keys()) expect(shipped.has(id), `${name} #${def.id} ${axis} tile ${id}`).toBe(true);
          expect(isStretched(long) && long.stretched.from).toBe(def);
        }
      }
    }
  // Some two thousand doodads on four axes each: seconds, and more beside the rest of the suite.
  }, 60_000);

  it("offers a ramp one diagonal at most, and a cliff ramp widened along its own is ground a unit can walk", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const def of catalogue.doodads.filter((d) => d.ramp)) {
        const axes = soundAxes(tileset, def);
        // None for a ramp with no middle: two tiles wide and built into a wall, say.
        expect(axes.length, `${name} #${def.id}`).toBeLessThanOrEqual(1);
        for (const axis of axes) {
          expect(["se", "ne"], `${name} #${def.id}`).toContain(axis);
          expect(stretchPlan(tileset, def, axis).islandsPerStep, `${name} #${def.id}`).toBe(0);
        }
        if (!haveNames || def.category !== "Cliff") continue;
        expect(axes.length, `${name} #${def.id}`).toBe(1);
        // Not a minitile of rock on the slope, in any tileset: where the tile that repeats best
        // carries the tip of a wall, a clean one is borrowed.
        const plan = stretchPlan(tileset, def, axes[0]);
        expect(walkable(tileset, stretchPiece(def, plan, 4)), `${name} #${def.id}`).toBe(1);
        expect(plan.islandsPerStep, `${name} #${def.id}`).toBe(0);
      }
    }
  });

  it("counts the joins a stretch adds as the Seam Overlay draws them", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const def of catalogue.doodads.filter((d) => d.ramp || d.category === "Bridges")) {
        // The joins the doodad ships with, which a stretch is not charged for.
        const shipped = new Set<string>();
        for (let r = 0; r < def.height; r++) {
          for (let c = 0; c < def.width; c++) {
            const a = def.tiles[r * def.width + c];
            if (c + 1 < def.width) shipped.add(`${a},${def.tiles[r * def.width + c + 1]},h`);
            if (r + 1 < def.height) shipped.add(`${a},${def.tiles[(r + 1) * def.width + c]},v`);
          }
        }
        for (const axis of soundAxes(tileset, def)) {
          const plan = stretchPlan(tileset, def, axis);
          const g = stretchPiece(def, plan, 3);
          let shown = 0;
          for (let r = 0; r < g.height; r++) {
            for (let c = 0; c < g.width; c++) {
              const a = g.tiles[r * g.width + c];
              if (!a) continue;
              const right = c + 1 < g.width ? g.tiles[r * g.width + c + 1] : 0, below = r + 1 < g.height ? g.tiles[(r + 1) * g.width + c] : 0;
              if (right && !shipped.has(`${a},${right},h`) && seamStep(tileset, megatileForTile(tileset, a), "right", megatileForTile(tileset, right)) > SEAM_SHOWS) shown++;
              if (below && !shipped.has(`${a},${below},v`) && seamStep(tileset, megatileForTile(tileset, a), "bottom", megatileForTile(tileset, below)) > SEAM_SHOWS) shown++;
            }
          }
          expect(plan.shownPerStep * 3, `${name} #${def.id} ${axis}`).toBeCloseTo(shown, 6);
        }
      }
    }
  });

  it("offers the two Twilight ramps of a pair alike", () => {
    // By the edge difference alone one ramp of each Basilica pair got a cut that left a
    // lamp post on the slope and was not offered; its mirror image was.
    if (!installed.includes("twilight")) return;
    const { tileset, catalogue } = real("twilight");
    const mirrored = { se: "ne", ne: "se", e: "e", s: "s" } as const;
    let pairs = 0;
    for (const def of catalogue.doodads.filter((d) => d.ramp)) {
      const twin = doodadTwin(tileset, catalogue, def);
      if (!twin || twin === def) continue;
      pairs++;
      expect(soundAxes(tileset, twin), `#${def.id} and #${twin.id}`).toEqual(soundAxes(tileset, def).map((axis) => mirrored[axis]));
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it.skipIf(!haveNames)("lengthens a bridge along its deck without a seam the eye finds", () => {
    let bridges = 0;
    for (const name of installed) {
      // The bridges of these three are drawn to repeat; the others' are one-off pictures.
      if (!["badlands", "platform", "jungle"].includes(name)) continue;
      const { tileset, catalogue } = real(name);
      for (const def of catalogue.doodads.filter((d) => d.category === "Bridges")) {
        bridges++;
        // The diagonal that joins best is offered, and joins without a seam the eye finds.
        const [deck, across] = stretchPlan(tileset, def, "se").seam <= stretchPlan(tileset, def, "ne").seam ? (["se", "ne"] as const) : (["ne", "se"] as const);
        expect(soundAxes(tileset, def), `${name} #${def.id}`).toContain(deck);
        expect(stretchPlan(tileset, def, deck).seam, `${name} #${def.id}`).toBeLessThan(VISIBLE_SEAM);
        expect(stretchPlan(tileset, def, deck).islandsPerStep, `${name} #${def.id}`).toBe(0);
        // The other, where it is offered, leaves no wall end standing in the road either.
        if (soundAxes(tileset, def).includes(across)) expect(stretchPlan(tileset, def, across).islandsPerStep, `${name} #${def.id}`).toBe(0);
      }
    }
    if (installed.includes("badlands")) expect(bridges).toBeGreaterThan(0);
  });

  it.skipIf(!haveNames)("widens a bridge across its deck: rails where they were, more road between them", () => {
    // What the first cut of this could not do: across the deck the rails' ends were laid
    // again in place of the road, because the middle of the piece was measured square to the
    // axis on the tile grid, and a bridge is crossed along the other diagonal.
    for (const [name, wide] of [["badlands", 2], ["platform", 6], ["twilight", 2]] as const) {
      if (!installed.includes(name)) continue;
      const { tileset, catalogue } = real(name);
      const both = catalogue.doodads.filter((d) => d.category === "Bridges").filter((def) => {
        const axes = soundAxes(tileset, def);
        return axes.includes("se") && axes.includes("ne");
      });
      expect(both.length, name).toBe(wide);
      for (const def of both) {
        // Lengthways a step adds road and the rails beside it; across, more road than that.
        const road = (axis: "se" | "ne") => walkable(tileset, stretchPiece(def, stretchPlan(tileset, def, axis), 4));
        const [along, across] = road("se") <= road("ne") ? [road("se"), road("ne")] : [road("ne"), road("se")];
        expect(across, `${name} #${def.id}`).toBeGreaterThan(0.6);
        expect(across, `${name} #${def.id}`).toBeGreaterThan(along);
      }
    }
  });

  it.skipIf(!haveNames)("offers every bridge of every tileset a way to stretch", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      for (const def of catalogue.doodads.filter((d) => d.category === "Bridges")) expect(soundAxes(tileset, def).length, `${name} #${def.id}`).toBeGreaterThan(0);
    }
  });

  it("fits a stretched ramp wherever the cliff it was drawn for runs straight, and only along that cliff", () => {
    let checked = 0;
    for (const name of installed) {
      const era = TILESET_FILENAMES.indexOf(name);
      const { tileset, catalogue } = real(name);
      const info = TILESETS[era];
      const high = info.terrain.find((t) => /^High |Platform|Substructure|Temple/.test(t.name));
      if (!high) continue;
      // A plateau painted with the isometric brush: cliffs on both diagonals, straight for a dozen tiles.
      const W = 96, H = 64;
      const { tiles, isom } = flatTerrain(W, H, baseTerrain(tileset, info.defaultIsom), tileset, seeded(7), era);
      const scn = { width: W, height: H, era, tiles, editorTiles: tiles.slice(), isom, dirty: new Set<string>() } as unknown as Scenario & { isom: Uint16Array };
      if (!paintIsom(scn, tileset, { x: 24, y: 30 }, high.id, 13, seeded(3))) continue;
      for (const def of catalogue.doodads.filter((d) => d.ramp)) {
        const fits: Record<string, number> = { se: 0, ne: 0 };
        let places = 0;
        for (let y = 0; y + def.height <= H; y++) {
          for (let x = 0; x + def.width <= W; x += 2) {
            if (!checkDoodadPlacement(scn, tileset, def, x, y, DEFAULT_DOODAD_PLACEMENT).ok) continue;
            places++;
            for (const axis of ["se", "ne"] as const) {
              for (const steps of [2, -2]) {
                const long = stretchDoodad(tileset, def, axis, steps);
                if (checkDoodadPlacement(scn, tileset, long, x + long.stretched.offset.x, y + long.stretched.offset.y, DEFAULT_DOODAD_PLACEMENT).ok) fits[axis]++;
              }
            }
          }
        }
        if (places === 0) continue; // a ramp for another cliff than the one painted
        checked++;
        // The diagonal its ground carries on along is the one the cliff takes it on, and the only
        // one a ramp is ever offered.
        const along = (["se", "ne"] as const).filter((axis) => (stretchPlan(tileset, def, axis).groundContinues ?? 0) >= 0.7);
        expect(along.length, `${name} #${def.id}`).toBe(1);
        expect(fits[along[0]], `${name} #${def.id}`).toBeGreaterThan(places);
        expect(fits[along[0] === "se" ? "ne" : "se"], `${name} #${def.id}`).toBe(0);
        for (const axis of soundAxes(tileset, def)) expect(axis, `${name} #${def.id}`).toBe(along[0]);
      }
    }
    if (installed.includes("badlands")) expect(checked).toBeGreaterThan(0);
  });

  it("the seam overlay is quiet on painted ground and marks the joins of a stretched ramp", () => {
    if (!installed.includes("badlands")) return;
    const era = TILESET_FILENAMES.indexOf("badlands");
    const { tileset, catalogue } = real("badlands");
    const info = TILESETS[era];
    const W = 96, H = 64;
    const { tiles, isom } = flatTerrain(W, H, baseTerrain(tileset, info.defaultIsom), tileset, seeded(7), era);
    const scn = { width: W, height: H, era, tiles, editorTiles: tiles.slice(), isom, dirty: new Set<string>() } as unknown as Scenario & { isom: Uint16Array };
    paintIsom(scn, tileset, { x: 24, y: 30 }, info.terrain.find((t) => t.name === "High Dirt")!.id, 13, seeded(3));
    /** The share of the joins between two tiles of a grid that the overlay would draw. */
    const shown = (grid: ArrayLike<number>, width: number, height: number) => {
      let joins = 0, drawn = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const a = megatileForTile(tileset, grid[y * width + x]);
          if (a <= 0 || !grid[y * width + x]) continue;
          for (const [side, at] of [["right", x + 1 < width ? y * width + x + 1 : -1], ["bottom", y + 1 < height ? (y + 1) * width + x : -1]] as const) {
            if (at < 0 || !grid[at]) continue;
            joins++;
            if (seamStep(tileset, a, side, megatileForTile(tileset, grid[at])) > SEAM_SHOWS) drawn++;
          }
        }
      }
      return drawn / joins;
    };
    // Flat ground and a plateau with its cliffs, as the isometric brush lays them.
    expect(shown(scn.tiles, W, H)).toBeLessThan(0.02);
    const ramp = catalogue.doodads.find((d) => d.ramp && d.width === 6 && d.height === 6)!;
    const long = stretchDoodad(tileset, ramp, soundAxes(tileset, ramp)[0], 5);
    expect(shown(long.tiles, long.width, long.height)).toBeGreaterThan(0.05);
  });

  it("plans the largest doodad in well under a frame's worth of drags", () => {
    for (const name of installed) {
      const { tileset, catalogue } = real(name);
      const largest = catalogue.doodads.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
      const t0 = performance.now();
      for (const axis of STRETCH_AXES) stretchPlan(tileset, largest, axis);
      expect(performance.now() - t0, `${name} #${largest.id}`).toBeLessThan(500);
    }
  });
});
