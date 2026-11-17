/**
 * `api.document.edit`: terrain and objects in one transaction, committed as one undo entry the way a brush
 * stroke is.
 */
import { t } from "../../i18n";
import { mapTilesetAtom, placementOptionsAtom, rectVariationAtom, symmetryAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, commitTerrainAtom, pinCellsAtom, rollbackEntryAtom, scenarioAtom, tilesetFileNameAtom, type HistoryEntry } from "../../atoms/documentAtoms";
import { layBlock, layPattern } from "../../editor/modTerrain/tileSheet";
import { checkedBlock } from "../pieces";
import { paintBorrowedIn } from "../borrow";
import { paintCopyIn } from "../copies";
import { TILESET_BY_ID } from "../../data/tilesets";
import { markDirty, tilesetIndex } from "../../formats/chk/scenario";
import { peekTileset } from "../../formats/tileset/load";
import { NO_DOODADS } from "../../formats/tileset/doodads";
import { flatTerrain } from "../../formats/tileset/terrain";
import { terrainTypes } from "../../formats/tileset/palette";
import { peekUnitAssets } from "../../formats/units/load";
import { addLocation, applyLocationChanges, editLocation, ensureLocationSlots, removeLocations, type LocationChange, restoreAnywhere } from "../../editor/locations";
import { checkPlacement } from "../../editor/placement";
import { applyChanges, stampTerrain, stampTile, Stroke, type Rect, type TileChange, floodRegion, replaceTerrain } from "../../editor/terrain";
import { applyIsomChanges, hasIsom, isomWidth, paintIsom, rebuildIsomFromTiles, tilesFromIsom } from "../../editor/isom";
import { hasEdits, hasMembers } from "../../editor/history";
import { addUnits, applyUnitChanges, makeUnit, nextSerial, removeUnits, snapPlacement, unitGeometry, updateUnits, type UnitChange, moveUnits } from "../../editor/units";
import { addSprites, applySpriteChanges, clampSprite, makeSprite, removeSprites, type SpriteChange, moveSprites, updateSprites } from "../../editor/sprites";
import { applyDoodadChanges, convertDoodads, placeDoodad, placeDoodadAsTerrain, removeDoodads, type DoodadChange, updateDoodads } from "../../editor/doodads";
import { applyFogChanges, ensureMask, paintFog, copyFog, floodFog, invertFog } from "../../editor/fog";
import type { Cells, EditResult, EditTransaction } from "../api";
import { placeBlend } from "../../editor/blend";
import { healTiles } from "../../editor/heal";
import { countPins, PINS_MEMBER, pinsOf, withoutPinned } from "../../editor/pins";
import { isStretched, STRETCH_AXES, stretchDoodad } from "../../editor/stretch";
import { mirrorIndices, mirrorPixel } from "../../editor/symmetry";
import { DEFAULT_START_PLACEMENT, placeStartLocations } from "../../editor/startLocations";
import { ALL_CLIP_PARTS, pasteClip } from "../../editor/clipboard";
import { type Store, EMPTY_RESULT, assertWritable, sealed, checkSyncBuilder } from "./shared";

/** The longest stretch a plugin may ask for; the map's edge stops a real one long before. */
const MAX_STRETCH_STEPS = 128;

/**
 * Run `build` against a transaction over the open scenario and commit what it did as
 * one undo entry. Operations apply as they are called and accumulate change lists in
 * `applyEntry` order; the terrain lists go through `Stroke` so a cell written twice
 * records one change from its original tile to its final one.
 */
export function runTransaction(store: Store, label: string, build: (tx: EditTransaction) => unknown): EditResult {
  const scn = store.get(scenarioAtom);
  if (!scn) return { ...EMPTY_RESULT, notes: ["no map is open"] };
  assertWritable(store);
  const loaded = peekTileset(store.get(tilesetFileNameAtom));
  const names = TILESET_BY_ID[store.get(mapTilesetAtom)].terrain;
  const w = scn.width, h = scn.height;

  const tiles = new Stroke();
  const isom = new Stroke();
  const fog = new Stroke();
  const doodadTiles: TileChange[] = [];
  const doodads: DoodadChange[] = [];
  const sprites: SpriteChange[] = [];
  const units: UnitChange[] = [];
  const locations: LocationChange[] = [];
  const notes: string[] = [];
  let createdMask: Uint8Array | undefined;
  let createdIsom: Uint16Array | undefined;
  let rebuiltIsom = false;
  let serial = nextSerial(scn);

  const cellsOf = (cells: Cells): number[] => {
    if (typeof (cells as Rect).x0 === "number") {
      const r = cells as Rect;
      const out: number[] = [];
      for (let y = Math.max(0, r.y0); y < Math.min(h, r.y1); y++) for (let x = Math.max(0, r.x0); x < Math.min(w, r.x1); x++) out.push(y * w + x);
      return out;
    }
    return [...(cells as Iterable<number>)].filter((at) => at >= 0 && at < w * h);
  };
  const flatOf = (terrainId: number) => {
    if (!loaded) { notes.push(t("terrain painting needs the tileset graphics")); return null; }
    const type = terrainTypes(loaded.tileset, names).find((t) => t.id === terrainId);
    if (!type) { notes.push(t("terrain {terrainId} is not a flat terrain of this tileset", { terrainId })); return null; }
    return type;
  };
  const applyTiles = (changes: TileChange[]) => { applyChanges(scn, changes); tiles.add(changes); return changes.length; };
  /** The pinned tiles as they stand now (`tx.pin` may have changed them). */
  const pinned = () => pinsOf(store.get(archiveExtrasAtom), scn);
  /** What lays terrain by rule leaves pinned tiles as they are, as the editor's own brushes do. */
  const applyRuled = (changes: TileChange[]) => applyTiles(withoutPinned(changes, pinned()).changes);
  /** The pins file before the transaction's first change to it; undefined while it has made none. */
  let pinsBefore: Uint8Array | null | undefined;
  /** Each borrowed lattice (editor/modTerrain/borrowLattice.ts) as it was before the transaction first changed it. */
  const membersBefore = new Map<string, Uint8Array | null>();
  const tables = () => peekUnitAssets()?.units ?? null;

  const tx: EditTransaction = {
    scenario: scn,
    width: w,
    height: h,
    tileAt: (x, y) => scn.tiles[y * w + x],
    groundAt: (x, y) => scn.editorTiles[y * w + x],
    setTile: (x, y, id) => { applyTiles(stampTile(scn, [y * w + x], id)); },
    setTiles: (cells, id) => applyTiles(stampTile(scn, cellsOf(cells), id)),
    stampTerrain: (cells, terrainId, variation = -1) => {
      const type = flatOf(terrainId);
      if (!type || !loaded) return 0;
      return applyRuled(stampTerrain(scn, loaded.tileset, { group: type.group, variation }, cellsOf(cells)));
    },
    fillFlat: (rect, terrainId) => {
      const type = flatOf(terrainId);
      if (!type || !loaded) return 0;
      const flat = flatTerrain(w, h, { id: type.id, group: type.group }, loaded.tileset, Math.random, tilesetIndex(scn));
      const changes: TileChange[] = [];
      for (const at of cellsOf(rect)) if (scn.tiles[at] !== flat.tiles[at]) changes.push({ at, before: scn.tiles[at], after: flat.tiles[at] });
      const n = applyRuled(changes);
      if (hasIsom(scn) && scn.isom.length === flat.isom.length) {
        const iw = isomWidth(scn);
        const changesIsom: TileChange[] = [];
        for (let ry = Math.max(0, rect.y0); ry < Math.min(h, rect.y1); ry++) {
          for (let rx = Math.max(0, rect.x0 >> 1); rx <= Math.min(iw - 1, (rect.x1 - 1) >> 1); rx++) {
            for (let side = 0; side < 4; side++) {
              const i = (ry * iw + rx) * 4 + side;
              if (scn.isom[i] !== flat.isom[i]) changesIsom.push({ at: i, before: scn.isom[i], after: flat.isom[i] });
            }
          }
        }
        applyIsomChanges(scn, changesIsom);
        isom.add(changesIsom);
        if (changesIsom.length > 0) markDirty(scn, "ISOM");
      }
      return n;
    },
    paintIsom: (d, terrainId, extent = 1) => {
      if (!hasIsom(scn) || !loaded) return false;
      const edit = paintIsom(scn, loaded.tileset, d, terrainId, extent, Math.random, pinned());
      if (!edit) return false;
      tiles.add(edit.tiles);
      isom.add(edit.isom);
      return true;
    },
    paintBorrowed: (diamonds, terrainId) => paintBorrowedIn(store, scn, diamonds ?? [], terrainId, pinned(), applyTiles, membersBefore, notes),
    paintCopy: (diamonds, terrainId) => paintCopyIn(store, scn, diamonds ?? [], terrainId, pinned(), applyTiles, (applied, isomChanges) => { tiles.add(applied); isom.add(isomChanges); }, membersBefore, notes),
    rebuildIsom: () => {
      if (!loaded) { notes.push(t("rebuilding the ISOM needs the tileset graphics")); return null; }
      const rebuilt = rebuildIsomFromTiles(scn, loaded.tileset);
      const base = { diamonds: rebuilt.diamonds, unresolved: rebuilt.unresolved };
      if (hasIsom(scn) && scn.isom.length === rebuilt.isom.length && !createdIsom) {
        const changes: TileChange[] = [];
        for (let i = 0; i < rebuilt.isom.length; i++) if (scn.isom[i] !== rebuilt.isom[i]) changes.push({ at: i, before: scn.isom[i], after: rebuilt.isom[i] });
        applyIsomChanges(scn, changes);
        isom.add(changes);
        rebuiltIsom = true;
        return { ...base, created: false, changed: changes.length };
      }
      // No usable lattice (or one this transaction already created): the whole section is the change.
      scn.isom = rebuilt.isom;
      markDirty(scn, "ISOM");
      createdIsom = rebuilt.isom;
      return { ...base, created: true, changed: rebuilt.isom.length };
    },

    makeUnit: (unitId, owner, x, y) => makeUnit(tables(), unitId, owner, x, y, serial++),
    addUnits: (records) => { const ch = addUnits(scn, records); applyUnitChanges(scn, ch); units.push(...ch); return ch.map((c) => c.index); },
    removeUnits: (indices) => { const ch = removeUnits(scn, indices); applyUnitChanges(scn, ch); units.push(...ch); return ch.length; },
    updateUnits: (indices, patch) => { const ch = updateUnits(scn, indices, patch); applyUnitChanges(scn, ch); units.push(...ch); return ch.length; },
    placeUnit: (unitId, owner, x, y) => {
      const at = snapPlacement(unitGeometry(tables(), unitId), x, y, w, h, store.get(placementOptionsAtom).snapToGrid);
      const ch = addUnits(scn, [makeUnit(tables(), unitId, owner, at.x, at.y, serial++)]);
      applyUnitChanges(scn, ch);
      units.push(...ch);
      return ch[0].index;
    },
    canPlaceUnit: (unitId, x, y) => checkPlacement(scn, loaded?.tileset ?? null, tables(), store.get(placementOptionsAtom), unitId, x, y).problem === null,

    makeSprite: (kind, id, owner, x, y, opts) => makeSprite(kind, id, owner, x, y, opts),
    addSprites: (records) => { const ch = addSprites(scn, records); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.map((c) => c.index); },
    removeSprites: (indices) => { const ch = removeSprites(scn, indices); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    placeSprite: (kind, id, owner, x, y, opts) => {
      const at = clampSprite(x, y, w, h);
      const ch = addSprites(scn, [makeSprite(kind, id, owner, at.x, at.y, opts)]);
      applySpriteChanges(scn, ch);
      sprites.push(...ch);
      return ch[0].index;
    },

    placeDoodad: (doodadId, tx0, ty0, owner = 0) => {
      const def = loaded?.doodads.byId.get(doodadId);
      if (!def) { notes.push(t("doodad {doodadId} is not in this tileset", { doodadId })); return -1; }
      if (tx0 < 0 || ty0 < 0 || tx0 + def.width > w || ty0 + def.height > h) return -1;
      const edit = placeDoodad(scn, def, tx0, ty0, owner);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodadTiles.push(...edit.tiles);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads[0]?.index ?? -1;
    },
    placeStretchedDoodad: (doodadId, tx0, ty0, axis, steps, owner = 0) => {
      const def = loaded?.doodads.byId.get(doodadId);
      if (!def || !loaded) { notes.push(t("doodad {doodadId} is not in this tileset", { doodadId })); return []; }
      if (!STRETCH_AXES.includes(axis) || !Number.isInteger(steps) || Math.abs(steps) > MAX_STRETCH_STEPS) return [];
      const long = steps === 0 ? def : stretchDoodad(loaded.tileset, def, axis, steps);
      const x = tx0 + (isStretched(long) ? long.stretched.offset.x : 0), y = ty0 + (isStretched(long) ? long.stretched.offset.y : 0);
      if (x < 0 || y < 0 || x + long.width > w || y + long.height > h) return [];
      const edit = placeDoodadAsTerrain(scn, long, x, y, owner);
      applyTiles(edit.tiles);
      applySpriteChanges(scn, edit.sprites);
      sprites.push(...edit.sprites);
      const cells: number[] = [];
      for (let r = 0; r < long.height; r++) for (let c = 0; c < long.width; c++) if (long.tiles[r * long.width + c]) cells.push((y + r) * w + x + c);
      return cells;
    },
    removeDoodads: (indices) => {
      const edit = removeDoodads(scn, loaded?.tileset ?? null, loaded?.doodads ?? NO_DOODADS, indices);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodadTiles.push(...edit.tiles);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads.length;
    },
    convertDoodads: (indices) => {
      const edit = convertDoodads(scn, loaded?.doodads ?? NO_DOODADS, indices);
      // Terrain-layer changes: TILE follows MTXM, and the stroke keeps them though MTXM did
      // not move. A doodad this transaction itself placed has its stamp in `doodadTiles`,
      // which `applyEntry` replays *after* `changes` — so fold that stamp into the terrain
      // change (ground → tile, both sections) and drop it, or undo would put the tile back.
      for (const c of edit.tiles) {
        const first = doodadTiles.find((d) => d.at === c.at);
        if (!first) continue;
        c.before = first.before;
        for (let k = doodadTiles.length - 1; k >= 0; k--) if (doodadTiles[k].at === c.at) doodadTiles.splice(k, 1);
      }
      applyTiles(edit.tiles);
      applyDoodadChanges(scn, edit.doodads);
      doodads.push(...edit.doodads);
      return edit.doodads.length;
    },

    addLocation: (bounds, name, elevationFlags) => {
      ensureLocationSlots(scn);
      const { index, changes } = addLocation(scn, bounds, name, elevationFlags);
      applyLocationChanges(scn, changes);
      locations.push(...changes);
      return index;
    },
    editLocation: (index, patch) => {
      const c = editLocation(scn, index, patch);
      if (!c) return false;
      applyLocationChanges(scn, [c]);
      locations.push(c);
      return true;
    },
    removeLocations: (indices) => { const ch = removeLocations(scn, indices); applyLocationChanges(scn, ch); locations.push(...ch); return ch.length; },

    setFog: (cells, players, mode) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = paintFog(scn, cellsOf(cells), players, mode);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    invertFog: (players) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = invertFog(scn, players);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    copyFog: (from, to) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = copyFog(scn, from, to);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },
    floodFog: (x, y, player, players, mode) => {
      const created = ensureMask(scn);
      if (created) createdMask = created;
      const ch = paintFog(scn, floodFog(scn, x, y, player), players, mode);
      applyFogChanges(scn, ch);
      fog.add(ch);
      return ch.length;
    },

    replaceTerrain: (from, to, rect) => {
      if ((from.kind === "terrain" || to.kind === "terrain") && !loaded) { notes.push(t("replacing a terrain type needs the tileset graphics")); return 0; }
      return applyRuled(replaceTerrain(scn, loaded?.tileset ?? null, from, to, rect));
    },
    fillArea: (x, y, fill, match = "terrainId" in fill ? "terrain" : "tile") => {
      if (x < 0 || y < 0 || x >= w || y >= h) return 0;
      const seed = scn.tiles[y * w + x];
      let region: Set<number>;
      if (match === "terrain") {
        if (!loaded) { notes.push(t("a terrain fill needs the tileset graphics")); return 0; }
        const groups = loaded.tileset.groups;
        const typeOf = (id: number) => groups[id >> 4]?.index ?? -1;
        const seedType = typeOf(seed);
        region = floodRegion(scn, x, y, (id) => typeOf(id) === seedType);
      } else {
        region = floodRegion(scn, x, y, (id) => id === seed);
      }
      const cells = mirrorIndices(store.get(symmetryAtom), region, w, h);
      if ("tileId" in fill) return applyRuled(stampTile(scn, cells, fill.tileId));
      const type = flatOf(fill.terrainId);
      if (!type || !loaded) return 0;
      return applyRuled(stampTerrain(scn, loaded.tileset, { group: type.group, variation: store.get(rectVariationAtom) }, cells));
    },
    placeBlend: (x, y, side, id) => {
      const ch = placeBlend(scn, { x, y }, side, id);
      if (!ch) return false;
      applyTiles(ch);
      return true;
    },
    placeBlock: (block, x, y) => applyTiles(layBlock(scn, checkedBlock(block, "placeBlock"), x, y)),
    fillPattern: (cells, block, origin = { x: 0, y: 0 }) => applyTiles(layPattern(scn, checkedBlock(block, "fillPattern"), origin, cellsOf(cells))),
    heal: (cells) => {
      if (!loaded) { notes.push(t("healing seams needs the tileset graphics")); return 0; }
      return applyRuled(healTiles(scn, loaded.tileset, cellsOf(cells)));
    },
    pin: (cells, on = true) => {
      const before = store.get(archiveExtrasAtom).get(PINS_MEMBER) ?? null;
      const count = countPins(pinned());
      if (!store.set(pinCellsAtom, { cells: cellsOf(cells), on })) return 0;
      if (pinsBefore === undefined) pinsBefore = before;
      return Math.abs(countPins(pinned()) - count);
    },
    tilesFromIsom: () => {
      if (!hasIsom(scn) || !loaded) { notes.push(t("regenerating the tiles needs ISOM and the tileset graphics")); return null; }
      const edit = tilesFromIsom(scn, loaded.tileset, Math.random, pinned());
      applyChanges(scn, edit.tiles);
      tiles.add(edit.tiles);
      applyIsomChanges(scn, edit.isom);
      isom.add(edit.isom);
      return edit.tiles.length;
    },
    mirror: (cells) => [...mirrorIndices(store.get(symmetryAtom), cellsOf(cells), w, h)],
    mirrorPoint: (px, py) => mirrorPixel(store.get(symmetryAtom), px, py, w, h),

    moveUnits: (indices, dx, dy, snap) => {
      const ch = moveUnits(scn, tables(), indices, dx, dy, snap ?? store.get(placementOptionsAtom).snapToGrid);
      applyUnitChanges(scn, ch);
      units.push(...ch);
      return ch.length;
    },
    placeStartLocations: (options) => {
      const r = placeStartLocations(scn, loaded?.tileset ?? null, tables(), {
        ...DEFAULT_START_PLACEMENT, ...options, placement: store.get(placementOptionsAtom),
      });
      units.push(...r.changes);
      const missed = r.placed.filter((p) => p === null).length;
      if (missed > 0) notes.push(t("no room for {n, plural, one {# start location} other {# start locations}}", { n: missed }));
      return r;
    },

    updateSprites: (indices, patch) => { const ch = updateSprites(scn, indices, patch); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    moveSprites: (indices, dx, dy) => { const ch = moveSprites(scn, indices, dx, dy); applySpriteChanges(scn, ch); sprites.push(...ch); return ch.length; },
    updateDoodads: (indices, patch) => {
      const edit = updateDoodads(scn, loaded?.doodads ?? NO_DOODADS, indices, patch);
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      return edit.doodads.length;
    },

    restoreAnywhere: () => {
      ensureLocationSlots(scn);
      const c = restoreAnywhere(scn);
      if (!c) return false;
      applyLocationChanges(scn, [c]);
      locations.push(c);
      return true;
    },

    paste: (clip, px, py, options = {}) => {
      const r = pasteClip(scn, clip, px, py, {
        parts: { ...ALL_CLIP_PARTS, ...options.parts }, mode: options.mode ?? "merge",
        catalogue: loaded?.doodads ?? NO_DOODADS, tileset: loaded?.tileset ?? null,
      });
      // `pasteClip` applied its lists already; fold them into the entry's, in the order `applyEntry` replays them.
      const e = r.edit;
      tiles.add(e.changes);
      if (e.doodadTiles) doodadTiles.push(...e.doodadTiles);
      if (e.doodads) doodads.push(...e.doodads);
      if (e.sprites) sprites.push(...e.sprites);
      if (e.units) units.push(...e.units);
      if (e.locations) locations.push(...e.locations);
      if (e.fog) fog.add(e.fog);
      if (e.createdMask) createdMask = e.createdMask;
      // The pasted units took serials of their own; `makeUnit` must not hand them out again.
      serial = Math.max(serial, nextSerial(scn));
      notes.push(...r.notes);
      return r;
    },

    note: (text) => { notes.push(text); },
  };

  let isomChanges: TileChange[] = [];
  let fogChanges: TileChange[] = [];
  const finishEntry = (): HistoryEntry => {
    const entry: HistoryEntry = { label, tool: "plugin", changes: tiles.finish() };
    isomChanges = isom.finish();
    fogChanges = fog.finish();
    if (isomChanges.length > 0) entry.isom = isomChanges;
    if (doodadTiles.length > 0) entry.doodadTiles = doodadTiles;
    if (doodads.length > 0) entry.doodads = doodads;
    if (sprites.length > 0) entry.sprites = sprites;
    if (units.length > 0) entry.units = units;
    if (locations.length > 0) entry.locations = locations;
    if (fogChanges.length > 0) entry.fog = fogChanges;
    if (createdMask) entry.createdMask = createdMask;
    if (createdIsom) { entry.createdIsom = createdIsom; delete entry.isom; }
    else if (rebuiltIsom) entry.rebuiltIsom = true;
    if (pinsBefore !== undefined) entry.pins = { before: pinsBefore, after: store.get(archiveExtrasAtom).get(PINS_MEMBER) ?? null };
    if (membersBefore.size > 0) entry.members = [...membersBefore].map(([name, before]) => ({ name, before, after: store.get(archiveExtrasAtom).get(name) ?? null }));
    return entry;
  };

  // The operations applied live as the builder called them, so a builder that throws has
  // left them on the map: take them back (the change lists are the inverse) and let the
  // error through. Nothing reaches the history or the modified flag either way.
  let closed = false;
  let returned: unknown;
  try {
    returned = build(sealed("document.edit", tx, () => closed));
  } catch (err) {
    closed = true;
    const entry = finishEntry();
    if (hasEdits(entry) || hasMembers(entry)) store.set(rollbackEntryAtom, entry);
    throw err;
  }
  closed = true;
  checkSyncBuilder("document.edit", returned, notes);

  const entry = finishEntry();
  if (!hasEdits(entry) && !hasMembers(entry)) return { ...EMPTY_RESULT, notes };
  // The commit's stranded-doodad / stranded-unit pass may append to the entry's lists, so the counts come after it.
  store.set(commitTerrainAtom, { entry, summary: notes.length > 0 ? `${label} — ${notes.join(", ")}` : label });
  const strandedUnits = (entry.units?.length ?? 0) - units.length;
  const strandedDoodads = (entry.doodads?.length ?? 0) - doodads.length;
  if (strandedUnits > 0) notes.push(t("removed {n, plural, one {# stranded unit} other {# stranded units}}", { n: strandedUnits }));
  if (strandedDoodads > 0) notes.push(t("removed {n, plural, one {# stranded doodad} other {# stranded doodads}}", { n: strandedDoodads }));
  return {
    changed: true,
    tiles: entry.changes.length,
    isom: createdIsom ? createdIsom.length : isomChanges.length,
    units: entry.units?.length ?? 0,
    sprites: entry.sprites?.length ?? 0,
    doodads: entry.doodads?.length ?? 0,
    locations: locations.length,
    fog: fogChanges.length,
    notes,
  };
}
