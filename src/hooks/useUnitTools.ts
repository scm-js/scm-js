import { useCallback, useMemo, useRef } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { activeUnitAtom, placementOptionsAtom, selectedUnitsAtom, symmetryAtom, unitOwnerAtom, unitPlacingAtom } from "../atoms/editorAtoms";
import { commitEditAtom, deleteSelectedUnitsAtom, scenarioAtom, tilesetFileNameAtom, unitsRevisionAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import {
  addUnits, applyUnitChanges, makeUnit, nextSerial, snapPlacement, unitAt, unitGeometry, unitsInBox, updateUnits,
  type PixelBox, type UnitChange, type UnitGeometry,
} from "../editor/units";
import { checkPlacement, placementReason, type PlacementProblem } from "../editor/placement";
import { mirrorPixel } from "../editor/symmetry";
import type { UnitRecord } from "../formats/chk/sections/objects";
import type { UnitsDat } from "../formats/dat/dat";
import { peekTileset } from "../formats/tileset/load";
import { unitName } from "../data/units";
import type { MapPoint } from "./useTerrainTools";
import { useUnitAssets } from "./useUnitAssets";

export interface UnitGhost {
  unitId: number;
  owner: number;
  x: number;
  y: number;
  geometry: UnitGeometry;
  /** Why the unit cannot go here under the current placement options, or null. */
  problem: PlacementProblem | null;
  /** The unit in the way, for collision problems. */
  blocker: number;
}

function describeProblem(tables: UnitsDat | null, unitId: number, verdict: { problem: PlacementProblem | null; blocker: number }, scn: { units: UnitRecord[] }): string {
  const reason = placementReason(tables, unitId, verdict.problem, verdict.blocker, scn.units);
  return `Can't place ${unitName(unitId)} here: ${reason} (Placement ▸ Check ${verdict.problem === "terrain" ? "terrain" : "collision"})`;
}

/**
 * The Units layer's tools: place, pick, select, drag-move and re-own, all reading the
 * live store so pointer handlers never go stale. Moves are applied live during the drag
 * and committed once on release, like a terrain stroke; a drop the placement checks
 * refuse snaps back.
 */
export function useUnitTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bump = useSetAtom(unitsRevisionAtom);
  const setSelected = useSetAtom(selectedUnitsAtom);
  const setPlacing = useSetAtom(unitPlacingAtom);
  const deleteSelectedUnits = useSetAtom(deleteSelectedUnitsAtom);
  const { loaded: assets } = useUnitAssets();
  const tables = assets?.units ?? null;
  const tilesetName = useAtomValue(tilesetFileNameAtom);
  /** Records as they were when the drag started, by index. */
  const drag = useRef<{ from: MapPoint; origin: Map<number, UnitRecord> } | null>(null);

  const geometryOf = useCallback((unitId: number) => unitGeometry(tables, unitId), [tables]);
  const tilesetOf = useCallback(() => peekTileset(tilesetName)?.tileset ?? null, [tilesetName]);

  /** Where the active unit would land if dropped at `p`, and whether it may. */
  const ghostAt = useCallback((p: MapPoint): UnitGhost | null => {
    const scn = store.get(scenarioAtom);
    if (!scn) return null;
    const unitId = store.get(activeUnitAtom);
    const geometry = unitGeometry(tables, unitId);
    const opts = store.get(placementOptionsAtom);
    const { x, y } = snapPlacement(geometry, p.px, p.py, scn.width, scn.height, opts.snapToGrid);
    const verdict = checkPlacement(scn, tilesetOf(), tables, opts, unitId, x, y);
    return { unitId, owner: store.get(unitOwnerAtom), x, y, geometry, ...verdict };
  }, [store, tables, tilesetOf]);

  /** The ghost and its images under the symmetry mode (Tools ▸ Symmetry…), the pointed one first. */
  const ghostsAt = useCallback((p: MapPoint): UnitGhost[] => {
    const scn = store.get(scenarioAtom);
    if (!scn) return [];
    return mirrorPixel(store.get(symmetryAtom), p.px, p.py, scn.width, scn.height).map((q) => ghostAt({ px: q.x, py: q.y })).filter((g): g is UnitGhost => g !== null);
  }, [store, ghostAt]);

  /**
   * Place the active unit at `p` — and, under a symmetry mode, at its images, each checked
   * against the ones placed before it; false (with a status message) when the checks
   * refuse the pointed spot. One undo step.
   */
  const placeAt = useCallback((p: MapPoint): boolean => {
    const scn = store.get(scenarioAtom);
    const ghosts = ghostsAt(p);
    const ghost = ghosts[0];
    if (!scn || !ghost) return false;
    if (ghost.problem) {
      setStatus(describeProblem(tables, ghost.unitId, ghost, scn));
      return false;
    }
    const opts = store.get(placementOptionsAtom);
    const units: UnitChange[] = [];
    let serial = nextSerial(scn);
    let skipped = 0;
    for (const g of ghosts) {
      if (g !== ghost && checkPlacement(scn, tilesetOf(), tables, opts, g.unitId, g.x, g.y).problem !== null) { skipped++; continue; }
      const list = addUnits(scn, [makeUnit(tables, g.unitId, g.owner, g.x, g.y, serial++)]);
      applyUnitChanges(scn, list);
      units.push(...list);
    }
    const n = units.length;
    commit({ label: n === 1 ? `Place ${unitName(ghost.unitId)}` : `Place ${n} × ${unitName(ghost.unitId)}`, changes: [], units });
    setStatus(`Placed ${n === 1 ? "" : `${n} × `}${unitName(ghost.unitId)} for Player ${ghost.owner + 1} at ${ghost.x}, ${ghost.y}${skipped ? ` (${skipped} mirror image${skipped === 1 ? "" : "s"} refused)` : ""} — Esc or right-click to stop placing`);
    return true;
  }, [store, tables, tilesetOf, ghostsAt, commit, setStatus]);

  /** Arm placement of `unitId` (the palette's click). */
  const startPlacing = useCallback((unitId?: number) => {
    if (unitId !== undefined) store.set(activeUnitAtom, unitId);
    setPlacing(true);
  }, [store, setPlacing]);

  const stopPlacing = useCallback(() => {
    if (!store.get(unitPlacingAtom)) return false;
    setPlacing(false);
    setStatus("Stopped placing — click a unit to select it, or pick one in the palette to place");
    return true;
  }, [store, setPlacing, setStatus]);

  const pickAt = useCallback((p: MapPoint): number => {
    const scn = store.get(scenarioAtom);
    return scn ? unitAt(scn, tables, p.px, p.py) : -1;
  }, [store, tables]);

  const select = useCallback((indices: number[], additive = false) => {
    const current = store.get(selectedUnitsAtom);
    if (!additive) { setSelected(indices); return; }
    const set = new Set(current);
    for (const i of indices) { if (set.has(i)) set.delete(i); else set.add(i); }
    setSelected([...set]);
  }, [store, setSelected]);

  const selectInBox = useCallback((box: PixelBox, additive = false) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const hits = unitsInBox(scn, tables, box);
    if (additive) setSelected([...new Set([...store.get(selectedUnitsAtom), ...hits])]);
    else setSelected(hits);
  }, [store, tables, setSelected]);

  const beginDrag = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const origin = new Map<number, UnitRecord>();
    for (const i of store.get(selectedUnitsAtom)) if (scn.units[i]) origin.set(i, scn.units[i]);
    drag.current = { from: p, origin };
  }, [store]);

  const dragTo = useCallback((p: MapPoint) => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    if (!scn || !d) return;
    const dx = p.px - d.from.px, dy = p.py - d.from.py;
    const snap = store.get(placementOptionsAtom).snapToGrid;
    let changed = false;
    for (const [i, before] of d.origin) {
      const at = snapPlacement(unitGeometry(tables, before.unitId), before.x + dx, before.y + dy, scn.width, scn.height, snap);
      const cur = scn.units[i];
      if (cur.x !== at.x || cur.y !== at.y) { scn.units[i] = { ...before, ...at }; changed = true; }
    }
    if (changed) bump((r) => r + 1);
  }, [store, tables, bump]);

  /** Whether the dragged units may be dropped where they are now (the moving set ignores itself). */
  const dragProblem = useCallback((): { problem: PlacementProblem; index: number; blocker: number } | null => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    if (!scn || !d) return null;
    const moving = new Set(d.origin.keys());
    const opts = store.get(placementOptionsAtom);
    const tileset = tilesetOf();
    for (const i of moving) {
      const u = scn.units[i];
      if (!u) continue;
      const v = checkPlacement(scn, tileset, tables, opts, u.unitId, u.x, u.y, moving);
      if (v.problem) return { problem: v.problem, index: i, blocker: v.blocker };
    }
    return null;
  }, [store, tables, tilesetOf]);

  /** Commit the drag as one step; returns true when anything actually moved. A refused drop snaps back. */
  const endDrag = useCallback((): boolean => {
    const scn = store.get(scenarioAtom);
    const d = drag.current;
    drag.current = null;
    if (!scn || !d) return false;
    const problem = dragProblem();
    if (problem) {
      for (const [i, before] of d.origin) scn.units[i] = before;
      bump((r) => r + 1);
      const u = d.origin.get(problem.index)!;
      setStatus(describeProblem(tables, u.unitId, problem, scn).replace("place", "move"));
      return false;
    }
    const units: UnitChange[] = [];
    for (const [i, before] of d.origin) {
      const after = scn.units[i];
      if (after && (after.x !== before.x || after.y !== before.y)) units.push({ index: i, before, after });
    }
    if (units.length === 0) return false;
    // The records are already in place; commit just records the step and marks the file dirty.
    applyUnitChanges(scn, units);
    commit({ label: `Move ${units.length} unit${units.length === 1 ? "" : "s"}`, changes: [], units });
    setStatus(`Moved ${units.length} unit${units.length === 1 ? "" : "s"}`);
    return true;
  }, [store, tables, commit, setStatus, bump, dragProblem]);

  /** Replace fields on the selection as one undo step; the selection survives (indices are unchanged). */
  const updateSelected = useCallback((label: string, patch: (u: UnitRecord) => Partial<UnitRecord>, indices?: number[]): number => {
    const scn = store.get(scenarioAtom);
    const selected = indices ?? store.get(selectedUnitsAtom);
    if (!scn || selected.length === 0) return 0;
    const units = updateUnits(scn, selected, patch);
    if (units.length === 0) return 0;
    applyUnitChanges(scn, units);
    commit({ label, changes: [], units });
    setSelected(selected);
    return units.length;
  }, [store, commit, setSelected]);

  const setOwner = useCallback((owner: number) => {
    updateSelected(`Set owner to Player ${owner + 1}`, () => ({ owner }));
  }, [updateSelected]);

  const deleteSelected = useCallback(() => {
    const n = deleteSelectedUnits();
    if (n > 0) setStatus(`Deleted ${n} unit${n === 1 ? "" : "s"}`);
    return n;
  }, [deleteSelectedUnits, setStatus]);

  return useMemo(
    () => ({ assets, tables, geometryOf, ghostAt, ghostsAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, beginDrag, dragTo, dragProblem, endDrag, updateSelected, setOwner, deleteSelected }),
    [assets, tables, geometryOf, ghostAt, ghostsAt, placeAt, startPlacing, stopPlacing, pickAt, select, selectInBox, beginDrag, dragTo, dragProblem, endDrag, updateSelected, setOwner, deleteSelected],
  );
}
