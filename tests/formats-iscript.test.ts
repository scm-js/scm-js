/** iscript.bin as PyICE / IceCC text and back. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { iscriptFromText, iscriptToText, readIscriptHeaders } from "../src/formats/dat/iscriptText";
import { animOffset, decodeIscript, readInstruction } from "../src/formats/dat/iscript";
import { cosmonarchyFile, cosmonarchyPath, haveCosmonarchy, sameBytes } from "./support/modFiles";

const SOURCE = `
# A comment
.headerstart
IsId          	3	# Scourge Explosion
Type          	1
Init          	Scourge_Explosion_Init
Death         	Scourge_Explosion_Death
.headerend

Scourge_Explosion_Init:
	playfram         	0x00	# Frame set 0
	wait             	1
	playsndrand(2, 10, 11)
	imgol 130 -3 4
	randcondjmp 128 Scourge_Explosion_Death
	end

Scourge_Explosion_Death:	wait 2
	unused_0c
	ub 62
	pw Scourge_Explosion_Init
	end
`;

describe("the assembler", () => {
  it("lays a file out as IceCC does", () => {
    const bin = iscriptFromText(SOURCE);
    expect(Array.from(bin.subarray(0, 8))).toEqual([bin[0], bin[1], 0, 0, 0xff, 0xff, 0, 0]);
    // Code first, at 8.
    expect(Array.from(bin.subarray(8, 13))).toEqual([0x00, 0, 0, 0x05, 1]);
    const { headers, rule } = readIscriptHeaders(bin);
    expect(rule).toBe("icecc");
    expect(headers).toHaveLength(1);
    expect(headers[0]).toMatchObject({ id: 3, type: 1 });
    const parsed = decodeIscript(bin);
    // The editor's own reader follows it (it stops at the raw bytes, an opcode it does not know, as the game's would).
    const ops: number[] = [];
    for (let pc = animOffset(parsed, 3, 0), i = 0; i < 6; i++) { const ins = readInstruction(bin, pc)!; ops.push(ins.op); pc = ins.next; }
    expect(ops).toEqual([0x00, 0x05, 0x19, 0x08, 0x1e, 0x16]);
  });

  it("disassembles to text that assembles to the same bytes", () => {
    const bin = iscriptFromText(SOURCE);
    const text = iscriptToText(bin);
    expect(text).toContain(".headerstart\nIsId             \t3\nType             \t1\nInit             \tScript3_Init\nDeath            \tScript3_Death\n.headerend");
    expect(text).toContain("\tplaysndrand      \t2 10 11");
    expect(text).toContain("\tplayfram         \t0x00");
    expect(sameBytes(iscriptFromText(text), bin)).toBe(true);
  });

  it("reports what it cannot place, by line", () => {
    expect(() => iscriptFromText("Start:\n\tplayfram\n")).toThrow(/line 2: playfram takes 1 argument/);
    expect(() => iscriptFromText("Start:\n\tgoto Nowhere\n")).toThrow(/line 2: no label Nowhere/);
    expect(() => iscriptFromText("\tfrobnicate 1\n")).toThrow(/line 1: "frobnicate" is not an iscript command/);
    expect(() => iscriptFromText(".headerstart\nIsId 1\nType 99\n.headerend\n")).toThrow(/99 is not a header type/);
    const warnings: string[] = [];
    iscriptFromText(".headerstart\nIsId 1\nType 0\nInit A\nDeath A\n.headerend\nA:\n\tend\n", { warnings });
    expect(warnings[0]).toMatch(/Death \(A\) is not written/);
  });
});

const ISCRIPT = resolve(import.meta.dirname, "../public/scripts/iscript.bin");

describe.skipIf(!existsSync(ISCRIPT))("the game's iscript.bin (public/scripts)", () => {
  it("disassembles and assembles to the same bytes", () => {
    const bin = new Uint8Array(readFileSync(ISCRIPT));
    const text = iscriptToText(bin);
    expect(text).toMatch(/^# scmjs: preamble /);
    expect(text).toContain("# scmjs: entries pyms");
    expect(text).toContain("# scmjs: headers inline");
    expect(sameBytes(iscriptFromText(text), bin)).toBe(true);
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's iscript sources (SCMJS_COSMONARCHY)", () => {
  for (const name of ["bloodsummon", "general", "protoss", "terran", "zerg", "askosi"]) {
    it(`iscript_${name}.txt assembles to its shipped iscript_${name}.bin, which disassembles back`, () => {
      const bin = cosmonarchyFile(`release/mpq/scripts/iscript_${name}.bin`);
      const source = readFileSync(cosmonarchyPath(`release/mpq/scripts/iscript_${name}.txt`), "utf8");
      expect(sameBytes(iscriptFromText(source), bin)).toBe(true);
      expect(sameBytes(iscriptFromText(iscriptToText(bin)), bin)).toBe(true);
    });
  }

  it("assembles the source that ships without a binary", () => {
    const path = cosmonarchyPath("release/mpq/scripts/iscript_kogri.txt");
    if (existsSync(path)) expect(iscriptFromText(readFileSync(path, "utf8")).length).toBeGreaterThan(8);
  });
});

