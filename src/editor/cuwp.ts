/**
 * The Create Unit with Properties slots (UPRP / UPUS) as a settings-style transaction:
 * the dialog edits a working copy of the 64 slots and their "in use" ticks and installs
 * it with `applyCuwp`, which marks only what changed. A map that arrived without the
 * sections gets them on the first apply — the game needs UPRP to load a map at all, and
 * Check Map already says so — and `cuwpUsage` says which triggers name each slot, so the
 * dialog can warn before a slot a trigger points at is cleared.
 */
import { markDirty, type Scenario } from "../formats/chk/scenario";
import {
  CUWP_SLOTS, CuwpField, CuwpState, CuwpValid, cuwpSlotActive, defaultCuwp, defaultCuwpUsed, describeCuwpSlot, emptyCuwpSlot, type CuwpSlot,
} from "../formats/chk/sections/cuwp";
import { ActionType } from "../formats/chk/sections/triggers";

export { CUWP_SLOTS, CuwpField, CuwpState, CuwpValid, cuwpSlotActive, describeCuwpSlot, emptyCuwpSlot, type CuwpSlot };

export interface CuwpTable {
  slots: CuwpSlot[];
  /** UPUS: StarEdit's tick per slot. */
  used: boolean[];
}

/** A working copy: the file's slots, or 64 empty ones when it has no UPRP. */
export function readCuwp(scn: Scenario): CuwpTable {
  return {
    slots: (scn.cuwp ?? defaultCuwp()).map((s) => ({ ...s })),
    used: (scn.cuwpUsed ?? defaultCuwpUsed()).slice(),
  };
}

/** Per slot (0-based), how many Create Unit with Properties actions name it (the action's `target` is 1-based). */
export function cuwpUsage(scn: Scenario): number[] {
  const out = Array.from({ length: CUWP_SLOTS }, () => 0);
  for (const t of scn.triggers) {
    for (const a of t.actions) {
      if (a.type !== ActionType.CreateUnitWithProperties) continue;
      const i = a.target - 1;
      if (i >= 0 && i < CUWP_SLOTS) out[i]++;
    }
  }
  return out;
}

function sameSlot(a: CuwpSlot, b: CuwpSlot): boolean {
  return a.validProperties === b.validProperties && a.validFields === b.validFields && a.owner === b.owner
    && a.hitPointsPercent === b.hitPointsPercent && a.shieldsPercent === b.shieldsPercent && a.energyPercent === b.energyPercent
    && a.resources === b.resources && a.hangar === b.hangar && a.stateFlags === b.stateFlags && a.unused === b.unused;
}

/**
 * Install an edited table. UPRP is marked dirty when a slot differs (or the file had no
 * section), UPUS when a tick differs; a file that never had UPUS gets one only when a
 * tick is on, since the game does not read it. Returns the sections it marked, empty
 * when nothing changed.
 */
export function applyCuwp(scn: Scenario, table: CuwpTable): string[] {
  const touched: string[] = [];
  const slots = Array.from({ length: CUWP_SLOTS }, (_, i) => ({ ...(table.slots[i] ?? emptyCuwpSlot()) }));
  if (!scn.cuwp || slots.some((s, i) => !sameSlot(s, scn.cuwp![i]))) {
    scn.cuwp = slots;
    markDirty(scn, "UPRP");
    touched.push("UPRP");
  }
  const used = Array.from({ length: CUWP_SLOTS }, (_, i) => table.used[i] === true);
  const hadUpus = scn.cuwpUsed !== null;
  if (hadUpus ? used.some((u, i) => u !== scn.cuwpUsed![i]) : used.some((u) => u)) {
    scn.cuwpUsed = used;
    markDirty(scn, "UPUS");
    touched.push("UPUS");
  }
  return touched;
}

/** The label a slot shows in lists and the trigger editor's pick: `3 · HP 50%, cloaked`. */
export function cuwpSlotLabel(index: number, slot: CuwpSlot | undefined, used?: boolean): string {
  const n = index + 1;
  if (!slot) return `Slot ${n}`;
  if (!cuwpSlotActive(slot)) return used ? `Slot ${n} · in use, nothing set` : `Slot ${n} · empty`;
  return `Slot ${n} · ${describeCuwpSlot(slot)}`;
}

/** A slot patch the way the dialog and the plugin API both apply one: only the named fields move. */
export interface CuwpSlotPatch {
  /** `null` leaves the field at the unit's default (clears its valid bit); a number sets it and the bit. */
  hitPointsPercent?: number | null;
  shieldsPercent?: number | null;
  energyPercent?: number | null;
  resources?: number | null;
  hangar?: number | null;
  /** `null` leaves the state alone; a boolean forces it. */
  cloaked?: boolean | null;
  burrowed?: boolean | null;
  inTransit?: boolean | null;
  hallucinated?: boolean | null;
  invincible?: boolean | null;
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));

export function patchCuwpSlot(slot: CuwpSlot, patch: CuwpSlotPatch): CuwpSlot {
  const s = { ...slot };
  const field = (key: keyof CuwpSlotPatch, bit: number, prop: "hitPointsPercent" | "shieldsPercent" | "energyPercent" | "resources" | "hangar", max: number) => {
    const v = patch[key];
    if (v === undefined) return;
    if (v === null) { s.validFields &= ~bit; return; }
    s.validFields |= bit;
    s[prop] = clamp(v as number, max);
  };
  field("hitPointsPercent", CuwpField.HitPoints, "hitPointsPercent", 100);
  field("shieldsPercent", CuwpField.Shields, "shieldsPercent", 100);
  field("energyPercent", CuwpField.Energy, "energyPercent", 100);
  field("resources", CuwpField.Resources, "resources", 0xffffffff);
  field("hangar", CuwpField.Hangar, "hangar", 0xffff);
  const state = (key: keyof CuwpSlotPatch, valid: number, bit: number) => {
    const v = patch[key];
    if (v === undefined) return;
    if (v === null) { s.validProperties &= ~valid; s.stateFlags &= ~bit; return; }
    s.validProperties |= valid;
    if (v) s.stateFlags |= bit; else s.stateFlags &= ~bit;
  };
  state("cloaked", CuwpValid.Cloak, CuwpState.Cloaked);
  state("burrowed", CuwpValid.Burrow, CuwpState.Burrowed);
  state("inTransit", CuwpValid.InTransit, CuwpState.InTransit);
  state("hallucinated", CuwpValid.Hallucinated, CuwpState.Hallucinated);
  state("invincible", CuwpValid.Invincible, CuwpState.Invincible);
  return s;
}

/** The slot as a patch-shaped view: null where the unit's default applies. */
export interface CuwpSlotView {
  index: number;
  used: boolean;
  /** How many Create Unit with Properties actions name the slot. */
  references: number;
  hitPointsPercent: number | null;
  shieldsPercent: number | null;
  energyPercent: number | null;
  resources: number | null;
  hangar: number | null;
  cloaked: boolean | null;
  burrowed: boolean | null;
  inTransit: boolean | null;
  hallucinated: boolean | null;
  invincible: boolean | null;
  summary: string;
}

export function cuwpSlotView(scn: Scenario, index: number, usage: number[] = cuwpUsage(scn)): CuwpSlotView | null {
  if (index < 0 || index >= CUWP_SLOTS) return null;
  const s = scn.cuwp?.[index] ?? emptyCuwpSlot();
  const f = (bit: number, v: number) => (s.validFields & bit ? v : null);
  const st = (valid: number, bit: number) => (s.validProperties & valid ? (s.stateFlags & bit) !== 0 : null);
  return {
    index,
    used: scn.cuwpUsed?.[index] ?? false,
    references: usage[index] ?? 0,
    hitPointsPercent: f(CuwpField.HitPoints, s.hitPointsPercent),
    shieldsPercent: f(CuwpField.Shields, s.shieldsPercent),
    energyPercent: f(CuwpField.Energy, s.energyPercent),
    resources: f(CuwpField.Resources, s.resources),
    hangar: f(CuwpField.Hangar, s.hangar),
    cloaked: st(CuwpValid.Cloak, CuwpState.Cloaked),
    burrowed: st(CuwpValid.Burrow, CuwpState.Burrowed),
    inTransit: st(CuwpValid.InTransit, CuwpState.InTransit),
    hallucinated: st(CuwpValid.Hallucinated, CuwpState.Hallucinated),
    invincible: st(CuwpValid.Invincible, CuwpState.Invincible),
    summary: describeCuwpSlot(s),
  };
}

export function cuwpSlotViews(scn: Scenario): CuwpSlotView[] {
  const usage = cuwpUsage(scn);
  return Array.from({ length: CUWP_SLOTS }, (_, i) => cuwpSlotView(scn, i, usage)!);
}

/**
 * Patch one slot in place, the plugin API's write: sets the slot, ticks it in use when
 * anything is set, and answers with the sections it marked.
 */
export function patchCuwp(scn: Scenario, index: number, patch: CuwpSlotPatch, used?: boolean): string[] {
  if (index < 0 || index >= CUWP_SLOTS) return [];
  const table = readCuwp(scn);
  table.slots[index] = patchCuwpSlot(table.slots[index], patch);
  table.used[index] = used ?? (table.used[index] || cuwpSlotActive(table.slots[index]));
  return applyCuwp(scn, table);
}
