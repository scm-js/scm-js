/** Unit type catalogue: StarEdit names by units.dat id, and the palette's grouping of them. */

export type RaceKey = "terran" | "zerg" | "protoss" | "neutral";

/** StarEdit's display names, indexed by units.dat id (0–227). */
export const UNIT_NAMES: readonly string[] = [
  "Terran Marine", "Terran Ghost", "Terran Vulture", "Terran Goliath", "Goliath Turret",
  "Terran Siege Tank (Tank Mode)", "Siege Tank Turret (Tank Mode)", "Terran SCV", "Terran Wraith", "Terran Science Vessel",
  "Gui Montag (Firebat)", "Terran Dropship", "Terran Battlecruiser", "Spider Mine", "Nuclear Missile",
  "Terran Civilian", "Sarah Kerrigan (Ghost)", "Alan Schezar (Goliath)", "Alan Schezar Turret", "Jim Raynor (Vulture)",
  "Jim Raynor (Marine)", "Tom Kazansky (Wraith)", "Magellan (Science Vessel)", "Edmund Duke (Tank Mode)", "Edmund Duke Turret (Tank Mode)",
  "Edmund Duke (Siege Mode)", "Edmund Duke Turret (Siege Mode)", "Arcturus Mengsk (Battlecruiser)", "Hyperion (Battlecruiser)", "Norad II (Battlecruiser)",
  "Terran Siege Tank (Siege Mode)", "Siege Tank Turret (Siege Mode)", "Terran Firebat", "Scanner Sweep", "Terran Medic",
  "Zerg Larva", "Zerg Egg", "Zerg Zergling", "Zerg Hydralisk", "Zerg Ultralisk",
  "Zerg Broodling", "Zerg Drone", "Zerg Overlord", "Zerg Mutalisk", "Zerg Guardian",
  "Zerg Queen", "Zerg Defiler", "Zerg Scourge", "Torrasque (Ultralisk)", "Matriarch (Queen)",
  "Infested Terran", "Infested Kerrigan (Infested Terran)", "Unclean One (Defiler)", "Hunter Killer (Hydralisk)", "Devouring One (Zergling)",
  "Kukulza (Mutalisk)", "Kukulza (Guardian)", "Yggdrasill (Overlord)", "Terran Valkyrie", "Mutalisk Cocoon",
  "Protoss Corsair", "Protoss Dark Templar", "Zerg Devourer", "Protoss Dark Archon", "Protoss Probe",
  "Protoss Zealot", "Protoss Dragoon", "Protoss High Templar", "Protoss Archon", "Protoss Shuttle",
  "Protoss Scout", "Protoss Arbiter", "Protoss Carrier", "Protoss Interceptor", "Protoss Dark Templar (Hero)",
  "Zeratul (Dark Templar)", "Tassadar/Zeratul (Archon)", "Fenix (Zealot)", "Fenix (Dragoon)", "Tassadar (Templar)",
  "Mojo (Scout)", "Warbringer (Reaver)", "Gantrithor (Carrier)", "Protoss Reaver", "Protoss Observer",
  "Protoss Scarab", "Danimoth (Arbiter)", "Aldaris (Templar)", "Artanis (Scout)", "Rhynadon (Badlands Critter)",
  "Bengalaas (Jungle Critter)", "Cargo Ship (Unused)", "Mercenary Gunship (Unused)", "Scantid (Desert Critter)", "Kakaru (Twilight Critter)",
  "Ragnasaur (Ashworld Critter)", "Ursadon (Ice World Critter)", "Lurker Egg", "Raszagal (Corsair)", "Samir Duran (Ghost)",
  "Alexei Stukov (Ghost)", "Map Revealer", "Gerard DuGalle (Battlecruiser)", "Zerg Lurker", "Infested Duran",
  "Disruption Web", "Terran Command Center", "Terran Comsat Station", "Terran Nuclear Silo", "Terran Supply Depot",
  "Terran Refinery", "Terran Barracks", "Terran Academy", "Terran Factory", "Terran Starport",
  "Terran Control Tower", "Terran Science Facility", "Terran Covert Ops", "Terran Physics Lab", "Starbase (Unused)",
  "Terran Machine Shop", "Repair Bay (Unused)", "Terran Engineering Bay", "Terran Armory", "Terran Missile Turret",
  "Terran Bunker", "Norad II (Crashed)", "Ion Cannon", "Uraj Crystal", "Khalis Crystal",
  "Zerg Infested Command Center", "Zerg Hatchery", "Zerg Lair", "Zerg Hive", "Zerg Nydus Canal",
  "Zerg Hydralisk Den", "Zerg Defiler Mound", "Zerg Greater Spire", "Zerg Queen's Nest", "Zerg Evolution Chamber",
  "Zerg Ultralisk Cavern", "Zerg Spire", "Zerg Spawning Pool", "Zerg Creep Colony", "Zerg Spore Colony",
  "Unused Zerg Building 1", "Zerg Sunken Colony", "Zerg Overmind (With Shell)", "Zerg Overmind", "Zerg Extractor",
  "Mature Chrysalis", "Zerg Cerebrate", "Zerg Cerebrate Daggoth", "Unused Zerg Building 2", "Protoss Nexus",
  "Protoss Robotics Facility", "Protoss Pylon", "Protoss Assimilator", "Unused Protoss Building 1", "Protoss Observatory",
  "Protoss Gateway", "Unused Protoss Building 2", "Protoss Photon Cannon", "Protoss Citadel of Adun", "Protoss Cybernetics Core",
  "Protoss Templar Archives", "Protoss Forge", "Protoss Stargate", "Stasis Cell/Prison", "Protoss Fleet Beacon",
  "Protoss Arbiter Tribunal", "Protoss Robotics Support Bay", "Protoss Shield Battery", "Khaydarin Crystal Formation", "Protoss Temple",
  "Xel'Naga Temple", "Mineral Field (Type 1)", "Mineral Field (Type 2)", "Mineral Field (Type 3)", "Cave (Unused)",
  "Cave-in (Unused)", "Cantina (Unused)", "Mining Platform (Unused)", "Independent Command Center (Unused)", "Independent Starport (Unused)",
  "Independent Jump Gate (Unused)", "Ruins (Unused)", "Khaydarin Crystal Formation (Unused)", "Vespene Geyser", "Warp Gate",
  "Psi Disrupter", "Zerg Marker", "Terran Marker", "Protoss Marker", "Zerg Beacon",
  "Terran Beacon", "Protoss Beacon", "Zerg Flag Beacon", "Terran Flag Beacon", "Protoss Flag Beacon",
  "Power Generator", "Overmind Cocoon", "Dark Swarm", "Floor Missile Trap", "Floor Hatch (Unused)",
  "Left Upper Level Door", "Right Upper Level Door", "Left Pit Door", "Right Pit Door", "Floor Gun Trap",
  "Left Wall Missile Trap", "Left Wall Flame Trap", "Right Wall Missile Trap", "Right Wall Flame Trap", "Start Location",
  "Flag", "Young Chrysalis", "Psi Emitter", "Data Disk", "Khaydarin Crystal",
  "Mineral Cluster Type 1", "Mineral Cluster Type 2", "Protoss Vespene Gas Orb Type 1", "Protoss Vespene Gas Orb Type 2", "Zerg Vespene Gas Sac Type 1",
  "Zerg Vespene Gas Sac Type 2", "Terran Vespene Gas Tank Type 1", "Terran Vespene Gas Tank Type 2",
];

export const UNIT_TYPE_COUNT = UNIT_NAMES.length;

export const START_LOCATION = 214;

export function unitName(id: number): string {
  return UNIT_NAMES[id] ?? `Unit #${id}`;
}

export interface UnitGroup {
  race: RaceKey;
  label: string;
  /** units.dat ids, in palette order. */
  units: number[];
}

/** SCMDraft-style palette grouping. Every id 0–227 appears exactly once (see tests/dat.test.ts). */
export const UNIT_GROUPS: UnitGroup[] = [
  { race: "terran", label: "Terran Units", units: [0, 1, 2, 3, 5, 30, 7, 8, 9, 11, 12, 32, 34, 58, 15, 13, 14] },
  { race: "terran", label: "Terran Buildings", units: [106, 107, 108, 109, 110, 111, 112, 113, 120, 114, 115, 116, 117, 118, 122, 123, 124, 125] },
  { race: "terran", label: "Terran Heroes", units: [20, 19, 16, 21, 22, 28, 29, 17, 10, 23, 25, 27, 99, 100, 102] },
  { race: "zerg", label: "Zerg Units", units: [35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 50, 103, 62, 59, 97] },
  { race: "zerg", label: "Zerg Buildings", units: [131, 132, 133, 134, 135, 136, 137, 138, 139, 140, 141, 142, 143, 144, 146, 149, 130] },
  { race: "zerg", label: "Zerg Heroes", units: [48, 49, 51, 52, 53, 54, 55, 56, 57, 104] },
  { race: "protoss", label: "Protoss Units", units: [64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 83, 85, 84, 61, 63, 60] },
  { race: "protoss", label: "Protoss Buildings", units: [154, 155, 156, 157, 159, 160, 162, 163, 164, 165, 166, 167, 169, 170, 171, 172] },
  { race: "protoss", label: "Protoss Heroes", units: [74, 75, 76, 77, 78, 79, 80, 81, 82, 86, 87, 88, 98] },
  { race: "neutral", label: "Critters", units: [89, 90, 93, 94, 95, 96] },
  { race: "neutral", label: "Resources", units: [176, 177, 178, 188] },
  { race: "neutral", label: "Powerups", units: [215, 216, 217, 218, 219, 128, 129, 220, 221, 222, 223, 224, 225, 226, 227] },
  {
    race: "neutral",
    label: "Special",
    units: [214, 101, 183, 194, 195, 196, 197, 198, 199, 191, 192, 193, 175, 174, 190, 127, 148, 147, 201, 151, 152, 173, 189, 200, 150, 168, 126, 202, 105, 33],
  },
  {
    race: "neutral",
    label: "Installation Doodads",
    units: [186, 203, 209, 210, 211, 212, 213, 205, 206, 207, 208, 204, 187],
  },
  {
    race: "neutral",
    label: "Turrets & Unused",
    units: [4, 6, 18, 24, 26, 31, 91, 92, 119, 121, 145, 153, 158, 161, 179, 180, 181, 182, 184, 185],
  },
];

export const RACE_LABEL: Record<RaceKey, string> = {
  terran: "Terran",
  zerg: "Zerg",
  protoss: "Protoss",
  neutral: "Neutral",
};

export const UPGRADES = [
  "Terran Infantry Armor", "Terran Vehicle Plating", "Terran Ship Plating", "Zerg Carapace", "Zerg Flyer Carapace",
  "Protoss Ground Armor", "Protoss Air Armor", "Protoss Plasma Shields", "Terran Infantry Weapons", "Terran Vehicle Weapons",
  "Terran Ship Weapons", "Zerg Melee Attacks", "Zerg Missile Attacks", "Zerg Flyer Attacks", "Protoss Ground Weapons",
  "Protoss Air Weapons", "U-238 Shells", "Ion Thrusters", "Titan Reactor", "Ocular Implants", "Moebius Reactor",
  "Apollo Reactor", "Colossus Reactor", "Ventral Sacs", "Antennae", "Pneumatized Carapace", "Metabolic Boost",
  "Adrenal Glands", "Muscular Augments", "Grooved Spines", "Gamete Meiosis", "Metasynaptic Node", "Singularity Charge",
  "Leg Enhancements", "Scarab Damage", "Reaver Capacity", "Gravitic Drive", "Sensor Array", "Gravitic Boosters",
  "Khaydarin Amulet", "Apial Sensors", "Gravitic Thrusters", "Carrier Capacity", "Khaydarin Core", "Argus Jewel",
  "Argus Talisman", "Caduceus Reactor", "Chitinous Plating", "Anabolic Synthesis", "Charon Boosters",
];

export const TECHS = [
  "Stim Packs", "Lockdown", "EMP Shockwave", "Spider Mines", "Scanner Sweep", "Tank Siege Mode", "Defensive Matrix",
  "Irradiate", "Yamato Gun", "Cloaking Field", "Personnel Cloaking", "Burrowing", "Infestation", "Spawn Broodlings",
  "Dark Swarm", "Plague", "Consume", "Ensnare", "Parasite", "Psionic Storm", "Hallucination", "Recall", "Stasis Field",
  "Archon Warp", "Restoration", "Disruption Web", "Mind Control", "Dark Archon Meld", "Feedback", "Optical Flare",
  "Maelstrom", "Lurker Aspect", "Healing",
];

export const SPRITES = [
  "Fusion Cutter Hit", "Zergling Hit", "Vespene Geyser Smoke", "Mineral Field Type 1", "Mineral Field Type 2",
  "Mineral Field Type 3", "Vespene Geyser", "Cursor Marker", "Circle Marker", "Zerg Building Spawn",
  "Cliff Doodad Light", "Floor Hatch", "Ash World Rocks", "Jungle Tree Canopy", "Smoke Column", "Fire (Small)",
  "Fire (Large)", "Sparks", "Puddle", "Pipe Steam", "Hallucination Death", "Protoss Warp Flash",
  "Terran Building Landing Dust", "Psi Storm", "Nuke Target Dot", "Map Revealer",
];
