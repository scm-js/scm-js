/**
 * The map on its way out of the editor — Save, Test Map, a plugin's `document.export` — with
 * the plugins' build steps run over it (`api.document.buildSteps`, `editor/mapBuild.ts` for
 * the file they make). With no step that applies this is `buildMapFile` and nothing else.
 *
 * A step is somebody else's compiler, so nothing here lets one cost the user a save: a step
 * that throws, never settles (the notice carries a button that stops waiting) or returns
 * something that is not a map leaves the bytes Save would have written anyway, and the
 * caller hears why in `problem`.
 *
 * A plain `Error` from a plugin's step is its message to the user, as the contract asks (a
 * script that does not compile, a failing test): a warning in the log and a `map.build.refused`
 * count. Anything else it throws (`TypeError`, a class of its own, a step that returns no map)
 * is a bug, logged and counted as an error with its stack.
 */
import type { createStore } from "jotai";
import { archiveExtrasAtom, archiveStoredAtom, builtByAtom, scenarioAtom } from "../atoms/documentAtoms";
import { pluginBeforeBuildAtom, pluginBuildStepsAtom, type PluginBuildStepEntry } from "../atoms/pluginAtoms";
import { dismissToastAtom, pushToastAtom } from "../atoms/uiAtoms";
import { logError, logInfo, logWarn } from "../editor/log";
import { packBuiltMap, type BuiltBy } from "../editor/mapBuild";
import { buildChk, buildMapFile, keptExtras, planSave, type SaveOptions } from "../editor/save";
import type { BuildPurpose } from "../plugins/api";
import { t } from "../i18n";
import { count, pluginName } from "./usage";

type Store = ReturnType<typeof createStore>;

export interface OutgoingRequest {
  options: SaveOptions;
  fileName: string;
  purpose: BuildPurpose;
  /** The bytes without the steps, when the caller already built them (the Save dialog's preview). Ignored once a plugin has worked on the document first. */
  plain?: Uint8Array;
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
  /** What a plugin could not do to the document beforehand (`buildSteps.before`): whose work it was and why. */
  unprepared: { label: string; message: string }[];
}

/** Set while steps run: a step that asks for the map (`document.export`) gets it without them. */
const running = new WeakSet<Store>();

export const isBuilding = (store: Store) => running.has(store);

const stepId = (e: { plugin: { id: string }; spec: { id: string } }) => `${e.plugin.id}/${e.spec.id}`;

const safely = (what: string, plugin: string, ask: () => boolean) => {
  try { return ask() === true; } catch (err) { logError("plugins", `${plugin}: ${what} threw`, err); return false; }
};

/** Whether a plugin's throw is the message the contract asks for (`BuildStepSpec.run`: "Throw an `Error`…"), not a bug. */
const isRefusal = (err: unknown): err is Error => err instanceof Error && err.constructor === Error && err.name === "Error";

/** A plugin's step that failed: a warning and a refusal count when it said why in the user's terms, an error otherwise. */
function stepFailed(what: string, err: unknown, step: "prepare" | "build", plugin: { source: string }) {
  const counted = { step, plugin: pluginName(plugin.source) };
  if (!isRefusal(err)) { logError("document", what, err, undefined, counted); return; }
  logWarn("document", `${what}: ${err.message}`);
  count("map.build.refused", counted);
}

export async function buildOutgoing(store: Store, req: OutgoingRequest): Promise<Outgoing> {
  const document = () => {
    const scenario = store.get(scenarioAtom);
    if (!scenario) throw new Error(t("No map is open."));
    return { scenario, extras: store.get(archiveExtrasAtom), stored: store.get(archiveStoredAtom) };
  };
  const plainOf = async (given?: Uint8Array) => {
    const { scenario, extras, stored } = document();
    const plan = planSave(scenario, extras, req.options, stored);
    return { plan, extras, plain: given ?? await buildMapFile(scenario, extras, req.options, plan, stored) };
  };
  const absentNow = () => {
    const registered = new Set(store.get(pluginBuildStepsAtom).map(stepId));
    return (store.get(builtByAtom) ?? []).filter((b) => !registered.has(b.id));
  };
  // Inside a step or a plugin's preparation, the map is whatever it is: nothing runs again.
  if (running.has(store)) return { bytes: (await plainOf(req.plain)).plain, builtBy: null, absent: absentNow(), unprepared: [] };

  const before = store.get(pluginBeforeBuildAtom).filter((e) => !e.spec.applies || safely("applies()", e.plugin.name, () => e.spec.applies!()));
  const unprepared: Outgoing["unprepared"] = [];
  const abort = new AbortController();
  const stopped = new Promise<never>((_, reject) => abort.signal.addEventListener("abort", () => reject(new StoppedError())));
  stopped.catch(() => {});
  let toast: number | null = null;
  const notice = (labels: string) => {
    if (toast !== null) store.set(dismissToastAtom, toast);
    toast = store.set(pushToastAtom, {
      kind: "info", ttl: 0, title: t("Building the map…"), detail: labels,
      action: { label: req.purpose === "test" ? t("Stop") : t("Save without it"), run: () => abort.abort() },
    });
  };
  running.add(store);
  const started = Date.now();
  let plain: Uint8Array | null = null;
  let labels = "";
  // The step that is running, so a failure is counted against its plugin; null once they have all run.
  let failing: PluginBuildStepEntry | null = null;
  try {
    // The plugins' work on the document comes first, so the bytes below and every step's `applies` see its result.
    if (before.length) notice(before.map((e) => e.spec.label).join(", "));
    for (const e of before) {
      if (abort.signal.aborted) break;
      try {
        await Promise.race([Promise.resolve(e.spec.run({ purpose: req.purpose, signal: abort.signal })), stopped]);
      } catch (err) {
        if (err instanceof StoppedError) break;
        stepFailed(`${e.spec.label} could not prepare the map`, err, "prepare", e.plugin);
        unprepared.push({ label: e.spec.label, message: err instanceof Error ? err.message : String(err) });
      }
    }
    const made = await plainOf(before.length ? undefined : req.plain);
    plain = made.plain;
    const out = (more: Partial<Outgoing> = {}): Outgoing => ({ bytes: made.plain, builtBy: null, absent: absentNow(), unprepared, ...more });
    if (abort.signal.aborted) return out({ stopped: true, problem: t("{labels} was stopped.", { labels: before.map((e) => e.spec.label).join(", ") }) });

    const steps = store.get(pluginBuildStepsAtom).filter((e) => safely("the build step's applies()", e.plugin.name, () => e.spec.applies()));
    if (steps.length === 0) return out();
    labels = steps.map((e) => e.spec.label).join(", ");
    if (req.options.format === "chk") return out({ problem: t("A bare .chk has nowhere to keep the map beside what {labels} makes of it. Save as .scx to get the built map.", { labels }) });
    notice(labels);
    let bytes = made.plain;
    for (const e of steps) {
      failing = e;
      const next = await Promise.race([e.spec.run({ map: bytes, fileName: req.fileName, purpose: req.purpose, signal: abort.signal }), stopped]);
      if (!(next instanceof Uint8Array) || next.length === 0) throw new NoMapError(t("{label} returned no map.", { label: e.spec.label }));
      bytes = next;
    }
    failing = null;
    const builtBy = steps.map((e) => ({ id: stepId(e), label: e.spec.label }));
    const kept = made.plan.stored?.kept ? made.plan.stored.members : null;
    const packed = await packBuiltMap({ sourceChk: buildChk(made.plan), extras: keptExtras(made.plan, made.extras), stored: kept, built: bytes, steps: builtBy, options: req.options });
    logInfo("document", "Built the map", { steps: labels, ms: Date.now() - started, bytes: packed.length, plain: made.plain.length, purpose: req.purpose });
    return out({ bytes: packed, builtBy });
  } catch (err) {
    // The document itself could not be written: that is the caller's failure, as it always was.
    if (!plain) throw err;
    const out = (more: Partial<Outgoing>): Outgoing => ({ bytes: plain!, builtBy: null, absent: absentNow(), unprepared, ...more });
    if (err instanceof StoppedError) { logInfo("document", "Build stopped by the user", { steps: labels }); return out({ stopped: true, problem: t("{labels} was stopped.", { labels }) }); }
    if (failing) stepFailed(`Build step failed (${labels})`, err, "build", failing.plugin);
    else logError("document", `Build step failed (${labels})`, err, undefined, { step: "pack" });
    return out({ problem: err instanceof Error ? err.message : String(err) });
  } finally {
    running.delete(store);
    if (toast !== null) store.set(dismissToastAtom, toast);
  }
}

class StoppedError extends Error {}

/** A step that returned no map broke its contract: an error, not a refusal. */
class NoMapError extends Error {
  name = "NoMapError";
}
