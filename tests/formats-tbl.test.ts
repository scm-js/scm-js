/** `.tbl` string tables read and written, and PyTBL's text. */
import { describe, expect, it } from "vitest";
import { decodeTblFile, encodeTblFile, tblEscape, tblFromText, tblToText } from "../src/formats/dat/tblFile";
import { decodeTblEntries } from "../src/formats/dat/tbl";
import { cosmonarchyFile, gameFile, haveCosmonarchy, haveGameArchives, sameBytes } from "./support/modFiles";

describe(".tbl", () => {
  it("writes entries with their NULs, adding one where missing", () => {
    const bytes = encodeTblFile({ strings: ["Marine\0*\0Ground Units\0", "Fire"], encoding: "utf-8" });
    const back = decodeTblFile(bytes);
    expect(back.strings).toEqual(["Marine\0*\0Ground Units\0", "Fire\0"]);
    expect(decodeTblEntries(bytes)).toEqual([["Marine", "*", "Ground Units"], ["Fire"]]);
  });

  it("keeps a single-byte encoding", () => {
    const file = { strings: ["Café\0"], encoding: "windows-1252" as const };
    const bytes = encodeTblFile(file);
    expect(bytes[bytes.length - 2]).toBe(0xe9);
    expect(decodeTblFile(bytes).strings).toEqual(["Café\0"]);
  });

  it("reads entries that share a string or sit out of order", () => {
    // Three entries at offsets 11, 8 and 11: "B1\0" at 8, "AA\0" at 11, the first and last sharing it.
    const bytes = new Uint8Array([3, 0, 11, 0, 8, 0, 11, 0, 0x42, 0x31, 0, 0x41, 0x41, 0]);
    expect(decodeTblFile(bytes).strings).toEqual(["AA\0", "B1\0", "AA\0"]);
  });

  it("goes to PyTBL text and back", () => {
    const strings = ["a<1>#\0", "Line\nTwo\0", "\0", "é\0"];
    expect(tblEscape("a<b>#\t")).toBe("a<60>b<62><35><9>");
    const text = tblToText(strings);
    expect(text).toBe("a<60>1<62><35><0>\nLine<10>Two<0>\n<0>\né<0>\n");
    expect(tblFromText(text)).toEqual(strings);
    expect(tblFromText("# a comment\nOne<0>\n\nTwo # trailing\n")).toEqual(["One\0", "", "Two "]);
  });
});

describe.skipIf(!haveGameArchives)("the game's string tables (fixtures/data)", () => {
  for (const name of ["rez\\stat_txt.tbl", "arr\\images.tbl", "arr\\sfxdata.tbl", "arr\\portdata.tbl", "arr\\mapdata.tbl", "rez\\network.tbl", "rez\\gluAll.tbl"]) {
    it(`${name} comes back byte for byte, and through PyTBL text`, () => {
      const bytes = gameFile(name)!;
      const file = decodeTblFile(bytes);
      expect(sameBytes(encodeTblFile(file), bytes)).toBe(true);
      expect(sameBytes(encodeTblFile({ strings: tblFromText(tblToText(file.strings)), encoding: file.encoding }), bytes)).toBe(true);
    });
  }
});

describe.skipIf(!haveCosmonarchy)("a mod's string tables (SCMJS_COSMONARCHY)", () => {
  for (const name of ["release/mpq/arr/images.tbl", "release/mpq/arr/portdata.tbl"]) {
    it(`${name} comes back byte for byte`, () => {
      const bytes = cosmonarchyFile(name);
      const file = decodeTblFile(bytes);
      expect(sameBytes(encodeTblFile({ strings: tblFromText(tblToText(file.strings)), encoding: file.encoding }), bytes)).toBe(true);
    });
  }
});
