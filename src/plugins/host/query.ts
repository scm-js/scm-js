/**
 * `api.query`: hit-testing and the editor's analyses.
 */
import { mapTilesetAtom, placementOptionsAtom } from "../../atoms/editorAtoms";
import { archiveExtrasAtom, scenarioAtom, tilesetFileNameAtom } from "../../atoms/documentAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { peekTileset, type LoadedTileset } from "../../formats/tileset/load";
import { NO_DOODADS } from "../../formats/tileset/doodads";
import { imageGrpPath, peekUnitAssets, requestGrp } from "../../formats/units/load";
import { START_LOCATION } from "../../data/units";
import { boundsOf, locationAt } from "../../editor/locations";
import { stringUsages, unusedStrings } from "../../editor/strings";
import { validateScenario } from "../../editor/validate";
import { mapStatistics } from "../../editor/statistics";
import { findInScenario } from "../../editor/find";
import { ANYWHERE_INDEX, isLocationUsed, type SpriteRecord } from "../../formats/chk/sections/objects";
import { checkPlacement } from "../../editor/placement";
import type { Rect } from "../../editor/terrain";
import { unitAt, unitBox, unitGeometry } from "../../editor/units";
import { FALLBACK_SIZE, spriteAt, spriteKind, spritesInBox, type SpriteSize } from "../../editor/sprites";
import { checkDoodadPlacement, doodadAt } from "../../editor/doodads";
import { fogPlayersAt } from "../../editor/fog";
import type { QueryApi, StartLocation } from "../api";
import type { Store } from "./shared";

/** `api.query`: what is where, and the editor's own analyses. Never writes anything. */
export function queryApi(store: Store): QueryApi {
  const scenario = () => store.get(scenarioAtom);
  const loaded = (): LoadedTileset | null => peekTileset(store.get(tilesetFileNameAtom));
  const tables = () => peekUnitAssets()?.units ?? null;
  const catalogue = () => loaded()?.doodads ?? NO_DOODADS;
  /**
   * A sprite's box for hit-testing: the loaded GRP's, a unit sprite's collision box
   * while its graphic is still coming, one tile otherwise — the viewport's own rule.
   */
  const sizeOf = (r: SpriteRecord): SpriteSize => {
    const assets = peekUnitAssets();
    if (!assets) return FALLBACK_SIZE;
    if (spriteKind(r) === "unit") {
      const b = unitBox(unitGeometry(assets.units, r.spriteId), 0, 0);
      return { width: b.right - b.left, height: b.bottom - b.top };
    }
    const imageId = assets.sprites.image[r.spriteId];
    const path = imageId === undefined ? null : imageGrpPath(assets, imageId);
    const grp = path ? requestGrp(path) : null;
    return grp && grp.width > 0 && grp.height > 0 ? { width: grp.width, height: grp.height } : FALLBACK_SIZE;
  };
  const pixels = (rect: Rect) => ({ left: rect.x0 * 32, top: rect.y0 * 32, right: rect.x1 * 32, bottom: rect.y1 * 32 });

  return {
    unitAt: (px, py) => { const scn = scenario(); return scn ? unitAt(scn, tables(), px, py) : -1; },
    unitsIn: (rect) => {
      const scn = scenario();
      if (!scn) return [];
      const box = pixels(rect);
      return scn.units.reduce<number[]>((out, u, i) => {
        if (u.x >= box.left && u.x < box.right && u.y >= box.top && u.y < box.bottom) out.push(i);
        return out;
      }, []);
    },
    unitsOf: (owner) => { const scn = scenario(); return scn ? scn.units.reduce<number[]>((out, u, i) => (u.owner === owner ? [...out, i] : out), []) : []; },
    spriteAt: (px, py) => { const scn = scenario(); return scn ? spriteAt(scn, px, py, sizeOf) : -1; },
    spritesIn: (rect) => { const scn = scenario(); return scn ? spritesInBox(scn, pixels(rect), sizeOf) : []; },
    doodadAt: (tx, ty) => { const scn = scenario(); return scn ? doodadAt(scn, catalogue(), tx, ty) : -1; },
    locationAt: (px, py) => { const scn = scenario(); return scn ? locationAt(scn, px, py) : -1; },
    locationsIn: (rect) => {
      const scn = scenario();
      if (!scn) return [];
      const box = pixels(rect);
      const out: number[] = [];
      scn.locations.forEach((l, index) => {
        if (index === ANYWHERE_INDEX || !isLocationUsed(l)) return;
        const b = boundsOf(l);
        if (b.left >= box.left && b.right <= box.right && b.top >= box.top && b.bottom <= box.bottom) out.push(index);
      });
      return out;
    },
    startLocations: () => {
      const scn = scenario();
      if (!scn) return [];
      const out: StartLocation[] = [];
      scn.units.forEach((u, index) => {
        if (u.unitId === START_LOCATION) out.push({ index, owner: u.owner, x: u.x, y: u.y, tx: Math.floor(u.x / 32), ty: Math.floor(u.y / 32) });
      });
      return out.sort((a, b) => a.owner - b.owner);
    },
    fogAt: (tx, ty) => { const scn = scenario(); return scn ? fogPlayersAt(scn, tx, ty) : 0xff; },
    strings: () => scenario()?.strings.strings.slice() ?? [],
    placement: (unitId, x, y) => {
      const scn = scenario();
      if (!scn) return null;
      return checkPlacement(scn, loaded()?.tileset ?? null, tables(), store.get(placementOptionsAtom), unitId, x, y);
    },
    doodadPlacement: (doodadId, tx, ty) => {
      const scn = scenario(), l = loaded();
      const def = l?.doodads.byId.get(doodadId);
      if (!scn || !l || !def) return null;
      // The rule itself, not the palette's switch: a plugin asking is asking whether StarEdit would allow it.
      return checkDoodadPlacement(scn, l.tileset, def, tx, ty, { placeAnywhere: false, snapToGrid: false, asTerrain: false, pin: false });
    },
    validate: () => {
      const scn = scenario();
      return scn ? validateScenario(scn, { extras: store.get(archiveExtrasAtom), units: tables(), tileset: loaded()?.tileset ?? null }) : [];
    },
    statistics: () => {
      const scn = scenario();
      if (!scn) return null;
      return mapStatistics(scn, loaded()?.tileset ?? null, TILESET_BY_ID[store.get(mapTilesetAtom)].terrain, tables());
    },
    find: (options) => { const scn = scenario(); return scn ? findInScenario(scn, options) : []; },
    stringUsage: () => { const scn = scenario(); return scn ? stringUsages(scn) : new Map(); },
    unusedStrings: () => { const scn = scenario(); return scn ? unusedStrings(scn) : []; },
  };
}
