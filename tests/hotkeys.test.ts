import { describe, expect, it } from "vitest";
import {
  COMMANDS, comboOf, conflictsOf, firesWhileTyping, formatCombo, pluginComboAsCommand, reservedReason, resolveHotkeys, shortcutOf, withBinding, type KeyLike,
} from "../src/editor/commands";
import { DEFAULT_PREFERENCES } from "../src/editor/preferences";

const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

describe("hotkey combos", () => {
  it("reads letters from the character, and from the physical key when the character is not one", () => {
    expect(comboOf(key("s", "KeyS", { ctrlKey: true }))).toBe("Ctrl+S");
    // AZERTY: the key labelled A sits where QWERTY has Q.
    expect(comboOf(key("a", "KeyQ", { ctrlKey: true }))).toBe("Ctrl+A");
    // Shift+0 reports ")" on a US layout; a Hangul layout reports the syllable.
    expect(comboOf(key(")", "Digit0", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+0");
    expect(comboOf(key("ㄴ", "KeyS", { ctrlKey: true }))).toBe("Ctrl+S");
  });

  it("treats Cmd as Ctrl and names the awkward keys", () => {
    expect(comboOf(key("z", "KeyZ", { metaKey: true }))).toBe("Ctrl+Z");
    expect(comboOf(key("+", "NumpadAdd", { ctrlKey: true }))).toBe("Ctrl+Plus");
    expect(comboOf(key("-", "Minus", { ctrlKey: true }))).toBe("Ctrl+-");
    expect(comboOf(key("Enter", "Enter", { altKey: true }))).toBe("Alt+Enter");
    expect(comboOf(key("[", "BracketLeft"))).toBe("[");
    expect(comboOf(key("F5", "F5", { ctrlKey: true }))).toBe("Ctrl+F5");
  });

  it("formats combos the way the menus show them", () => {
    expect(formatCombo("Ctrl+-")).toBe("Ctrl+−");
    expect(formatCombo("Ctrl+Plus")).toBe("Ctrl++");
    expect(formatCombo("Shift+ArrowUp")).toBe("Shift+↑");
  });

  it("keeps the keys whose meaning depends on the layer", () => {
    expect(reservedReason("Delete")).not.toBeNull();
    expect(reservedReason("Shift+ArrowLeft")).not.toBeNull();
    expect(reservedReason("Escape")).not.toBeNull();
    expect(reservedReason("Ctrl+Delete")).toBeNull();
    expect(reservedReason("Q")).toBeNull();
  });

  it("lets only modified keys through a text field, and only for commands that allow it", () => {
    const save = COMMANDS.find((c) => c.id === "file.save")!;
    const undo = COMMANDS.find((c) => c.id === "edit.undo")!;
    expect(firesWhileTyping(save, "Ctrl+S")).toBe(true);
    expect(firesWhileTyping(save, "Q")).toBe(false);
    expect(firesWhileTyping(undo, "Ctrl+Z")).toBe(false);
  });

  it("maps a plugin's combo into the same form", () => {
    expect(pluginComboAsCommand("Ctrl+Shift+T")).toBe("Ctrl+Shift+T");
    expect(pluginComboAsCommand("Meta+K")).toBe("Ctrl+K");
    expect(pluginComboAsCommand("Ctrl++")).toBe("Ctrl+Plus");
  });
});

describe("resolving the bindings", () => {
  it("has unique command ids and no two defaults on the same keys", () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const desktop of [true, false]) {
      const seen = new Set<string>();
      for (const c of COMMANDS) for (const k of desktop ? c.defaults : (c.webDefaults ?? c.defaults)) {
        expect(seen.has(k), `${k} twice`).toBe(false);
        expect(reservedReason(k), k).toBeNull();
        seen.add(k);
      }
    }
  });

  it("starts on the defaults, with the browser leaving out what it keeps for itself", () => {
    const web = resolveHotkeys(DEFAULT_PREFERENCES.hotkeys, false);
    const app = resolveHotkeys(DEFAULT_PREFERENCES.hotkeys, true);
    expect(web.byCombo.get("Ctrl+S")).toBe("file.save");
    expect(web.byCommand["edit.redo"]).toEqual(["Ctrl+Y", "Ctrl+Shift+Z"]);
    expect(web.byCombo.has("Ctrl+Tab")).toBe(false);
    expect(app.byCombo.get("Ctrl+Tab")).toBe("window.next");
    expect(shortcutOf(web, "view.zoomOut")).toBe("Ctrl+−");
    expect(shortcutOf(web, "window.next")).toBeUndefined();
  });

  it("puts an override in place of the defaults, and an empty one unbinds", () => {
    const r = resolveHotkeys({ "edit.find": ["Ctrl+Shift+F"], "view.grid": [] }, false);
    expect(r.byCommand["edit.find"]).toEqual(["Ctrl+Shift+F"]);
    expect(r.byCombo.has("Ctrl+F")).toBe(false);
    expect(r.byCombo.has("Ctrl+G")).toBe(false);
    expect(shortcutOf(r, "view.grid")).toBeUndefined();
  });

  it("drops an override that is back on the defaults", () => {
    const o = withBinding({}, "edit.find", ["Ctrl+Shift+F"], false);
    expect(o).toEqual({ "edit.find": ["Ctrl+Shift+F"] });
    expect(withBinding(o, "edit.find", ["Ctrl+F"], false)).toEqual({});
    expect(withBinding(o, "edit.find", null, false)).toEqual({});
    expect(withBinding({}, "window.next", ["Alt+PageDown"], false)).toEqual({ "window.next": ["Alt+PageDown"] });
  });

  it("gives the first command a shared combo and reports the clash on both", () => {
    const r = resolveHotkeys({ "edit.find": ["Ctrl+S"] }, false);
    expect(r.byCombo.get("Ctrl+S")).toBe("file.save");
    expect(conflictsOf("edit.find", r, [])).toEqual([{ combo: "Ctrl+S", commands: ["file.save"], plugins: [] }]);
    expect(conflictsOf("file.save", r, [{ combo: "Ctrl+S", plugin: "Some Plugin" }])).toEqual([{ combo: "Ctrl+S", commands: ["edit.find"], plugins: ["Some Plugin"] }]);
    expect(conflictsOf("edit.undo", r, [])).toEqual([]);
  });

  it("ignores a stored value that is not a list", () => {
    const r = resolveHotkeys({ "edit.find": "Ctrl+Q" as never }, false);
    expect(r.byCommand["edit.find"]).toEqual(["Ctrl+F"]);
  });
});
