/**
 * The verbose log of what each plugin called.
 */
import { isVerbose, log, logError } from "../../editor/log";
import type { PluginInfo } from "../api";

/** One argument or logged value, cut to something that fits on a line. A log entry must stay small. */
export function printable(v: unknown, max = 80): string {
  if (typeof v === "string") return v.length > max ? `${v.slice(0, max)}…` : v;
  if (v === null || v === undefined || typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Error) return v.message;
  if (typeof v === "function") return "fn";
  try {
    const text = JSON.stringify(v) ?? String(v);
    return text.length > max ? `${text.slice(0, max)}…` : text;
  } catch {
    return Object.prototype.toString.call(v);
  }
}

/**
 * Wrap every function on the API object so a verbose session records who called what.
 *
 * "Which plugin touched the map" is the question a strange map raises and nothing else can
 * answer — there is no sandbox, and five plugins ship on by default. Wrapping here rather
 * than at two hundred call sites works because `createPluginApi` builds one fresh literal
 * per plugin: the wrappers are private to that plugin, so the path they log
 * (`document.edit`, `ui.pickObject`) needs no extra bookkeeping.
 *
 * Off, a call costs one function frame and a boolean — nothing beside the store reads and
 * scenario walks underneath it. The message is built inside the gate, never before it.
 */
export function instrument(node: Record<string, unknown>, info: PluginInfo, path = "", depth = 0): void {
  if (depth > 3) return;
  const keys = Object.keys(node);
  // A data table (`api.consts`) is not worth walking, and there is nothing to wrap in it.
  if (keys.length > 200) return;
  for (const key of keys) {
    const value = node[key];
    const full = path ? `${path}.${key}` : key;
    if (typeof value === "function") {
      const fn = value as (...args: unknown[]) => unknown;
      node[key] = function (this: unknown, ...args: unknown[]) {
        if (!isVerbose()) return fn.apply(this, args);
        const started = performance.now();
        try {
          const out = fn.apply(this, args);
          const ms = Math.round(performance.now() - started);
          log("info", info.name, `${full}(${args.map((a) => printable(a, 40)).join(", ")})`, { ms: ms >= 1 ? ms : undefined });
          return out;
        } catch (err) {
          logError(info.name, `${full} threw`, err);
          throw err;
        }
      };
    } else if (value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype) {
      instrument(value as Record<string, unknown>, info, full, depth + 1);
    }
  }
}
