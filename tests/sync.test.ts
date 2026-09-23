import { describe, expect, it } from "vitest";
import { createScenario } from "../src/formats/chk/create";
import { parseScenario, serializeScenario, type Scenario } from "../src/formats/chk/scenario";
import { ActionType, emptyAction, emptyTrigger } from "../src/formats/chk/sections/triggers";
import { isLocationUsed } from "../src/formats/chk/sections/objects";
import { applyEntry, type HistoryEntry } from "../src/editor/history";
import { makeUnit, nextSerial } from "../src/editor/units";
import { firstFreeSlot } from "../src/editor/locations";
import {
  SyncCore, applyOp, captureFields, captureStrings, forgetCells, isSyncOp, pack, unpack, type FieldsBaseline, type SyncDoc, type SyncOp,
} from "../src/editor/sync";

/** A seeded generator, so a failure names the seed that reproduces it. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0x100000000; };
  return { next, int: (n: number) => Math.floor(next() * n), pick: <T>(a: readonly T[]) => a[Math.floor(next() * a.length)] };
}

const W = 16, H = 12;
const initialBytes = serializeScenario(createScenario({ width: W, height: H, era: 0, name: "shared" }));
const freshDoc = (): SyncDoc => ({ scn: parseScenario(initialBytes), extras: new Map() });

/** Everything that decides what a saved map says, in comparable form. */
function fingerprint(doc: SyncDoc) {
  const s = doc.scn;
  return JSON.stringify(pack({
    tiles: s.tiles, editorTiles: s.editorTiles, isom: s.isom, mask: s.mask, units: s.units, doodads: s.doodads, sprites: s.sprites,
    locations: s.locations.map((l) => (isLocationUsed(l) ? { ...l, name: s.strings.strings[l.nameIndex] ?? null } : null)),
    colors: s.playerColors, triggers: s.triggers, strings: s.strings.strings, extras: [...doc.extras].map(([k, v]) => [k, Array.from(v)]),
  }));
}

/** One editor: its copy, its history, the pending queue — driven the way the session drives the store. */
class Client {
  doc = freshDoc();
  core = new SyncCore();
  undo: HistoryEntry[] = [];
  redo: HistoryEntry[] = [];
  base: FieldsBaseline = captureFields(this.doc.scn);
  cursor = 0;
  constructor(readonly id: number, readonly send: (from: number, op: SyncOp) => void) {}

  /** What the editor does for a stroke: apply, record, then hand the entry to the sync. */
  edit(entry: HistoryEntry) {
    applyEntry(this.doc.scn, entry, "do");
    this.undo.push(entry);
    this.redo = [];
    const op = this.core.commitEdit(this.doc, entry);
    this.base = captureStrings(this.doc.scn, this.base);
    if (op) this.send(this.id, op);
  }

  step(direction: "do" | "undo") {
    const from = direction === "undo" ? this.undo : this.redo;
    const to = direction === "undo" ? this.redo : this.undo;
    const entry = from.pop();
    if (!entry) return;
    const r = this.core.step(this.doc, entry, direction);
    if (r.entry) to.push(r.entry);
    this.base = captureStrings(this.doc.scn, this.base);
    this.send(this.id, r.op);
  }

  dialog(fn: (scn: Scenario) => void) {
    fn(this.doc.scn);
    const op = this.core.commitFields(this.doc, this.base);
    this.base = captureFields(this.doc.scn);
    if (op) this.send(this.id, op);
  }

  extras([name, bytes]: [string, Uint8Array | null]) {
    const next = new Map(this.doc.extras);
    if (bytes) next.set(name, bytes);
    else next.delete(name);
    const base = this.doc.extras;
    this.doc.extras = next;
    const op = this.core.commitExtras(this.doc, base);
    if (op) this.send(this.id, op);
  }

  /** A whole-document change (Resize, a raw section edit): the history goes, the bytes travel. */
  reset(fill: number) {
    const before = this.doc.scn;
    this.doc.scn = parseScenario(serializeScenario(before));
    this.doc.scn.tiles.fill(fill);
    this.doc.scn.editorTiles.fill(fill);
    this.doc.scn.dirty.add("MTXM").add("TILE");
    this.undo = [];
    this.redo = [];
    this.send(this.id, this.core.commitReset(this.doc, before, "Resize"));
    this.base = captureFields(this.doc.scn);
  }

  deliver(from: number, op: SyncOp) {
    if (from === this.id) {
      this.core.confirm();
    } else {
      const { applied } = this.core.receive(this.doc, op);
      if (op.kind === "reset") { this.undo = []; this.redo = []; }
      const mine = new Set(this.core.pending.map((p) => p.entry));
      if (applied.cells) forgetCells([...this.undo, ...this.redo].filter((e) => !mine.has(e)), applied.cells);
      this.base = captureFields(this.doc.scn);
    }
  }
}

function randomEdit(c: Client, r: ReturnType<typeof rng>) {
  const scn = c.doc.scn;
  const kind = r.int(15);
  if (kind <= 2) {
    const changes = [];
    const seen = new Set<number>();
    for (let n = 1 + r.int(6); n > 0; n--) {
      const at = r.int(W * H);
      if (seen.has(at)) continue;
      seen.add(at);
      changes.push({ at, before: scn.tiles[at], after: 1 + r.int(500) });
    }
    c.edit({ label: "Paint", changes });
  } else if (kind === 3) {
    const u = makeUnit(null, r.int(100), r.int(8), r.int(W * 32), r.int(H * 32), nextSerial(scn));
    c.edit({ label: "Place", changes: [], units: [{ index: scn.units.length, before: null, after: u }] });
  } else if (kind === 4 && scn.units.length) {
    const i = r.int(scn.units.length);
    c.edit({ label: "Move", changes: [], units: [{ index: i, before: scn.units[i], after: { ...scn.units[i], x: r.int(W * 32) } }] });
  } else if (kind === 5 && scn.units.length) {
    const i = r.int(scn.units.length);
    c.edit({ label: "Delete", changes: [], units: [{ index: i, before: scn.units[i], after: null }] });
  } else if (kind === 6) {
    const slot = firstFreeSlot(scn);
    if (slot < 0) return;
    const name = `L${c.id}-${r.int(1000)}`;
    const index = scn.strings.strings.length;
    c.edit({
      label: "Location", changes: [],
      locations: [{ index: slot, before: scn.locations[slot], after: { left: 0, top: 0, right: 32 * (1 + r.int(4)), bottom: 32, nameIndex: index, elevationFlags: 0 }, string: { index, before: null, after: name } }],
    });
  } else if (kind === 7) {
    c.dialog((s) => { s.playerColors = s.playerColors.map((v, i) => (i === r.int(8) ? r.int(16) : v)); });
  } else if (kind === 8) {
    c.dialog((s) => {
      const text = `hello ${c.id} ${r.int(1000)}`;
      const index = s.strings.strings.length;
      s.strings.strings = [...s.strings.strings, text];
      const t = emptyTrigger();
      t.players[r.int(8)] = 1;
      t.actions = [{ ...emptyAction(), type: ActionType.DisplayText, text: index }];
      s.triggers = [...s.triggers, t];
    });
  } else if (kind === 10) {
    const d = { doodadId: r.int(300), x: r.int(W * 32), y: r.int(H * 32), owner: 16, disabled: 0 };
    const sprite = { spriteId: r.int(400), x: d.x, y: d.y, owner: 16, unused: 0, flags: 0x1000 };
    const at = r.int(W * H);
    c.edit({ label: "Doodad", changes: [], doodadTiles: [{ at, before: scn.tiles[at], after: 900 + r.int(50) }], doodads: [{ index: scn.doodads.length, before: null, after: d }], sprites: [{ index: scn.sprites.length, before: null, after: sprite }] });
  } else if (kind === 11 && scn.doodads.length) {
    const i = r.int(scn.doodads.length);
    c.edit({ label: "Delete doodad", changes: [], doodads: [{ index: i, before: scn.doodads[i], after: null }] });
  } else if (kind === 12 && scn.mask) {
    const at = r.int(W * H);
    c.edit({ label: "Fog", changes: [], fog: [{ at, before: scn.mask[at], after: r.int(256) }] });
  } else if (kind === 13) {
    c.extras(r.next() < 0.7 ? [`sound${r.int(3)}.wav`, new Uint8Array([c.id, r.int(256)])] : [`sound${r.int(3)}.wav`, null]);
  } else if (kind === 14 && r.next() < 0.25) {
    c.reset(r.int(400));
  } else {
    c.step(r.next() < 0.6 ? "undo" : "do");
  }
}

function run(seed: number, clients = 3, steps = 160, check = false) {
  const r = rng(seed);
  const log: { from: number; op: SyncOp }[] = [];
  const all: Client[] = [];
  for (let i = 0; i < clients; i++) all.push(new Client(i, (from, op) => log.push({ from, op })));
  for (let n = 0; n < steps; n++) {
    const c = r.pick(all);
    let what = `client ${c.id} `;
    if (r.next() < 0.45) { const before = log.length; randomEdit(c, r); what += log.length > before ? `made ${log.at(-1)!.op.kind}:${(log.at(-1)!.op as { label?: string }).label}` : "did nothing"; }
    else if (c.cursor < log.length) {
      const m = log[c.cursor++]; what += `got #${c.cursor - 1} from ${m.from} ${m.op.kind}:${(m.op as { label?: string }).label}`; c.deliver(m.from, m.op); }
    if (check) {
      for (const k of all) {
        const ref = freshDoc();
        for (let i = 0; i < k.cursor; i++) applyOp(ref, log[i].op);
        for (const p of k.core.pending) applyOp(ref, p.op);
        if (fingerprint(ref) !== fingerprint(k.doc)) {
          const a = JSON.parse(fingerprint(ref)), b = JSON.parse(fingerprint(k.doc));
          for (const key of Object.keys(a)) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) console.log(key, JSON.stringify(a[key]).slice(0, 600), "\n  vs\n", JSON.stringify(b[key]).slice(0, 600));
          console.log(JSON.stringify(k.core.pending.map((p) => p.op)).slice(0, 3000));
        }
        if (fingerprint(ref) !== fingerprint(k.doc)) throw new Error(`step ${n} (${what}): client ${k.id} off; last log ${JSON.stringify(log.slice(-3).map((m) => [m.from, m.op.kind, (m.op as { label?: string }).label]))} pending ${k.core.pending.map((p) => p.op.kind + ":" + (p.op as { label?: string }).label)}`);
      }
    }
  }
  // Deliver what is left, round-robin, through a JSON round trip as the socket would.
  for (const c of all) while (c.cursor < log.length) { const m = log[c.cursor++]; c.deliver(m.from, JSON.parse(JSON.stringify(m.op))); }
  const reference = freshDoc();
  for (const m of log) applyOp(reference, m.op);
  return { all, reference, log };
}

describe("shared editing converges", () => {
  it("every editor ends with the map the server's order describes, whatever the interleaving", () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { all, reference, log } = run(seed);
      expect(log.length, `seed ${seed}`).toBeGreaterThan(10);
      const want = fingerprint(reference);
      for (const c of all) {
        expect(c.core.pending, `seed ${seed}`).toHaveLength(0);
        expect(fingerprint(c.doc), `seed ${seed}, client ${c.id}`).toBe(want);
      }
    }
  }, 30_000);

  it("keeps each editor's copy equal to the confirmed ops plus its own pending ones at every step", () => {
    for (let seed = 101; seed <= 115; seed++) run(seed, 3, 160, true);
  }, 30_000);

  it("finds a unit by what it is, after someone else's insert moved it", () => {
    const a = freshDoc(), b = freshDoc();
    const ca = new SyncCore(), cb = new SyncCore();
    const u = makeUnit(null, 0, 0, 64, 64, 1);
    // Both start with one unit.
    for (const d of [a, b]) applyOp(d, { kind: "edit", label: "", width: W, height: H, units: [{ index: 0, before: null, after: u }] });
    // A inserts a unit in front of it; B moves it. The server takes A first.
    const insert: HistoryEntry = { label: "Place", changes: [], units: [{ index: 0, before: null, after: makeUnit(null, 1, 0, 32, 32, 2) }] };
    applyEntry(a.scn, insert, "do");
    const opA = ca.commitEdit(a, insert)!;
    const move: HistoryEntry = { label: "Move", changes: [], units: [{ index: 0, before: b.scn.units[0], after: { ...b.scn.units[0], x: 200 } }] };
    applyEntry(b.scn, move, "do");
    const opB = cb.commitEdit(b, move)!;
    cb.receive(b, opA);
    expect(b.scn.units.map((x) => x.x)).toEqual([32, 200]);
    // The rebase kept B's history entry in step: undoing it moves the right unit back.
    expect(move.units![0].index).toBe(1);
    ca.receive(a, opB);
    expect(a.scn.units.map((x) => x.x)).toEqual([32, 200]);
  });

  it("drops a change to a unit someone else deleted, and says so", () => {
    const d = freshDoc();
    const u = makeUnit(null, 0, 0, 64, 64, 1);
    applyOp(d, { kind: "edit", label: "", width: W, height: H, units: [{ index: 0, before: null, after: u }] });
    applyOp(d, { kind: "edit", label: "", width: W, height: H, units: [{ index: 0, before: u, after: null }] });
    const applied = applyOp(d, { kind: "edit", label: "", width: W, height: H, units: [{ index: 0, before: u, after: { ...u, x: 9 } }] });
    expect(applied.dropped).toBe(1);
    expect(d.scn.units).toHaveLength(0);
  });

  it("moves a new location out of a slot someone else took, name and all", () => {
    const d = freshDoc();
    const slot = firstFreeSlot(d.scn);
    const box = { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 0, elevationFlags: 0 };
    applyOp(d, { kind: "edit", label: "", width: W, height: H, locations: [{ index: slot, after: box, name: "Mine", created: true }] });
    applyOp(d, { kind: "edit", label: "", width: W, height: H, locations: [{ index: slot, after: box, name: "Yours", created: true }] });
    const names = d.scn.locations.filter(isLocationUsed).map((l) => d.scn.strings.strings[l.nameIndex]);
    expect(names).toContain("Mine");
    expect(names).toContain("Yours");
  });

  it("moves a dialog's string out of a slot someone else filled, and its trigger follows", () => {
    const d = freshDoc();
    const n = d.scn.strings.strings.length;
    const base = captureFields(d.scn);
    // Someone else's location name takes slot n first.
    applyOp(d, { kind: "edit", label: "", width: W, height: H, locations: [{ index: 0, after: { left: 0, top: 0, right: 32, bottom: 32, nameIndex: 0, elevationFlags: 0 }, name: "Theirs", created: true }] });
    const t = emptyTrigger();
    t.actions = [{ ...emptyAction(), type: ActionType.DisplayText, text: n }];
    applyOp(d, { kind: "fields", set: { triggers: pack([t]) }, strings: [[n, null, "Mine"]], stringsLength: n + 1 });
    const text = d.scn.triggers[0].actions[0].text;
    expect(d.scn.strings.strings[text]).toBe("Mine");
    expect(d.scn.strings.strings[n]).toBe("Theirs");
    expect(base.strings.length).toBe(n);
  });

  it("skips grid parts made for a map of another size", () => {
    const d = freshDoc();
    const applied = applyOp(d, { kind: "edit", label: "", width: W + 2, height: H, terrain: [0, 5, 5] });
    expect(applied.dropped).toBe(1);
    expect(d.scn.tiles[0]).not.toBe(5);
  });

  it("refuses values that are not ops", () => {
    expect(isSyncOp({ kind: "edit", label: "x", width: 1, height: 1, terrain: [0, "a"] })).toBe(false);
    expect(isSyncOp({ kind: "nope" })).toBe(false);
    expect(isSyncOp(null)).toBe(false);
    expect(isSyncOp({ kind: "reset", label: "Resize", chk: "" })).toBe(true);
  });

  it("carries typed arrays through JSON", () => {
    const v = { a: new Uint16Array([1, 65535]), b: [new Uint8Array([3])], c: 4 };
    expect(unpack(JSON.parse(JSON.stringify(pack(v))))).toEqual(v);
  });
});
