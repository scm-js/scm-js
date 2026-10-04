import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { ActionType } from "../src/formats/chk/sections/triggers";
import { triggerComment, withComment } from "../src/formats/triggers/text";
import {
  applyTriggers, draftTriggerNames, newAction, newStringDrafts, newTrigger, readTriggers, resolveDraftStrings, triggerNames,
} from "../src/editor/triggers";

/** What the Classic editor does to a text argument: one `intern` per keystroke. */
function type(names: { intern(text: string): number }, text: string): number {
  let index = 0;
  for (let i = 1; i <= text.length; i++) index = names.intern(text.slice(0, i));
  return index;
}

describe("trigger editor draft strings", () => {
  const setup = () => {
    const scn = createScenario({ width: 64, height: 64, era: 0, name: "drafts" });
    scn.dirty.clear();
    const drafts = newStringDrafts();
    return { scn, drafts, names: draftTriggerNames(scn, triggerNames(scn), drafts) };
  };

  it("typing leaves the map's string table alone", () => {
    const { scn, names } = setup();
    const before = scn.strings.strings.slice();
    const index = type(names, "Hello, commander");
    expect(index).toBeLessThan(0);
    expect(names.string(index)).toBe("Hello, commander");
    expect(scn.strings.strings).toEqual(before);
    expect(scn.dirty.size).toBe(0);
  });

  it("answers with the map's own index for a string it already holds", () => {
    const { scn, names } = setup();
    const real = triggerNames(scn).intern("already here");
    expect(names.intern("already here")).toBe(real);
    expect(names.intern("")).toBe(0);
  });

  it("interns only what the applied list still refers to", () => {
    const { scn, drafts, names } = setup();
    const before = scn.strings.strings.length;
    const display = { ...newAction(ActionType.DisplayText), text: type(names, "Hello") };
    const list = [{ ...withComment(newTrigger(), "intro", names), actions: [...withComment(newTrigger(), "intro", names).actions, display] }];
    type(names, "abandoned"); // typed, then the action was deleted

    const resolved = resolveDraftStrings(scn, list, drafts);
    expect(scn.strings.strings.length).toBe(before + 2);
    expect(resolved[0].actions.every((a) => a.text >= 0 && a.wav >= 0)).toBe(true);
    const plain = triggerNames(scn);
    expect(triggerComment(resolved[0], plain)).toBe("intro");
    expect(plain.string(resolved[0].actions[1].text)).toBe("Hello");
    expect(scn.strings.strings).not.toContain("abandoned");
    expect(scn.strings.strings).not.toContain("Hell");

    applyTriggers(scn, resolved);
    expect(readTriggers(scn)).toEqual(resolved);
    // Applied again there is nothing left to resolve, and the working copy is handed back as it is.
    expect(resolveDraftStrings(scn, resolved, drafts)).toBe(resolved);
    expect(names.intern("Hello")).toBe(resolved[0].actions[1].text);
  });
});
