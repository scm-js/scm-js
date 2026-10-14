import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { pluginFileTypesAtom } from "../src/atoms/pluginAtoms";
import { handFilesToPlugins, pickerFileTypes } from "../src/plugins/fileTypes";
import { Contributions, createPluginApi } from "../src/plugins/host";

const file = (name: string) => new File([new Uint8Array(4)], name);

describe("kinds of file plugins open", () => {
  it("hands claimed files to their plugin together, and leaves the rest for the editor", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "replays", name: "Replays", source: "s" }, new Contributions());
    const got: string[][] = [];
    api.ui.fileType({ name: "StarCraft replay", extensions: ["REP"], open: (files) => { got.push(files.map((f) => f.name)); } });
    const rest = handFilesToPlugins(store, [file("a.rep"), file("Lost Temple.scx"), file("b.Rep")]);
    expect(got).toEqual([["a.rep", "b.Rep"]]);
    expect(rest.map((f) => f.name)).toEqual(["Lost Temple.scx"]);
    expect(pickerFileTypes(store)).toEqual([{ description: "StarCraft replay", extensions: [".rep"] }]);
  });

  it("never gives away the editor's own maps, keeps the first claim, and lets go when disposed", () => {
    const store = createStore();
    const a = createPluginApi(store, { id: "a", name: "A", source: "s" }, new Contributions());
    const b = createPluginApi(store, { id: "b", name: "B", source: "s" }, new Contributions());
    const seen: string[] = [];
    const first = a.ui.fileType({ name: "A's", extensions: [".rep", ".scx"], open: () => { seen.push("a"); } });
    b.ui.fileType({ name: "B's", extensions: [".rep", ".bin"], open: () => { seen.push("b"); } });
    expect(store.get(pluginFileTypesAtom).map((t) => [t.plugin.id, t.extensions])).toEqual([["a", [".rep"]], ["b", [".bin"]]]);
    expect(handFilesToPlugins(store, [file("x.scx")]).length).toBe(1);
    handFilesToPlugins(store, [file("x.rep")]);
    expect(seen).toEqual(["a"]);
    first.dispose();
    expect(handFilesToPlugins(store, [file("x.rep")]).map((f) => f.name)).toEqual(["x.rep"]);
  });

  it("keeps going when a plugin's open throws", () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "p", name: "P", source: "s" }, new Contributions());
    api.ui.fileType({ name: "Broken", extensions: [".rep"], open: () => { throw new Error("no"); } });
    expect(handFilesToPlugins(store, [file("x.rep")])).toEqual([]);
  });
});
