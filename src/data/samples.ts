/** Placeholder scenario content so the skeleton UI has something to show. */

export interface SampleLocation {
  id: number;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SAMPLE_LOCATIONS: SampleLocation[] = [
  { id: 63, name: "Anywhere", x: 0, y: 0, w: 128, h: 128 },
  { id: 0, name: "Beacon Alpha", x: 18, y: 14, w: 6, h: 6 },
  { id: 1, name: "Beacon Bravo", x: 104, y: 108, w: 6, h: 6 },
  { id: 2, name: "Center Arena", x: 52, y: 52, w: 24, h: 24 },
  { id: 3, name: "P1 Base", x: 6, y: 6, w: 20, h: 16 },
  { id: 4, name: "P2 Base", x: 102, y: 106, w: 20, h: 16 },
  { id: 5, name: "North Expo", x: 60, y: 4, w: 12, h: 10 },
  { id: 6, name: "South Expo", x: 56, y: 114, w: 12, h: 10 },
];

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
