import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { scenarioName, serializeScenario, setScenarioName } from "../src/formats/chk/scenario";
import {
  activateDocumentAtom, commitEditAtom, commitSettingsAtom, loadDocumentAtom, recentFilesAtom, redoAtom, scenarioAtom, undoAtom, undoStackAtom, viewOnlyAtom,
} from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { dialogStackAtom, openDialogAtom, statusMessageAtom } from "../src/atoms/uiAtoms";
import { applyChanges } from "../src/editor/terrain";
import { DEFAULT_SAVE_OPTIONS } from "../src/editor/save";
import { editCopyIn, saveDocument, type SaveWriter } from "../src/hooks/useMapFileActions";
import { Contributions, createPluginApi } from "../src/plugins/host";

const scn = (name: string) => createScenario({ width: 8, height: 6, era: 0, name });
const bytes = (name: string) => serializeScenario(scn(name));

/** An ordinary map `a` from a file, and the replay's map opened beside it through the plugin API. */
async function withReplay() {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: scn("a"), extras: new Map(), fileName: "a.scx" });
  const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
  expect(await api.document.open(bytes("Lost Temple"), "Lost Temple.scx", { into: "current", viewOnly: { label: "Replay" } })).toBe(true);
  return { store, api };
}

describe("a map open to view only", () => {
  it("opens beside the open map whatever `into` says, is listed as view-only, and stays out of Open Recent", async () => {
    const { store, api } = await withReplay();
    expect(api.document.list().map((d) => [d.name, d.viewOnly, d.active])).toEqual([["a", false, false], ["Lost Temple", true, true]]);
    expect(api.document.info()).toMatchObject({ name: "Lost Temple", viewOnly: true, modified: false });
    expect(store.get(viewOnlyAtom)).toEqual({ label: "Replay" });
    expect(store.get(recentFilesAtom).map((r) => r.name)).toEqual(["a.scx"]);
  });

  it("refuses every plugin write in words, and nothing reaches the map or the history", async () => {
    const { store, api } = await withReplay();
    expect(() => api.document.edit("Paint", () => {})).toThrow(/Replay is open to view only/);
    expect(() => api.document.update("Rename", (tx) => tx.properties({ name: "x" }))).toThrow(/view only/);
    expect(() => api.document.sections.write(0, new Uint8Array(4))).toThrow(/view only/);
    expect(() => api.document.resize({ width: 16, height: 16 })).toThrow(/view only/);
    expect(api.document.undo()).toBeNull();
    expect(scenarioName(store.get(scenarioAtom)!)).toBe("Lost Temple");
    expect(store.get(mapModifiedAtom)).toBe(false);
  });

  it("takes back an edit that reached the commit anyway, and a dialog's write to the tables", async () => {
    const { store } = await withReplay();
    const map = store.get(scenarioAtom)!;
    const was = map.tiles[0];
    const changes = [{ at: 0, before: was, after: was + 1 }];
    applyChanges(map, changes);
    expect(map.tiles[0]).toBe(was + 1);
    store.set(commitEditAtom, { label: "stroke", changes });
    expect(map.tiles[0]).toBe(was);
    expect(store.get(undoStackAtom)).toEqual([]);
    expect(store.get(statusMessageAtom)).toMatch(/view only/);

    setScenarioName(map, "Renamed");
    store.set(commitSettingsAtom);
    expect(scenarioName(map)).toBe("Lost Temple");
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(undoAtom)).toBeNull();
    expect(store.set(redoAtom)).toBeNull();
  });

  it("goes with its map across a switch, and the other map stays writable", async () => {
    const { store, api } = await withReplay();
    const [a, replay] = api.document.list().map((d) => d.id);
    store.set(activateDocumentAtom, a);
    expect(store.get(viewOnlyAtom)).toBeNull();
    expect(api.document.update("Rename", (tx) => tx.properties({ name: "b" })).changed).toBe(true);
    store.set(activateDocumentAtom, replay);
    expect(store.get(viewOnlyAtom)).toEqual({ label: "Replay" });
    expect(() => api.document.edit("Paint", () => {})).toThrow(/view only/);
  });

  it("is never saved as itself, but a copy of it can be kept", async () => {
    const { store } = await withReplay();
    const written: string[] = [];
    const write: SaveWriter = async (_b, fileName) => { written.push(fileName); return { fileName, handle: null, route: "download" }; };
    expect(await saveDocument(store, { fileName: "Lost Temple.scx", handle: null, options: DEFAULT_SAVE_OPTIONS, copy: false }, write)).toBe(false);
    expect(written).toEqual([]);
    expect(await saveDocument(store, { fileName: "Lost Temple copy.scx", handle: null, options: DEFAULT_SAVE_OPTIONS, copy: true }, write)).toBe(true);
    expect(written).toEqual(["Lost Temple copy.scx"]);
    expect(store.get(viewOnlyAtom)).not.toBeNull();
  });

  it("opens no editing dialog, however it is asked for, and still opens the ones that only read", async () => {
    const { store } = await withReplay();
    expect(store.set(openDialogAtom, "triggerEditor")).toBe(-1);
    expect(store.set(openDialogAtom, "unitProperties", { indices: [0] })).toBe(-1);
    expect(store.get(dialogStackAtom)).toEqual([]);
    expect(store.get(statusMessageAtom)).toMatch(/Replay is open to view only/);
    expect(store.set(openDialogAtom, "statistics")).toBeGreaterThan(0);
    expect(store.get(dialogStackAtom).map((d) => d.id)).toEqual(["statistics"]);
  });

  it("takes the reading of the file on open (Repair's pass), and nothing else through sections", async () => {
    const { store, api } = await withReplay();
    const file = api.document.sections.file();
    expect(() => api.document.sections.replaceFile(file)).toThrow(/view only/);
    expect(() => api.document.sections.replaceFile(file, { asOpened: true })).not.toThrow();
    expect(store.get(viewOnlyAtom)).toEqual({ label: "Replay" });
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(() => api.document.extras.set("x.wav", new Uint8Array(1))).toThrow(/view only/);
    expect(() => api.clipboard.paste(0, 0)).toThrow(/view only/);
  });

  it("Edit a Copy opens an ordinary, unsaved map beside it with the same contents", async () => {
    const { store, api } = await withReplay();
    expect(editCopyIn(store)).toBe(true);
    const list = api.document.list();
    expect(list.map((d) => [d.name, d.fileName, d.viewOnly, d.modified, d.active])).toEqual([
      ["a", "a.scx", false, false, false], ["Lost Temple", "Lost Temple.scx", true, false, false], ["Lost Temple", null, false, true, true],
    ]);
    expect(api.document.update("Rename", (tx) => tx.properties({ name: "Mine" })).changed).toBe(true);
    store.set(activateDocumentAtom, list[1].id);
    expect(scenarioName(store.get(scenarioAtom)!)).toBe("Lost Temple");
  });
});
