/**
 * The weigher `scmjs map cost` hands the game's map runner: TrigScript's model of what Remastered charges for each
 * trigger the walk passes and each condition and action it runs (`plugins/trigscript/compiler/remasteredCost.ts`, from
 * the frame-weights probes played on the real game). Built on its own into `cli/dist/weigh.mjs` beside `scmjs.mjs`
 * (scripts/build-cli.mjs), because the runner is a process of its own that must weigh inside the game's memory —
 * the model reads each record's bytes and keeps the emulator's two region caches as Remastered does — and the
 * command's own bundle is not a module it can import. The runner asks for `weigher(memory)` and reads the two limits.
 */
import { RemasteredWeigh } from "../../plugins/trigscript/compiler/remasteredCost";

export { SMOOTH_MS, MOST_MS } from "../../plugins/trigscript/compiler/remasteredCost";

/** The weigher over the game's memory, as scm-sim's cost tap asks it (`CostWeigh`, by shape). */
export function weigher(memory: DataView): RemasteredWeigh {
  return new RemasteredWeigh(memory);
}
