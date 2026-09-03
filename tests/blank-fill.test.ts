import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createStore } from "jotai";
import { scenarioAtom } from "../src/atoms/documentAtoms";
import { blankFillAtom } from "../src/atoms/gameDataAtoms";
import { mapFilePathAtom, mapModifiedAtom } from "../src/atoms/editorAtoms";
import { loadTileset } from "../src/formats/tileset/decode";
import { primeTileset, releaseTileset, type LoadedTileset } from "../src/formats/tileset/load";
import { NO_DOODADS } from "../src/formats/tileset/doodads";
import { DEFAULT_NEW_MAP, newMapInto, relayBlankTerrain } from "../src/hooks/useMapFileActions";

/**
 * A blank map made while the editor has no graphics is filled with variation 0 everywhere
 * — `flatTerrain` has no CV5 to pick from — so it draws as one megatile repeated across
 * the whole map once an install lands. `relayBlankTerrain` is what lays it again.
 */
const TILESET_DIR = join(__dirname, "..", "public", "tileset");
const have = ["cv5", "vf4", "vr4", "vx4", "wpe"].every((ext) => existsSync(join(TILESET_DIR, `badlands.${ext}`)));

/** The variation slot of every tile, deduplicated. */
const slots = (tiles: Uint16Array) => new Set(Array.from(tiles, (t) => t & 0xf));

if (have) describe("re-laying a blank map when the graphics arrive", () => {
  const part = (ext: string) => new Uint8Array(readFileSync(join(TILESET_DIR, `badlands.${ext}`)));
  const tileset = loadTileset({ cv5: part("cv5"), vf4: part("vf4"), vr4: part("vr4"), vx4: part("vx4"), wpe: part("wpe") });
  const loaded: LoadedTileset = {
    name: "badlands",
    tileset,
    atlas: { image: {} as CanvasImageSource, columns: 1, tileSize: 32, count: tileset.megatileCount, averages: new Uint32Array(tileset.megatileCount), animation: null },
    doodads: NO_DOODADS,
  };

  /** A map made with no tileset in the cache, as the editor does before an install. */
  async function blankStore() {
    releaseTileset("badlands");
    const store = createStore();
    await newMapInto(store, { ...DEFAULT_NEW_MAP, width: 32, height: 32 });
    return store;
  }

  it("fills with variation 0 and records that it did", async () => {
    const store = await blankStore();
    const scn = store.get(scenarioAtom)!;
    expect(slots(scn.tiles)).toEqual(new Set([0]));
    expect(store.get(blankFillAtom)).not.toBeNull();
    releaseTileset("badlands");
  });

  it("lays the terrain again once the tileset is there", async () => {
    const store = await blankStore();
    const scn = store.get(scenarioAtom)!;
    primeTileset(loaded);

    expect(await relayBlankTerrain(store)).toBe(true);
    expect(store.get(scenarioAtom)).toBe(scn); // the same document, re-laid in place
    expect(slots(scn.tiles).size).toBeGreaterThan(1);
    expect(scn.dirty.has("MTXM")).toBe(true);
    // Still the map the editor made for itself.
    expect(store.get(mapModifiedAtom)).toBe(false);
    // And only once.
    expect(store.get(blankFillAtom)).toBeNull();
    expect(await relayBlankTerrain(store)).toBe(false);
    releaseTileset("badlands");
  });

  it("leaves a map the user has touched alone", async () => {
    const store = await blankStore();
    primeTileset(loaded);
    store.set(mapModifiedAtom, true);
    expect(await relayBlankTerrain(store)).toBe(false);
    expect(slots(store.get(scenarioAtom)!.tiles)).toEqual(new Set([0]));
    releaseTileset("badlands");
  });

  it("leaves a map that came from a file alone", async () => {
    const store = await blankStore();
    primeTileset(loaded);
    store.set(mapFilePathAtom, "somewhere.scx");
    expect(await relayBlankTerrain(store)).toBe(false);
    releaseTileset("badlands");
  });

  it("does nothing when the map was laid with the graphics in place", async () => {
    releaseTileset("badlands");
    primeTileset(loaded);
    const store = createStore();
    await newMapInto(store, { ...DEFAULT_NEW_MAP, width: 32, height: 32 });
    expect(slots(store.get(scenarioAtom)!.tiles).size).toBeGreaterThan(1);
    expect(store.get(blankFillAtom)).toBeNull();
    expect(await relayBlankTerrain(store)).toBe(false);
    releaseTileset("badlands");
  });
});
