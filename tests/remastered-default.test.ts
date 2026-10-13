/**
 * What the installer page leaves in storage for the editor (`gamedata/remasteredDefault.ts`):
 * Remastered graphics on, the data set chosen when the copy went in beside another, and
 * nothing else of the preferences touched.
 */
import { describe, expect, it } from "vitest";
import { PROFILE_KEY, REMASTERED_PROFILE } from "../src/gamedata/profiles";
import { startWithRemastered } from "../src/gamedata/remasteredDefault";

const store = (init: Record<string, string> = {}) => {
  const map = new Map(Object.entries(init));
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); } };
};

describe("the editor after an installation made elsewhere", () => {
  it("turns Remastered graphics on and keeps the other preferences", () => {
    const s = store({ "scmjs.prefs": '{"language":"ko","hdGraphics":false}' });
    startWithRemastered(s);
    expect(JSON.parse(s.map.get("scmjs.prefs")!)).toEqual({ language: "ko", hdGraphics: true });
    expect(s.map.has(PROFILE_KEY)).toBe(false);
  });

  it("chooses the data set when the copy went in beside another", () => {
    const s = store();
    startWithRemastered(s, REMASTERED_PROFILE.id);
    expect(JSON.parse(s.map.get("scmjs.prefs")!)).toEqual({ hdGraphics: true });
    expect(JSON.parse(s.map.get(PROFILE_KEY)!)).toEqual({ profile: REMASTERED_PROFILE.id });
  });

  it("survives preferences that are not preferences, and storage that refuses", () => {
    const s = store({ "scmjs.prefs": "[1" });
    startWithRemastered(s);
    expect(JSON.parse(s.map.get("scmjs.prefs")!)).toEqual({ hdGraphics: true });
    expect(() => startWithRemastered({ getItem: () => null, setItem: () => { throw new Error("full"); } })).not.toThrow();
  });
});
