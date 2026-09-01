/** Placeholder scenario content so the skeleton UI has something to show. */

export const SAMPLE_START_LOCATIONS: { player: number; x: number; y: number }[] = [
  { player: 0, x: 12, y: 12 },
  { player: 1, x: 116, y: 116 },
  { player: 2, x: 116, y: 12 },
  { player: 3, x: 12, y: 116 },
];

export const SAMPLE_STRINGS = [
  { id: 1, text: "Untitled Scenario", usage: "Map name" },
  { id: 2, text: "Destroy all enemy buildings.", usage: "Map description" },
  { id: 3, text: "Force 1", usage: "Force 1 name" },
  { id: 4, text: "Force 2", usage: "Force 2 name" },
  { id: 5, text: "You found the beacon!", usage: "Trigger 2 · Display Text" },
  { id: 6, text: "Beacon Alpha", usage: "Location 0" },
  { id: 7, text: "Beacon Bravo", usage: "Location 1" },
  { id: 8, text: "Center Arena", usage: "Location 2" },
  { id: 9, text: "Starting resources", usage: "Trigger 1 · Comment" },
  { id: 10, text: "Switch 1: Round Started", usage: "Switch 0 name" },
];

export const SAMPLE_SOUNDS = [
  { name: "staredit\\wav\\beacon.wav", size: "38 KB", length: "0:01.2" },
  { name: "sound\\Terran\\Advisor\\tAdUpd00.wav", size: "61 KB", length: "0:02.0" },
  { name: "custom\\round_start.wav", size: "112 KB", length: "0:03.4" },
];

export const RECENT_FILES = [
  "Maps\\Lost Temple.scm",
  "Maps\\BroodWar\\Fighting Spirit.scx",
  "Maps\\Custom\\Bound Zero.scx",
  "Maps\\Custom\\Sunken Defence v3.scx",
];
