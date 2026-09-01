import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { activeDoodadAtom, doodadPlacementAtom, doodadPlacingAtom, selectedDoodadsAtom, unitOwnerAtom } from "../atoms/editorAtoms";
import { commitEditAtom, deleteSelectedDoodadsAtom, scenarioAtom, tilesetFileNameAtom, type HistoryEntry } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  applyDoodadChanges, applySpriteChanges, checkDoodadPlacement, doodadAt, doodadFootprint, doodadsInBox, placeDoodad, removeDoodads,
  snapDoodad, updateDoodads, type DoodadChange, type DoodadEdit, type DoodadVerdict, type SpriteChange, type TileRect,
} from "../editor/doodads";
import { applyChanges, Stroke } from "../editor/terrain";
import type { DoodadRecord } from "../formats/chk/sections/objects";
import type { Scenario } from "../formats/chk/scenario";
import { doodadOrigin, NO_DOODADS, type DoodadCatalogue, type DoodadDef } from "../formats/tileset/doodads";
import { useTileset } from "./useTileset";
import type { MapPoint } from "./useTerrainTools";

/** A doodad drawn where it would land, with the verdict on whether it may. */
export interface DoodadGhost {
  def: DoodadDef;
  /** Top-left tile. */
  x: number;
  y: number;
  owner: number;
  verdict: DoodadVerdict;
}

export function doodadLabel(def: DoodadDef): string {
  return `${def.category} #${def.id}`;
}

function describeRefusal(def: DoodadDef, v: DoodadVerdict, hasPlacementData: boolean): string {
  if (v.outOfBounds) return `Can't place ${doodadLabel(def)} here: it would leave the map`;
  const cells = v.bad.length;
  const needs = hasPlacementData ? "this doodad needs the terrain it was drawn for under it" : "another doodad is in the way";
  return `Can't place ${doodadLabel(def)} here: ${cells} tile${cells === 1 ? "" : "s"} of its footprint ${cells === 1 ? "doesn't" : "don't"} match — ${needs} (Doodads ▸ Place anywhere)`;
}

/**
 * The Doodads layer's tools: place, pick, select, drag-move, re-own and delete, reading
 * the live store so pointer handlers never go stale. A move is applied on release only —
 * the drag shows ghosts — as one remove-and-place undo step.
 */
export function useDoodadTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setSelected = useSetAtom(selectedDoodadsAtom);
  const setPlacing = useSetAtom(doodadPlacingAtom);
  const deleteSelectedDoodads = useSetAtom(deleteSelectedDoodadsAtom);
  const { loaded } = useTileset();
  const tilesetName = useAtomValue(tilesetFileNameAtom);
  const catalogue: DoodadCatalogue = loaded?.doodads ?? NO_DOODADS;
  const tileset = loaded?.tileset ?? null;
  /** The drag in progress: where it started and the records it moves. */
  const drag = useRef<{ from: MapPoint; indices: number[]; dx: number; dy: number } | null>(null);

  const activeDef = useCallback((): DoodadDef | null => {
    const id = store.get(activeDoodadAtom);
    return catalogue.byId.get(id) ?? catalogue.doodads[0] ?? null;
  }, [store, catalogue]);

  /** Where the active doodad would land if dropped at `p`, and whether it may. */
  const ghostAt = useCallback((p: MapPoint): DoodadGhost | null => {
    const scn = store.get(scenarioAtom);
    const def = activeDef();
    if (!scn || !def) return null;
    const opts = store.get(doodadPlacementAtom);
    const { x, y } = snapDoodad(def, p.px, p.py, scn.width, scn.height, opts.snapToGrid);
    return { def, x, y, owner: store.get(unitOwnerAtom), verdict: checkDoodadPlacement(scn, tileset, def, x, y, opts) };
  }, [store, tileset, activeDef]);

  const apply = useCallback((scn: Scenario, edit: DoodadEdit) => {
    applyChanges(scn, edit.tiles, "do", "mtxm");
    applyDoodadChanges(scn, edit.doodads);
    applySpriteChanges(scn, edit.sprites);
  }, []);

  const entryFor = (label: string, edit: DoodadEdit): HistoryEntry =>
    ({ label, changes: [], doodadTiles: edit.tiles, doodads: edit.doodads, sprites: edit.sprites });

  /** Place the active doodad at `p`; false (with a status message) when the checks refuse it. */
  const placeAt = useCallback((p: MapPoint): boolean => {
    const scn = store.get(scenarioAtom);
    const ghost = ghostAt(p);
    if (!scn || !ghost) return false;
    if (!ghost.verdict.ok) {
      setStatus(describeRefusal(ghost.def, ghost.verdict, catalogue.hasPlacementData));
      return false;
    }
    const edit = placeDoodad(scn, ghost.def, ghost.x, ghost.y, ghost.owner);
    apply(scn, edit);
    setSelected([]);
    commit(entryFor(`Place ${doodadLabel(ghost.def)}`, edit));
    setStatus(`Placed ${doodadLabel(ghost.def)} (${ghost.def.width}×${ghost.def.height}) at tile ${ghost.x}, ${ghost.y} — Esc or right-click to stop placing`);
    return true;
  }, [store, catalogue, ghostAt, apply, commit, setSelected, setStatus]);

  /** Arm placement of doodad `id` (the palette's click). */
  const startPlacing = useCallback((id?: number) => {
    if (id !== undefined) store.set(activeDoodadAtom, id);
    setPlacing(true);
  }, [store, setPlacing]);

  const stopPlacing = useCallback(() => {
    if (!store.get(doodadPlacingAtom)) return false;
    setPlacing(false);
    setStatus("Stopped placing — click a doodad to select it, or pick one in the palette to place");
    return true;
  }, [store, setPlacing, setStatus]);

  /** DD2 index of the doodad under tile (tx, ty), or -1. */
  const pickAt = useCallback((tx: number, ty: number): number => {
    const scn = store.get(scenarioAtom);
    return scn ? doodadAt(scn, catalogue, tx, ty) : -1;
  }, [store, catalogue]);

  const select = useCallback((indices: number[], additive = false) => {
    if (!additive) { setSelected(indices); return; }
    const set = new Set(store.get(selectedDoodadsAtom));
    for (const i of indices) { if (set.has(i)) set.delete(i); else set.add(i); }
    setSelected([...set]);
  }, [store, setSelected]);

  const selectInBox = useCallback((box: TileRect, additive = false) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const hits = doodadsInBox(scn, catalogue, box);
    if (additive) setSelected([...new Set([...store.get(selectedDoodadsAtom), ...hits])]);
    else setSelected(hits);
  }, [store, catalogue, setSelected]);

  /** The footprint of a placed doodad, for outlines; null when its type is unknown to this tileset. */
  const footprintOf = useCallback((rec: DoodadRecord): TileRect | null => {
    const def = catalogue.byId.get(rec.doodadId);
    return def ? doodadFootprint(def, rec) : null;
  }, [catalogue]);

  const beginDrag = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    drag.current = { from: p, indices: store.get(selectedDoodadsAtom).filter((i) => scn.doodads[i]), dx: 0, dy: 0 };
  }, [store]);

  /** Track the pointer; returns true when the offset (in tiles, snapped) changed. */
  const dragTo = useCallback((p: MapPoint): boolean => {
    const d = drag.current;
    if (!d) return false;
    let dx = Math.round((p.px - d.from.px) / 32);
    const dy = Math.round((p.py - d.from.py) / 32);
    if (store.get(doodadPlacementAtom).snapToGrid) dx = Math.round(dx / 2) * 2;
    if (dx === d.dx && dy === d.dy) return false;
    d.dx = dx;
    d.dy = dy;
    return true;
  }, [store]);

  /**
   * The moving doodads at their would-be positions, checked against the map as it would
   * be with their old copies lifted (so a doodad may overlap its own previous spot).
   */
  const dragGhosts = useCallback((): DoodadGhost[] => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    if (!scn || !d) return [];
    const lifted = removeDoodads(scn, tileset, catalogue, d.indices);
    const under = new Map(lifted.tiles.map((c) => [c.at, c.after]));
    const tileAt = (at: number) => under.get(at) ?? scn.tiles[at];
    const opts = store.get(doodadPlacementAtom);
    const out: DoodadGhost[] = [];
    for (const i of d.indices) {
      const rec = scn.doodads[i];
      const def = rec && catalogue.byId.get(rec.doodadId);
      if (!def) continue;
      const o = doodadOrigin(def, rec.x, rec.y);
      const x = o.x + d.dx, y = o.y + d.dy;
      out.push({ def, x, y, owner: rec.owner, verdict: checkDoodadPlacement(scn, tileset, def, x, y, opts, tileAt) });
    }
    return out;
  }, [store, tileset, catalogue]);

  /** Commit the drag as one remove-and-place step; a refused drop leaves everything where it was. */
  const endDrag = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    drag.current = null;
    if (!scn || !d || (d.dx === 0 && d.dy === 0) || d.indices.length === 0) return false;
    // dragGhosts reads the drag, so keep it in place until the verdicts are in.
    drag.current = d;
    const moving = dragGhosts();
    drag.current = null;
    const refused = moving.find((g) => !g.verdict.ok);
    if (refused) {
      setStatus(describeRefusal(refused.def, refused.verdict, catalogue.hasPlacementData).replace("place", "move"));
      return false;
    }
    // Lift the old copies, then stamp the new ones over the result; merge the tile
    // changes so a cell that was restored and re-covered records one before/after.
    const lifted = removeDoodads(scn, tileset, catalogue, d.indices);
    applyChanges(scn, lifted.tiles, "do", "mtxm");
    applyDoodadChanges(scn, lifted.doodads);
    applySpriteChanges(scn, lifted.sprites);
    const tiles = new Stroke();
    tiles.add(lifted.tiles);
    const doodads: DoodadChange[] = [...lifted.doodads];
    const sprites: SpriteChange[] = [...lifted.sprites];
    const placedIndices: number[] = [];
    for (const g of moving) {
      const edit = placeDoodad(scn, g.def, g.x, g.y, g.owner);
      applyChanges(scn, edit.tiles, "do", "mtxm");
      applyDoodadChanges(scn, edit.doodads);
      applySpriteChanges(scn, edit.sprites);
      tiles.add(edit.tiles);
      doodads.push(...edit.doodads);
      sprites.push(...edit.sprites);
      placedIndices.push(...edit.doodads.map((c) => c.index));
    }
    const n = moving.length;
    commit({ label: `Move ${n} doodad${n === 1 ? "" : "s"}`, changes: [], doodadTiles: tiles.finish(), doodads, sprites });
    // The moved doodads are new records at the end of the list; keep them selected.
    setSelected(placedIndices);
    setStatus(`Moved ${n} doodad${n === 1 ? "" : "s"} by ${d.dx}, ${d.dy} tiles`);
    return true;
  }, [store, tileset, catalogue, dragGhosts, commit, setSelected, setStatus]);

  const dragging = useCallback(() => drag.current !== null, []);

  /** Re-own or enable/disable the selection as one undo step; the selection survives (indices unchanged). */
  const updateSelected = useCallback((label: string, patch: Partial<Pick<DoodadRecord, "owner" | "disabled">>): number => {
    const scn = store.get(scenarioAtom);
    const selected = store.get(selectedDoodadsAtom);
    if (!scn || selected.length === 0) return 0;
    const edit = updateDoodads(scn, catalogue, selected, patch);
    if (edit.doodads.length === 0) return 0;
    apply(scn, edit);
    commit(entryFor(label, edit));
    setSelected(selected);
    return edit.doodads.length;
  }, [store, catalogue, apply, commit, setSelected]);

  const setOwner = useCallback((owner: number) => updateSelected(`Set doodad owner to Player ${owner + 1}`, { owner }), [updateSelected]);
  const setDisabled = useCallback((disabled: boolean) => updateSelected(disabled ? "Disable doodad" : "Enable doodad", { disabled: disabled ? 1 : 0 }), [updateSelected]);

  const deleteSelected = useCallback(() => {
    const n = deleteSelectedDoodads();
    if (n > 0) setStatus(`Deleted ${n} doodad${n === 1 ? "" : "s"}`);
    return n;
  }, [deleteSelectedDoodads, setStatus]);

  return useMemo(
    () => ({ loaded, catalogue, tilesetName, activeDef, ghostAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, footprintOf, beginDrag, dragTo, dragGhosts, endDrag, dragging, updateSelected, setOwner, setDisabled, deleteSelected }),
    [loaded, catalogue, tilesetName, activeDef, ghostAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, footprintOf, beginDrag, dragTo, dragGhosts, endDrag, dragging, updateSelected, setOwner, setDisabled, deleteSelected],
  );
}
