/**
 * `api.view`: where the viewport looks, what it draws, and flashes over the map.
 */
import { centerViewOnAtom, cursorTileAtom, gridSizeAtom, selectedLocationsAtom, selectedSpritesAtom, selectedUnitsAtom, viewFlagsAtom, viewportRectAtom, zoomAtom, ZOOM_STEPS } from "../../atoms/editorAtoms";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { nextContributionKey, viewFlashesAtom, type ViewFlash } from "../../atoms/pluginAtoms";
import { peekUnitAssets } from "../../formats/units/load";
import { boundsOf } from "../../editor/locations";
import { ANYWHERE_INDEX, isLocationUsed } from "../../formats/chk/sections/objects";
import { TILE_PX, unitBox, unitGeometry } from "../../editor/units";
import type { FlashTarget, ViewApi } from "../api";
import type { Store } from "./shared";

/** How far the zoom control goes either way; anything between is allowed. */
export const ZOOM_RANGE = [0.05, 8] as const;

/** `api.view`: where the viewport is looking and what it draws over the terrain. */
export function viewApi(store: Store): ViewApi {
  const scenario = () => store.get(scenarioAtom);
  const centerOn = (x: number, y: number) => store.set(centerViewOnAtom, { x, y });
  return {
    zoom: () => store.get(zoomAtom),
    setZoom: (zoom) => store.set(zoomAtom, Math.max(ZOOM_RANGE[0], Math.min(ZOOM_RANGE[1], zoom))),
    visible: () => {
      const r = store.get(viewportRectAtom);
      return { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
    },
    center: centerOn,
    reveal: (rect, options = {}) => {
      if (!scenario()) return Promise.resolve(false);
      const { fit = false, animate = true } = options;
      const margin = Math.max(0, options.margin ?? 1);
      const x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1), y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
      const v = store.get(viewportRectAtom);
      let zoom = store.get(zoomAtom);
      let w = v.w, h = v.h;
      if (fit) {
        // The viewport's size in tiles grows as the zoom shrinks; take the largest step that holds the rect.
        const steps = ZOOM_STEPS.filter((z) => z <= zoom).reverse();
        const step = steps.find((z) => x1 - x0 + 2 * margin <= (w * zoom) / z && y1 - y0 + 2 * margin <= (h * zoom) / z) ?? steps.at(-1);
        if (step !== undefined && step < zoom) { w *= zoom / step; h *= zoom / step; zoom = step; store.set(zoomAtom, zoom); }
      }
      const inside = x0 >= v.x && x1 <= v.x + v.w && y0 >= v.y && y1 <= v.y + v.h;
      if (inside && w === v.w && h === v.h) return Promise.resolve(true);
      // The shortest move that shows the rect with its margin; a rect wider than the view is centred.
      const shift = (lo: number, hi: number, at: number, size: number) => {
        if (hi - lo + 2 * margin > size) return (lo + hi) / 2 - size / 2;
        if (lo - margin < at) return lo - margin;
        if (hi + margin > at + size) return hi + margin - size;
        return at;
      };
      // After a zoom-out the viewport keeps its centre, so the origin to move from is around it.
      const ox = shift(x0, x1, v.x + v.w / 2 - w / 2, w), oy = shift(y0, y1, v.y + v.h / 2 - h / 2, h);
      return new Promise<boolean>((done) => store.set(centerViewOnAtom, { x: ox + w / 2, y: oy + h / 2, animate, done }));
    },
    goTo: (target) => {
      const scn = scenario();
      if (!scn) return;
      switch (target.kind) {
        case "tile":
          centerOn(target.x, target.y);
          return;
        case "unit": {
          const u = scn.units[target.index];
          if (!u) return;
          store.set(selectedUnitsAtom, [target.index]);
          centerOn(u.x / 32, u.y / 32);
          return;
        }
        case "sprite": {
          const s = scn.sprites[target.index];
          if (!s) return;
          store.set(selectedSpritesAtom, [target.index]);
          centerOn(s.x / 32, s.y / 32);
          return;
        }
        case "location": {
          const l = scn.locations[target.index];
          if (!l || target.index === ANYWHERE_INDEX) return;
          const b = boundsOf(l);
          store.set(selectedLocationsAtom, [target.index]);
          centerOn((b.left + b.right) / 64, (b.top + b.bottom) / 64);
          return;
        }
        case "trigger":
          store.set(openDialogAtom, target.briefing ? "missionBriefing" : "triggerEditor", { index: target.index });
          return;
      }
    },
    cursorTile: () => store.get(cursorTileAtom),
    flags: () => ({ ...store.get(viewFlagsAtom) }),
    setFlags: (patch) => store.set(viewFlagsAtom, { ...store.get(viewFlagsAtom), ...patch }),
    gridSize: () => store.get(gridSizeAtom),
    setGridSize: (size) => store.set(gridSizeAtom, size),
    flash: (target) => flashOnMap(store, target),
  };
}

/** How long a flash lasts unless the target says. */
export const FLASH_MS = 600;

/**
 * `api.view.flash`: turn the target into boxes in map pixels now — a unit's placement box,
 * a location's bounds, a rect's tiles — and put them on `viewFlashesAtom`, where the
 * viewport paints them fading and sweeps them once they are over. Resolved at call time
 * on purpose: the units it names may move or go before the flash ends, and the flash is
 * about where the change *was*.
 */
export function flashOnMap(store: Store, target: FlashTarget): void {
  const scn = store.get(scenarioAtom);
  if (!scn) return;
  const kind = target.kind ?? "change";
  const ms = Math.max(50, Math.min(10_000, target.ms ?? FLASH_MS));
  const boxes: ViewFlash["box"][] = [];
  if ("rect" in target) {
    const r = target.rect;
    const x0 = Math.max(0, Math.min(r.x0, r.x1)), x1 = Math.min(scn.width, Math.max(r.x0, r.x1));
    const y0 = Math.max(0, Math.min(r.y0, r.y1)), y1 = Math.min(scn.height, Math.max(r.y0, r.y1));
    if (x1 > x0 && y1 > y0) boxes.push({ left: x0 * TILE_PX, top: y0 * TILE_PX, right: x1 * TILE_PX, bottom: y1 * TILE_PX });
  } else if ("units" in target) {
    const tables = peekUnitAssets()?.units ?? null;
    for (const i of target.units) {
      const u = scn.units[i];
      if (!u) continue;
      const b = unitBox(unitGeometry(tables, u.unitId), u.x, u.y);
      boxes.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
  } else if ("locations" in target) {
    for (const i of target.locations) {
      const l = scn.locations[i];
      if (!l || i === ANYWHERE_INDEX || !isLocationUsed(l)) continue;
      const b = boundsOf(l);
      boxes.push({ left: b.left, top: b.top, right: b.right, bottom: b.bottom });
    }
  } else if ("tiles" in target) {
    for (const t of target.tiles) {
      if (t.x < 0 || t.y < 0 || t.x >= scn.width || t.y >= scn.height) continue;
      boxes.push({ left: t.x * TILE_PX, top: t.y * TILE_PX, right: (t.x + 1) * TILE_PX, bottom: (t.y + 1) * TILE_PX });
    }
  }
  if (boxes.length === 0) return;
  const start = Date.now();
  const live = store.get(viewFlashesAtom).filter((f) => f.start + f.ms > start);
  store.set(viewFlashesAtom, [...live, ...boxes.map((box) => ({ key: nextContributionKey(), box, kind, start, ms }))]);
}

/** Drop the flashes that have run their course; the viewport calls this as it paints. */
export function sweepFlashes(store: Store, now = Date.now()): void {
  const list = store.get(viewFlashesAtom);
  if (list.length === 0) return;
  const live = list.filter((f) => f.start + f.ms > now);
  if (live.length !== list.length) store.set(viewFlashesAtom, live);
}
