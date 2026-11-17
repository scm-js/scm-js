/**
 * The Scenario menu's settings from the command line: `scmjs map settings` lists a map's players, forces, switch
 * names and the unit, upgrade and technology settings it changes, and `scmjs map set --settings <file>` (the tool
 * `map_set`) sets them — Player Settings, Force Settings, Unit Settings, Upgrade Settings, Technology Settings and
 * the switch names, what is given set and the rest left.
 *
 * The writes go through the editor's plugin host (`run.ts#openHost`) as one `api.document.update`, the transaction
 * the dialogs' OK makes, so a force name is interned and a pair of sections chosen as the editor does it. Every name
 * is resolved before anything is changed: a unit, race or colour the map or the game does not have is an error that
 * names the entry (`units[1]`), and nothing is written.
 *
 * A number for a unit, upgrade or technology takes the type off "use default", and the editor then fills the rest
 * of its row from the game's tables. Without the tables the row would be zeros (a Marine that costs nothing and
 * has no armour), so those settings read the person's copy of StarCraft (`needsTables`); names, availability,
 * levels, players, forces and switches need none.
 */
import { z } from "zod";
import type { OpenedMap } from "../../src/editor/mapFile";
import { defaultTechRestrictions, defaultUpgradeRestrictions } from "../../src/formats/chk/sections/settings";
import { readSwitchNames } from "../../src/editor/switches";
import { PLAYER_COLORS } from "../../src/data/players";
import { unitName } from "../../src/data/units";
import { t } from "./i18n";
import { playerLabel, unitType } from "./objects";
import { giveHostGame, noHostGame, openHost, type HostGame, type PluginApi } from "./run";
import { CliError, dot, num, pc, table } from "./ui";
import { plainAsciiText, setHeader } from "./edit";
import { writeBack } from "./exchange";
import type { Input } from "./files";

type Settings = PluginApi["settings"];
type PlayerView = ReturnType<Settings["players"]>[number];
type ForceView = ReturnType<Settings["forces"]>[number];
type UnitView = NonNullable<ReturnType<Settings["unitType"]>>;
type UpgradeView = NonNullable<ReturnType<Settings["upgrade"]>>;
type TechView = NonNullable<ReturnType<Settings["tech"]>>;
type Named = { value: number; label: string };
/** The transaction a settings dialog's OK makes (`api.document.update`), and a player's patch in it. */
type Update = Parameters<Parameters<PluginApi["document"]["update"]>[1]>[0];
type PlayerPatch = Parameters<Update["players"]["set"]>[1];

/* ── The shape of what is set ───────────────────────────────── */

const upTo = (most: number) => z.number().int().min(0).max(most);
const player = z.number().int().min(1).max(12);
const who = z.union([player, z.literal("default")]);
const ref = z.union([z.string().min(1), upTo(0xffff)]);
const rgb = z.tuple([upTo(255), upTo(255), upTo(255)]);
const cost = upTo(0xffff).optional();

export const SETTINGS = {
  players: z.array(z.strictObject({
    player: player.describe("1 to 12; colour and force are for 1 to 8"),
    type: ref.optional().describe("Human, Computer, Rescuable, Neutral, Inactive, …"),
    race: ref.optional().describe("Zerg, Terran, Protoss, User Selectable, Random, …"),
    color: z.union([z.string().min(1), upTo(255), rgb]).optional().describe("a colour's name (Red, Blue, Teal, Purple, Orange, Brown, White, Yellow, Green, …), its number, or [r, g, b] for a Remastered custom colour"),
    force: z.number().int().min(1).max(4).optional(),
  })).min(1).optional().describe("Player Settings: only what is given changes"),
  forces: z.array(z.strictObject({
    force: z.number().int().min(1).max(4),
    name: z.string().optional(),
    allied: z.boolean().optional(), alliedVictory: z.boolean().optional(), sharedVision: z.boolean().optional(), randomStart: z.boolean().optional().describe("random start locations"),
    players: z.array(z.number().int().min(1).max(8)).optional().describe("players to move into the force"),
  })).min(1).optional().describe("Force Settings"),
  units: z.array(z.strictObject({
    unit: ref.describe("a unit type: its name, or its units.dat id"),
    name: z.string().optional().describe("a name of the map's own for the type; \"\" restores the game's"),
    useDefault: z.boolean().optional().describe("true puts the type back on the game's numbers"),
    hitPoints: upTo(0xffffff).optional(), shields: cost, armor: upTo(255).optional(), buildTime: cost.describe("frames, 24 a second"), mineralCost: cost, gasCost: cost,
    weapons: z.array(z.strictObject({ weapon: ref.describe("a weapon the unit has: its name, or its weapons.dat id"), damage: cost, bonus: cost.describe("damage added by each upgrade") })).min(1).optional(),
    available: z.array(z.strictObject({ player: who, value: z.union([z.boolean(), z.literal("default")]) })).min(1).optional().describe("who may build it: for a player 1 to 12 true, false or \"default\" (as the default says), and for \"default\" true or false"),
  })).min(1).optional().describe("Unit Settings: a number takes the type off the game's numbers, and the others keep the game's values"),
  upgrades: z.array(z.strictObject({
    upgrade: ref.describe("an upgrade: its name, or its upgrades.dat id"),
    useDefault: z.boolean().optional(),
    mineralCost: cost, mineralFactor: cost.describe("added for each level"), gasCost: cost, gasFactor: cost, timeCost: cost.describe("frames"), timeFactor: cost,
    levels: z.array(z.strictObject({ player: who, start: upTo(255).optional(), max: upTo(255).optional(), useDefault: z.boolean().optional() })).min(1).optional().describe("the level each player starts at and may reach: for a player 1 to 12, or \"default\""),
  })).min(1).optional().describe("Upgrade Settings"),
  techs: z.array(z.strictObject({
    tech: ref.describe("a technology: its name, or its techdata.dat id"),
    useDefault: z.boolean().optional(),
    mineralCost: cost, gasCost: cost, researchTime: cost.describe("frames"), energyCost: cost,
    state: z.array(z.strictObject({ player: who, available: z.boolean().optional(), researched: z.boolean().optional(), useDefault: z.boolean().optional() })).min(1).optional().describe("whether each player may research it and has it already: for a player 1 to 12, or \"default\""),
  })).min(1).optional().describe("Technology Settings"),
  switches: z.array(z.strictObject({ switch: z.number().int().min(1).max(256), name: z.string().describe("\"\" clears the name") })).min(1).optional().describe("the switches' names"),
} as const;

const SETTINGS_OBJECT = z.strictObject(SETTINGS);
export type MapSettings = z.infer<typeof SETTINGS_OBJECT>;
export const SETTING_GROUPS = Object.keys(SETTINGS) as (keyof MapSettings)[];

/** Whether anything is given to set. */
export const anySettings = (s: MapSettings) => SETTING_GROUPS.some((k) => s[k] !== undefined);

/**
 * The settings a JSON value holds (`map set --settings <file>`): an object with any of the groups. The first thing
 * that does not fit is refused with its place (`units[1].armor`) and what is wrong with it.
 */
export function parseSettings(value: unknown): MapSettings {
  const hint = t("An object with any of {groups}, such as { \"players\": [{ \"player\": 2, \"type\": \"Computer\", \"race\": \"Zerg\" }] }; scmjs map set --help lists the fields.", { groups: SETTING_GROUPS.join(", ") });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CliError(t("The settings are a JSON object"), hint, 2);
  const r = SETTINGS_OBJECT.safeParse(value);
  if (!r.success) {
    const said = r.error.issues.map((issue) => {
      const path = issue.path.map((p, k) => (typeof p === "number" ? `[${p}]` : `${k ? "." : ""}${String(p)}`)).join("");
      const message = issue.message.replace(/^Invalid input: /, "");
      return path ? `\`${path}\`: ${message}` : message;
    });
    throw new CliError(said.join("; "), t("Nothing was changed."), 2);
  }
  if (!anySettings(r.data)) throw new CliError(t("The settings name nothing to set"), hint, 2);
  return r.data;
}

/** Whether the settings read the game's tables: a number for a unit, upgrade or technology, or one taken off its defaults. */
export function needsTables(s: MapSettings): boolean {
  const numbers = (o: Record<string, unknown>, keys: readonly string[]) => keys.some((k) => o[k] !== undefined) || o.useDefault === false;
  return (s.units ?? []).some((u) => numbers(u, ["hitPoints", "shields", "armor", "buildTime", "mineralCost", "gasCost", "weapons"]))
    || (s.upgrades ?? []).some((u) => numbers(u, ["mineralCost", "mineralFactor", "gasCost", "gasFactor", "timeCost", "timeFactor"]))
    || (s.techs ?? []).some((u) => numbers(u, ["mineralCost", "gasCost", "researchTime", "energyCost"]));
}

/* ── Names ──────────────────────────────────────────────────── */

const fold = (text: string) => text.trim().toLowerCase().replace(/[\s_-]+/g, " ");

/**
 * The value a name or a number means in a table of names: the name whole (any case), else the one name that holds
 * the words given. A number is taken as the value it is. An error lists what the table has.
 */
function byName(list: readonly Named[], given: string | number, what: string): number {
  if (typeof given === "number") return given;
  const asked = fold(given);
  if (/^\d+$/.test(asked)) return Number(asked);
  const exact = list.find((x) => fold(x.label) === asked);
  if (exact) return exact.value;
  const near = list.filter((x) => fold(x.label).includes(asked));
  if (near.length === 1) return near[0].value;
  if (near.length > 1) throw new CliError(t("\"{name}\" could be any of {list}", { name: given, list: near.slice(0, 8).map((x) => `"${x.label}"`).join(", ") + (near.length > 8 ? ", …" : "") }));
  throw new CliError(t("No {what} is called \"{name}\"", { what, name: given }), list.length <= 16 ? t("One of {list}.", { list: list.map((x) => x.label).join(", ") }) : null);
}

/** A colour's name, as the Player Colors dialog lists it. */
const colourName = (index: number) => PLAYER_COLORS[index]?.name ?? t("colour {n}", { n: index });
const colourOf = (given: string | number): number => byName(PLAYER_COLORS.map((c) => ({ value: c.id, label: c.name })), given, t("colour"));

/* ── What a setting is, as text ─────────────────────────────── */

/** A setting that changed: whose it is ("Player 2", "Terran Marine"), which, and its value before and after. */
export interface SettingChange { kind: "player" | "force" | "unit" | "upgrade" | "tech" | "switch"; id: number; subject: string; field: string; from: string; to: string }

type Fields = [field: string, value: string][];
const yesNo = (on: boolean) => (on ? t("yes") : t("no"));
const players = (slots: readonly number[]) => (slots.length ? slots.map((s) => s + 1).join(", ") : t("none"));

function playerFields(p: PlayerView): Fields {
  return [
    [t("type"), p.typeName], [t("race"), p.raceName],
    [t("colour"), p.color === null ? "" : p.rgb ? `rgb(${p.rgb.join(", ")})` : colourName(p.color)],
    [t("force"), p.force === null ? "" : String(p.force + 1)],
  ];
}
function forceFields(f: ForceView): Fields {
  return [[t("name"), f.name], [t("players"), players(f.players)], [t("allied"), yesNo(f.allied)], [t("allied victory"), yesNo(f.alliedVictory)], [t("shared vision"), yesNo(f.sharedVision)], [t("random start"), yesNo(f.randomStart)]];
}
function unitFields(u: UnitView): Fields {
  const a = u.availability;
  return [
    [t("name"), u.customName], [t("uses the game's numbers"), yesNo(u.useDefault)],
    [t("hit points"), String(u.hitPoints)], [t("shields"), String(u.shields)], [t("armor"), String(u.armor)], [t("build time"), String(u.buildTime)], [t("minerals"), String(u.mineralCost)], [t("gas"), String(u.gasCost)],
    ...u.weapons.flatMap((w): Fields => [[t("{weapon} damage", { weapon: w.name }), String(w.damage)], [t("{weapon} bonus", { weapon: w.name }), String(w.bonus)]]),
    [t("available by default"), yesNo(a.defaultAvailable)],
    ...a.players.map((v, p): Fields[number] => [t("available to {player}", { player: playerLabel(p + 1) }), v === "default" ? t("default") : yesNo(v)]),
  ];
}
function upgradeFields(u: UpgradeView): Fields {
  return [
    [t("uses the game's numbers"), yesNo(u.useDefault)],
    [t("minerals"), String(u.mineralCost)], [t("minerals a level"), String(u.mineralFactor)], [t("gas"), String(u.gasCost)], [t("gas a level"), String(u.gasFactor)], [t("time"), String(u.timeCost)], [t("time a level"), String(u.timeFactor)],
    [t("start level by default"), String(u.levels.defaultStart)], [t("top level by default"), String(u.levels.defaultMax)],
    ...u.levels.players.map((l, p): Fields[number] => [t("levels of {player}", { player: playerLabel(p + 1) }), l.usesDefault ? t("default") : `${l.start}–${l.max}`]),
  ];
}
function techFields(x: TechView): Fields {
  const state = (available: boolean, researched: boolean) => (researched ? t("researched") : available ? t("available") : t("not available"));
  return [
    [t("uses the game's numbers"), yesNo(x.useDefault)],
    [t("minerals"), String(x.mineralCost)], [t("gas"), String(x.gasCost)], [t("time"), String(x.researchTime)], [t("energy"), String(x.energyCost)],
    [t("by default"), state(x.state.defaultAvailable, x.state.defaultResearched)],
    ...x.state.players.map((s, p): Fields[number] => [t("for {player}", { player: playerLabel(p + 1) }), s.usesDefault ? t("default") : state(s.available, s.researched)]),
  ];
}

/** The fields that differ between two readings of the same thing, in the reading's order. */
function differences(kind: SettingChange["kind"], id: number, subject: string, before: Fields, after: Fields): SettingChange[] {
  const was = new Map(before);
  return after.filter(([field, value]) => was.get(field) !== value).map(([field, to]) => ({ kind, id, subject, field, from: was.get(field) ?? "", to }));
}

/* ── Setting ────────────────────────────────────────────────── */

export interface SettingsOutcome {
  /** The map with the settings set, in the shape it came in. */
  doc: OpenedMap;
  changes: SettingChange[];
  /** The copy of the game the numbers were filled in from; null when the settings needed none. */
  game: HostGame | null;
}

/**
 * Set what is given on the map in memory, and say what changed. Throws a CliError naming the entry when a name is
 * not one, a weapon is not the unit's, or the settings read the game's tables and there is no copy; the document is
 * then to be thrown away (nothing is written by this).
 */
export async function applySettings(doc: OpenedMap, s: MapSettings, options: { starcraft?: string } = {}): Promise<SettingsOutcome> {
  let game: HostGame | null = null;
  if (needsTables(s)) {
    game = await giveHostGame(doc, options.starcraft);
    const why = t("A number for a unit, upgrade or technology takes it off the game's defaults, and the rest of its row is filled in from your installation's tables");
    if (!game) throw new CliError(t("No copy of StarCraft was found on this computer."), t("{why}: name its folder with --starcraft (or SCMJS_STARCRAFT).", { why }), 2);
    if (!game.units) {
      throw new CliError(
        game.from === "editor" ? t("{copy} has no unit tables to read.", { copy: game.label }) : t("{copy} in {folder} has no unit tables to read.", { copy: game.label, folder: game.folder }),
        game.from === "editor" ? t("{why}: name your installation's folder with --starcraft (or SCMJS_STARCRAFT).", { why }) : t("{why}. A 1.16 folder needs patch_rt.mpq beside StarDat.mpq and BrooDat.mpq.", { why }),
      );
    }
  } else noHostGame();
  const host = openHost(doc, "map set");
  try {
    const { api } = host;
    /** `fn`, with an error of its own worded as the entry's: `units[1]: No unit is called …`. */
    const at = <T>(place: string, fn: () => T): T => {
      try { return fn(); } catch (e) {
        if (e instanceof CliError) throw new CliError(`${place}: ${e.message}`, [e.hint, t("Nothing was changed.")].filter(Boolean).join(" "), e.exitCode);
        throw e;
      }
    };
    const slot = (p: number | "default") => (p === "default" ? "default" : p - 1);
    const changes: SettingChange[] = [];
    const update = (build: (u: Update) => void) => { api.document.update("map set", build); };
    // Every name first, so that an entry that cannot be done stops the list before anything is set.
    const plan: (() => void)[] = [];

    (s.players ?? []).forEach((p, i) => at(`players[${i}]`, () => {
      const index = p.player - 1;
      if (index >= 8 && (p.color !== undefined || p.force !== undefined)) throw new CliError(t("{player} has no colour or force: those are for players 1 to 8", { player: playerLabel(p.player) }));
      const patch: PlayerPatch = {};
      if (p.type !== undefined) patch.type = byName(api.names.playerTypes(), p.type, t("player type"));
      if (p.race !== undefined) patch.race = byName(api.names.races(), p.race, t("race"));
      if (Array.isArray(p.color)) patch.rgb = [p.color[0], p.color[1], p.color[2]];
      else if (p.color !== undefined) { patch.color = colourOf(p.color); patch.rgb = null; }
      if (p.force !== undefined) patch.force = p.force - 1;
      if (!Object.keys(patch).length) throw new CliError(t("nothing to set: give `type`, `race`, `color` or `force`"));
      plan.push(() => update((u) => {
        const before = playerFields(api.settings.player(index)!);
        u.players.set(index, patch);
        changes.push(...differences("player", p.player, playerLabel(p.player), before, playerFields(api.settings.player(index)!)));
      }));
    }));

    (s.forces ?? []).forEach((f, i) => at(`forces[${i}]`, () => {
      const index = f.force - 1;
      const { force: _force, players: members, ...flags } = f;
      if (!Object.keys(flags).length && !members) throw new CliError(t("nothing to set: give `name`, `players`, `allied`, `alliedVictory`, `sharedVision` or `randomStart`"));
      plan.push(() => update((u) => {
        const before = forceFields(api.settings.forces()[index]);
        u.forces.set(index, { ...flags, ...(members ? { players: members.map((m) => m - 1) } : {}) });
        changes.push(...differences("force", f.force, t("Force {n}", { n: f.force }), before, forceFields(api.settings.forces()[index])));
      }));
    }));

    (s.units ?? []).forEach((given, i) => at(`units[${i}]`, () => {
      const id = unitType(given.unit);
      const { unit: _unit, weapons, available, ...numbers } = given;
      if (!Object.keys(numbers).length && !weapons && !available) throw new CliError(t("nothing to set: give `name`, a number, `weapons`, `available` or `useDefault`"));
      const has = api.settings.unitType(id)?.weapons ?? [];
      const armed = weapons?.map((w) => {
        const weapon = byName(api.names.weapons(), w.weapon, t("weapon"));
        if (!has.some((x) => x.id === weapon)) throw new CliError(t("{unit} does not fight with {weapon}", { unit: unitName(id), weapon: api.names.weapon(weapon) }), has.length ? t("Its weapons: {list}.", { list: has.map((x) => x.name).join(", ") }) : t("It has no weapon."));
        return { id: weapon, damage: w.damage, bonus: w.bonus };
      });
      plan.push(() => update((u) => {
        const before = unitFields(api.settings.unitType(id)!);
        u.unitTypes.set(id, { ...numbers, ...(armed ? { weapons: armed } : {}), ...(available ? { available: available.map((a) => ({ player: slot(a.player), value: a.value })) } : {}) });
        changes.push(...differences("unit", id, unitName(id), before, unitFields(api.settings.unitType(id)!)));
      }));
    }));

    (s.upgrades ?? []).forEach((given, i) => at(`upgrades[${i}]`, () => {
      const id = byName(api.names.upgrades(), given.upgrade, t("upgrade"));
      if (!api.settings.upgrade(id)) throw new CliError(t("There is no upgrade {id}", { id }));
      const { upgrade: _upgrade, levels, ...numbers } = given;
      if (!Object.keys(numbers).length && !levels) throw new CliError(t("nothing to set: give a cost, `levels` or `useDefault`"));
      plan.push(() => update((u) => {
        const before = upgradeFields(api.settings.upgrade(id)!);
        u.upgrades.set(id, { ...numbers, ...(levels ? { levels: levels.map((l) => ({ ...l, player: slot(l.player) })) } : {}) });
        changes.push(...differences("upgrade", id, api.names.upgrade(id), before, upgradeFields(api.settings.upgrade(id)!)));
      }));
    }));

    (s.techs ?? []).forEach((given, i) => at(`techs[${i}]`, () => {
      const id = byName(api.names.techs(), given.tech, t("technology"));
      if (!api.settings.tech(id)) throw new CliError(t("There is no technology {id}", { id }));
      const { tech: _tech, state, ...numbers } = given;
      if (!Object.keys(numbers).length && !state) throw new CliError(t("nothing to set: give a cost, `state` or `useDefault`"));
      plan.push(() => update((u) => {
        const before = techFields(api.settings.tech(id)!);
        u.techs.set(id, { ...numbers, ...(state ? { state: state.map((x) => ({ ...x, player: slot(x.player) })) } : {}) });
        changes.push(...differences("tech", id, api.names.tech(id), before, techFields(api.settings.tech(id)!)));
      }));
    }));

    for (const w of s.switches ?? []) {
      plan.push(() => update((u) => {
        const from = u.switches.names()[w.switch - 1] ?? "";
        if (from === w.name) return;
        u.switches.setName(w.switch - 1, w.name);
        changes.push({ kind: "switch", id: w.switch, subject: t("Switch {n}", { n: w.switch }), field: t("name"), from, to: w.name });
      }));
    }

    for (const step of plan) step();
    return { doc: host.document(), changes, game };
  } finally {
    host.dispose();
  }
}

/** The changes as lines for a person: whose, which, and the value before and after. */
export function printSettingChanges(changes: readonly SettingChange[]): string[] {
  const none = pc.dim(t("(none)"));
  return table(changes.map((c) => [c.subject, pc.dim(c.field), `${pc.red(c.from || none)} ${pc.dim("→")} ${pc.green(c.to || none)}`]), 2);
}

/* ── Listing ────────────────────────────────────────────────── */

export interface SettingsListing {
  file: string;
  /** True when one unit type, upgrade or technology was asked for: the text is then that row alone. */
  one: boolean;
  /** The copy of the game a single type's defaults were read from; null when none was read. */
  game: string | null;
  players: { player: number; type: string; race: string; color: string | null; rgb: [number, number, number] | null; force: number | null; forceName: string | null }[];
  forces: { force: number; name: string; players: number[]; allied: boolean; alliedVictory: boolean; sharedVision: boolean; randomStart: boolean }[];
  /** The types the map changes (or the one asked for), with what it sets. */
  units: UnitView[];
  upgrades: UpgradeView[];
  techs: TechView[];
  switches: { switch: number; name: string }[];
}

const unitChanged = (u: UnitView) => !u.useDefault || u.customName !== "" || !u.availability.defaultAvailable || u.availability.players.some((p) => p !== "default");

/**
 * A map's settings: its twelve players and four forces, the switches it names, and the unit types, upgrades and
 * technologies it changes from the game's. With `unit`, `upgrade` or `tech`, that one alone in its group, changed
 * or not, with the game's own numbers beside it when a copy of the game is there to read them from.
 */
export async function listSettings(doc: OpenedMap, file: string, o: { unit?: string | number; upgrade?: string | number; tech?: string | number; starcraft?: string; game?: boolean } = {}): Promise<SettingsListing> {
  const one = o.unit !== undefined || o.upgrade !== undefined || o.tech !== undefined;
  // The game's numbers are only shown for a type asked for by name; the lists are the map's own and need no copy.
  const game = one && o.game !== false ? await giveHostGame(doc, o.starcraft) : null;
  if (!game) noHostGame();
  const host = openHost(doc, "map settings");
  try {
    const { api } = host;
    const upgradeDefaults = defaultUpgradeRestrictions(), techDefaults = defaultTechRestrictions();
    const upgradeChanged = (u: UpgradeView) => !u.useDefault || u.levels.defaultStart !== upgradeDefaults.defaultStart[u.id] || u.levels.defaultMax !== upgradeDefaults.defaultMax[u.id] || u.levels.players.some((l) => !l.usesDefault);
    const techChanged = (x: TechView) => !x.useDefault || x.state.defaultAvailable !== (techDefaults.defaultAvailable[x.id] !== 0) || x.state.defaultResearched !== (techDefaults.defaultResearched[x.id] !== 0) || x.state.players.some((p) => !p.usesDefault);
    const unitId = o.unit === undefined ? null : unitType(o.unit);
    const upgradeId = o.upgrade === undefined ? null : byName(api.names.upgrades(), o.upgrade, t("upgrade"));
    const techId = o.tech === undefined ? null : byName(api.names.techs(), o.tech, t("technology"));
    const switchNames = readSwitchNames(doc.scenario);
    return {
      file, one, game: game?.label ?? null,
      players: api.settings.players().map((p) => ({ player: p.slot + 1, type: p.typeName, race: p.raceName, color: p.color === null ? null : colourName(p.color), rgb: p.rgb, force: p.force === null ? null : p.force + 1, forceName: p.forceName })),
      forces: api.settings.forces().map((f) => ({ force: f.force + 1, name: f.name, players: f.players.map((p) => p + 1), allied: f.allied, alliedVictory: f.alliedVictory, sharedVision: f.sharedVision, randomStart: f.randomStart })),
      units: unitId !== null ? [api.settings.unitType(unitId)].filter((u): u is UnitView => !!u) : one ? [] : api.settings.unitTypes().filter(unitChanged),
      upgrades: upgradeId !== null ? [api.settings.upgrade(upgradeId)].filter((u): u is UpgradeView => !!u) : one ? [] : api.settings.upgrades().filter(upgradeChanged),
      techs: techId !== null ? [api.settings.tech(techId)].filter((x): x is TechView => !!x) : one ? [] : api.settings.techs().filter(techChanged),
      switches: switchNames.map((name, i) => ({ switch: i + 1, name })).filter((w) => w.name !== ""),
    };
  } finally {
    host.dispose();
  }
}

type UnitNumbers = Pick<UnitView, "hitPoints" | "shields" | "armor" | "buildTime" | "mineralCost" | "gasCost" | "weapons">;
type UpgradeNumbers = Pick<UpgradeView, "mineralCost" | "mineralFactor" | "gasCost" | "gasFactor" | "timeCost" | "timeFactor">;
type TechNumbers = Pick<TechView, "mineralCost" | "gasCost" | "researchTime" | "energyCost">;

const unitNumbers = (u: UnitNumbers) => [
  t("{n} hit points", { n: num(u.hitPoints) }), u.shields ? t("{n} shields", { n: num(u.shields) }) : null, t("armor {n}", { n: u.armor }), t("build time {n}", { n: num(u.buildTime) }),
  t("{n} minerals", { n: num(u.mineralCost) }), t("{n} gas", { n: num(u.gasCost) }),
  ...u.weapons.map((w) => t("{weapon} {damage} +{bonus}", { weapon: w.name, damage: w.damage, bonus: w.bonus })),
].filter(Boolean).join(", ");
const upgradeNumbers = (u: UpgradeNumbers) => t("{minerals} +{mineralFactor} minerals, {gas} +{gasFactor} gas, time {time} +{timeFactor}", { minerals: u.mineralCost, mineralFactor: u.mineralFactor, gas: u.gasCost, gasFactor: u.gasFactor, time: u.timeCost, timeFactor: u.timeFactor });
const techNumbers = (x: TechNumbers) => t("{minerals} minerals, {gas} gas, time {time}, energy {energy}", { minerals: x.mineralCost, gas: x.gasCost, time: x.researchTime, energy: x.energyCost });

/**
 * The numbers of a row: the map's own when it has them, with the game's beside them when a copy was read; for a row
 * on the game's numbers, those when they were read and the words alone when not.
 */
function numbersOf<N>(row: { useDefault: boolean; defaults: N | null }, own: string, say: (n: N) => string): string {
  if (row.useDefault) return pc.dim(row.defaults ? t("the game's numbers: {numbers}", { numbers: say(row.defaults) }) : t("the game's numbers"));
  return row.defaults ? `${own} ${pc.dim(t("(the game's: {numbers})", { numbers: say(row.defaults) }))}` : own;
}

/** What a unit type's row says, in a few words: its name, its numbers, who may build it. */
function unitLine(u: UnitView): string {
  const a = u.availability;
  const parts = [
    u.customName ? t("named \"{name}\"", { name: u.customName }) : null,
    numbersOf(u, unitNumbers(u), unitNumbers),
    a.defaultAvailable ? null : t("not available by default"),
    ...a.players.map((v, p) => (v === "default" ? null : v ? t("available to {player}", { player: playerLabel(p + 1) }) : t("not available to {player}", { player: playerLabel(p + 1) }))),
  ];
  return parts.filter(Boolean).join(dot);
}
function upgradeLine(u: UpgradeView): string {
  const parts = [
    numbersOf(u, upgradeNumbers(u), upgradeNumbers),
    t("levels {start}–{max} by default", { start: u.levels.defaultStart, max: u.levels.defaultMax }),
    ...u.levels.players.map((l, p) => (l.usesDefault ? null : `${playerLabel(p + 1)} ${l.start}–${l.max}`)),
  ];
  return parts.filter(Boolean).join(dot);
}
function techLine(x: TechView): string {
  const state = (available: boolean, researched: boolean) => (researched ? t("researched") : available ? t("available") : t("not available"));
  const parts = [
    numbersOf(x, techNumbers(x), techNumbers),
    t("{state} by default", { state: state(x.state.defaultAvailable, x.state.defaultResearched) }),
    ...x.state.players.map((s, p) => (s.usesDefault ? null : `${playerLabel(p + 1)} ${state(s.available, s.researched)}`)),
  ];
  return parts.filter(Boolean).join(dot);
}

/** The listing as lines: players and forces as tables, then a line a changed type, upgrade, technology and switch. */
export function printSettings(name: string, r: SettingsListing): string[] {
  const lines = [pc.bold(name)];
  const rows = <T extends { id: number }>(list: readonly T[], label: (row: T) => string, line: (row: T) => string) => table(list.map((row) => [label(row), pc.dim(String(row.id)), line(row)]), 2);
  // One row asked for by name: that row, and nothing of the rest.
  if (r.one) return [...lines, ...rows(r.units, (u) => unitName(u.id), unitLine), ...rows(r.upgrades, (u) => u.name, upgradeLine), ...rows(r.techs, (x) => x.name, techLine)];
  lines.push(t("Players"), ...table([
    [t("player"), t("type"), t("race"), t("colour"), t("force")].map((h) => pc.dim(h)),
    ...r.players.map((p) => [String(p.player), p.type, p.race, p.rgb ? `rgb(${p.rgb.join(", ")})` : p.color ?? "", p.force === null ? "" : `${p.force} ${p.forceName ?? ""}`.trim()]),
  ], 2));
  lines.push(t("Forces"), ...table([
    [t("force"), t("name"), t("players"), t("allied"), t("allied victory"), t("shared vision"), t("random start")].map((h) => pc.dim(h)),
    ...r.forces.map((f) => [String(f.force), f.name, f.players.join(", ") || pc.dim(t("none")), yesNo(f.allied), yesNo(f.alliedVictory), yesNo(f.sharedVision), yesNo(f.randomStart)]),
  ], 2));
  const group = <T extends { id: number }>(title: string, list: readonly T[], label: (row: T) => string, line: (row: T) => string) => {
    if (!list.length) { lines.push(`${title}: ${pc.dim(t("as the game has them"))}`); return; }
    lines.push(title, ...rows(list, label, line));
  };
  group(t("Unit settings"), r.units, (u) => unitName(u.id), unitLine);
  group(t("Upgrades"), r.upgrades, (u) => u.name, upgradeLine);
  group(t("Technologies"), r.techs, (x) => x.name, techLine);
  lines.push(r.switches.length ? `${t("Switches")}: ${r.switches.map((w) => `${w.switch} "${w.name}"`).join(", ")}` : `${t("Switches")}: ${pc.dim(t("none named"))}`);
  return lines;
}

/**
 * `map set` and `map_set`: the map's header fields and the settings given set on the opened map, which is written
 * (over itself, or to `out`) when something changed or `always` (a pipe wants the map either way), and never with
 * `dryRun`. `asciiOnly`: an encoding was asked of a map whose text is plain ASCII, so it has nothing to change.
 */
export async function setMap(opened: { input: Input; doc: OpenedMap }, o: { name?: string; description?: string; revision?: string; encoding?: string; settings: MapSettings | null; starcraft?: string; out: string | null; dryRun?: boolean; always?: boolean }) {
  const { input } = opened;
  let { doc } = opened;
  // Plain ASCII is the same in every encoding, and a map does not record the one it was written in: said, not set.
  const asciiOnly = o.encoding !== undefined && plainAsciiText(doc.scenario);
  const changes = setHeader(doc, { name: o.name, description: o.description, version: o.revision, encoding: o.encoding });
  const set = o.settings ? await applySettings(doc, o.settings, { starcraft: o.starcraft }) : null;
  if (set) doc = set.doc;
  const changed = changes.length + (set?.changes.length ?? 0);
  const written = !o.dryRun && (changed || o.out || o.always) ? await writeBack(doc, input.path, o.out) : null;
  return { changes, set, changed, written, asciiOnly };
}
