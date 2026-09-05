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
import { TECH_NAMES, UNIT_NAMES, UPGRADE_NAMES, type LoadedNames } from "./units";
import { WEAPON_NAMES } from "./weapons";

/**
 * A `stat_txt.tbl` label as plain text. Button labels carry their hotkey in front of the
 * text and colour codes around the letter it names (`i<03><03>I<01>rradiate`): the first
 * character goes when a control byte follows it, and every control byte goes.
 */
export function cleanLabel(label: string): string {
  let text = label;
  if (text.length > 1 && text.charCodeAt(1) < 0x20) text = text.slice(1);
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

/** A label column resolved through the table: `stat_txt` is 1-based in the dat files, 0 meaning none. */
function labelled(labels: ArrayLike<number> | undefined, statTxt: readonly (readonly string[])[], count: number, game: (id: number) => string): (string | null)[] {
  const out: (string | null)[] = [];
  for (let id = 0; id < count; id++) {
    const index = labels?.[id] ?? 0;
    const text = index > 0 ? cleanLabel(statTxt[index - 1]?.[0] ?? "") : "";
    out.push(pick(text, game(id)));
  }
  return out;
}

/**
 * The names a loaded data set puts in front of the editor's tables, or null when it has
 * no `stat_txt.tbl` (an older extraction) — every slot null means the tables stand alone,
 * which is what Blizzard's own files come to.
 */
export function namesFromAssets(assets: Pick<UnitAssets, "statTxt" | "weapons" | "upgrades" | "techs">): LoadedNames | null {
  const statTxt = assets.statTxt;
  if (!statTxt) return null;
  const units: (string | null)[] = [];
  for (let id = 0; id < UNIT_NAMES.length; id++) {
    const entry = statTxt[id];
    units.push(entry ? pick(composeUnitName(entry), gameUnitName(id)) : null);
  }
  return {
    units,
    weapons: labelled(assets.weapons?.label, statTxt, WEAPON_NAMES.length, gameWeaponName),
    upgrades: labelled(assets.upgrades?.label, statTxt, UPGRADE_NAMES.length, gameUpgradeName),
    techs: labelled(assets.techs?.label, statTxt, TECH_NAMES.length, gameTechName),
  };
}

/** True when every slot is null: the data set names things exactly as the game's own does. */
export function namesAreTheGames(names: LoadedNames | null): boolean {
  return !names || [names.units, names.weapons, names.upgrades, names.techs].every((list) => list.every((n) => n === null));
}
