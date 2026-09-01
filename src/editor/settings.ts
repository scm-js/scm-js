/**
 * Scenario-wide settings the dialogs edit: players, forces, colours and unit settings.
 *
 * These are not part of the undo model — each dialog is its own transaction (OK / Apply
 * / Cancel), as in StarEdit. Every writer here marks the sections it touches dirty and
 * the caller bumps `settingsRevisionAtom` (`commitSettingsAtom`) so the chrome re-reads.
 */
import { markDirty, strSectionName, unitSettingsSections, type Scenario } from "../formats/chk/scenario";
import { FORCE_SLOTS, PLAYER_SLOTS, type Forces, type PlayerRgb } from "../formats/chk/sections/players";
import { getString, findString, setString } from "../formats/chk/sections/strings";
import { cloneUnitAvailability, cloneUnitSettings, defaultUnitAvailability, defaultUnitSettings, type UnitAvailability, type UnitSettings } from "../formats/chk/sections/settings";

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
