// What an option's value may be (cli/src/values.ts): one reading for every command.
import { describe, expect, it } from "vitest";
import { CliError } from "../cli/src/ui";
import { parseFrames, parseRace, parseRaceWord, parseWhole } from "../cli/src/values";

describe("option values", () => {
  it("reads a whole number, and refuses what is not one", () => {
    expect(parseWhole("7", "seed")).toBe(7);
    expect(parseWhole(" 12 ", "games", 1)).toBe(12);
    for (const bad of ["abc", "", "1.5", "0x10", "1e3"]) expect(() => parseWhole(bad, "seed")).toThrow(CliError);
    expect(() => parseWhole("0", "games", 1)).toThrow(CliError);
    expect(() => parseWhole("-5", "frames", 1)).toThrow(CliError);
    try { parseWhole("abc", "seed"); } catch (e) { expect((e as CliError).exitCode).toBe(2); }
  });

  it("reads --frames as frames or as a time", () => {
    expect(parseFrames("2400")).toBe(2400);
    expect(parseFrames("1:00")).toBe(1429);
    expect(parseFrames("0:20")).toBe(476);
    for (const bad of ["abc", "0", "-5", "1:75", "1:", "0:00", ""]) expect(() => parseFrames(bad)).toThrow(CliError);
    expect(parseFrames("0", "every", 0)).toBe(0);
  });

  it("reads a race by its word or its letter", () => {
    expect(parseRace("t")).toBe("t");
    expect(parseRace("Terran")).toBe("t");
    expect(parseRaceWord("z")).toBe("zerg");
    expect(parseRaceWord("RANDOM")).toBe("random");
    expect(() => parseRace("x")).toThrow(CliError);
    expect(() => parseRace("bogus", "--opponents")).toThrow(/--opponents/);
  });
});
