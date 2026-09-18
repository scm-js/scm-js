import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { createScenario } from "../src/formats/chk/create";
import { parseChk, serializeChk } from "../src/formats/chk/reader";
import { loadMap, readMembers, saveMap } from "../src/formats/mpq/scm";
import { builtByAtom, loadDocumentAtom } from "../src/atoms/documentAtoms";
import { mapModifiedAtom } from "../src/atoms/editorAtoms";
import { pluginBuildStepsAtom } from "../src/atoms/pluginAtoms";
import { toastsAtom } from "../src/atoms/uiAtoms";
import { BUILD_MANIFEST_MEMBER, BUILD_SOURCE_MEMBER, readBuildManifest, sha256Hex } from "../src/editor/mapBuild";
import { buildMapFile, DEFAULT_SAVE_OPTIONS, type SaveOptions } from "../src/editor/save";
import { saveDocument, type SaveWriter } from "../src/hooks/useMapFileActions";
import { Contributions, createPluginApi } from "../src/plugins/host";
import type { BuildStepInput } from "../src/plugins/api";
import { openMapFile } from "../src/services/mapIo";
import { testMapBytes } from "../src/services/testMap";

const WAV = "staredit\\wav\\x.wav";
const PAYLOAD = "eud\\payload.bin";
const options: SaveOptions = { ...DEFAULT_SAVE_OPTIONS, compression: "pkware", encrypt: true };

function openStore() {
  const store = createStore();
  const scenario = createScenario({ width: 32, height: 32, era: 0, name: "built" });
  store.set(loadDocumentAtom, { scenario, extras: new Map([[WAV, new Uint8Array([1, 2])]]), fileName: "built.scx" });
  store.set(mapModifiedAtom, true);
  const api = createPluginApi(store, { id: "eud", name: "EUD", source: "s" }, new Contributions());
  return { store, scenario, api };
}

function writer() {
  const calls: Uint8Array[] = [];
  const write: SaveWriter = async (bytes, fileName, handle) => { calls.push(bytes); return { route: "file", fileName, handle }; };
  return { calls, write };
}

/** What a compiler does to a map: a section of its own in the scenario, a member of its own in the archive. */
async function compile({ map }: BuildStepInput): Promise<Uint8Array> {
  const chk = parseChk((await loadMap(map)).chk);
  chk.sections.push({ name: "EUD!", offset: 0, declaredLength: 4, data: new Uint8Array([9, 9, 9, 9]) });
  return saveMap(serializeChk(chk), { extras: new Map([[PAYLOAD, new Uint8Array([7])], [WAV, new Uint8Array([0])]]) });
}
const step = (over: Partial<Parameters<ReturnType<typeof openStore>["api"]["document"]["buildSteps"]["add"]>[0]> = {}) => ({ id: "build", label: "eudplib", applies: () => true, run: compile, ...over });
const sectionNames = (chk: Uint8Array) => parseChk(chk).sections.map((s) => s.name);
const asFile = (bytes: Uint8Array, name = "built.scx") => new File([bytes as unknown as BlobPart], name);
const save = (store: ReturnType<typeof createStore>, w: ReturnType<typeof writer>, o = options) => saveDocument(store, { fileName: "built.scx", handle: null, options: o, copy: false }, w.write);

describe("sha256Hex", () => {
  it("agrees with the platform's SHA-256 across the padding boundaries", async () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 119, 120, 1000, 70001]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 31 + n) & 0xff);
      const want = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
      expect(sha256Hex(bytes), `length ${n}`).toBe(want);
    }
  });
});

describe("build steps", () => {
  it("writes the step's scenario with the map kept beside it, and opens as the map", async () => {
    const { store, api } = openStore();
    api.document.buildSteps.add(step());
    const w = writer();
    expect(await save(store, w)).toBe(true);

    const file = await loadMap(w.calls[0]);
    expect(sectionNames(file.chk)).toContain("EUD!");
    expect(file.scenarioInfo).toMatchObject({ compression: "pkware", encrypted: true });
    const { extras } = await readMembers(file.archive!, file.files);
    expect([...extras.keys()].sort()).toEqual([PAYLOAD, BUILD_MANIFEST_MEMBER, BUILD_SOURCE_MEMBER, WAV].sort());
    expect(extras.get(WAV)).toEqual(new Uint8Array([1, 2])); // a step adds members; the map's own stay as they were
    expect(readBuildManifest(extras.get(BUILD_MANIFEST_MEMBER)!)).toMatchObject({ steps: [{ id: "eud/build", label: "eudplib" }], added: [PAYLOAD] });
    expect(store.get(builtByAtom)).toEqual([{ id: "eud/build", label: "eudplib" }]);
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(toastsAtom).map((t) => t.title)).toEqual(["Saved"]); // the building notice is gone

    const doc = await openMapFile(asFile(w.calls[0]));
    expect(doc.scenario.chk.sections.map((s) => s.name)).not.toContain("EUD!");
    expect(doc.scenario.chk.sections.length).toBeGreaterThan(10);
    expect([...doc.extras.keys()]).toEqual([WAV]);
    expect(doc.builtBy).toEqual([{ id: "eud/build", label: "eudplib" }]);
    expect(doc.scenario.warnings).toEqual([]);
  });

  it("leaves Save exactly as it was when no step applies", async () => {
    const { store, scenario, api } = openStore();
    api.document.buildSteps.add(step({ applies: () => false }));
    const w = writer();
    await save(store, w);
    expect(w.calls[0]).toEqual(await buildMapFile(scenario, new Map([[WAV, new Uint8Array([1, 2])]]), options));
    expect(store.get(builtByAtom)).toBeNull();
  });

  it("saves the map without the step when the step fails, and says so", async () => {
    const { store, api } = openStore();
    api.document.buildSteps.add(step({ run: async () => { throw new Error("main.ts:3 — no such unit"); } }));
    const w = writer();
    expect(await save(store, w)).toBe(true);
    expect(sectionNames((await loadMap(w.calls[0])).chk)).not.toContain("EUD!");
    expect(store.get(mapModifiedAtom)).toBe(false);
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "error", title: "Saved without the built part" });
    expect(store.get(toastsAtom).at(-1)!.detail).toContain("no such unit");
  });

  it("stops waiting for a step that never settles when the notice's button is pressed", async () => {
    const { store, api } = openStore();
    let aborted = false;
    api.document.buildSteps.add(step({ run: ({ signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; })) }));
    const w = writer();
    const saving = save(store, w);
    await new Promise((r) => setTimeout(r, 0));
    const notice = store.get(toastsAtom).find((t) => t.title === "Building the map…")!;
    expect(notice.action?.label).toBe("Save without it");
    notice.action!.run();
    expect(await saving).toBe(true);
    expect(aborted).toBe(true);
    expect(store.get(toastsAtom).at(-1)).toMatchObject({ kind: "warn", title: "Saved without the built part" });
  });

  it("says so once when the file was built by a step nothing provides any more", async () => {
    const { store, api } = openStore();
    const reg = api.document.buildSteps.add(step());
    const first = writer();
    await save(store, first);
    reg.dispose();
    expect(store.get(pluginBuildStepsAtom)).toEqual([]);

    store.set(loadDocumentAtom, await openMapFile(asFile(first.calls[0])));
    const w = writer();
    await save(store, w);
    expect(store.get(toastsAtom).at(-1)!.detail).toContain("built by eudplib");
    expect(store.get(builtByAtom)).toBeNull();
    const before = store.get(toastsAtom).length;
    await save(store, w);
    expect(store.get(toastsAtom).length).toBe(before + 1); // only "Saved"
  });

  it("opens a built file whose scenario was changed elsewhere as it is, with a warning, and keeps the source", async () => {
    const { store, api } = openStore();
    api.document.buildSteps.add(step());
    const w = writer();
    await save(store, w);
    const file = await loadMap(w.calls[0]);
    const { extras } = await readMembers(file.archive!, file.files);
    const chk = parseChk(file.chk);
    chk.sections.push({ name: "PROT", offset: 0, declaredLength: 1, data: new Uint8Array([1]) });
    const doc = await openMapFile(asFile(await saveMap(serializeChk(chk), { extras })));
    expect(doc.builtBy).toBeNull();
    expect(doc.scenario.warnings.join(" ")).toContain("built by eudplib");
    expect([...doc.extras.keys()]).toContain(BUILD_SOURCE_MEMBER);
  });

  it("does not build a bare .chk", async () => {
    const { store, api } = openStore();
    api.document.buildSteps.add(step());
    const w = writer();
    await save(store, w, { ...options, format: "chk" });
    expect(sectionNames(w.calls[0])).not.toContain("EUD!");
    expect(store.get(toastsAtom).at(-1)!.detail).toContain(".scx");
  });

  it("export runs the steps unless asked not to, and never from inside one", async () => {
    const { api } = openStore();
    let inner: Uint8Array | null = null;
    api.document.buildSteps.add(step({ run: async (input) => { inner = new Uint8Array(await (await api.document.export())!.arrayBuffer()); return compile(input); } }));
    const built = new Uint8Array(await (await api.document.export())!.arrayBuffer());
    expect(sectionNames((await loadMap(built)).chk)).toContain("EUD!");
    expect(sectionNames((await loadMap(inner!)).chk)).not.toContain("EUD!");
    const plain = new Uint8Array(await (await api.document.export({ built: false }))!.arrayBuffer());
    expect(sectionNames((await loadMap(plain)).chk)).not.toContain("EUD!");
  });

  it("Test Map refuses a map whose step failed", async () => {
    const { store, api } = openStore();
    api.document.buildSteps.add(step({ run: async () => { throw new Error("broken"); } }));
    await expect(testMapBytes(store)).rejects.toThrow("broken");
  });
});
