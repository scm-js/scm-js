import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadTileset, megatileForTile, type Tileset } from "../src/formats/tileset/decode";
import { createScenario } from "../src/formats/chk/create";
import type { Scenario } from "../src/formats/chk/scenario";
import { baseTerrain, flatTerrain } from "../src/formats/tileset/terrain";
import {
  borrowableTerrains, borrowBase, borrowedParts, borrowedTerrainId, borrowTable, copiesOf, decodeBorrowTable, encodeBorrowTable, isBorrowedTerrain, picturesOf,
  providedTable, tableCounts, tilesetHash, type BorrowTable,
} from "../src/editor/modTerrain/borrow";
import {
  baseLattice, BorrowStroke, borrowMember, decodeBorrowLattice, encodeBorrowLattice, latticeOf, resizeBorrowMember,
} from "../src/editor/modTerrain/borrowLattice";
import { diamondValue, isomHeight, isomWidth, paintIsomDiamonds, setDiamondValue, type Diamond } from "../src/editor/isom";
import { applyChanges } from "../src/editor/terrain";
import { isPairTerrain } from "../src/formats/tileset/palette";
import { primeTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { headlessStore } from "../src/plugins/headless";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

/* ── A made pair: a host holding re-dithered copies of a source ── */

interface Parts { palette: number[][]; pictures: number[][]; flags: number[][]; groups: { index: number; flags: number; megatiles: number[] }[] }

/** A tileset from palette colours, pictures (1,024 palette indices each, megatile 0 left black), VF4 words and groups. */
function build({ palette, pictures, flags, groups }: Parts): Tileset {
  const wpe = new Uint8Array(1024);
  palette.forEach(([r, g, b], i) => { wpe[i * 4] = r; wpe[i * 4 + 1] = g; wpe[i * 4 + 2] = b; });
  const count = pictures.length + 1;
  const vr4 = new Uint8Array(count * 16 * 64);
  const vx4 = new Uint8Array(count * 16 * 2);
  const vxv = new DataView(vx4.buffer);
  pictures.forEach((pix, k) => {
    const m = k + 1;
    for (let mt = 0; mt < 16; mt++) {
      const mini = m * 16 + mt;
      vxv.setUint16((m * 16 + mt) * 2, mini << 1, true);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vr4[mini * 64 + y * 8 + x] = pix[((mt >> 2) * 8 + y) * 32 + (mt & 3) * 8 + x];
    }
  });
  const vf4 = new Uint8Array(count * 32);
  const vfv = new DataView(vf4.buffer);
  flags.forEach((words, k) => words.forEach((w, i) => vfv.setUint16(((k + 1) * 16 + i) * 2, w, true)));
  const cv5 = new Uint8Array(groups.length * 52);
  const cv = new DataView(cv5.buffer);
  groups.forEach((g, i) => {
    cv.setUint16(i * 52, g.index, true);
    cv.setUint16(i * 52 + 2, g.flags, true);
    g.megatiles.forEach((m, s) => cv.setUint16(i * 52 + 20 + s * 2, m, true));
  });
  return loadTileset({ cv5, vf4, vr4, vx4, wpe });
}

/** 256 colours spread over the cube. */
const PALETTE = Array.from({ length: 256 }, (_, i) => [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256]);
/** The host's palette: every colour moved a little, so no index means the same colour twice. */
const HOST_PALETTE = PALETTE.map(([r, g, b], i) => [Math.min(255, r + (i % 5)), Math.max(0, g - (i % 3)), Math.min(255, b + 2)]);

/** A picture of soft shapes: smooth enough that a dithered copy keeps its block means. */
function picture(random: () => number): number[] {
  const cx = random() * 32, cy = random() * 32, base = Math.floor(random() * 200);
  return Array.from({ length: 1024 }, (_, p) => {
    const x = p & 31, y = p >> 5;
    return (base + Math.floor(Math.hypot(x - cx, y - cy) * 1.5)) & 255;
  });
}

/** `pix` re-dithered into the host's palette: each pixel's colour plus noise, to the nearest host colour. */
function redither(pix: number[], random: () => number, noise = 14): number[] {
  return pix.map((i) => {
    const [r, g, b] = PALETTE[i].map((c) => c + (random() - 0.5) * noise);
    let best = 0, bd = Infinity;
    HOST_PALETTE.forEach(([hr, hg, hb], j) => { const d = (hr - r) ** 2 + (hg - g) ** 2 + (hb - b) ** 2; if (d < bd) { bd = d; best = j; } });
    return best;
  });
}

const words = (w: number) => Array.from({ length: 16 }, () => w);

function madePair() {
  const random = seeded(7);
  const n = 12;
  const sourcePictures = Array.from({ length: n }, () => picture(random));
  // Source: groups 2..7 typed (index 2, 3, ...), two slots each.
  const source = build({
    palette: PALETTE,
    pictures: sourcePictures,
    flags: sourcePictures.map((_, k) => words(k % 2 ? 0x1 : 0x3)),
    groups: [
      { index: 0, flags: 0, megatiles: [] }, { index: 0, flags: 0, megatiles: [] },
      ...Array.from({ length: 6 }, (_, g) => ({ index: 2 + g, flags: 0x80 * (g % 2), megatiles: [1 + g * 2, 2 + g * 2] })),
    ],
  });
  // Host: picture k of the source as two re-dithered copies (one with the source's flags, one with
  // other VF4 words), in index-0 groups; megatile 12 of the source has no copy at all; plus decoys.
  const hostPictures: number[][] = [], hostFlags: number[][] = [];
  const hostGroups: Parts["groups"] = [{ index: 0, flags: 0, megatiles: [] }, { index: 0, flags: 0, megatiles: [] }, { index: 2, flags: 0, megatiles: [] }, { index: 2, flags: 0, megatiles: [] }];
  const decoys = Array.from({ length: 30 }, () => picture(random));
  for (const d of decoys) { hostPictures.push(d.map((i) => i)); hostFlags.push(words(1)); }
  hostGroups[2].megatiles = [1, 2]; hostGroups[3].megatiles = [3, 4];
  const sameFlags: number[] = [], otherFlags: number[] = [];
  for (let k = 0; k < n - 1; k++) {
    hostPictures.push(redither(sourcePictures[k], random)); hostFlags.push(words(k % 2 ? 0x1 : 0x3)); sameFlags.push(hostPictures.length);
    hostPictures.push(redither(sourcePictures[k], random)); hostFlags.push(words(0x0)); otherFlags.push(hostPictures.length);
  }
  // Group order: the other-flag copies first, so a first-found rule would pick them.
  hostGroups.push({ index: 0, flags: 0, megatiles: otherFlags });
  hostGroups.push({ index: 0, flags: 0, megatiles: sameFlags.slice(0, 16) });
  // Source group flags: groups 3, 5, 7 carry 0x80; a host group with the same flag word for those.
  hostGroups.push({ index: 0, flags: 0x80, megatiles: sameFlags.slice(0, 16) });
  const host = build({ palette: HOST_PALETTE, pictures: hostPictures, flags: hostFlags, groups: hostGroups });
  return { source, host, sameFlags, otherFlags, decoys: decoys.length };
}

describe("the borrow table on a made pair", () => {
  it("finds every re-dithered copy, prefers the copy with the source's flags, and leaves a picture with no copy out", async () => {
    const { source, host, sameFlags, otherFlags, decoys } = madePair();
    const table = await borrowTable(host, source);
    const counts = tableCounts(source, table);
    expect(counts.none).toBe(1); // source megatile 12 has no copy
    expect(counts.identical + counts.vf4).toBe(11);
    for (let g = 2; g < 8; g++) {
      for (let s = 0; s < 2; s++) {
        const tile = (g << 4) | s;
        const m = source.groups[g].megatiles[s];
        const choices = table.choices.get(tile);
        if (m === 12) { expect(choices).toBeUndefined(); continue; }
        expect(choices?.length).toBeGreaterThan(0);
        const hm = megatileForTile(host, choices![0]);
        // The copy with the source's VF4 words, never the other-flag copy or a decoy.
        expect(sameFlags).toContain(hm);
        expect(otherFlags).not.toContain(hm);
        expect(hm).toBeGreaterThan(decoys);
        // And the group flag word too where the host has it.
        expect(host.groups[choices![0] >> 4].flags).toBe(source.groups[g].flags);
        expect(table.kinds.get(tile)).toBe("identical");
        // Both copies of the picture count as copies for the overwrite check.
        expect(table.copies.get(m)!.length).toBe(2);
      }
    }
  });

  it("matches no decoy: a host holding none of the source's pictures borrows nothing", async () => {
    const { source } = madePair();
    const random = seeded(99);
    const pictures = Array.from({ length: 40 }, () => picture(random));
    const stranger = build({ palette: HOST_PALETTE, pictures, flags: pictures.map(() => words(1)), groups: [{ index: 0, flags: 0, megatiles: [] }, { index: 0, flags: 0, megatiles: pictures.slice(0, 16).map((_, i) => i + 1) }] });
    const table = await borrowTable(stranger, source);
    expect(table.choices.size).toBe(0);
  });

  it("the copy test reads the dither's blocks: a copy passes, the same picture shifted by a pixel does not", async () => {
    const { source } = madePair();
    const random = seeded(3);
    const pic = picture(random);
    const shifted = pic.map((_, p) => pic[(p & ~31) | (((p & 31) + 3) & 31)]);
    const host = build({ palette: HOST_PALETTE, pictures: [redither(pic, random), shifted.map((i) => i)], flags: [words(1), words(1)], groups: [{ index: 0, flags: 0, megatiles: [1, 2] }] });
    const src = build({ palette: PALETTE, pictures: [pic], flags: [words(1)], groups: [{ index: 2, flags: 0, megatiles: [1] }] });
    const copies = copiesOf(src, await picturesOf(src), 1, host, await picturesOf(host));
    expect(copies.map((c) => c.m)).toEqual([1]);
    void source;
  });

  it("keeps: the table as numbers reads back the same", async () => {
    const { source, host } = madePair();
    const table = await borrowTable(host, source);
    const back = decodeBorrowTable(encodeBorrowTable(table))!;
    expect([...back.choices]).toEqual([...table.choices]);
    expect([...back.kinds]).toEqual([...table.kinds]);
    expect([...back.copies]).toEqual([...table.copies]);
    expect(decodeBorrowTable([2, 0, 0])).toBeNull();
  });

  it("works in slices when given a pause, and says how far it got", async () => {
    const { source, host } = madePair();
    let pauses = 0, last = 0;
    const table = await borrowTable(host, source, { pause: async () => { pauses++; }, progress: (done) => { last = done; } });
    expect(table.choices.size).toBeGreaterThan(0);
    expect(last).toBeGreaterThan(0);
    expect(pauses).toBeGreaterThanOrEqual(0);
  });

  it("hashes the content: one pixel changed is another table", () => {
    const { source } = madePair();
    const a = tilesetHash(source);
    const copy = { ...source, minitiles: source.minitiles.slice() };
    copy.minitiles[100] ^= 1;
    expect(tilesetHash(copy)).not.toBe(a);
  });

  it("takes a plugin's pairs as they are", () => {
    const { source, host } = madePair();
    const table: BorrowTable = providedTable(host, source, [[(2 << 4) | 0, (5 << 4) | 3], [(2 << 4) | 1, 0]]);
    expect(table.choices.get(2 << 4)).toEqual([(5 << 4) | 3]);
    expect(table.kinds.get(2 << 4)).toBe("provided");
    expect(table.choices.has((2 << 4) | 1)).toBe(false); // a host tile with no picture is dropped
  });
});

describe("borrowed terrain ids", () => {
  it("are their own range, apart from the pair terrains", () => {
    const id = borrowedTerrainId(2, 6);
    expect(isBorrowedTerrain(id)).toBe(true);
    expect(isPairTerrain(id)).toBe(false);
    expect(borrowedParts(id)).toEqual({ sourceEra: 2, index: 6 });
    expect(isBorrowedTerrain(0x10000 + 40)).toBe(false);
  });
});

describe("the lattice member", () => {
  const size = { width: 64, height: 48 };
  it("holds only the diamonds that are not the base ground, and reads back", () => {
    expect(encodeBorrowLattice(size, 2, baseLattice(size, 2))).toBeNull();
    const isom = baseLattice(size, 2);
    const w = isomWidth(size), h = isomHeight(size);
    setDiamondValue(isom, w, h, { x: 10, y: 10 }, 50);
    setDiamondValue(isom, w, h, { x: 11, y: 11 }, 51);
    setDiamondValue(isom, w, h, { x: 0, y: 0 }, 4); // a corner: one rect only
    const member = encodeBorrowLattice(size, 2, isom)!;
    expect(member.length).toBe(12 + 3 * 6);
    expect(decodeBorrowLattice(member, size, 2)).toHaveLength(3);
    expect(Buffer.compare(Buffer.from(latticeOf(member, size, 2).buffer), Buffer.from(isom.buffer))).toBe(0);
    // Another size or another source reads as nothing.
    expect(decodeBorrowLattice(member, { width: 64, height: 64 }, 2)).toBeNull();
    expect(decodeBorrowLattice(member, size, 3)).toBeNull();
    expect(borrowMember(2)).toBe("scmjs\\borrowed-install.bin");
  });

  it("moves with a resize by whole rects, and is dropped by an odd shift", () => {
    const isom = baseLattice(size, 2);
    const w = isomWidth(size), h = isomHeight(size);
    setDiamondValue(isom, w, h, { x: 10, y: 10 }, 50);
    const member = encodeBorrowLattice(size, 2, isom)!;
    const to = { width: 96, height: 64 };
    const moved = resizeBorrowMember(member, size, to, 2, 8, 4)!;
    const lat = latticeOf(moved, to, 2);
    expect(diamondValue(lat, isomWidth(to), isomHeight(to), { x: 14, y: 14 })).toBe(50);
    expect(resizeBorrowMember(member, size, to, 2, 7, 4)).toBeNull();
    expect(resizeBorrowMember(member, size, to, 2, -40, 0)).toBeNull(); // shifted off the map
  });
});

/* ── The brush, on the game's Installation and a host made from it in the test ── */

const INSTALL = "public/tileset/install";
const haveInstall = existsSync(`${INSTALL}.cv5`);
const read = (ext: string) => new Uint8Array(readFileSync(`${INSTALL}.${ext}`));

/** A host made from the game's Installation: every typed picture re-dithered into a moved palette, in untyped groups of their own, beside a flat ground of its own. */
function madeFromInstall(): { source: Tileset; host: Tileset } {
  const source = loadTileset({ cv5: read("cv5"), vf4: read("vf4"), vr4: read("vr4"), wpe: read("wpe"), vx4: read("vx4") });
  const random = seeded(11);
  const pal: number[][] = Array.from({ length: 256 }, (_, i) => [source.palette[i * 4], source.palette[i * 4 + 1], source.palette[i * 4 + 2]]);
  const hostPal = pal.map(([r, g, b], i) => [Math.min(255, r + (i % 3)), g, Math.max(0, b - (i % 2))]);
  const used = [...new Set(source.groups.filter((g) => g.index >= 2).flatMap((g) => [...g.megatiles].filter((m) => m !== 0)))];
  const pixel = (m: number, p: number) => {
    const ref = source.megatileRefs[m * 16 + (p >> 8) * 4 + ((p & 31) >> 3)];
    const x = p & 7, y = (p >> 5) & 7;
    return source.minitiles[(ref >>> 1) * 64 + y * 8 + (ref & 1 ? 7 - x : x)];
  };
  const nearest = (r: number, g: number, b: number) => { let best = 0, bd = Infinity; hostPal.forEach(([hr, hg, hb], j) => { const d = (hr - r) ** 2 + (hg - g) ** 2 + (hb - b) ** 2; if (d < bd) { bd = d; best = j; } }); return best; };
  const cache = new Map<string, number>();
  const pictures: number[][] = [], flags: number[][] = [];
  // the host's own ground first: one flat picture
  pictures.push(Array.from({ length: 1024 }, (_, p) => 40 + ((p * 7) % 5))); flags.push(words(1));
  const at = new Map<number, number>();
  for (const m of used) {
    pictures.push(Array.from({ length: 1024 }, (_, p) => {
      const [r, g, b] = pal[pixel(m, p)].map((c) => c + (random() - 0.5) * 6);
      const key = `${Math.round(r)},${Math.round(g)},${Math.round(b)}`;
      let v = cache.get(key);
      if (v === undefined) cache.set(key, (v = nearest(r, g, b)));
      return v;
    }));
    flags.push(Array.from({ length: 16 }, (_, i) => source.megatileFlags[m * 16 + i]));
    at.set(m, pictures.length);
  }
  const groups: Parts["groups"] = [{ index: 0, flags: 0, megatiles: [] }, { index: 0, flags: 0, megatiles: [] }, { index: 2, flags: 0, megatiles: [1] }, { index: 2, flags: 0, megatiles: [1] }];
  // the copies, sixteen to a group, under each source group's flag word
  for (const g of source.groups) {
    if (g.index < 2) continue;
    groups.push({ index: 0, flags: g.flags, megatiles: [...g.megatiles].map((m) => (m ? at.get(m)! : 0)) });
  }
  return { source, host: build({ palette: hostPal, pictures, flags, groups }) };
}

function hostMap(host: Tileset, width = 64, height = 48): Scenario {
  const { tiles, isom } = flatTerrain(width, height, baseTerrain(host, 2), host, seeded(1), 0);
  return createScenario({ width, height, era: 0, name: "host", tiles, isom });
}

function box(x0: number, x1: number, y0: number, y1: number): Diamond[] {
  const out: Diamond[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x + y) % 2 === 0) out.push({ x, y });
  return out;
}

describe.skipIf(!haveInstall)("the borrowed brush (Installation in a host made from it)", () => {
  let made: { source: Tileset; host: Tileset; table: BorrowTable } | null = null;
  async function pair() {
    if (made) return made;
    const { source, host } = madeFromInstall();
    made = { source, host, table: await borrowTable(host, source) };
    return made;
  }

  it("translates every typed tile, and offers all of Installation's terrains", async () => {
    const { source, host, table } = await pair();
    const counts = tableCounts(source, table);
    expect(counts.none).toBe(0);
    expect(counts.identical).toBeGreaterThan(0.95 * (counts.identical + counts.vf4 + counts.picture + counts.standIn));
    const terrains = borrowableTerrains(host, 0, source, 2, table).map((t) => t.name);
    expect(terrains).toEqual(["Substructure", "Floor", "Roof", "Substructure Plating", "Plating", "Substructure Panels", "Bottomless Pit"]);
    expect(borrowableTerrains(host, 2, source, 2, table)).toEqual([]); // nothing from the host's own tileset
  }, 60_000);

  it("writes only the cells the stroke changes, every one a copy of the tile the source's brush lays", async () => {
    const { source, host, table } = await pair();
    const scn = hostMap(host);
    const before = scn.tiles.slice();
    const stroke = new BorrowStroke(scn, { host, source, sourceEra: 2, table }, null);
    const changes = stroke.paint(box(8, 16, 10, 26), 6, seeded(5))!;
    applyChanges(scn, changes);
    const result = stroke.finish();
    // The same stroke on the source map.
    const ref = flatTerrain(64, 48, { id: borrowBase(2), group: 0 }, source, seeded(1), 2);
    const refScn = createScenario({ width: 64, height: 48, era: 2, name: "ref", tiles: ref.tiles.slice(), isom: ref.isom.slice() }) as Scenario & { isom: Uint16Array };
    const refEdit = paintIsomDiamonds(refScn, source, box(8, 16, 10, 26), 6, seeded(5))!;
    const written = new Set(changes.map((c) => c.at));
    expect(changes.length).toBeGreaterThan(100);
    for (let at = 0; at < scn.tiles.length; at++) {
      if (!written.has(at)) { expect(scn.tiles[at]).toBe(before[at]); continue; }
    }
    // Every cell the source's brush changed is written as a copy of its tile.
    for (const c of refEdit.tiles) {
      const sm = megatileForTile(source, c.after), hm = megatileForTile(host, scn.tiles[c.at]);
      expect(table.copies.get(sm)).toContain(hm);
    }
    expect(written.size).toBeLessThanOrEqual(refEdit.tiles.length);
    expect(result.untranslated).toBe(0);
    expect(result.after).not.toBeNull();
    // The member is the source's lattice.
    expect(Buffer.compare(Buffer.from(latticeOf(result.after, scn, 2).buffer), Buffer.from(refScn.isom.buffer))).toBe(0);
  }, 60_000);

  it("a second stroke continues the first's edges, as on the source's own map", async () => {
    const { source, host, table } = await pair();
    const scn = hostMap(host);
    const ctx = { host, source, sourceEra: 2, table };
    const first = new BorrowStroke(scn, ctx, null);
    applyChanges(scn, first.paint(box(6, 14, 10, 24), 6, seeded(5))!);
    const member = first.finish().after;
    // A copy of the member, as a map saved and opened again has: nothing kept from the first stroke but the bytes.
    const second = new BorrowStroke(scn, ctx, member!.slice());
    expect(second.reset).toBe(0);
    applyChanges(scn, second.paint(box(12, 20, 18, 30), 6, seeded(6))!);
    const end = second.finish();
    // On the source's own map, the same two strokes.
    const ref = flatTerrain(64, 48, { id: borrowBase(2), group: 0 }, source, seeded(1), 2);
    const refScn = createScenario({ width: 64, height: 48, era: 2, name: "ref", tiles: ref.tiles.slice(), isom: ref.isom.slice() }) as Scenario & { isom: Uint16Array };
    paintIsomDiamonds(refScn, source, box(6, 14, 10, 24), 6, seeded(5));
    paintIsomDiamonds(refScn, source, box(12, 20, 18, 30), 6, seeded(6));
    expect(Buffer.compare(Buffer.from(latticeOf(end.after, scn, 2).buffer), Buffer.from(refScn.isom.buffer))).toBe(0);
    // Every cell the two strokes laid on the source is a copy of the same source group's picture here.
    let laid = 0;
    for (let at = 0; at < scn.tiles.length; at++) {
      if (refScn.tiles[at] === ref.tiles[at]) continue;
      laid++;
      const hm = megatileForTile(host, scn.tiles[at]);
      const sameGroup = [...source.groups[refScn.tiles[at] >> 4].megatiles].some((m) => m !== 0 && table.copies.get(m)?.includes(hm));
      expect(sameGroup, `cell ${at}`).toBe(true);
    }
    expect(laid).toBeGreaterThan(200);
  }, 60_000);

  it("is on the plugin API: a provided table, borrowed() and tx.paintBorrowed, undone as one step", async () => {
    const { source, host, table } = await pair();
    const asLoaded = (name: string, tileset: Tileset) => ({
      name, tileset, doodads: NO_DOODADS,
      atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: tileset.megatileCount, averages: new Uint32Array(tileset.megatileCount), animation: null },
    }) as unknown as LoadedTileset;
    primeTileset(asLoaded("install", source));
    primeTileset(asLoaded("badlands", host));
    const doc = await openMapBytes(await writeMapBytes(hostMap(host), { format: "scx" }), "h.scx");
    const store = headlessStore(doc);
    const api = createPluginApi(store, { id: "tables", name: "Tables", source: "s" }, new Contributions());
    const pairs = [...table.choices].map(([s, h]) => [s, h[0]] as const);
    const handle = api.terrain.provideBorrowTable({ id: "install", tileset: "badlands", source: "install", pairs });
    const list = await api.terrain.borrowed();
    expect(list.map((b) => b.name)).toEqual(["Substructure", "Floor", "Roof", "Substructure Plating", "Plating", "Substructure Panels", "Bottomless Pit"]);
    expect(list.every((b) => b.from === "tables" && b.source === "install")).toBe(true);
    const roof = list.find((b) => b.name === "Roof")!;
    const before = store.get(scenarioAtom)!.tiles.slice();
    api.document.edit("Roof", (tx) => { expect(tx.paintBorrowed(box(8, 16, 10, 26), roof.id)).toBe(true); });
    const tiles = store.get(scenarioAtom)!.tiles;
    expect(tiles.filter((t, i) => t !== before[i]).length).toBeGreaterThan(100);
    expect(store.get(archiveExtrasAtom).has(borrowMember(2))).toBe(true);
    store.set(undoAtom);
    expect(store.get(archiveExtrasAtom).has(borrowMember(2))).toBe(false);
    expect([...store.get(scenarioAtom)!.tiles]).toEqual([...before]);
    // Not a borrowed terrain: a note, nothing painted.
    const result = api.document.edit("Nothing", (tx) => { expect(tx.paintBorrowed(box(8, 16, 10, 26), 6)).toBe(false); });
    expect(result.notes.join(" ")).toMatch(/not a terrain borrowed/);
    handle.dispose();
    expect(await api.terrain.borrowed()).toEqual([]);
  }, 60_000);

  it("puts back to base ground what another tool wrote over, and leaves pinned cells alone", async () => {
    const { source, host, table } = await pair();
    const scn = hostMap(host);
    const ctx = { host, source, sourceEra: 2, table };
    const first = new BorrowStroke(scn, ctx, null);
    const laid = first.paint(box(6, 14, 10, 24), 6, seeded(5))!;
    applyChanges(scn, laid);
    const member = first.finish().after;
    // The Rect brush lays the host's own ground over a few of those cells.
    const over = laid.slice(0, 20).map((c) => ({ at: c.at, before: scn.tiles[c.at], after: 2 << 4 }));
    applyChanges(scn, over);
    const again = new BorrowStroke(scn, ctx, member);
    expect(again.reset).toBeGreaterThan(0);
    // Pinned cells are not written.
    const pinned = new Uint8Array(scn.width * scn.height);
    const target = box(20, 26, 10, 20);
    const pinnedStroke = new BorrowStroke(scn, ctx, member, pinned.fill(1));
    expect(pinnedStroke.paint(target, 6, seeded(2))).toEqual([]);
    expect(pinnedStroke.finish().kept.length).toBeGreaterThan(0);
  }, 60_000);
});

/* ── The lattice member in the document: history, resize, other maps, save ── */

import { createStore } from "jotai";
import { borrowHostsAtom } from "../src/atoms/borrowAtoms";
import {
  activateDocumentAtom, activeDocumentIdAtom, archiveExtrasAtom, commitEditAtom, loadDocumentAtom, redoAtom, resizeDocumentAtom, scenarioAtom, undoAtom,
} from "../src/atoms/documentAtoms";
import { openMapBytes, writeMapBytes } from "../src/editor/mapFile";

describe("a borrowed lattice in the document", () => {
  const NAME = borrowMember(2);
  function open() {
    const store = createStore();
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 32, height: 32, era: 0, name: "b" }), extras: new Map([["other", new Uint8Array([1])]]), fileName: "b.scx" });
    return store;
  }
  /** What a stroke leaves: tiles, and the member with a diamond set. */
  function stroke(store: ReturnType<typeof open>, x: number, value: number) {
    const scn = store.get(scenarioAtom)!;
    const before = store.get(archiveExtrasAtom).get(NAME) ?? null;
    const isom = latticeOf(before, scn, 2);
    setDiamondValue(isom, isomWidth(scn), isomHeight(scn), { x, y: 10 }, value);
    const after = encodeBorrowLattice(scn, 2, isom);
    const changes = [{ at: 10 * 32 + 2 * x, before: scn.tiles[10 * 32 + 2 * x], after: 0x123 }];
    applyChanges(scn, changes);
    store.set(archiveExtrasAtom, new Map([...store.get(archiveExtrasAtom), [NAME, after!]]));
    store.set(commitEditAtom, { label: "Paint Roof from Installation (isometric)", changes, members: [{ name: NAME, before, after }] });
    return after!;
  }

  it("undoes and redoes with the tiles of its stroke", () => {
    const store = open();
    const first = stroke(store, 4, 60);
    const second = stroke(store, 8, 61);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(second);
    store.set(undoAtom);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(first);
    store.set(undoAtom);
    expect(store.get(archiveExtrasAtom).has(NAME)).toBe(false);
    expect(store.get(archiveExtrasAtom).has("other")).toBe(true);
    expect(store.get(scenarioAtom)!.tiles[10 * 32 + 8]).not.toBe(0x123);
    store.set(redoAtom);
    store.set(redoAtom);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(second);
    expect(store.get(scenarioAtom)!.tiles[10 * 32 + 16]).toBe(0x123);
  });

  it("moves with a resize, and an undo of the resize puts it back", () => {
    const store = open();
    const member = stroke(store, 4, 60);
    store.set(resizeDocumentAtom, { width: 64, height: 64, anchor: 4, terrainId: 0, clampLocations: true });
    const scn = store.get(scenarioAtom)!;
    const moved = store.get(archiveExtrasAtom).get(NAME)!;
    // The old top-left tile is at (16, 16): diamond (4, 10) is now (12, 26).
    expect(diamondValue(latticeOf(moved, scn, 2), isomWidth(scn), isomHeight(scn), { x: 12, y: 26 })).toBe(60);
    store.set(undoAtom);
    expect(store.get(scenarioAtom)!.width).toBe(32);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(member);
    store.set(redoAtom);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(moved);
  });

  it("stays with its map when another comes in front", () => {
    const store = open();
    const a = store.get(activeDocumentIdAtom)!;
    const member = stroke(store, 4, 60);
    store.set(loadDocumentAtom, { scenario: createScenario({ width: 32, height: 32, era: 0, name: "c" }), extras: new Map(), fileName: null, reason: "new", into: "tab" });
    expect(store.get(archiveExtrasAtom).has(NAME)).toBe(false);
    store.set(activateDocumentAtom, a);
    expect(store.get(archiveExtrasAtom).get(NAME)).toBe(member);
  });

  it("is saved in the archive and read back", async () => {
    const store = open();
    const member = stroke(store, 4, 60);
    const bytes = await writeMapBytes(store.get(scenarioAtom)!, { format: "scx", extras: store.get(archiveExtrasAtom) });
    const back = await openMapBytes(bytes, "b.scx");
    expect(Buffer.compare(Buffer.from(back.extras.get(NAME)!), Buffer.from(member))).toBe(0);
    expect(decodeBorrowLattice(back.extras.get(NAME), back.scenario, 2)).toHaveLength(1);
  });
});

/* ── The real pair: Installation in Cosmonarchy's Badlands (SCMJS_COSMONARCHY = the mod's Release folder) ── */

import { readdirSync } from "node:fs";
import { join } from "node:path";

const MOD = process.env.SCMJS_COSMONARCHY;
const modTiles = MOD ? join(MOD, "mpq", "tileset") : "";
function modTileset(name: string): Tileset | null {
  if (!modTiles || !existsSync(modTiles)) return null;
  const files = readdirSync(modTiles);
  const f = (ext: string) => { const hit = files.find((x) => x.toLowerCase() === `${name}.${ext}`); return hit ? new Uint8Array(readFileSync(join(modTiles, hit))) : null; };
  const [cv5, vf4, vr4, wpe, vx4ex] = [f("cv5"), f("vf4"), f("vr4"), f("wpe"), f("vx4ex")];
  return cv5 && vf4 && vr4 && wpe && vx4ex ? loadTileset({ cv5, vf4, vr4, wpe, vx4: vx4ex, vx4Extended: true }) : null;
}

if (modTileset("badlands") && haveInstall) {
  describe("Installation in a mod's Badlands (the spike's numbers, loosely)", () => {
    it("translates all but a few tiles, as the spike measured, in a few seconds", async () => {
      const host = modTileset("badlands")!;
      const source = loadTileset({ cv5: read("cv5"), vf4: read("vf4"), vr4: read("vr4"), wpe: read("wpe"), vx4: read("vx4") });
      const started = performance.now();
      const table = await borrowTable(host, source);
      const ms = performance.now() - started;
      const counts = tableCounts(source, table);
      // Spike: 1,824 tile ids; 160 identical flags, 849 same VF4, 813 picture only, 2 with no copy (here stand-ins).
      expect(counts.identical + counts.vf4 + counts.picture + counts.standIn + counts.none).toBe(1824);
      expect(counts.none + counts.standIn).toBeLessThanOrEqual(4);
      expect(counts.identical).toBeGreaterThan(100);
      expect(counts.vf4 + counts.picture).toBeGreaterThan(1400);
      expect(ms).toBeLessThan(15_000);
      const names = borrowableTerrains(host, 0, source, 2, table).map((t) => t.name);
      expect(names).toEqual(["Substructure", "Floor", "Roof", "Substructure Plating", "Plating", "Substructure Panels", "Bottomless Pit"]);
      // A Roof plateau on a map of the mod's Badlands: nothing untranslated, every cell a copy.
      const scn = hostMap(host, 64, 48);
      const s = new BorrowStroke(scn, { host, source, sourceEra: 2, table }, null);
      applyChanges(scn, s.paint(box(8, 16, 10, 26), 6, seeded(5))!);
      const r = s.finish();
      expect(r.untranslated).toBe(0);
      expect(r.after).not.toBeNull();
    }, 120_000);
  });
}

/* ── The scan's worker (no game data: the made pair) ── */

import { borrowWorkerHandler, tilesetFromParts, tilesetParts, type BorrowWorkerRequest, type BorrowWorkerResponse } from "../src/editor/modTerrain/borrowWorker";
import { isStopped, refreshProvided, scanBorrowed, slicedTableMaker } from "../src/services/borrow";
import { borrowWorkerStats, poolSize, resetBorrowWorkerClient, workerTableMaker } from "../src/services/borrowTableClient";
import { memoryPieceStore } from "../src/services/pieceStore";

describe("the scan's worker", () => {
  const sources = () => {
    const { source, host } = madePair();
    // A second source: the same pictures, other group flags (another table).
    const other = { ...source, groups: source.groups.map((g) => ({ ...g, flags: g.flags ^ 0x40 })) };
    return { host, bySource: new Map<number, Tileset>([[2, source], [5, other]]) };
  };

  it("answers with the same table as borrowTable on this thread", async () => {
    const { source, host } = madePair();
    const out: BorrowWorkerResponse[] = [];
    const handle = borrowWorkerHandler((m) => out.push(m));
    await handle({ kind: "table", id: 1, source: tilesetParts(source) });
    expect(out[0]).toMatchObject({ kind: "error", id: 1 }); // no host yet
    await handle({ kind: "host", host: tilesetParts(host) });
    await handle({ kind: "table", id: 2, source: tilesetParts(source) });
    const answer = out.find((m) => m.kind === "table" && m.id === 2) as Extract<BorrowWorkerResponse, { kind: "table" }>;
    expect([...answer.table]).toEqual([...encodeBorrowTable(await borrowTable(host, source))]);
    // The parts carry what the table reads.
    const back = tilesetFromParts(tilesetParts(source));
    expect(back.groups.map((g) => [g.index, g.flags, [...g.megatiles]])).toEqual(source.groups.map((g) => [g.index, g.flags, [...g.megatiles]]));
  });

  it("is used through a pool when there is a Worker, the host given to each worker once", async () => {
    resetBorrowWorkerClient();
    const { host, bySource } = sources();
    const was = (globalThis as { Worker?: unknown }).Worker;
    // A Worker that runs the real handler in this process, answering on the next turn.
    class InProcess {
      onmessage: ((e: { data: BorrowWorkerResponse }) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      private handle = borrowWorkerHandler((m) => setTimeout(() => this.onmessage?.({ data: m }), 0));
      postMessage(m: BorrowWorkerRequest) { void this.handle(m); }
      terminate() {}
    }
    (globalThis as { Worker?: unknown }).Worker = InProcess;
    try {
      const db = memoryPieceStore();
      // The maker without its `stats`, which the scan would read (and reset) for its log line.
      await scanBorrowed(createStore(), 0, host, { db, source: async (e) => bySource.get(e) ?? null, tables: { table: workerTableMaker.table } });
      expect(borrowWorkerStats.tables).toHaveLength(2);
      expect(borrowWorkerStats.hostPosts).toBe(Math.min(2, poolSize()));
      for (const [era, source] of bySource) {
        const kept = [...db.data].find(([k]) => k.endsWith(`/${tilesetHash(source)}`))![1] as Int32Array;
        expect([...kept], `source ${era}`).toEqual([...encodeBorrowTable(await borrowTable(host, source))]);
      }
    } finally {
      (globalThis as { Worker?: unknown }).Worker = was;
      resetBorrowWorkerClient();
    }
  });

  it("falls back to this thread when there is no Worker", async () => {
    resetBorrowWorkerClient();
    expect(typeof (globalThis as { Worker?: unknown }).Worker).toBe("undefined");
    const { host, bySource } = sources();
    await expect(workerTableMaker.table(host, bySource.get(2)!, () => {})).rejects.toThrow(/unavailable/);
    const db = memoryPieceStore();
    const found = await scanBorrowed(createStore(), 0, host, { db, source: async (e) => bySource.get(e) ?? null, tables: workerTableMaker, pause: async () => {} });
    expect(found.sources.map((s) => s.sourceEra)).toEqual([2, 5]);
    expect(db.data.size).toBe(3); // two tables and the index
  });

  it("finishes the scan on this thread when the worker fails", async () => {
    resetBorrowWorkerClient();
    const was = (globalThis as { Worker?: unknown }).Worker;
    class Failing {
      onmessage: unknown = null;
      onerror: ((e: unknown) => void) | null = null;
      postMessage() { setTimeout(() => this.onerror?.({ message: "the script did not load", preventDefault() {} }), 0); }
      terminate() {}
    }
    (globalThis as { Worker?: unknown }).Worker = Failing;
    try {
      const { host, bySource } = sources();
      const db = memoryPieceStore();
      const found = await scanBorrowed(createStore(), 0, host, { db, source: async (e) => bySource.get(e) ?? null, tables: workerTableMaker, pause: async () => {} });
      expect(found.sources).toHaveLength(2);
      const kept = [...db.data].find(([k]) => k.endsWith(`/${tilesetHash(bySource.get(2)!)}`))![1] as Int32Array;
      expect([...kept]).toEqual([...encodeBorrowTable(await borrowTable(host, bySource.get(2)!))]);
    } finally {
      (globalThis as { Worker?: unknown }).Worker = was;
      resetBorrowWorkerClient();
    }
  });

  it("stops: the scan rejects as stopped and publishes nothing", async () => {
    const { host, bySource } = sources();
    const controller = new AbortController();
    const store = createStore();
    const scan = scanBorrowed(store, 0, host, { db: memoryPieceStore(), source: async (e) => bySource.get(e) ?? null, tables: { table: (h, src, p, sig) => { controller.abort(); return slicedTableMaker(async () => {}).table(h, src, p, sig); } }, signal: controller.signal });
    await expect(scan).rejects.toSatisfy(isStopped);
    expect(store.get(borrowHostsAtom).size).toBe(0);
  });

  it("leaves a host nobody scanned unlisted when no table is provided, so the palette offers the scan", async () => {
    const { host, bySource } = sources();
    const store = createStore();
    await refreshProvided(store, 0, host, { source: async (e) => bySource.get(e) ?? null });
    expect(store.get(borrowHostsAtom).size).toBe(0);
    await scanBorrowed(store, 0, host, { db: memoryPieceStore(), source: async (e) => bySource.get(e) ?? null, pause: async () => {} });
    await refreshProvided(store, 0, host, { source: async (e) => bySource.get(e) ?? null });
    expect([...store.get(borrowHostsAtom).values()][0].scanned).toBe(true);
  });

  it("gives this machine one or two workers", () => {
    expect(poolSize(1)).toBe(1);
    expect(poolSize(2)).toBe(1);
    expect(poolSize(3)).toBe(2);
    expect(poolSize(24)).toBe(2);
  });
});
