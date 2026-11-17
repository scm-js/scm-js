/**
 * `api.document.update`: the tables and settings every dialog's OK writes.
 */
import { t } from "../../i18n";
import { archiveExtrasAtom, commitNoticeAtom, commitSettingsAtom, commitTriggersAtom, scenarioAtom } from "../../atoms/documentAtoms";
import { statusMessageAtom } from "../../atoms/uiAtoms";
import { markDirty, scenarioDescription, scenarioName, setScenarioDescription, setScenarioName, strSectionName } from "../../formats/chk/scenario";
import { peekUnitAssets } from "../../formats/units/load";
import { getString, setString } from "../../formats/chk/sections/strings";
import { applySwitchNames, readSwitchNames } from "../../editor/switches";
import { applyCuwp, cuwpSlotView, cuwpSlotViews, patchCuwp, readCuwp } from "../../editor/cuwp";
import { emptyCuwpSlot } from "../../formats/chk/sections/cuwp";
import { applyBriefing, applyTriggers, insertTrigger, moveTrigger, readBriefing, readTriggers, removeTriggers, sameTriggers, newStringDrafts, parseTriggerText, resolveDraftStrings } from "../../editor/triggers";
import { applyStrings, readStrings } from "../../editor/strings";
import { changeMapVersion, changeTextEncoding, forceViews, internString, patchForce, patchPlayer, patchTech, patchUnitType, patchUpgrade, playerSlotViews, techView, unitTypeView, upgradeView } from "../../editor/settings";
import { addSound, applySounds, findMember, readWavs, removeSound, soundList, wavMemberName } from "../../editor/sounds";
import { NO_PARTS } from "../../editor/history";
import type { TriggerListUpdate, TriggerRecord, UpdateResult, UpdateTransaction } from "../api";
import { applyStringImport, parseStringTable } from "../../editor/exchange";
import { type Store, assertWritable, sealed, checkSyncBuilder } from "./shared";

/**
 * Run `build` against an update transaction and commit it. This is the editor's second
 * kind of write — the one every settings and trigger dialog performs: the scenario is
 * mutated in place, the sections touched are marked dirty, and the commit tells the
 * chrome to re-read. There is no history entry, so a plugin that wants one keeps its
 * own copy of what it replaced.
 *
 * Operations apply as they are called, exactly as `runTransaction`'s do — a string
 * interned on one line is in the table for the trigger added on the next — which is why
 * the ordering hazards of a working-copy model (switch names interning while a copy of
 * the string table is held) do not arise here.
 */
export function runUpdate(store: Store, label: string, build: (tx: UpdateTransaction) => unknown): UpdateResult {
  const scn = store.get(scenarioAtom);
  if (!scn) return { changed: false, sections: [], notes: ["no map is open"] };
  assertWritable(store);
  const sections = new Set<string>();
  const notes: string[] = [];
  // The archive's files as the update found them: undo puts a sound's file back with its slot.
  const extrasBefore = store.get(archiveExtrasAtom);
  const touch = (name: string) => { sections.add(name); };
  const strSection = () => strSectionName(scn);
  /** Note the string table growing: interning happens deep inside several of these. */
  const withStrings = <T,>(run: () => T): T => {
    const before = scn.strings.strings.length;
    const out = run();
    if (scn.strings.strings.length !== before) touch(strSection());
    return out;
  };

  const listUpdate = (briefing: boolean): TriggerListUpdate => {
    const section = briefing ? "MBRF" : "TRIG";
    const read = () => (briefing ? readBriefing(scn) : readTriggers(scn));
    const write = (next: TriggerRecord[]): boolean => {
      if (sameTriggers(briefing ? scn.briefing : scn.triggers, next)) return false;
      if (briefing) applyBriefing(scn, next);
      else applyTriggers(scn, next);
      touch(section);
      return true;
    };
    return {
      list: read,
      count: () => (briefing ? scn.briefing.length : scn.triggers.length),
      set: (list) => { write(list); },
      add: (trigger, at) => {
        const list = read();
        const index = at === undefined ? list.length : Math.max(0, Math.min(list.length, at));
        write(insertTrigger(list, index, trigger));
        return index;
      },
      replace: (index, trigger) => {
        const list = read();
        if (index < 0 || index >= list.length) return false;
        list[index] = trigger;
        return write(list);
      },
      remove: (indices) => {
        const list = read();
        const next = removeTriggers(list, indices);
        write(next);
        return list.length - next.length;
      },
      move: (from, to) => {
        const list = read();
        if (from < 0 || from >= list.length || to < 0 || to >= list.length) return false;
        return write(moveTrigger(list, from, to));
      },
      fromText: (source, options = {}) => {
        // Parsed whole before a string is added: text with a mistake in it throws here and leaves the map as it was.
        const drafts = newStringDrafts();
        const drafted = parseTriggerText(scn, source, briefing, drafts).map((t) => t.trigger);
        const parsed = withStrings(() => resolveDraftStrings(scn, drafted, drafts));
        write(options.replace ? parsed : [...read(), ...parsed]);
        return parsed.length;
      },
    };
  };

  /** Run a patcher that answers with the sections it changed; record them. */
  const tracked = (run: () => string[]): boolean => {
    const changed = withStrings(run);
    for (const name of changed) touch(name);
    return changed.length > 0;
  };
  const assets = () => peekUnitAssets();

  const tx: UpdateTransaction = {
    scenario: scn,
    triggers: listUpdate(false),
    briefing: listUpdate(true),

    strings: {
      list: () => readStrings(scn),
      intern: (text) => withStrings(() => internString(scn, text)),
      import: (text) => {
        const parsed = parseStringTable(text);
        for (const e of parsed.errors) notes.push(t("line {line}: {message}", { line: e.line, message: e.message }));
        const before = scn.strings.strings.slice();
        const r = withStrings(() => applyStringImport(scn, parsed.entries));
        if (r.replaced > 0 || r.added > 0 || before.some((v, i) => v !== scn.strings.strings[i])) touch(strSection());
        return r;
      },
      set: (index, text) => {
        if (index <= 0) { notes.push(t("string 0 is reserved; use intern to add one")); return; }
        if (getString(scn.strings, index) === text) return;
        setString(scn.strings, index, text);
        markDirty(scn, strSection());
        touch(strSection());
      },
      apply: (list) => { if (applyStrings(scn, list)) touch(strSection()); },
    },

    switches: {
      names: () => readSwitchNames(scn),
      setName: (index, name) => {
        const list = readSwitchNames(scn);
        if (index < 0 || index >= list.length) { notes.push(t("there is no switch {index}", { index })); return; }
        list[index] = name;
        withStrings(() => { if (applySwitchNames(scn, list)) touch("SWNM"); });
      },
    },

    properties: (patch) => {
      withStrings(() => {
        if (patch.name !== undefined && patch.name !== (scenarioName(scn) ?? "")) { setScenarioName(scn, patch.name); touch("SPRP"); }
        if (patch.description !== undefined && patch.description !== (scenarioDescription(scn) ?? "")) { setScenarioDescription(scn, patch.description); touch("SPRP"); }
      });
    },

    players: {
      list: () => playerSlotViews(scn),
      set: (slot, patch) => tracked(() => patchPlayer(scn, slot, patch)),
    },
    cuwp: {
      list: () => cuwpSlotViews(scn),
      get: (index) => cuwpSlotView(scn, index),
      set: (index, patch, used) => tracked(() => patchCuwp(scn, index, patch, used)),
      clear: (index) => tracked(() => {
        const table = readCuwp(scn);
        if (index < 0 || index >= table.slots.length) return [];
        table.slots[index] = emptyCuwpSlot();
        table.used[index] = false;
        return applyCuwp(scn, table);
      }),
    },
    forces: {
      list: () => forceViews(scn),
      set: (force, patch) => tracked(() => patchForce(scn, force, patch)),
    },
    unitTypes: {
      get: (unitId) => unitTypeView(scn, unitId, assets()?.units ?? null, assets()?.weapons ?? null),
      set: (unitId, patch) => tracked(() => patchUnitType(scn, unitId, patch, assets()?.units ?? null, assets()?.weapons ?? null)),
    },
    upgrades: {
      get: (id) => upgradeView(scn, id, assets()?.upgrades ?? null),
      set: (id, patch) => tracked(() => patchUpgrade(scn, id, patch, assets()?.upgrades ?? null)),
    },
    techs: {
      get: (id) => techView(scn, id, assets()?.techs ?? null),
      set: (id, patch) => tracked(() => patchTech(scn, id, patch, assets()?.techs ?? null)),
    },
    sounds: {
      list: () => soundList(scn, store.get(archiveExtrasAtom)),
      add: (path, bytes) => {
        const member = path.includes("\\") || path.includes("/") ? path.replace(/\//g, "\\") : wavMemberName(path);
        const wavs = readWavs(scn);
        const slot = withStrings(() => addSound(scn, wavs, member));
        if (slot < 0) { notes.push(t("all 512 sound slots are taken")); return -1; }
        tracked(() => (applySounds(scn, wavs) ? ["WAV "] : []));
        if (bytes) {
          const extras = new Map(store.get(archiveExtrasAtom));
          extras.set(findMember(extras, member) ?? member, bytes);
          store.set(archiveExtrasAtom, extras);
          touch("WAV ");
        }
        return slot;
      },
      remove: (slot, deleteFile = false) => {
        const wavs = readWavs(scn);
        if (slot < 0 || slot >= wavs.length || wavs[slot] === 0) return false;
        const path = getString(scn.strings, wavs[slot]) ?? "";
        const changed = tracked(() => (applySounds(scn, removeSound(wavs, slot)) ? ["WAV "] : []));
        if (deleteFile && path) {
          const extras = new Map(store.get(archiveExtrasAtom));
          const member = findMember(extras, path);
          if (member) { extras.delete(member); store.set(archiveExtrasAtom, extras); }
        }
        return changed;
      },
    },
    setVersion: (version, extendedStrings) => {
      tracked(() => changeMapVersion(scn, version, extendedStrings));
    },
    setTextEncoding: (encoding) => {
      tracked(() => changeTextEncoding(scn, encoding));
    },

    note: (text) => { notes.push(text); },
  };

  // Both commits: triggers for the trigger lists and the script block's manifest, settings
  // for everything that reads names and colours (a string is shown in half the chrome).
  const commit = () => {
    // One history entry for the update: the first commit records everything it wrote, under its label.
    store.set(commitTriggersAtom, { notice: false, label, extrasBefore });
    store.set(commitSettingsAtom, { notice: false, label });
    store.set(commitNoticeAtom, { reason: "tables", label, area: null, parts: { ...NO_PARTS, settings: true, triggers: true } });
  };

  // There are no change lists here to take an operation back with, so a builder that throws
  // leaves what it wrote — the tables are in the scenario already — and the honest thing is to
  // commit that: the map reads as modified and the chrome re-reads, rather than a name changed
  // in the file and an unmodified title bar. The error goes through.
  let closed = false;
  let returned: unknown;
  try {
    returned = build(sealed("document.update", tx, () => closed));
  } catch (err) {
    closed = true;
    if (sections.size > 0) commit();
    throw err;
  }
  closed = true;
  checkSyncBuilder("document.update", returned, notes);

  const touched = [...sections];
  if (touched.length === 0) return { changed: false, sections: [], notes };
  commit();
  store.set(statusMessageAtom, notes.length > 0 ? `${label} — ${notes.join(", ")}` : label);
  return { changed: true, sections: touched, notes };
}
