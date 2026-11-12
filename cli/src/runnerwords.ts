/**
 * A game runner's words as a person reads them (`bot run`, `bot ladder`): the game's insides left out, the toolchain's
 * commands as this command names them. Kept apart from `botrun.ts` so that `ladder.ts` reads it without a cycle.
 */
import { t } from "./i18n";

/** `SCMJS_DEBUG`: the runner's words as it said them, addresses and all. */
export const debug = () => !!process.env.SCMJS_DEBUG && process.env.SCMJS_DEBUG !== "0";

/**
 * A runner's error as a person reads it: the game's insides left out — an address (`from 0x4d29c5`), the stack words, the
 * library function the game called that the engine has no stand-in for. What the game was doing stays. With
 * `SCMJS_DEBUG` set, the words as the runner said them.
 */
export function plainRunnerError(message: string): string {
  // (the toolchain's own command, as this one names it: the toolchain is reached through scmjs bot; a bot built before
  // a mod's plugins could run beside it needs the newest toolchain first, which the cached image may not be)
  message = message.replace(/build it again with the scmbot toolchain \(scmbot build\)/g, "build it again with the newest toolchain (scmjs bot update, then scmjs bot build)")
    .replace(/\bscmbot (build|init|new|update)\b/g, "scmjs bot $1");
  if (debug()) return message;
  const inner = /0x[0-9a-f]{4,}|stack words|\b\w+\.dll!|no stand-in for/i;
  // (a bracket that holds an address or the like goes whole: "(the game's fatal error, from 0x4d29c5)")
  let text = message.replace(/\s*\([^()]*\)/g, (m) => (inner.test(m) ? "" : m));
  // (then the first ": "-part that is the engine's own, and all after it)
  const parts = text.split(": ");
  const keep: string[] = [];
  for (const part of parts) { if (inner.test(part)) break; keep.push(part); }
  text = keep.join(": ").trim();
  return text || t("the game stopped");
}


/**
 * Why a replay's game ended, as a person reads it: a reason in the engine's own words (the frame loop, a reason word
 * at an address) is "the game ended"; one in plain words stays. With `SCMJS_DEBUG`, as the runner said it.
 */
export function plainReason(reason: string | null): string | null {
  if (reason === null || debug()) return reason;
  return /0x[0-9a-f]{4,}|reason word|frame loop|stack words|\.dll!/i.test(reason) ? t("the game ended") : reason;
}
