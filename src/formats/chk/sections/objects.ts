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
  spriteId: number;
  x: number;
  y: number;
  owner: number;
  unused: number;
  /** 0x1000 = draw as sprite only (no unit); 0x8000 = disabled. */
  flags: number;
}

export const SPRITE_STRIDE = 10;

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

export interface DoodadRecord {
  doodadId: number;
  x: number;
  y: number;
  owner: number;
  enabled: number;
}

export const DOODAD_STRIDE = 8;

export function decodeDoodads(data: Uint8Array): DoodadRecord[] {
  const r = new Reader(data);
  const out: DoodadRecord[] = [];
  while (r.remaining >= DOODAD_STRIDE) {
    out.push({ doodadId: r.u16(), x: r.u16(), y: r.u16(), owner: r.u8(), enabled: r.u8() });
  }
  return out;
}

export function encodeDoodads(doodads: DoodadRecord[]): Uint8Array {
  const w = new Writer(doodads.length * DOODAD_STRIDE || 16);
  for (const d of doodads) w.u16(d.doodadId).u16(d.x).u16(d.y).u8(d.owner).u8(d.enabled);
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
