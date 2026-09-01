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
