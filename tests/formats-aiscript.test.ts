/** aiscript.bin and bwscript.bin as PyAI text and back, aise's commands included. */
import { describe, expect, it } from "vitest";
import { aiStringText, aiscriptFromText, aiscriptToText } from "../src/formats/dat/aiscript";
import { cosmonarchyFile, gameFile, haveCosmonarchy, haveGameArchives, sameBytes } from "./support/modFiles";

const SOURCE = `
script Test {
    name_string 1052
    bin_file aiscript
    broodwar_only 1
    staredit_hidden 0
    requires_location 0
    entry_point Test_entry
}

script BwOn {
    name_string 3
    bin_file bwscript
    broodwar_only 0
    staredit_hidden 1
    requires_location 1
    entry_point BwOn_entry
}

byte drones = 9

--Test_entry--
start_town()
build drones 106 80 ; PyAI's other style
wait(100)
if_dif(GreaterThan, 2, Hard)
attack_to(Loc.3, (100, 200))
issue_order(3, 0, 41 | Any, ScriptArea ~ 5, Loc.0, None, Own | SingleUnit)
debug(Test_entry, "a <60>tag<62>, done")
:Hard
goto(Test_entry)

--BwOn_entry--
create_unit(0, 64, 64)
stop()
`;

describe("the assembler", () => {
  it("puts each script's code in its file", () => {
    const { aiscript, bwscript } = aiscriptFromText(SOURCE);
    expect(bwscript).not.toBeNull();
    const view = new DataView(aiscript.buffer);
    const headers = view.getUint32(0, true);
    expect(String.fromCharCode(...aiscript.subarray(headers, headers + 4))).toBe("Test");
    expect(view.getUint32(headers + 8, true)).toBe(1053);
    expect(view.getUint32(headers + 12, true)).toBe(4);
    expect(String.fromCharCode(...aiscript.subarray(headers + 16, headers + 20))).toBe("BwOn");
    expect(view.getUint32(headers + 20, true)).toBe(0);
    expect(view.getUint32(headers + 28, true)).toBe(3);
    expect(aiscript[4]).toBe(3); // start_town
    expect(Array.from(aiscript.subarray(5, 10))).toEqual([6, 9, 106, 0, 80]); // build(9, 106, 80)
    expect(bwscript![4]).toBe(108); // create_unit
  });

  it("disassembles to text that assembles to the same bytes", () => {
    const files = aiscriptFromText(SOURCE);
    const text = aiscriptToText(files.aiscript, files.bwscript);
    expect(text).toContain("script Test {\n    name_string 1052\n    bin_file aiscript\n    broodwar_only 1");
    expect(text).toContain("issue_order(3, 0, 41 | Any, ScriptArea ~ 5, Loc.0, None, Own | SingleUnit)");
    expect(text).toContain('debug(Test_entry, "a <60>tag<62>, done")');
    const back = aiscriptFromText(text);
    expect(sameBytes(back.aiscript, files.aiscript)).toBe(true);
    expect(sameBytes(back.bwscript, files.bwscript)).toBe(true);
  });

  it("writes strings the way PyAI does", () => {
    expect(aiStringText(new TextEncoder().encode("a#b\"cé"))).toBe('"a<35>b<34>cé"');
    expect(aiStringText(new Uint8Array([0x41, 0xe9]))).toBe('"A<233>"');
  });

  it("says what is wrong, and where", () => {
    expect(() => aiscriptFromText("--A--\nbuild(1, 2)\n")).toThrow(/line 2: build takes 3 arguments/);
    expect(() => aiscriptFromText("--A--\nfly_away()\n")).toThrow(/line 2: "fly_away" is not an AI script command/);
    expect(() => aiscriptFromText("script X {\n    entry_point Nowhere\n}\n")).toThrow(/entry point Nowhere is no block/);
  });

  it("expands a file that does not fit 64 KB, with trampolines for short jumps", () => {
    const filler = Array.from({ length: 7000 }, () => 'print("0123456789")').join("\n");
    const { aiscript } = aiscriptFromText(`script Big {\n    entry_point Start\n}\n--Start--\nrandom_jump(1, Start)\n${filler}\ngoto(Start)\n`);
    expect(new DataView(aiscript.buffer).getUint32(0, true)).toBeGreaterThan(0xffff);
    expect(aiscript[4]).toBe(0); // the trampoline: goto with a u32
    const text = aiscriptToText(aiscript);
    expect(text).toContain("# scmjs: aiscript expanded");
    expect(sameBytes(aiscriptFromText(text).aiscript, aiscript)).toBe(true);
  });
});

describe.skipIf(!haveGameArchives)("the game's AI scripts (fixtures/data)", () => {
  it("aiscript.bin and bwscript.bin disassemble and assemble to the same bytes", () => {
    const ai = gameFile("scripts\\aiscript.bin")!, bw = gameFile("scripts\\bwscript.bin")!;
    const text = aiscriptToText(ai, bw);
    expect(text).not.toMatch(/IdleRaw/);
    const back = aiscriptFromText(text);
    expect(sameBytes(back.aiscript, ai)).toBe(true);
    expect(sameBytes(back.bwscript, bw)).toBe(true);
  });
});

describe.skipIf(!haveCosmonarchy)("a mod's AI scripts, expanded, with aise (SCMJS_COSMONARCHY)", () => {
  it("aiscript.bin (555 KB) and bwscript.bin disassemble and assemble to the same bytes", { timeout: 30_000 }, () => {
    const ai = cosmonarchyFile("release/mpq/scripts/aiscript.bin"), bw = cosmonarchyFile("release/mpq/scripts/bwscript.bin");
    const text = aiscriptToText(ai, bw);
    expect(text).toContain("# scmjs: aiscript expanded");
    const back = aiscriptFromText(text);
    expect(sameBytes(back.aiscript, ai)).toBe(true);
    expect(sameBytes(back.bwscript, bw)).toBe(true);
  });
});
