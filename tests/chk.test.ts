import { describe, expect, it } from "vitest";
import { Writer } from "../src/formats/chk/binary";
import { combine, parseChk, serializeChk } from "../src/formats/chk/reader";
import {
  isRemasteredRevision, mapVersionOf, markDirty, parseScenario, scenarioDescription, scenarioName,
  serializeScenario, setMapVersion, setScenarioName, tilesetIndex,
} from "../src/formats/chk/scenario";
import { strOverflowText, unreachableStrings, validateScenario } from "../src/editor/validate";
import { createScenario, requiredSections } from "../src/formats/chk/create";
import { ANYWHERE_INDEX, isLocationUsed, locationSlots } from "../src/formats/chk/sections/objects";
import { specFor } from "../src/formats/chk/sections/registry";
import { decodeStrings, encodeStrings, getString, stringTableOverflow } from "../src/formats/chk/sections/strings";

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

  it("combines repeated settings tables entry by entry, the tail from the last copy that customises", () => {
    // Two upgrade-cost tables: the first customises upgrade 0, the second upgrade 1.
    const spec = specFor("UPGS")!;
    const table = (custom: number, cost: number) => {
      const w = new Writer(598);
      for (let i = 0; i < 46; i++) w.u8(i === custom ? 0 : 1);
      for (let col = 0; col < 6; col++) for (let i = 0; i < 46; i++) w.u16(i === custom ? cost : 1);
      return w.finish();
    };
    const merged = combine(parseChk(concat(section("UPGS", table(0, 100)), section("UPGS", table(1, 200)))), "UPGS", spec.mode, spec.size as number, 0, spec.entries)!;
    const view = new DataView(merged.buffer, merged.byteOffset);
    expect([merged[0], merged[1], merged[2]]).toEqual([0, 0, 1]);
    expect(view.getUint16(46, true)).toBe(100);
    expect(view.getUint16(48, true)).toBe(200);
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

  it("passes over a copy shorter than the section's minimum", () => {
    // A protected map's decoy: a 1-byte STR after the real table. Remastered reads the real
    // one; a 2-byte table (no strings) is taken.
    const bytes = concat(sampleChk(), section("STR ", [0xa1]));
    const scn = parseScenario(bytes);
    expect(scenarioName(scn)).toBe("Test Map");
    expect(combine(parseChk(bytes), "STR ", "last", undefined, 2)).toEqual(parseChk(sampleChk()).sections.find((s) => s.name === "STR ")!.data);
    expect(combine(parseChk(concat(sampleChk(), section("STR ", u16(0)))), "STR ", "last", undefined, 2)).toEqual(u16(0));
    expect(combine(parseChk(section("STR ", [0xa1])), "STR ", "last", undefined, 2)).toBeNull();
    // Saved untouched, both copies stay as they were.
    expect(serializeScenario(scn)).toEqual(bytes);
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

  it("writes a malformed header back as it was rather than the bytes it found", () => {
    // A length past the end of the file, and a negative one: both are what protected maps
    // carry, and a Save with no edits must not straighten either out.
    const truncated = concat(sampleChk(), section("TRIG", new Uint8Array(100)).subarray(0, 40));
    expect(serializeChk(parseChk(truncated))).toEqual(truncated);

    const w = new Writer(16);
    for (const c of "ZZZZ") w.u8(c.charCodeAt(0));
    w.i32(-4);
    const negative = concat(sampleChk(), w.finish(), new Uint8Array([42, 43]));
    expect(serializeChk(parseChk(negative))).toEqual(negative);

    const base = serializeScenario(createScenario({ width: 32, height: 32, era: 0 }));

    // A section an edit adds goes in front of a malformed tail, never behind it.
    const noSwnm = parseScenario(concat(base, w.finish(), new Uint8Array([42, 43])));
    noSwnm.chk.sections = noSwnm.chk.sections.filter((s) => s.name !== "SWNM");
    noSwnm.switchNames = Array.from({ length: 256 }, () => 0);
    markDirty(noSwnm, "SWNM");
    const names = parseChk(serializeScenario(noSwnm)).sections.map((s) => s.name);
    expect(names.indexOf("SWNM")).toBeGreaterThan(-1);
    expect(names.at(-1)).toBe("ZZZZ");

    // Through the scenario model too: nothing dirty, nothing changed.
    for (const declared of [100, -4]) {
      const bytes = new Uint8Array(base.length + 10);
      bytes.set(base);
      bytes.set(new TextEncoder().encode("ZZZZ"), base.length);
      new DataView(bytes.buffer).setInt32(base.length + 4, declared, true);
      bytes.set([42, 43], base.length + 8);
      const scn = parseScenario(bytes);
      expect(scn.dirty.size).toBe(0);
      expect(serializeScenario(scn)).toEqual(bytes);
    }
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

  it("counts the STR strings past 64 KB, which the game cannot reach", () => {
    const filler = (n: number) => Array.from({ length: n }, (_, i) => `${i}`.padEnd(100, "x"));
    const many = { strings: [null, ...filler(700), "the last string"], extended: false, encoding: "windows-1252" as const };
    const over = stringTableOverflow(many);
    expect(over).toBeGreaterThan(0);
    expect(stringTableOverflow({ ...many, extended: true })).toBe(0);
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "x" });
    scn.strings = many;
    expect(validateScenario(scn).some((i) => i.level === "error" && i.text === strOverflowText(over))).toBe(true);

    // Only where a string starts has to fit, so one long string goes last and the table still works.
    const long = { strings: [null, "x".repeat(70000), "after"], extended: false, encoding: "windows-1252" as const };
    expect(stringTableOverflow(long)).toBe(0);
    expect(decodeStrings(encodeStrings(long), false).strings).toEqual(long.strings);
  });

  it("fits a table whose strings start inside other strings back into its 64 KB", () => {
    // A 40 KB string and 200 slots pointing into it: legal, but 4 MB once decoded string by string.
    const count = 201, header = 2 * (count + 1), text = 40000;
    const file = new Uint8Array(header + text + 1);
    const view = new DataView(file.buffer);
    view.setUint16(0, count, true);
    for (let i = 1; i <= count; i++) view.setUint16(i * 2, header + (i - 1) * 100, true);
    for (let j = 0; j < text; j++) file[header + j] = 0x61 + (j % 26);
    const table = decodeStrings(file, false);
    expect(stringTableOverflow(table)).toBe(0);
    const encoded = encodeStrings(table);
    expect(encoded.length).toBe(file.length + 1);
    expect(decodeStrings(encoded, false).strings).toEqual(table.strings);

    // STRx has no offsets to run out of, but writes the text once too.
    const wide = { ...table, extended: true };
    const packed = encodeStrings(wide);
    expect(packed.length).toBeLessThan(2 * file.length);
    expect(decodeStrings(packed, true).strings).toEqual(table.strings);
  });

  it("points a string at the end of another only when the table needs it", () => {
    const table = { strings: [null, "Marine", "ine", "", "ine"], extended: false, encoding: "windows-1252" as const };
    const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset);
    const plain = encodeStrings(table);
    expect(view(plain).getUint16(4, true)).not.toBe(view(plain).getUint16(2, true) + 3);
    const filler = Array.from({ length: 600 }, (_, i) => `${i}`.padEnd(100, "x"));
    const big = { ...table, strings: [...table.strings, ...filler, ...filler.map((f) => `#${f}`)] };
    const packed = encodeStrings(big);
    expect(view(packed).getUint16(4, true)).toBe(view(packed).getUint16(2, true) + 3);
    expect(decodeStrings(packed, false).strings).toEqual(big.strings);
    expect(stringTableOverflow(big)).toBe(0);
  });

  it("leaves an untouched STR to the file, whatever its strings would take re-encoded", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "x" });
    scn.strings = { strings: [null, ...Array.from({ length: 700 }, (_, i) => `${i}`.padEnd(100, "x"))], extended: false, encoding: "windows-1252" };
    expect(unreachableStrings(scn)).toBeGreaterThan(0);
    scn.dirty.delete("STR ");
    expect(unreachableStrings(scn)).toBe(0);
    expect(validateScenario(scn).some((i) => i.text.includes("64 KB"))).toBe(false);
  });
});

/** The sample scenario at revision `ver`, with `tables` (STR / STRx sections, in this order) for its strings. */
function stringsChk(ver: number, ...tables: Uint8Array[]): Uint8Array {
  const tiles = new Uint16Array(16).fill(0x0021);
  return concat(
    section("TYPE", [0x52, 0x41, 0x57, 0x42]),
    section("VER ", u16(ver)),
    section("ERA ", u16(4)),
    section("DIM ", u16(4, 4)),
    section("OWNR", new Uint8Array([6, 6, 5, 0, 0, 0, 0, 0, 7, 7, 7, 7])),
    section("SIDE", new Uint8Array([1, 2, 0, 7, 7, 7, 7, 7, 4, 4, 4, 4])),
    section("MTXM", new Uint8Array(tiles.buffer)),
    ...tables,
    section("SPRP", u16(1, 2)),
    section("FORC", new Uint8Array(20)),
  );
}
const strTable = (name: string) => section("STR ", encodeStrings({ strings: [null, name], extended: false }));
const strxTable = (name: string) => section("STRx", encodeStrings({ strings: [null, name], extended: true }));

// The game reads STRx only in a VER 64 or 206 file, after every STR copy, and passes over a
// copy shorter than 4 bytes (docs/chk-format.md, Where Remastered differs).
describe("which string table the game reads", () => {
  it("takes STRx over STR in a VER 206 or 64 file, whatever the order in the file", () => {
    for (const ver of [206, 64]) {
      const scn = parseScenario(stringsChk(ver, strxTable("from STRx"), strTable("from STR")));
      expect(scenarioName(scn)).toBe("from STRx");
      expect(scn.strings.extended).toBe(true);
    }
  });

  it("passes over a STRx copy shorter than 4 bytes", () => {
    const scn = parseScenario(stringsChk(206, strTable("from STR"), section("STRx", [1, 0, 0])));
    expect(scenarioName(scn)).toBe("from STR");
    expect(scn.strings.extended).toBe(false);
  });

  it("ignores STRx in a VER 205 file, as the game does, and keeps it in the file unchanged", () => {
    const bytes = stringsChk(205, strTable("from STR"), strxTable("decoy"));
    const scn = parseScenario(bytes);
    expect(scenarioName(scn)).toBe("from STR");
    expect(scn.strings.extended).toBe(false);
    expect(validateScenario(scn).some((i) => i.level === "info" && i.text.startsWith("The file also has a STRx"))).toBe(true);
    setScenarioName(scn, "renamed");
    const back = parseChk(serializeScenario(scn));
    expect(back.sections.find((x) => x.name === "STRx")!.data).toEqual(strxTable("decoy").subarray(8));
    expect(scenarioName(parseScenario(serializeScenario(scn)))).toBe("renamed");
  });

  it("still shows a VER 205 file's STRx when it has no STR, and Check Map says the game refuses it", () => {
    const scn = parseScenario(stringsChk(205, strxTable("only STRx")));
    expect(scenarioName(scn)).toBe("only STRx");
    const errors = validateScenario(scn).filter((i) => i.level === "error");
    expect(errors.some((i) => i.text.startsWith("The strings are in STRx"))).toBe(true);
    expect(errors.some((i) => i.text.startsWith("Missing STR"))).toBe(false);
    setMapVersion(scn, "remastered");
    expect(validateScenario(scn).some((i) => i.text.startsWith("The strings are in STRx"))).toBe(false);
  });
});

describe("VER 64", () => {
  it("is Remastered's revision without Brood War, kept as it is", () => {
    expect(mapVersionOf(64)).toBe("remasteredHybrid");
    expect(mapVersionOf(63)).toBe("hybrid");
    expect([59, 63, 64, 205, 206].map(isRemasteredRevision)).toEqual([false, false, true, false, true]);
    const scn = parseScenario(stringsChk(64, strxTable("name")));
    setMapVersion(scn, "remasteredHybrid", true);
    expect(scn.fileVersion).toBe(64);
    expect(scn.strings.extended).toBe(true);
    expect(scn.dirty.has("VER ")).toBe(false);
    setMapVersion(scn, "hybrid");
    expect([scn.fileVersion, scn.strings.extended]).toEqual([63, false]);
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

  it("writes a dirty section the file never had, where StarEdit puts it", () => {
    const scn = parseScenario(sampleChk());
    scn.locations = [{ left: 1, top: 2, right: 3, bottom: 4, nameIndex: 1, elevationFlags: 0 }];
    markDirty(scn, "MRGN");
    const out = serializeScenario(scn);
    const again = parseScenario(out);
    expect(again.locations[0]).toEqual({ left: 1, top: 2, right: 3, bottom: 4, nameIndex: 1, elevationFlags: 0 });
    // Between its neighbours in APPEND_ORDER, not after everything: a file that gains a
    // section back is still a file in the order StarEdit writes.
    const names = parseChk(out).sections.map((s) => s.name);
    expect(names).toEqual(["TYPE", "VER ", "ERA ", "DIM ", "OWNR", "SIDE", "MTXM", "STR ", "MRGN", "SPRP", "FORC"]);
  });

  it("puts a new section before the sections it cannot place, and moves nothing already there", () => {
    // A protected file's shape: a name the editor knows nothing about, at the end.
    const scn = parseScenario(concat(sampleChk(), section("JUNK", new Uint8Array([1, 2, 3]))));
    markDirty(scn, "ISOM");
    scn.isom = new Uint16Array(3 * 5 * 4);
    const names = parseChk(serializeScenario(scn)).sections.map((s) => s.name);
    expect(names).toEqual(["TYPE", "VER ", "ERA ", "DIM ", "OWNR", "SIDE", "MTXM", "ISOM", "STR ", "SPRP", "FORC", "JUNK"]);
  });

  it("puts a section that comes before everything at the front", () => {
    // The same file with its first section, TYPE, cut off the front.
    const scn = parseScenario(sampleChk().slice(parseChk(sampleChk()).sections[0].data.length + 8));
    expect(scn.chk.sections.map((s) => s.name)).not.toContain("TYPE");
    markDirty(scn, "TYPE");
    expect(parseChk(serializeScenario(scn)).sections[0].name).toBe("TYPE");
  });
});

describe("locations by revision", () => {
  it("writes exactly 64 slots in a StarCraft 1.00 file and 255 from a hybrid one up", () => {
    const sizeFor = (ver: number) => {
      const scn = createScenario({ width: 64, height: 64, era: 0, name: "x" });
      scn.fileVersion = ver;
      markDirty(scn, "MRGN");
      return parseChk(serializeScenario(scn)).sections.find((s) => s.name === "MRGN")!.data.length;
    };
    expect(sizeFor(59)).toBe(1280);
    expect(sizeFor(63)).toBe(5100);
    expect(sizeFor(205)).toBe(5100);
    expect([locationSlots(59), locationSlots(63), locationSlots(206)]).toEqual([64, 255, 255]);
  });

  it("keeps Anywhere, slot 64, in a StarCraft 1.00 file", () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "x" });
    scn.fileVersion = 59;
    markDirty(scn, "MRGN");
    const again = parseScenario(serializeScenario(scn));
    expect(again.locations).toHaveLength(64);
    expect(again.locations[ANYWHERE_INDEX]).toEqual(scn.locations[ANYWHERE_INDEX]);
  });

  it("rewrites the locations when the revision changes their number", () => {
    const scn = parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "x" })));
    setMapVersion(scn, "original");
    expect(scn.dirty.has("MRGN")).toBe(true);
    const down = parseScenario(serializeScenario(scn));
    expect(down.locations).toHaveLength(64);
    setMapVersion(down, "hybrid");
    expect(down.locations).toHaveLength(255);
    expect(parseScenario(serializeScenario(down)).locations).toHaveLength(255);
  });

  it("writes the settings tables the new revision needs", () => {
    const has = (bytes: Uint8Array) => new Set(parseChk(bytes).sections.map((s) => s.name));
    for (const version of ["original", "hybrid", "remasteredHybrid"] as const) {
      const scn = parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "x" })));
      setMapVersion(scn, version);
      const names = has(serializeScenario(scn));
      for (const name of requiredSections(scn.fileVersion)) if (name !== "STR ") expect([version, names.has(name)]).toEqual([version, true]);
    }
    const up = parseScenario(serializeScenario(createScenario({ width: 64, height: 64, era: 0, name: "x" })));
    setMapVersion(up, "original");
    const old = parseScenario(serializeScenario(up));
    setMapVersion(old, "broodwar");
    const names = has(serializeScenario(old));
    for (const name of requiredSections(205)) expect([name, names.has(name)]).toEqual([name, true]);
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
