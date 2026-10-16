import { describe, expect, it } from "vitest";
import { isStarEditDownload } from "../src/gamedata/archives";
import { copyKind, ownGame } from "../src/gamedata/copies";
import { BLIZZARD_ZIP_URL } from "../src/gamedata/install";
import { REMASTERED_ORIGIN, REMASTERED_PROFILE } from "../src/gamedata/profiles";

describe("what a stored copy is", () => {
  it("is told from where it came and which data set it is", () => {
    expect(copyKind({ from: BLIZZARD_ZIP_URL })).toBe("download");
    expect(copyKind({ from: "StarDat.mpq + BrooDat.mpq" })).toBe("classic");
    // A Remastered installation installed as the game's own copy, and beside one.
    expect(copyKind({ from: `${REMASTERED_ORIGIN} 1.23.10.13515` })).toBe("remastered");
    expect(copyKind({ from: REMASTERED_ORIGIN, profile: REMASTERED_PROFILE })).toBe("remastered");
    expect(copyKind({ from: "StarDat.mpq + BrooDat.mpq + mod.mpq", profile: { id: "my-mod", name: "My Mod" } })).toBe("mod");
  });

  it("knows the download's archives picked by hand, by their sizes", () => {
    const staredit = [{ name: "StarEdit/StarDat.mpq", size: 66_927_148 }, { name: "BrooDat.mpq", size: 21_786_162 }, { name: "patch_rt.mpq", size: 1_803_889 }];
    expect(isStarEditDownload(staredit)).toBe(true);
    // A 1.16.1 installation's, and one of the two alone.
    expect(isStarEditDownload([{ name: "StarDat.mpq", size: 63_511_342 }, { name: "BrooDat.mpq", size: 24_499_671 }])).toBe(false);
    expect(isStarEditDownload(staredit.slice(0, 1))).toBe(false);
    expect(copyKind({ from: "StarDat.mpq + BrooDat.mpq + patch_rt.mpq", staredit: true })).toBe("download");
    expect(ownGame([{ from: "StarDat.mpq + BrooDat.mpq", staredit: true }])).toBe(false);
  });

  it("knows the free download from somebody's own game", () => {
    expect(ownGame([])).toBe(false);
    expect(ownGame([{ from: BLIZZARD_ZIP_URL }])).toBe(false);
    expect(ownGame([{ from: BLIZZARD_ZIP_URL }, { from: REMASTERED_ORIGIN, profile: REMASTERED_PROFILE }])).toBe(true);
    expect(ownGame([{ from: "StarDat.mpq + BrooDat.mpq" }])).toBe(true);
    expect(ownGame([{ from: "x", profile: { id: "my-mod", name: "My Mod" } }])).toBe(false);
  });
});
