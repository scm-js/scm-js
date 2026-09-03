import { describe, expect, it } from "vitest";
import { peekTileset, primeTileset, releaseTileset, type LoadedTileset } from "../src/formats/tileset/load";

// A stand-in: `releaseTileset` only touches the loader's maps, never the tileset itself.
const fake = (name: LoadedTileset["name"]): LoadedTileset => ({ name, tileset: {} as never, atlas: {} as never, doodads: {} as never });

describe("tileset cache release", () => {
  it("forgets a decoded tileset and says whether there was one", () => {
    primeTileset(fake("ashworld"));
    expect(peekTileset("ashworld")).not.toBeNull();
    expect(releaseTileset("ashworld")).toBe(true);
    expect(peekTileset("ashworld")).toBeNull();
    expect(releaseTileset("ashworld")).toBe(false);
  });

  it("leaves the others alone", () => {
    primeTileset(fake("install"));
    primeTileset(fake("platform"));
    releaseTileset("install");
    expect(peekTileset("platform")).not.toBeNull();
    releaseTileset("platform");
  });
});
