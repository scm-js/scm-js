/**
 * The state of `ui.mapView` (`mapViewStateAtom`) as pure steps: which maps offer which views,
 * which view each shows. The host's `addMapView` and the switch over the map both go
 * through these, so the rules (one shown at a time, a view no longer offered is no longer
 * shown, a closed map forgotten) live in one place.
 */
import type { MapViewState } from "../atoms/pluginAtoms";

/** `state` with view `key` offered, or no longer offered, on map `doc` (and shown there no longer when it is not offered). */
export function offerMapView(state: MapViewState, doc: number, key: number, on: boolean): MapViewState {
  const list = state.offered.get(doc) ?? [];
  if (on === list.includes(key)) return state;
  const offered = new Map(state.offered);
  const next = on ? [...list, key] : list.filter((k) => k !== key);
  if (next.length) offered.set(doc, next); else offered.delete(doc);
  if (on || state.shown.get(doc) !== key) return { offered, shown: state.shown };
  const shown = new Map(state.shown);
  shown.delete(doc);
  return { offered, shown };
}

/** `state` with map `doc` showing view `key`, offering it if it did not, or the map itself for null. */
export function showMapView(state: MapViewState, doc: number, key: number | null): MapViewState {
  const base = key === null ? state : offerMapView(state, doc, key, true);
  if ((base.shown.get(doc) ?? null) === key) return base;
  const shown = new Map(base.shown);
  if (key === null) shown.delete(doc); else shown.set(doc, key);
  return { offered: base.offered, shown };
}

/** `state` without the maps not in `live` (closed) and without the views not in `keys` (gone). */
export function pruneMapViews(state: MapViewState, live: ReadonlySet<number>, keys: ReadonlySet<number>): MapViewState {
  let changed = false;
  const offered = new Map<number, readonly number[]>();
  for (const [doc, list] of state.offered) {
    const kept = live.has(doc) ? list.filter((k) => keys.has(k)) : [];
    if (kept.length !== list.length) changed = true;
    if (kept.length) offered.set(doc, kept);
  }
  const shown = new Map<number, number>();
  for (const [doc, key] of state.shown) {
    if (live.has(doc) && keys.has(key)) shown.set(doc, key); else changed = true;
  }
  return changed ? { offered, shown } : state;
}
