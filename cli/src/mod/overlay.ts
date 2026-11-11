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
 *
 * For a bot beside the mod (`bot run`, `bot ladder`: `code`, overlay version 2) the folder carries the mod's code as
 * well: the plugins it carries as files in `plugins/`, its FireGraft project and database in `firegraft/`, and
 * `mod.json` with the mod's name and its hash (`sourceHash`, the play page's rule), which the runner takes as the
 * mod's: the folder lays the files differently from how the mod has them, so the runner could not work it out again.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeTblFile } from "../../../src/formats/dat/tblFile";
import { gameName } from "../../../src/formats/mod/sources";
import type { ModTag } from "@scm-js/replay";
import { fileDigest } from "../../../src/formats/mod/sources";
import { VERSION } from "../about";
import type { RunnerCodeReport, RunnerModReport } from "../engine";
import type { GameFiles } from "../gamefiles";
import { openMod } from "./open";
import { writeLoose } from "./pack";
import { sourceHash } from "./hash";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ModSource } from "./source";

export interface ModOverlay {
  /** Writes the folders (once) and says where they are, in load order: the game's layer when there is one, then the mod. */
  layers: () => Promise<string[]>;
  /** What the runner said of the mod, the game's layer taken out: the mod's own files, and which of them the game read. */
  report: (m: RunnerModReport) => RunnerModReport;
  /** Removes them. */
  remove: () => void;
  /** How many plugins the mod carries as files: what the runners load beside a bot (one in its archive is not loaded). */
  plugins?: () => Promise<number>;
  /**
   * The `SCMJ` tag of a replay of a game played with the mod, as the play page's Save Replay writes it: the data set by
   * the hash the game ran (without the plugins' lines when none ran), the plugins that ran and the FireGraft project,
   * the engine's build. `code` is what the runner said of the mod's code (`start.code`), when it ran any.
   */
  tag?: (o: { code?: RunnerCodeReport | null; build: string }) => Promise<ModTag>;
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

export function modOverlay(path: string, base: () => Promise<GameFiles | null>, o: { code?: boolean } = {}): ModOverlay {
  let dirs: { game: string | null; mod: string } | null = null;
  let mine = new Set<string>(), under = 0;
  let opened: Promise<{ game: GameFiles | null; source: ModSource }> | null = null;
  const open = () => (opened ??= base().then(async (game) => ({ game, source: await openMod(path, game) })));
  return {
    plugins: async () => (await open()).source.plugins.filter((p) => !p.member).length,
    tag: async ({ code, build }) => modTag((await open()).source, code ?? null, build),
    layers: async () => {
      if (!dirs) {
        const { game, source } = await open();
        const lay = await gameLayer(source, game);
        dirs = { game: null, mod: mkdtempSync(join(tmpdir(), "scmjs-mod-")) };
        if (lay.length) { dirs.game = mkdtempSync(join(tmpdir(), "scmjs-game-")); await writeLoose(lay, dirs.game); }
        const members: { member: string; data: Uint8Array }[] = [];
        for (const f of source.files.values()) members.push({ member: f.name, data: await f.read() });
        await writeLoose(members, dirs.mod);
        if (o.code) await writeCode(source, dirs.mod);
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

/** The mod's code beside its files, for a bot's runner: `plugins/`, `firegraft/` and `mod.json` (the module's head says why). */
async function writeCode(source: ModSource, dir: string): Promise<void> {
  // (a plugin inside the mod's archive is not loaded by the play page: only those carried as files)
  const plugins = source.plugins.filter((p) => !p.member);
  if (plugins.length) mkdirSync(join(dir, "plugins"), { recursive: true });
  for (const p of plugins) writeFileSync(join(dir, "plugins", p.name.split(/[\\/]/).pop()!), await p.read());
  if (source.firegraft.length) mkdirSync(join(dir, "firegraft"), { recursive: true });
  for (const f of source.firegraft) writeFileSync(join(dir, "firegraft", f.name.split(/[\\/]/).pop()!), await f.read());
  const hash = await sourceHash(source);
  const link = (source.manifest as { link?: unknown; url?: unknown } | null)?.link ?? (source.manifest as { url?: unknown } | null)?.url;
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: source.name, hash: hash.hash, withoutPlugins: hash.withoutPlugins, ...(typeof link === "string" && /^https?:\/\//.test(link) ? { link } : {}) }, null, 2) + "\n");
}

/**
 * A replay's tag for a game of `source` (`ModOverlay.tag`). The plugins that ran are those the mod carries as files,
 * less any the runner said failed (it names a plugin by the name the plugin gives itself, so a failure is matched by
 * the file's name where it can be); `noplugins` when it carries some and none ran.
 */
export async function modTag(source: ModSource, code: RunnerCodeReport | null, build: string): Promise<ModTag> {
  const hash = await sourceHash(source);
  const carried = source.plugins.filter((p) => !p.member);
  const failed = (code?.plugins ?? []).filter((l) => / failed: /.test(l)).map((l) => l.split(" failed: ")[0].toLowerCase());
  const leaf = (n: string) => n.split(/[\\/]/).pop()!;
  const ran = code ? carried.filter((p) => !failed.includes(leaf(p.name).toLowerCase())) : [];
  const plugins = await Promise.all(ran.map(async (p) => ({ name: leaf(p.name), sha256: await fileDigest(await p.read()) })));
  const fgp = code?.firegraft ? source.firegraft.find((f) => /\.fgp$/i.test(f.name)) : undefined;
  const link = (source.manifest as { link?: unknown; url?: unknown } | null)?.link ?? (source.manifest as { url?: unknown } | null)?.url ?? code?.link;
  const noplugins = carried.length > 0 && plugins.length === 0;
  return {
    v: 1,
    dataSet: { hash: noplugins ? hash.withoutPlugins : hash.hash, name: source.name, url: typeof link === "string" && /^https?:\/\//i.test(link) ? link : null },
    plugins,
    firegraft: fgp ? { name: leaf(fgp.name), sha256: await fileDigest(await fgp.read()) } : null,
    noplugins,
    engine: { lifter: "shipped", build },
    madeBy: `scmjs ${VERSION}`,
  };
}
