import { describe, expect, it } from "vitest";
import { filterTerms, hotkeyRowMatches, keyMatches, pluginPagesInOrder, textMatches } from "../src/components/dialogs/preferencesFilter";
import { COMMANDS, formatCombo, resolveHotkeys } from "../src/app/commands";

describe("Preferences' filter: sections", () => {
  it("ignores case and spacing, and needs every word", () => {
    expect(textMatches("Snap locations to the grid (32 px)", "GRID")).toBe(true);
    expect(textMatches("Snap locations to the grid (32 px)", "  snap   grid ")).toBe(true);
    expect(textMatches("Snap locations to the grid (32 px)", "snap doodads")).toBe(false);
    expect(filterTerms("   ")).toEqual([]);
    expect(textMatches("anything", "")).toBe(true);
  });

  it("works on Korean text as shown, whichever way the syllables were composed", () => {
    const shown = "격자 간격 8 px (미니 타일) 색상 스타일";
    expect(textMatches(shown, "격자")).toBe(true);
    expect(textMatches(shown, "간격 색상")).toBe(true);
    expect(textMatches(shown, "격자".normalize("NFD"))).toBe(true);
    expect(textMatches(shown, "애니메이션")).toBe(false);
  });

  it("finds nothing when nothing holds the words", () => {
    expect(textMatches("Mouse wheel Scrolls the map; Ctrl+wheel zooms", "xyzzy")).toBe(false);
  });
});

describe("Preferences' filter: the Hotkeys page", () => {
  const resolved = resolveHotkeys({}, true);
  const matching = (query: string) =>
    COMMANDS.filter((c) => hotkeyRowMatches(c.label, (resolved.byCommand[c.id] ?? []).map(formatCombo), query)).map((c) => c.id);

  it("finds a command by its name", () => {
    expect(matching("save as")).toEqual(["file.saveAs"]);
    expect(matching("SAVE")).toContain("file.save");
  });

  it("finds a command by its keys as displayed, the whole key and not a longer one", () => {
    expect(matching("Ctrl+S")).toEqual(["file.save"]);
    expect(matching("ctrl + shift + s")).toEqual(["file.saveAs"]);
    expect(matching("Ctrl+Shift").every((id) => (resolved.byCommand[id] ?? []).some((k) => k.startsWith("Ctrl+Shift+")))).toBe(true);
  });

  it("reads a key from its start up to a +", () => {
    expect(keyMatches("Ctrl+Shift+S", "ctrl")).toBe(true);
    expect(keyMatches("Ctrl+Shift+S", "Ctrl+")).toBe(true);
    expect(keyMatches("Ctrl+Shift+S", "Ctrl+S")).toBe(false);
    expect(keyMatches("Ctrl++", "ctrl++")).toBe(true);
    expect(keyMatches("Ctrl+−", "ctrl+-")).toBe(true);
    expect(keyMatches("F1", "")).toBe(false);
  });

  it("matches a translated name and keeps every row for an empty box", () => {
    expect(hotkeyRowMatches("다른 이름으로 저장", ["Ctrl+Shift+S"], "저장")).toBe(true);
    expect(hotkeyRowMatches("다른 이름으로 저장", ["Ctrl+Shift+S"], "")).toBe(true);
    expect(matching("xyzzy")).toEqual([]);
  });
});

describe("Preferences: the plugins' pages", () => {
  const page = (name: string) => ({ key: name, plugin: { name } });

  it("lists them by name, whatever order the plugins loaded in", () => {
    const loaded = [page("TrigScript"), page("Aftermath"), page("scmjs.dev"), page("Repair"), page("aftermath 2"), page("Stamp 10"), page("Stamp 9")];
    expect(pluginPagesInOrder(loaded).map((e) => e.plugin.name)).toEqual(["Aftermath", "aftermath 2", "Repair", "scmjs.dev", "Stamp 9", "Stamp 10", "TrigScript"]);
  });

  it("leaves the list it was given as it was", () => {
    const loaded = [page("B"), page("A")];
    pluginPagesInOrder(loaded);
    expect(loaded.map((e) => e.plugin.name)).toEqual(["B", "A"]);
  });
});
