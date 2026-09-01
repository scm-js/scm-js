/** weapons.dat ids → StarEdit's names (stat_txt.tbl order), for the Unit Settings weapon rows. */
export const WEAPON_NAMES: readonly string[] = [
  "Gauss Rifle", "Gauss Rifle (Jim Raynor)", "C-10 Canister Rifle", "C-10 Canister Rifle (Sarah Kerrigan)", "Fragmentation Grenade",
  "Fragmentation Grenade (Jim Raynor)", "Spider Mines", "Twin Autocannons", "Hellfire Missile Pack", "Twin Autocannons (Alan Schezar)",
  "Hellfire Missile Pack (Alan Schezar)", "Arclite Cannon", "Arclite Cannon (Edmund Duke)", "Fusion Cutter", "Fusion Cutter (Harvest)",
  "Gemini Missiles", "Burst Lasers", "Gemini Missiles (Tom Kazansky)", "Burst Lasers (Tom Kazansky)", "ATS Laser Battery",
  "ATA Laser Battery", "ATS Laser Battery (Hero)", "ATA Laser Battery (Hero)", "ATS Laser Battery (Hyperion)", "ATA Laser Battery (Hyperion)",
  "Flame Thrower", "Flame Thrower (Gui Montag)", "Arclite Shock Cannon", "Arclite Shock Cannon (Edmund Duke)", "Longbolt Missile",
  "Yamato Gun", "Nuclear Strike", "Lockdown", "EMP Shockwave", "Irradiate",
  "Claws", "Claws (Devouring One)", "Claws (Infested Kerrigan)", "Needle Spines", "Needle Spines (Hunter Killer)",
  "Kaiser Blades", "Kaiser Blades (Torrasque)", "Toxic Spores (Broodling)", "Spines", "Spines (Harvest)",
  "Acid Spray (Unused)", "Acid Spore", "Acid Spore (Kukulza)", "Glave Wurm", "Glave Wurm (Kukulza)",
  "Venom (Unused)", "Venom (Unused, Hero)", "Seeker Spores", "Subterranean Tentacle", "Suicide (Infested Terran)",
  "Suicide (Scourge)", "Parasite", "Spawn Broodlings", "Ensnare", "Dark Swarm",
  "Plague", "Consume", "Particle Beam", "Particle Beam (Harvest)", "Psi Blades",
  "Psi Blades (Fenix)", "Phase Disruptor", "Phase Disruptor (Fenix)", "Psi Assault (Unused)", "Psi Assault (Tassadar/Aldaris)",
  "Psionic Shockwave", "Psionic Shockwave (Tassadar/Zeratul Archon)", "Unknown 72", "Dual Photon Blasters", "Anti-Matter Missiles",
  "Dual Photon Blasters (Mojo)", "Anti-Matter Missiles (Mojo)", "Phase Disruptor Cannon", "Phase Disruptor Cannon (Danimoth)", "Pulse Cannon",
  "STS Photon Cannon", "STA Photon Cannon", "Scarab", "Stasis Field", "Psionic Storm",
  "Warp Blades (Zeratul)", "Warp Blades (Dark Templar Hero)", "Missiles (Unused)", "Laser Battery 1 (Unused)", "Tormentor Missiles (Unused)",
  "Bombs (Unused)", "Raider Gun (Unused)", "Laser Battery 2 (Unused)", "Laser Battery 3 (Unused)", "Dual Photon Blasters (Unused)",
  "Flechette Grenade (Unused)", "Twin Autocannons (Floor Trap)", "Hellfire Missile Pack (Wall Trap)", "Flame Thrower (Wall Trap)", "Hellfire Missile Pack (Floor Trap)",
  "Neutron Flare", "Disruption Web", "Restoration", "Halo Rockets", "Corrosive Acid",
  "Mind Control", "Feedback", "Optical Flare", "Maelstrom", "Subterranean Spines",
  "Gauss Rifle 0 (Unused)", "Warp Blades", "C-10 Canister Rifle (Samir Duran)", "C-10 Canister Rifle (Infested Duran)", "Dual Photon Blasters (Artanis)",
  "Anti-Matter Missiles (Artanis)", "C-10 Canister Rifle (Alexei Stukov)", "Gauss Rifle 1 (Unused)", "Unknown 118", "Unknown 119",
  "Unknown 120", "Unknown 121", "Unknown 122", "Unknown 123", "Unknown 124",
  "Unknown 125", "Unknown 126", "Unknown 127", "Unknown 128", "Unknown 129",
];

export function weaponName(id: number): string {
  return WEAPON_NAMES[id] ?? `Weapon #${id}`;
}
