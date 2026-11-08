/**
 * A mod for the game engine's runners (`map test --mod`, `map trace --mod`, `mod test`): its files written as a loose
 * folder in the game's paths, in a temporary folder that goes when the run ends.
 *
 * A mod that holds startup data (the animation scripts, the image or sound table, a picture or overlay under `unit\`)
 * has the game read that data again before the start, and that reload opens every unit picture and overlay
 * images.tbl names. The runner reads a copy of StarCraft: Remastered itself and takes of it only what a game without
 * a mod needs (the tilesets, the tables, the interface), not those pictures. So on a Remastered copy the command lays
 * them under the mod as a layer of their own, read out of the installation by its own reader (`gamefiles.ts`: the
 * game's names, the same bytes as a 1.16.1 copy's archives), and takes that layer back out of what the runner says
 * of the mod. A 1.16.1 copy's archives hold them and the runner reads those itself: nothing is laid under the mod there.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeTblFile } from "../../../src/formats/dat/tblFile";
import { gameName } from "../../../src/formats/mod/sources";
import type { RunnerModReport } from "../engine";
import type { GameFiles } from "../gamefiles";
import { openMod } from "./open";
import { writeLoose } from "./pack";
import type { ModSource } from "./source";

export interface ModOverlay {
  /** Writes the folders (once) and says where they are, in load order: the game's layer when there is one, then the mod. */
  layers: () => Promise<string[]>;
  /** What the runner said of the mod, the game's layer taken out: the mod's own files, and which of them the game read. */
  report: (m: RunnerModReport) => RunnerModReport;
  /** Removes them. */
  remove: () => void;
}

/** What the game's reload of its startup data reads by name besides the pictures (scm-sim `src/exact/mods.ts`, `STARTUP_NAMES`). */
export const STARTUP_NAMES: readonly string[] = ["scripts\\iscript.bin", "arr\\images.dat", "game\\tselect.pcx", "arr\\images.tbl", "arr\\sfxdata.dat", "arr\\sfxdata.tbl", "arr\\mapdata.dat", "arr\\mapdata.tbl"];

/** Whether the runner reads the startup data again for a mod holding these names (scm-sim's `readsStartupData`). */
export function readsStartupData(names: Iterable<string>): boolean {
  for (const n of names) if (STARTUP_NAMES.includes(n) || n.startsWith("unit\\")) return true;
  return false;
}

/** Every picture and overlay file images.tbl names (`unit\zerg\avenger.grp`), by the game's names, each once. */
export function imageFiles(imagesTbl: Uint8Array): string[] {
  const out = new Set<string>();
  for (const s of decodeTblFile(imagesTbl).strings) { const p = s.replace(/\0[\s\S]*$/, ""); if (p) out.add(gameName(`unit\\${p}`)); }
  return [...out];
}

/** How many files are read out of the installation at once. */
const BATCH = 24;

/**
 * The game's own files the reload reads and the mod has not got — the startup data, and every picture and overlay
 * of the image table the game will hold (the mod's images.tbl when it has one) — read out of a Remastered copy.
 * Empty for a 1.16.1 copy, for no copy, and for a mod the runner does not read the startup data again for.
 */
export async function gameLayer(source: ModSource, base: GameFiles | null): Promise<{ member: string; data: Uint8Array }[]> {
  if (base?.kind !== "remastered" || !readsStartupData(source.files.keys())) return [];
  const own = source.files.get("arr\\images.tbl");
  const tbl = own ? await own.read() : await base.read("arr\\images.tbl");
  const names = [...STARTUP_NAMES, ...(tbl ? imageFiles(tbl) : [])].filter((n) => !source.files.has(n));
  const out: { member: string; data: Uint8Array }[] = [];
  for (let i = 0; i < names.length; i += BATCH) {
    const got = await Promise.all(names.slice(i, i + BATCH).map(async (member) => ({ member, data: await base.read(member) })));
    for (const g of got) if (g.data) out.push({ member: g.member, data: g.data });
  }
  return out;
}

export function modOverlay(path: string, base: () => Promise<GameFiles | null>): ModOverlay {
  let dirs: { game: string | null; mod: string } | null = null;
  let mine = new Set<string>(), under = 0;
  return {
    layers: async () => {
      if (!dirs) {
        const game = await base();
        const source = await openMod(path, game);
        const lay = await gameLayer(source, game);
        dirs = { game: null, mod: mkdtempSync(join(tmpdir(), "scmjs-mod-")) };
        if (lay.length) { dirs.game = mkdtempSync(join(tmpdir(), "scmjs-game-")); await writeLoose(lay, dirs.game); }
        const members: { member: string; data: Uint8Array }[] = [];
        for (const f of source.files.values()) members.push({ member: f.name, data: await f.read() });
        await writeLoose(members, dirs.mod);
        mine = new Set(source.files.keys());
        under = lay.length;
      }
      return dirs.game ? [dirs.game, dirs.mod] : [dirs.mod];
    },
    report: (m) => {
      const game = dirs?.game;
      if (!game) return m;
      return { ...m, paths: m.paths.filter((p) => p !== game), files: mine.size, read: m.read.filter((n) => mine.has(gameName(n))), game: under };
    },
    remove: () => {
      for (const d of [dirs?.game, dirs?.mod]) if (d) rmSync(d, { recursive: true, force: true });
      dirs = null;
    },
  };
}
