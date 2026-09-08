import { msg, translate } from "../i18n";
/** Unit type catalogue: StarEdit names by units.dat id, and the palette's grouping of them. */

export type RaceKey = "terran" | "zerg" | "protoss" | "neutral";

/** StarEdit's display names, indexed by units.dat id (0–227). */
export const UNIT_NAMES: readonly string[] = [
  msg("Terran Marine"), msg("Terran Ghost"), msg("Terran Vulture"), msg("Terran Goliath"), msg("Goliath Turret"),
  msg("Terran Siege Tank (Tank Mode)"), msg("Siege Tank Turret (Tank Mode)"), msg("Terran SCV"), msg("Terran Wraith"), msg("Terran Science Vessel"),
  msg("Gui Montag (Firebat)"), msg("Terran Dropship"), msg("Terran Battlecruiser"), msg("Spider Mine"), msg("Nuclear Missile"),
  msg("Terran Civilian"), msg("Sarah Kerrigan (Ghost)"), msg("Alan Schezar (Goliath)"), msg("Alan Schezar Turret"), msg("Jim Raynor (Vulture)"),
  msg("Jim Raynor (Marine)"), msg("Tom Kazansky (Wraith)"), msg("Magellan (Science Vessel)"), msg("Edmund Duke (Tank Mode)"), msg("Edmund Duke Turret (Tank Mode)"),
  msg("Edmund Duke (Siege Mode)"), msg("Edmund Duke Turret (Siege Mode)"), msg("Arcturus Mengsk (Battlecruiser)"), msg("Hyperion (Battlecruiser)"), msg("Norad II (Battlecruiser)"),
  msg("Terran Siege Tank (Siege Mode)"), msg("Siege Tank Turret (Siege Mode)"), msg("Terran Firebat"), msg("Scanner Sweep"), msg("Terran Medic"),
  msg("Zerg Larva"), msg("Zerg Egg"), msg("Zerg Zergling"), msg("Zerg Hydralisk"), msg("Zerg Ultralisk"),
  msg("Zerg Broodling"), msg("Zerg Drone"), msg("Zerg Overlord"), msg("Zerg Mutalisk"), msg("Zerg Guardian"),
  msg("Zerg Queen"), msg("Zerg Defiler"), msg("Zerg Scourge"), msg("Torrasque (Ultralisk)"), msg("Matriarch (Queen)"),
  msg("Infested Terran"), msg("Infested Kerrigan (Infested Terran)"), msg("Unclean One (Defiler)"), msg("Hunter Killer (Hydralisk)"), msg("Devouring One (Zergling)"),
  msg("Kukulza (Mutalisk)"), msg("Kukulza (Guardian)"), msg("Yggdrasill (Overlord)"), msg("Terran Valkyrie"), msg("Mutalisk Cocoon"),
  msg("Protoss Corsair"), msg("Protoss Dark Templar"), msg("Zerg Devourer"), msg("Protoss Dark Archon"), msg("Protoss Probe"),
  msg("Protoss Zealot"), msg("Protoss Dragoon"), msg("Protoss High Templar"), msg("Protoss Archon"), msg("Protoss Shuttle"),
  msg("Protoss Scout"), msg("Protoss Arbiter"), msg("Protoss Carrier"), msg("Protoss Interceptor"), msg("Protoss Dark Templar (Hero)"),
  msg("Zeratul (Dark Templar)"), msg("Tassadar/Zeratul (Archon)"), msg("Fenix (Zealot)"), msg("Fenix (Dragoon)"), msg("Tassadar (Templar)"),
  msg("Mojo (Scout)"), msg("Warbringer (Reaver)"), msg("Gantrithor (Carrier)"), msg("Protoss Reaver"), msg("Protoss Observer"),
  msg("Protoss Scarab"), msg("Danimoth (Arbiter)"), msg("Aldaris (Templar)"), msg("Artanis (Scout)"), msg("Rhynadon (Badlands Critter)"),
  msg("Bengalaas (Jungle Critter)"), msg("Cargo Ship (Unused)"), msg("Mercenary Gunship (Unused)"), msg("Scantid (Desert Critter)"), msg("Kakaru (Twilight Critter)"),
  msg("Ragnasaur (Ashworld Critter)"), msg("Ursadon (Ice World Critter)"), msg("Lurker Egg"), msg("Raszagal (Corsair)"), msg("Samir Duran (Ghost)"),
  msg("Alexei Stukov (Ghost)"), msg("Map Revealer"), msg("Gerard DuGalle (Battlecruiser)"), msg("Zerg Lurker"), msg("Infested Duran"),
  msg("Disruption Web"), msg("Terran Command Center"), msg("Terran Comsat Station"), msg("Terran Nuclear Silo"), msg("Terran Supply Depot"),
  msg("Terran Refinery"), msg("Terran Barracks"), msg("Terran Academy"), msg("Terran Factory"), msg("Terran Starport"),
  msg("Terran Control Tower"), msg("Terran Science Facility"), msg("Terran Covert Ops"), msg("Terran Physics Lab"), msg("Starbase (Unused)"),
  msg("Terran Machine Shop"), msg("Repair Bay (Unused)"), msg("Terran Engineering Bay"), msg("Terran Armory"), msg("Terran Missile Turret"),
  msg("Terran Bunker"), msg("Norad II (Crashed)"), msg("Ion Cannon"), msg("Uraj Crystal"), msg("Khalis Crystal"),
  msg("Zerg Infested Command Center"), msg("Zerg Hatchery"), msg("Zerg Lair"), msg("Zerg Hive"), msg("Zerg Nydus Canal"),
  msg("Zerg Hydralisk Den"), msg("Zerg Defiler Mound"), msg("Zerg Greater Spire"), msg("Zerg Queen's Nest"), msg("Zerg Evolution Chamber"),
  msg("Zerg Ultralisk Cavern"), msg("Zerg Spire"), msg("Zerg Spawning Pool"), msg("Zerg Creep Colony"), msg("Zerg Spore Colony"),
  msg("Unused Zerg Building 1"), msg("Zerg Sunken Colony"), msg("Zerg Overmind (With Shell)"), msg("Zerg Overmind"), msg("Zerg Extractor"),
  msg("Mature Chrysalis"), msg("Zerg Cerebrate"), msg("Zerg Cerebrate Daggoth"), msg("Unused Zerg Building 2"), msg("Protoss Nexus"),
  msg("Protoss Robotics Facility"), msg("Protoss Pylon"), msg("Protoss Assimilator"), msg("Unused Protoss Building 1"), msg("Protoss Observatory"),
  msg("Protoss Gateway"), msg("Unused Protoss Building 2"), msg("Protoss Photon Cannon"), msg("Protoss Citadel of Adun"), msg("Protoss Cybernetics Core"),
  msg("Protoss Templar Archives"), msg("Protoss Forge"), msg("Protoss Stargate"), msg("Stasis Cell/Prison"), msg("Protoss Fleet Beacon"),
  msg("Protoss Arbiter Tribunal"), msg("Protoss Robotics Support Bay"), msg("Protoss Shield Battery"), msg("Khaydarin Crystal Formation"), msg("Protoss Temple"),
  msg("Xel'Naga Temple"), msg("Mineral Field (Type 1)"), msg("Mineral Field (Type 2)"), msg("Mineral Field (Type 3)"), msg("Cave (Unused)"),
  msg("Cave-in (Unused)"), msg("Cantina (Unused)"), msg("Mining Platform (Unused)"), msg("Independent Command Center (Unused)"), msg("Independent Starport (Unused)"),
  msg("Independent Jump Gate (Unused)"), msg("Ruins (Unused)"), msg("Khaydarin Crystal Formation (Unused)"), msg("Vespene Geyser"), msg("Warp Gate"),
  msg("Psi Disrupter"), msg("Zerg Marker"), msg("Terran Marker"), msg("Protoss Marker"), msg("Zerg Beacon"),
  msg("Terran Beacon"), msg("Protoss Beacon"), msg("Zerg Flag Beacon"), msg("Terran Flag Beacon"), msg("Protoss Flag Beacon"),
  msg("Power Generator"), msg("Overmind Cocoon"), msg("Dark Swarm"), msg("Floor Missile Trap"), msg("Floor Hatch (Unused)"),
  msg("Left Upper Level Door"), msg("Right Upper Level Door"), msg("Left Pit Door"), msg("Right Pit Door"), msg("Floor Gun Trap"),
  msg("Left Wall Missile Trap"), msg("Left Wall Flame Trap"), msg("Right Wall Missile Trap"), msg("Right Wall Flame Trap"), msg("Start Location"),
  msg("Flag"), msg("Young Chrysalis"), msg("Psi Emitter"), msg("Data Disk"), msg("Khaydarin Crystal"),
  msg("Mineral Cluster Type 1"), msg("Mineral Cluster Type 2"), msg("Protoss Vespene Gas Orb Type 1"), msg("Protoss Vespene Gas Orb Type 2"), msg("Zerg Vespene Gas Sac Type 1"),
  msg("Zerg Vespene Gas Sac Type 2"), msg("Terran Vespene Gas Tank Type 1"), msg("Terran Vespene Gas Tank Type 2"),
];

export const UNIT_TYPE_COUNT = UNIT_NAMES.length;

export const START_LOCATION = 214;

/**
 * Names read out of the loaded game data (`data/gameNames.ts#namesFromAssets`), one slot per
 * id, `null` where the built-in table applies. Installed by the unit loader when the tables
 * arrive and cleared when they are dropped, so `unitName` and its siblings follow whatever
 * data set is in use without every caller being told.
 */
export interface LoadedNames {
  units: readonly (string | null)[];
  weapons: readonly (string | null)[];
  upgrades: readonly (string | null)[];
  techs: readonly (string | null)[];
}

let loadedNames: LoadedNames | null = null;

/** Put the names the data gives in front of the tables here (`null` goes back to the tables alone). */
export function installNames(names: LoadedNames | null): void {
  loadedNames = names;
}

/** The names currently in front of the tables, or null when the data's are the game's own or nothing is loaded. */
export function currentLoadedNames(): LoadedNames | null {
  return loadedNames;
}

/** A unit type's display name: the loaded data's where it differs from the game's own, else StarEdit's. */
export function unitName(id: number): string {
  return loadedNames?.units[id] ?? UNIT_NAMES[id] ?? `Unit #${id}`;
}

/**
 * `unitName` in the user's language, for the chrome. The English name stays the
 * vocabulary of the text trigger format and the plugin API (`unitName`); a name the
 * game data supplied has no catalogue entry and shows as the data spells it.
 */
export const unitLabel = (id: number) => translate(unitName(id));
export const upgradeLabel = (id: number) => translate(upgradeName(id));
export const techLabel = (id: number) => translate(techName(id));

export interface UnitGroup {
  race: RaceKey;
  label: string;
  /** units.dat ids, in palette order. */
  units: number[];
}

/** SCMDraft-style palette grouping. Every id 0–227 appears exactly once (see tests/dat.test.ts). */
export const UNIT_GROUPS: UnitGroup[] = [
  { race: "terran", label: msg("Terran Units"), units: [0, 1, 2, 3, 5, 30, 7, 8, 9, 11, 12, 32, 34, 58, 15, 13, 14] },
  { race: "terran", label: msg("Terran Buildings"), units: [106, 107, 108, 109, 110, 111, 112, 113, 120, 114, 115, 116, 117, 118, 122, 123, 124, 125] },
  { race: "terran", label: msg("Terran Heroes"), units: [20, 19, 16, 21, 22, 28, 29, 17, 10, 23, 25, 27, 99, 100, 102] },
  { race: "zerg", label: msg("Zerg Units"), units: [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 50, 103, 62, 59, 97] },
  { race: "zerg", label: msg("Zerg Buildings"), units: [131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 146, 149, 130] },
  { race: "zerg", label: msg("Zerg Heroes"), units: [48, 49, 51, 52, 53, 54, 55, 56, 57, 104] },
  { race: "protoss", label: msg("Protoss Units"), units: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 83, 85, 84, 61, 63, 60] },
  { race: "protoss", label: msg("Protoss Buildings"), units: [154, 155, 156, 157, 159, 160, 162, 163, 164, 165, 166, 167, 169, 170, 171, 172] },
  { race: "protoss", label: msg("Protoss Heroes"), units: [74, 75, 76, 77, 78, 79, 80, 81, 82, 86, 87, 88, 98] },
  { race: "neutral", label: msg("Critters"), units: [89, 90, 93, 94, 95, 96] },
  { race: "neutral", label: msg("Resources"), units: [176, 177, 178, 188] },
  { race: "neutral", label: msg("Powerups"), units: [215, 216, 217, 218, 219, 128, 129, 220, 221, 222, 223, 224, 225, 226, 227] },
  {
    race: "neutral",
    label: msg("Special"),
    units: [214, 101, 183, 194, 195, 196, 197, 198, 199, 191, 192, 193, 175, 174, 190, 127, 148, 147, 201, 151, 152, 173, 189, 200, 150, 168, 126, 202, 105, 33],
  },
  {
    race: "neutral",
    label: msg("Installation Doodads"),
    units: [186, 203, 209, 210, 211, 212, 213, 205, 206, 207, 208, 204, 187],
  },
  {
    race: "neutral",
    label: msg("Turrets & Unused"),
    units: [4, 6, 18, 24, 26, 31, 91, 92, 119, 121, 145, 153, 158, 161, 179, 180, 181, 182, 184, 185],
  },
];

export const RACE_LABEL: Record<RaceKey, string> = {
  terran: msg("Terran"),
  zerg: msg("Zerg"),
  protoss: msg("Protoss"),
  neutral: msg("Neutral"),
};

/**
 * StarEdit's upgrade names by upgrades.dat id (0–60); 46 exist in the original game, Brood War
 * added the rest. The order is the game's (`upgrades.dat`'s `label` column, pinned against the
 * real file in `tests/names.test.ts`): the armour upgrades first, then the weapons, then Plasma
 * Shields at 15 — an earlier table had Plasma Shields at 7, which shifted ids 7–15 by one.
 */
export const UPGRADE_NAMES: readonly string[] = [
  msg("Terran Infantry Armor"), msg("Terran Vehicle Plating"), msg("Terran Ship Plating"), msg("Zerg Carapace"), msg("Zerg Flyer Carapace"),
  msg("Protoss Ground Armor"), msg("Protoss Air Armor"), msg("Terran Infantry Weapons"), msg("Terran Vehicle Weapons"), msg("Terran Ship Weapons"),
  msg("Zerg Melee Attacks"), msg("Zerg Missile Attacks"), msg("Zerg Flyer Attacks"), msg("Protoss Ground Weapons"), msg("Protoss Air Weapons"),
  msg("Protoss Plasma Shields"), msg("U-238 Shells"), msg("Ion Thrusters"), msg("Burst Lasers (Unused)"), msg("Titan Reactor"),
  msg("Ocular Implants"), msg("Moebius Reactor"), msg("Apollo Reactor"), msg("Colossus Reactor"), msg("Ventral Sacs"),
  msg("Antennae"), msg("Pneumatized Carapace"), msg("Metabolic Boost"), msg("Adrenal Glands"), msg("Muscular Augments"),
  msg("Grooved Spines"), msg("Gamete Meiosis"), msg("Metasynaptic Node"), msg("Singularity Charge"), msg("Leg Enhancements"),
  msg("Scarab Damage"), msg("Reaver Capacity"), msg("Gravitic Drive"), msg("Sensor Array"), msg("Gravitic Boosters"),
  msg("Khaydarin Amulet"), msg("Apial Sensors"), msg("Gravitic Thrusters"), msg("Carrier Capacity"), msg("Khaydarin Core"),
  msg("Unused (45)"), msg("Unused (46)"), msg("Argus Jewel"), msg("Unused (48)"), msg("Argus Talisman"),
  msg("Unused (50)"), msg("Caduceus Reactor"), msg("Chitinous Plating"), msg("Anabolic Synthesis"), msg("Charon Boosters"),
  msg("Unused (55)"), msg("Unused (56)"), msg("Unused (57)"), msg("Unused (58)"), msg("Unused (59)"), msg("Unused (60)"),
];

/** StarEdit's technology names by techdata.dat id (0–43); 24 exist in the original game. */
export const TECH_NAMES: readonly string[] = [
  msg("Stim Packs"), msg("Lockdown"), msg("EMP Shockwave"), msg("Spider Mines"), msg("Scanner Sweep"), msg("Tank Siege Mode"), msg("Defensive Matrix"),
  msg("Irradiate"), msg("Yamato Gun"), msg("Cloaking Field"), msg("Personnel Cloaking"), msg("Burrowing"), msg("Infestation"), msg("Spawn Broodlings"),
  msg("Dark Swarm"), msg("Plague"), msg("Consume"), msg("Ensnare"), msg("Parasite"), msg("Psionic Storm"), msg("Hallucination"), msg("Recall"), msg("Stasis Field"),
  msg("Archon Warp"), msg("Restoration"), msg("Disruption Web"), msg("Unused (26)"), msg("Mind Control"), msg("Dark Archon Meld"), msg("Feedback"),
  msg("Optical Flare"), msg("Maelstrom"), msg("Lurker Aspect"), msg("Unused (33)"), msg("Healing"),
  msg("Unused (35)"), msg("Unused (36)"), msg("Unused (37)"), msg("Unused (38)"), msg("Unused (39)"), msg("Unused (40)"), msg("Unused (41)"), msg("Unused (42)"), msg("Unused (43)"),
];

export const upgradeName = (id: number) => loadedNames?.upgrades[id] ?? UPGRADE_NAMES[id] ?? `Upgrade #${id}`;
export const techName = (id: number) => loadedNames?.techs[id] ?? TECH_NAMES[id] ?? `Technology #${id}`;

const T = "terran", Z = "zerg", P = "protoss";
/** Which race researches each upgrade, for grouping the list; null for the unused slots. */
export const UPGRADE_RACE: readonly (RaceKey | null)[] = [
  T, T, T, Z, Z, P, P, T, T, T, Z, Z, Z, P, P, P, T, T, T, T, T, T, T, T, Z, Z, Z, Z, Z, Z, Z, Z, Z, P, P, P, P, P, P, P, P, P, P, P, P,
  null, null, P, null, P, null, T, Z, Z, T, null, null, null, null, null, null,
];
export const TECH_RACE: readonly (RaceKey | null)[] = [
  T, T, T, T, T, T, T, T, T, T, T, Z, Z, Z, Z, Z, Z, Z, Z, P, P, P, P, P, T, P, null, P, P, P, T, P, Z, null, T,
  null, null, null, null, null, null, null, null, null,
];

/** Ids whose name is a placeholder: nothing in the game refers to them, so the dialogs list them last. */
export const isUnusedUpgrade = (id: number) => UPGRADE_RACE[id] === null;
export const isUnusedTech = (id: number) => TECH_RACE[id] === null;

