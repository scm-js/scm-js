/**
 * The `arr\*.dat` tables that lead from a unit type to its picture:
 *
 *   units.dat[unit].flingy ─▶ flingy.dat[flingy].sprite ─▶ sprites.dat[sprite].image
 *   ─▶ images.dat[image].grp ─▶ images.tbl (1-based) ─▶ "unit\" + path
 *
 * Each file is a struct of arrays: every field is stored for all entries before the next
 * field starts. A few unit fields only exist for a sub-range of entries, and three of them
 * (placement box, add-on offset, extents) are arrays of small structs instead. The layout
 * below is the Brood War one (units.dat = 19876 bytes); the original game's 19192-byte
 * table just lacks the last two fields. Only what the editor needs is decoded.
 */

export const UNIT_TYPES = 228;
export const FLINGY_TYPES = 209;
export const SPRITE_TYPES = 517;
export const IMAGE_TYPES = 999;

export const UNITS_DAT_SIZE = 19876;
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
  /** flingy.dat index. */
  flingy: Uint8Array;
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
  groundWeapon: Uint8Array;
  airWeapon: Uint8Array;
  /** Bit 0 Zerg, 1 Terran, 2 Protoss, 3 men, 4 building, 5 factory, 6 independent, 7 neutral. */
  groupFlags: Uint8Array;
  /** StarEdit availability flags; all zero for the legacy layout. */
  availability: Uint16Array;
}

export interface FlingyDat {
  /** sprites.dat index. */
  sprite: Uint16Array;
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

/** Sequential reader over a struct-of-arrays file. */
class Fields {
  private at = 0;
  private readonly data: Uint8Array;
  private readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.length - this.at;
  }

  u8(count: number): Uint8Array {
    const out = this.data.slice(this.at, this.at + count);
    this.at += count;
    return out;
  }

  u16(count: number): Uint16Array {
    return this.u16Strided(count, 2, 0);
  }

  u32(count: number): Uint32Array {
    const out = new Uint32Array(count);
    for (let i = 0; i < count; i++) out[i] = this.view.getUint32(this.at + i * 4, true);
    this.at += count * 4;
    return out;
  }

  /** Read `count` u16s spaced `stride` bytes apart starting `offset` bytes in, without advancing. */
  u16Strided(count: number, stride: number, offset: number): Uint16Array {
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) out[i] = this.view.getUint16(this.at + offset + i * stride, true);
    if (offset === 0 && stride === 2) this.at += count * 2;
    return out;
  }

  skip(bytes: number) {
    this.at += bytes;
  }
}

function expectSize(name: string, data: Uint8Array, ...sizes: number[]) {
  if (!sizes.includes(data.length)) {
    throw new Error(`${name} is ${data.length} bytes; expected ${sizes.join(" or ")}`);
  }
}

export function decodeUnitsDat(data: Uint8Array): UnitsDat {
  expectSize("units.dat", data, UNITS_DAT_SIZE, UNITS_DAT_SIZE_LEGACY);
  const n = UNIT_TYPES;
  const f = new Fields(data);
  const flingy = f.u8(n);
  const subunit = f.u16(n);
  f.skip(n * 2); // subunit2
  f.skip(96 * 2); // infestation (units 106–201)
  f.skip(n * 4); // construction animation
  const direction = f.u8(n);
  const shieldEnable = f.u8(n);
  const shieldAmount = f.u16(n);
  const hitPoints = f.u32(n);
  const elevation = f.u8(n);
  f.skip(n * 7); // unknown, sublabel, 5 AI orders
  const groundWeapon = f.u8(n);
  f.skip(n); // max ground hits
  const airWeapon = f.u8(n);
  f.skip(n * 2); // max air hits, aiInternal
  const flags = f.u32(n);
  f.skip(n * 4); // acquisition range, sight, armour upgrade, size
  const armor = f.u8(n);
  f.skip(n); // right-click action
  f.skip(106 * 2 + n * 2 * 2 + 106 * 2 * 4); // ready / what / pissed / yes sounds
  const placementWidth = f.u16Strided(n, 4, 0);
  const placementHeight = f.u16Strided(n, 4, 2);
  f.skip(n * 4);
  f.skip(96 * 4); // add-on offsets (units 106–201)
  const extentLeft = f.u16Strided(n, 8, 0);
  const extentUp = f.u16Strided(n, 8, 2);
  const extentRight = f.u16Strided(n, 8, 4);
  const extentDown = f.u16Strided(n, 8, 6);
  f.skip(n * 8);
  f.skip(n * 2); // portrait
  const mineralCost = f.u16(n);
  const vespeneCost = f.u16(n);
  const buildTime = f.u16(n);
  f.skip(n * 2); // requirements
  const groupFlags = f.u8(n);
  f.skip(n * 4); // supply provided/required, space required/provided
  f.skip(n * 2 * 3); // build score, destroy score, map string
  let availability: Uint16Array = new Uint16Array(n);
  if (f.remaining >= n * 3) {
    f.skip(n); // Brood War flag
    availability = f.u16(n);
  }
  return {
    flingy, subunit, direction, shieldEnable, shieldAmount, hitPoints, elevation, flags,
    placementWidth, placementHeight, extentLeft, extentUp, extentRight, extentDown,
    mineralCost, vespeneCost, buildTime, armor, groundWeapon, airWeapon, groupFlags, availability,
  };
}

export interface WeaponsDat {
  damage: Uint16Array;
  /** Added per upgrade level. */
  bonus: Uint16Array;
}

/** Only the two columns Unit Settings shows as defaults; the layout is 42 bytes per weapon, struct of arrays. */
export function decodeWeaponsDat(data: Uint8Array): WeaponsDat {
  expectSize("weapons.dat", data, WEAPONS_DAT_SIZE);
  const n = WEAPON_TYPES;
  const f = new Fields(data);
  f.skip(n * 2); // label
  f.skip(n * 4); // graphics
  f.skip(n); // explosion
  f.skip(n * 2); // target flags
  f.skip(n * 4 * 2); // min / max range
  f.skip(n * 5); // damage upgrade, type, behaviour, remove after, explosive type
  f.skip(n * 2 * 3); // inner / medium / outer splash
  const damage = f.u16(n);
  const bonus = f.u16(n);
  return { damage, bonus };
}

export type Race = "zerg" | "terran" | "protoss" | null;

/** The race a unit type belongs to, from its group flags. */
export function unitRace(units: UnitsDat, unitId: number): Race {
  const g = units.groupFlags[unitId] ?? 0;
  return g & 1 ? "zerg" : g & 2 ? "terran" : g & 4 ? "protoss" : null;
}

export function decodeFlingyDat(data: Uint8Array): FlingyDat {
  expectSize("flingy.dat", data, FLINGY_DAT_SIZE);
  return { sprite: new Fields(data).u16(FLINGY_TYPES) };
}

export function decodeSpritesDat(data: Uint8Array): SpritesDat {
  expectSize("sprites.dat", data, SPRITES_DAT_SIZE);
  return { image: new Fields(data).u16(SPRITE_TYPES) };
}

export function decodeImagesDat(data: Uint8Array): ImagesDat {
  expectSize("images.dat", data, IMAGES_DAT_SIZE);
  const n = IMAGE_TYPES;
  const f = new Fields(data);
  const grp = f.u32(n);
  const graphicTurns = f.u8(n);
  f.skip(n * 3); // clickable, use full iscript, draw if cloaked
  const drawFunction = f.u8(n);
  const remapping = f.u8(n);
  const iscript = f.u32(n);
  const shield = f.u32(n);
  const attack = f.u32(n);
  const damage = f.u32(n);
  const special = f.u32(n);
  const landing = f.u32(n);
  const liftOff = f.u32(n);
  return { grp, graphicTurns, drawFunction, remapping, iscript, lo: [attack, damage, special, landing, liftOff, shield] };
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
}

/** Struct of arrays: six u16 columns of cost, then unknown / icon / label u16s, then race, max repeats and the Brood War flag. */
export function decodeUpgradesDat(data: Uint8Array): UpgradesDat {
  expectSize("upgrades.dat", data, UPGRADES_DAT_SIZE);
  const n = UPGRADE_TYPES;
  const f = new Fields(data);
  const mineralCost = f.u16(n);
  const mineralFactor = f.u16(n);
  const vespeneCost = f.u16(n);
  const vespeneFactor = f.u16(n);
  const timeCost = f.u16(n);
  const timeFactor = f.u16(n);
  f.skip(n * 2 * 3); // requirements, icon, label
  f.skip(n); // race
  const maxRepeats = f.u8(n);
  const broodWar = f.u8(n);
  return { mineralCost, mineralFactor, vespeneCost, vespeneFactor, timeCost, timeFactor, maxRepeats, broodWar };
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
}

/** Struct of arrays: four u16 cost columns, then research / use requirements, icon and label u16s, race, an unused byte and the Brood War flag. */
export function decodeTechdataDat(data: Uint8Array): TechdataDat {
  expectSize("techdata.dat", data, TECHDATA_DAT_SIZE);
  const n = TECH_TYPES;
  const f = new Fields(data);
  const mineralCost = f.u16(n);
  const vespeneCost = f.u16(n);
  const researchTime = f.u16(n);
  const energyCost = f.u16(n);
  f.skip(n * 2 * 4); // research requirements, use requirements, icon, label
  f.skip(n * 2); // race, unused
  const broodWar = f.u8(n);
  return { mineralCost, vespeneCost, researchTime, energyCost, broodWar };
}
