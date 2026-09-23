/**
 * Editing one map from several editors at once: the changes a map makes, in a form that
 * travels, and how each is applied to a map that may have moved on since it was made.
 *
 * A server (the scmjs.dev plugin's rooms) puts every change in one order and hands it
 * to everyone. Each editor applies the changes in that order with `applyOp`, which is
 * deterministic: the same op on the same map gives the same map, so everyone who applies
 * the same sequence ends up with the same map. Positions in the unit, doodad and sprite
 * lists shift under other people's insertions and removals, so a list change finds its
 * record by content (the record it expects to replace or remove) and is dropped when the
 * record is gone; a tile, lattice or fog cell takes the value it is given (the later
 * change wins); a location lands in its slot unless it is a new one and someone else
 * took the slot, and its name travels as text.
 *
 * Your own changes are applied at once and sent; until the server confirms one, it is
 * *pending*. When another person's change arrives first, `SyncCore.receive` takes the
 * pending ones back (every applied op keeps what it needs to be undone exactly), applies
 * theirs, and applies yours again on top — in the order the server will give everyone.
 * Your own edits are re-applied through `applyOp` the moment they are made, too
 * (`commitEdit`), so what you see is always what everyone else will compute.
 *
 * Settings and trigger dialogs write whole tables (`fields`, the last write wins per
 * table; the string table per slot, with a clash moved to a new slot), files inside the
 * archive travel whole (`extras`), and a change to the whole document — resize, tileset,
 * a raw section edit — travels as the scenario's bytes (`reset`).
 */
import { markDirty, parseScenario, serializeScenario, strSectionName, techRestrictionSections, techSettingsSections, unitSettingsSections, upgradeRestrictionSections, upgradeSettingsSections, type Scenario } from "../formats/chk/scenario";
import { isLocationUsed, type DoodadRecord, type LocationRecord, type SpriteRecord, type UnitRecord } from "../formats/chk/sections/objects";
import type { TriggerRecord } from "../formats/chk/sections/triggers";
import type { TextEncoding } from "../formats/text/encoding";
import { actionDef } from "../data/triggerDefs";
import { applyEntry, hasEdits, type HistoryEdit, type HistoryEntry } from "./history";
import type { TileChange } from "./terrain";
import { applyUnitChanges, type UnitChange } from "./units";
import { applyDoodadChanges, type DoodadChange } from "./doodads";
import { applySpriteChanges, type SpriteChange } from "./sprites";
import { applyLocationChanges, blankLocation, firstFreeSlot, type LocationChange } from "./locations";

/** Bumped when an op's shape changes in a way an older editor would misread. */
export const SYNC_FORMAT = 1;

/* ── Ops ─────────────────────────────────────────────────── */

export interface WireListChange<T> {
  index: number;
  before: T | null;
  after: T | null;
}

export interface WireLocationChange {
  index: number;
  after: LocationRecord;
  /** The name as text (`after.nameIndex` is resolved again where it lands); null for none. */
  name: string | null;
  /** The slot was empty before: a new location, which moves to a free slot if someone else took this one. */
  created: boolean;
}

/**
 * One undo step's worth of terrain and objects. The grids are flat number lists: terrain
 * `[at, mtxm, tile, …]`, the others `[at, value, …]`. `reverse` marks the undo of an edit:
 * its parts go in the reverse of the usual order, as undo walks them.
 */
export interface SyncEditOp {
  kind: "edit";
  label: string;
  /** The map size the cells index; a grid part is skipped on a map of another size. */
  width: number;
  height: number;
  reverse?: boolean;
  terrain?: number[];
  isom?: number[];
  doodadTiles?: number[];
  fog?: number[];
  /** The whole ISOM lattice (base64 of the u16 cells) the edit gave the map, or null for taking it away. */
  isomWhole?: string | null;
  maskWhole?: string | null;
  units?: WireListChange<UnitRecord>[];
  doodads?: WireListChange<DoodadRecord>[];
  sprites?: WireListChange<SpriteRecord>[];
  locations?: WireLocationChange[];
}

/** The scenario fields the settings, sound and trigger dialogs write whole. */
export const SYNC_FIELDS = [
  "type", "fileVersion", "nameIndex", "descriptionIndex", "playerTypes", "editorPlayerTypes", "playerRaces", "playerColors", "playerRgb", "forces",
  "unitSettings", "unitAvailability", "upgradeSettings", "upgradeRestrictions", "techSettings", "techRestrictions", "wavs", "cuwp", "cuwpUsed",
  "triggers", "briefing", "switchNames",
] as const satisfies readonly (keyof Scenario)[];
export type SyncField = (typeof SYNC_FIELDS)[number];

/** The sections each field is written to, for `markDirty`. */
const FIELD_SECTIONS: Record<SyncField, (scn: Scenario) => string[]> = {
  type: () => ["TYPE"],
  fileVersion: () => ["VER "],
  nameIndex: () => ["SPRP"],
  descriptionIndex: () => ["SPRP"],
  playerTypes: () => ["OWNR"],
  editorPlayerTypes: () => ["IOWN"],
  playerRaces: () => ["SIDE"],
  playerColors: () => ["COLR"],
  playerRgb: () => ["CRGB"],
  forces: () => ["FORC"],
  unitSettings: unitSettingsSections,
  unitAvailability: () => ["PUNI"],
  upgradeSettings: upgradeSettingsSections,
  upgradeRestrictions: upgradeRestrictionSections,
  techSettings: techSettingsSections,
  techRestrictions: techRestrictionSections,
  wavs: () => ["WAV "],
  cuwp: () => ["UPRP"],
  cuwpUsed: () => ["UPUS"],
  triggers: () => ["TRIG"],
  briefing: () => ["MBRF"],
  switchNames: () => ["SWNM"],
};

export interface SyncFieldsOp {
  kind: "fields";
  /** Each changed field's new value, packed (`pack`). */
  set: Partial<Record<SyncField, unknown>>;
  /** String slots that changed: `[index, before, after]`. */
  strings?: [number, string | null, string | null][];
  /** The table's length afterwards (trailing blank slots are dropped). */
  stringsLength?: number;
  /** The table's width and text encoding, when they changed. */
  stringsFormat?: { extended: boolean; encoding: TextEncoding };
}

export interface SyncExtrasOp {
  kind: "extras";
  /** `[member name, base64 bytes]`, or null bytes for a member taken out. */
  set: [string, string | null][];
}

export interface SyncResetOp {
  kind: "reset";
  label: string;
  /** The whole scenario, base64. */
  chk: string;
}

export type SyncOp = SyncEditOp | SyncFieldsOp | SyncExtrasOp | SyncResetOp;

/** What the ops act on: one open map. `applyOp` may replace either member. */
export interface SyncDoc {
  scn: Scenario;
  extras: Map<string, Uint8Array>;
}

/** Cells an op wrote, per grid — what the local history must stop claiming. */
export interface SyncCells {
  tiles: number[];
  isom: number[];
  fog: number[];
}

export interface Applied {
  /** Take the op back exactly; the document must be as the application left it. */
  rollback(doc: SyncDoc): void;
  /**
   * An edit op's result as a history entry's lists: for a forward edit the entry whose undo
   * takes it back, for a `reverse` one the entry it undid (what redo would apply again).
   */
  edit?: HistoryEdit;
  cells?: SyncCells;
  /** Parts that could not be applied (their record was gone, the map was another size…). */
  dropped: number;
}

/* ── Bytes and values ────────────────────────────────────── */

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const u16Base64 = (a: Uint16Array) => toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
const u16FromBase64 = (text: string) => {
  const b = fromBase64(text);
  return new Uint16Array(b.buffer, 0, b.byteLength >> 1);
};

const TYPED = { Uint8Array, Uint16Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array } as const;
type TypedName = keyof typeof TYPED;

/** A deep copy that JSON can carry: typed arrays become `{ $t, d }`. */
export function pack(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (ArrayBuffer.isView(value)) return { $t: value.constructor.name, d: Array.from(value as unknown as ArrayLike<number>) };
  if (Array.isArray(value)) return value.map(pack);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (v !== undefined) out[k] = pack(v);
  return out;
}

export function unpack(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(unpack);
  const o = value as Record<string, unknown>;
  if (typeof o.$t === "string" && Array.isArray(o.d) && o.$t in TYPED) return new TYPED[o.$t as TypedName](o.d as number[]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) out[k] = unpack(v);
  return out;
}

function sameRecord(a: object, b: object): boolean {
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  return true;
}

/** Where `record` is in `list`: at `hint` when it is still there, else the nearest equal record, else -1. */
function findRecord<T extends object>(list: readonly T[], record: T, hint: number): number {
  if (hint >= 0 && hint < list.length && sameRecord(list[hint], record)) return hint;
  let best = -1;
  for (let i = 0; i < list.length; i++) {
    if (!sameRecord(list[i], record)) continue;
    if (best < 0 || Math.abs(i - hint) < Math.abs(best - hint)) best = i;
  }
  return best;
}

const isCell = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;

/* ── Building an edit op ─────────────────────────────────── */

function locationName(scn: Scenario, record: LocationRecord, pending?: { index: number; after: string | null }): string | null {
  if (record.nameIndex === 0) return null;
  if (pending && pending.index === record.nameIndex) return pending.after;
  return scn.strings.strings[record.nameIndex] ?? null;
}

/**
 * The op for a history entry, applied forward (`"do"`, what a commit or a redo sends) or
 * backward (`"undo"`). Read from the map as it is *before* the op is applied again: an
 * undo's location names are looked up while the old names are still in the table.
 */
export function toSyncEdit(scn: Scenario, entry: HistoryEntry, direction: "do" | "undo"): SyncEditOp {
  const op: SyncEditOp = { kind: "edit", label: entry.label, width: scn.width, height: scn.height };
  const fwd = direction === "do";
  if (!fwd) op.reverse = true;
  const order = <T>(list: readonly T[]) => (fwd ? list : [...list].reverse());
  const cells = (list: readonly TileChange[] | undefined) => {
    if (!list?.length) return undefined;
    const out: number[] = [];
    for (const c of order(list)) out.push(c.at, fwd ? c.after : c.before);
    return out;
  };
  if (entry.changes.length) {
    const out: number[] = [];
    for (const c of order(entry.changes)) out.push(c.at, fwd ? c.after : c.before, fwd ? c.after : c.under ?? c.before);
    op.terrain = out;
  }
  op.isom = cells(entry.isom);
  op.doodadTiles = cells(entry.doodadTiles);
  op.fog = cells(entry.fog);
  if (entry.createdIsom) op.isomWhole = fwd ? u16Base64(entry.createdIsom) : null;
  if (entry.createdMask) op.maskWhole = fwd ? toBase64(entry.createdMask) : null;
  const list = <T>(changes: readonly { index: number; before: T | null; after: T | null }[] | undefined): WireListChange<T>[] | undefined =>
    changes?.length ? order(changes).map((c) => ({ index: c.index, before: fwd ? c.before : c.after, after: fwd ? c.after : c.before })) : undefined;
  op.units = list(entry.units);
  op.doodads = list(entry.doodads);
  op.sprites = list(entry.sprites);
  if (entry.locations?.length) {
    op.locations = order(entry.locations).map((c) => {
      const from = fwd ? c.before : c.after;
      const to = fwd ? c.after : c.before;
      return { index: c.index, after: { ...to }, name: fwd ? locationName(scn, to, c.string) : locationName(scn, to), created: !isLocationUsed(from) && isLocationUsed(to) };
    });
  }
  for (const k of Object.keys(op) as (keyof SyncEditOp)[]) if (op[k] === undefined) delete op[k];
  return op;
}

/* ── Applying an edit op ─────────────────────────────────── */

function applyEditOp(doc: SyncDoc, op: SyncEditOp): Applied {
  const scn = doc.scn;
  const reverse = op.reverse === true;
  const sameGrid = op.width === scn.width && op.height === scn.height;
  const size = scn.width * scn.height;
  let dropped = 0;
  const cells: SyncCells = { tiles: [], isom: [], fog: [] };
  // What was applied, in application order; `edit` is built from these at the end.
  const terrain: TileChange[] = [];
  const isom: TileChange[] = [];
  const doodadTiles: TileChange[] = [];
  const fog: TileChange[] = [];
  const units: UnitChange[] = [];
  const doodads: DoodadChange[] = [];
  const sprites: SpriteChange[] = [];
  const locations: LocationChange[] = [];
  let isomSet: { before: Uint16Array | null; after: Uint16Array | null } | null = null;
  let maskSet: { before: Uint8Array | null; after: Uint8Array | null } | null = null;

  const grid = (flat: number[] | undefined, stride: number, fn: (at: number, v: number[]) => void) => {
    if (!flat?.length) return;
    if (!sameGrid) { dropped++; return; }
    for (let i = 0; i + stride <= flat.length; i += stride) {
      const at = flat[i];
      if (!isCell(at) || at >= size) { dropped++; continue; }
      fn(at, flat.slice(i + 1, i + stride));
    }
  };

  const list = <T extends object>(target: T[], wire: WireListChange<T>[] | undefined, out: { index: number; before: T | null; after: T | null }[], apply: (c: { index: number; before: T | null; after: T | null }) => void) => {
    for (const w of wire ?? []) {
      let c: { index: number; before: T | null; after: T | null } | null = null;
      if (w.before && w.after) {
        const at = findRecord(target, w.before, w.index);
        if (at >= 0) c = { index: at, before: target[at], after: { ...w.after } };
      } else if (w.after) {
        c = { index: Math.max(0, Math.min(isCell(w.index) ? w.index : target.length, target.length)), before: null, after: { ...w.after } };
      } else if (w.before) {
        const at = findRecord(target, w.before, w.index);
        if (at >= 0) c = { index: at, before: target[at], after: null };
      }
      if (!c) { dropped++; continue; }
      apply(c);
      out.push(c);
    }
  };

  const steps: (() => void)[] = [
    () => {
      if (op.isomWhole !== undefined && sameGrid) {
        const after = op.isomWhole === null ? null : u16FromBase64(op.isomWhole);
        isomSet = { before: scn.isom, after };
        scn.isom = after;
        markDirty(scn, "ISOM");
      }
      if (op.maskWhole !== undefined && sameGrid) {
        const after = op.maskWhole === null ? null : fromBase64(op.maskWhole);
        maskSet = { before: scn.mask, after };
        scn.mask = after;
        markDirty(scn, "MASK");
      }
    },
    () => grid(op.terrain, 3, (at, [m, t]) => {
      terrain.push({ at, before: scn.tiles[at], after: m, under: scn.editorTiles[at] });
      scn.tiles[at] = m;
      scn.editorTiles[at] = t;
      cells.tiles.push(at);
      markDirty(scn, "MTXM", "TILE");
    }),
    () => {
      if (!op.isom?.length) return;
      const lattice = scn.isom;
      if (!lattice || !sameGrid) { dropped++; return; }
      for (let i = 0; i + 2 <= op.isom.length; i += 2) {
        const at = op.isom[i];
        if (!isCell(at) || at >= lattice.length) { dropped++; continue; }
        isom.push({ at, before: lattice[at], after: op.isom[i + 1] });
        lattice[at] = op.isom[i + 1];
        cells.isom.push(at);
      }
      if (isom.length) markDirty(scn, "ISOM");
    },
    () => grid(op.doodadTiles, 2, (at, [v]) => {
      doodadTiles.push({ at, before: scn.tiles[at], after: v });
      scn.tiles[at] = v;
      cells.tiles.push(at);
      markDirty(scn, "MTXM", "TILE");
    }),
    () => list(scn.doodads, op.doodads, doodads, (c) => applyDoodadChanges(scn, [c])),
    () => list(scn.sprites, op.sprites, sprites, (c) => applySpriteChanges(scn, [c])),
    () => list(scn.units, op.units, units, (c) => applyUnitChanges(scn, [c])),
    () => {
      for (const w of op.locations ?? []) {
        let index = isCell(w.index) ? w.index : -1;
        if (index < 0) { dropped++; continue; }
        if (w.created && index < scn.locations.length && isLocationUsed(scn.locations[index])) index = firstFreeSlot(scn);
        if (index < 0) { dropped++; continue; }
        const table = scn.strings.strings;
        let nameIndex = 0;
        let string: LocationChange["string"];
        if (w.name !== null) {
          nameIndex = table.indexOf(w.name, 1);
          if (nameIndex < 1) {
            nameIndex = Math.max(1, table.length);
            string = { index: nameIndex, before: null, after: w.name };
          }
        }
        const c: LocationChange = { index, before: scn.locations[index] ?? blankLocation(), after: { ...w.after, nameIndex }, string };
        if (!string) delete c.string;
        applyLocationChanges(scn, [c]);
        locations.push(c);
      }
    },
    () => {
      if (op.fog?.length && !scn.mask) { dropped++; return; }
      const mask = scn.mask;
      if (!mask) return;
      grid(op.fog, 2, (at, [v]) => {
        fog.push({ at, before: mask[at], after: v });
        mask[at] = v;
        cells.fog.push(at);
      });
      if (fog.length) markDirty(scn, "MASK");
    },
  ];
  if (reverse) steps.reverse();
  for (const step of steps) step();

  // A forward edit: the applied changes are the entry, in application order. A reverse
  // one did the undo of an entry E; E's changes are the applied ones swapped and reversed
  // (undo walks a list backwards), and E's `do` is what takes the op back.
  const swap = <T extends { index: number; before: unknown; after: unknown }>(l: T[]): T[] => [...l].reverse().map((c) => ({ ...c, before: c.after, after: c.before }));
  const edit: HistoryEdit = { changes: [] };
  if (!reverse) {
    edit.changes = terrain;
    if (isom.length) edit.isom = isom;
    if (doodadTiles.length) edit.doodadTiles = doodadTiles;
    if (fog.length) edit.fog = fog;
    if (units.length) edit.units = units;
    if (doodads.length) edit.doodads = doodads;
    if (sprites.length) edit.sprites = sprites;
    if (locations.length) edit.locations = locations;
    const is = isomSet as { before: Uint16Array | null; after: Uint16Array | null } | null;
    if (is?.after && !is.before) edit.createdIsom = is.after;
    const ms = maskSet as { before: Uint8Array | null; after: Uint8Array | null } | null;
    if (ms?.after && !ms.before) edit.createdMask = ms.after;
  } else {
    const tiles = (l: TileChange[]) => [...l].reverse().map((c) => ({ at: c.at, before: c.after, after: c.before }));
    // `under` is what undo writes to TILE: the value this op wrote there.
    edit.changes = [...terrain].reverse().map((c) => ({ at: c.at, before: c.after, after: c.before, under: scn.editorTiles[c.at] }));
    if (isom.length) edit.isom = tiles(isom);
    if (doodadTiles.length) edit.doodadTiles = tiles(doodadTiles);
    if (fog.length) edit.fog = tiles(fog);
    if (units.length) edit.units = swap(units);
    if (doodads.length) edit.doodads = swap(doodads);
    if (sprites.length) edit.sprites = swap(sprites);
    if (locations.length) {
      edit.locations = [...locations].reverse().map((c) => {
        const out: LocationChange = { index: c.index, before: c.after, after: c.before };
        if (c.string) out.string = { index: c.string.index, before: c.string.after, after: c.string.before };
        return out;
      });
    }
    const is = isomSet as { before: Uint16Array | null; after: Uint16Array | null } | null;
    if (is?.before && !is.after) edit.createdIsom = is.before;
    const ms = maskSet as { before: Uint8Array | null; after: Uint8Array | null } | null;
    if (ms?.before && !ms.after) edit.createdMask = ms.before;
  }

  // The whole-lattice parts that are not a creation or a removal (a lattice set over one
  // that was there) are taken back by hand; everything else is the entry's own undo.
  const is = isomSet as { before: Uint16Array | null; after: Uint16Array | null } | null;
  const ms = maskSet as { before: Uint8Array | null; after: Uint8Array | null } | null;
  const isomByHand = is && !(reverse ? is.before && !is.after : is.after && !is.before) ? is : null;
  const maskByHand = ms && !(reverse ? ms.before && !ms.after : ms.after && !ms.before) ? ms : null;
  return {
    edit,
    cells,
    dropped,
    rollback(d) {
      if (reverse) {
        if (isomByHand) { d.scn.isom = isomByHand.before; markDirty(d.scn, "ISOM"); }
        if (maskByHand) { d.scn.mask = maskByHand.before; markDirty(d.scn, "MASK"); }
        applyEntry(d.scn, edit, "do");
      } else {
        applyEntry(d.scn, edit, "undo");
        if (maskByHand) { d.scn.mask = maskByHand.before; markDirty(d.scn, "MASK"); }
        if (isomByHand) { d.scn.isom = isomByHand.before; markDirty(d.scn, "ISOM"); }
      }
    },
  };
}

/* ── Fields ──────────────────────────────────────────────── */

/** The fields and the string table as they were after the last change this editor knows of. */
export interface FieldsBaseline {
  values: Map<SyncField, string>;
  strings: (string | null)[];
  format: { extended: boolean; encoding: TextEncoding };
}

export function captureFields(scn: Scenario): FieldsBaseline {
  const values = new Map<SyncField, string>();
  for (const f of SYNC_FIELDS) values.set(f, JSON.stringify(pack(scn[f])));
  return { values, strings: scn.strings.strings.slice(), format: { extended: scn.strings.extended, encoding: scn.strings.encoding } };
}

/** Only the string table, after an edit that may have added a location's name. */
export function captureStrings(scn: Scenario, base: FieldsBaseline): FieldsBaseline {
  return { ...base, strings: scn.strings.strings.slice() };
}

/** The fields op that takes `base` to the map as it is now, or null when nothing differs. */
export function diffFields(scn: Scenario, base: FieldsBaseline): SyncFieldsOp | null {
  const op: SyncFieldsOp = { kind: "fields", set: {} };
  let any = false;
  for (const f of SYNC_FIELDS) {
    const packed = pack(scn[f]);
    if (JSON.stringify(packed) !== base.values.get(f)) { op.set[f] = packed; any = true; }
  }
  const now = scn.strings.strings;
  const strings: [number, string | null, string | null][] = [];
  for (let i = 1; i < Math.max(now.length, base.strings.length); i++) {
    const b = base.strings[i] ?? null;
    const a = now[i] ?? null;
    if (a !== b) strings.push([i, b, a]);
  }
  if (strings.length || now.length !== base.strings.length) { op.strings = strings; op.stringsLength = now.length; any = true; }
  if (scn.strings.extended !== base.format.extended || scn.strings.encoding !== base.format.encoding) {
    op.stringsFormat = { extended: scn.strings.extended, encoding: scn.strings.encoding };
    any = true;
  }
  return any ? op : null;
}

/** Point every string reference in a field's value that `remap` names at its new slot. */
function remapStrings(field: SyncField, value: unknown, remap: Map<number, number>) {
  const m = (i: number) => remap.get(i) ?? i;
  const inArray = (a: unknown) => { if (Array.isArray(a)) for (let i = 0; i < a.length; i++) if (typeof a[i] === "number") a[i] = m(a[i]); };
  switch (field) {
    case "forces": case "unitSettings": inArray((value as { nameIndex?: unknown } | null)?.nameIndex); break;
    case "switchNames": case "wavs": inArray(value); break;
    case "triggers": case "briefing": {
      const briefing = field === "briefing";
      for (const t of (value as TriggerRecord[] | null) ?? []) {
        for (const a of t.actions) {
          for (const arg of actionDef(a.type, briefing)?.args ?? []) {
            if ((arg.kind === "text" || arg.kind === "wav") && a[arg.field] > 0) a[arg.field] = m(a[arg.field]);
          }
        }
      }
      break;
    }
    default: break;
  }
}

function applyFieldsOp(doc: SyncDoc, op: SyncFieldsOp): Applied {
  const scn = doc.scn;
  const prevFields = new Map<SyncField, unknown>();
  // Contents, not the array: later ops write into whichever array is current, and a
  // rollback must leave the table as this op found it whatever object that ends up in.
  const touchesStrings = op.strings !== undefined || op.stringsLength !== undefined;
  const prevStrings = touchesStrings ? scn.strings.strings.slice() : null;
  const prevFormat = op.stringsFormat ? { extended: scn.strings.extended, encoding: scn.strings.encoding } : null;
  let dropped = 0;
  const remap = new Map<number, number>();

  if (touchesStrings) {
    const table = scn.strings.strings.slice();
    const clashes: [number, string][] = [];
    for (const [i, before, after] of op.strings ?? []) {
      if (!isCell(i) || i === 0) { dropped++; continue; }
      const current = table[i] ?? null;
      if (current === after) continue;
      if (current === before) {
        while (table.length <= i) table.push(null);
        table[i] = after;
      } else if (after !== null) {
        clashes.push([i, after]);
      } else {
        dropped++;
      }
    }
    // Someone else put another string in a slot this op fills: the op's string goes to a
    // new slot, and the op's own references follow it there.
    for (const [i, text] of clashes) {
      const j = Math.max(1, table.length);
      table[j] = text;
      remap.set(i, j);
    }
    if (op.stringsLength !== undefined && table.length > op.stringsLength && !clashes.length) {
      let end = table.length;
      while (end > Math.max(1, op.stringsLength) && table[end - 1] === null) end--;
      table.length = end;
    }
    if (table.length === 0) table.push(null);
    scn.strings.strings = table;
    markDirty(scn, strSectionName(scn));
  }
  if (op.stringsFormat) {
    scn.strings.extended = op.stringsFormat.extended;
    scn.strings.encoding = op.stringsFormat.encoding;
    markDirty(scn, "STR ", "STRx");
  }
  for (const f of SYNC_FIELDS) {
    if (!(f in op.set)) continue;
    const value = unpack(op.set[f]);
    if (remap.size) remapStrings(f, value, remap);
    prevFields.set(f, scn[f]);
    (scn as unknown as Record<string, unknown>)[f] = value;
    markDirty(scn, ...FIELD_SECTIONS[f](scn));
  }
  return {
    dropped,
    rollback(d) {
      for (const [f, v] of prevFields) {
        (d.scn as unknown as Record<string, unknown>)[f] = v;
        markDirty(d.scn, ...FIELD_SECTIONS[f](d.scn));
      }
      if (prevStrings) { d.scn.strings.strings = prevStrings.slice(); markDirty(d.scn, strSectionName(d.scn)); }
      if (prevFormat) {
        d.scn.strings.extended = prevFormat.extended;
        d.scn.strings.encoding = prevFormat.encoding;
        markDirty(d.scn, "STR ", "STRx");
      }
    },
  };
}

/** Take a local fields change back to `base`: what a pending one's rollback does. */
function fieldsRollback(op: SyncFieldsOp, base: FieldsBaseline): Applied["rollback"] {
  const values = new Map<SyncField, unknown>();
  for (const f of Object.keys(op.set) as SyncField[]) values.set(f, unpack(JSON.parse(base.values.get(f) ?? "null")));
  const strings = op.strings !== undefined || op.stringsLength !== undefined ? base.strings.slice() : null;
  const format = op.stringsFormat ? { ...base.format } : null;
  return (d) => {
    for (const [f, v] of values) {
      (d.scn as unknown as Record<string, unknown>)[f] = unpack(pack(v));
      markDirty(d.scn, ...FIELD_SECTIONS[f](d.scn));
    }
    if (strings) { d.scn.strings.strings = strings.slice(); markDirty(d.scn, strSectionName(d.scn)); }
    if (format) {
      d.scn.strings.extended = format.extended;
      d.scn.strings.encoding = format.encoding;
      markDirty(d.scn, "STR ", "STRx");
    }
  };
}

/* ── Extras and resets ───────────────────────────────────── */

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function diffExtras(base: Map<string, Uint8Array>, now: Map<string, Uint8Array>): SyncExtrasOp | null {
  const set: [string, string | null][] = [];
  for (const [name, bytes] of now) {
    const was = base.get(name);
    if (!was || !sameBytes(was, bytes)) set.push([name, toBase64(bytes)]);
  }
  for (const name of base.keys()) if (!now.has(name)) set.push([name, null]);
  return set.length ? { kind: "extras", set } : null;
}

function applyExtrasOp(doc: SyncDoc, op: SyncExtrasOp): Applied {
  const prev = doc.extras;
  const next = new Map(prev);
  for (const [name, bytes] of op.set) {
    if (typeof name !== "string") continue;
    if (bytes === null) next.delete(name);
    else next.set(name, fromBase64(bytes));
  }
  doc.extras = next;
  return { dropped: 0, rollback(d) { d.extras = prev; } };
}

function applyResetOp(doc: SyncDoc, op: SyncResetOp): Applied {
  const prev = doc.scn;
  doc.scn = parseScenario(fromBase64(op.chk));
  return { dropped: 0, rollback(d) { d.scn = prev; } };
}

/* ── Applying any op ─────────────────────────────────────── */

/** Whether a value received from elsewhere has an op's shape; anything else is refused before it touches the map. */
export function isSyncOp(value: unknown): value is SyncOp {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  const numbers = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((n) => typeof n === "number" && Number.isFinite(n)));
  const records = (v: unknown) => v === undefined || (Array.isArray(v) && v.every((c) => c && typeof c === "object" && typeof (c as { index?: unknown }).index === "number"));
  switch (o.kind) {
    case "edit":
      return typeof o.width === "number" && typeof o.height === "number" && typeof o.label === "string"
        && numbers(o.terrain) && numbers(o.isom) && numbers(o.doodadTiles) && numbers(o.fog)
        && records(o.units) && records(o.doodads) && records(o.sprites) && records(o.locations)
        && (o.isomWhole === undefined || o.isomWhole === null || typeof o.isomWhole === "string")
        && (o.maskWhole === undefined || o.maskWhole === null || typeof o.maskWhole === "string");
    case "fields":
      return !!o.set && typeof o.set === "object" && (o.strings === undefined || Array.isArray(o.strings));
    case "extras":
      return Array.isArray(o.set);
    case "reset":
      return typeof o.chk === "string";
    default:
      return false;
  }
}

/** Apply an op to the document as it stands — the same result on every editor that applies the same ops in the same order. */
export function applyOp(doc: SyncDoc, op: SyncOp): Applied {
  switch (op.kind) {
    case "edit": return applyEditOp(doc, op);
    case "fields": return applyFieldsOp(doc, op);
    case "extras": return applyExtrasOp(doc, op);
    case "reset": return applyResetOp(doc, op);
  }
}

/* ── The pending queue ───────────────────────────────────── */

const EDIT_KEYS = ["changes", "isom", "doodadTiles", "doodads", "sprites", "units", "locations", "fog", "createdIsom", "createdMask"] as const;

/**
 * Make a history entry say what was applied, keeping the object (it is on a stack). Flags
 * an op does not carry — `rebuiltIsom`, which tells the commit to re-measure the ISOM
 * health — stay as the editor set them.
 */
function setEntry(entry: HistoryEntry, edit: HistoryEdit) {
  const e = entry as unknown as Record<string, unknown>;
  for (const k of EDIT_KEYS) {
    if (edit[k] === undefined) delete e[k];
    else e[k] = edit[k];
  }
  if (!entry.changes) entry.changes = [];
}

interface Pending {
  op: SyncOp;
  applied: Applied;
  /** The history entry that stands for this op on a stack, kept in step when the op is applied again. */
  entry: HistoryEntry | null;
}

/**
 * One editor's side of a shared map: the changes it made that the server has not yet
 * confirmed, and the three ways the map changes — its own edits (`commit*`, `step`),
 * another person's (`receive`), and a confirmation (`confirm`). Every method takes the
 * document as it is now and may replace its members.
 */
export class SyncCore {
  readonly pending: Pending[] = [];

  /**
   * An edit the editor has just applied and recorded as `entry` (which is on the undo
   * stack): take it back, apply it again as the op everyone else will apply, and make the
   * entry say what that did. Null for an entry with nothing in it.
   */
  commitEdit(doc: SyncDoc, entry: HistoryEntry): SyncEditOp | null {
    if (!hasEdits(entry)) return null;
    const op = toSyncEdit(doc.scn, entry, "do");
    applyEntry(doc.scn, entry, "undo");
    const applied = applyEditOp(doc, op);
    setEntry(entry, applied.edit!);
    this.pending.push({ op, applied, entry });
    return op;
  }

  /**
   * Undo (`"undo"`) or redo (`"do"`) a history entry on a shared map: the entry's records
   * are found by content, since other people's edits may have moved them. Answers the op
   * and the entry for the other stack (null when nothing could be applied).
   */
  step(doc: SyncDoc, entry: HistoryEntry, direction: "do" | "undo"): { op: SyncEditOp; entry: HistoryEntry | null; dropped: number } {
    const op = toSyncEdit(doc.scn, entry, direction);
    const applied = applyEditOp(doc, op);
    const other: HistoryEntry = { label: entry.label, ...applied.edit!, changes: applied.edit!.changes };
    const kept = hasEdits(other) ? other : null;
    this.pending.push({ op, applied, entry: kept });
    return { op, entry: kept, dropped: applied.dropped };
  }

  /** A dialog wrote to the fields since `base`; null when nothing differs. */
  commitFields(doc: SyncDoc, base: FieldsBaseline): SyncFieldsOp | null {
    const op = diffFields(doc.scn, base);
    if (!op) return null;
    this.pending.push({ op, applied: { dropped: 0, rollback: fieldsRollback(op, base) }, entry: null });
    return op;
  }

  /** The archive's extra files changed since `base`. */
  commitExtras(doc: SyncDoc, base: Map<string, Uint8Array>): SyncExtrasOp | null {
    const op = diffExtras(base, doc.extras);
    if (!op) return null;
    this.pending.push({ op, applied: { dropped: 0, rollback(d) { d.extras = base; } }, entry: null });
    return op;
  }

  /** The whole document changed (resize, tileset, a raw section edit); `before` is how it was. */
  commitReset(doc: SyncDoc, before: Scenario, label: string): SyncResetOp {
    const op: SyncResetOp = { kind: "reset", label, chk: toBase64(serializeScenario(doc.scn)) };
    this.pending.push({ op, applied: { dropped: 0, rollback(d) { d.scn = before; } }, entry: null });
    return op;
  }

  /** The server confirmed the oldest pending op. */
  confirm(): SyncOp | null {
    return this.pending.shift()?.op ?? null;
  }

  /**
   * Another person's op, in the server's order: take the pending ones back, apply it,
   * apply the pending ones again. `lost` counts parts of pending ops that no longer apply.
   */
  receive(doc: SyncDoc, op: SyncOp): { applied: Applied; lost: number } {
    for (let i = this.pending.length - 1; i >= 0; i--) this.pending[i].applied.rollback(doc);
    const applied = applyOp(doc, op);
    let lost = 0;
    for (const p of this.pending) {
      const before = p.applied.dropped;
      p.applied = applyOp(doc, p.op);
      lost += Math.max(0, p.applied.dropped - before);
      if (p.entry && p.applied.edit) setEntry(p.entry, p.applied.edit);
    }
    return { applied, lost };
  }
}

/**
 * Forget, in history entries, the cells another person has since written: undoing your
 * old stroke must not paint over their newer one. List and location changes need no
 * such care — an undo finds its records by content and skips the ones that moved on.
 */
export function forgetCells(entries: readonly HistoryEntry[], cells: SyncCells) {
  if (!cells.tiles.length && !cells.isom.length && !cells.fog.length) return;
  const tiles = new Set(cells.tiles);
  const isom = new Set(cells.isom);
  const fog = new Set(cells.fog);
  for (const e of entries) {
    if (tiles.size) {
      if (e.changes.length) e.changes = e.changes.filter((c) => !tiles.has(c.at));
      if (e.doodadTiles?.length) e.doodadTiles = e.doodadTiles.filter((c) => !tiles.has(c.at));
    }
    if (isom.size && e.isom?.length) e.isom = e.isom.filter((c) => !isom.has(c.at));
    if (fog.size && e.fog?.length) e.fog = e.fog.filter((c) => !fog.has(c.at));
  }
}
