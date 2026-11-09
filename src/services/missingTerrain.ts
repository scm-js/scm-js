/**
 * The map in front uses tiles the loaded tileset has not got — the tileset the data set in
 * use gave. Those tiles draw black, or as some other tile when the game's rule reads their
 * group without bit 15, and without a word that looks like a broken map. So the editor says
 * it once per map and data set, as a toast that stays until it is closed: whose terrain it
 * is (a mod's, past Remastered's table; or Remastered's additions, over a 1.16 copy) and
 * where to get it. The toast is taken down when the map in front or the data set changes,
 * and not said again for a map and data set it was said for.
 *
 * A map whose `scmjs\dataset.json` names another data set already gets the offer to switch
 * (`mapDataSet.ts#offerMapDataSet`, also when the person chose to keep the one in use), so
 * nothing is said for it here.
 */
import type { getDefaultStore } from "jotai";
import { archiveExtrasAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { dismissToastAtom, openDialogAtom, pushToastAtom } from "../atoms/uiAtoms";
import { missingTerrain } from "../data/remasteredTiles";
import { TILESETS } from "../data/tilesets";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import type { AssetSource } from "../gamedata/source";
import { t, translate } from "../i18n";
import { readDataSet } from "./mapDataSet";

type Store = ReturnType<typeof getDefaultStore>;

export interface TerrainNotice {
  title: string;
  detail: string;
}

/**
 * What to say of `scn` drawn from a tileset of `groups` groups that `source` gave, or null
 * when the tileset has all of the map's terrain (or the map's own note speaks instead).
 */
export function missingTerrainNotice(scn: Scenario, groups: number, source: AssetSource | null, extras: ReadonlyMap<string, Uint8Array>): TerrainNotice | null {
  if (!source || source.kind === "none") return null;
  const named = readDataSet(extras);
  if (named && named.id !== source.profile.id) return null;
  const era = tilesetIndex(scn);
  const missing = missingTerrain(scn.tiles, era, groups);
  if (missing.mod + missing.remastered === 0) return null;
  const tileset = translate(TILESETS[era]?.name ?? "");
  return {
    title: t("{set} has not got some of this map's terrain", { set: source.profile.name }),
    detail: missing.mod > 0
      ? t("{n, plural, one {# tile} other {# tiles}} of this {tileset} map {n, plural, one {is} other {are}} terrain neither StarCraft 1.16.1 nor Remastered has: the map was made for a mod, and here those tiles draw black or as other tiles. Open the mod (the Mod Editor plugin's File ▸ Open a Mod…) or choose its data set (Help ▸ Game Data…).", { n: missing.mod, tileset })
      : t("{n, plural, one {# tile} other {# tiles}} of this {tileset} map {n, plural, one {is} other {are}} from what StarCraft: Remastered added, which the files in use have not got, so here they have no picture. Help ▸ Game Data… adds StarCraft: Remastered from your installation, or switches to it when it is there.", { n: missing.remastered, tileset }),
  };
}

interface Shown {
  toast: number;
  scenario: Scenario;
  set: string;
}

/** The data sets each map has been told about. A map is its scenario object, which a parked tab keeps. */
const told = new WeakMap<Scenario, Set<string>>();
/** The toast up now, per store. */
const shown = new WeakMap<Store, Shown>();

/**
 * Bring the notice up to date for the map in front, `scn`, drawn from a tileset of `groups`
 * groups — null while the tileset is still loading, when nothing is decided for the map and
 * data set already spoken of. Takes down a toast about another map or data set, or one no
 * longer true, and says it for this map and data set when it has not been said yet.
 */
export function updateMissingTerrain(store: Store, scn: Scenario | null, groups: number | null): void {
  const source = store.get(gameDataSourceAtom);
  const set = source?.profile.id ?? "";
  const up = shown.get(store);
  if (groups === null && up && up.scenario === scn && up.set === set) return;
  const notice = scn && groups !== null ? missingTerrainNotice(scn, groups, source, store.get(archiveExtrasAtom)) : null;
  if (up && (up.scenario !== scn || up.set !== set || !notice)) {
    store.set(dismissToastAtom, up.toast);
    shown.delete(store);
  }
  if (!scn || !notice) return;
  const seen = told.get(scn) ?? new Set<string>();
  if (seen.has(set)) return;
  told.set(scn, seen.add(set));
  const toast = store.set(pushToastAtom, {
    kind: "warn",
    ...notice,
    ttl: 0,
    action: { label: t("Game Data…"), run: () => store.set(openDialogAtom, "gameData") },
  });
  shown.set(store, { toast, scenario: scn, set });
}
