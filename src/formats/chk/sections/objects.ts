import { Reader, Writer } from "../binary";

/* ── UNIT: placed units, 36 bytes each ───────────────────── */

export interface UnitRecord {
  serial: number;
  x: number;
  y: number;
  unitId: number;
  relationType: number;
  /** Bit set of which "special properties" fields below are meaningful. */
  validProperties: number;
  validStates: number;
  owner: number;
  hitPointsPercent: number;
  shieldPercent: number;
  energyPercent: number;
  resourceAmount: number;
  hangarUnits: number;
  stateFlags: number;
  unused: number;
  relatedSerial: number;
}

export const UNIT_STRIDE = 36;

/** `validProperties` bits (offset 0x0C): which special-property fields the game reads. */
export const UnitValid = { Cloak: 1, Burrow: 2, InTransit: 4, Hallucinated: 8, Invincible: 16 } as const;
/** `validStates` bits (offset 0x0E): which of the fields below are set ("properties used"). */
export const UnitUsed = { Owner: 1, HitPoints: 2, Shields: 4, Energy: 8, Resources: 16, Hangar: 32, State: 64 } as const;
/** `stateFlags` bits (offset 0x18): the special properties themselves. */
export const UnitState = { Cloaked: 1, Burrowed: 2, InTransit: 4, Hallucinated: 8, Invincible: 16 } as const;
/** `relationType` bits (offset 0x0A): how `relatedSerial` is linked. */
export const UnitRelation = { NydusLink: 0x200, Addon: 0x400 } as const;

export function decodeUnits(data: Uint8Array): UnitRecord[] {
  const r = new Reader(data);
  const out: UnitRecord[] = [];
  while (r.remaining >= UNIT_STRIDE) {
    out.push({
      serial: r.u32(),
      x: r.u16(),
      y: r.u16(),
      unitId: r.u16(),
      relationType: r.u16(),
      validProperties: r.u16(),
      validStates: r.u16(),
      owner: r.u8(),
      hitPointsPercent: r.u8(),
      shieldPercent: r.u8(),
      energyPercent: r.u8(),
      resourceAmount: r.u32(),
      hangarUnits: r.u16(),
      stateFlags: r.u16(),
      unused: r.u32(),
      relatedSerial: r.u32(),
    });
  }
  return out;
}

export function encodeUnits(units: UnitRecord[]): Uint8Array {
  const w = new Writer(units.length * UNIT_STRIDE || 16);
  for (const u of units) {
    w.u32(u.serial).u16(u.x).u16(u.y).u16(u.unitId).u16(u.relationType)
      .u16(u.validProperties).u16(u.validStates)
      .u8(u.owner).u8(u.hitPointsPercent).u8(u.shieldPercent).u8(u.energyPercent)
      .u32(u.resourceAmount).u16(u.hangarUnits).u16(u.stateFlags)
      .u32(u.unused).u32(u.relatedSerial);
  }
  return w.finish();
}

/* ── THG2: sprites, 10 bytes each ────────────────────────── */

export interface SpriteRecord {
  /** sprites.dat id for a pure sprite, units.dat id for a unit sprite (see `SpriteFlag.PureSprite`). */
  spriteId: number;
  x: number;
  y: number;
  owner: number;
  unused: number;
  /**
   * `SpriteFlag` bits. StarEdit writes a doodad's overlay sprite with the doodad's whole
   * CV5 flag word here, so real maps carry the terrain bits (0x80, 0x100, …) too.
   */
  flags: number;
}

export const SPRITE_STRIDE = 10;

/** THG2 `flags` bits. */
export const SpriteFlag = {
  /** Drawn as a sprite only; without it the game creates a unit of type `spriteId` (Installation doors and traps). */
  PureSprite: 0x1000,
  /** The doodad's overlay is mirrored (a CV5 doodad flag StarEdit copies through). */
  Flipped: 0x4000,
  /** Unit sprites only: the unit starts disabled (a closed door, an inactive trap). */
  Disabled: 0x8000,
} as const;

export function decodeSprites(data: Uint8Array): SpriteRecord[] {
  const r = new Reader(data);
  const out: SpriteRecord[] = [];
  while (r.remaining >= SPRITE_STRIDE) {
    out.push({ spriteId: r.u16(), x: r.u16(), y: r.u16(), owner: r.u8(), unused: r.u8(), flags: r.u16() });
  }
  return out;
}

export function encodeSprites(sprites: SpriteRecord[]): Uint8Array {
  const w = new Writer(sprites.length * SPRITE_STRIDE || 16);
  for (const s of sprites) w.u16(s.spriteId).u16(s.x).u16(s.y).u8(s.owner).u8(s.unused).u16(s.flags);
  return w.finish();
}

/* ── DD2: isometric doodads, 8 bytes each ────────────────── */

/**
 * One placed doodad, as StarEdit records it (the game never reads this section: it sees
 * only the doodad's tiles in MTXM and its overlay in THG2). `doodadId` is the index into
 * the tileset's `dddata.bin`, not a CV5 group; `x`/`y` are the pixel centre of the
 * footprint, so the top-left tile is `x / 32 - width / 2`.
 */
export interface DoodadRecord {
  doodadId: number;
  x: number;
  y: number;
  owner: number;
  /** 0 = enabled (every doodad in Blizzard's maps), 1 = disabled. */
  disabled: number;
}

export const DOODAD_STRIDE = 8;

export function decodeDoodads(data: Uint8Array): DoodadRecord[] {
  const r = new Reader(data);
  const out: DoodadRecord[] = [];
  while (r.remaining >= DOODAD_STRIDE) {
    out.push({ doodadId: r.u16(), x: r.u16(), y: r.u16(), owner: r.u8(), disabled: r.u8() });
  }
  return out;
}

export function encodeDoodads(doodads: DoodadRecord[]): Uint8Array {
  const w = new Writer(doodads.length * DOODAD_STRIDE || 16);
  for (const d of doodads) w.u16(d.doodadId).u16(d.x).u16(d.y).u8(d.owner).u8(d.disabled);
  return w.finish();
}

/* ── MRGN: locations, 20 bytes each ──────────────────────── */

export interface LocationRecord {
  left: number;
  top: number;
  right: number;
  bottom: number;
  nameIndex: number;
  /** Bit 0 low ground, 1 medium, 2 high, 3 low air, 4 medium air, 5 high air. */
  elevationFlags: number;
}

export const LOCATION_STRIDE = 20;
/** Location index 63 (1-based 64) is the fixed "Anywhere" location. */
export const ANYWHERE_INDEX = 63;

/**
 * `elevationFlags` bits. A *set* bit **excludes** that elevation from the location — the
 * game tests a unit's position against the location only on the elevations whose bit is
 * clear — so StarEdit's ticked "Low ground" box is bit 0 *clear*, and 0 means "everywhere".
 */
export const Elevation = { LowGround: 1, MediumGround: 2, HighGround: 4, LowAir: 8, MediumAir: 16, HighAir: 32 } as const;
export const ELEVATIONS: readonly { bit: number; label: string }[] = [
  { bit: Elevation.LowGround, label: "Low ground" },
  { bit: Elevation.MediumGround, label: "Medium ground" },
  { bit: Elevation.HighGround, label: "High ground" },
  { bit: Elevation.LowAir, label: "Low air" },
  { bit: Elevation.MediumAir, label: "Medium air" },
  { bit: Elevation.HighAir, label: "High air" },
];
/** All six bits: the mask an elevation word is confined to. */
export const ELEVATION_MASK = 0x3f;

export function decodeLocations(data: Uint8Array): LocationRecord[] {
  const r = new Reader(data);
  const out: LocationRecord[] = [];
  while (r.remaining >= LOCATION_STRIDE) {
    out.push({ left: r.i32(), top: r.i32(), right: r.i32(), bottom: r.i32(), nameIndex: r.u16(), elevationFlags: r.u16() });
  }
  return out;
}

export function encodeLocations(locations: LocationRecord[]): Uint8Array {
  const w = new Writer(locations.length * LOCATION_STRIDE || 16);
  for (const l of locations) w.i32(l.left).i32(l.top).i32(l.right).i32(l.bottom).u16(l.nameIndex).u16(l.elevationFlags);
  return w.finish();
}

/** A location is "unused" when it is degenerate and unnamed. */
export function isLocationUsed(l: LocationRecord): boolean {
  return l.nameIndex !== 0 || l.left !== l.right || l.top !== l.bottom;
}
