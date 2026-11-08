/**
 * The `arr\*.dat` tables that lead from a unit type to its picture:
 *
 *   units.dat[unit].flingy ─▶ flingy.dat[flingy].sprite ─▶ sprites.dat[sprite].image
 *   ─▶ images.dat[image].grp ─▶ images.tbl (1-based) ─▶ "unit\" + path
 *
 * Each file is a struct of arrays: every field is stored for all entries before the next
 * field starts. A few unit fields only exist for a sub-range of entries, and three of them
 * (placement box, add-on offset, extents) are arrays of small structs instead. The layout
 * is the schema's (`schema.ts`) and the width is the file's (`table.ts#decodeDat`): the game's
 * own tables (units.dat = 19876 bytes; the original game's 19192-byte table just lacks the
 * last two fields), DatExtend's expanded ones and GPTP's `.datex` all read the same way,
 * the columns as long as the file has entries. Only what the editor needs is picked out.
 * The counts below are the game's own, which the CHK format's settings sections are sized by.
 */
import { decodeDat, type DatFile } from "./table";
import type { DatTableName } from "./schema";

export const UNIT_TYPES = 228;
export const FLINGY_TYPES = 209;
export const SPRITE_TYPES = 517;
export const IMAGE_TYPES = 999;

export const UNITS_DAT_SIZE = 19876;
/** `availability` bit for a unit StarEdit lists in its palette — the units a trigger can create. */
export const PALETTE_AVAILABILITY = 0x02;

/** Pre-Brood War layout: no `broodWar` byte or `availability` word. */
export const UNITS_DAT_SIZE_LEGACY = 19192;
export const FLINGY_DAT_SIZE = 3135;
export const SPRITES_DAT_SIZE = 3229;
export const IMAGES_DAT_SIZE = 37962;

/** `subunit` value meaning "none". */
export const NO_UNIT = 228;
export const WEAPON_TYPES = 130;
/** units.dat's "no weapon" id. */
export const NO_WEAPON = 130;
export const WEAPONS_DAT_SIZE = 5460;
/** `direction` value meaning StarCraft picks one at random when the unit is created. */
export const RANDOM_DIRECTION = 32;

/** units.dat `flags` (special ability flags) bits. */
export const UnitFlag = {
  Building: 1 << 0,
  Addon: 1 << 1,
  Flyer: 1 << 2,
  Worker: 1 << 3,
  Subunit: 1 << 4,
  FlyingBuilding: 1 << 5,
  Hero: 1 << 6,
  Regenerates: 1 << 7,
  AnimatedIdle: 1 << 8,
  Cloakable: 1 << 9,
  TwoUnitsInOneEgg: 1 << 10,
  SingleEntity: 1 << 11,
  ResourceDepot: 1 << 12,
  ResourceContainer: 1 << 13,
  Robotic: 1 << 14,
  Detector: 1 << 15,
  Organic: 1 << 16,
  RequiresCreep: 1 << 17,
  RequiresPsi: 1 << 19,
  Burrowable: 1 << 20,
  Spellcaster: 1 << 21,
  PermanentCloak: 1 << 22,
  PickupItem: 1 << 23,
  IgnoreSupplyCheck: 1 << 24,
  UseMediumOverlays: 1 << 25,
  UseLargeOverlays: 1 << 26,
  BattleReactions: 1 << 27,
  FullAutoAttack: 1 << 28,
  Invincible: 1 << 29,
  Mechanical: 1 << 30,
  ProducesUnits: 0x80000000,
} as const;

export interface UnitsDat {
  /** flingy.dat index (a byte in the game's layout, a word in the extended ones). */
  flingy: Uint16Array;
  /** First subunit (turret), or NO_UNIT. */
  subunit: Uint16Array;
  /** Starting facing 0–31 (0 = up, 8 = right, 16 = down), or RANDOM_DIRECTION. */
  direction: Uint8Array;
  shieldEnable: Uint8Array;
  shieldAmount: Uint16Array;
  /** Fixed point: hit points × 256. */
  hitPoints: Uint32Array;
  elevation: Uint8Array;
  /** UnitFlag bits. */
  flags: Uint32Array;
  /** StarEdit placement box, pixels. Buildings are placed on the tile grid by this box. */
  placementWidth: Uint16Array;
  placementHeight: Uint16Array;
  /** Collision extents from the unit's centre, pixels. */
  extentLeft: Uint16Array;
  extentUp: Uint16Array;
  extentRight: Uint16Array;
  extentDown: Uint16Array;
  mineralCost: Uint16Array;
  vespeneCost: Uint16Array;
  /** Game frames. */
  buildTime: Uint16Array;
  armor: Uint8Array;
  /** weapons.dat ids, or NO_WEAPON. */
  groundWeapon: Uint16Array;
  airWeapon: Uint16Array;
  /** Bit 0 Zerg, 1 Terran, 2 Protoss, 3 men, 4 building, 5 factory, 6 independent, 7 neutral. */
  groupFlags: Uint8Array;
  /** StarEdit availability flags; all zero for the legacy layout. */
  availability: Uint16Array;
  /**
   * The unit's voice, as sfxdata.dat ids (0 for none): the one it says when trained, and
   * first–last ranges for a click, repeated clicks and an order. In the game's layout only
   * the first `VOICED_UNITS` have ready / annoyed / yes sounds (0 past them); every unit has a "what".
   */
  readySound: Uint16Array;
  whatSoundStart: Uint16Array;
  whatSoundEnd: Uint16Array;
  annoyedSoundStart: Uint16Array;
  annoyedSoundEnd: Uint16Array;
  yesSoundStart: Uint16Array;
  yesSoundEnd: Uint16Array;
}

/** Units 0–105 — the ones that are trained and ordered about — carry the full set of voice columns. */
export const VOICED_UNITS = 106;

export interface FlingyDat {
  /** sprites.dat index. */
  sprite: Uint16Array;
  /** The fastest the flingy moves, in 1/256 pixel a frame (a Zergling's 1408 is 5.5 pixels a frame). */
  topSpeed: Uint32Array;
  /** How quickly it reaches that speed, in the same units a frame. */
  acceleration: Uint16Array;
  /** How far before its goal it starts to slow down, in 1/256 pixel. */
  haltDistance: Uint32Array;
  /** How sharply it turns. */
  turnRadius: Uint8Array;
  /** 0 flingy.dat's own figures, 1 partially mobile or weapon, 2 iscript.bin's (a unit whose walk is animated). */
  moveControl: Uint8Array;
}

export interface SpritesDat {
  /** images.dat index. */
  image: Uint16Array;
}

/** images.dat `drawFunction` values the editor distinguishes. */
export const DrawFunction = {
  Normal: 0,
  /** Palette-remapped effect (fire, explosions): `remapping` picks the tileset's remap table. */
  Remap: 9,
  Shadow: 10,
  HpBar: 11,
  SelectionCircle: 13,
} as const;

/** images.dat `remapping` values: which `tileset\<name>\*.pcx` table a Remap image blends through. */
export const REMAP_TABLES = ["", "ofire", "gfire", "bfire", "bexpl"] as const;

/** The overlay `.lo` slots in images.dat order; `imgoluselo` picks one by this index. */
export const LO_KINDS = ["attack", "damage", "special", "landing", "liftOff", "shield"] as const;

export interface ImagesDat {
  /** 1-based images.tbl index of the GRP path, relative to `unit\`. */
  grp: Uint32Array;
  /** 1 when the GRP holds 17 frames per facing set (directions 0–16, the rest mirrored). */
  graphicTurns: Uint8Array;
  drawFunction: Uint8Array;
  remapping: Uint8Array;
  /** iscript.bin id of the image's animation script. */
  iscript: Uint32Array;
  /** 1-based images.tbl indices of the overlay position files (0 = none), in LO_KINDS order. */
  lo: Uint32Array[];
}

/**
 * The table's entries, from any of its columns: the count the file had (228 units for the game's own table, any
 * number for a mod's — `table.ts#datShape` reads the width off the file's length).
 */
export function datCount(table: { length: number } | null | undefined): number {
  return table?.length ?? 0;
}

/** The whole table through `table.ts`; the subset readers below pick their columns from it. */
function read(table: DatTableName, data: Uint8Array, fileName?: string): DatFile {
  return decodeDat(table, data, fileName ? { fileName } : {});
}

/** A struct column (placement box, extents) split into one array a part. */
function part(col: ArrayLike<number>, parts: number, index: number, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = col[i * parts + index];
  return out;
}

const u8 = (c: unknown) => c as Uint8Array;
const u16 = (c: unknown) => c as Uint16Array;
const u32 = (c: unknown) => c as Uint32Array;

/**
 * units.dat at any width: the game's 228 types (or the 19192-byte original, whose last two columns read 0),
 * DatExtend's expanded layout, or GPTP's `.datex` when `fileName` ends so. Throws when the size fits no layout.
 * Columns a layout stores only for a range of ids (the voices, 0–105) read 0 elsewhere.
 */
export function decodeUnitsDat(data: Uint8Array, fileName?: string): UnitsDat {
  const file = read("units", data, fileName);
  const c = file.columns;
  const n = file.count;
  return {
    flingy: u16(c.graphics), subunit: u16(c.subunit1), direction: u8(c.unit_direction), shieldEnable: u8(c.shield_enabled),
    shieldAmount: u16(c.shield_amount), hitPoints: u32(c.hit_points), elevation: u8(c.elevation_level), flags: u32(c.special_ability_flags),
    placementWidth: part(c.staredit_placement_size, 2, 0, n), placementHeight: part(c.staredit_placement_size, 2, 1, n),
    extentLeft: part(c.unit_extents, 4, 0, n), extentUp: part(c.unit_extents, 4, 1, n), extentRight: part(c.unit_extents, 4, 2, n), extentDown: part(c.unit_extents, 4, 3, n),
    mineralCost: u16(c.mineral_cost), vespeneCost: u16(c.vespene_cost), buildTime: u16(c.build_time), armor: u8(c.armor),
    groundWeapon: u16(c.ground_weapon), airWeapon: u16(c.air_weapon), groupFlags: u8(c.staredit_group_flags), availability: u16(c.staredit_availability_flags),
    readySound: u16(c.ready_sound), whatSoundStart: u16(c.what_sound_start), whatSoundEnd: u16(c.what_sound_end),
    annoyedSoundStart: u16(c.pissed_sound_start), annoyedSoundEnd: u16(c.pissed_sound_end), yesSoundStart: u16(c.yes_sound_start), yesSoundEnd: u16(c.yes_sound_end),
  };
}

export interface SfxdataDat {
  /** The sound's file: a 1-based `sfxdata.tbl` index, 0 for none. */
  file: Uint32Array;
}

/** The file column; the table is as long as the data set has sounds (1144 in Brood War), the count off the size. */
export function decodeSfxdataDat(data: Uint8Array, fileName?: string): SfxdataDat {
  return { file: u32(read("sfxdata", data, fileName).columns.sound_file) };
}

export interface WeaponsDat {
  /** The weapon's name: a 1-based `stat_txt.tbl` index, 0 for none. */
  label: Uint16Array;
  damage: Uint16Array;
  /** Added per upgrade level. */
  bonus: Uint16Array;
}

/** The label and the two columns Unit Settings shows as defaults, at the file's width. */
export function decodeWeaponsDat(data: Uint8Array, fileName?: string): WeaponsDat {
  const c = read("weapons", data, fileName).columns;
  return { label: u16(c.label), damage: u16(c.damage_amount), bonus: u16(c.damage_bonus) };
}

export type Race = "zerg" | "terran" | "protoss" | null;

/** The race a unit type belongs to, from its group flags. */
export function unitRace(units: UnitsDat, unitId: number): Race {
  const g = units.groupFlags[unitId] ?? 0;
  return g & 1 ? "zerg" : g & 2 ? "terran" : g & 4 ? "protoss" : null;
}

export function decodeFlingyDat(data: Uint8Array, fileName?: string): FlingyDat {
  const c = read("flingy", data, fileName).columns;
  return {
    sprite: u16(c.sprite), topSpeed: u32(c.speed), acceleration: u16(c.acceleration), haltDistance: u32(c.halt_distance),
    turnRadius: u8(c.turn_radius), moveControl: u8(c.movement_control),
  };
}

export function decodeSpritesDat(data: Uint8Array, fileName?: string): SpritesDat {
  return { image: u16(read("sprites", data, fileName).columns.image) };
}

export function decodeImagesDat(data: Uint8Array, fileName?: string): ImagesDat {
  const c = read("images", data, fileName).columns;
  return {
    grp: u32(c.grp_file), graphicTurns: u8(c.gfx_turns), drawFunction: u8(c.draw_function), remapping: u8(c.remapping), iscript: u32(c.iscript_id),
    lo: [u32(c.attack_overlay), u32(c.damage_overlay), u32(c.special_overlay), u32(c.landing_dust_overlay), u32(c.lift_off_dust_overlay), u32(c.shield_overlay)],
  };
}

/* ── upgrades.dat / techdata.dat ─────────────────────────── */

export const UPGRADE_TYPES = 61;
export const TECH_TYPES = 44;
export const UPGRADES_DAT_SIZE = 1281;
export const TECHDATA_DAT_SIZE = 836;

/** The columns Upgrade Settings shows as defaults: base cost and per-level factor for minerals, gas and time, plus the level cap. */
export interface UpgradesDat {
  mineralCost: Uint16Array;
  mineralFactor: Uint16Array;
  vespeneCost: Uint16Array;
  vespeneFactor: Uint16Array;
  /** Game frames. */
  timeCost: Uint16Array;
  timeFactor: Uint16Array;
  /** Highest level the upgrade goes to (3 for armour / weapons, 1 for the rest). */
  maxRepeats: Uint8Array;
  /** 1 for upgrades only Brood War has. */
  broodWar: Uint8Array;
  /** The upgrade's name: a 1-based `stat_txt.tbl` index, 0 for none. */
  label: Uint16Array;
  /** Its button picture: a frame of `unit\cmdbtns\cmdicons.grp`. */
  icon: Uint16Array;
}

/** Struct of arrays: six u16 columns of cost, then requirements / icon / label u16s, then race, max repeats and the Brood War flag. */
export function decodeUpgradesDat(data: Uint8Array, fileName?: string): UpgradesDat {
  const c = read("upgrades", data, fileName).columns;
  return {
    mineralCost: u16(c.mineral_cost_base), mineralFactor: u16(c.mineral_cost_factor), vespeneCost: u16(c.vespene_cost_base), vespeneFactor: u16(c.vespene_cost_factor),
    timeCost: u16(c.research_time_base), timeFactor: u16(c.research_time_factor), maxRepeats: u8(c.max_repeats), broodWar: u8(c.broodwar_only), label: u16(c.label), icon: u16(c.icon),
  };
}

/** The columns Technology Settings shows as defaults. */
export interface TechdataDat {
  mineralCost: Uint16Array;
  vespeneCost: Uint16Array;
  /** Game frames. */
  researchTime: Uint16Array;
  energyCost: Uint16Array;
  /** 1 for abilities only Brood War has. */
  broodWar: Uint8Array;
  /** The technology's name: a 1-based `stat_txt.tbl` index, 0 for none. */
  label: Uint16Array;
  /** Its button picture: a frame of `unit\cmdbtns\cmdicons.grp`. */
  icon: Uint16Array;
}

/** Struct of arrays: four u16 cost columns, then research / use requirements, icon and label u16s, race, an unused byte and the Brood War flag. */
export function decodeTechdataDat(data: Uint8Array, fileName?: string): TechdataDat {
  const c = read("techdata", data, fileName).columns;
  return {
    mineralCost: u16(c.mineral_cost), vespeneCost: u16(c.vespene_cost), researchTime: u16(c.research_time), energyCost: u16(c.energy_required),
    broodWar: u8(c.broodwar_only), label: u16(c.label), icon: u16(c.icon),
  };
}
