import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario } from "../src/formats/chk/scenario";
import {
  ALL_FOG_PLAYERS, applyFogChanges, copyFog, defaultMask, ensureMask, fillFog, floodFog, fogByte, fogCount, fogPlayersAt,
  invertFog, isFogged, paintFog, paintFogAt, playerBit,
} from "../src/editor/fog";
import { Stroke } from "../src/editor/terrain";

/** A blank map with the "just created" dirty set cleared, so the tests see only their own marks. */
function fresh(width = 8, height = 8) {
  const scn = createScenario({ name: "t", description: "", width, height, tileset: 4 });
  scn.dirty.clear();
  return scn;
}

/** A blank map that still serialises every section a new file needs (DIM included). */
function whole(width: number, height: number) {
  return createScenario({ name: "t", description: "", width, height, tileset: 4 });
}

describe("fog bytes", () => {
  it("sets and clears player bits without touching the others", () => {
    expect(fogByte(0x00, playerBit(0), "fog")).toBe(0x01);
    expect(fogByte(0xff, playerBit(2) | playerBit(7), "clear")).toBe(0x7b);
    expect(fogByte(0x0f, 0x03, "fog")).toBe(0x0f);
  });

  it("treats a map without MASK as fogged for everyone, and creates the 0xFF section on demand", () => {
    const scn = fresh();
    expect(scn.mask).toBeNull();
    expect(isFogged(scn, 5, 3)).toBe(true);
    expect(fogCount(scn, 0)).toBe(64);
    expect(fogPlayersAt(scn, 1, 1)).toBe(ALL_FOG_PLAYERS);
    expect(paintFogAt(scn, 0, 0, 1, 1, "clear")).toEqual([]); // nothing to write to yet

    const created = ensureMask(scn);
    expect(created).toBe(scn.mask);
    expect(scn.dirty.has("MASK")).toBe(true);
    expect([...scn.mask!].every((b) => b === 0xff)).toBe(true);
    expect(ensureMask(scn)).toBeNull();
    expect(defaultMask(2, 3)).toEqual(new Uint8Array([255, 255, 255, 255, 255, 255]));
  });
});

describe("fog brush", () => {
  it("clears a brush footprint for the chosen players and undoes it", () => {
    const scn = fresh();
    ensureMask(scn);
    scn.dirty.clear();
    const changes = paintFogAt(scn, 3, 3, 3, playerBit(0) | playerBit(1), "clear");
    expect(changes).toHaveLength(9);
    expect(changes.map((c) => c.at).sort((a, b) => a - b)).toEqual([18, 19, 20, 26, 27, 28, 34, 35, 36]);
    expect(changes.every((c) => c.before === 0xff && c.after === 0xfc)).toBe(true);
    applyFogChanges(scn, changes);
    expect(scn.dirty.has("MASK")).toBe(true);
    expect(isFogged(scn, 27, 0)).toBe(false);
    expect(isFogged(scn, 27, 1)).toBe(false);
    expect(isFogged(scn, 27, 2)).toBe(true);
    expect(fogCount(scn, 0)).toBe(55);
    expect(fogPlayersAt(scn, 3, 3)).toBe(0xfc);

    applyFogChanges(scn, changes, "undo");
    expect(fogCount(scn, 0)).toBe(64);
  });

  it("clips the brush to the map and skips tiles already in the target state", () => {
    const scn = fresh();
    ensureMask(scn);
    expect(paintFogAt(scn, 0, 0, 5, 0xff, "clear")).toHaveLength(9); // 3x3 survives at the corner
    expect(paintFogAt(scn, 0, 0, 5, 0xff, "fog")).toEqual([]);
    expect(paintFog(scn, [], 0xff, "clear")).toEqual([]);
    expect(paintFog(scn, [0, 1], 0, "clear")).toEqual([]); // no players ticked
  });

  it("folds repeated strokes over a tile into one net change", () => {
    const scn = fresh();
    ensureMask(scn);
    const stroke = new Stroke();
    let c = paintFogAt(scn, 1, 1, 1, 0x01, "clear");
    applyFogChanges(scn, c);
    stroke.add(c);
    c = paintFogAt(scn, 1, 1, 1, 0x01, "fog");
    applyFogChanges(scn, c);
    stroke.add(c);
    expect(stroke.finish()).toEqual([]);
  });
});

describe("whole-map fog operations", () => {
  it("fills, inverts and copies between players", () => {
    const scn = fresh(4, 2);
    ensureMask(scn);
    applyFogChanges(scn, fillFog(scn, playerBit(0), "clear"));
    expect([...scn.mask!]).toEqual(Array(8).fill(0xfe));
    expect(fillFog(scn, playerBit(0), "clear")).toEqual([]);

    // Fog P1 on the left half only, then hand that layout to P3 and P4.
    applyFogChanges(scn, paintFog(scn, [0, 1, 4, 5], playerBit(0), "fog"));
    const copy = copyFog(scn, 0, playerBit(2) | playerBit(3) | playerBit(0));
    expect(copy).toHaveLength(4); // only the explored tiles change for P3/P4; the source bit is ignored
    applyFogChanges(scn, copy);
    expect([...scn.mask!]).toEqual([0xff, 0xff, 0xf2, 0xf2, 0xff, 0xff, 0xf2, 0xf2]);
    expect(copyFog(scn, 0, playerBit(0))).toEqual([]);

    applyFogChanges(scn, invertFog(scn, playerBit(0)));
    expect([...scn.mask!]).toEqual([0xfe, 0xfe, 0xf3, 0xf3, 0xfe, 0xfe, 0xf3, 0xf3]);
    expect(invertFog(scn, 0)).toEqual([]);
  });

  it("floods the connected area with the same fog state for one player", () => {
    const scn = fresh(4, 4);
    ensureMask(scn);
    // Clear a vertical wall for P1 at x = 1; the left column becomes its own region.
    applyFogChanges(scn, paintFog(scn, [1, 5, 9, 13], playerBit(0), "clear"));
    expect([...floodFog(scn, 0, 0, 0)].sort((a, b) => a - b)).toEqual([0, 4, 8, 12]);
    expect([...floodFog(scn, 1, 2, 0)].sort((a, b) => a - b)).toEqual([1, 5, 9, 13]);
    expect(floodFog(scn, 3, 3, 0).size).toBe(8);
    // P2 never had the wall cleared, so for them the whole map is one region.
    expect(floodFog(scn, 0, 0, 1).size).toBe(16);
    expect(floodFog(scn, -1, 0, 0).size).toBe(0);
  });
});

describe("MASK round trip", () => {
  it("writes the edited section and reads it back", () => {
    const scn = whole(4, 4);
    ensureMask(scn);
    applyFogChanges(scn, paintFogAt(scn, 1, 1, 2, playerBit(1) | playerBit(5), "clear"));
    const back = parseScenario(serializeScenario(scn));
    expect(back.mask).not.toBeNull();
    expect([...back.mask!]).toEqual([...scn.mask!]);
    expect(back.mask![5]).toBe(0xdd);
  });

  it("does not invent a MASK section for a map that never had one", () => {
    const scn = whole(4, 4);
    const created = ensureMask(scn);
    expect(created).not.toBeNull();
    // The equivalent of undoing the stroke that created it.
    scn.mask = null;
    const back = parseScenario(serializeScenario(scn));
    expect(back.mask).toBeNull();
  });
});
