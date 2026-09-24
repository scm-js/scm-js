/**
 * `docs/chk-format.md`, the CHK format reference: its generated blocks match the code,
 * every byte layout in `scripts/lib/chk-reference.mjs` adds up to the size the editor
 * reads, and the record and column layouts put each field where the encoders write it.
 * Its pictures and `docs/chk.ksy` are what their generators write. What the page says
 * about ISOM, STR, MASK and VCOD in real files is held to Blizzard's maps, and the ISOM
 * worked example and edge sets to the brush and the tilesets, when those are on disk.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as registry from "../src/formats/chk/sections/registry";
import * as create from "../src/formats/chk/create";
import * as scenario from "../src/formats/chk/scenario";
import * as objects from "../src/formats/chk/sections/objects";
import * as players from "../src/formats/chk/sections/players";
import * as cuwp from "../src/formats/chk/sections/cuwp";
import * as settings from "../src/formats/chk/sections/settings";
import * as dataPlayers from "../src/data/players";
import * as tilesets from "../src/data/tilesets";
import * as units from "../src/data/units";
import * as isomData from "../src/data/isomTables";
import * as strings from "../src/formats/chk/sections/strings";
import * as vcod from "../src/formats/chk/sections/vcod";
import * as textColors from "../src/editor/textColors";
import * as triggerDefs from "../src/data/triggerDefs";
import { loadMap } from "../src/formats/mpq/scm";
import { parseChk } from "../src/formats/chk/reader";
import { loadTileset } from "../src/formats/tileset/decode";
import { TILESET_FILENAMES } from "../src/formats/tileset/load";
import { isomTables, paintIsom } from "../src/editor/isom";
// @ts-expect-error — a plain .mjs module shared with scripts/reference-docs.mjs
import { fillReference, ISOM_EDGE_SETS, isomWordFlags, LAYOUTS, laidOut, layoutSize } from "../scripts/lib/chk-reference.mjs";
// @ts-expect-error — a plain .mjs module shared with scripts/reference-docs.mjs
import { chkDiagrams, ISOM_EXAMPLE, ISOM_SHAPE_NEIGHBOURS, isomExampleValues } from "../scripts/lib/chk-diagrams.mjs";
// @ts-expect-error — a plain .mjs module shared with scripts/reference-docs.mjs
import { chkKaitai } from "../scripts/lib/chk-kaitai.mjs";

interface Row { type: string; count: number; field?: string; offset: number; bytes: number }
interface Layout { rows?: Row[]; count?: number; grid?: string; isom?: boolean; strings?: string }

const doc = readFileSync(join(import.meta.dirname, "../docs/chk-format.md"), "utf8");
const defs = {
  ...registry, ...create, ...scenario, ...objects, ...players, ...cuwp, ...dataPlayers, ...tilesets,
  ...units, ...isomData, ...strings, ...vcod, ...textColors, ...settings,
};
const root = join(import.meta.dirname, "..");
const MAP_DIR = join(root, "fixtures", "maps");
const TILESET_DIR = join(root, "public", "tileset");
const maps = existsSync(MAP_DIR) ? readdirSync(MAP_DIR).filter((f) => /\.sc[mx]$/i.test(f)) : [];
const haveTilesets = TILESET_FILENAMES.every((n) => existsSync(join(TILESET_DIR, `${n}.cv5`)));
const layouts = LAYOUTS as Record<string, Layout>;
const WIDTH: Record<string, number> = { u8: 1, char: 1, u16: 2, u32: 4, i32: 4 };

function read(bytes: Uint8Array, at: number, type: string): number {
  let v = 0;
  for (let i = WIDTH[type] - 1; i >= 0; i--) v = v * 256 + bytes[at + i];
  return v;
}

/** Give every field of a record a distinct value, encode one, and find each value where the layout says. */
function checkRecord<T extends object>(name: string, blank: T, encode: (records: T[]) => Uint8Array) {
  const record = { ...blank } as Record<string, number>;
  const rows = laidOut(layouts[name].rows) as Row[];
  rows.forEach((r, i) => { if (r.field) record[r.field] = i + 1; });
  const bytes = encode([record as T]);
  for (const r of rows) if (r.field) expect(read(bytes, r.offset, r.type), `${name} ${r.field}`).toBe(record[r.field]);
}

/** Put a distinct value in the first entry of each column, encode, and find it at the column's offset. */
function checkColumns(name: string, model: Record<string, ArrayLike<number> & { [i: number]: number }>, encode: () => Uint8Array) {
  const rows = laidOut(layouts[name].rows) as Row[];
  rows.forEach((r, i) => { if (r.field) model[r.field][0] = i + 2; });
  const bytes = encode();
  for (const r of rows) if (r.field) expect(read(bytes, r.offset, r.type), `${name} ${r.field}`).toBe(model[r.field][0]);
}

describe("the CHK format reference", () => {
  it("is up to date with the code (npm run docs:reference)", () => {
    const { text, missing, unknown } = fillReference(doc, defs);
    expect(missing).toEqual([]);
    expect(unknown).toEqual([]);
    expect(text === doc).toBe(true);
  });

  it("has a layout for every section the editor knows, adding up to its size", () => {
    const dim = { width: 128, height: 96 };
    for (const spec of registry.SECTION_SPECS.values()) {
      const layout = layouts[spec.name.trimEnd()];
      expect(layout, spec.name).toBeDefined();
      const expected = registry.sizeOf(spec, dim);
      if (layout.isom) {
        expect((dim.width / 2 + 1) * (dim.height + 1) * layoutSize(layout.rows), spec.name).toBe(expected);
      } else if (layout.grid) {
        expect(dim.width * dim.height * WIDTH[layout.grid], spec.name).toBe(expected);
      } else if (layout.rows) {
        const size = layoutSize(layout.rows) * (layout.count ?? 1);
        expect(size, spec.name).toBe(spec.stride ?? expected);
      }
    }
  });

  it("puts each field of a record where the encoder writes it", () => {
    checkRecord("UNIT", objects.decodeUnits(new Uint8Array(36))[0], objects.encodeUnits);
    checkRecord("THG2", objects.decodeSprites(new Uint8Array(10))[0], objects.encodeSprites);
    checkRecord("DD2", objects.decodeDoodads(new Uint8Array(8))[0], objects.encodeDoodads);
    checkRecord("MRGN", objects.decodeLocations(new Uint8Array(20))[0], objects.encodeLocations);
    checkRecord("UPRP", cuwp.emptyCuwpSlot(), (slots) => cuwp.encodeCuwp(slots));
  });

  it("puts each column of the settings tables where the encoder writes it", () => {
    for (const [name, weapons] of [["UNIS", settings.WEAPONS_ORIGINAL], ["UNIx", settings.WEAPONS_BW]] as const) {
      const model = settings.defaultUnitSettings();
      checkColumns(name, model as never, () => settings.encodeUnitSettings(model, weapons));
    }
    for (const [name, count] of [["UPGS", settings.UPGRADES_ORIGINAL], ["UPGx", settings.UPGRADES_BW]] as const) {
      const model = settings.defaultUpgradeSettings();
      checkColumns(name, model as never, () => settings.encodeUpgradeSettings(model, count));
    }
    for (const [name, count] of [["TECS", settings.TECHS_ORIGINAL], ["TECx", settings.TECHS_BW]] as const) {
      const model = settings.defaultTechSettings();
      checkColumns(name, model as never, () => settings.encodeTechSettings(model, count));
    }
  });
});

describe("the files beside the CHK reference", () => {
  it("has pictures that are what chk-diagrams.mjs draws (npm run docs:reference)", () => {
    for (const [file, svg] of chkDiagrams()) {
      expect(existsSync(join(root, file)), file).toBe(true);
      expect(readFileSync(join(root, file), "utf8") === svg, file).toBe(true);
    }
  });

  it("has a chk.ksy that is what chk-kaitai.mjs writes, with a type for every section", () => {
    const ksy = chkKaitai({ ...defs, ...triggerDefs });
    expect(readFileSync(join(root, "docs/chk.ksy"), "utf8") === ksy).toBe(true);
    for (const spec of registry.SECTION_SPECS.values()) {
      expect(ksy, spec.name).toContain(`${JSON.stringify(JSON.stringify(spec.name))}: sec_`);
    }
  });
});

/** Diamond (x, y)'s value, read from its own rect's left word; null off the lattice. */
function diamondValue(isom: Uint16Array, w: number, h: number, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= w || y >= h) return null;
  return isom[(y * w + x) * 4] >> 4;
}

/** The rects and sides holding each quarter of a diamond: top-left, top-right, bottom-right, bottom-left. */
const QUARTER_WORDS: [number, number, number, number][] = [[-1, -1, 2, 3], [0, -1, 0, 3], [0, 0, 0, 1], [-1, 0, 1, 2]];

describe.skipIf(maps.length === 0)("the CHK reference against Blizzard's maps", () => {
  async function read(file: string) {
    const { chk } = await loadMap(new Uint8Array(readFileSync(join(MAP_DIR, file))));
    return { scn: scenario.parseScenario(chk), chk: parseChk(chk) };
  }

  it("stores each diamond's value eight times, with the flag bits the page gives or none", async () => {
    for (const file of maps) {
      const { scn } = await read(file);
      const isom = scn.isom!;
      const w = scn.width / 2 + 1, h = scn.height + 1;
      const { terrainTypes } = isomData.ISOM_TABLES[scenario.tilesetIndex(scn)];
      const half = Math.floor(terrainTypes.length / 2);
      const flat = new Set(terrainTypes.filter((t, i) => i > 0 && i <= half && t.isomValue).map((t) => t.isomValue));
      const flagless = new Set<number>();
      const wrong: string[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          for (let side = 0; side < 4; side++) {
            const word = isom[(y * w + x) * 4 + side];
            if (word & 0x8001) wrong.push(`rect (${x},${y}) side ${side}: scratch bits`);
            const flags = word & 0xf;
            if (flags === isomWordFlags(x, y, side)) continue;
            if (flags !== 0) wrong.push(`rect (${x},${y}) side ${side}: flags ${flags}`);
            flagless.add(word >> 4);
          }
          if ((x + y) % 2) continue;
          const copies = new Set<number>();
          for (const [dx, dy, a, b] of QUARTER_WORDS) {
            const rx = x + dx, ry = y + dy;
            if (rx < 0 || ry < 0 || rx >= w || ry >= h) continue;
            copies.add(isom[(ry * w + rx) * 4 + a] >> 4);
            copies.add(isom[(ry * w + rx) * 4 + b] >> 4);
          }
          if (copies.size !== 1) wrong.push(`diamond (${x},${y}): values ${[...copies]}`);
        }
      }
      expect(wrong.slice(0, 5), file).toEqual([]);
      // The words without flags are all one flat terrain: the ground the map started with.
      expect(flagless.size, file).toBeLessThanOrEqual(1);
      for (const v of flagless) expect(flat.has(v), `${file} value ${v}`).toBe(true);
    }
  });

  it("finds each edge shape's neighbours where the page says", async () => {
    let checked = 0;
    const wrong: string[] = [];
    for (const file of maps) {
      const { scn } = await read(file);
      const era = scenario.tilesetIndex(scn);
      const { terrainTypes } = isomData.ISOM_TABLES[era];
      const half = Math.floor(terrainTypes.length / 2);
      const sets = (ISOM_EDGE_SETS as Record<number, Record<number, [number, number]>>)[Math.min(era, 4)];
      const flatOf = (index: number) => isomData.isomValueOf(era, index);
      const flat = new Set(terrainTypes.filter((t, i) => i > 0 && i <= half && t.isomValue).map((t) => t.isomValue));
      const isom = scn.isom!;
      const w = scn.width / 2 + 1, h = scn.height + 1;
      for (let y = 0; y < h; y++) {
        for (let x = (y % 2); x < w; x += 2) {
          const v = diamondValue(isom, w, h, x, y)!;
          const set = terrainTypes.find((t, i) => i > half && t.isomValue && v >= t.isomValue && v < t.isomValue + 14);
          if (!set) continue;
          const [outside, inside] = sets[set.index];
          const claims = ISOM_SHAPE_NEIGHBOURS[v - set.isomValue] as (string | null)[];
          [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([dx, dy], i) => {
            const n = diamondValue(isom, w, h, x + dx, y + dy);
            if (claims[i] === null || n === null || !flat.has(n)) return;
            if (n !== flatOf(claims[i] === "O" ? outside : inside)) wrong.push(`${file} diamond (${x},${y}) value ${v}, neighbour ${i}: ${n}`);
            checked++;
          });
        }
      }
    }
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  it("finds StarEdit's string table, an all-unexplored MASK and StarEdit's VCOD", async () => {
    for (const file of maps) {
      const { chk } = await read(file);
      const str = chk.sections.find((s) => s.name === "STR ")!.data;
      const view = new DataView(str.buffer, str.byteOffset, str.byteLength);
      const count = view.getUint16(0, true);
      const header = 2 + 2 * count;
      expect(count, file).toBe(1024);
      expect(str[header], file).toBe(0);
      const offsets = Array.from({ length: count }, (_, i) => view.getUint16(2 + 2 * i, true));
      expect(Math.min(...offsets), file).toBe(header);
      for (const off of offsets) if (str[off] === 0) expect(off, file).toBe(header);
      const mask = chk.sections.find((s) => s.name === "MASK")!.data;
      expect(mask.every((b) => b === 0xff), file).toBe(true);
      expect(chk.sections.find((s) => s.name === "VCOD")!.data, file).toEqual(vcod.defaultVcod());
    }
  });
});

describe.skipIf(!haveTilesets)("the CHK reference against the tilesets", () => {
  function tileset(era: number) {
    const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `${TILESET_FILENAMES[era]}.${ext}`)));
    return loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
  }

  it("names each edge set's outside and inside terrains as the brush's tables do", () => {
    for (let era = 0; era < 8; era++) {
      const tables = isomTables(tileset(era), era);
      const half = Math.floor(tables.terrainTypes.length / 2);
      const byLink = (linkId: number) => tables.terrainTypes.find((t, i) => i > 0 && i <= half && t.isomValue && t.linkId === linkId)?.index;
      const found: Record<number, [number, number]> = {};
      tables.terrainTypes.forEach((t, i) => {
        if (i <= half || !t.isomValue) return;
        // The north-west edge: its top-left quarter is outside, its bottom-right inside.
        const row = tables.links[t.isomValue];
        found[t.index] = [byLink(row.quads[0].linkId)!, byLink(row.quads[2].linkId)!];
      });
      expect(found, TILESET_FILENAMES[era]).toEqual((ISOM_EDGE_SETS as Record<number, unknown>)[Math.min(era, 4)]);
    }
  });

  it("paints the worked example the way the page draws it", () => {
    const ex = ISOM_EXAMPLE;
    const w = ex.width / 2 + 1, h = ex.height + 1;
    const lattice = new Uint16Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let side = 0; side < 4; side++) {
      lattice[(y * w + x) * 4 + side] = (ex.outside << 4) | isomWordFlags(x, y, side);
    }
    const scn = create.createScenario({ width: ex.width, height: ex.height, era: ex.era, name: "Example", isom: lattice });
    const highDirt = isomData.ISOM_TABLES[ex.era].terrainTypes.find((t) => t.isomValue === ex.inside)!.index;
    expect(paintIsom(scn as never, tileset(ex.era), ex.centre, highDirt, 1)).not.toBeNull();
    const expected = isomExampleValues(ex) as Map<string, number>;
    for (const [key, value] of expected) {
      const [x, y] = key.split(",").map(Number);
      expect(diamondValue(scn.isom!, w, h, x, y), `diamond ${key}`).toBe(value);
    }
    // Every word the brush wrote carries the flag bits the page's table gives.
    const wrong: string[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let side = 0; side < 4; side++) {
      if ((scn.isom![(y * w + x) * 4 + side] & 0xf) !== isomWordFlags(x, y, side)) wrong.push(`rect (${x},${y}) side ${side}`);
    }
    expect(wrong).toEqual([]);
  });
});
