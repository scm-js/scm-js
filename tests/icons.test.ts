import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeTechdataDat, decodeUpgradesDat } from "../src/formats/dat/dat";
import { decodeGrp, type Grp } from "../src/formats/dat/grp";
import { decodePcx } from "../src/formats/dat/pcx";
import { decodePalette } from "../src/formats/tileset/decode";
import { iconFrame, isBlank, paintIcon } from "../src/formats/units/icons";

const PUBLIC = join(import.meta.dirname, "..", "public");
const read = (rel: string) => new Uint8Array(readFileSync(join(PUBLIC, rel)));
const have = ["unit/cmdbtns/cmdicons.grp", "unit/cmdbtns/ticon.pcx", "arr/upgrades.dat", "arr/techdata.dat", "tileset/badlands.wpe"].every((f) => existsSync(join(PUBLIC, f)));

/** A sheet of three frames in a 4 × 2 box: a picture, the BLANK placeholder's shape, a picture. No pixels are read but frame 0's. */
function sheet(): Grp {
  const frames = [
    { x: 0, y: 0, width: 2, height: 1, offset: 30 },
    { x: 0, y: 0, width: 30, height: 14, offset: 0 },
    { x: 1, y: 1, width: 3, height: 1, offset: 0 },
  ];
  // Frame 0: one line at 30 — its table (u16 2), then literal 2 pixels: 1, 2.
  const data = new Uint8Array(40);
  data.set([2, 0, 0x02, 1, 2], 30);
  return { width: 4, height: 2, frames, data };
}
const tables = (upgradeIcons: number[], techIcons: number[]) => ({
  upgrades: { icon: Uint16Array.from(upgradeIcons) } as never,
  techs: { icon: Uint16Array.from(techIcons) } as never,
});

describe("command card icons", () => {
  it("pictures a unit by its own frame, an upgrade or technology by its table's", () => {
    const grp = sheet();
    const t = tables([2, 0], [2]);
    expect(iconFrame(grp, "unit", 0, t)).toBe(0);
    expect(iconFrame(grp, "upgrade", 0, t)).toBe(2);
    expect(iconFrame(grp, "tech", 0, t)).toBe(2);
  });

  it("has none for BLANK, for ids past the table or the sheet, and for an upgrade left at frame 0", () => {
    const grp = sheet();
    const t = tables([2, 0], [2]);
    expect(isBlank(grp, 1)).toBe(true);
    expect(iconFrame(grp, "unit", 1, t)).toBe(-1);
    expect(iconFrame(grp, "unit", 228, t)).toBe(-1);
    expect(iconFrame(grp, "unit", 5, t)).toBe(-1);
    expect(iconFrame(grp, "upgrade", 1, t)).toBe(-1);
    expect(iconFrame(grp, "upgrade", 9, t)).toBe(-1);
    expect(iconFrame(grp, "tech", 0, { upgrades: null, techs: null })).toBe(-1);
  });

  it("paints through a look's sixteen colours", () => {
    const grp = sheet();
    const colours = new Uint8Array(96);
    colours.set([0, 10, 20], 0); // normal
    colours.set([0, 30, 40], 16); // disabled
    const palette = new Uint8Array(1024);
    for (let i = 0; i < 256; i++) palette.set([i, 0, 0, 255], i * 4);
    const normal = paintIcon(grp, 0, colours, palette);
    expect([normal.width, normal.height]).toEqual([4, 2]);
    expect([normal.pixels[0], normal.pixels[4], normal.pixels[8 + 3]]).toEqual([10, 20, 0]);
    const disabled = paintIcon(grp, 0, colours, palette, "disabled");
    expect([disabled.pixels[0], disabled.pixels[4]]).toEqual([30, 40]);
  });
});

describe.skipIf(!have)("the game's icon sheet (public/unit/cmdbtns)", () => {
  const load = () => ({
    grp: decodeGrp(read("unit/cmdbtns/cmdicons.grp")),
    colours: decodePcx(read("unit/cmdbtns/ticon.pcx")).pixels,
    palette: decodePalette(read("tileset/badlands.wpe")),
    tables: { upgrades: decodeUpgradesDat(read("arr/upgrades.dat")), techs: decodeTechdataDat(read("arr/techdata.dat")) },
  });

  it("is a sheet of 36 × 34 buttons, six looks of colour", () => {
    const { grp, colours } = load();
    expect([grp.width, grp.height]).toEqual([36, 34]);
    expect(grp.frames.length).toBeGreaterThan(380);
    expect(colours.length).toBe(96);
  });

  it("has a picture for the units a player makes, and none for a turret", () => {
    const { grp, tables } = load();
    for (const unit of [0, 7, 37, 41, 64, 65, 106, 131, 154]) expect(iconFrame(grp, "unit", unit, tables), `unit ${unit}`).toBe(unit);
    expect(iconFrame(grp, "unit", 4, tables)).toBe(-1); // Goliath Turret
    expect(iconFrame(grp, "unit", 220, tables)).toBe(-1); // an unused type past the doodad units
  });

  it("names the upgrades' and technologies' pictures from their tables", () => {
    const { grp, tables } = load();
    expect(tables.upgrades.icon[0]).toBe(292); // Terran Infantry Armor
    expect(tables.techs.icon[0]).toBe(237); // Stim Packs
    expect(iconFrame(grp, "upgrade", 0, tables)).toBe(292);
    expect(iconFrame(grp, "tech", 0, tables)).toBe(237);
    // Every upgrade and technology the game uses has a picture.
    for (let id = 0; id < tables.upgrades.icon.length; id++) if (tables.upgrades.icon[id]) expect(iconFrame(grp, "upgrade", id, tables), `upgrade ${id}`).toBeGreaterThan(0);
    for (let id = 0; id < tables.techs.icon.length; id++) if (tables.techs.icon[id]) expect(iconFrame(grp, "tech", id, tables), `tech ${id}`).toBeGreaterThan(0);
  });

  it("paints a Marine yellow, grey when disabled", () => {
    const { grp, colours, palette } = load();
    const opaque = (p: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < p.length; i += 4) if (p[i]) n++; return n; };
    const avg = (p: Uint8ClampedArray) => { const s = [0, 0, 0]; let n = 0; for (let i = 0; i < p.length; i += 4) if (p[i + 3]) { s[0] += p[i]; s[1] += p[i + 1]; s[2] += p[i + 2]; n++; } return s.map((v) => v / n); };
    const normal = paintIcon(grp, 0, colours, palette).pixels;
    const disabled = paintIcon(grp, 0, colours, palette, "disabled").pixels;
    expect(opaque(normal)).toBeGreaterThan(300);
    const [r, g, b] = avg(normal);
    expect(r).toBeGreaterThan(b * 2);
    expect(g).toBeGreaterThan(b * 2);
    const [dr, dg, db] = avg(disabled);
    expect(Math.max(dr, dg, db) - Math.min(dr, dg, db)).toBeLessThan(12);
  });
});
