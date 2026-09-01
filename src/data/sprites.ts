/**
 * Names and grouping for sprites.dat entries. The game ships no name table for sprites
 * (Chkdraft builds its list at runtime too), so a sprite is labelled after the unit whose
 * flingy uses it — "Terran Marine" — or, failing that, after its GRP's file name; the
 * tileset a doodad graphic belongs to comes from its path. Everything derives from the
 * loaded unit tables, so the list is exactly what the installed data can draw.
 */
import { NO_UNIT } from "../formats/dat/dat";
import { imageGrpPath, type UnitAssets } from "../formats/units/load";
import { unitName } from "./units";

export const SPRITE_COUNT = 517;

export interface SpriteEntry {
  id: number;
  label: string;
  /** Palette group: "Units", "Effects", or "Doodads · <tileset>". */
  group: string;
  imageId: number;
  /** The unit drawn with this sprite, or NO_UNIT. */
  unitId: number;
}

export interface SpriteGroup {
  label: string;
  ids: number[];
}

export interface SpriteCatalogue {
  entries: SpriteEntry[];
  groups: SpriteGroup[];
}

const TILESET_DIRS: Record<string, string> = {
  ashworld: "Ash World",
  badlands: "Badlands",
  install: "Installation",
  jungle: "Jungle",
  platform: "Space Platform",
  desert: "Desert",
  ice: "Ice",
  twilight: "Twilight",
};

const GROUP_ORDER = ["Units", "Effects"];

const cache = new WeakMap<UnitAssets, SpriteCatalogue>();

export function spriteCatalogue(assets: UnitAssets): SpriteCatalogue {
  const hit = cache.get(assets);
  if (hit) return hit;
  // Which unit a sprite draws: the first unit type whose flingy points at it.
  const unitOf = new Map<number, number>();
  for (let unit = 0; unit < NO_UNIT; unit++) {
    const sprite = assets.flingy.sprite[assets.units.flingy[unit]];
    if (sprite !== undefined && !unitOf.has(sprite)) unitOf.set(sprite, unit);
  }
  const entries: SpriteEntry[] = [];
  const byGroup = new Map<string, number[]>();
  const count = Math.min(SPRITE_COUNT, assets.sprites.image.length);
  for (let id = 0; id < count; id++) {
    const imageId = assets.sprites.image[id];
    const unitId = unitOf.get(id) ?? NO_UNIT;
    const path = imageGrpPath(assets, imageId) ?? "";
    const parts = path.split("/");
    const file = (parts.at(-1) ?? "").replace(/\.grp$/, "");
    let group = "Effects";
    let label = file || `Sprite #${id}`;
    if (unitId !== NO_UNIT) {
      group = "Units";
      label = unitName(unitId);
    } else if (parts[0] === "thingy" && parts[1] === "tileset" && parts.length >= 4) {
      group = `Doodads · ${TILESET_DIRS[parts[2]] ?? parts[2]}`;
    }
    entries.push({ id, label, group, imageId, unitId });
    let ids = byGroup.get(group);
    if (!ids) byGroup.set(group, (ids = []));
    ids.push(id);
  }
  const groups = [...byGroup.entries()]
    .map(([label, ids]) => ({ label, ids }))
    .sort((a, b) => {
      const ka = GROUP_ORDER.indexOf(a.label), kb = GROUP_ORDER.indexOf(b.label);
      if (ka >= 0 || kb >= 0) return (ka < 0 ? GROUP_ORDER.length : ka) - (kb < 0 ? GROUP_ORDER.length : kb);
      return a.label.localeCompare(b.label);
    });
  const out = { entries, groups };
  cache.set(assets, out);
  return out;
}

/** "Terran Marine", "JUbush01", or "Sprite #n" when the tables are not loaded. */
export function spriteLabel(assets: UnitAssets | null, id: number): string {
  if (!assets || id < 0 || id >= SPRITE_COUNT) return `Sprite #${id}`;
  return spriteCatalogue(assets).entries[id]?.label ?? `Sprite #${id}`;
}
