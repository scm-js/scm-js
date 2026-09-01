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
  decodeBytes, decodeForces, encodeBytes, encodeForces, defaultForces,
  FORCE_SLOTS, PLAYER_SLOTS, type Forces,
} from "./sections/players";
import {
  decodeIsom, decodeMask, decodeTiles, encodeIsom, encodeTiles, isomSize,
} from "./sections/terrain";

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
  /** VER: 59 original, 63 hybrid, 205 Brood War. */
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
  forces: Forces;

  tiles: Uint16Array;
  isom: Uint16Array | null;
  mask: Uint8Array | null;

  units: UnitRecord[];
  sprites: SpriteRecord[];
  doodads: DoodadRecord[];
  locations: LocationRecord[];
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

function strSectionName(scn: Scenario): string {
  return scn.strings.extended ? "STRx" : "STR ";
}

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
  const isomData = take("ISOM", dim);
  const maskData = take("MASK", dim);

  const ownr = take("OWNR");
  const side = take("SIDE");
  const colr = take("COLR");
  const forcData = take("FORC");

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
    forces: forcData ? decodeForces(forcData) : defaultForces(),
    tiles: mtxm ? decodeTiles(mtxm, width, height) : new Uint16Array(width * height),
    isom: isomData ? decodeIsom(isomData, width, height) : null,
    mask: maskData ? decodeMask(maskData, width, height) : null,
    units: decodeUnits(take("UNIT") ?? new Uint8Array(0)),
    sprites: decodeSprites(take("THG2") ?? new Uint8Array(0)),
    doodads: decodeDoodads(take("DD2 ") ?? new Uint8Array(0)),
    locations: decodeLocations(take("MRGN") ?? new Uint8Array(0)),
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
    case "FORC":
      return encodeForces(scn.forces);
    case "MTXM":
    case "TILE":
      return encodeTiles(scn.tiles);
    case "ISOM":
      return scn.isom ? encodeIsom(scn.isom) : new Uint8Array(isomSize(scn.width, scn.height));
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
  "UNIS", "UPGS", "TECS", "SWNM", "COLR", "PUPx", "PTEx", "UNIx", "UPGx", "TECx",
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
