/**
 * The map in front uses tiles the loaded tileset has not got — the tileset the data set in
 * use gave. Those tiles are drawn hatched (`components/viewport/missingTile.ts`), and the
 * editor says why once, as a toast that stays until it is closed: whose terrain it is (a
 * mod's, past Remastered's table; or Remastered's additions, over a 1.16 copy) and the ways
 * to it:
 *
 * - **a data set already here** that has the terrain, by a button that switches to it
 *   (`setWithTerrain`: the length of each stored set's group table against what the map
 *   uses, nothing decoded). Offered, never done: a switch redraws units and names too;
 * - for a mod's terrain, **the mod's folder**, picked and drawn from at once with nothing
 *   installed (`drawFromModFolder`, `gamedata/folderSet.ts`);
 * - Help ▸ Game Data…, for everything else.
 *
 * The toast is taken down when the map in front or the data set changes, and is not said
 * again for a map while the data set stays the one it was said for (another map coming in
 * front and going does not repeat it; a switch to another data set and back does, since the
 * hatching is back with it).
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
import type { ToastAction } from "../editor/view";
import { tilesetIndex, type Scenario } from "../formats/chk/scenario";
import { CV5_ENTRY_BYTES } from "../formats/tileset/decode";
import { peekTileset, TILESET_FILENAMES, type TilesetFileName } from "../formats/tileset/load";
import { folderFileSize, folderReader, folderSet, type FolderPiece } from "../gamedata/folderSet";
import { DEFAULT_PROFILE, isDefaultProfile, profileIdFrom, REMASTERED_PROFILE, type GameDataProfile } from "../gamedata/profiles";
import { readFrom, type AssetSource } from "../gamedata/source";
import { listStoredCopies, profileOf, readStored } from "../gamedata/store";
import { t, translate } from "../i18n";
import { pickFolder } from "../plugins/host";
import { attachReaderDataSet, switchDataSet } from "./gameData";
import { readDataSet } from "./mapDataSet";

type Store = ReturnType<typeof getDefaultStore>;

export interface TerrainNotice {
  title: string;
  detail: string;
  /** How many of the map's tiles the tileset has not got. */
  tiles: number;
  /** The terrain is a mod's (past Remastered's table), not Remastered's additions. */
  mod: boolean;
}

/**
 * What to say of `scn` drawn from a tileset of `groups` groups that `source` gave, or null
 * when the tileset has all of the map's terrain (or the map's own note speaks instead).
 * `offer` is a data set here that has the terrain, when there is one.
 */
export function missingTerrainNotice(scn: Scenario, groups: number, source: AssetSource | null, extras: ReadonlyMap<string, Uint8Array>, offer: GameDataProfile | null = null): TerrainNotice | null {
  if (!source || source.kind === "none") return null;
  const named = readDataSet(extras);
  if (named && named.id !== source.profile.id) return null;
  const era = tilesetIndex(scn);
  const missing = missingTerrain(scn.tiles, era, groups);
  if (missing.mod + missing.remastered === 0) return null;
  const tileset = translate(TILESETS[era]?.name ?? "");
  const mod = missing.mod > 0;
  // Over a 1.16 copy a mod's map lacks Remastered's additions as well, and those are hatched with the rest.
  const what = mod && missing.remastered > 0
    ? t("{n, plural, one {# tile} other {# tiles}} of this {tileset} map {n, plural, one {is} other {are}} terrain neither StarCraft 1.16.1 nor Remastered has, and {m, plural, one {# more is} other {# more are}} from what Remastered added: the map was made for a mod, and here those tiles are drawn hatched.", { n: missing.mod, m: missing.remastered, tileset })
    : mod
    ? t("{n, plural, one {# tile} other {# tiles}} of this {tileset} map {n, plural, one {is} other {are}} terrain neither StarCraft 1.16.1 nor Remastered has: the map was made for a mod, and here those tiles are drawn hatched.", { n: missing.mod, tileset })
    : t("{n, plural, one {# tile} other {# tiles}} of this {tileset} map {n, plural, one {is} other {are}} from what StarCraft: Remastered added, which the files in use have not got, so here they are drawn hatched.", { n: missing.remastered, tileset });
  const way = offer
    ? t("{name}, a data set installed here, has this terrain.", { name: offer.name })
    : mod
      ? t("Choose the mod's folder to draw from its files now, with nothing installed, or add the mod as a data set (Help ▸ Game Data…).")
      : t("Help ▸ Game Data… adds StarCraft: Remastered from your installation.");
  return {
    title: t("{set} has not got some of this map's terrain", { set: source.profile.name }),
    detail: `${what} ${way}`,
    tiles: missing.mod + missing.remastered,
    mod,
  };
}

/* ── A data set already here ────────────────────────────── */

/** A data set and the number of groups in its table for one tileset. */
export interface SetTable {
  profile: GameDataProfile;
  groups: number;
}

/**
 * The first of `sets` whose table has all of the terrain `tiles` uses on ERA `era`, by the
 * rule the notice counts with — so a Remastered copy for a map on Remastered's additions,
 * a mod's copy for a mod's map. Lengths only: nothing of a set is decoded.
 */
export function setWithTerrain(tiles: ArrayLike<number>, era: number, sets: readonly SetTable[]): GameDataProfile | null {
  for (const set of sets) {
    const missing = missingTerrain(tiles, era, set.groups);
    if (missing.mod + missing.remastered === 0) return set.profile;
  }
  return null;
}

/**
 * The data sets Help ▸ Game Data… lists, in the order the offer prefers them: the game's
 * own, StarCraft: Remastered, then the rest by name as the dialog has them. The game's
 * come first because a switch redraws units and names as well, and the game's own files
 * change none of those.
 */
export function offerOrder(profiles: readonly GameDataProfile[]): GameDataProfile[] {
  const others = profiles.filter((p) => !isDefaultProfile(p.id)).sort((a, b) => a.name.localeCompare(b.name));
  return [DEFAULT_PROFILE, ...others.filter((p) => p.id === REMASTERED_PROFILE.id), ...others.filter((p) => p.id !== REMASTERED_PROFILE.id)];
}

/** The size of a file of the game's own data set as a switch to it would find it: this build's files, else its stored copy. */
async function defaultFileSize(path: string): Promise<number | null> {
  const bundled = await readFrom({ kind: "bundled", profile: DEFAULT_PROFILE, base: import.meta.env.BASE_URL, label: "", tried: [] }, path).catch(() => null);
  if (bundled) return bundled.length;
  return (await readStored(path))?.size ?? null;
}

/**
 * Every data set here but the one in use, in `offerOrder`, with the length of its group
 * table for the tileset `file` — read off the size of its `tileset/<file>.cv5`. A set
 * without the file is left out.
 */
export async function otherSetTables(file: TilesetFileName, inUse: AssetSource): Promise<SetTable[]> {
  const path = `tileset/${file}.cv5`;
  const out: SetTable[] = [];
  for (const profile of offerOrder((await listStoredCopies()).map(profileOf))) {
    // A set in memory (a folder, a plugin's) goes by any id, a stored set's among them: only a copy in use is left out by its id.
    if (inUse.kind !== "reader" && profile.id === inUse.profile.id) continue;
    const bytes = isDefaultProfile(profile.id) ? await defaultFileSize(path) : (await readStored(path, profile.id))?.size ?? null;
    if (bytes) out.push({ profile, groups: Math.floor(bytes / CV5_ENTRY_BYTES) });
  }
  return out;
}

async function switchTo(store: Store, set: GameDataProfile): Promise<void> {
  try {
    const next = await switchDataSet(store, set.id);
    store.set(pushToastAtom, next.profile.id === set.id
      ? { kind: "ok", title: t("Now drawing from {name}.", { name: set.name }) }
      : { kind: "warn", title: t("{name} has no copy here any more; drawing from the game's own data.", { name: set.name }) });
  } catch (err) {
    store.set(pushToastAtom, { kind: "error", title: t("Could not switch data sets"), detail: err instanceof Error ? err.message : String(err) });
  }
}

/* ── The mod's folder ───────────────────────────────────── */

/** What became of a folder the person chose (`drawFromModFolder`). */
export type FolderAnswer =
  /** The editor now draws from it. */
  | "drawn"
  /** Nothing was picked. */
  | "cancelled"
  /** The folder has none of the game's folders. */
  | "no-game-files"
  /** It has archives and no loose game files. */
  | "archives-only"
  /** It has game files, but not the map's terrain: the data set in use was left alone. */
  | "no-terrain";

/** The profile a folder is drawn from under: its name, and an id that is neither of the game's own. */
function folderProfile(name: string): GameDataProfile {
  const id = profileIdFrom(name) || "mod";
  return { id: isDefaultProfile(id) || id === REMASTERED_PROFILE.id ? `${id}-folder` : id, name: name.trim() || id };
}

const picking = new WeakSet<Store>();

/** What `drawFromModFolder` asks of the editor, for a caller (a test) that answers for it. */
export interface FolderOptions {
  /** The folder picker: the files of the folder chosen, none when nothing was. */
  pick?: () => Promise<FolderPiece[]>;
  /** The groups of the tileset in use for the map; the loaded tileset's when left out, null for none loaded. */
  groups?: number | null;
}

/**
 * Ask for the mod's folder and draw from its loose files, in memory: nothing is installed
 * or remembered, and a file is read when the editor asks for it. The folder is taken only
 * when it brings the map more of its terrain than the data set in use has; one that does
 * not is refused in words and nothing changes. When it brings all of it the notice's own
 * rule finds nothing to say; when only some, the notice comes back with what is left.
 *
 * The mod's hash is not worked out: it covers every file of the mod, its archives'
 * members included, and reading those is what this route is there to avoid. A map saved
 * meanwhile records the data set by name with no hash.
 */
export async function drawFromModFolder(store: Store, scn: Scenario, options: FolderOptions = {}): Promise<FolderAnswer> {
  const pick = options.pick ?? (() => pickFolder(store));
  if (picking.has(store)) return "cancelled";
  picking.add(store);
  let pieces: FolderPiece[];
  try {
    pieces = await pick();
  } finally {
    picking.delete(store);
  }
  if (pieces.length === 0) return "cancelled";
  const set = folderSet(pieces);
  const name = set.name || t("The folder");
  const archives = set.archives.slice(0, 3).join(", ") + (set.archives.length > 3 ? "…" : "");
  const gameData: ToastAction = { label: t("Game Data…"), run: () => store.set(openDialogAtom, "gameData") };
  if (set.files.size === 0) {
    if (set.archives.length > 0) {
      store.set(pushToastAtom, {
        kind: "warn", ttl: 0,
        title: t("{name} has no loose game files", { name }),
        detail: t("It holds archives ({archives}), which are not read from a folder this way. Help ▸ Game Data… ▸ Add a data set… reads archives.", { archives }),
        actions: [gameData],
      });
      return "archives-only";
    }
    store.set(pushToastAtom, {
      kind: "warn", ttl: 0,
      title: t("{name} is not a mod's folder", { name }),
      detail: t("None of the game's folders (arr, unit, tileset…) is in it or in a folder inside it."),
    });
    return "no-game-files";
  }
  const era = tilesetIndex(scn);
  const file = TILESET_FILENAMES[era];
  const count = (groups: number) => { const m = missingTerrain(scn.tiles, era, groups); return m.mod + m.remastered; };
  const inUse = options.groups !== undefined ? options.groups : peekTileset(file)?.tileset.groups.length ?? null;
  const size = folderFileSize(set, `tileset\\${file}.cv5`);
  const now = inUse === null ? Infinity : count(inUse);
  // Without a table of its own the folder leaves the tileset to the data set underneath.
  const then = size === null ? now : count(Math.floor(size / CV5_ENTRY_BYTES));
  if (now > 0 && then >= now) {
    const tileset = translate(TILESETS[era]?.name ?? "");
    const why = size === null
      ? t("It has no {tileset} tileset of its own (tileset\\{file}.cv5), so the data set in use stays as it is.", { tileset, file })
      : t("Its {tileset} tileset has {n, plural, one {# tile group} other {# tile groups}}, and this map uses tiles past them, so the data set in use stays as it is.", { tileset, n: Math.floor(size / CV5_ENTRY_BYTES) });
    const more = set.archives.length > 0 ? " " + t("The folder also holds archives ({archives}), which are not read this way: Help ▸ Game Data… ▸ Add a data set… reads them.", { archives }) : "";
    store.set(pushToastAtom, {
      kind: "warn", ttl: 0,
      title: t("{name} has not got this map's terrain either", { name }),
      detail: why + more,
      ...(set.archives.length > 0 ? { actions: [gameData] } : {}),
    });
    return "no-terrain";
  }
  // The rule decides afresh for the map under the new data set, whatever it is called.
  forget(store, scn);
  const profile = folderProfile(name);
  attachReaderDataSet(store, profile, folderReader(set));
  store.set(pushToastAtom, {
    kind: "ok", ttl: 12000,
    title: t("Now drawing from {name}.", { name: profile.name }),
    detail: t("Its files are read from the folder as they are needed; nothing is installed or kept. Help ▸ Game Data… switches back."),
  });
  return "drawn";
}

/* ── The notice ─────────────────────────────────────────── */

interface Up {
  scenario: Scenario;
  set: string;
  /** How many tiles the notice counted. */
  tiles: number;
  /** The toast, once it is up: the data sets here are looked at first. */
  toast: number | null;
}

/** The data set each map was last told about. A map is its scenario object, which a parked tab keeps. */
const told = new WeakMap<Scenario, string>();
/** The notice up (or on its way up) now, per store. */
const shown = new WeakMap<Store, Up>();

/** A data set as the notice tells them apart: a folder or a plugin's set in memory is not the stored set of the same id. */
const setKey = (source: AssetSource | null) => (source ? `${source.kind === "reader" ? "reader" : "copy"}:${source.profile.id}` : "");

function takeDown(store: Store, up: Up): void {
  if (up.toast !== null) store.set(dismissToastAtom, up.toast);
  // Taken down before it was ever up: the map has not been told.
  else told.delete(up.scenario);
  shown.delete(store);
}

/** Take the notice down and let it be said again for `scn`: the data set is about to change, perhaps under the same name. */
function forget(store: Store, scn: Scenario): void {
  const up = shown.get(store);
  if (up) takeDown(store, up);
  told.delete(scn);
}

/**
 * Bring the notice up to date for the map in front, `scn`, drawn from a tileset of `groups`
 * groups — null while the tileset is still loading, when nothing is decided for the map and
 * data set already spoken of. Takes down a toast about another map or data set, or one no
 * longer true, and says it for this map and data set when it has not been said yet. The
 * promise is of the toast being up (the data sets here are looked at first, off the stored
 * files' sizes); nothing waits on it but tests.
 */
export async function updateMissingTerrain(store: Store, scn: Scenario | null, groups: number | null): Promise<void> {
  const source = store.get(gameDataSourceAtom);
  const set = setKey(source);
  const up = shown.get(store);
  if (groups === null && up && up.scenario === scn && up.set === set) return;
  const extras = store.get(archiveExtrasAtom);
  const notice = scn && groups !== null ? missingTerrainNotice(scn, groups, source, extras) : null;
  if (up && (up.scenario !== scn || up.set !== set || !notice || notice.tiles !== up.tiles)) {
    takeDown(store, up);
    // The same data set read again with other files (a set in memory, reloaded): what was said is stale.
    if (up.scenario === scn && up.set === set && notice) told.delete(scn);
  }
  if (!scn || groups === null) return;
  if (!notice || !source) {
    // The data set in use has the terrain: should one that has not come back, it is said again.
    told.delete(scn);
    return;
  }
  if (told.get(scn) === set) return;
  told.set(scn, set);
  const mine: Up = { scenario: scn, set, tiles: notice.tiles, toast: null };
  shown.set(store, mine);
  const era = tilesetIndex(scn);
  const offer = setWithTerrain(scn.tiles, era, await otherSetTables(TILESET_FILENAMES[era], source).catch(() => []));
  // The map in front or the data set moved on while the sets were looked at.
  if (shown.get(store) !== mine) return;
  const said = offer ? missingTerrainNotice(scn, groups, source, extras, offer) ?? notice : notice;
  const actions: ToastAction[] = [];
  if (offer) actions.push({ label: t("Switch to {name}", { name: offer.name }), run: () => { void switchTo(store, offer); } });
  if (notice.mod) actions.push({ label: t("Choose the mod's folder…"), keep: true, run: () => { void drawFromModFolder(store, scn); } });
  actions.push({ label: t("Game Data…"), run: () => store.set(openDialogAtom, "gameData") });
  mine.toast = store.set(pushToastAtom, { kind: "warn", title: said.title, detail: said.detail, ttl: 0, actions });
}
