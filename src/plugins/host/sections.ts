/**
 * `api.document.sections`: the file's sections as bytes.
 */
import { replaceScenarioAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { loadMap } from "../../formats/mpq/scm";
import { combinedSection, currentChk, defaultSectionBytes, editRaw, insertSection, knownSections, moveSection, parseRaw, rebuildSections, removeSection, renameSection, replaceSectionData, requiredSectionNames, sectionInfos, sectionKnowledge } from "../../editor/sections";
import { serializeChk, type ChkFile } from "../../formats/chk/reader";
import type { RawEditResult, SectionsApi } from "../api";
import { type Store, assertWritable } from "./shared";

/**
 * `api.document.sections`: the file Save would write, and edits to its bytes. Every
 * edit parses the result again and installs it through `replaceScenarioAtom`, so the
 * typed model, the mirror atoms and every revision follow — and the history goes, as
 * with Resize. Reads serialise the open scenario each time; that is a few milliseconds
 * for the largest map, and a plugin that lists often can cache on the `"document"` and
 * per-layer events.
 */
export function sectionsApi(store: Store, alive: () => boolean = () => true): SectionsApi {
  const open = () => {
    const scn = store.get(scenarioAtom);
    if (!scn) throw new Error("No map is open.");
    return scn;
  };
  /** A write from a deactivated plugin is refused outright: a raw edit replaces the whole scenario. */
  const writable = () => {
    if (!alive()) throw new Error("The plugin is deactivated; document.sections no longer writes.");
    assertWritable(store);
    return open();
  };
  const dim = () => { const scn = store.get(scenarioAtom); return { width: scn?.width ?? 0, height: scn?.height ?? 0 }; };
  const edit = (mutate: (file: ChkFile) => void): RawEditResult => {
    const next = editRaw(writable(), mutate);
    store.set(replaceScenarioAtom, next);
    return { warnings: [...next.warnings] };
  };
  return {
    list: () => { const scn = store.get(scenarioAtom); return scn ? sectionInfos(scn) : []; },
    bytes: (index) => {
      const file = currentChk(open());
      const s = file.sections[index];
      if (!s) throw new RangeError(`No section at index ${index} (the file has ${file.sections.length}).`);
      return s.data.slice();
    },
    combined: (name) => { const scn = store.get(scenarioAtom); return scn ? combinedSection(scn, name)?.slice() ?? null : null; },
    file: () => serializeChk(currentChk(open())),
    spec: (name) => sectionKnowledge(name, dim()),
    known: () => knownSections(dim()),
    write: (index, bytes) => edit((file) => replaceSectionData(file, index, bytes)),
    rename: (index, name) => edit((file) => renameSection(file, index, name)),
    insert: (index, name, bytes) => edit((file) => insertSection(file, index, name, bytes)),
    remove: (index) => edit((file) => removeSection(file, index)),
    move: (from, to) => edit((file) => moveSection(file, from, to)),
    chkOf: async (file) => (await loadMap(file)).chk.slice(),
    replaceFile: (bytes, options) => {
      // The reading of the file that was opened (Repair's on-open pass) is not an edit, so a view-only map takes it too.
      if (options?.asOpened === true) { if (!alive()) throw new Error("The plugin is deactivated; document.sections no longer writes."); open(); } else writable();
      const next = parseRaw(bytes);
      store.set(replaceScenarioAtom, next, { asOpened: options?.asOpened === true });
      return { warnings: [...next.warnings] };
    },
    trailing: () => { const scn = store.get(scenarioAtom); return scn ? currentChk(scn).trailing?.slice() ?? null : null; },
    required: () => { const scn = store.get(scenarioAtom); return scn ? requiredSectionNames(scn) : []; },
    defaults: (name) => { const scn = store.get(scenarioAtom); return scn ? defaultSectionBytes(scn, name.padEnd(4, " ")) : null; },
    rebuild: (names) => {
      const { scenario, result } = rebuildSections(writable(), names);
      store.set(replaceScenarioAtom, scenario);
      return result;
    },
  };
}
