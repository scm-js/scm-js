/**
 * UPRP / UPUS: the Create Unit with Properties slots. The action names a slot (1-based,
 * in its `target` field) and the game applies the slot's properties to every unit it
 * creates: a percentage of hit points, shields and energy, a resource amount, a hangar
 * count, and the special states (cloaked, burrowed, in transit, hallucinated, invincible).
 * Each of those is only applied when its "valid" bit is on, so a slot can set the hit
 * points alone and leave the rest at the unit's defaults.
 *
 * UPRP is 64 slots of 20 bytes and the game reads it; UPUS is StarEdit's 64 "slot in use"
 * bytes, one per slot, and the game ignores it — the editor keeps it so a slot the
 * author cleared stays cleared in StarEdit too. The fields use the bit layouts of the
 * UNIT record (`UnitValid` / `UnitUsed` / `UnitState` in objects.ts) for the same things.
 */
import { Reader, Writer } from "../binary";

export const CUWP_SLOTS = 64;
export const CUWP_STRIDE = 20;
export const UPRP_SIZE = CUWP_SLOTS * CUWP_STRIDE;
export const UPUS_SIZE = CUWP_SLOTS;

/** `validProperties` bits: which special states the slot sets (the state itself is in `stateFlags`). */
export const CuwpValid = { Cloak: 1, Burrow: 2, InTransit: 4, Hallucinated: 8, Invincible: 16 } as const;
/** `validFields` bits: which of the numeric fields the slot applies. `Owner` is never used by the game. */
export const CuwpField = { Owner: 1, HitPoints: 2, Shields: 4, Energy: 8, Resources: 16, Hangar: 32 } as const;
/** `stateFlags` bits. */
export const CuwpState = { Cloaked: 1, Burrowed: 2, InTransit: 4, Hallucinated: 8, Invincible: 16 } as const;

export interface CuwpSlot {
  /** `CuwpValid` bits. */
  validProperties: number;
  /** `CuwpField` bits. */
  validFields: number;
  /** Unused by the game; StarEdit writes 0. */
  owner: number;
  hitPointsPercent: number;
  shieldsPercent: number;
  energyPercent: number;
  resources: number;
  hangar: number;
  /** `CuwpState` bits. */
  stateFlags: number;
  /** The record's last four bytes, kept for fidelity. */
  unused: number;
}

export function blankCuwpSlot(): CuwpSlot {
  return { validProperties: 0, validFields: 0, owner: 0, hitPointsPercent: 100, shieldsPercent: 100, energyPercent: 100, resources: 0, hangar: 0, stateFlags: 0, unused: 0 };
}

/** A slot as StarEdit stores one nobody has touched: every field zero. */
export function emptyCuwpSlot(): CuwpSlot {
  return { validProperties: 0, validFields: 0, owner: 0, hitPointsPercent: 0, shieldsPercent: 0, energyPercent: 0, resources: 0, hangar: 0, stateFlags: 0, unused: 0 };
}

export function decodeCuwp(data: Uint8Array): CuwpSlot[] {
  const r = new Reader(data);
  const out: CuwpSlot[] = [];
  for (let i = 0; i < CUWP_SLOTS; i++) {
    if (r.remaining < CUWP_STRIDE) { out.push(emptyCuwpSlot()); continue; }
    out.push({
      validProperties: r.u16(),
      validFields: r.u16(),
      owner: r.u8(),
      hitPointsPercent: r.u8(),
      shieldsPercent: r.u8(),
      energyPercent: r.u8(),
      resources: r.u32(),
      hangar: r.u16(),
      stateFlags: r.u16(),
      unused: r.u32(),
    });
  }
  return out;
}

export function encodeCuwp(slots: readonly CuwpSlot[]): Uint8Array {
  const w = new Writer(UPRP_SIZE);
  for (let i = 0; i < CUWP_SLOTS; i++) {
    const s = slots[i] ?? emptyCuwpSlot();
    w.u16(s.validProperties);
    w.u16(s.validFields);
    w.u8(s.owner);
    w.u8(s.hitPointsPercent);
    w.u8(s.shieldsPercent);
    w.u8(s.energyPercent);
    w.u32(s.resources);
    w.u16(s.hangar);
    w.u16(s.stateFlags);
    w.u32(s.unused);
  }
  return w.finish();
}

export function decodeCuwpUsed(data: Uint8Array): boolean[] {
  return Array.from({ length: CUWP_SLOTS }, (_, i) => (data[i] ?? 0) !== 0);
}

export function encodeCuwpUsed(used: readonly boolean[]): Uint8Array {
  const out = new Uint8Array(UPUS_SIZE);
  for (let i = 0; i < CUWP_SLOTS; i++) out[i] = used[i] ? 1 : 0;
  return out;
}

export function defaultCuwp(): CuwpSlot[] {
  return Array.from({ length: CUWP_SLOTS }, emptyCuwpSlot);
}

export function defaultCuwpUsed(): boolean[] {
  return Array.from({ length: CUWP_SLOTS }, () => false);
}

/** Whether the slot sets anything at all — the game's view, independent of UPUS. */
export function cuwpSlotActive(s: CuwpSlot): boolean {
  return s.validProperties !== 0 || s.validFields !== 0;
}

/** A one-line reading of a slot for lists: `HP 50%, shields 100%, cloaked`. */
export function describeCuwpSlot(s: CuwpSlot): string {
  const parts: string[] = [];
  if (s.validFields & CuwpField.HitPoints) parts.push(`HP ${s.hitPointsPercent}%`);
  if (s.validFields & CuwpField.Shields) parts.push(`shields ${s.shieldsPercent}%`);
  if (s.validFields & CuwpField.Energy) parts.push(`energy ${s.energyPercent}%`);
  if (s.validFields & CuwpField.Resources) parts.push(`${s.resources} resources`);
  if (s.validFields & CuwpField.Hangar) parts.push(`hangar ${s.hangar}`);
  const states: [number, number, string][] = [
    [CuwpValid.Cloak, CuwpState.Cloaked, "cloaked"],
    [CuwpValid.Burrow, CuwpState.Burrowed, "burrowed"],
    [CuwpValid.InTransit, CuwpState.InTransit, "in transit"],
    [CuwpValid.Hallucinated, CuwpState.Hallucinated, "hallucinated"],
    [CuwpValid.Invincible, CuwpState.Invincible, "invincible"],
  ];
  for (const [valid, state, name] of states) {
    if (s.validProperties & valid) parts.push(s.stateFlags & state ? name : `not ${name}`);
  }
  return parts.length > 0 ? parts.join(", ") : "nothing set";
}
