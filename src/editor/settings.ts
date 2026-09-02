/**
 * Scenario-wide settings the dialogs edit: players, forces, colours and unit settings.
 *
 * These are not part of the undo model — each dialog is its own transaction (OK / Apply
 * / Cancel), as in StarEdit. Every writer here marks the sections it touches dirty and
 * the caller bumps `settingsRevisionAtom` (`commitSettingsAtom`) so the chrome re-reads.
 */
import {
  MAP_VERSIONS, mapVersionOf, markDirty, setMapVersion, strSectionName, techRestrictionSections, techSettingsSections, unitSettingsSections, upgradeRestrictionSections, upgradeSettingsSections,
  type MapVersion, type Scenario,
} from "../formats/chk/scenario";
import { ColorMode, FORCE_SLOTS, ForceFlag, PLAYER_SLOTS, type Forces, type PlayerRgb } from "../formats/chk/sections/players";
import { getString, findString, setString } from "../formats/chk/sections/strings";
import {
  cloneTechRestrictions, cloneTechSettings, cloneUnitAvailability, cloneUnitSettings, cloneUpgradeRestrictions, cloneUpgradeSettings,
  defaultTechRestrictions, defaultTechSettings, defaultUnitAvailability, defaultUnitSettings, defaultUpgradeRestrictions, defaultUpgradeSettings,
  puniIndex, techIndex, TECHS_BW, UNIT_TYPES, UPGRADES_BW, upgradeIndex, WEAPONS_BW,
  type TechRestrictions, type TechSettings, type UnitAvailability, type UnitSettings, type UpgradeRestrictions, type UpgradeSettings,
} from "../formats/chk/sections/settings";
import { NO_UNIT, NO_WEAPON, type TechdataDat, type UnitsDat, type UpgradesDat, type WeaponsDat } from "../formats/dat/dat";
import { displayColorHex, playerRaceLabel, playerTypeLabel } from "../data/players";
import { techName, unitName, upgradeName } from "../data/units";
import { weaponName } from "../data/weapons";

/* ── Strings ─────────────────────────────────────────────── */

/**
 * The index of `text` in the string table: an existing identical entry, else a new one
 * at the end. Never overwrites, since the old index may be shared with a trigger or
 * location. Returns 0 for the empty string ("no name").
 */
export function internString(scn: Scenario, text: string): number {
  if (text === "") return 0;
  const existing = findString(scn.strings, text);
  if (existing > 0) return existing;
  const index = setString(scn.strings, 0, text);
  markDirty(scn, strSectionName(scn));
  return index;
}

/* ── Players ─────────────────────────────────────────────── */

export interface PlayerSettings {
  /** OWNR bytes (`PlayerType`), 12 slots. */
  types: number[];
  /** SIDE bytes (`PlayerRace`), 12 slots. */
  races: number[];
  /** COLR bytes, 8 slots. */
  colors: number[];
  /** FORC force index, 8 slots. */
  force: number[];
}

export function readPlayerSettings(scn: Scenario): PlayerSettings {
  return {
    types: scn.playerTypes.slice(0, PLAYER_SLOTS),
    races: scn.playerRaces.slice(0, PLAYER_SLOTS),
    colors: scn.playerColors.slice(0, FORCE_SLOTS),
    force: scn.forces.playerForce.slice(0, FORCE_SLOTS),
  };
}

/** Write the four player tables back, marking only the sections that changed. OWNR and IOWN always agree. */
export function applyPlayerSettings(scn: Scenario, next: PlayerSettings) {
  const differs = (a: number[], b: number[]) => a.length !== b.length || a.some((v, i) => v !== b[i]);
  if (differs(scn.playerTypes, next.types)) { scn.playerTypes = next.types.slice(); markDirty(scn, "OWNR", "IOWN"); }
  if (differs(scn.playerRaces, next.races)) { scn.playerRaces = next.races.slice(); markDirty(scn, "SIDE"); }
  if (differs(scn.playerColors, next.colors)) { scn.playerColors = next.colors.slice(); markDirty(scn, "COLR"); }
  if (differs(scn.forces.playerForce, next.force)) { scn.forces.playerForce = next.force.slice(); markDirty(scn, "FORC"); }
}

/* ── Colours ─────────────────────────────────────────────── */

/** COLR plus, when present, CRGB. A null `rgb` leaves the file without a CRGB section. */
export function applyPlayerColors(scn: Scenario, colors: number[], rgb: PlayerRgb | null) {
  if (colors.some((v, i) => v !== scn.playerColors[i])) { scn.playerColors = colors.slice(); markDirty(scn, "COLR"); }
  const same = rgb === null
    ? scn.playerRgb === null
    : scn.playerRgb !== null && rgb.mode.every((m, i) => m === scn.playerRgb!.mode[i]) && rgb.rgb.every((c, i) => c.every((v, j) => v === scn.playerRgb!.rgb[i][j]));
  if (!same) {
    scn.playerRgb = rgb ? { rgb: rgb.rgb.map((c) => [...c] as [number, number, number]), mode: rgb.mode.slice() } : null;
    markDirty(scn, "CRGB");
  }
}

/* ── Forces ──────────────────────────────────────────────── */

export interface ForceSettings {
  /** Force index of each of the 8 playable slots. */
  playerForce: number[];
  /** The four names as text ("" for none). */
  names: string[];
  /** `ForceFlag` bits per force. */
  flags: number[];
}

export function forceName(scn: Scenario, force: number): string {
  return getString(scn.strings, scn.forces.nameIndex[force] ?? 0) ?? "";
}

export function readForceSettings(scn: Scenario): ForceSettings {
  return {
    playerForce: scn.forces.playerForce.slice(0, FORCE_SLOTS),
    names: [0, 1, 2, 3].map((f) => forceName(scn, f)),
    flags: scn.forces.flags.slice(0, 4),
  };
}

export function applyForceSettings(scn: Scenario, next: ForceSettings) {
  const forces: Forces = scn.forces;
  let changed = false;
  next.playerForce.forEach((f, i) => { if (forces.playerForce[i] !== f) { forces.playerForce[i] = f; changed = true; } });
  next.flags.forEach((v, i) => { if (forces.flags[i] !== v) { forces.flags[i] = v; changed = true; } });
  next.names.forEach((name, i) => {
    if (name === forceName(scn, i)) return;
    forces.nameIndex[i] = internString(scn, name);
    changed = true;
  });
  if (changed) markDirty(scn, "FORC");
}

/* ── Unit settings ───────────────────────────────────────── */

/** A working copy of both unit tables, created on defaults when the file has none. */
export function readUnitSettings(scn: Scenario): { settings: UnitSettings; availability: UnitAvailability } {
  return {
    settings: scn.unitSettings ? cloneUnitSettings(scn.unitSettings) : defaultUnitSettings(),
    availability: scn.unitAvailability ? cloneUnitAvailability(scn.unitAvailability) : defaultUnitAvailability(),
  };
}

/**
 * Install edited copies. `names` maps a unit id to the custom name text the user typed
 * (the string is interned here, so the copy's `nameIndex` for those ids is overwritten).
 * Which of UNIS / UNIx gets written follows the file's revision (`unitSettingsSections`).
 */
export function applyUnitSettings(scn: Scenario, settings: UnitSettings, availability: UnitAvailability, names: Map<number, string>) {
  for (const [id, text] of names) settings.nameIndex[id] = internString(scn, text);
  scn.unitSettings = settings;
  scn.unitAvailability = availability;
  markDirty(scn, "PUNI", ...unitSettingsSections(scn));
}

export function unitCustomName(scn: Scenario, unitId: number): string {
  return getString(scn.strings, scn.unitSettings?.nameIndex[unitId] ?? 0) ?? "";
}

/* ── Upgrade settings ────────────────────────────────────── */

/** A working copy of UPGS/UPGx and UPGR/PUPx, on defaults when the file has none. */
export function readUpgradeSettings(scn: Scenario): { settings: UpgradeSettings; restrictions: UpgradeRestrictions } {
  return {
    settings: scn.upgradeSettings ? cloneUpgradeSettings(scn.upgradeSettings) : defaultUpgradeSettings(),
    restrictions: scn.upgradeRestrictions ? cloneUpgradeRestrictions(scn.upgradeRestrictions) : defaultUpgradeRestrictions(),
  };
}

/** Install edited copies; which of UPGS / UPGx and UPGR / PUPx get written follows the file's revision. */
export function applyUpgradeSettings(scn: Scenario, settings: UpgradeSettings, restrictions: UpgradeRestrictions) {
  scn.upgradeSettings = settings;
  scn.upgradeRestrictions = restrictions;
  markDirty(scn, ...upgradeSettingsSections(scn), ...upgradeRestrictionSections(scn));
}

/* ── Technology settings ─────────────────────────────────── */

export function readTechSettings(scn: Scenario): { settings: TechSettings; restrictions: TechRestrictions } {
  return {
    settings: scn.techSettings ? cloneTechSettings(scn.techSettings) : defaultTechSettings(),
    restrictions: scn.techRestrictions ? cloneTechRestrictions(scn.techRestrictions) : defaultTechRestrictions(),
  };
}

export function applyTechSettings(scn: Scenario, settings: TechSettings, restrictions: TechRestrictions) {
  scn.techSettings = settings;
  scn.techRestrictions = restrictions;
  markDirty(scn, ...techSettingsSections(scn), ...techRestrictionSections(scn));
}

/* ── Views and patches ───────────────────────────────────── */
/*
 * The shapes the plugin API's `api.settings` (reads) and `document.update`'s `tx.players`,
 * `tx.forces`, `tx.unitTypes`, `tx.upgrades`, `tx.techs` and `tx.setVersion` (writes) use:
 * one record per slot / force / type with the game's *effective* numbers filled in — the
 * dat defaults where a row is on "use default" — and a patch per record that marks only
 * what changed. Hit points are whole points here (the section stores them × 256).
 */

export interface PlayerSlotView {
  /** 0-based; the chrome shows it as `slot + 1`. */
  slot: number;
  type: number;
  typeName: string;
  race: number;
  raceName: string;
  /** COLR index; null for the four unplayable slots. */
  color: number | null;
  /** The colour the chrome shows for the slot (CRGB-aware). */
  colorHex: string | null;
  /** The CRGB custom triple when one is in effect. */
  rgb: [number, number, number] | null;
  /** 0-based force; null for the unplayable slots. */
  force: number | null;
  forceName: string | null;
}

export function playerSlotViews(scn: Scenario): PlayerSlotView[] {
  const out: PlayerSlotView[] = [];
  for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
    const playable = slot < FORCE_SLOTS;
    const custom = scn.playerRgb && scn.playerRgb.mode[slot] === ColorMode.Custom ? scn.playerRgb.rgb[slot] : null;
    out.push({
      slot,
      type: scn.playerTypes[slot] ?? 0,
      typeName: playerTypeLabel(scn.playerTypes[slot] ?? 0),
      race: scn.playerRaces[slot] ?? 0,
      raceName: playerRaceLabel(scn.playerRaces[slot] ?? 0),
      color: playable ? scn.playerColors[slot] ?? 0 : null,
      colorHex: playable ? displayColorHex(scn.playerColors, scn.playerRgb, slot) : null,
      rgb: custom ? [custom[0], custom[1], custom[2]] : null,
      force: playable ? scn.forces.playerForce[slot] ?? 0 : null,
      forceName: playable ? forceName(scn, scn.forces.playerForce[slot] ?? 0) : null,
    });
  }
  return out;
}

export interface PlayerPatch {
  type?: number;
  race?: number;
  /** COLR index 0–15 (playable slots). */
  color?: number;
  /** A CRGB custom colour, or null to go back to the palette colour (playable slots). */
  rgb?: [number, number, number] | null;
  /** 0-based force (playable slots). */
  force?: number;
}

/** Apply a patch to one slot; the sections that changed (empty when nothing did). Colours go through `applyPlayerColors`. */
export function patchPlayer(scn: Scenario, slot: number, patch: PlayerPatch): string[] {
  const sections: string[] = [];
  if (slot < 0 || slot >= PLAYER_SLOTS) return sections;
  const next = readPlayerSettings(scn);
  if (patch.type !== undefined && patch.type !== next.types[slot]) { next.types[slot] = patch.type & 0xff; sections.push("OWNR", "IOWN"); }
  if (patch.race !== undefined && patch.race !== next.races[slot]) { next.races[slot] = patch.race & 0xff; sections.push("SIDE"); }
  if (slot < FORCE_SLOTS) {
    if (patch.color !== undefined && patch.color !== next.colors[slot]) { next.colors[slot] = Math.max(0, Math.min(255, patch.color | 0)); sections.push("COLR"); }
    if (patch.force !== undefined && patch.force !== next.force[slot]) { next.force[slot] = Math.max(0, Math.min(3, patch.force | 0)); sections.push("FORC"); }
  }
  if (sections.length > 0) applyPlayerSettings(scn, next);
  if (patch.rgb !== undefined && slot < FORCE_SLOTS) {
    const rgb: PlayerRgb = scn.playerRgb
      ? { rgb: scn.playerRgb.rgb.map((c) => [...c] as [number, number, number]), mode: scn.playerRgb.mode.slice() }
      : { rgb: Array.from({ length: FORCE_SLOTS }, () => [0, 0, 0] as [number, number, number]), mode: Array.from({ length: FORCE_SLOTS }, () => ColorMode.Palette as number) };
    if (patch.rgb === null) rgb.mode[slot] = ColorMode.Palette;
    else { rgb.mode[slot] = ColorMode.Custom; rgb.rgb[slot] = [patch.rgb[0] & 0xff, patch.rgb[1] & 0xff, patch.rgb[2] & 0xff]; }
    const allPalette = rgb.mode.every((m) => m === ColorMode.Palette);
    const before = JSON.stringify(scn.playerRgb);
    applyPlayerColors(scn, scn.playerColors, allPalette ? null : rgb);
    if (JSON.stringify(scn.playerRgb) !== before) sections.push("CRGB");
  }
  return sections;
}

export interface ForceView {
  /** 0-based. */
  force: number;
  name: string;
  flags: number;
  allied: boolean;
  alliedVictory: boolean;
  sharedVision: boolean;
  randomStart: boolean;
  /** 0-based playable slots in the force. */
  players: number[];
}

export function forceViews(scn: Scenario): ForceView[] {
  return [0, 1, 2, 3].map((force) => {
    const flags = scn.forces.flags[force] ?? 0;
    return {
      force,
      name: forceName(scn, force),
      flags,
      allied: (flags & ForceFlag.Allied) !== 0,
      alliedVictory: (flags & ForceFlag.AlliedVictory) !== 0,
      sharedVision: (flags & ForceFlag.SharedVision) !== 0,
      randomStart: (flags & ForceFlag.RandomStart) !== 0,
      players: scn.forces.playerForce.slice(0, FORCE_SLOTS).map((f, slot) => (f === force ? slot : -1)).filter((s) => s >= 0),
    };
  });
}

export interface ForcePatch {
  name?: string;
  allied?: boolean;
  alliedVictory?: boolean;
  sharedVision?: boolean;
  randomStart?: boolean;
  /** The whole flag word, applied before the booleans. */
  flags?: number;
  /** 0-based playable slots the force should contain (others keep theirs); moves them from their forces. */
  players?: number[];
}

/** The sections that changed: `FORC`, plus the string table when a name was interned. */
export function patchForce(scn: Scenario, force: number, patch: ForcePatch): string[] {
  if (force < 0 || force > 3) return [];
  const current = readForceSettings(scn);
  const next: ForceSettings = { playerForce: current.playerForce.slice(), names: current.names.slice(), flags: current.flags.slice() };
  let flags = patch.flags ?? next.flags[force];
  const bit = (mask: number, on: boolean | undefined) => { if (on !== undefined) flags = on ? flags | mask : flags & ~mask; };
  bit(ForceFlag.Allied, patch.allied);
  bit(ForceFlag.AlliedVictory, patch.alliedVictory);
  bit(ForceFlag.SharedVision, patch.sharedVision);
  bit(ForceFlag.RandomStart, patch.randomStart);
  next.flags[force] = flags & 0xff;
  if (patch.name !== undefined) next.names[force] = patch.name;
  if (patch.players) for (const slot of patch.players) if (slot >= 0 && slot < FORCE_SLOTS) next.playerForce[slot] = force;
  if (JSON.stringify(current) === JSON.stringify(next)) return [];
  const strings = scn.strings.strings.length;
  applyForceSettings(scn, next);
  return scn.strings.strings.length !== strings ? ["FORC", strSectionName(scn)] : ["FORC"];
}

/* ── Unit types ──────────────────────────────────────────── */

export interface WeaponView {
  id: number;
  name: string;
  damage: number;
  bonus: number;
}

export interface UnitTypeView {
  id: number;
  /** The game's name (or the custom one when the map sets it). */
  name: string;
  /** The custom name the map sets, `""` for the default. */
  customName: string;
  useDefault: boolean;
  /** Whole hit points. */
  hitPoints: number;
  shields: number;
  armor: number;
  /** Game frames. */
  buildTime: number;
  mineralCost: number;
  gasCost: number;
  /** The type's ground and air weapons (a turreted vehicle's are its turret's), with the effective damage. */
  weapons: WeaponView[];
  /** units.dat / weapons.dat, null without the game data. */
  defaults: { hitPoints: number; shields: number; armor: number; buildTime: number; mineralCost: number; gasCost: number; weapons: WeaponView[] } | null;
  /** PUNI: whether the type can be built by default, and per player (`"default"` where the player follows the default). */
  availability: { defaultAvailable: boolean; players: (boolean | "default")[] };
}

/** The weapon ids a type fights with, StarEdit's way (the turret's for a turreted vehicle). */
export function unitWeaponIds(dat: UnitsDat | null, unitId: number): number[] {
  if (!dat || unitId < 0 || unitId >= UNIT_TYPES) return [];
  const turret = dat.groundWeapon[unitId] === NO_WEAPON && dat.airWeapon[unitId] === NO_WEAPON && dat.subunit[unitId] < NO_UNIT ? dat.subunit[unitId] : -1;
  const armed = turret >= 0 ? turret : unitId;
  const ids = [dat.groundWeapon[armed], dat.airWeapon[armed]].filter((w) => w < NO_WEAPON);
  return ids.filter((w, i) => ids.indexOf(w) === i);
}

export function unitTypeView(scn: Scenario, unitId: number, dat: UnitsDat | null, weapons: WeaponsDat | null): UnitTypeView {
  const s = scn.unitSettings;
  const useDefault = !s || s.useDefault[unitId] !== 0;
  const ids = unitWeaponIds(dat, unitId);
  const defaults = dat ? {
    hitPoints: Math.floor(dat.hitPoints[unitId] / 256),
    shields: dat.shieldEnable[unitId] ? dat.shieldAmount[unitId] : 0,
    armor: dat.armor[unitId],
    buildTime: dat.buildTime[unitId],
    mineralCost: dat.mineralCost[unitId],
    gasCost: dat.vespeneCost[unitId],
    weapons: ids.map((id) => ({ id, name: weaponName(id), damage: weapons ? weapons.damage[id] : 0, bonus: weapons ? weapons.bonus[id] : 0 })),
  } : null;
  const stored = s ? {
    hitPoints: Math.floor(s.hitPoints[unitId] / 256), shields: s.shields[unitId], armor: s.armor[unitId], buildTime: s.buildTime[unitId], mineralCost: s.mineralCost[unitId], gasCost: s.gasCost[unitId],
    weapons: ids.map((id) => ({ id, name: weaponName(id), damage: s.weaponDamage[id] ?? 0, bonus: s.weaponBonus[id] ?? 0 })),
  } : null;
  const effective = (useDefault ? defaults : stored) ?? stored ?? defaults ?? { hitPoints: 0, shields: 0, armor: 0, buildTime: 0, mineralCost: 0, gasCost: 0, weapons: ids.map((id) => ({ id, name: weaponName(id), damage: 0, bonus: 0 })) };
  const a = scn.unitAvailability;
  return {
    id: unitId,
    name: unitCustomName(scn, unitId) || unitName(unitId),
    customName: unitCustomName(scn, unitId),
    useDefault,
    ...effective,
    defaults,
    availability: {
      defaultAvailable: !a || a.defaultAvailable[unitId] !== 0,
      players: Array.from({ length: PLAYER_SLOTS }, (_, p) => (!a || a.playerUsesDefault[puniIndex(p, unitId)] !== 0 ? "default" : a.playerAvailable[puniIndex(p, unitId)] !== 0)),
    },
  };
}

export interface UnitTypePatch {
  /** Explicitly back to (or off) the dat defaults; setting any number below turns it off. */
  useDefault?: boolean;
  /** Custom name; `""` restores the default. */
  name?: string;
  hitPoints?: number;
  shields?: number;
  armor?: number;
  buildTime?: number;
  mineralCost?: number;
  gasCost?: number;
  weapons?: { id: number; damage?: number; bonus?: number }[];
  /** PUNI: `player` 0-based or `"default"` (the default column); `value` true / false, or `"default"` to follow the default column again. */
  available?: { player: number | "default"; value: boolean | "default" }[];
}

const clampU8 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const clampU16 = (v: number) => Math.max(0, Math.min(65535, Math.round(v)));

/** Apply a patch to one unit type; which of `settings` / `availability` changed. Turning the defaults off seeds an untouched row from the dat, as the dialog does. */
export function patchUnitType(scn: Scenario, unitId: number, patch: UnitTypePatch, dat: UnitsDat | null, weaponsDat: WeaponsDat | null): string[] {
  const out: string[] = [];
  if (unitId < 0 || unitId >= UNIT_TYPES) return out;
  const numeric = patch.hitPoints !== undefined || patch.shields !== undefined || patch.armor !== undefined || patch.buildTime !== undefined || patch.mineralCost !== undefined || patch.gasCost !== undefined || (patch.weapons?.length ?? 0) > 0;
  if (patch.name !== undefined || numeric || patch.useDefault !== undefined) {
    const s = scn.unitSettings ?? defaultUnitSettings();
    const created = scn.unitSettings === null;
    let changed = created;
    const setU16 = (arr: Uint16Array, i: number, v: number | undefined) => { if (v === undefined) return; const c = clampU16(v); if (arr[i] !== c) { arr[i] = c; changed = true; } };
    const wantDefault = patch.useDefault ?? (numeric ? false : s.useDefault[unitId] !== 0);
    if (!wantDefault && s.useDefault[unitId] !== 0) {
      s.useDefault[unitId] = 0;
      changed = true;
      if (dat && s.hitPoints[unitId] === 0 && s.buildTime[unitId] === 0 && s.mineralCost[unitId] === 0) {
        s.hitPoints[unitId] = dat.hitPoints[unitId];
        s.shields[unitId] = dat.shieldEnable[unitId] ? dat.shieldAmount[unitId] : 0;
        s.armor[unitId] = dat.armor[unitId];
        s.buildTime[unitId] = dat.buildTime[unitId];
        s.mineralCost[unitId] = dat.mineralCost[unitId];
        s.gasCost[unitId] = dat.vespeneCost[unitId];
        if (weaponsDat) for (const id of unitWeaponIds(dat, unitId)) { if (s.weaponDamage[id] === 0 && s.weaponBonus[id] === 0) { s.weaponDamage[id] = weaponsDat.damage[id]; s.weaponBonus[id] = weaponsDat.bonus[id]; } }
      }
    } else if (wantDefault && s.useDefault[unitId] === 0) { s.useDefault[unitId] = 1; changed = true; }
    if (patch.hitPoints !== undefined) { const v = Math.max(0, Math.min(0xffffff, Math.round(patch.hitPoints))) * 256; if (s.hitPoints[unitId] !== v) { s.hitPoints[unitId] = v; changed = true; } }
    setU16(s.shields, unitId, patch.shields);
    if (patch.armor !== undefined) { const v = clampU8(patch.armor); if (s.armor[unitId] !== v) { s.armor[unitId] = v; changed = true; } }
    setU16(s.buildTime, unitId, patch.buildTime);
    setU16(s.mineralCost, unitId, patch.mineralCost);
    setU16(s.gasCost, unitId, patch.gasCost);
    for (const w of patch.weapons ?? []) {
      if (w.id < 0 || w.id >= WEAPONS_BW) continue;
      setU16(s.weaponDamage, w.id, w.damage);
      setU16(s.weaponBonus, w.id, w.bonus);
    }
    if (patch.name !== undefined && patch.name !== unitCustomName(scn, unitId)) {
      const strings = scn.strings.strings.length;
      s.nameIndex[unitId] = internString(scn, patch.name);
      if (scn.strings.strings.length !== strings) out.push(strSectionName(scn));
      changed = true;
    }
    if (changed) {
      scn.unitSettings = s;
      markDirty(scn, ...unitSettingsSections(scn));
      out.push(...unitSettingsSections(scn));
    }
  }
  if (patch.available && patch.available.length > 0) {
    const a = scn.unitAvailability ?? defaultUnitAvailability();
    let changed = scn.unitAvailability === null;
    for (const entry of patch.available) {
      if (entry.player === "default") {
        if (entry.value === "default") continue;
        const v = entry.value ? 1 : 0;
        if (a.defaultAvailable[unitId] !== v) { a.defaultAvailable[unitId] = v; changed = true; }
        continue;
      }
      if (entry.player < 0 || entry.player >= PLAYER_SLOTS) continue;
      const i = puniIndex(entry.player, unitId);
      if (entry.value === "default") { if (a.playerUsesDefault[i] !== 1) { a.playerUsesDefault[i] = 1; changed = true; } continue; }
      const v = entry.value ? 1 : 0;
      if (a.playerUsesDefault[i] !== 0) { a.playerUsesDefault[i] = 0; changed = true; }
      if (a.playerAvailable[i] !== v) { a.playerAvailable[i] = v; changed = true; }
    }
    if (changed) { scn.unitAvailability = a; markDirty(scn, "PUNI"); out.push("PUNI"); }
  }
  return out;
}

/* ── Upgrades ────────────────────────────────────────────── */

export interface UpgradeLevelsView {
  start: number;
  max: number;
  usesDefault: boolean;
}

export interface UpgradeView {
  id: number;
  name: string;
  useDefault: boolean;
  mineralCost: number;
  mineralFactor: number;
  gasCost: number;
  gasFactor: number;
  /** Game frames. */
  timeCost: number;
  timeFactor: number;
  /** upgrades.dat, null without the game data. */
  defaults: { mineralCost: number; mineralFactor: number; gasCost: number; gasFactor: number; timeCost: number; timeFactor: number; maxLevel: number } | null;
  /** UPGR / PUPx: the default start and cap, and each of the 12 players' (effective, with `usesDefault`). */
  levels: { defaultStart: number; defaultMax: number; players: UpgradeLevelsView[] };
}

export function upgradeView(scn: Scenario, id: number, dat: UpgradesDat | null): UpgradeView {
  const s = scn.upgradeSettings;
  const useDefault = !s || s.useDefault[id] !== 0;
  const defaults = dat ? { mineralCost: dat.mineralCost[id], mineralFactor: dat.mineralFactor[id], gasCost: dat.vespeneCost[id], gasFactor: dat.vespeneFactor[id], timeCost: dat.timeCost[id], timeFactor: dat.timeFactor[id], maxLevel: dat.maxRepeats[id] } : null;
  const stored = s ? { mineralCost: s.mineralCost[id], mineralFactor: s.mineralFactor[id], gasCost: s.gasCost[id], gasFactor: s.gasFactor[id], timeCost: s.timeCost[id], timeFactor: s.timeFactor[id] } : null;
  const zero = { mineralCost: 0, mineralFactor: 0, gasCost: 0, gasFactor: 0, timeCost: 0, timeFactor: 0 };
  const eff = (useDefault ? defaults : stored) ?? stored ?? defaults ?? zero;
  const r = scn.upgradeRestrictions ?? defaultUpgradeRestrictions();
  return {
    id,
    name: upgradeName(id),
    useDefault,
    mineralCost: eff.mineralCost, mineralFactor: eff.mineralFactor, gasCost: eff.gasCost, gasFactor: eff.gasFactor, timeCost: eff.timeCost, timeFactor: eff.timeFactor,
    defaults,
    levels: {
      defaultStart: r.defaultStart[id],
      defaultMax: r.defaultMax[id],
      players: Array.from({ length: PLAYER_SLOTS }, (_, p) => {
        const i = upgradeIndex(p, id);
        const usesDefault = r.playerUsesDefault[i] !== 0;
        return { start: usesDefault ? r.defaultStart[id] : r.playerStart[i], max: usesDefault ? r.defaultMax[id] : r.playerMax[i], usesDefault };
      }),
    },
  };
}

export interface UpgradePatch {
  useDefault?: boolean;
  mineralCost?: number;
  mineralFactor?: number;
  gasCost?: number;
  gasFactor?: number;
  timeCost?: number;
  timeFactor?: number;
  /** `player` 0-based or `"default"`; `useDefault: true` puts a player back on the default column. */
  levels?: { player: number | "default"; start?: number; max?: number; useDefault?: boolean }[];
}

export function patchUpgrade(scn: Scenario, id: number, patch: UpgradePatch, dat: UpgradesDat | null): string[] {
  const out: string[] = [];
  if (id < 0 || id >= UPGRADES_BW) return out;
  const numeric = patch.mineralCost !== undefined || patch.mineralFactor !== undefined || patch.gasCost !== undefined || patch.gasFactor !== undefined || patch.timeCost !== undefined || patch.timeFactor !== undefined;
  if (numeric || patch.useDefault !== undefined) {
    const s = scn.upgradeSettings ?? defaultUpgradeSettings();
    let changed = scn.upgradeSettings === null;
    const wantDefault = patch.useDefault ?? (numeric ? false : s.useDefault[id] !== 0);
    if (!wantDefault && s.useDefault[id] !== 0) {
      s.useDefault[id] = 0; changed = true;
      if (dat && s.mineralCost[id] === 0 && s.gasCost[id] === 0 && s.timeCost[id] === 0) {
        s.mineralCost[id] = dat.mineralCost[id]; s.mineralFactor[id] = dat.mineralFactor[id]; s.gasCost[id] = dat.vespeneCost[id]; s.gasFactor[id] = dat.vespeneFactor[id]; s.timeCost[id] = dat.timeCost[id]; s.timeFactor[id] = dat.timeFactor[id];
      }
    } else if (wantDefault && s.useDefault[id] === 0) { s.useDefault[id] = 1; changed = true; }
    const set = (arr: Uint16Array, v: number | undefined) => { if (v === undefined) return; const c = clampU16(v); if (arr[id] !== c) { arr[id] = c; changed = true; } };
    set(s.mineralCost, patch.mineralCost); set(s.mineralFactor, patch.mineralFactor); set(s.gasCost, patch.gasCost); set(s.gasFactor, patch.gasFactor); set(s.timeCost, patch.timeCost); set(s.timeFactor, patch.timeFactor);
    if (changed) { scn.upgradeSettings = s; markDirty(scn, ...upgradeSettingsSections(scn)); out.push(...upgradeSettingsSections(scn)); }
  }
  if (patch.levels && patch.levels.length > 0) {
    const r = scn.upgradeRestrictions ?? defaultUpgradeRestrictions();
    let changed = scn.upgradeRestrictions === null;
    const put = (arr: Uint8Array, i: number, v: number | undefined) => { if (v === undefined) return; const c = clampU8(v); if (arr[i] !== c) { arr[i] = c; changed = true; } };
    for (const l of patch.levels) {
      if (l.player === "default") { put(r.defaultStart, id, l.start); put(r.defaultMax, id, l.max); continue; }
      if (l.player < 0 || l.player >= PLAYER_SLOTS) continue;
      const i = upgradeIndex(l.player, id);
      if (l.useDefault) { if (r.playerUsesDefault[i] !== 1) { r.playerUsesDefault[i] = 1; changed = true; } continue; }
      if (l.start === undefined && l.max === undefined) continue;
      if (r.playerUsesDefault[i] !== 0) { r.playerUsesDefault[i] = 0; r.playerStart[i] = r.defaultStart[id]; r.playerMax[i] = r.defaultMax[id]; changed = true; }
      put(r.playerStart, i, l.start); put(r.playerMax, i, l.max);
    }
    if (changed) { scn.upgradeRestrictions = r; markDirty(scn, ...upgradeRestrictionSections(scn)); out.push(...upgradeRestrictionSections(scn)); }
  }
  return out;
}

/* ── Technologies ────────────────────────────────────────── */

export interface TechStateView {
  available: boolean;
  researched: boolean;
  usesDefault: boolean;
}

export interface TechView {
  id: number;
  name: string;
  useDefault: boolean;
  mineralCost: number;
  gasCost: number;
  /** Game frames. */
  researchTime: number;
  energyCost: number;
  defaults: { mineralCost: number; gasCost: number; researchTime: number; energyCost: number } | null;
  /** PTEC / PTEx: the default column and each of the 12 players' effective state. */
  state: { defaultAvailable: boolean; defaultResearched: boolean; players: TechStateView[] };
}

export function techView(scn: Scenario, id: number, dat: TechdataDat | null): TechView {
  const s = scn.techSettings;
  const useDefault = !s || s.useDefault[id] !== 0;
  const defaults = dat ? { mineralCost: dat.mineralCost[id], gasCost: dat.vespeneCost[id], researchTime: dat.researchTime[id], energyCost: dat.energyCost[id] } : null;
  const stored = s ? { mineralCost: s.mineralCost[id], gasCost: s.gasCost[id], researchTime: s.researchTime[id], energyCost: s.energyCost[id] } : null;
  const eff = (useDefault ? defaults : stored) ?? stored ?? defaults ?? { mineralCost: 0, gasCost: 0, researchTime: 0, energyCost: 0 };
  const r = scn.techRestrictions ?? defaultTechRestrictions();
  return {
    id,
    name: techName(id),
    useDefault,
    ...eff,
    defaults,
    state: {
      defaultAvailable: r.defaultAvailable[id] !== 0,
      defaultResearched: r.defaultResearched[id] !== 0,
      players: Array.from({ length: PLAYER_SLOTS }, (_, p) => {
        const i = techIndex(p, id);
        const usesDefault = r.playerUsesDefault[i] !== 0;
        return { available: usesDefault ? r.defaultAvailable[id] !== 0 : r.playerAvailable[i] !== 0, researched: usesDefault ? r.defaultResearched[id] !== 0 : r.playerResearched[i] !== 0, usesDefault };
      }),
    },
  };
}

export interface TechPatch {
  useDefault?: boolean;
  mineralCost?: number;
  gasCost?: number;
  researchTime?: number;
  energyCost?: number;
  /** `player` 0-based or `"default"`; `useDefault: true` puts a player back on the default column. */
  state?: { player: number | "default"; available?: boolean; researched?: boolean; useDefault?: boolean }[];
}

export function patchTech(scn: Scenario, id: number, patch: TechPatch, dat: TechdataDat | null): string[] {
  const out: string[] = [];
  if (id < 0 || id >= TECHS_BW) return out;
  const numeric = patch.mineralCost !== undefined || patch.gasCost !== undefined || patch.researchTime !== undefined || patch.energyCost !== undefined;
  if (numeric || patch.useDefault !== undefined) {
    const s = scn.techSettings ?? defaultTechSettings();
    let changed = scn.techSettings === null;
    const wantDefault = patch.useDefault ?? (numeric ? false : s.useDefault[id] !== 0);
    if (!wantDefault && s.useDefault[id] !== 0) {
      s.useDefault[id] = 0; changed = true;
      if (dat && s.mineralCost[id] === 0 && s.gasCost[id] === 0 && s.researchTime[id] === 0) {
        s.mineralCost[id] = dat.mineralCost[id]; s.gasCost[id] = dat.vespeneCost[id]; s.researchTime[id] = dat.researchTime[id]; s.energyCost[id] = dat.energyCost[id];
      }
    } else if (wantDefault && s.useDefault[id] === 0) { s.useDefault[id] = 1; changed = true; }
    const set = (arr: Uint16Array, v: number | undefined) => { if (v === undefined) return; const c = clampU16(v); if (arr[id] !== c) { arr[id] = c; changed = true; } };
    set(s.mineralCost, patch.mineralCost); set(s.gasCost, patch.gasCost); set(s.researchTime, patch.researchTime); set(s.energyCost, patch.energyCost);
    if (changed) { scn.techSettings = s; markDirty(scn, ...techSettingsSections(scn)); out.push(...techSettingsSections(scn)); }
  }
  if (patch.state && patch.state.length > 0) {
    const r = scn.techRestrictions ?? defaultTechRestrictions();
    let changed = scn.techRestrictions === null;
    const put = (arr: Uint8Array, i: number, v: boolean | undefined) => { if (v === undefined) return; const c = v ? 1 : 0; if (arr[i] !== c) { arr[i] = c; changed = true; } };
    for (const st of patch.state) {
      if (st.player === "default") { put(r.defaultAvailable, id, st.available); put(r.defaultResearched, id, st.researched); continue; }
      if (st.player < 0 || st.player >= PLAYER_SLOTS) continue;
      const i = techIndex(st.player, id);
      if (st.useDefault) { if (r.playerUsesDefault[i] !== 1) { r.playerUsesDefault[i] = 1; changed = true; } continue; }
      if (st.available === undefined && st.researched === undefined) continue;
      if (r.playerUsesDefault[i] !== 0) { r.playerUsesDefault[i] = 0; r.playerAvailable[i] = r.defaultAvailable[id]; r.playerResearched[i] = r.defaultResearched[id]; changed = true; }
      put(r.playerAvailable, i, st.available); put(r.playerResearched, i, st.researched);
    }
    if (changed) { scn.techRestrictions = r; markDirty(scn, ...techRestrictionSections(scn)); out.push(...techRestrictionSections(scn)); }
  }
  return out;
}

/* ── Map version ─────────────────────────────────────────── */

export interface MapVersionView {
  version: MapVersion;
  label: string;
  /** The VER word. */
  fileVersion: number;
  type: string;
  /** Whether the string table is STRx. */
  extendedStrings: boolean;
  /** The file extension StarEdit would give it. */
  extension: string;
}

export function mapVersionView(scn: Scenario): MapVersionView {
  const version = mapVersionOf(scn.fileVersion);
  const v = MAP_VERSIONS[version];
  return { version, label: v.label, fileVersion: scn.fileVersion, type: scn.type, extendedStrings: scn.strings.extended, extension: v.extension };
}

/** `setMapVersion` reporting the sections it changed. */
export function changeMapVersion(scn: Scenario, version: MapVersion, extendedStrings?: boolean): string[] {
  const before = mapVersionView(scn);
  setMapVersion(scn, version, extendedStrings);
  const after = mapVersionView(scn);
  const out: string[] = [];
  if (before.fileVersion !== after.fileVersion) out.push("VER ");
  if (before.type !== after.type) out.push("TYPE");
  if (before.extendedStrings !== after.extendedStrings) out.push("STR ", "STRx");
  return out;
}
