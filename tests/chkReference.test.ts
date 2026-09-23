/**
 * `docs/chk-format.md`, the CHK format reference: its generated blocks match the code,
 * every byte layout in `scripts/lib/chk-reference.mjs` adds up to the size the editor
 * reads, and the record and column layouts put each field where the encoders write it.
 */
import { readFileSync } from "node:fs";
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
// @ts-expect-error — a plain .mjs module shared with scripts/reference-docs.mjs
import { fillReference, LAYOUTS, laidOut, layoutSize } from "../scripts/lib/chk-reference.mjs";

interface Row { type: string; count: number; field?: string; offset: number; bytes: number }
interface Layout { rows?: Row[]; count?: number; grid?: string; isom?: boolean; strings?: string }

const doc = readFileSync(join(import.meta.dirname, "../docs/chk-format.md"), "utf8");
const defs = { ...registry, ...create, ...scenario, ...objects, ...players, ...cuwp, ...dataPlayers, ...tilesets };
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
      if (layout.rows) {
        const size = layoutSize(layout.rows) * (layout.count ?? 1);
        expect(size, spec.name).toBe(spec.stride ?? expected);
      } else if (layout.grid) {
        expect(dim.width * dim.height * WIDTH[layout.grid], spec.name).toBe(expected);
      } else if (layout.isom) {
        expect((dim.width / 2 + 1) * (dim.height + 1) * 8, spec.name).toBe(expected);
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
