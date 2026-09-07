import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { serializeScenario } from "../src/formats/chk/scenario";
import {
  activateDocumentAtom, activeDocumentIdAtom, anyModifiedAtom, closeDocumentAtom, documentChangeAtom, documentsAtom, documentTabsAtom, loadDocumentAtom, parkedTilesetsAtom,
  redoStackAtom, scenarioAtom, undoStackAtom,
} from "../src/atoms/documentAtoms";
import { centerViewOnAtom, clipSelectionAtom, mapFilePathAtom, mapModifiedAtom, mapNameAtom, mapTilesetAtom, mapWidthAtom, selectedUnitsAtom, viewportRectAtom, zoomAtom } from "../src/atoms/editorAtoms";
import { preferencesAtom } from "../src/atoms/preferencesAtoms";
import { closeDialogAtom, dialogStackAtom } from "../src/atoms/uiAtoms";
import { closeDocumentIn, isUntouchedBlank, needsCloseConfirm, newMapInto, openFileInto, openTarget, quitGuard, stepDocumentIn, type PendingAction } from "../src/hooks/useMapFileActions";
import { Contributions, createPluginApi } from "../src/plugins/host";
import { tabTitle } from "../src/components/chrome/TabStrip";

const scn = (name: string, width = 8, era = 0) => createScenario({ width, height: 6, era, name });
const file = (name: string, width = 8, era = 0) => new File([serializeScenario(scn(name, width, era)) as unknown as BlobPart], `${name}.chk`);

/** A store with `a` open from a file, as File ▸ Open leaves it. */
function withA() {
  const store = createStore();
  store.set(loadDocumentAtom, { scenario: scn("a"), extras: new Map(), fileName: "a.scx" });
  return store;
}

describe("several maps open at once", () => {
  it("parks the map in front when another opens beside it, and lists both", () => {
    const store = withA();
    const a = store.get(activeDocumentIdAtom)!;
    expect(a).toBeGreaterThan(0);
    store.set(mapModifiedAtom, true);
    store.set(selectedUnitsAtom, [2]);
    store.set(clipSelectionAtom, { x0: 1, y0: 1, x1: 3, y1: 3 });
    store.set(zoomAtom, 2);
    store.set(viewportRectAtom, { x: 2, y: 1, w: 4, h: 2 });
    store.set(undoStackAtom, [{ label: "stroke", changes: [] }]);

    store.set(loadDocumentAtom, { scenario: scn("b", 16, 4), extras: new Map(), fileName: null, reason: "new", into: "tab" });
    const b = store.get(activeDocumentIdAtom)!;
    expect(b).not.toBe(a);
    expect(store.get(documentTabsAtom)).toEqual([
      { id: a, name: "a", fileName: "a.scx", tileset: "badlands", width: 8, height: 6, modified: true, active: false },
      { id: b, name: "b", fileName: null, tileset: "jungle", width: 16, height: 6, modified: false, active: true },
    ]);
    // The registers are b's: clean, nothing selected, empty history; the zoom carries over.
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(selectedUnitsAtom)).toEqual([]);
    expect(store.get(clipSelectionAtom)).toBeNull();
    expect(store.get(undoStackAtom)).toEqual([]);
    expect(store.get(zoomAtom)).toBe(2);
    expect(store.get(mapWidthAtom)).toBe(16);
    expect(store.get(documentChangeAtom)).toMatchObject({ reason: "new" });
    // What the guard reads, and what the tileset hook keeps decoded.
    expect(store.get(anyModifiedAtom)).toBe(true);
    expect([...store.get(parkedTilesetsAtom)]).toEqual(["badlands"]);
    expect(tabTitle(store.get(documentTabsAtom)[0])).toBe("a.scx");
    expect(tabTitle(store.get(documentTabsAtom)[1])).toBe("b");
  });

  it("brings a parked map back as it was left: history, selections, marked area, view, modified state", () => {
    const store = withA();
    const a = store.get(activeDocumentIdAtom)!;
    const scenarioA = store.get(scenarioAtom);
    store.set(mapModifiedAtom, true);
    store.set(selectedUnitsAtom, [2]);
    store.set(clipSelectionAtom, { x0: 1, y0: 1, x1: 3, y1: 3 });
    store.set(zoomAtom, 2);
    store.set(viewportRectAtom, { x: 2, y: 1, w: 4, h: 2 });
    store.set(undoStackAtom, [{ label: "stroke", changes: [] }]);
    store.set(loadDocumentAtom, { scenario: scn("b", 16, 4), extras: new Map(), fileName: null, reason: "new", into: "tab" });
    const b = store.get(activeDocumentIdAtom)!;
    store.set(zoomAtom, 0.5);
    store.set(viewportRectAtom, { x: 0, y: 0, w: 16, h: 6 });

    expect(store.set(activateDocumentAtom, b)).toBe(true); // already in front: nothing happens
    expect(store.get(documentChangeAtom).reason).toBe("new");
    expect(store.set(activateDocumentAtom, 999)).toBe(false);

    expect(store.set(activateDocumentAtom, a)).toBe(true);
    expect(store.get(scenarioAtom)).toBe(scenarioA);
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    expect(store.get(documentChangeAtom)).toEqual({ reason: "switch", scenario: scenarioA });
    expect(store.get(mapModifiedAtom)).toBe(true);
    expect(store.get(mapFilePathAtom)).toBe("a.scx");
    expect(store.get(mapNameAtom)).toBe("a");
    expect(store.get(mapTilesetAtom)).toBe("badlands");
    expect(store.get(selectedUnitsAtom)).toEqual([2]);
    expect(store.get(clipSelectionAtom)).toEqual({ x0: 1, y0: 1, x1: 3, y1: 3 });
    expect(store.get(undoStackAtom)).toEqual([{ label: "stroke", changes: [] }]);
    expect(store.get(zoomAtom)).toBe(2);
    expect(store.get(centerViewOnAtom)).toEqual({ x: 4, y: 2 });
    // b is parked with its own view, and the order is unchanged.
    expect(store.get(documentTabsAtom).map((t) => [t.id, t.active])).toEqual([[a, true], [b, false]]);
    expect(store.get(documentsAtom)[1].parked).toMatchObject({ zoom: 0.5, center: { x: 8, y: 3 }, modified: false });
    expect([...store.get(parkedTilesetsAtom)]).toEqual(["jungle"]);

    // Next / Previous wrap round.
    expect(stepDocumentIn(store, 1)).toBe(true);
    expect(store.get(activeDocumentIdAtom)).toBe(b);
    expect(stepDocumentIn(store, 1)).toBe(true);
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    expect(stepDocumentIn(store, -1)).toBe(true);
    expect(store.get(activeDocumentIdAtom)).toBe(b);
  });

  it("closes onto the neighbour to the right, then the left, then to nothing", () => {
    const store = withA();
    const a = store.get(activeDocumentIdAtom)!;
    store.set(loadDocumentAtom, { scenario: scn("b"), extras: new Map(), fileName: "b.scx", into: "tab" });
    const b = store.get(activeDocumentIdAtom)!;
    store.set(loadDocumentAtom, { scenario: scn("c"), extras: new Map(), fileName: "c.scx", into: "tab" });
    const c = store.get(activeDocumentIdAtom)!;
    store.set(activateDocumentAtom, b);

    store.set(closeDocumentAtom); // b goes; c, to its right, comes to the front
    expect(store.get(activeDocumentIdAtom)).toBe(c);
    expect(store.get(documentChangeAtom).reason).toBe("switch");
    expect(store.get(documentTabsAtom).map((t) => t.id)).toEqual([a, c]);
    store.set(closeDocumentAtom); // c was last: a, to its left
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    expect(store.get(mapFilePathAtom)).toBe("a.scx");
    store.set(closeDocumentAtom);
    expect(store.get(scenarioAtom)).toBeNull();
    expect(store.get(activeDocumentIdAtom)).toBeNull();
    expect(store.get(documentsAtom)).toEqual([]);
    expect(store.get(documentChangeAtom).reason).toBe("close");
  });

  it("replaces the map in front when told to, and keeps the slot on a re-parse", () => {
    const store = withA();
    const a = store.get(activeDocumentIdAtom)!;
    store.set(loadDocumentAtom, { scenario: scn("b"), extras: new Map(), fileName: "b.scx" }); // into omitted: in place
    const b = store.get(activeDocumentIdAtom)!;
    expect(b).not.toBe(a);
    expect(store.get(documentTabsAtom)).toHaveLength(1);
    store.set(loadDocumentAtom, { scenario: scn("b"), extras: new Map(), fileName: "b.scx", reason: "replace" });
    expect(store.get(activeDocumentIdAtom)).toBe(b);
    expect(store.get(documentTabsAtom)).toHaveLength(1);
    // A scenario put in place behind the writers' backs has no slot.
    const bare = createStore();
    bare.set(scenarioAtom, scn("x"));
    expect(bare.get(activeDocumentIdAtom)).toBeNull();
    expect(bare.get(documentTabsAtom)).toEqual([]);
    bare.set(closeDocumentAtom);
    expect(bare.get(scenarioAtom)).toBeNull();
  });
});

describe("where a map opens", () => {
  it("goes beside the open map by preference, in its place when off, and always over the untouched startup map", async () => {
    const store = createStore();
    expect(openTarget(store)).toBe("replace"); // nothing open
    await newMapInto(store);
    expect(isUntouchedBlank(store)).toBe(true);
    expect(openTarget(store)).toBe("replace");
    expect(openTarget(store, "new")).toBe("tab"); // a plugin's explicit choice wins
    const blank = store.get(activeDocumentIdAtom);
    expect(await openFileInto(store, file("a"))).toBe(true);
    expect(store.get(documentTabsAtom)).toHaveLength(1);
    expect(store.get(activeDocumentIdAtom)).not.toBe(blank);
    // Opened from a file: the next map goes beside it, and the gate has nothing to ask.
    expect(openTarget(store)).toBe("tab");
    store.set(mapModifiedAtom, true);
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
    expect(needsCloseConfirm(store, { action: "open", file: file("b") })).toBe(false);
    expect(needsCloseConfirm(store, { action: "new", options: { width: 8, height: 6, tileset: "ice", name: "", description: "" } })).toBe(false);
    expect(needsCloseConfirm(store, { action: "close" })).toBe(true);
    expect(needsCloseConfirm(store, { action: "open", file: file("b"), into: "current" })).toBe(true);
    expect(await openFileInto(store, file("b"))).toBe(true);
    expect(store.get(documentTabsAtom).map((t) => [t.fileName, t.modified, t.active])).toEqual([["a.chk", true, false], ["b.chk", false, true]]);
    // A new map edited and undone back is still the user's, not the startup blank.
    store.set(undoStackAtom, []);
    store.set(redoStackAtom, [{ label: "x", changes: [] }]);
    store.set(mapFilePathAtom, null);
    expect(isUntouchedBlank(store)).toBe(false);
    // The preference off: one map at a time, through the gate.
    store.set(preferencesAtom, { ...store.get(preferencesAtom), multipleMaps: false });
    expect(openTarget(store)).toBe("replace");
    expect(await openFileInto(store, file("c"))).toBe(true);
    expect(store.get(documentTabsAtom).map((t) => t.fileName)).toEqual(["a.chk", "c.chk"]);
  });

  it("closes a map behind the front one by bringing it forward first, and leaves through every modified map", async () => {
    const store = createStore();
    store.set(preferencesAtom, { ...store.get(preferencesAtom), confirmClose: true });
    await openFileInto(store, file("a"));
    const a = store.get(activeDocumentIdAtom)!;
    store.set(mapModifiedAtom, true);
    await openFileInto(store, file("b"));
    const b = store.get(activeDocumentIdAtom)!;
    expect(await closeDocumentIn(store, 999)).toBe(false);

    // Closing a: it comes to the front and the dialog asks; a dismissal keeps it, in front.
    const closing = closeDocumentIn(store, a);
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    let entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    expect(entry.payload?.pending).toMatchObject({ action: "close" });
    store.set(closeDialogAtom, entry.key);
    expect(await closing).toBe(false);
    expect(store.get(documentTabsAtom).map((t) => t.id)).toEqual([a, b]);

    // Leaving: the one modified map is asked about; Don't Save goes on, nothing else is asked.
    const quitting = quitGuard(store);
    entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    const pending = entry.payload!.pending as PendingAction & { taken?: boolean };
    expect(pending.action).toBe("quit");
    pending.taken = true;
    store.set(closeDialogAtom, entry.key);
    pending.done!(true);
    expect(await quitting).toBe(true);
    // Nothing modified: no question, unless the File menu's Exit asks its plain one.
    store.set(mapModifiedAtom, false);
    expect(await quitGuard(store)).toBe(true);
    const plain = quitGuard(store, true);
    entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    store.set(closeDialogAtom, entry.key);
    expect(await plain).toBe(false);
    // A modified map behind is what Cancel keeps: the answer is false and the window stays.
    store.set(activateDocumentAtom, b);
    store.set(activateDocumentAtom, a);
    store.set(mapModifiedAtom, true);
    store.set(activateDocumentAtom, b);
    const kept = quitGuard(store);
    expect(store.get(activeDocumentIdAtom)).toBe(a);
    entry = store.get(dialogStackAtom).find((d) => d.id === "confirmClose")!;
    store.set(closeDialogAtom, entry.key);
    expect(await kept).toBe(false);
  });
});

describe("the plugin API over several maps", () => {
  it("lists, activates, opens beside or in place, and closes by id, saying why the document changed", async () => {
    const store = createStore();
    const api = createPluginApi(store, { id: "t", name: "T", source: "s" }, new Contributions());
    const seen: { reason: string; id: number | null }[] = [];
    api.events.on("document", (e) => { seen.push({ reason: e.reason, id: e.id }); });
    expect(api.document.id()).toBeNull();
    expect(api.document.list()).toEqual([]);
    expect(api.document.activate(1)).toBe(false);

    expect(await api.document.open(file("a"))).toBe(true);
    const a = api.document.id()!;
    expect(await api.document.create({ width: 16, height: 8, tileset: "ice", name: "Frost" })).toBe(true);
    const b = api.document.id()!;
    expect(b).not.toBe(a);
    expect(api.document.list()).toEqual([
      { id: a, name: "a", fileName: "a.chk", tileset: "badlands", width: 8, height: 6, modified: false, active: false },
      { id: b, name: "Frost", fileName: null, tileset: "ice", width: 16, height: 8, modified: false, active: true },
    ]);
    // In place, by explicit choice: b goes, c takes its slot.
    expect(await api.document.open(file("c"), undefined, { into: "current" })).toBe(true);
    const c = api.document.id()!;
    expect(api.document.list().map((d) => d.id)).toEqual([a, c]);
    expect(api.document.activate(a)).toBe(true);
    expect(api.document.info()).toMatchObject({ name: "a", fileName: "a.chk" });
    expect(seen).toEqual([
      { reason: "open", id: a }, { reason: "new", id: b }, { reason: "open", id: c }, { reason: "switch", id: a },
    ]);
    expect(await api.document.close(c)).toBe(true);
    expect(api.document.list().map((d) => d.id)).toEqual([a]);
    expect(seen.at(-1)).toEqual({ reason: "switch", id: a });
    expect(await api.document.close()).toBe(true);
    expect(api.document.isOpen()).toBe(false);
    expect(seen.at(-1)).toEqual({ reason: "close", id: null });
    expect(await api.document.close()).toBe(false);
  });
});
