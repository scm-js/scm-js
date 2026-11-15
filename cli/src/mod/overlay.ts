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
 * well: in `plugins/`, every module of it the mod's hash has a line for (`@scm-js/mod`'s identity: the plugin files, the
 * plugins a patcher exe carries in itself, the libraries its plugins load), its FireGraft project and database in
 * `firegraft/`, and `mod.json` with the mod's name and its hash, which the runner takes as the mod's: the folder lays
 * the files differently from how the mod has them, so the runner could not work it out again.
 */
import { rmSync } from "node:fs";
import { tempFolder } from "../lifecycle";
import { join } from "node:path";
import { decodeTblFile } from "../../../src/formats/dat/tblFile";
import { gameName, leafOf, runningHash, sha256Hex, STARTUP_NAMES } from "@scm-js/mod";
import type { ModTag } from "@scm-js/replay";
import { VERSION } from "../about";
import type { RunnerCodeReport, RunnerModReport } from "../engine";
import type { GameFiles } from "../gamefiles";
import { openMod } from "./open";
import { writeLoose } from "./pack";
import { pluginCount } from "./hash";
import { mkdirSync, writeFileSync } from "node:fs";
import type { ModSource } from "./source";

export interface ModOverlay {
  /** Writes the folders (once) and says where they are, in load order: the game's layer when there is one, then the mod. */
  layers: () => Promise<string[]>;
  /** What the runner said of the mod, the game's layer taken out: the mod's own files, and which of them the game read. */
  report: (m: RunnerModReport) => RunnerModReport;
  /** Removes them. */
  remove: () => void;
  /** How many plugins of the mod's code a loader loads: what the runners load beside a bot (one in its archive is not loaded). */
  plugins?: () => Promise<number>;
  /**
   * The `SCMJ` tag of a replay of a game played with the mod, as the play page's Save Replay writes it: the data set by
   * the hash the game ran (without the plugins' lines when none ran), the plugins that ran and the FireGraft project,
   * the engine's build. `code` is what the runner said of the mod's code (`start.code`), when it ran any.
   */
  tag?: (o: { code?: RunnerCodeReport | null; build: string }) => Promise<ModTag>;
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
 * Empty for a 1.16.1 copy, for no copy, and for a mod the runner does not read the startup data again for
 * (`@scm-js/mod`'s `readsStartupData`, the engine's rule: a mod that is only code changes no startup data).
 */
export async function gameLayer(source: ModSource, base: GameFiles | null): Promise<{ member: string; data: Uint8Array }[]> {
  if (base?.kind !== "remastered" || !source.description?.identity.readsStartupData) return [];
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
    plugins: async () => pluginCount((await open()).source),
    tag: async ({ code, build }) => modTag((await open()).source, code ?? null, build),
    layers: async () => {
      if (!dirs) {
        const { game, source } = await open();
        const lay = await gameLayer(source, game);
        dirs = { game: null, mod: tempFolder("scmjs-mod-") };
        if (lay.length) { dirs.game = tempFolder("scmjs-game-"); await writeLoose(lay, dirs.game); }
        const members: { member: string; data: Uint8Array }[] = [];
        // (a file its archive could not give, which the hash leaves out too, is left out: `unheld`)
        for (const f of source.files.values()) { try { members.push({ member: f.name, data: await f.read() }); } catch { /* unreadable */ } }
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
  // (every module of the mod's code the hash has a line for, under the name the hash knows it by; a plugin inside the
  // mod's archive is loaded by no loader and has none)
  if (source.code.length) mkdirSync(join(dir, "plugins"), { recursive: true });
  for (const m of source.code) writeFileSync(join(dir, "plugins", m.name), await m.read());
  if (source.firegraft.length) mkdirSync(join(dir, "firegraft"), { recursive: true });
  for (const f of source.firegraft) writeFileSync(join(dir, "firegraft", leafOf(f.name)), await f.read());
  const id = source.description!.identity;
  writeFileSync(join(dir, "mod.json"), JSON.stringify({ name: source.name, hash: id.hash, withoutPlugins: id.withoutPlugins, ...(source.link ? { link: source.link } : {}) }, null, 2) + "\n");
}

/**
 * A replay's tag for a game of `source` (`ModOverlay.tag`). The plugins that ran are the mod's plugins (`code`, the
 * libraries apart), less any the runner said failed (it names a plugin by the name the plugin gives itself, so a
 * failure is matched by the file's name where it can be); `noplugins` when it has some and none ran. The data set is
 * named by the hash of the game that ran: the mod's when all ran, without its code when none did, and the hash of
 * what ran (`runningHash`) between.
 */
export async function modTag(source: ModSource, code: RunnerCodeReport | null, build: string): Promise<ModTag> {
  const id = source.description!.identity;
  const carried = source.code.filter((c) => c.role !== "library");
  const failed = (code?.plugins ?? []).filter((l) => / failed: /.test(l)).map((l) => l.split(" failed: ")[0].toLowerCase());
  const ran = code ? carried.filter((p) => !failed.includes(p.name.toLowerCase())) : [];
  const plugins = ran.map((p) => ({ name: p.name, sha256: id.plugins[p.name] }));
  const fgp = code?.firegraft ? source.firegraft.find((f) => /\.fgp$/i.test(f.name)) : undefined;
  const link = source.link ?? code?.link;
  const noplugins = carried.length > 0 && plugins.length === 0;
  const running = [...ran.map((p) => p.name), ...source.code.filter((c) => c.role === "library").map((c) => c.name)];
  const hash = noplugins ? id.withoutPlugins : ran.length === carried.length ? id.hash : await runningHash(id.lines, id.plugins, running);
  return {
    v: 1,
    dataSet: { hash, name: source.name, url: typeof link === "string" && /^https?:\/\//i.test(link) ? link : null },
    plugins,
    firegraft: fgp ? { name: leafOf(fgp.name), sha256: await sha256Hex(await fgp.read()) } : null,
    noplugins,
    engine: { lifter: "shipped", build },
    madeBy: `scmjs ${VERSION}`,
  };
}
