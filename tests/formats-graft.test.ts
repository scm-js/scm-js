/** `.graft` requirements and buttons, binary and graftc's text. */
import { describe, expect, it } from "vitest";
import {
  buttonGraftFromText, buttonGraftToText, decodeButtonGraft, decodeReqGraft, encodeButtonGraft, encodeReqGraft, reqGraftFromText, reqGraftToText,
} from "../src/formats/dat/graft";
import { cosmonarchyFile, haveCosmonarchy, sameBytes } from "./support/modFiles";

describe("requirements", () => {
  it("reads graftc's text", () => {
    const g = reqGraftFromText("# comment\n#DAT REQ:\n1:  # ID 1\n  0xFF02   # an opcode\n  111\n  65288\n  112\n  0xFFFF\n");
    expect(g.entries).toEqual([{ id: 1, words: [0xff02, 111, 65288, 112, 0xffff] }]);
    expect(Array.from(encodeReqGraft(g))).toEqual([0, 0, 1, 0, 2, 0xff, 111, 0, 8, 0xff, 112, 0, 0xff, 0xff, 0xff, 0xff]);
  });

  it("keeps an upgrade's levels in one entry", () => {
    const g = { start: 0, entries: [{ id: 0, words: [0xff02, 122, 0xff1f, 0xffff, 0xff20, 116, 0xffff] }, { id: 1, words: [0xff02, 5, 0xffff] }] };
    const bytes = encodeReqGraft(g);
    expect(decodeReqGraft(bytes)).toEqual(g);
    expect(sameBytes(encodeReqGraft(reqGraftFromText(reqGraftToText(g))), bytes)).toBe(true);
  });
});

describe("buttons", () => {
  it("reads graftc's text and cuts sets back out of a file", () => {
    const text = "#BUTTONS:\n1:\n1, 130, 1, 2, 0, 0, 373, 0\n2, 248, 3, 4, 0, 0, 372, 0\n\nUnit 0: 1\nUnit 1: 1, 65535, 2, 1\nunit 2: -1\n";
    const g = buttonGraftFromText(text);
    expect(g.buttons).toHaveLength(2);
    expect(g.sets).toEqual([{ count: 2, first: 0, connected: 0xffff }, { count: 2, first: 0, connected: 0xffff }, { count: 0, first: 0, connected: 0xffff }]);
    expect(g.status[1]).toEqual([1, 2, 1]);
    const bytes = encodeButtonGraft(g);
    expect(bytes.length).toBe(12 + 2 * 20 + 3 * 12 + 3 * 12);
    expect(sameBytes(encodeButtonGraft(buttonGraftFromText(buttonGraftToText(decodeButtonGraft(bytes)))), bytes)).toBe(true);
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's .graft files (SCMJS_COSMONARCHY)", () => {
  for (const name of ["Units", "Upgrades", "Research", "Tech", "Orders"]) {
    it(`${name}.graft comes back byte for byte, and through text`, () => {
      const bytes = cosmonarchyFile(`release/mpq/datreq/${name}.graft`);
      const g = decodeReqGraft(bytes);
      expect(sameBytes(encodeReqGraft(g), bytes)).toBe(true);
      expect(sameBytes(encodeReqGraft(reqGraftFromText(reqGraftToText(g))), bytes)).toBe(true);
    });
  }

  it("Buttons.graft comes back byte for byte, and through text", () => {
    const bytes = cosmonarchyFile("release/mpq/datreq/Buttons.graft");
    const g = decodeButtonGraft(bytes);
    expect(g.buttons.length).toBeGreaterThan(3000);
    expect(sameBytes(encodeButtonGraft(g), bytes)).toBe(true);
    expect(sameBytes(encodeButtonGraft(buttonGraftFromText(buttonGraftToText(g))), bytes)).toBe(true);
  });
});
