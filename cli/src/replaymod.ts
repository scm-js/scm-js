/**
 * A replay's mod. A replay records commands, not the files the game read, so scm-sim and the editor's tools add an
 * `SCMJ` section that names the mod a game was played with (`@scm-js/replay`'s `mod`: the data set's hash, name and
 * link, the plugins that ran). Here: the mod named with `--mod` checked against it by that hash (the play page's rule,
 * core's `modHashOfDigests` over every file the mod provides, with its plugins or without them; and, for a replay
 * tagged before that rule, the older forms: the game files alone, or those that differ from the person's game), the names and costs of
 * units, upgrades and technologies from the mod's tables (the game's for a replay of the game itself, and bare ids for
 * a mod's replay with no mod named: never the game's name for a mod's id), and the refusal of the commands that play a
 * replay, which would play another game with other files.
 */
import { FRAME_MS, type ModTag, type Replay } from "@scm-js/replay";
import { techName, unitName, upgradeName } from "../../src/data/units";
import type { DatFile } from "../../src/formats/dat/table";
import { loadModData, type ModData } from "../../src/formats/mod/data";
import { dataSetHashOfDigests, fileDigest } from "../../src/formats/mod/sources";
import { sourceHash } from "./mod/hash";
import type { GameFiles } from "./gamefiles";
import { t, translate } from "./i18n";
import { iscriptMembers, modTables } from "./mod/check";
import { gameFilesOrNull, openMod } from "./mod/open";
import { reader, type ModSource } from "./mod/source";
import { CliError, dot, duration, mark, num, pc, table } from "./ui";

/** The hashes a replay may name the mod by. */
export interface ModHashes {
  /** The mod's hash (the play page's rule: every file it provides, its plugins and its FireGraft project). */
  hash: string;
  /** The same without the plugins' lines: a page that ran none of them. */
  withoutPlugins: string;
  /** Older forms, for replays tagged before the rule: over the game files alone, and over those that differ from the person's game (null without a copy). */
  all: string;
  changed: string | null;
}

/** Every hash the mod may be named by in a replay's tag. */
export async function sourceHashes(source: ModSource, base: GameFiles | null): Promise<ModHashes> {
  const h = await sourceHash(source);
  let changed: string | null = null;
  if (base) {
    const differ: { name: string; sha256: string }[] = [];
    for (const f of source.files.values()) {
      let data: Uint8Array;
      try { data = await f.read(); } catch { continue; }
      const theirs = await base.read(f.name);
      if (!(theirs && theirs.length === data.length && theirs.every((b, i) => b === data[i]))) differ.push({ name: f.name, sha256: await fileDigest(data) });
    }
    changed = await dataSetHashOfDigests(differ);
  }
  return { hash: h.hash, withoutPlugins: h.withoutPlugins, all: h.gameFilesOnly, changed };
}

/** Whether a replay's data set is the mod, by any of the forms it may be named by. */
export const isTaggedMod = (wanted: string, h: ModHashes): boolean => [h.hash, h.withoutPlugins, h.all, h.changed].includes(wanted);

/** The mod a replay says it was played with, in one line: "Cosmonarchy BW · 1f2e3d4c5b6a7980". */
export const modWords = (tag: ModTag) => `${tag.dataSet.name || t("a mod")}${dot}${tag.dataSet.hash}`;

/**
 * Refuses a replay of a mod for a command that plays the replay in the game engine, which would play it with the
 * game's own files and so another game. `command` is the command's name (`replay watch`).
 */
export function refuseModReplay(rep: Replay, file: string, command: string): void {
  if (!rep.mod) return;
  throw new CliError(t("{file} was played with {mod}, and {command} cannot play a mod's replay yet: with the game's own files it would play another game.", { file, mod: modWords(rep.mod), command }), rep.mod.dataSet.url ? t("The mod's makers: {url}", { url: rep.mod.dataSet.url }) : null);
}

const opened = new Map<string, Promise<{ source: ModSource; base: GameFiles | null; hashes: ModHashes }>>();

/** Why a list of replays to play leaves a mod's replay out, or null for a replay of the game itself. */
export const modReplayReason = (rep: Replay): string | null => (rep.mod ? t("played with {mod}, which this cannot lay over the game yet", { mod: modWords(rep.mod) }) : null);

/**
 * For the commands that play a replay in the engine with `--mod` (map trace and map cost): a mod's replay needs that
 * mod named, the same data set, and no plugins, as the engine's runners lay a mod's files over the game's and run no
 * plugin. A replay of the game itself plays as before, with a mod or without.
 */
export async function checkPlayedMod(rep: Replay, file: string, mod: string | undefined, starcraft: string | undefined, warn: (line: string) => void): Promise<void> {
  if (!rep.mod) return;
  if (!mod) throw new CliError(t("{file} was played with {mod}: name the mod's folder with --mod, or the game would play another game.", { file, mod: modWords(rep.mod) }), rep.mod.dataSet.url ? t("The mod's makers: {url}", { url: rep.mod.dataSet.url }) : null, 2);
  if (!rep.mod.noplugins && rep.mod.plugins.length) throw new CliError(t("{file} was played with the plugins of {mod}, which the engine here does not run: it would play another game.", { file, mod: modWords(rep.mod) }), null, 1);
  await checkReplayMod(rep, file, mod, starcraft, warn);
}

/**
 * Checks that the mod at `path` is the one the replay was played with. A replay with no tag: a warning to `warn`, as
 * the names may then not be the game's. Returns the mod opened, its hash, and the copy of the game it was compared with.
 */
export async function checkReplayMod(rep: Replay, file: string, path: string, starcraft: string | undefined, warn: (line: string) => void): Promise<{ source: ModSource; base: GameFiles | null; hash: string }> {
  const key = `${path}\0${starcraft ?? ""}`;
  // (Several replays and one mod: the mod is opened and hashed once.)
  let open = opened.get(key);
  if (!open) {
    open = (async () => { const base = await gameFilesOrNull(starcraft); const source = await openMod(path, base); return { source, base, hashes: await sourceHashes(source, base) }; })();
    opened.set(key, open);
  }
  const { source, base, hashes } = await open;
  const hash = hashes.hash;
  const tag = rep.mod;
  if (!tag) {
    warn(t("{file} does not say which mod it was played with: the names are {mod}'s, which may not be the game's.", { file, mod: source.name }));
    return { source, base, hash };
  }
  if (isTaggedMod(tag.dataSet.hash, hashes)) return { source, base, hash: tag.dataSet.hash };
  throw new CliError(
    t("{mod} is not the mod {file} was played with: its data set is {hash}, the replay's is {wanted} ({name}).", { mod: source.name, file, hash, wanted: tag.dataSet.hash, name: tag.dataSet.name }),
    tag.dataSet.url ? t("The mod's makers: {url}", { url: tag.dataSet.url }) : null, 1);
}

/** `replay info`'s options for names: `--mod`, `--builds`, `--starcraft`. */
export interface ReplayNameOptions { mod?: string; builds?: boolean; starcraft?: string }

export interface Cost { minerals: number; gas: number }

/** Where the names come from: the mod named (`mod`), the game's own (`game`), or nowhere, for a mod's replay with no mod named (`ids`). */
export interface NamesFrom {
  kind: "mod" | "game" | "ids";
  /** The mod's name, for `mod`. */
  name: string | null;
  /** The mod's data-set hash, for `mod`. */
  hash: string | null;
}

/** Names and costs by id, as the replay's game had them. Costs are null where no table is at hand. */
export interface Namer {
  from: NamesFrom;
  unit(id: number): string;
  upgrade(id: number): string;
  tech(id: number): string;
  unitCost(id: number): Cost | null;
  /** The cost of an upgrade to `level` (1 for the first). */
  upgradeCost(id: number, level: number): Cost | null;
  techCost(id: number): Cost | null;
}

const field = (table: DatFile | undefined, name: string, id: number): number | null => (table && id >= 0 && id < table.count && table.columns[name] ? table.columns[name][id] : null);

function costOf(table: DatFile | undefined, id: number, minerals: string, gas: string): Cost | null {
  const m = field(table, minerals, id), g = field(table, gas, id);
  return m === null || g === null ? null : { minerals: m, gas: g };
}

/** Names and costs from tables read through `loadModData`: the mod's over the game's. */
function tableNamer(data: ModData, from: NamesFrom, fallback: (kind: "unit" | "upgrade" | "tech", id: number) => string): Namer {
  const { units, upgrades, techdata } = data.tables;
  return {
    from,
    unit: (id) => data.names.units[id] || fallback("unit", id),
    upgrade: (id) => data.names.upgrades[id] || fallback("upgrade", id),
    tech: (id) => data.names.technologies[id] || fallback("tech", id),
    unitCost: (id) => costOf(units, id, "mineral_cost", "vespene_cost"),
    upgradeCost: (id, level) => {
      const base = costOf(upgrades, id, "mineral_cost_base", "vespene_cost_base"), more = costOf(upgrades, id, "mineral_cost_factor", "vespene_cost_factor");
      return base && more ? { minerals: base.minerals + more.minerals * (level - 1), gas: base.gas + more.gas * (level - 1) } : null;
    },
    techCost: (id) => costOf(techdata, id, "mineral_cost", "vespene_cost"),
  };
}

/** An id with no name to give it: "unit 7". */
const bare = (kind: "unit" | "upgrade" | "tech", id: number) => (kind === "unit" ? t("unit {id}", { id }) : kind === "upgrade" ? t("upgrade {id}", { id }) : t("technology {id}", { id }));

/**
 * The names for a replay. With `mod`, the mod's (checked against the replay's tag first); a replay of a mod with none
 * named, bare ids; a replay of the game itself, the game's names, with costs from a copy of the game when one is here
 * (`costs`: reading the copy's tables is skipped when nothing needs them).
 */
export async function replayNamer(rep: Replay, file: string, o: { mod?: string; starcraft?: string; costs?: boolean; warn: (line: string) => void }): Promise<Namer> {
  if (o.mod) {
    const { source, base, hash } = await checkReplayMod(rep, file, o.mod, o.starcraft, o.warn);
    const data = await loadModData(reader(source), base ? (n) => base.read(n) : null, modTables(source), iscriptMembers(source));
    return tableNamer(data, { kind: "mod", name: source.name, hash }, bare);
  }
  if (rep.mod) {
    const none = () => null;
    return { from: { kind: "ids", name: null, hash: null }, unit: (id) => bare("unit", id), upgrade: (id) => bare("upgrade", id), tech: (id) => bare("tech", id), unitCost: none, upgradeCost: none, techCost: none };
  }
  const game = (kind: "unit" | "upgrade" | "tech", id: number) => {
    const name = kind === "unit" ? unitName(id) : kind === "upgrade" ? upgradeName(id) : techName(id);
    return name ? translate(name) : bare(kind, id);
  };
  const from: NamesFrom = { kind: "game", name: null, hash: null };
  const base = o.costs ? await gameFilesOrNull(o.starcraft).catch(() => null) : null;
  if (base) {
    const data = await loadModData(async () => null, (n) => base.read(n), {});
    // The game's names as the editor has them (in every language it speaks), the copy's costs.
    return { ...tableNamer(data, from, game), unit: (id) => game("unit", id), upgrade: (id) => game("upgrade", id), tech: (id) => game("tech", id) };
  }
  const none = () => null;
  return { from, unit: (id) => game("unit", id), upgrade: (id) => game("upgrade", id), tech: (id) => game("tech", id), unitCost: none, upgradeCost: none, techCost: none };
}

/* ── What each player ordered ──────────────────────────── */

export interface BuildItem {
  kind: "unit" | "building" | "upgrade" | "tech";
  id: number;
  name: string;
  /** The frame of the first order. */
  first: number;
  /** How many times it was ordered. A player who clicks Train five times orders five, made or not. */
  orders: number;
  /** What one costs, from the tables (an upgrade's first level); null where no table is at hand. */
  minerals: number | null;
  gas: number | null;
}

export interface PlayerBuilds {
  player: string;
  /** Each thing ordered once, in the order first ordered. */
  items: BuildItem[];
}

/** Each player's orders to train, morph, build, upgrade and research, by what was ordered, named by `names`. */
export function buildOrders(rep: Replay, names: Namer): PlayerBuilds[] {
  return rep.players.map((p) => {
    const items = new Map<string, BuildItem>();
    const add = (kind: BuildItem["kind"], id: number, frame: number, name: () => string, cost: () => Cost | null) => {
      const key = `${kind === "building" ? "unit" : kind} ${id}`;
      const had = items.get(key);
      if (had) { had.orders++; return; }
      const c = cost();
      items.set(key, { kind, id, name: name(), first: frame, orders: 1, minerals: c?.minerals ?? null, gas: c?.gas ?? null });
    };
    for (const c of rep.commands) {
      if (c.player !== p.id) continue;
      if ((c.kind === "train" || c.kind === "morph") && c.unit !== undefined) add("unit", c.unit, c.frame, () => names.unit(c.unit!), () => names.unitCost(c.unit!));
      else if ((c.kind === "build" || c.kind === "buildingMorph") && c.unit !== undefined) add("building", c.unit, c.frame, () => names.unit(c.unit!), () => names.unitCost(c.unit!));
      else if (c.kind === "upgrade" && c.value !== undefined) add("upgrade", c.value, c.frame, () => names.upgrade(c.value!), () => names.upgradeCost(c.value!, 1));
      else if (c.kind === "tech" && c.value !== undefined) add("tech", c.value, c.frame, () => names.tech(c.value!), () => names.techCost(c.value!));
    }
    return { player: p.name, items: [...items.values()] };
  });
}

/** The builds as lines: a player a table of what they ordered, when first, how often, and what one costs. */
export function printBuilds(builds: PlayerBuilds[], from: NamesFrom, tag: ModTag | null): string[] {
  const lines = ["", pc.dim(`  ${t("Builds")}  ${t("(what each player ordered, first when, how often, and what one costs)")}`)];
  if (from.kind === "ids" && tag) lines.push(`    ${mark.info} ${t("By id: name the folder of {mod} with --mod for its names and costs.", { mod: tag.dataSet.name || tag.dataSet.hash })}`);
  for (const b of builds) {
    lines.push(`    ${pc.bold(b.player)}`);
    if (!b.items.length) { lines.push(pc.dim(`      ${t("nothing")}`)); continue; }
    lines.push(...table(b.items.map((i) => [
      i.name, pc.dim(duration(i.first * FRAME_MS)), `×${num(i.orders)}`,
      i.minerals === null ? "" : pc.dim(i.gas ? t("{minerals} minerals, {gas} gas", { minerals: num(i.minerals), gas: num(i.gas) }) : t("{minerals} minerals", { minerals: num(i.minerals) })),
    ]), 6));
  }
  return lines;
}
