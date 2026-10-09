import { describe, expect, it } from "vitest";
import {
  beginAreaGesture, beginLocationGesture, beginObjectGesture, beginStrokeGesture, objectGestureOn,
  type LocationLayer, type ObjectLayer, type PointerSample,
} from "../src/components/viewport/gestures";

/** The pointer over a map pixel of a 64×64 map at 100%, with the clamped copies a gesture is handed. */
function at(px: number, py: number, shift = false): PointerSample {
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
  const point = { px, py };
  const mapPoint = { px: clamp(px, 64 * 32 - 1), py: clamp(py, 64 * 32 - 1) };
  return {
    point, mapPoint,
    tile: { x: Math.floor(px / 32), y: Math.floor(py / 32) },
    mapTile: { x: Math.floor(mapPoint.px / 32), y: Math.floor(mapPoint.py / 32) },
    shift, zoom: 1,
  };
}

/** An object layer that writes down what it was asked to do; `objectAt` is the index a press hits. */
function objects(opts: { objectAt?: number; placing?: boolean; selected?: number[] } = {}) {
  const calls: string[] = [];
  const layer: ObjectLayer = {
    id: "units",
    placing: opts.placing ?? false,
    pickAt: () => opts.objectAt ?? -1,
    isSelected: (i) => (opts.selected ?? []).includes(i),
    select: (indices, additive) => { calls.push(`select ${JSON.stringify(indices)}${additive ? " +" : ""}`); },
    beginDrag: (p) => { calls.push(`beginDrag ${p.px},${p.py}`); },
    dragTo: (p) => { calls.push(`dragTo ${p.px},${p.py}`); },
    endDrag: () => { calls.push("endDrag"); },
    selectInBox: (a, b, additive) => { calls.push(`box ${a.px},${a.py} ${b.px},${b.py}${additive ? " +" : ""}`); },
    placeAt: (p) => { calls.push(`place ${p.px},${p.py}`); },
  };
  return { layer, calls };
}

describe("an object-layer gesture", () => {
  it("selects the object under a press and drags the selection", () => {
    const { layer, calls } = objects({ objectAt: 3 });
    const g = beginObjectGesture(layer, at(100, 100));
    expect(g.mode).toBe("move");
    g.move(at(140, 120));
    g.up();
    expect(calls).toEqual(["select [3]", "beginDrag 100,100", "dragTo 140,120", "endDrag"]);
  });

  it("leaves a selection it presses inside alone, and toggles with shift", () => {
    const kept = objects({ objectAt: 3, selected: [2, 3] });
    beginObjectGesture(kept.layer, at(100, 100));
    expect(kept.calls).toEqual(["beginDrag 100,100"]);
    const toggled = objects({ objectAt: 3, selected: [2, 3] });
    beginObjectGesture(toggled.layer, at(100, 100, true));
    expect(toggled.calls).toEqual(["select [3] +", "beginDrag 100,100"]);
  });

  it("places on a click while placing, and only clears the selection otherwise", () => {
    const placing = objects({ placing: true });
    const click = beginObjectGesture(placing.layer, at(100, 100));
    click.move(at(102, 101));
    click.up();
    expect(placing.calls).toEqual(["select []", "place 100,100"]);
    const selecting = objects();
    beginObjectGesture(selecting.layer, at(100, 100)).up();
    expect(selecting.calls).toEqual(["select []"]);
  });

  it("becomes a marquee once the press has travelled, by distance on screen", () => {
    const { layer, calls } = objects({ placing: true });
    const g = beginObjectGesture(layer, at(100, 100, true));
    g.move(at(103, 100));
    expect(g.mode).toBe("click");
    // Three map pixels are six on screen at 200%.
    g.move({ ...at(103, 100), zoom: 2 });
    expect(g.mode).toBe("marquee");
    g.move(at(300, 260));
    g.up();
    expect(calls).toEqual(["box 100,100 300,260 +"]);
  });

  it("follows the edge of the map when the pointer leaves it", () => {
    const { layer, calls } = objects({ objectAt: 0 });
    const g = beginObjectGesture(layer, at(100, 100));
    g.move(at(-50, 5000));
    expect(calls.at(-1)).toBe("dragTo 0,2047");
  });

  it("is found by the layer it belongs to", () => {
    const g = beginObjectGesture(objects().layer, at(0, 0));
    expect(objectGestureOn(g, "units")).toBe(g);
    expect(objectGestureOn(g, "doodads")).toBeNull();
    expect(objectGestureOn(null, "units")).toBeNull();
  });
});

describe("a location gesture", () => {
  function locations(opts: { handle?: boolean; locationAt?: number; selected?: number[] } = {}) {
    const calls: string[] = [];
    const layer: LocationLayer = {
      selected: opts.selected ?? [],
      handleAtPoint: () => (opts.handle ? "se" : null) as ReturnType<LocationLayer["handleAtPoint"]>,
      pickAt: () => opts.locationAt ?? -1,
      select: (indices, additive) => { calls.push(`select ${JSON.stringify(indices)}${additive ? " +" : ""}`); },
      beginResize: (index, handle) => { calls.push(`beginResize ${index} ${handle}`); },
      beginMove: (p) => { calls.push(`beginMove ${p.px},${p.py}`); },
      dragTo: (p) => { calls.push(`dragTo ${p.px},${p.py}`); },
      endDrag: () => { calls.push("endDrag"); },
      dragRect: (a, b) => ({ left: a.px, top: a.py, right: b.px, bottom: b.py }),
      create: (box) => { calls.push(`create ${box.left},${box.top} ${box.right},${box.bottom}`); },
    };
    return { layer, calls };
  }

  it("resizes from a handle ahead of anything under it", () => {
    const { layer, calls } = locations({ handle: true, locationAt: 5, selected: [7] });
    const g = beginLocationGesture(layer, at(64, 64));
    g.move(at(96, 96));
    g.up();
    expect(g.mode).toBe("resize");
    expect(calls).toEqual(["beginResize 7 se", "dragTo 96,96", "endDrag"]);
  });

  it("moves the location it presses", () => {
    const { layer, calls } = locations({ locationAt: 5 });
    const g = beginLocationGesture(layer, at(64, 64));
    g.up();
    expect(calls).toEqual(["select [5]", "beginMove 64,64", "endDrag"]);
  });

  it("creates on a drag over empty ground and clears the selection on a click there", () => {
    const dragged = locations();
    const g = beginLocationGesture(dragged.layer, at(64, 64));
    g.move(at(160, 128));
    expect(g.mode).toBe("create");
    g.up();
    expect(dragged.calls).toEqual(["create 64,64 160,128"]);
    const clicked = locations();
    beginLocationGesture(clicked.layer, at(64, 64)).up();
    expect(clicked.calls).toEqual(["select []"]);
    const shifted = locations();
    beginLocationGesture(shifted.layer, at(64, 64, true)).up();
    expect(shifted.calls).toEqual([]);
  });
});

describe("an area gesture", () => {
  it("reports the block at the press, at each tile crossed, and on the release", () => {
    const seen: string[] = [];
    const show = (r: { x0: number; y0: number; x1: number; y1: number }) => `${r.x0},${r.y0}-${r.x1},${r.y1}`;
    const g = beginAreaGesture("clip", at(70, 70), { change: (r) => seen.push(show(r)), done: (r, last) => seen.push(`done ${show(r)} at ${last.x},${last.y}`) });
    g.move(at(80, 80));
    g.move(at(5, 5));
    g.move(at(-400, 40));
    g.up();
    // Exclusive on the far side, whichever way the drag went, and kept on the map.
    expect(seen).toEqual(["2,2-3,3", "0,0-3,3", "0,1-3,3", "done 0,1-3,3 at 0,1"]);
  });

  it("says nothing until the release when nobody is following", () => {
    const seen: string[] = [];
    const g = beginAreaGesture("pick", at(70, 70), { done: (r) => seen.push(`${r.x1 - r.x0}×${r.y1 - r.y0}`) });
    g.move(at(200, 135));
    expect(seen).toEqual([]);
    g.up();
    expect(seen).toEqual(["5×3"]);
  });
});

describe("a stroke", () => {
  function brush(everyMove: boolean) {
    const calls: string[] = [];
    return {
      calls,
      brush: {
        everyMove,
        begin: (s: PointerSample) => { calls.push(`begin ${s.tile.x},${s.tile.y}`); },
        paintAt: (x: number, y: number, p?: { px: number; py: number }) => { calls.push(`paint ${x},${y}${p ? ` @${p.px},${p.py}` : ""}`); },
        end: () => { calls.push("end"); },
      },
    };
  }

  it("paints every tile on the line from the last one, once per tile crossed", () => {
    const { brush: b, calls } = brush(false);
    const g = beginStrokeGesture(b, at(40, 40));
    g.move(at(50, 50));
    g.move(at(140, 40));
    g.up();
    expect(calls).toEqual(["begin 1,1", "paint 2,1", "paint 3,1", "paint 4,1", "end"]);
    expect(g.last).toEqual({ x: 4, y: 1 });
  });

  it("forwards every move, with the pointer, to a brush that asks for it", () => {
    const { brush: b, calls } = brush(true);
    const g = beginStrokeGesture(b, at(40, 40));
    g.move(at(50, 50));
    g.move(at(-10, 50));
    expect(calls).toEqual(["begin 1,1", "paint 1,1 @50,50", "paint 0,1 @0,50"]);
  });
});
