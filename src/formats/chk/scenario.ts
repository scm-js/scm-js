import { Reader } from "./binary";
import { combine, parseChk, serializeChk, type ChkFile, type ChkSection } from "./reader";
import { sizeOf, specFor } from "./sections/registry";
import { decodeStrings, encodeStrings, getString, setString, type StringTable } from "./sections/strings";
import {
  decodeDoodads, decodeLocations, decodeSprites, decodeUnits,
  encodeDoodads, encodeLocations, encodeSprites, encodeUnits,
  type DoodadRecord, type LocationRecord, type SpriteRecord, type UnitRecord,
} from "./sections/objects";
import {
  decodeBytes, decodeForces, decodePlayerRgb, encodeBytes, encodeForces, encodePlayerRgb, defaultForces,
  FORCE_SLOTS, PLAYER_SLOTS, type Forces, type PlayerRgb,
} from "./sections/players";
import {
  decodeTechRestrictions, decodeTechSettings, decodeUnitAvailability, decodeUnitSettings, decodeUpgradeRestrictions, decodeUpgradeSettings,
  encodeTechRestrictions, encodeTechSettings, encodeUnitAvailability, encodeUnitSettings, encodeUpgradeRestrictions, encodeUpgradeSettings,
  TECHS_BW, TECHS_ORIGINAL, UPGRADES_BW, UPGRADES_ORIGINAL, WEAPONS_BW, WEAPONS_ORIGINAL,
  type TechRestrictions, type TechSettings, type UnitAvailability, type UnitSettings, type UpgradeRestrictions, type UpgradeSettings,
} from "./sections/settings";
import { decodeWavs, encodeWavs } from "./sections/sounds";
import {
  decodeIsom, decodeMask, decodeTiles, encodeIsom, encodeTiles,
} from "./sections/terrain";
import {
  decodeSwitchNames, decodeTriggers, encodeSwitchNames, encodeTriggers, type TriggerRecord,
} from "./sections/triggers";

/**
 * A parsed scenario.
 *
 * `chk` holds every original section in file order and is the fidelity anchor: sections
 * we do not model are re-emitted byte for byte, so opening and saving a map we only
 * partly understand does not destroy the parts we don't. Only names listed in `dirty`
 * are re-encoded on save.
 */
export interface Scenario {
  chk: ChkFile;
  dirty: Set<string>;
  warnings: string[];

  /** TYPE, e.g. "RAWB" for Brood War. */
  type: string;
  /** VER: 59 original, 63 hybrid, 205 Brood War, 206 Remastered. */
  fileVersion: number;

  width: number;
  height: number;
  /** ERA value as stored; the meaningful tileset is `tilesetId`. */
  era: number;

  strings: StringTable;
  nameIndex: number;
  descriptionIndex: number;

  playerTypes: number[];
  playerRaces: number[];
  playerColors: number[];
  /** CRGB, Remastered's per-slot colour choice; null when the file has none (every client then reads COLR). */
  playerRgb: PlayerRgb | null;
  forces: Forces;
  /** UNIx if the file has one, else UNIS; null when it has neither (every type on its dat defaults). */
  unitSettings: UnitSettings | null;
  /** PUNI; null when the file has none (everything buildable by everyone). */
  unitAvailability: UnitAvailability | null;
  /** UPGx if the file has one, else UPGS; null when it has neither (every upgrade on its dat costs). */
  upgradeSettings: UpgradeSettings | null;
  /** PUPx else UPGR; null when absent (every player on the dat level caps, starting at 0). */
  upgradeRestrictions: UpgradeRestrictions | null;
  /** TECx else TECS; null when absent. */
  techSettings: TechSettings | null;
  /** PTEx else PTEC; null when absent (everything researchable, nothing researched). */
  techRestrictions: TechRestrictions | null;
  /** WAV: 512 string indices of the map's sound paths; null when the file has no section. */
  wavs: number[] | null;

  /** MTXM: what the game draws — terrain with the doodads stamped over it. */
  tiles: Uint16Array;
  /**
   * TILE: StarEdit's copy of the terrain *without* doodads (a doodad's cells hold the
   * ground it was placed on). Terrain brushes write both arrays; placing a doodad writes
   * only `tiles`, and removing one restores its cells from here. A file without TILE
   * starts with a copy of MTXM.
   */
  editorTiles: Uint16Array;
  isom: Uint16Array | null;
  mask: Uint8Array | null;

  units: UnitRecord[];
  sprites: SpriteRecord[];
  doodads: DoodadRecord[];
  locations: LocationRecord[];

  /** TRIG, in execution order. */
  triggers: TriggerRecord[];
  /** MBRF: mission briefings, same record layout with briefing action types. */
  briefing: TriggerRecord[];
  /** SWNM: string index per switch (0 = unnamed); null when the file has no section. */
  switchNames: number[] | null;
}

export type TilesetIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** ERA is stored as a full u16 but the game masks it to three bits. */
export function tilesetIndex(scn: Scenario): TilesetIndex {
  return (scn.era & 7) as TilesetIndex;
}

export function scenarioName(scn: Scenario): string | null {
  return getString(scn.strings, scn.nameIndex);
}

export function scenarioDescription(scn: Scenario): string | null {
  return getString(scn.strings, scn.descriptionIndex);
}

export function markDirty(scn: Scenario, ...names: string[]) {
  for (const n of names) scn.dirty.add(n);
}

export function setScenarioName(scn: Scenario, text: string) {
  scn.nameIndex = setString(scn.strings, scn.nameIndex, text);
  markDirty(scn, strSectionName(scn), "SPRP");
}

export function setScenarioDescription(scn: Scenario, text: string) {
  scn.descriptionIndex = setString(scn.strings, scn.descriptionIndex, text);
  markDirty(scn, strSectionName(scn), "SPRP");
}

/** Which section the string table is written to: STRx for Remastered maps, STR otherwise. */
export function strSectionName(scn: Scenario): string {
  return scn.strings.extended ? "STRx" : "STR ";
}

/* ── Map revision ────────────────────────────────────────── */

export type MapVersion = "original" | "hybrid" | "broodwar" | "remastered";

/** VER values StarEdit writes for each revision. */
export const MAP_VERSIONS: Record<MapVersion, { ver: number; type: string; label: string; extension: string }> = {
  original: { ver: 59, type: "RAWS", label: "StarCraft 1.00", extension: "scm" },
  hybrid: { ver: 63, type: "RAWS", label: "Hybrid 1.04", extension: "scm" },
  broodwar: { ver: 205, type: "RAWB", label: "Brood War 1.04", extension: "scx" },
  remastered: { ver: 206, type: "RAWB", label: "Remastered 1.21+", extension: "scx" },
};

export function mapVersionOf(fileVersion: number): MapVersion {
  if (fileVersion >= 206) return "remastered";
  if (fileVersion >= 205) return "broodwar";
  if (fileVersion >= 63) return "hybrid";
  return "original";
}

/** Whether the game reads the Brood War (`x`) settings sections for this file. */
export function isExpansion(scn: Scenario): boolean {
  return scn.fileVersion >= 63;
}

/**
 * Change the file's revision: VER and TYPE, and the string table's width when moving
 * to or from Remastered. Sections of the other revision are left alone — a hybrid map
 * legitimately carries both UNIS and UNIx.
 */
export function setMapVersion(scn: Scenario, version: MapVersion, extendedStrings = version === "remastered") {
  const v = MAP_VERSIONS[version];
  if (scn.fileVersion !== v.ver) { scn.fileVersion = v.ver; markDirty(scn, "VER "); }
  if (scn.type !== v.type) { scn.type = v.type; markDirty(scn, "TYPE"); }
  setExtendedStrings(scn, extendedStrings && version === "remastered");
}

/**
 * Switch the string table between STR (16-bit) and STRx (32-bit). Both names go dirty:
 * the one that no longer applies encodes to null and is dropped on save.
 */
export function setExtendedStrings(scn: Scenario, extended: boolean) {
  if (scn.strings.extended === extended) return;
  scn.strings.extended = extended;
  markDirty(scn, "STR ", "STRx");
}

/**
 * Which of a revision-specific section pair this file needs written: what the game of
 * its revision reads, plus whichever of the two the file already has (a new map's CHK is
 * empty until its first save, so the dirty set counts as "has").
 */
function revisionSections(scn: Scenario, original: string, expansion: string): string[] {
  const has = (name: string) => scn.chk.sections.some((s) => s.name === name) || scn.dirty.has(name);
  const out: string[] = [];
  if (scn.fileVersion < 205 || has(original)) out.push(original);
  if (isExpansion(scn) || has(expansion)) out.push(expansion);
  return out;
}

/** UNIS and/or UNIx. */
export const unitSettingsSections = (scn: Scenario) => revisionSections(scn, "UNIS", "UNIx");
/** UPGS and/or UPGx. */
export const upgradeSettingsSections = (scn: Scenario) => revisionSections(scn, "UPGS", "UPGx");
/** UPGR and/or PUPx. */
export const upgradeRestrictionSections = (scn: Scenario) => revisionSections(scn, "UPGR", "PUPx");
/** TECS and/or TECx. */
export const techSettingsSections = (scn: Scenario) => revisionSections(scn, "TECS", "TECx");
/** PTEC and/or PTEx. */
export const techRestrictionSections = (scn: Scenario) => revisionSections(scn, "PTEC", "PTEx");

/* ── Parsing ─────────────────────────────────────────────── */

export function parseScenario(bytes: Uint8Array): Scenario {
  const chk = parseChk(bytes);
  const warnings: string[] = [];

  for (const s of chk.sections) {
    if (s.truncated) warnings.push(`Section ${s.name.trim()} declares ${s.declaredSize} bytes but the file ends early.`);
  }

  const take = (name: string, dim = { width: 0, height: 0 }) => {
    const spec = specFor(name);
    if (!spec) return null;
    return combine(chk, name, spec.mode, sizeOf(spec, dim));
  };

  // DIM has to come first: the terrain sections' buffer sizes are derived from it.
  const dimData = take("DIM ");
  let width = 0;
  let height = 0;
  if (dimData && dimData.length >= 4) {
    const r = new Reader(dimData);
    width = r.u16();
    height = r.u16();
  } else {
    warnings.push("No usable DIM section; falling back to 64x64.");
    width = 64;
    height = 64;
  }
  const dim = { width, height };

  const typeData = take("TYPE");
  const verData = take("VER ");
  const eraData = take("ERA ");

  // Remastered maps carry STRx; when both are present STRx wins.
  const strxData = take("STRx");
  const strData = take("STR ");
  const strings = strxData
    ? decodeStrings(strxData, true)
    : strData
      ? decodeStrings(strData, false)
      : { strings: [null], extended: false };

  const sprpData = take("SPRP");
  const sprp = sprpData && sprpData.length >= 4 ? new Reader(sprpData) : null;

  const mtxm = take("MTXM", dim);
  const tileData = take("TILE", dim);
  const isomData = take("ISOM", dim);
  const maskData = take("MASK", dim);

  const ownr = take("OWNR");
  const side = take("SIDE");
  const colr = take("COLR");
  const crgb = take("CRGB");
  const forcData = take("FORC");
  const unix = take("UNIx");
  const unis = take("UNIS");
  const puni = take("PUNI");
  const upgx = take("UPGx");
  const upgs = take("UPGS");
  const pupx = take("PUPx");
  const upgr = take("UPGR");
  const tecx = take("TECx");
  const tecs = take("TECS");
  const ptex = take("PTEx");
  const ptec = take("PTEC");
  const wav = take("WAV ");
  const swnm = take("SWNM");

  const scn: Scenario = {
    chk,
    dirty: new Set(),
    warnings,
    type: typeData ? new TextDecoder("latin1").decode(typeData.subarray(0, 4)) : "RAWB",
    fileVersion: verData && verData.length >= 2 ? new Reader(verData).u16() : 205,
    width,
    height,
    era: eraData && eraData.length >= 2 ? new Reader(eraData).u16() : 0,
    strings,
    nameIndex: sprp ? sprp.u16() : 0,
    descriptionIndex: sprp ? sprp.u16() : 0,
    playerTypes: ownr ? decodeBytes(ownr, PLAYER_SLOTS) : Array.from({ length: PLAYER_SLOTS }, () => 0),
    playerRaces: side ? decodeBytes(side, PLAYER_SLOTS) : Array.from({ length: PLAYER_SLOTS }, () => 7),
    playerColors: colr ? decodeBytes(colr, FORCE_SLOTS) : [0, 1, 2, 3, 4, 5, 6, 7],
    playerRgb: crgb ? decodePlayerRgb(crgb) : null,
    forces: forcData ? decodeForces(forcData) : defaultForces(),
    unitSettings: unix ? decodeUnitSettings(unix) : unis ? decodeUnitSettings(unis) : null,
    unitAvailability: puni ? decodeUnitAvailability(puni) : null,
    upgradeSettings: upgx ? decodeUpgradeSettings(upgx) : upgs ? decodeUpgradeSettings(upgs) : null,
    upgradeRestrictions: pupx ? decodeUpgradeRestrictions(pupx) : upgr ? decodeUpgradeRestrictions(upgr) : null,
    techSettings: tecx ? decodeTechSettings(tecx) : tecs ? decodeTechSettings(tecs) : null,
    techRestrictions: ptex ? decodeTechRestrictions(ptex) : ptec ? decodeTechRestrictions(ptec) : null,
    wavs: wav ? decodeWavs(wav) : null,
    tiles: mtxm ? decodeTiles(mtxm, width, height) : new Uint16Array(width * height),
    editorTiles: tileData ? decodeTiles(tileData, width, height) : mtxm ? decodeTiles(mtxm, width, height) : new Uint16Array(width * height),
    isom: isomData ? decodeIsom(isomData, width, height) : null,
    mask: maskData ? decodeMask(maskData, width, height) : null,
    units: decodeUnits(take("UNIT") ?? new Uint8Array(0)),
    sprites: decodeSprites(take("THG2") ?? new Uint8Array(0)),
    doodads: decodeDoodads(take("DD2 ") ?? new Uint8Array(0)),
    locations: decodeLocations(take("MRGN") ?? new Uint8Array(0)),
    triggers: decodeTriggers(take("TRIG") ?? new Uint8Array(0)),
    briefing: decodeTriggers(take("MBRF") ?? new Uint8Array(0)),
    switchNames: swnm ? decodeSwitchNames(swnm) : null,
  };

  return scn;
}

/* ── Serialising ─────────────────────────────────────────── */

/** Encode one modelled section from the live scenario state. */
function encodeSection(scn: Scenario, name: string): Uint8Array | null {
  switch (name) {
    case "DIM ": {
      const out = new Uint8Array(4);
      new DataView(out.buffer).setUint16(0, scn.width, true);
      new DataView(out.buffer).setUint16(2, scn.height, true);
      return out;
    }
    case "ERA ": {
      const out = new Uint8Array(2);
      new DataView(out.buffer).setUint16(0, scn.era, true);
      return out;
    }
    case "VER ": {
      const out = new Uint8Array(2);
      new DataView(out.buffer).setUint16(0, scn.fileVersion, true);
      return out;
    }
    case "TYPE": {
      const out = new Uint8Array(4);
      for (let i = 0; i < 4; i++) out[i] = scn.type.charCodeAt(i) & 0xff;
      return out;
    }
    case "SPRP": {
      const out = new Uint8Array(4);
      const v = new DataView(out.buffer);
      v.setUint16(0, scn.nameIndex, true);
      v.setUint16(2, scn.descriptionIndex, true);
      return out;
    }
    case "STR ":
      return scn.strings.extended ? null : encodeStrings(scn.strings);
    case "STRx":
      return scn.strings.extended ? encodeStrings(scn.strings) : null;
    case "OWNR":
    case "IOWN":
      return encodeBytes(scn.playerTypes, PLAYER_SLOTS);
    case "SIDE":
      return encodeBytes(scn.playerRaces, PLAYER_SLOTS);
    case "COLR":
      return encodeBytes(scn.playerColors, FORCE_SLOTS);
    case "CRGB":
      return scn.playerRgb ? encodePlayerRgb(scn.playerRgb) : null;
    case "FORC":
      return encodeForces(scn.forces);
    case "UNIS":
      return scn.unitSettings ? encodeUnitSettings(scn.unitSettings, WEAPONS_ORIGINAL) : null;
    case "UNIx":
      return scn.unitSettings ? encodeUnitSettings(scn.unitSettings, WEAPONS_BW) : null;
    case "PUNI":
      return scn.unitAvailability ? encodeUnitAvailability(scn.unitAvailability) : null;
    case "UPGS":
      return scn.upgradeSettings ? encodeUpgradeSettings(scn.upgradeSettings, UPGRADES_ORIGINAL) : null;
    case "UPGx":
      return scn.upgradeSettings ? encodeUpgradeSettings(scn.upgradeSettings, UPGRADES_BW) : null;
    case "UPGR":
      return scn.upgradeRestrictions ? encodeUpgradeRestrictions(scn.upgradeRestrictions, UPGRADES_ORIGINAL) : null;
    case "PUPx":
      return scn.upgradeRestrictions ? encodeUpgradeRestrictions(scn.upgradeRestrictions, UPGRADES_BW) : null;
    case "TECS":
      return scn.techSettings ? encodeTechSettings(scn.techSettings, TECHS_ORIGINAL) : null;
    case "TECx":
      return scn.techSettings ? encodeTechSettings(scn.techSettings, TECHS_BW) : null;
    case "PTEC":
      return scn.techRestrictions ? encodeTechRestrictions(scn.techRestrictions, TECHS_ORIGINAL) : null;
    case "PTEx":
      return scn.techRestrictions ? encodeTechRestrictions(scn.techRestrictions, TECHS_BW) : null;
    case "WAV ":
      return scn.wavs ? encodeWavs(scn.wavs) : null;
    case "MTXM":
      return encodeTiles(scn.tiles);
    case "TILE":
      return encodeTiles(scn.editorTiles);
    case "ISOM":
      // A map without ISOM stays without it: an all-zero section would tell other
      // editors the lattice is valid when there is none.
      return scn.isom ? encodeIsom(scn.isom) : null;
    case "MASK":
      return scn.mask ?? null;
    case "UNIT":
      return encodeUnits(scn.units);
    case "THG2":
      return encodeSprites(scn.sprites);
    case "DD2 ":
      return encodeDoodads(scn.doodads);
    case "MRGN":
      return encodeLocations(scn.locations);
    case "TRIG":
      return encodeTriggers(scn.triggers);
    case "MBRF":
      return encodeTriggers(scn.briefing);
    case "SWNM":
      return scn.switchNames ? encodeSwitchNames(scn.switchNames) : null;
    default:
      return null;
  }
}

/**
 * Order used when a dirty section has no existing occurrence to replace. Roughly
 * StarEdit's own write order, which keeps diffs against other editors readable.
 */
const APPEND_ORDER = [
  "TYPE", "VER ", "IVER", "IVE2", "VCOD", "IOWN", "OWNR", "ERA ", "DIM ", "SIDE",
  "MTXM", "PUNI", "UPGR", "PTEC", "UNIT", "ISOM", "TILE", "DD2 ", "THG2", "MASK",
  "STR ", "STRx", "UPRP", "UPUS", "MRGN", "TRIG", "MBRF", "SPRP", "FORC", "WAV ",
  "UNIS", "UPGS", "TECS", "SWNM", "COLR", "PUPx", "PTEx", "UNIx", "UPGx", "TECx", "CRGB",
];

export function serializeScenario(scn: Scenario): Uint8Array {
  if (scn.dirty.size === 0) return serializeChk(scn.chk);

  // For each dirty name, the last occurrence is the one that decides the final value,
  // so that is where the rewritten section goes; earlier occurrences are dropped.
  const lastIndex = new Map<string, number>();
  scn.chk.sections.forEach((s, i) => { if (scn.dirty.has(s.name)) lastIndex.set(s.name, i); });

  const out: ChkSection[] = [];
  scn.chk.sections.forEach((s, i) => {
    if (!scn.dirty.has(s.name)) { out.push(s); return; }
    if (lastIndex.get(s.name) !== i) return;
    const data = encodeSection(scn, s.name);
    if (data) out.push({ ...s, data, declaredSize: data.length, truncated: undefined });
  });

  const missing = [...scn.dirty].filter((n) => !lastIndex.has(n));
  missing.sort((a, b) => {
    const ia = APPEND_ORDER.indexOf(a);
    const ib = APPEND_ORDER.indexOf(b);
    return (ia < 0 ? APPEND_ORDER.length : ia) - (ib < 0 ? APPEND_ORDER.length : ib);
  });
  for (const name of missing) {
    const data = encodeSection(scn, name);
    if (data) out.push({ name, offset: -1, declaredSize: data.length, data });
  }

  return serializeChk({ sections: out, trailing: scn.chk.trailing });
}
