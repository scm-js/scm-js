import { afterEach, describe, expect, it } from "vitest";
import { fetchAsset, resetAssetSource, setAssetSource, type AssetSource } from "../src/gamedata/source";
import { clearStoredCopy, keepInMemory, storedCopy } from "../src/gamedata/store";

/** A data set that is a function in memory: its files first, the rest from the source under it, nothing stored. */
describe("a data set read through a function", () => {
  afterEach(async () => { resetAssetSource(); await clearStoredCopy("under"); });

  it("answers its own files and leaves the rest to the copy under it", async () => {
    const stamp = { from: "test", at: "", files: 2, bytes: 4, summary: "", profile: { id: "under", name: "Under" } };
    keepInMemory(new Map([["arr/units.dat", new Uint8Array([1, 1])], ["arr/flingy.dat", new Uint8Array([2, 2])]]), stamp, "under");
    const base: AssetSource = { kind: "stored", label: "", tried: [], profile: stamp.profile, stored: (await storedCopy("under"))! };
    const asked: string[] = [];
    setAssetSource({
      kind: "reader", label: "", tried: [], profile: { id: "draft", name: "Draft" },
      reader: { read: (path) => { asked.push(path); return path === "arr/units.dat" ? new Uint8Array([9]) : null; }, base },
    });
    const bytes = async (path: string) => { const res = await fetchAsset(path); return res.ok ? [...new Uint8Array(await res.arrayBuffer())] : res.status; };
    expect(await bytes("arr/units.dat")).toEqual([9]);
    expect(await bytes("arr/flingy.dat")).toEqual([2, 2]);
    expect(await bytes("arr/images.dat")).toBe(404);
    expect(asked).toEqual(["arr/units.dat", "arr/flingy.dat", "arr/images.dat"]);
  });
});
