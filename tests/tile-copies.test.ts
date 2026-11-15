import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadTileset, type Cv5Group, type Tileset } from "../src/formats/tileset/decode";
import { collapsePieces, COPY_BLOCK_MEAN, pictureKey, samePicture, sameTileKey, uniqueTiles } from "../src/editor/tileCopies";
import { cutPieces, emptyEvidence, gatherEvidence, type Piece } from "../src/editor/pieces";
import { openMapBytes } from "../src/editor/mapFile";
import { addedGroupsFrom } from "../src/data/remasteredTiles";

type Picture = (x: number, y: number) => number;

/**
 * A tileset of made megatiles: `pictures[m]` gives megatile m + 1's palette index at each pixel
 * (a grey ramp palette, so index = brightness), `walk[m]` whether its minitiles walk. Groups
 * list megatile numbers per slot; `unbuildable` groups carry the CV5 unbuildable bit.
 */
function madeTileset(pictures: Picture[], walk: boolean[], groups: number[][], unbuildable: number[] = []): Tileset {
  const count = pictures.length + 1;
  const minitiles = new Uint8Array(count * 16 * 64);
  const refs = new Uint32Array(count * 16);
  const flags = new Uint16Array(count * 16);
  pictures.forEach((pic, i) => {
    const m = i + 1;
    for (let k = 0; k < 16; k++) {
      const mini = m * 16 + k;
      refs[m * 16 + k] = mini << 1;
      flags[m * 16 + k] = walk[i] ? 1 : 0;
      for (let p = 0; p < 64; p++) minitiles[mini * 64 + p] = pic((k % 4) * 8 + (p % 8), Math.floor(k / 4) * 8 + Math.floor(p / 8));
    }
  });
  const palette = new Uint8Array(1024);
  for (let i = 0; i < 256; i++) palette.set([i, i, i, 255], i * 4);
  const cv5 = groups.map((slots, g) => ({
    index: 0,
    flags: unbuildable.includes(g) ? 0x80 : 0,
    megatiles: Uint16Array.from({ length: 16 }, (_, s) => slots[s] ?? 0),
  })) as unknown as Cv5Group[];
  return { palette, minitiles, megatileRefs: refs, megatileCount: count, extended: false, megatileFlags: flags, groups: cv5 };
}

const id = (group: number, slot: number) => (group << 4) | slot;
const ramp: Picture = (x, y) => 40 + x * 3 + y;
/** The ramp re-dithered: ±2 on alternate pixels. */
const dithered: Picture = (x, y) => ramp(x, y) + ((x + y) % 2 ? 2 : -2);
/** The ramp with a small detail: a 6 × 6 patch 60 brighter. */
const detail: Picture = (x, y) => ramp(x, y) + (x >= 10 && x < 16 && y >= 10 && y < 16 ? 60 : 0);
const other: Picture = (x, y) => 200 - x;

describe("the same tile", () => {
  // Megatiles: 1 ramp, 2 ramp again, 3 ramp not walkable, 4 dithered ramp, 5 ramp with a detail, 6 other.
  const ts = madeTileset([ramp, ramp, ramp, dithered, detail, other], [true, true, false, true, true, true], [[1], [2], [3], [4], [5], [6], [1], [2]], [7]);

  it("is the same picture and the same flags; the lowest id is kept", () => {
    expect(pictureKey(ts, id(0, 0))).toBe(pictureKey(ts, id(1, 0)));
    expect(sameTileKey(ts, id(0, 0))).toBe(sameTileKey(ts, id(1, 0)));
    expect(uniqueTiles(ts, [id(1, 0), id(0, 0), id(5, 0)])).toEqual([id(0, 0), id(5, 0)]);
  });

  it("is not the same picture under other flags: walkability, or the group's buildable bit", () => {
    expect(pictureKey(ts, id(2, 0))).toBe(pictureKey(ts, id(0, 0)));
    expect(uniqueTiles(ts, [id(0, 0), id(2, 0)])).toEqual([id(0, 0), id(2, 0)]);
    expect(uniqueTiles(ts, [id(6, 0), id(7, 0)])).toEqual([id(6, 0), id(7, 0)]);
  });

  it("leaves out what the game's part already has, for the Added by filter", () => {
    const game = new Set([sameTileKey(ts, id(0, 0))]);
    expect(uniqueTiles(ts, [id(1, 0), id(5, 0)], game)).toEqual([id(5, 0)]);
  });

  it("takes a re-dithered copy as the same picture, and not one with a small detail of its own", () => {
    expect(pictureKey(ts, id(3, 0))).not.toBe(pictureKey(ts, id(0, 0)));
    expect(samePicture(ts, 1, 4)).toBe(true);
    expect(samePicture(ts, 1, 5)).toBe(false);
    // A mean over the whole tile would have let the detail through: it moves the tile's mean less than the bound.
    expect((60 * 36) / 1024).toBeLessThan(COPY_BLOCK_MEAN);
    expect(samePicture(ts, 1, 6)).toBe(false);
  });
});

describe("pieces that are the same tiles", () => {
  // Groups 0–1: a 2 × 1 piece of ramp + other; 2–3 the same; 4 its re-dithered copy; 5 with a detail; 6 not walkable.
  const ts = madeTileset([ramp, other, dithered, detail], [true, true, true, true], [[1, 2], [1, 2], [3, 2], [4, 2], [1, 2]]);
  const unwalk = madeTileset([ramp, other, ramp, other], [true, true, false, false], [[1, 2], [3, 4]]);
  const piece = (group: number, laid: number): Piece => ({ tiles: [id(group, 0), id(group, 1)], slot: 0, group, cols: 2, rows: 1, laid });

  it("fold into one entry, the most laid kept, exact and re-dithered copies alike", () => {
    const entries = collapsePieces(ts, [piece(0, 4), piece(1, 10), piece(2, 3), piece(3, 2)]);
    expect(entries.map((e) => e.piece.group)).toEqual([1, 3]);
    expect(entries[0].copies.map((p) => p.group).sort()).toEqual([0, 2]);
  });

  it("keeps the lowest first tile on a tie", () => {
    expect(collapsePieces(ts, [piece(1, 5), piece(0, 5)])[0].piece.group).toBe(0);
  });

  it("keep a copy under other flags as an entry of its own, after the one it copies, saying what differs", () => {
    const entries = collapsePieces(unwalk, [piece(1, 1), piece(0, 9)]);
    expect(entries.map((e) => e.piece.group)).toEqual([0, 1]);
    expect(entries[1].copyOf).toEqual({ piece: entries[0].piece, differs: ["walkable"] });
  });

  it("do not join pieces of another outline", () => {
    const tall: Piece = { tiles: [id(0, 0), id(1, 0)], slot: 0, group: 0, cols: 1, rows: 2, laid: 1 };
    expect(collapsePieces(ts, [piece(0, 1), tall])).toHaveLength(2);
  });
});

/* ── A mod's Badlands, where one is at hand ─────────────── */

const modRoot = process.env.SCMJS_COSMONARCHY ?? "";
const modMaps = process.env.SCMJS_COSMONARCHY_MAPS ?? "";
const haveMod = modRoot !== "" && existsSync(join(modRoot, "mpq/tileset"));

describe.skipIf(!haveMod)("the same tile in a mod's Badlands", () => {
  const dir = join(modRoot, "mpq/tileset");
  const read = (ext: string) => {
    const f = readdirSync(dir).find((n) => n.toLowerCase() === `badlands.${ext}`);
    return f ? new Uint8Array(readFileSync(join(dir, f))) : null;
  };
  const load = () => {
    const vx4ex = read("vx4ex");
    return loadTileset({ cv5: read("cv5")!, vf4: read("vf4")!, vr4: read("vr4")!, vx4: vx4ex ?? read("vx4")!, vx4Extended: vx4ex !== null, wpe: read("wpe")! });
  };

  it("lists far fewer tiles in the Grid, and fewer added ones once the game's are taken out", () => {
    const ts = load();
    const ids: number[] = [];
    ts.groups.forEach((g, group) => { if (g.index !== 1) for (let s = 0; s < 16; s++) if (g.megatiles[s] !== 0 && g.megatiles[s] < ts.megatileCount) ids.push(id(group, s)); });
    const unique = uniqueTiles(ts, ids);
    const from = addedGroupsFrom(0, ts.groups.length)!;
    const game = new Set(ids.filter((t) => t >> 4 < from).map((t) => sameTileKey(ts, t)));
    const added = ids.filter((t) => t >> 4 >= from);
    const addedUnique = uniqueTiles(ts, added, game);
    console.log(`Grid, ground groups: ${ids.length} tiles → ${unique.length}; added ${added.length} → ${addedUnique.length}`);
    // Measured 2026-11-13: of 38,328 ground megatiles 6,923 repeat another's picture and flags; the Grid's
    // "All groups" (doodads included) goes from 41,354 tiles to 32,860, the added ones from 29,848 to 24,235.
    expect(ids.length - unique.length).toBeGreaterThan(3000);
    expect(addedUnique.length).toBeLessThan(added.length);
  }, 120_000);

  it.skipIf(modMaps === "" || !existsSync(modMaps))("folds the pieces its maps lay that are copies of each other", async () => {
    const ts = load();
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.sc[xm]$/i.test(f)) files.push(p);
      }
    };
    walk(modMaps);
    const evidence = emptyEvidence();
    for (const file of files) {
      try {
        const { scenario } = await openMapBytes(new Uint8Array(readFileSync(file)), file);
        if ((scenario.era & 7) === 0) gatherEvidence(evidence, scenario.tiles, scenario.width, scenario.height, ts);
      } catch { /* a map that does not open is not counted */ }
    }
    const pieces = cutPieces(evidence);
    const started = performance.now();
    const entries = collapsePieces(ts, pieces);
    const ms = Math.round(performance.now() - started);
    const folded = entries.reduce((n, e) => n + e.copies.length, 0);
    const flagCopies = entries.filter((e) => e.copyOf).length;
    console.log(`Pieces: ${pieces.length} → ${entries.length} entries; ${folded} folded as copies, ${flagCopies} listed as the same picture under other flags; ${ms} ms`);
    // Measured 2026-11-13 on 57 maps: 3,525 pieces; 95 fold as exact copies with the same flags, 153 with the
    // re-dithered ones (248 pieces have such a copy); 148 are the same picture under other flags.
    expect(folded).toBeGreaterThanOrEqual(95);
    expect(folded).toBeLessThan(600);
    expect(flagCopies).toBeGreaterThan(50);
  }, 300_000);
});
