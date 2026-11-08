/**
 * A mod for the game engine's runners (`map test --mod`, `map trace --mod`, `mod test`): its files written as a loose
 * folder in the game's paths, in a temporary folder that goes when the run ends.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GameFiles } from "../gamefiles";
import { openMod } from "./open";
import { writeLoose } from "./pack";

export interface ModOverlay {
  /** Writes the folder (once) and says where it is. */
  folder: () => Promise<string>;
  /** Removes it. */
  remove: () => void;
}

export function modOverlay(path: string, base: () => Promise<GameFiles | null>): ModOverlay {
  let dir: string | null = null;
  return {
    folder: async () => {
      if (dir) return dir;
      const source = await openMod(path, await base());
      dir = mkdtempSync(join(tmpdir(), "scmjs-mod-"));
      const members: { member: string; data: Uint8Array }[] = [];
      for (const f of source.files.values()) members.push({ member: f.name, data: await f.read() });
      await writeLoose(members, dir);
      return dir;
    },
    remove: () => { if (dir) rmSync(dir, { recursive: true, force: true }); dir = null; },
  };
}
