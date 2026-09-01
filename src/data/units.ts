/** A trimmed unit catalogue for palette / list skeletons. */

export type RaceKey = "terran" | "zerg" | "protoss" | "neutral";

export interface UnitGroup {
  race: RaceKey;
  label: string;
  units: string[];
}

export const UNIT_GROUPS: UnitGroup[] = [
  {
    race: "terran",
    label: "Terran Units",
    units: ["Marine", "Ghost", "Vulture", "Goliath", "Siege Tank", "SCV", "Wraith", "Science Vessel", "Dropship", "Battlecruiser", "Firebat", "Medic", "Valkyrie", "Nuclear Missile"],
  },
  {
    race: "terran",
    label: "Terran Buildings",
    units: ["Command Center", "Comsat Station", "Nuclear Silo", "Supply Depot", "Refinery", "Barracks", "Academy", "Factory", "Machine Shop", "Starport", "Control Tower", "Science Facility", "Covert Ops", "Physics Lab", "Engineering Bay", "Armory", "Missile Turret", "Bunker"],
  },
  {
    race: "terran",
    label: "Terran Heroes",
    units: ["Jim Raynor (Marine)", "Jim Raynor (Vulture)", "Sarah Kerrigan", "Tom Kazansky", "Magellan", "Hyperion", "Norad II", "Alan Schezar", "Gui Montag", "Edmund Duke (Siege Tank)", "Arcturus Mengsk", "Samir Duran", "Alexei Stukov", "Gerard DuGalle"],
  },
  {
    race: "zerg",
    label: "Zerg Units",
    units: ["Larva", "Egg", "Zergling", "Hydralisk", "Ultralisk", "Broodling", "Drone", "Overlord", "Mutalisk", "Guardian", "Queen", "Defiler", "Scourge", "Infested Terran", "Lurker", "Devourer", "Cocoon", "Lurker Egg"],
  },
  {
    race: "zerg",
    label: "Zerg Buildings",
    units: ["Hatchery", "Lair", "Hive", "Nydus Canal", "Hydralisk Den", "Defiler Mound", "Greater Spire", "Queen's Nest", "Evolution Chamber", "Ultralisk Cavern", "Spire", "Spawning Pool", "Creep Colony", "Spore Colony", "Sunken Colony", "Extractor"],
  },
  {
    race: "zerg",
    label: "Zerg Heroes",
    units: ["Torrasque", "Matriarch", "Infested Kerrigan", "Unclean One", "Hunter Killer", "Devouring One", "Kukulza (Mutalisk)", "Kukulza (Guardian)", "Yggdrasill", "Infested Duran"],
  },
  {
    race: "protoss",
    label: "Protoss Units",
    units: ["Probe", "Zealot", "Dragoon", "High Templar", "Archon", "Shuttle", "Scout", "Arbiter", "Carrier", "Interceptor", "Reaver", "Scarab", "Observer", "Dark Templar", "Dark Archon", "Corsair"],
  },
  {
    race: "protoss",
    label: "Protoss Buildings",
    units: ["Nexus", "Robotics Facility", "Pylon", "Assimilator", "Observatory", "Gateway", "Photon Cannon", "Citadel of Adun", "Cybernetics Core", "Templar Archives", "Forge", "Stargate", "Fleet Beacon", "Arbiter Tribunal", "Robotics Support Bay", "Shield Battery"],
  },
  {
    race: "protoss",
    label: "Protoss Heroes",
    units: ["Dark Templar (Hero)", "Zeratul", "Tassadar/Zeratul Archon", "Fenix (Zealot)", "Fenix (Dragoon)", "Tassadar", "Mojo", "Warbringer", "Gantrithor", "Danimoth", "Aldaris", "Artanis", "Raszagal"],
  },
  {
    race: "neutral",
    label: "Critters",
    units: ["Rhynadon (Badlands)", "Bengalaas (Jungle)", "Scantid (Desert)", "Kakaru (Twilight)", "Ragnasaur (Ashworld)", "Ursadon (Ice)"],
  },
  {
    race: "neutral",
    label: "Resources",
    units: ["Mineral Field (Type 1)", "Mineral Field (Type 2)", "Mineral Field (Type 3)", "Vespene Geyser"],
  },
  {
    race: "neutral",
    label: "Powerups",
    units: ["Flag", "Young Chrysalis", "Psi Emitter", "Data Disk", "Khaydarin Crystal", "Uraj Crystal", "Khalis Crystal", "Mineral Cluster", "Vespene Orb", "Vespene Sac", "Vespene Tank"],
  },
  {
    race: "neutral",
    label: "Special",
    units: ["Start Location", "Map Revealer", "Independent Command Center", "Zerg Beacon", "Terran Beacon", "Protoss Beacon", "Zerg Flag Beacon", "Terran Flag Beacon", "Protoss Flag Beacon", "Xel'Naga Temple", "Psi Disrupter", "Ion Cannon", "Overmind", "Overmind Cocoon", "Cerebrate", "Khaydarin Crystal Formation", "Warp Gate", "Power Generator", "Mature Chrysalis", "Zerg Overmind (With Shell)"],
  },
  {
    race: "neutral",
    label: "Unit Doodads",
    units: ["Ruins", "Floor Missile Trap", "Floor Gun Trap", "Wall Missile Trap", "Wall Flame Trap", "Left Upper Level Door", "Right Upper Level Door", "Left Pit Door", "Right Pit Door", "Kyadarin Crystal Formation", "Uraj", "Khalis"],
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
