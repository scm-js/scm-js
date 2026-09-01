import { useCallback, useMemo, useRef } from "react";
import { useSetAtom, useStore } from "jotai";
import {
  activeSpriteAtom, activeSpriteKindAtom, activeUnitSpriteAtom, selectedSpritesAtom, spritePlaceOptionsAtom, spritePlacingAtom, unitOwnerAtom,
} from "../atoms/editorAtoms";
import { commitEditAtom, deleteSelectedSpritesAtom, doodadsRevisionAtom, scenarioAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  addSprites, applySpriteChanges, clampSprite, FALLBACK_SIZE, frameSize, makeSprite, spriteAt, spriteBox, spriteKind, spritesInBox, updateSprites,
  type SpriteBox, type SpriteChange, type SpriteKind, type SpriteSize,
} from "../editor/sprites";
import { unitBox, unitGeometry } from "../editor/units";
import { SpriteFlag, type SpriteRecord } from "../formats/chk/sections/objects";
import { NO_UNIT } from "../formats/dat/dat";
import { imageGrpPath, requestGrp, unitImageId, type UnitAssets } from "../formats/units/load";
import { editorFrame } from "../formats/units/sprites";
import type { Grp } from "../formats/dat/grp";
import { spriteLabel } from "../data/sprites";
import { unitName } from "../data/units";
import type { MapPoint } from "./useTerrainTools";
import { useUnitAssets } from "./useUnitAssets";

export interface SpriteGhost {
  kind: SpriteKind;
  id: number;
  owner: number;
  flags: number;
  x: number;
  y: number;
  box: SpriteBox;
}

/** The images.dat id a record draws with, or -1 when the tables cannot say. */
export function spriteImageId(assets: UnitAssets | null, kind: SpriteKind, id: number): number {
  if (!assets) return -1;
  if (kind === "pure") return assets.sprites.image[id] ?? -1;
  return id >= 0 && id < NO_UNIT ? unitImageId(assets, id) : -1;
}

/** The GRP a record draws with, once loaded (null while loading or when there is none). */
export function spriteGrp(assets: UnitAssets | null, kind: SpriteKind, id: number): Grp | null {
  const imageId = spriteImageId(assets, kind, id);
  const path = imageId >= 0 && assets ? imageGrpPath(assets, imageId) : null;
  return (path ? requestGrp(path) : null) ?? null;
}

/** Which frame of its GRP a record shows in the editor, and whether mirrored. */
export function spriteFrame(assets: UnitAssets, kind: SpriteKind, id: number, flipped: boolean): { frame: number; flip: boolean } {
  return kind === "unit" ? editorFrame(assets, id, unitImageId(assets, id)) : { frame: 0, flip: flipped };
}

/** "Terran Marine" for a unit sprite, the sprites.dat label for a pure one. */
export function spriteName(assets: UnitAssets | null, kind: SpriteKind, id: number): string {
  return kind === "unit" ? unitName(id) : spriteLabel(assets, id);
}

/**
 * The Sprites layer's tools: place, pick, select, drag-move, re-own and re-flag THG2
 * records, all reading the live store so pointer handlers never go stale. Sprites have
 * no placement rules — anything goes anywhere — so a move is applied live during the
 * drag and committed once on release, like a unit drag.
 */
export function useSpriteTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bump = useSetAtom(doodadsRevisionAtom);
  const setSelected = useSetAtom(selectedSpritesAtom);
  const setPlacing = useSetAtom(spritePlacingAtom);
  const deleteSelectedSprites = useSetAtom(deleteSelectedSpritesAtom);
  const { loaded: assets } = useUnitAssets();
  const drag = useRef<{ from: MapPoint; origin: Map<number, SpriteRecord> } | null>(null);

  /**
   * The graphic's rectangle for hit-testing: the opaque part of the frame the viewport
   * draws once the GRP has loaded, a unit's collision box for a unit sprite whose GRP is
   * not in yet, one tile otherwise.
   */
  const sizeOfKind = useCallback((kind: SpriteKind, id: number, flipped: boolean): SpriteSize => {
    const grp = spriteGrp(assets, kind, id);
    if (assets && grp && grp.width > 0 && grp.height > 0 && grp.frames.length > 0) {
      const { frame, flip } = spriteFrame(assets, kind, id, flipped);
      const f = grp.frames[Math.min(frame, grp.frames.length - 1)];
      if (f.width > 0 && f.height > 0) return frameSize(grp.width, grp.height, f, flip);
      return { width: grp.width, height: grp.height };
    }
    if (kind === "unit") {
      const g = unitGeometry(assets?.units ?? null, id);
      const b = unitBox(g, 0, 0);
      return { width: b.right - b.left, height: b.bottom - b.top };
    }
    return FALLBACK_SIZE;
  }, [assets]);
  const sizeOf = useCallback((r: SpriteRecord) => sizeOfKind(spriteKind(r), r.spriteId, (r.flags & SpriteFlag.Flipped) !== 0), [sizeOfKind]);
  const boxOf = useCallback((r: SpriteRecord) => spriteBox(r, sizeOf(r)), [sizeOf]);

  /** What the palette would place: kind, id and flags. */
  const active = useCallback(() => {
    const kind = store.get(activeSpriteKindAtom);
    const id = kind === "pure" ? store.get(activeSpriteAtom) : store.get(activeUnitSpriteAtom);
    const opts = store.get(spritePlaceOptionsAtom);
    return { kind, id, owner: store.get(unitOwnerAtom), flags: makeSprite(kind, id, 0, 0, 0, opts).flags };
  }, [store]);

  /** Where the active sprite would land if dropped at `p`. */
  const ghostAt = useCallback((p: MapPoint): SpriteGhost | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const a = active();
    const { x, y } = clampSprite(p.px, p.py, scn.width, scn.height);
    const record = { spriteId: a.id, x, y, owner: a.owner, unused: 0, flags: a.flags };
    const box = spriteBox(record, sizeOf(record));
    return { ...a, x, y, box };
  }, [store, active, sizeOf]);

  const placeAt = useCallback((p: MapPoint): boolean => {
    const scn = store.get(scenarioAtom);
    const ghost = ghostAt(p);
    if (!scn || !ghost) return false;
    const record = makeSprite(ghost.kind, ghost.id, ghost.owner, ghost.x, ghost.y, store.get(spritePlaceOptionsAtom));
    const sprites = addSprites(scn, [record]);
    applySpriteChanges(scn, sprites);
    const name = spriteName(assets, ghost.kind, ghost.id);
    commit({ label: `Place sprite ${name}`, changes: [], sprites });
    setStatus(`Placed ${ghost.kind === "unit" ? "unit sprite" : "sprite"} ${name} for Player ${ghost.owner + 1} at ${ghost.x}, ${ghost.y} — Esc or right-click to stop placing`);
    return true;
  }, [store, assets, ghostAt, commit, setStatus]);

  /** Arm placement (the palette's click); with arguments, also choose what to place. */
  const startPlacing = useCallback((kind?: SpriteKind, id?: number) => {
    if (kind) store.set(activeSpriteKindAtom, kind);
    if (id !== undefined) store.set((kind ?? store.get(activeSpriteKindAtom)) === "pure" ? activeSpriteAtom : activeUnitSpriteAtom, id);
    setPlacing(true);
  }, [store, setPlacing]);

  const stopPlacing = useCallback(() => {
    if (!store.get(spritePlacingAtom)) return false;
    setPlacing(false);
    setStatus("Stopped placing — click a sprite to select it, or pick one in the palette to place");
    return true;
  }, [store, setPlacing, setStatus]);

  const pickAt = useCallback((p: MapPoint): number => {
    const scn = store.get(scenarioAtom);
    return scn ? spriteAt(scn, p.px, p.py, sizeOf) : -1;
  }, [store, sizeOf]);

  const select = useCallback((indices: number[], additive = false) => {
    if (!additive) { setSelected(indices); return; }
    const set = new Set(store.get(selectedSpritesAtom));
    for (const i of indices) { if (set.has(i)) set.delete(i); else set.add(i); }
    setSelected([...set]);
  }, [store, setSelected]);

  const selectInBox = useCallback((box: SpriteBox, additive = false) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const hits = spritesInBox(scn, box, sizeOf);
    if (additive) setSelected([...new Set([...store.get(selectedSpritesAtom), ...hits])]);
    else setSelected(hits);
  }, [store, sizeOf, setSelected]);

  const beginDrag = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const origin = new Map<number, SpriteRecord>();
    for (const i of store.get(selectedSpritesAtom)) if (scn.sprites[i]) origin.set(i, scn.sprites[i]);
    drag.current = { from: p, origin };
  }, [store]);

  const dragTo = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    if (!scn || !d) return;
    const dx = p.px - d.from.px, dy = p.py - d.from.py;
    let changed = false;
    for (const [i, before] of d.origin) {
      const at = clampSprite(before.x + dx, before.y + dy, scn.width, scn.height);
      const cur = scn.sprites[i];
      if (cur.x !== at.x || cur.y !== at.y) { scn.sprites[i] = { ...before, ...at }; changed = true; }
    }
    if (changed) bump((r) => r + 1);
  }, [store, bump]);

  /** Commit the drag as one step; returns true when anything actually moved. */
  const endDrag = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    drag.current = null;
    if (!scn || !d) return false;
    const sprites: SpriteChange[] = [];
    for (const [i, before] of d.origin) {
      const after = scn.sprites[i];
      if (after && (after.x !== before.x || after.y !== before.y)) sprites.push({ index: i, before, after });
    }
    if (sprites.length === 0) return false;
    // The records are already in place; commit just records the step and marks the file dirty.
    applySpriteChanges(scn, sprites);
    commit({ label: `Move ${sprites.length} sprite${sprites.length === 1 ? "" : "s"}`, changes: [], sprites });
    setStatus(`Moved ${sprites.length} sprite${sprites.length === 1 ? "" : "s"}`);
    return true;
  }, [store, commit, setStatus]);

  /** Replace fields on the selection as one undo step; the selection survives (indices are unchanged). */
  const updateSelected = useCallback((label: string, patch: (r: SpriteRecord) => Partial<SpriteRecord>, indices?: number[]): number => {
    const scn = store.get(scenarioAtom);
    const selected = indices ?? store.get(selectedSpritesAtom);
    if (!scn || selected.length === 0) return 0;
    const sprites = updateSprites(scn, selected, patch);
    if (sprites.length === 0) return 0;
    applySpriteChanges(scn, sprites);
    commit({ label, changes: [], sprites });
    setSelected(selected);
    return sprites.length;
  }, [store, commit, setSelected]);

  const setOwner = useCallback((owner: number) => {
    updateSelected(`Set sprite owner to Player ${owner + 1}`, () => ({ owner }));
  }, [updateSelected]);

  const setFlag = useCallback((bit: number, on: boolean, label: string) => {
    updateSelected(label, (r) => ({ flags: on ? r.flags | bit : r.flags & ~bit }));
  }, [updateSelected]);

  const deleteSelected = useCallback(() => {
    const n = deleteSelectedSprites();
    if (n > 0) setStatus(`Deleted ${n} sprite${n === 1 ? "" : "s"}`);
    return n;
  }, [deleteSelectedSprites, setStatus]);

  return useMemo(
    () => ({ assets, sizeOf, boxOf, active, ghostAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, beginDrag, dragTo, endDrag, updateSelected, setOwner, setFlag, deleteSelected }),
    [assets, sizeOf, boxOf, active, ghostAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, beginDrag, dragTo, endDrag, updateSelected, setOwner, setFlag, deleteSelected],
  );
}

export { SpriteFlag };
