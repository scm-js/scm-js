/**
 * `api.triggers`: reading the trigger lists and the tables that present them, and trigger claims.
 */
import { scenarioAtom } from "../../atoms/documentAtoms";
import { claimBadge, locateClaims } from "../claims";
import { nextContributionKey, pluginTriggerClaimsAtom, type PluginTriggerClaim } from "../../atoms/pluginAtoms";
import type { Scenario } from "../../formats/chk/scenario";
import { ACTION_DEFS, actionDef, BRIEFING_ACTION_DEFS, CHOICES, choiceLabel, choiceValue, CONDITION_DEFS, conditionDef } from "../../data/triggerDefs";
import { readSwitchNames, switchUsage } from "../../editor/switches";
import { resolvePlayers, triggerReferences } from "../../editor/triggerRefs";
import { addressOfEpd, epdOf, fingerprintTrigger, isPreserved, newAction, newCondition, newTrigger, readBriefing, readTriggers, triggerUsage, newStringDrafts, parseTriggerText, resolveDraftStrings, setPreserved, triggerNames, triggersFor } from "../../editor/triggers";
import { formatTrigger, formatTriggers, summarizeTrigger, triggerComment } from "../../formats/triggers/text";
import { forceViews } from "../../editor/settings";
import type { PluginInfo, TriggersApi } from "../api";
import type { Store, Contributions } from "./shared";

/** `api.triggers`: reading TRIG and MBRF, and the tables that make a record presentable. */
export function triggersApi(store: Store): Omit<TriggersApi, "claim"> {
  const scenario = () => store.get(scenarioAtom);
  const names = () => {
    const scn = scenario();
    if (!scn) throw new Error("No map is open.");
    return triggerNames(scn);
  };
  return {
    list: () => { const scn = scenario(); return scn ? readTriggers(scn) : []; },
    briefing: () => { const scn = scenario(); return scn ? readBriefing(scn) : []; },
    claims: (list) => {
      const scn = scenario();
      const target = list ?? (scn ? scn.triggers : []);
      return locateClaims(store.get(pluginTriggerClaimsAtom), target).map((r) => ({ pluginId: r.claim.pluginId, label: r.claim.spec.label, badge: claimBadge(r), start: r.start, count: r.count }));
    },
    switchNames: () => { const scn = scenario(); return scn ? readSwitchNames(scn) : []; },
    switchUsage: () => { const scn = scenario(); return scn ? switchUsage(scn) : []; },
    names,
    defs: {
      conditions: () => CONDITION_DEFS.slice(),
      condition: conditionDef,
      actions: (briefing = false) => (briefing ? BRIEFING_ACTION_DEFS : ACTION_DEFS).slice(),
      action: actionDef,
      choices: (kind) => (CHOICES[kind] ?? []).map((c) => ({ ...c })),
      choiceLabel,
      choiceValue,
    },
    text: {
      print: (triggers, options = {}) => formatTriggers(triggers, names(), options.briefing ?? false),
      one: (trigger, options = {}) => formatTrigger(trigger, names(), options.briefing ?? false),
      parse: (source, options = {}) => {
        const scn = scenario();
        if (!scn) throw new Error("No map is open.");
        // The records answer with real string indices, as they always have, but the strings
        // go in only after the whole text parsed: a mistake in it leaves the table alone.
        const drafts = newStringDrafts();
        const parsed = parseTriggerText(scn, source, options.briefing ?? false, drafts);
        const resolved = resolveDraftStrings(scn, parsed.map((t) => t.trigger), drafts);
        return parsed.map((t, i) => ({ ...t, trigger: resolved[i] }));
      },
    },
    newTrigger,
    newCondition,
    newAction,
    isPreserved,
    setPreserved,
    triggersFor,
    summarize: (trigger, briefing = false) => summarizeTrigger(trigger, names(), briefing),
    comment: (trigger) => triggerComment(trigger, names()),
    epd: epdOf,
    addressOf: addressOfEpd,
    fingerprint: fingerprintTrigger,
    usage: (list) => triggerUsage(list ?? (scenario() ? readTriggers(scenario()!) : [])),
    references: (list, options = {}) => {
      const scn = scenario();
      const briefing = options.briefing ?? false;
      return triggerReferences(list ?? (scn ? (briefing ? scn.briefing : scn.triggers) : []), forceSlots(scn), briefing);
    },
    resolvePlayers: (group, owners = []) => resolvePlayers(group, owners, forceSlots(scenario())),
  };
}

/** Each force's slots, for resolving *Force N* in a trigger. */
function forceSlots(scn: Scenario | null): number[][] {
  return scn ? forceViews(scn).map((f) => f.players) : [];
}

/** `api.triggers`: the reads, and `claim`, which registers in the plugin's bag. */
export function triggersWithClaims(store: Store, info: PluginInfo, bag: Contributions): TriggersApi {
  return {
    ...triggersApi(store),
    claim: (spec) => {
      const key = nextContributionKey();
      const entry = (revision: number): PluginTriggerClaim => ({ key, pluginId: info.id, pluginName: info.name, spec, revision });
      store.set(pluginTriggerClaimsAtom, [...store.get(pluginTriggerClaimsAtom), entry(0)]);
      const remove = bag.add(() => store.set(pluginTriggerClaimsAtom, store.get(pluginTriggerClaimsAtom).filter((c) => c.key !== key)));
      return {
        dispose: () => remove.dispose(),
        remove: () => remove.dispose(),
        refresh: () => store.set(pluginTriggerClaimsAtom, store.get(pluginTriggerClaimsAtom).map((c) => (c.key === key ? entry(c.revision + 1) : c))),
      };
    },
  };
}
