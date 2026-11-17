/**
 * What the installer page leaves in storage for the editor (`gamedata/remasteredDefault.ts`):
 * Remastered graphics on (in the View menu's remembered ticks), the data set chosen when the copy went in beside another, and
 * nothing else of the preferences touched.
 */
import { describe, expect, it } from "vitest";
import { PROFILE_KEY, REMASTERED_PROFILE } from "../src/gamedata/profiles";
import { startWithRemastered } from "../src/gamedata/remasteredDefault";
import { VIEW_MEMORY_KEY } from "../src/editor/viewMemory";

const store = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
};

describe("the editor after an installation made elsewhere", () => {
  it("turns Remastered graphics on and keeps the other ticks and preferences", () => {
    const s = store({ "scmjs.prefs": '{"language":"ko"}', [VIEW_MEMORY_KEY]: '{"grid":true,"hdGraphics":false}' });
    startWithRemastered(s);
    expect(JSON.parse(s.map.get(VIEW_MEMORY_KEY)!)).toEqual({ grid: true, hdGraphics: true });
    expect(JSON.parse(s.map.get("scmjs.prefs")!)).toEqual({ language: "ko" });
    expect(s.map.has(PROFILE_KEY)).toBe(false);
  });

  it("carries an older version's choices over first, and does not lose them", () => {
    const s = store({ "scmjs.prefs": '{"language":"ko","animateWater":false,"animateUnits":true,"hdGraphics":false}' });
    startWithRemastered(s);
    expect(JSON.parse(s.map.get(VIEW_MEMORY_KEY)!)).toEqual({ animateWater: false, hdGraphics: true });
    expect(JSON.parse(s.map.get("scmjs.prefs")!)).toEqual({ language: "ko" });
  });

  it("chooses the data set when the copy went in beside another", () => {
    const s = store();
    startWithRemastered(s, REMASTERED_PROFILE.id);
    expect(JSON.parse(s.map.get(VIEW_MEMORY_KEY)!)).toEqual({ hdGraphics: true });
    expect(s.map.has("scmjs.prefs")).toBe(false);
    expect(JSON.parse(s.map.get(PROFILE_KEY)!)).toEqual({ profile: REMASTERED_PROFILE.id });
  });

  it("survives stored values that are not what they should be, and storage that refuses", () => {
    const s = store({ "scmjs.prefs": "[1", [VIEW_MEMORY_KEY]: "[1" });
    startWithRemastered(s);
    expect(JSON.parse(s.map.get(VIEW_MEMORY_KEY)!)).toEqual({ hdGraphics: true });
    expect(s.map.get("scmjs.prefs")).toBe("[1");
    expect(() => startWithRemastered({ getItem: () => null, setItem: () => { throw new Error("full"); } })).not.toThrow();
  });
});
