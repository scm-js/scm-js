/**
 * Names out of the game data, and the rule that decides when they show.
 *
 * `stat_txt.tbl` is where the game itself names things: entries 0–227 are the unit types
 * (`Name\0Subname\0Category`, `*` for no subname), and `weapons.dat`, `upgrades.dat` and
 * `techdata.dat` each carry a `label` column pointing into the same table. The editor's
 * own tables in `units.ts` / `weapons.ts` are StarEdit's names, which read better than the
 * game's in about fifty places ("Cargo Ship (Unused)" where the game says "Unused",
 * "Edmund Duke Turret (Tank Mode)" for "Duke Turret") and are the vocabulary the text
 * trigger format and the other editors share. Both are wanted, so the rule is per entry:
 *
 *   the data's name shows where it differs from what the game's own data says for that id;
 *   everywhere else StarEdit's name stands.
 *
 * With Blizzard's files that leaves every name as it was. With a mod's, every unit, weapon,
 * upgrade or technology the mod renamed shows its new name and the rest keep StarEdit's.
 * The `GAME_*` tables below are what the game's own files say *where that differs from
 * StarEdit's table* — generated from the real files and pinned against them in
 * `tests/names.test.ts`, so they cannot drift.
 */
import type { UnitAssets } from "../formats/units/load";
import { datCount, UnitFlag } from "../formats/dat/dat";
import { TECH_NAMES, UNIT_GROUPS, UNIT_NAMES, UPGRADE_NAMES, type LoadedNames, type RaceKey, type UnitCatalogue } from "./units";
import { WEAPON_NAMES } from "./weapons";
import { nameList, statWithText } from "../formats/mod/data";

/**
 * A `stat_txt.tbl` label as plain text. Button labels carry their hotkey in front of the
 * text and colour codes around the letter it names (`i<03><03>I<01>rradiate`): the first
 * character goes when a control byte follows it, and every control byte goes. A button's
 * tooltip runs on into its description after a line break; the name is the first line.
 */
export function cleanLabel(label: string): string {
  let text = label;
  if (text.length > 1 && text.charCodeAt(1) < 0x20 && text[1] !== "\n") text = text.slice(1);
  const lineBreak = text.search(/[\r\n]/);
  if (lineBreak > 0) text = text.slice(0, lineBreak);
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x1f]/g, "").trim();
}

/** A unit's name as the game composes it from its `stat_txt.tbl` entry: `Name (Subname)`, or `Name` alone. */
export function composeUnitName(entry: readonly string[]): string {
  const name = cleanLabel(entry[0] ?? "");
  const sub = entry[1] ? cleanLabel(entry[1]) : "";
  return sub && sub !== "*" ? `${name} (${sub})` : name;
}

/** The unit names Blizzard's own `stat_txt.tbl` gives, where they differ from StarEdit's. */
export const GAME_UNIT_NAMES: readonly [id: number, name: string][] = [
  [6, "Tank Turret"],
  [13, "Vulture Spider Mine"],
  [18, "Alan Turret"],
  [23, "Edmund Duke (Siege Tank)"],
  [24, "Duke Turret"],
  [26, "Duke Turret"],
  [31, "Tank Turret"],
  [59, "Cocoon"],
  [74, "Dark Templar (Hero)"],
  [89, "Rhynadon (Badlands)"],
  [90, "Bengalaas (Jungle)"],
  [91, "Unused"],
  [92, "Unused"],
  [93, "Scantid (Desert)"],
  [94, "Kakaru (Twilight)"],
  [95, "Ragnasaur (Ash World)"],
  [96, "Ursadon (Ice World)"],
  [97, "Zerg Lurker Egg"],
  [98, "Raszagal (Dark Templar)"],
  [102, "Gerard DuGalle (Ghost)"],
  [105, "Disruption Field"],
  [119, "Unused Terran Bldg"],
  [121, "Unused Terran Bldg"],
  [126, "Norad II (Crashed Battlecruiser)"],
  [130, "Infested Command Center"],
  [145, "Unused Zerg Bldg"],
  [150, "Mature Crysalis"],
  [153, "Unused Zerg Bldg 5"],
  [158, "Protoss Unused"],
  [161, "Protoss Unused"],
  [179, "Cave"],
  [180, "Cave-in"],
  [181, "Cantina"],
  [182, "Mining Platform"],
  [183, "Independent Command Center"],
  [184, "Independent Starport"],
  [185, "Jump Gate"],
  [186, "Ruins"],
  [187, "Kyadarin Crystal Formation"],
  [204, "Floor Hatch (UNUSED)"],
  [218, "Data Disc"],
  [220, "Mineral Chunk (Type 1)"],
  [221, "Mineral Chunk (Type 2)"],
  [222, "Vespene Orb (Protoss Type 1)"],
  [223, "Vespene Orb (Protoss Type 2)"],
  [224, "Vespene Sac (Zerg Type 1)"],
  [225, "Vespene Sac (Zerg Type 2)"],
  [226, "Vespene Tank (Terran Type 1)"],
  [227, "Vespene Tank (Terran Type 2)"],
];

/** The weapon names Blizzard's `weapons.dat` labels give, where they differ from the editor's table. */
export const GAME_WEAPON_NAMES: readonly [id: number, name: string][] = [
  [1, "Gauss Rifle"],
  [3, "C-10 Canister Rifle"],
  [5, "Fragmentation Grenade"],
  [9, "Twin Autocannons"],
  [10, "Hellfire Missile Pack"],
  [12, "Arclite Cannon"],
  [14, "Fusion Cutter"],
  [17, "Gemini Missiles"],
  [18, "Burst Lasers"],
  [21, "ATS Laser Battery"],
  [22, "ATA Laser Battery"],
  [23, "ATS Laser Battery"],
  [24, "ATA Laser Battery"],
  [26, "Flame Thrower"],
  [28, "Arclite Shock Cannon"],
  [36, "Claws"],
  [37, "Claws"],
  [39, "Needle Spines"],
  [41, "Kaiser Blades"],
  [42, "Toxic Spores"],
  [44, "Spines"],
  [45, "Acid Spray"],
  [47, "Acid Spore"],
  [49, "Glave Wurm"],
  [50, "Venom"],
  [51, "Venom"],
  [54, "Suicide"],
  [55, "Suicide"],
  [63, "Particle Beam"],
  [65, "Psi Blades"],
  [67, "Phase Disruptor"],
  [68, "Psi Assault"],
  [69, "Psi Assault"],
  [71, "Psionic Shockwave"],
  [72, "Unused"],
  [74, "Anti-matter Missiles"],
  [75, "Dual Photon Blasters"],
  [76, "Anti-matter Missiles"],
  [78, "Phase Disruptor Cannon"],
  [85, "Warp Blades"],
  [86, "Warp Blades"],
  [87, "Missiles"],
  [88, "Laser Battery"],
  [89, "Tormentor Missiles"],
  [90, "Bombs"],
  [91, "Raider Gun"],
  [92, "Undefined Weapon Name"],
  [93, "Undefined Weapon Name"],
  [94, "Undefined Weapon Name"],
  [95, "Flechette Grenade"],
  [96, "Twin Autocannons"],
  [97, "Hellfire Missile Pack"],
  [98, "Flame Thrower"],
  [99, "Hellfire Missile Pack"],
  [110, "Gauss Rifle"],
  [112, "C-10 Canister Rifle"],
  [113, "C-10 Canister Rifle"],
  [114, "Dual Photon Blasters"],
  [115, "Anti-matter Missiles"],
  [116, "C-10 Canister Rifle"],
  [117, "Gauss Rifle"],
  [118, "Gauss Rifle"],
  [119, "Gauss Rifle"],
  [120, "Gauss Rifle"],
  [121, "Gauss Rifle"],
  [122, "Gauss Rifle"],
  [123, "Gauss Rifle"],
  [124, "Gauss Rifle"],
  [125, "Gauss Rifle"],
  [126, "Gauss Rifle"],
  [127, "Gauss Rifle"],
  [128, "Gauss Rifle"],
  [129, "Gauss Rifle"],
];

/** The upgrade names Blizzard's `upgrades.dat` labels give, where they differ from StarEdit's. */
export const GAME_UPGRADE_NAMES: readonly [id: number, name: string][] = [
  [5, "Protoss Armor"],
  [6, "Protoss Plating"],
  [18, "Burst Lasers"],
  [54, "Charon Booster"],
];

/** The technology names Blizzard's `techdata.dat` labels give, where they differ from StarEdit's. */
export const GAME_TECH_NAMES: readonly [id: number, name: string][] = [
  [13, "Spawn Broodling"],
];

const toMap = (pairs: readonly [number, string][]) => new Map(pairs);
const GAME_UNITS = toMap(GAME_UNIT_NAMES);
const GAME_WEAPONS = toMap(GAME_WEAPON_NAMES);
const GAME_UPGRADES = toMap(GAME_UPGRADE_NAMES);
const GAME_TECHS = toMap(GAME_TECH_NAMES);

/** What Blizzard's own data calls an id: the game's name where it has one of its own, else StarEdit's. */
export const gameUnitName = (id: number) => GAME_UNITS.get(id) ?? UNIT_NAMES[id] ?? "";
export const gameWeaponName = (id: number) => GAME_WEAPONS.get(id) ?? WEAPON_NAMES[id] ?? "";
export const gameUpgradeName = (id: number) => GAME_UPGRADES.get(id) ?? UPGRADE_NAMES[id] ?? "";
export const gameTechName = (id: number) => GAME_TECHS.get(id) ?? TECH_NAMES[id] ?? "";

/** The rule: the data's name where it is something and not what the game's own data says; else null for the table. */
function pick(data: string, game: string): string | null {
  return data !== "" && data !== game ? data : null;
}

/**
 * A label column resolved through the table (`stat_txt` is 1-based in the dat files, 0 meaning
 * none), with the mod's own list (`nameList`: a name an entry, "" where the label stands) over
 * it; as many entries as the table has, the editor's own count at least.
 */
function labelled(labels: ArrayLike<number> | undefined, statTxt: readonly (readonly string[])[], count: number, game: (id: number) => string, list: readonly string[] | null): (string | null)[] {
  const out: (string | null)[] = [];
  for (let id = 0; id < Math.max(count, labels?.length ?? 0); id++) {
    const index = labels?.[id] ?? 0;
    const own = list?.[id] ? cleanLabel(list[id]) : "";
    const text = own || (index > 0 ? cleanLabel(statTxt[index - 1]?.[0] ?? "") : "");
    out.push(id < count ? pick(text, game(id)) : text || null);
  }
  return out;
}

/**
 * The names a loaded data set puts in front of the editor's tables, or null when it has
 * no `stat_txt.tbl` (an older extraction) — every slot null means the tables stand alone,
 * which is what Blizzard's own files come to. A GPTP mod's own name files, where the set
 * has them (`assets.nameTexts`), go first for weapons, upgrades and technologies, as the
 * command line's `mod header` reads them (`formats/mod/data.ts`): `arr\<table>.txt` over
 * the labels, `rez\stat.txt` where `stat_txt.tbl` has no entry.
 */
export function namesFromAssets(assets: Pick<UnitAssets, "statTxt" | "weapons" | "upgrades" | "techs"> & Partial<Pick<UnitAssets, "units" | "unitNames" | "nameTexts">>): LoadedNames | null {
  const texts = assets.nameTexts ?? {};
  const statTxt = assets.statTxt && texts.stat !== undefined
    ? statWithText(assets.statTxt.map((e) => e.join("\0")), texts.stat).map((e) => e.split("\0"))
    : assets.statTxt;
  const extended = extendedUnitNames(assets);
  if (!statTxt) {
    if (!extended.some((n) => n !== null)) return null;
    return { units: extended.map((n, id) => (n && id < UNIT_NAMES.length ? pick(n, gameUnitName(id)) : n)), weapons: [], upgrades: [], techs: [] };
  }
  const units: (string | null)[] = [];
  for (let id = 0; id < UNIT_NAMES.length; id++) {
    // A data set's unitnames.tbl names every type where it has an entry, as GPTP reads it; stat_txt.tbl otherwise.
    const own = extended[id];
    const entry = statTxt[id];
    units.push(own ? pick(own, gameUnitName(id)) : entry ? pick(composeUnitName(entry), gameUnitName(id)) : null);
  }
  for (let id = UNIT_NAMES.length; id < extended.length; id++) units.push(extended[id]);
  const list = (key: "weapons" | "upgrades" | "techdata", labels: ArrayLike<number> | undefined) => nameList(texts[key] ?? null, labels?.length ?? 0);
  return {
    units,
    weapons: labelled(assets.weapons?.label, statTxt, WEAPON_NAMES.length, gameWeaponName, list("weapons", assets.weapons?.label)),
    upgrades: labelled(assets.upgrades?.label, statTxt, UPGRADE_NAMES.length, gameUpgradeName, list("upgrades", assets.upgrades?.label)),
    techs: labelled(assets.techs?.label, statTxt, TECH_NAMES.length, gameTechName, list("techdata", assets.techs?.label)),
  };
}

/** True when every slot is null: the data set names things exactly as the game's own does. */
export function namesAreTheGames(names: LoadedNames | null): boolean {
  return !names || [names.units, names.weapons, names.upgrades, names.techs].every((list) => list.every((n) => n === null));
}

/**
 * The names `rez\unitnames.tbl` gives the unit types, by id (null where it names none, or
 * the data set has no such table): entry N is type N, GPTP's convention, for every type —
 * the game's 228 included, which GPTP also names from it when it is there. `*` is no name.
 * As long as units.dat has types, so a data set with more than 228 has names for the rest.
 */
function extendedUnitNames(assets: Partial<Pick<UnitAssets, "units" | "unitNames">>): (string | null)[] {
  const count = Math.max(datCount(assets.units?.flingy), UNIT_NAMES.length);
  const out: (string | null)[] = [];
  for (let id = 0; id < count; id++) {
    const entry = assets.unitNames?.[id];
    const name = entry ? composeUnitName(entry) : "";
    out.push(name && name !== "*" ? name : null);
  }
  return out;
}

/** A unit type's race by its units.dat group flags (bit 0 Zerg, 1 Terran, 2 Protoss), neutral for none. */
export function raceOfFlags(groupFlags: number): RaceKey {
  return groupFlags & 1 ? "zerg" : groupFlags & 2 ? "terran" : groupFlags & 4 ? "protoss" : "neutral";
}

/** Which kind of type each of StarEdit's groups holds, by id: its race, and buildings, heroes or other units; null race for the neutral groups, which take anything neutral. */
const STAREDIT_GROUP_OF: ReadonlyMap<number, { race: RaceKey | null; kind: "units" | "buildings" | "heroes" | null }> = new Map(
  UNIT_GROUPS.flatMap((g) => {
    const race = g.race === "neutral" ? null : g.race;
    const kind = race === null ? null : g.label.endsWith("Buildings") ? "buildings" : g.label.endsWith("Heroes") ? "heroes" : "units";
    return g.units.map((id) => [id, { race, kind }] as const);
  }),
);

/** Whether a type with this race and these flags still belongs in StarEdit's group for its id. */
function fitsStarEditGroup(id: number, race: RaceKey, flags: number): boolean {
  const group = STAREDIT_GROUP_OF.get(id);
  if (!group) return false;
  if (group.race === null) return race === "neutral";
  if (group.race !== race) return false;
  const building = (flags & UnitFlag.Building) !== 0, hero = (flags & UnitFlag.Hero) !== 0;
  return group.kind === "buildings" ? building : group.kind === "heroes" ? hero && !building : !hero && !building;
}

/**
 * What the loaded data has beyond StarEdit's palette (`units.ts#UnitCatalogue`): its count,
 * and the types the palette lists by the data's own race and building flags — every one from
 * 228 on when the data set names none of them, else the ones it names (a mod's table is
 * usually wider than what it uses, the rest left as copies of a template with no name) —
 * and, before them, the game's types the data set renamed into something StarEdit's group
 * for that id no longer describes (a mod's Zerg unit in the slot of a Terran building).
 * `names` is what `namesFromAssets` gave: a type it leaves to the tables is the game's own
 * and stays where StarEdit put it, so the game's data moves nothing.
 */
export function unitCatalogue(assets: Pick<UnitAssets, "units"> & Partial<Pick<UnitAssets, "unitNames">>, names: LoadedNames | null = null): UnitCatalogue | null {
  const units = assets.units;
  const count = datCount(units.flingy);
  const extended: { id: number; race: RaceKey; building: boolean }[] = [];
  const entry = (id: number) => ({ id, race: raceOfFlags(units.groupFlags[id] ?? 0), building: ((units.flags[id] ?? 0) & UnitFlag.Building) !== 0 });
  for (let id = 0; id < Math.min(count, UNIT_NAMES.length); id++) {
    if (names?.units[id] == null) continue;
    const e = entry(id);
    if (!fitsStarEditGroup(id, e.race, units.flags[id] ?? 0)) extended.push(e);
  }
  for (let id = UNIT_NAMES.length; id < count; id++) {
    if (assets.unitNames) {
      const entry = assets.unitNames[id];
      const name = entry ? composeUnitName(entry) : "";
      if (!name || name === "*") continue;
    }
    extended.push(entry(id));
  }
  if (count <= UNIT_NAMES.length && extended.length === 0) return null;
  return { count: Math.max(count, UNIT_NAMES.length), extended };
}
