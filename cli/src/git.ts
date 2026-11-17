/** git, run to its end for the commands that read a map's history or set a repository up. */
import { spawnSync, type SpawnSyncReturns } from "node:child_process";

/** git's output as bytes: a map as a commit holds it, or a long log. `maxBuffer` is the most it may write. */
export function gitBytes(args: string[], o: { maxBuffer: number; input?: string }): SpawnSyncReturns<Buffer> {
  return spawnSync("git", args, { maxBuffer: o.maxBuffer, input: o.input === undefined ? undefined : Buffer.from(o.input) });
}

/** git's output as text, as much as Node takes by default: a setting, a hash, a folder. */
export function gitText(args: string[]): SpawnSyncReturns<string> {
  return spawnSync("git", args, { encoding: "utf8" });
}
