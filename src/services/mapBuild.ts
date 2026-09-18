/**
 * The map on its way out of the editor — Save, Test Map, a plugin's `document.export` — with
 * the plugins' build steps run over it (`api.document.buildSteps`, `editor/mapBuild.ts` for
 * the file they make). With no step that applies this is `buildMapFile` and nothing else.
 *
 * A step is somebody else's compiler, so nothing here lets one cost the user a save: a step
 * that throws, never settles (the notice carries a button that stops waiting) or returns
 * something that is not a map leaves the bytes Save would have written anyway, and the
 * caller hears why in `problem`.
 */
import type { createStore } from "jotai";
import { builtByAtom } from "../atoms/documentAtoms";
import { pluginBuildStepsAtom } from "../atoms/pluginAtoms";
import { dismissToastAtom, pushToastAtom } from "../atoms/uiAtoms";
import { logError, logInfo } from "../editor/log";
import { packBuiltMap, type BuiltBy } from "../editor/mapBuild";
import { buildChk, buildMapFile, keptExtras, planSave, type SaveOptions, type SavePlan } from "../editor/save";
import type { Scenario } from "../formats/chk/scenario";
import type { StoredMembers } from "../formats/mpq/scm";
import type { BuildPurpose } from "../plugins/api";
import { t } from "../i18n";

type Store = ReturnType<typeof createStore>;

export interface OutgoingRequest {
  scenario: Scenario;
  extras: Map<string, Uint8Array>;
  stored: StoredMembers | null;
  options: SaveOptions;
  fileName: string;
  purpose: BuildPurpose;
  /** The bytes without the steps, when the caller already built them (the Save dialog's preview). */
  plain?: Uint8Array;
  plan?: SavePlan;
}

export interface Outgoing {
  bytes: Uint8Array;
  /** The steps that made `bytes`; null when they are the plain map. */
  builtBy: BuiltBy[] | null;
  /** Why the steps that apply are not in `bytes`, in the user's words. */
  problem?: string;
  /** The user stopped waiting — a choice, not a failure. */
  stopped?: boolean;
  /** Steps the opened file names that no running plugin provides. */
  absent: BuiltBy[];
}

/** Set while steps run: a step that asks for the map (`document.export`) gets it without them. */
const running = new WeakSet<Store>();

export const isBuilding = (store: Store) => running.has(store);

/** The registered steps that have something to do for the open map, in activation order. */
export function applicableSteps(store: Store) {
  return store.get(pluginBuildStepsAtom).filter((e) => {
    try { return e.spec.applies() === true; } catch (err) { logError("plugins", `${e.plugin.name}: the build step's applies() threw`, err); return false; }
  });
}

const stepId = (e: { plugin: { id: string }; spec: { id: string } }) => `${e.plugin.id}/${e.spec.id}`;

export async function buildOutgoing(store: Store, req: OutgoingRequest): Promise<Outgoing> {
  const plan = req.plan ?? planSave(req.scenario, req.extras, req.options, req.stored);
  const plain = req.plain ?? await buildMapFile(req.scenario, req.extras, req.options, plan, req.stored);
  const registered = new Set(store.get(pluginBuildStepsAtom).map(stepId));
  const absent = (store.get(builtByAtom) ?? []).filter((b) => !registered.has(b.id));
  const out = (more: Partial<Outgoing> = {}): Outgoing => ({ bytes: plain, builtBy: null, absent, ...more });
  if (running.has(store)) return out();
  const steps = applicableSteps(store);
  if (steps.length === 0) return out();
  const labels = steps.map((e) => e.spec.label).join(", ");
  if (req.options.format === "chk") return out({ problem: t("A bare .chk has nowhere to keep the map beside what {labels} makes of it. Save as .scx to get the built map.", { labels }) });

  const abort = new AbortController();
  const stopped = new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(new StoppedError())));
  const toast = store.set(pushToastAtom, {
    kind: "info", ttl: 0, title: t("Building the map…"), detail: labels,
    action: { label: req.purpose === "test" ? t("Stop") : t("Save without it"), run: () => abort.abort() },
  });
  running.add(store);
  const started = Date.now();
  try {
    let bytes = plain;
    for (const e of steps) {
      const next = await Promise.race([e.spec.run({ map: bytes, fileName: req.fileName, purpose: req.purpose, signal: abort.signal }), stopped]);
      if (!(next instanceof Uint8Array) || next.length === 0) throw new Error(t("{label} returned no map.", { label: e.spec.label }));
      bytes = next;
    }
    const builtBy = steps.map((e) => ({ id: stepId(e), label: e.spec.label }));
    const kept = plan.stored?.kept ? plan.stored.members : null;
    const packed = await packBuiltMap({ sourceChk: buildChk(plan), extras: keptExtras(plan, req.extras), stored: kept, built: bytes, steps: builtBy, options: req.options });
    logInfo("document", "Built the map", { steps: labels, ms: Date.now() - started, bytes: packed.length, plain: plain.length, purpose: req.purpose });
    return out({ bytes: packed, builtBy });
  } catch (err) {
    if (err instanceof StoppedError) { logInfo("document", "Build stopped by the user", { steps: labels }); return out({ stopped: true, problem: t("{labels} was stopped.", { labels }) }); }
    logError("document", `Build step failed (${labels})`, err);
    return out({ problem: err instanceof Error ? err.message : String(err) });
  } finally {
    running.delete(store);
    store.set(dismissToastAtom, toast);
  }
}

class StoppedError extends Error {}
