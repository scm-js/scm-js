import { describe, expect, it } from "vitest";
import { Writer } from "../src/formats/chk/binary";
import { combine, parseChk, serializeChk } from "../src/formats/chk/reader";
import {
  markDirty, parseScenario, scenarioDescription, scenarioName,
  serializeScenario, setScenarioName, tilesetIndex,
} from "../src/formats/chk/scenario";
import { createScenario } from "../src/formats/chk/create";
import { ANYWHERE_INDEX, isLocationUsed } from "../src/formats/chk/sections/objects";
import { decodeStrings, encodeStrings, getString } from "../src/formats/chk/sections/strings";

function section(name: string, data: Uint8Array | number[]): Uint8Array {
  const body = data instanceof Uint8Array ? data : new Uint8Array(data);
  const w = new Writer(8 + body.length);
  for (let i = 0; i < 4; i++) w.u8(name.charCodeAt(i));
  w.i32(body.length);
  w.bytes(body);
  return w.finish();
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

function u16(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 2);
  const v = new DataView(out.buffer);
  values.forEach((n, i) => v.setUint16(i * 2, n, true));
  return out;
}

/** A minimal but structurally valid 4x4 scenario. */
function sampleChk(): Uint8Array {
  const tiles = new Uint16Array(16);
  tiles.fill(0x0021);
  const strings = encodeStrings({ strings: [null, "Test Map", "A description."], extended: false });
  return concat(
    section("TYPE", [0x52, 0x41, 0x57, 0x42]), // RAWB
    section("VER ", u16(205)),
    section("ERA ", u16(4)), // jungle
    section("DIM ", u16(4, 4)),
    section("OWNR", new Uint8Array([6, 6, 5, 0, 0, 0, 0, 0, 7, 7, 7, 7])),
    section("SIDE", new Uint8Array([1, 2, 0, 7, 7, 7, 7, 7, 4, 4, 4, 4])),
    section("MTXM", new Uint8Array(tiles.buffer)),
    section("STR ", strings),
    section("SPRP", u16(1, 2)),
    section("FORC", new Uint8Array(20)),
  );
}

describe("chk container", () => {
  it("round-trips an untouched file byte for byte", () => {
    const bytes = sampleChk();
    expect(serializeChk(parseChk(bytes))).toEqual(bytes);
  });

  it("keeps every occurrence of a repeated section", () => {
    const bytes = concat(sampleChk(), section("MTXM", u16(9, 9)));
    const file = parseChk(bytes);
    expect(file.sections.filter((s) => s.name === "MTXM")).toHaveLength(2);
  });

  it("overlays repeated sections over the front of the buffer", () => {
    const bytes = concat(sampleChk(), section("MTXM", u16(9, 9)));
    const merged = combine(parseChk(bytes), "MTXM", "overlay", 32)!;
    const view = new DataView(merged.buffer);
    expect(view.getUint16(0, true)).toBe(9);
    expect(view.getUint16(2, true)).toBe(9);
    // The later, shorter section only overwrote its own prefix.
    expect(view.getUint16(4, true)).toBe(0x0021);
  });

  it("appends list sections rather than replacing them", () => {
    const bytes = concat(sampleChk(), section("UNIT", new Uint8Array(36)), section("UNIT", new Uint8Array(72)));
    expect(combine(parseChk(bytes), "UNIT", "append")!.length).toBe(108);
  });

  it("survives a declared size that runs past the end of the file", () => {
    const truncated = concat(sampleChk(), section("TRIG", new Uint8Array(100)).subarray(0, 40));
    const file = parseChk(truncated);
    const trig = file.sections.find((s) => s.name === "TRIG")!;
    expect(trig.truncated).toBe(true);
    expect(trig.data.length).toBe(32);
  });

  it("stops on a negative section size instead of looping", () => {
    const w = new Writer(16);
    for (const c of "TRIG") w.u8(c.charCodeAt(0));
    w.i32(-8);
    const file = parseChk(concat(sampleChk(), w.finish(), new Uint8Array(4)));
    expect(file.sections.at(-1)!.name).toBe("TRIG");
    expect(file.trailing).toBeDefined();
  });
});

describe("string table", () => {
  it("round-trips and preserves indices", () => {
    const table = { strings: [null, "one", "two", "one"] as (string | null)[], extended: false };
    const decoded = decodeStrings(encodeStrings(table), false);
    expect(decoded.strings).toEqual([null, "one", "two", "one"]);
  });

  it("shares one blob between identical strings", () => {
    const encoded = encodeStrings({ strings: [null, "same", "same"], extended: false });
    const view = new DataView(encoded.buffer);
    expect(view.getUint16(2, true)).toBe(view.getUint16(4, true));
  });

  it("handles the 32-bit STRx layout", () => {
    const decoded = decodeStrings(encodeStrings({ strings: [null, "hello"], extended: true }), true);
    expect(decoded.strings[1]).toBe("hello");
  });
});

describe("scenario", () => {
  it("reads the fields the editor needs", () => {
    const scn = parseScenario(sampleChk());
    expect(scn.width).toBe(4);
    expect(scn.height).toBe(4);
    expect(tilesetIndex(scn)).toBe(4);
    expect(scn.type).toBe("RAWB");
    expect(scn.fileVersion).toBe(205);
    expect(scenarioName(scn)).toBe("Test Map");
    expect(scenarioDescription(scn)).toBe("A description.");
    expect(scn.playerTypes.slice(0, 3)).toEqual([6, 6, 5]);
    expect(scn.tiles[0]).toBe(0x0021);
  });

  it("re-emits an unmodified scenario byte for byte", () => {
    const bytes = sampleChk();
    expect(serializeScenario(parseScenario(bytes))).toEqual(bytes);
  });

  it("rewrites only the sections that were touched", () => {
    const bytes = sampleChk();
    const scn = parseScenario(bytes);
    scn.tiles[0] = 0x0042;
    markDirty(scn, "MTXM");
    const out = parseChk(serializeScenario(scn));

    const mtxm = out.sections.find((s) => s.name === "MTXM")!;
    expect(new DataView(mtxm.data.buffer, mtxm.data.byteOffset).getUint16(0, true)).toBe(0x0042);
    // Untouched neighbours keep their original bytes and positions.
    expect(out.sections.map((s) => s.name)).toEqual(parseChk(bytes).sections.map((s) => s.name));
    const str = out.sections.find((s) => s.name === "STR ")!;
    expect(str.data).toEqual(parseChk(bytes).sections.find((s) => s.name === "STR ")!.data);
  });

  it("round-trips a renamed scenario", () => {
    const scn = parseScenario(sampleChk());
    setScenarioName(scn, "Renamed");
    const again = parseScenario(serializeScenario(scn));
    expect(scenarioName(again)).toBe("Renamed");
    expect(scenarioDescription(again)).toBe("A description.");
  });

  it("appends a dirty section that the file never had", () => {
    const scn = parseScenario(sampleChk());
    scn.locations = [{ left: 1, top: 2, right: 3, bottom: 4, nameIndex: 1, elevationFlags: 0 }];
    markDirty(scn, "MRGN");
    const again = parseScenario(serializeScenario(scn));
    expect(again.locations[0]).toEqual({ left: 1, top: 2, right: 3, bottom: 4, nameIndex: 1, elevationFlags: 0 });
  });
});

describe("new scenarios", () => {
  it("writes every section it fills in, in StarEdit's order", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "Untitled Scenario" });
    const names = parseChk(serializeScenario(scn)).sections.map((s) => s.name);
    expect(names).toContain("MTXM");
    expect(names).toContain("ISOM");
    expect(names.indexOf("DIM ")).toBeLessThan(names.indexOf("MTXM"));
    expect(names.indexOf("MTXM")).toBeLessThan(names.indexOf("STR "));
  });

  it("round-trips through the parser", () => {
    const tiles = new Uint16Array(64 * 64);
    tiles.fill(0x0021);
    const scn = createScenario({
      width: 64, height: 64, era: 0, name: "Badlands Test", description: "Dirt everywhere.", tiles,
    });
    const again = parseScenario(serializeScenario(scn));

    expect(again.width).toBe(64);
    expect(again.height).toBe(64);
    expect(tilesetIndex(again)).toBe(0);
    expect(again.fileVersion).toBe(205);
    expect(scenarioName(again)).toBe("Badlands Test");
    expect(scenarioDescription(again)).toBe("Dirt everywhere.");
    expect(again.tiles).toEqual(tiles);
    expect(again.warnings).toEqual([]);
  });

  it("starts with Anywhere and nothing else", () => {
    const scn = parseScenario(serializeScenario(createScenario({ width: 96, height: 64, era: 0, name: "M" })));
    const used = scn.locations.filter(isLocationUsed);
    expect(used).toHaveLength(1);
    expect(scn.locations.indexOf(used[0])).toBe(ANYWHERE_INDEX);
    expect(used[0]).toMatchObject({ left: 0, top: 0, right: 96 * 32, bottom: 64 * 32 });
    expect(getString(scn.strings, used[0].nameIndex)).toBe("Anywhere");
    expect(scn.units).toEqual([]);
  });
});
