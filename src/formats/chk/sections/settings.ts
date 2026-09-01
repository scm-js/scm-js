/**
 * Unit settings (UNIS / UNIx) and unit availability (PUNI).
 *
 * UNIS is the original layout with 100 weapons, UNIx the Brood War one with 130; the two
 * are otherwise identical, so one model covers both and the encoder trims the weapon
 * columns to whichever section it is writing. Struct-of-arrays, like the dat files the
 * values override.
 */
import { Writer } from "../binary";

export const UNIT_TYPES = 228;
export const PLAYER_SLOTS = 12;
/** Weapon columns in UNIS. */
export const WEAPONS_ORIGINAL = 100;
/** Weapon columns in UNIx. */
export const WEAPONS_BW = 130;

export const UNIS_SIZE = UNIT_TYPES * (1 + 4 + 2 + 1 + 2 + 2 + 2 + 2) + WEAPONS_ORIGINAL * 4; // 4048
export const UNIX_SIZE = UNIT_TYPES * (1 + 4 + 2 + 1 + 2 + 2 + 2 + 2) + WEAPONS_BW * 4; // 4168
export const PUNI_SIZE = UNIT_TYPES * PLAYER_SLOTS * 2 + UNIT_TYPES; // 5700

export interface UnitSettings {
  /** 1 = the game uses units.dat / weapons.dat for this type and ignores the columns below. */
  useDefault: Uint8Array;
  /** Fixed point: hit points × 256, like units.dat. */
  hitPoints: Uint32Array;
  shields: Uint16Array;
  armor: Uint8Array;
  /** Game frames (15 per second at Fastest). */
  buildTime: Uint16Array;
  mineralCost: Uint16Array;
  gasCost: Uint16Array;
  /** String index of the custom name, 0 for the default one. */
  nameIndex: Uint16Array;
  /** Per weapons.dat id, always `WEAPONS_BW` long; UNIS only stores the first 100. */
  weaponDamage: Uint16Array;
  weaponBonus: Uint16Array;
}

export function decodeUnitSettings(data: Uint8Array): UnitSettings {
  const weapons = data.length >= UNIX_SIZE ? WEAPONS_BW : WEAPONS_ORIGINAL;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const n = UNIT_TYPES;
  let at = 0;
  const u8 = (count: number) => { const out = new Uint8Array(count); for (let i = 0; i < count; i++) { out[i] = at < data.length ? data[at] : 0; at++; } return out; };
  const u16 = (count: number) => { const out = new Uint16Array(count); for (let i = 0; i < count; i++) { out[i] = at + 2 <= data.length ? view.getUint16(at, true) : 0; at += 2; } return out; };
  const u32 = (count: number) => { const out = new Uint32Array(count); for (let i = 0; i < count; i++) { out[i] = at + 4 <= data.length ? view.getUint32(at, true) : 0; at += 4; } return out; };
  const s: UnitSettings = {
    useDefault: u8(n),
    hitPoints: u32(n),
    shields: u16(n),
    armor: u8(n),
    buildTime: u16(n),
    mineralCost: u16(n),
    gasCost: u16(n),
    nameIndex: u16(n),
    weaponDamage: new Uint16Array(WEAPONS_BW),
    weaponBonus: new Uint16Array(WEAPONS_BW),
  };
  s.weaponDamage.set(u16(weapons));
  s.weaponBonus.set(u16(weapons));
  return s;
}

export function encodeUnitSettings(s: UnitSettings, weapons: number): Uint8Array {
  const w = new Writer(UNIX_SIZE);
  const n = UNIT_TYPES;
  for (let i = 0; i < n; i++) w.u8(s.useDefault[i] ?? 1);
  for (let i = 0; i < n; i++) w.u32(s.hitPoints[i] ?? 0);
  for (let i = 0; i < n; i++) w.u16(s.shields[i] ?? 0);
  for (let i = 0; i < n; i++) w.u8(s.armor[i] ?? 0);
  for (let i = 0; i < n; i++) w.u16(s.buildTime[i] ?? 0);
  for (let i = 0; i < n; i++) w.u16(s.mineralCost[i] ?? 0);
  for (let i = 0; i < n; i++) w.u16(s.gasCost[i] ?? 0);
  for (let i = 0; i < n; i++) w.u16(s.nameIndex[i] ?? 0);
  for (let i = 0; i < weapons; i++) w.u16(s.weaponDamage[i] ?? 0);
  for (let i = 0; i < weapons; i++) w.u16(s.weaponBonus[i] ?? 0);
  return w.finish();
}

/** Every type on its dat defaults — what a map has before anyone opens Unit Settings. */
export function defaultUnitSettings(): UnitSettings {
  const n = UNIT_TYPES;
  return {
    useDefault: new Uint8Array(n).fill(1),
    hitPoints: new Uint32Array(n),
    shields: new Uint16Array(n),
    armor: new Uint8Array(n),
    buildTime: new Uint16Array(n),
    mineralCost: new Uint16Array(n),
    gasCost: new Uint16Array(n),
    nameIndex: new Uint16Array(n),
    weaponDamage: new Uint16Array(WEAPONS_BW),
    weaponBonus: new Uint16Array(WEAPONS_BW),
  };
}

export function cloneUnitSettings(s: UnitSettings): UnitSettings {
  return {
    useDefault: s.useDefault.slice(), hitPoints: s.hitPoints.slice(), shields: s.shields.slice(), armor: s.armor.slice(),
    buildTime: s.buildTime.slice(), mineralCost: s.mineralCost.slice(), gasCost: s.gasCost.slice(), nameIndex: s.nameIndex.slice(),
    weaponDamage: s.weaponDamage.slice(), weaponBonus: s.weaponBonus.slice(),
  };
}

/* ── PUNI ─────────────────────────────────────────────────── */

/**
 * Which players may build which unit types. Three tables, player-major (`puniIndex`):
 * a per-player answer, the global default, and whether each player defers to it.
 */
export interface UnitAvailability {
  /** 1 = the player can build the type; read only where `playerUsesDefault` is 0. */
  playerAvailable: Uint8Array;
  /** 1 = the type is available to every player that uses the default. */
  defaultAvailable: Uint8Array;
  /** 1 = the player takes `defaultAvailable` for the type. */
  playerUsesDefault: Uint8Array;
}

export function puniIndex(player: number, unitId: number): number {
  return player * UNIT_TYPES + unitId;
}

export function decodeUnitAvailability(data: Uint8Array): UnitAvailability {
  const a = defaultUnitAvailability();
  const per = UNIT_TYPES * PLAYER_SLOTS;
  a.playerAvailable.set(data.subarray(0, per));
  a.defaultAvailable.set(data.subarray(per, per + UNIT_TYPES));
  a.playerUsesDefault.set(data.subarray(per + UNIT_TYPES, per * 2 + UNIT_TYPES));
  return a;
}

export function encodeUnitAvailability(a: UnitAvailability): Uint8Array {
  const out = new Uint8Array(PUNI_SIZE);
  const per = UNIT_TYPES * PLAYER_SLOTS;
  out.set(a.playerAvailable.subarray(0, per), 0);
  out.set(a.defaultAvailable.subarray(0, UNIT_TYPES), per);
  out.set(a.playerUsesDefault.subarray(0, per), per + UNIT_TYPES);
  return out;
}

/** Everything buildable by everyone, every player on the default — StarEdit's starting point. */
export function defaultUnitAvailability(): UnitAvailability {
  const per = UNIT_TYPES * PLAYER_SLOTS;
  return {
    playerAvailable: new Uint8Array(per).fill(1),
    defaultAvailable: new Uint8Array(UNIT_TYPES).fill(1),
    playerUsesDefault: new Uint8Array(per).fill(1),
  };
}

export function cloneUnitAvailability(a: UnitAvailability): UnitAvailability {
  return { playerAvailable: a.playerAvailable.slice(), defaultAvailable: a.defaultAvailable.slice(), playerUsesDefault: a.playerUsesDefault.slice() };
}

/** The effective answer for one player and type: their own byte, or the default they defer to. */
export function isUnitAvailable(a: UnitAvailability, player: number, unitId: number): boolean {
  const i = puniIndex(player, unitId);
  return a.playerUsesDefault[i] ? a.defaultAvailable[unitId] !== 0 : a.playerAvailable[i] !== 0;
}

/* ── UPGS / UPGx: upgrade costs ───────────────────────────── */

/** Upgrades in the original layout (UPGS, UPGR). */
export const UPGRADES_ORIGINAL = 46;
/** Upgrades in the Brood War layout (UPGx, PUPx); also the model's width. */
export const UPGRADES_BW = 61;
export const UPGS_SIZE = UPGRADES_ORIGINAL + UPGRADES_ORIGINAL * 2 * 6; // 598
/** UPGx carries one unused byte after the use-default column. */
export const UPGX_SIZE = UPGRADES_BW + 1 + UPGRADES_BW * 2 * 6; // 794

/**
 * Research cost per upgrade: a base and a per-level factor for minerals, gas and time.
 * Struct of arrays over 61 upgrades; the original sections only store the first 46.
 */
export interface UpgradeSettings {
  /** 1 = the game uses upgrades.dat for this upgrade and ignores the columns below. */
  useDefault: Uint8Array;
  mineralCost: Uint16Array;
  mineralFactor: Uint16Array;
  gasCost: Uint16Array;
  gasFactor: Uint16Array;
  /** Game frames. */
  timeCost: Uint16Array;
  timeFactor: Uint16Array;
}

const UPGRADE_COLUMNS = ["mineralCost", "mineralFactor", "gasCost", "gasFactor", "timeCost", "timeFactor"] as const;

/** Sequential column reader tolerant of short sections (missing bytes read as 0). */
class Columns {
  private at = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) { this.data = data; }
  u8(count: number, into: Uint8Array = new Uint8Array(count)): Uint8Array {
    for (let i = 0; i < count; i++) into[i] = this.data[this.at + i] ?? 0;
    this.at += count;
    return into;
  }
  u16(count: number, into: Uint16Array = new Uint16Array(count)): Uint16Array {
    for (let i = 0; i < count; i++) {
      const o = this.at + i * 2;
      into[i] = o + 1 < this.data.length ? this.data[o] | (this.data[o + 1] << 8) : 0;
    }
    this.at += count * 2;
    return into;
  }
  skip(bytes: number) { this.at += bytes; }
}

export function decodeUpgradeSettings(data: Uint8Array): UpgradeSettings {
  const count = data.length >= UPGX_SIZE ? UPGRADES_BW : UPGRADES_ORIGINAL;
  const s = defaultUpgradeSettings();
  const c = new Columns(data);
  c.u8(count, s.useDefault);
  if (count === UPGRADES_BW) c.skip(1);
  for (const col of UPGRADE_COLUMNS) c.u16(count, s[col]);
  return s;
}

export function encodeUpgradeSettings(s: UpgradeSettings, count: number): Uint8Array {
  const w = new Writer(UPGX_SIZE);
  for (let i = 0; i < count; i++) w.u8(s.useDefault[i] ?? 1);
  if (count === UPGRADES_BW) w.u8(0);
  for (const col of UPGRADE_COLUMNS) for (let i = 0; i < count; i++) w.u16(s[col][i] ?? 0);
  return w.finish();
}

/** Every upgrade on its upgrades.dat costs. */
export function defaultUpgradeSettings(): UpgradeSettings {
  const n = UPGRADES_BW;
  return {
    useDefault: new Uint8Array(n).fill(1),
    mineralCost: new Uint16Array(n), mineralFactor: new Uint16Array(n),
    gasCost: new Uint16Array(n), gasFactor: new Uint16Array(n),
    timeCost: new Uint16Array(n), timeFactor: new Uint16Array(n),
  };
}

export function cloneUpgradeSettings(s: UpgradeSettings): UpgradeSettings {
  return {
    useDefault: s.useDefault.slice(), mineralCost: s.mineralCost.slice(), mineralFactor: s.mineralFactor.slice(),
    gasCost: s.gasCost.slice(), gasFactor: s.gasFactor.slice(), timeCost: s.timeCost.slice(), timeFactor: s.timeFactor.slice(),
  };
}

/* ── UPGR / PUPx: upgrade levels per player ──────────────── */

export const UPGR_SIZE = UPGRADES_ORIGINAL * PLAYER_SLOTS * 3 + UPGRADES_ORIGINAL * 2; // 1748
export const PUPX_SIZE = UPGRADES_BW * PLAYER_SLOTS * 3 + UPGRADES_BW * 2; // 2318

/**
 * How far each player may research each upgrade and where they start. Player-major
 * tables (`upgradeIndex`), a global default pair, and a per-player "use the default" flag.
 */
export interface UpgradeRestrictions {
  playerMax: Uint8Array;
  playerStart: Uint8Array;
  defaultMax: Uint8Array;
  defaultStart: Uint8Array;
  playerUsesDefault: Uint8Array;
}

export function upgradeIndex(player: number, upgradeId: number): number {
  return player * UPGRADES_BW + upgradeId;
}

/**
 * upgrades.dat's `maxRepeats` per id — the level cap StarEdit writes for a fresh map: 3 for
 * the sixteen armour / weapon lines, 1 for single-shot upgrades, 0 for the unused slots.
 */
export const DEFAULT_UPGRADE_MAX: readonly number[] = [
  3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0,
];

/** Read a player-major table stored with `count` entries per player into the model's 61-wide rows. */
function readPerPlayer(c: Columns, count: number, into: Uint8Array, stride: number) {
  for (let p = 0; p < PLAYER_SLOTS; p++) c.u8(count, into.subarray(p * stride, p * stride + count));
}

function writePerPlayer(w: Writer, from: Uint8Array, count: number, stride: number) {
  for (let p = 0; p < PLAYER_SLOTS; p++) for (let i = 0; i < count; i++) w.u8(from[p * stride + i] ?? 0);
}

export function decodeUpgradeRestrictions(data: Uint8Array): UpgradeRestrictions {
  const count = data.length >= PUPX_SIZE ? UPGRADES_BW : UPGRADES_ORIGINAL;
  const r = defaultUpgradeRestrictions();
  const c = new Columns(data);
  readPerPlayer(c, count, r.playerMax, UPGRADES_BW);
  readPerPlayer(c, count, r.playerStart, UPGRADES_BW);
  c.u8(count, r.defaultMax);
  c.u8(count, r.defaultStart);
  readPerPlayer(c, count, r.playerUsesDefault, UPGRADES_BW);
  return r;
}

export function encodeUpgradeRestrictions(r: UpgradeRestrictions, count: number): Uint8Array {
  const w = new Writer(PUPX_SIZE);
  writePerPlayer(w, r.playerMax, count, UPGRADES_BW);
  writePerPlayer(w, r.playerStart, count, UPGRADES_BW);
  for (let i = 0; i < count; i++) w.u8(r.defaultMax[i] ?? 0);
  for (let i = 0; i < count; i++) w.u8(r.defaultStart[i] ?? 0);
  writePerPlayer(w, r.playerUsesDefault, count, UPGRADES_BW);
  return w.finish();
}

/** Every player on the default, which caps each upgrade at its upgrades.dat level and starts it at 0. */
export function defaultUpgradeRestrictions(): UpgradeRestrictions {
  const n = UPGRADES_BW;
  const per = n * PLAYER_SLOTS;
  const max = Uint8Array.from(DEFAULT_UPGRADE_MAX);
  const playerMax = new Uint8Array(per);
  for (let p = 0; p < PLAYER_SLOTS; p++) playerMax.set(max, p * n);
  return { playerMax, playerStart: new Uint8Array(per), defaultMax: max, defaultStart: new Uint8Array(n), playerUsesDefault: new Uint8Array(per).fill(1) };
}

export function cloneUpgradeRestrictions(r: UpgradeRestrictions): UpgradeRestrictions {
  return { playerMax: r.playerMax.slice(), playerStart: r.playerStart.slice(), defaultMax: r.defaultMax.slice(), defaultStart: r.defaultStart.slice(), playerUsesDefault: r.playerUsesDefault.slice() };
}

/** The effective { start, max } levels for one player and upgrade. */
export function upgradeLevels(r: UpgradeRestrictions, player: number, upgradeId: number): { start: number; max: number } {
  const i = upgradeIndex(player, upgradeId);
  return r.playerUsesDefault[i]
    ? { start: r.defaultStart[upgradeId], max: r.defaultMax[upgradeId] }
    : { start: r.playerStart[i], max: r.playerMax[i] };
}

/* ── TECS / TECx: technology costs ───────────────────────── */

export const TECHS_ORIGINAL = 24;
export const TECHS_BW = 44;
export const TECS_SIZE = TECHS_ORIGINAL + TECHS_ORIGINAL * 2 * 4; // 216
export const TECX_SIZE = TECHS_BW + TECHS_BW * 2 * 4; // 396

export interface TechSettings {
  /** 1 = the game uses techdata.dat for this ability. */
  useDefault: Uint8Array;
  mineralCost: Uint16Array;
  gasCost: Uint16Array;
  /** Game frames. */
  researchTime: Uint16Array;
  energyCost: Uint16Array;
}

const TECH_COLUMNS = ["mineralCost", "gasCost", "researchTime", "energyCost"] as const;

export function decodeTechSettings(data: Uint8Array): TechSettings {
  const count = data.length >= TECX_SIZE ? TECHS_BW : TECHS_ORIGINAL;
  const s = defaultTechSettings();
  const c = new Columns(data);
  c.u8(count, s.useDefault);
  for (const col of TECH_COLUMNS) c.u16(count, s[col]);
  return s;
}

export function encodeTechSettings(s: TechSettings, count: number): Uint8Array {
  const w = new Writer(TECX_SIZE);
  for (let i = 0; i < count; i++) w.u8(s.useDefault[i] ?? 1);
  for (const col of TECH_COLUMNS) for (let i = 0; i < count; i++) w.u16(s[col][i] ?? 0);
  return w.finish();
}

export function defaultTechSettings(): TechSettings {
  const n = TECHS_BW;
  return { useDefault: new Uint8Array(n).fill(1), mineralCost: new Uint16Array(n), gasCost: new Uint16Array(n), researchTime: new Uint16Array(n), energyCost: new Uint16Array(n) };
}

export function cloneTechSettings(s: TechSettings): TechSettings {
  return { useDefault: s.useDefault.slice(), mineralCost: s.mineralCost.slice(), gasCost: s.gasCost.slice(), researchTime: s.researchTime.slice(), energyCost: s.energyCost.slice() };
}

/* ── PTEC / PTEx: technology availability per player ─────── */

export const PTEC_SIZE = TECHS_ORIGINAL * PLAYER_SLOTS * 3 + TECHS_ORIGINAL * 2; // 912
export const PTEX_SIZE = TECHS_BW * PLAYER_SLOTS * 3 + TECHS_BW * 2; // 1672

/** Whether each player may research each ability and whether they start with it. Same shape as `UpgradeRestrictions`. */
export interface TechRestrictions {
  playerAvailable: Uint8Array;
  playerResearched: Uint8Array;
  defaultAvailable: Uint8Array;
  defaultResearched: Uint8Array;
  playerUsesDefault: Uint8Array;
}

export function techIndex(player: number, techId: number): number {
  return player * TECHS_BW + techId;
}

export function decodeTechRestrictions(data: Uint8Array): TechRestrictions {
  const count = data.length >= PTEX_SIZE ? TECHS_BW : TECHS_ORIGINAL;
  const r = defaultTechRestrictions();
  const c = new Columns(data);
  readPerPlayer(c, count, r.playerAvailable, TECHS_BW);
  readPerPlayer(c, count, r.playerResearched, TECHS_BW);
  c.u8(count, r.defaultAvailable);
  c.u8(count, r.defaultResearched);
  readPerPlayer(c, count, r.playerUsesDefault, TECHS_BW);
  return r;
}

export function encodeTechRestrictions(r: TechRestrictions, count: number): Uint8Array {
  const w = new Writer(PTEX_SIZE);
  writePerPlayer(w, r.playerAvailable, count, TECHS_BW);
  writePerPlayer(w, r.playerResearched, count, TECHS_BW);
  for (let i = 0; i < count; i++) w.u8(r.defaultAvailable[i] ?? 0);
  for (let i = 0; i < count; i++) w.u8(r.defaultResearched[i] ?? 0);
  writePerPlayer(w, r.playerUsesDefault, count, TECHS_BW);
  return w.finish();
}

/** Everything researchable by everyone, nothing pre-researched, every player on the default. */
export function defaultTechRestrictions(): TechRestrictions {
  const n = TECHS_BW;
  const per = n * PLAYER_SLOTS;
  return { playerAvailable: new Uint8Array(per).fill(1), playerResearched: new Uint8Array(per), defaultAvailable: new Uint8Array(n).fill(1), defaultResearched: new Uint8Array(n), playerUsesDefault: new Uint8Array(per).fill(1) };
}

export function cloneTechRestrictions(r: TechRestrictions): TechRestrictions {
  return { playerAvailable: r.playerAvailable.slice(), playerResearched: r.playerResearched.slice(), defaultAvailable: r.defaultAvailable.slice(), defaultResearched: r.defaultResearched.slice(), playerUsesDefault: r.playerUsesDefault.slice() };
}

/** The effective { available, researched } answer for one player and ability. */
export function techState(r: TechRestrictions, player: number, techId: number): { available: boolean; researched: boolean } {
  const i = techIndex(player, techId);
  return r.playerUsesDefault[i]
    ? { available: r.defaultAvailable[techId] !== 0, researched: r.defaultResearched[techId] !== 0 }
    : { available: r.playerAvailable[i] !== 0, researched: r.playerResearched[i] !== 0 };
}
