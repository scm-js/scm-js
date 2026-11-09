import {
  decodeFlingyDat, decodeImagesDat, decodeSfxdataDat, decodeSpritesDat, decodeTechdataDat, decodeUnitsDat, decodeUpgradesDat, decodeWeaponsDat, LO_KINDS, REMAP_TABLES,
  type FlingyDat, type ImagesDat, type SpritesDat, type TechdataDat, type UnitsDat, type UpgradesDat, type WeaponsDat,
} from "../dat/dat";
import { datShape } from "../dat/table";
import type { DatTableName } from "../dat/schema";
import { animPath, imagesSharingGrp, isAnim, parseAnim, type Anim } from "../dat/anim";
import { decodeGrp, type Grp } from "../dat/grp";
import { decodeIscript, type IscriptBin } from "../dat/iscript";
import { decodeLo, type LoFile } from "../dat/lo";
import { decodePcx } from "../dat/pcx";
import { decodeTbl, decodeTblEntries } from "../dat/tbl";
import { TEAM_COLOR_ROWS, TEAM_SLOT_COUNT } from "./teamColor";
import { currentAssetSource, fetchAsset } from "../../gamedata/source";
import { t } from "../../i18n";
import { installNames } from "../../data/units";
import { namesFromAssets, unitCatalogue } from "../../data/gameNames";
import { nameFileText, NAME_TEXT_FILES } from "../mod/data";
import { buildStockSounds, type StockSounds } from "../../editor/stockSounds";
import { decodePalette } from "../tileset/decode";

/**
 * The unit data tables, fetched once from `arr/` + `game/` (mirroring the MPQ tree; see
 * `gamedata/extract.ts`) wherever the session's game data comes from (`gamedata/source.ts`).
 * GRPs, overlay `.lo` files and the tileset remap tables are fetched lazily as the viewport
 * first needs them, so opening a melee map only pulls minerals, geysers and start locations.
 */
export interface UnitAssets {
  units: UnitsDat;
  flingy: FlingyDat;
  sprites: SpritesDat;
  images: ImagesDat;
  /** images.tbl: GRP paths relative to `unit\`, as stored (backslashes, mixed case). */
  imagePaths: string[];
  /** tunit.pcx pixels: 16 rows × 8 palette indices. */
  teamColors: Uint8Array;
  /** The animation bytecode, or null when `scripts/iscript.bin` is not installed (units then stay still). */
  iscript: IscriptBin | null;
  /** weapons.dat, or null when an older extraction did not ship it (Unit Settings then shows no weapon defaults). */
  weapons: WeaponsDat | null;
  /** upgrades.dat / techdata.dat, or null likewise (Upgrade / Technology Settings then show defaults as 0). */
  upgrades: UpgradesDat | null;
  techs: TechdataDat | null;
  /**
   * `stat_txt.tbl` as NUL-separated parts per entry — the game's own names for units (entries
   * 0–227), weapons, upgrades and technologies (through the dat files' `label` columns) — or
   * null when the extraction did not carry it. `data/gameNames.ts` turns it into the names
   * the editor shows; it is the one file the tileset half of the extraction and this share.
   */
  statTxt: string[][] | null;
  /**
   * `rez\unitnames.tbl`, where the data set has one: the names of every unit type by id
   * (entry N is type N, `Name\0Subname\0Category`), which is where a data set with more
   * than 228 types names the rest — GPTP's convention. Null without one.
   */
  unitNames: string[][] | null;
  /**
   * The text a GPTP mod names its weapons, upgrades and technologies in, where the data set
   * has it (`formats/mod/data.ts#NAME_TEXT_FILES`: `rez\stat.txt`, `arr\upgrades.txt`, …),
   * by that table's key; absent for the game's own data.
   */
  nameTexts?: Partial<Record<keyof typeof NAME_TEXT_FILES, string>>;
}

export class UnitAssetsMissingError extends Error {
  constructor(cause?: unknown) {
    super(t("Unit data is not available. Help ▸ Game Data… installs it from a StarCraft installation."), { cause });
    this.name = "UnitAssetsMissingError";
  }
}

/** Like the tileset loader: a dev server answers a missing file with index.html and 200. */
async function fetchPart(path: string, check: (data: Uint8Array) => boolean): Promise<Uint8Array> {
  const res = await fetchAsset(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  if (res.headers.get("content-type")?.startsWith("text/html")) throw new Error(`${path}: not on the server (the page came back instead)`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (!check(data)) throw new Error(`${path}: unexpected content (${data.length} bytes)`);
  return data;
}

let assetsPromise: Promise<UnitAssets> | null = null;
let assetsReady: UnitAssets | null = null;

/**
 * `unit/manifest.json` as the extraction wrote it (`gamedata/extract.ts#UnitManifest`), or
 * null for a copy without one. Asked once a data set: it says which tables are stored in
 * GPTP's `.datex` layout, which optional files are there, and which images have a 2x sprite.
 */
let manifestPromise: Promise<UnitManifestView | null> | null = null;

interface UnitManifestView { datex: string[]; optional: string[]; hd: number[] | null }

function unitManifest(): Promise<UnitManifestView | null> {
  manifestPromise ??= fetchAsset("unit/manifest.json")
    .then((res) => (res.ok && !res.headers.get("content-type")?.startsWith("text/html") ? res.json() : null))
    .then((m: { datex?: unknown; optional?: unknown; hd?: unknown } | null) => m && typeof m === "object" ? {
      datex: Array.isArray(m.datex) ? (m.datex as string[]) : [],
      optional: Array.isArray(m.optional) ? (m.optional as string[]) : [],
      hd: Array.isArray(m.hd) ? (m.hd as number[]) : null,
    } : null, () => null);
  return manifestPromise;
}

/**
 * A table at whatever width the data set has it: `arr/<name>.datex` where the extraction
 * stored GPTP's layout, else `arr/<name>.dat` — the game's own size or DatExtend's
 * expanded one, told apart by the length (`table.ts#datShape`).
 */
function fetchTable<T>(manifest: UnitManifestView | null, table: DatTableName, decode: (data: Uint8Array, fileName?: string) => T): Promise<T> {
  const name = manifest?.datex.includes(table) ? `${table}.datex` : `${table}.dat`;
  return fetchPart(`arr/${name}`, (d) => datShape(table, d.length, name) !== null).then((d) => decode(d, name));
}

/** A table the editor does without: null, with a console line saying what that costs. */
function optionalTable<T>(loading: Promise<T>, what: string): Promise<T | null> {
  return loading.catch((err: unknown) => {
    console.warn(what, err);
    return null;
  });
}

const isTbl = (d: Uint8Array) => d.length > 2 && (d[0] | (d[1] << 8)) > 0;

export function getUnitAssets(): Promise<UnitAssets> {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    try {
      const manifest = await unitManifest();
      const [units, flingy, sprites, images, tbl, pcx, iscript, weapons, upgrades, techs, statTxt, unitNames] = await Promise.all([
        fetchTable(manifest, "units", decodeUnitsDat),
        fetchTable(manifest, "flingy", decodeFlingyDat),
        fetchTable(manifest, "sprites", decodeSpritesDat),
        fetchTable(manifest, "images", decodeImagesDat),
        fetchPart("arr/images.tbl", (d) => d.length > 2 && d[0] + (d[1] << 8) > 0),
        fetchPart("game/tunit.pcx", (d) => d.length > 128 && d[0] === 0x0a),
        // Optional: an older extraction has no iscript.bin, and that only costs animation.
        fetchPart("scripts/iscript.bin", (d) => d.length > 4 && (d[0] | (d[1] << 8)) < d.length).catch((err: unknown) => {
          console.warn("scripts/iscript.bin is not installed; units will not animate", err);
          return null;
        }),
        optionalTable(fetchTable(manifest, "weapons", decodeWeaponsDat), "arr/weapons.dat is not installed; Unit Settings will show no weapon defaults"),
        optionalTable(fetchTable(manifest, "upgrades", decodeUpgradesDat), "arr/upgrades.dat is not installed; Upgrade Settings will show no defaults"),
        optionalTable(fetchTable(manifest, "techdata", decodeTechdataDat), "arr/techdata.dat is not installed; Technology Settings will show no defaults"),
        // Optional too: without it the names are the editor's own tables, which is right for Blizzard's data.
        fetchPart("tileset/stat_txt.tbl", isTbl).catch(() => null),
        // Only where the extraction found one: a data set with more unit types than the game names them here.
        manifest?.optional.includes(UNIT_NAMES_FILE) ? fetchPart(UNIT_NAMES_FILE, isTbl).catch(() => null) : Promise.resolve(null),
      ]);
      const nameTexts = await fetchNameTexts(manifest);
      const teamColors = decodePcx(pcx).pixels;
      if (teamColors.length < TEAM_COLOR_ROWS * TEAM_SLOT_COUNT) throw new Error("tunit.pcx: too small");
      const assets: UnitAssets = {
        units,
        flingy,
        sprites,
        images,
        imagePaths: decodeTbl(tbl),
        teamColors,
        iscript: iscript ? decodeIscriptSafely(iscript) : null,
        weapons,
        upgrades,
        techs,
        statTxt: statTxt ? decodeTblEntries(statTxt) : null,
        unitNames: unitNames ? decodeTblEntries(unitNames) : null,
        nameTexts,
      };
      assetsReady = assets;
      const names = namesFromAssets(assets);
      installNames(names, unitCatalogue(assets, names));
      return assets;
    } catch (err) {
      assetsPromise = null; // let a later attempt retry after the files are installed
      throw new UnitAssetsMissingError(err);
    }
  })();
  return assetsPromise;
}

/** The mod's name files the extraction found (its manifest's `optional`), as text; a file that does not come is left out. */
async function fetchNameTexts(manifest: UnitManifestView | null): Promise<AssetNameTexts> {
  const out: AssetNameTexts = {};
  await Promise.all((Object.entries(NAME_TEXT_FILES) as [keyof typeof NAME_TEXT_FILES, string][]).map(async ([key, member]) => {
    const path = member.toLowerCase().replaceAll("\\", "/");
    if (!manifest?.optional.includes(path)) return;
    const data = await fetchPart(path, () => true).catch(() => null);
    if (data) out[key] = nameFileText(data);
  }));
  return out;
}
type AssetNameTexts = NonNullable<UnitAssets["nameTexts"]>;

/** A data set's animation script that this reader cannot make sense of costs the animation, not the units. */
function decodeIscriptSafely(data: Uint8Array): IscriptBin | null {
  try {
    return decodeIscript(data);
  } catch (err) {
    console.warn("scripts/iscript.bin could not be read; units will not animate", err);
    return null;
  }
}

/** Where a data set keeps the names of unit types past the game's 228 (GPTP's `rez\unitnames.tbl`). */
export const UNIT_NAMES_FILE = "rez/unitnames.tbl";
/** And their command card pictures, one frame a type (GPTP's `unit\cmdbtns\uniticons.grp`). */
export const UNIT_ICONS_FILE = "unit/cmdbtns/uniticons.grp";

let stockPromise: Promise<StockSounds | null> | null = null;
let stockReady: StockSounds | null = null;
/** Advanced when the list is dropped, so a fetch that was under way does not put the old one back. */
let stockEpoch = 0;

/**
 * The game's own sounds as a list (`editor/stockSounds.ts`), fetched the first time
 * something asks — the sound picker, Check Map. Null when the copy has no `sfxdata.tbl`:
 * one made before the extraction copied it, or no game data at all. Without `units.dat`
 * the list still stands, only without whose voice each sound is.
 */
export function getStockSounds(): Promise<StockSounds | null> {
  if (stockPromise) return stockPromise;
  const epoch = stockEpoch;
  stockPromise = (async () => {
    try {
      const [tbl, dat, assets] = await Promise.all([
        fetchPart("arr/sfxdata.tbl", (d) => d.length > 2 && (d[0] | (d[1] << 8)) > 0),
        fetchPart("arr/sfxdata.dat", (d) => datShape("sfxdata", d.length) !== null).catch(() => null),
        getUnitAssets().catch(() => null),
      ]);
      const stock = buildStockSounds(decodeTbl(tbl), dat ? decodeSfxdataDat(dat) : null, assets?.units ?? null);
      if (epoch === stockEpoch) stockReady = stock;
      return stock;
    } catch {
      return null;
    }
  })();
  return stockPromise;
}

/** The list if it has been fetched, for synchronous callers. */
export function peekStockSounds(): StockSounds | null {
  return stockReady;
}

/** Already-loaded tables, for synchronous render paths. */
export function peekUnitAssets(): UnitAssets | null {
  return assetsReady;
}

/** images.dat id of the unit type's main graphic. */
export function unitImageId(assets: UnitAssets, unitId: number): number {
  return assets.sprites.image[assets.flingy.sprite[assets.units.flingy[unitId]]] ?? 0;
}

/** An images.tbl entry as a URL path under `public/unit/`, or null when there is none. */
function tblPath(assets: UnitAssets, index: number): string | null {
  const path = assets.imagePaths[index - 1];
  return path ? path.toLowerCase().replaceAll("\\", "/") : null;
}

/** URL path under `public/unit/` for an image's GRP, or null when the table has none. */
export function imageGrpPath(assets: UnitAssets, imageId: number): string | null {
  return tblPath(assets, assets.images.grp[imageId]);
}

/** URL path under `public/unit/` for one of an image's overlay `.lo` files, or null. */
export function imageLoPath(assets: UnitAssets, imageId: number, kind: (typeof LO_KINDS)[number]): string | null {
  return tblPath(assets, assets.images.lo[LO_KINDS.indexOf(kind)][imageId]);
}

/* ── Lazily fetched parts ────────────────────────────────── */

const listeners = new Set<() => void>();

/** Called whenever a lazily fetched part (GRP, .lo, remap table) arrives or fails, so canvases can repaint. */
export function onGrpLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tell the canvases that something they draw from arrived outside the lazy parts (the tables an icon is named by). */
export function announceArrival(): void {
  for (const l of listeners) l();
}

/**
 * One cache of decoded files by path: `get` returns the value once it has arrived, `null`
 * once the fetch failed, and `undefined` while it is on its way — the first call starts it.
 */
class LazyFiles<T> {
  private readonly ready = new Map<string, T | null>();
  private readonly pending = new Set<string>();
  private readonly decode: (data: Uint8Array) => T;
  private readonly check: (data: Uint8Array) => boolean;

  constructor(decode: (data: Uint8Array) => T, check: (data: Uint8Array) => boolean) {
    this.decode = decode;
    this.check = check;
  }

  /** Drop the entries that failed, so the next `get` fetches again (the game data was just installed). */
  forgetFailed(): void {
    for (const [path, value] of this.ready) if (value === null) this.ready.delete(path);
  }

  /** Drop everything, failed or not: the files behind these paths are a different data set's now. */
  clear(): void {
    this.ready.clear();
    // A fetch still in flight lands in `ready` when it settles; nothing can be done about
    // that here, so `pending` is left alone rather than lying about it.
  }

  get(path: string): T | null | undefined {
    if (this.ready.has(path)) return this.ready.get(path);
    if (!this.pending.has(path)) {
      this.pending.add(path);
      void fetchPart(path, this.check)
        .then((d) => this.decode(d))
        .catch((err: unknown) => {
          console.warn(`${path} failed to load`, err);
          return null;
        })
        .then((value) => {
          this.ready.set(path, value);
          this.pending.delete(path);
          for (const l of listeners) l();
        });
    }
    return undefined;
  }
}

const grps = new LazyFiles<Grp>(decodeGrp, (d) => d.length >= 6 && (d[0] | (d[1] << 8)) > 0);
const los = new LazyFiles<LoFile>(decodeLo, (d) => d.length >= 8 && d[0] + (d[1] << 8) > 0);
const remaps = new LazyFiles<Uint8Array>((d) => decodePcx(d).pixels, (d) => d.length > 128 && d[0] === 0x0a);
const anims = new LazyFiles<Anim>((d) => {
  const anim = parseAnim(d);
  if (!anim) throw new Error("not a 2x sprite file");
  return anim;
}, isAnim);

/* ── Remastered sprites (the 2x pictures) ───────────────── */

/**
 * View ▸ Remastered Graphics, for sprites: `sprites.ts#getImageFrame` asks this before it
 * draws a frame, and draws from the image's `.anim` where the data set has one. A module
 * variable for the reason `tileset/load.ts#setHdTerrain` is: the frame cache is asked from
 * the viewport, the palettes, the exporter and plugins, and they have to agree.
 */
let hdSpriteMode = false;
/**
 * The images that have a 2x sprite, from `unit/manifest.json`: `undefined` until it has
 * been asked for, `null` when the data set has none (a 1.16 copy) or no manifest. Asking a
 * hundred images for files that are not there, one failed fetch and one console line
 * each, is what this saves.
 */
let hdImages: Set<number> | null | undefined;
let hdImagesLoading = false;
/** For an image with no 2x sprite of its own, the image whose file it is drawn from (null: none has one). Per data set. */
const sharedAnims = new Map<number, number | null>();

/** Turn the 2x sprites on or off for every reader, and tell the canvases when that changed. */
export function setHdSprites(on: boolean): boolean {
  if (hdSpriteMode === on) return false;
  hdSpriteMode = on;
  for (const l of listeners) l();
  return true;
}

export const hdSprites = (): boolean => hdSpriteMode;

/**
 * An image's 2x sprite, per the `LazyFiles` contract: the anim once it has arrived, `null`
 * when the data set has none for this image, `undefined` while it (or the list of which
 * images have one) is on its way.
 */
export function requestAnim(imageId: number): Anim | null | undefined {
  if (hdImages === undefined) {
    if (!hdImagesLoading) {
      hdImagesLoading = true;
      void unitManifest().then((manifest) => {
        hdImages = manifest?.hd && manifest.hd.length > 0 ? new Set(manifest.hd) : null;
        hdImagesLoading = false;
        for (const l of listeners) l();
      });
    }
    return undefined;
  }
  if (!hdImages || classicOnly(imageId)) return null;
  if (hdImages.has(imageId)) return anims.get(animPath(imageId));
  // No file of its own: the file of another image of the same GRP, where the data set has that.
  let from = sharedAnims.get(imageId);
  if (from === undefined) {
    if (!assetsReady) return null;
    const have = hdImages;
    from = imagesSharingGrp(assetsReady.images.grp, imageId).find((other) => have.has(other)) ?? null;
    sharedAnims.set(imageId, from);
  }
  return from === null ? null : anims.get(animPath(from));
}

/**
 * Whether an image must be drawn from its GRP even with the 2x sprites on: the data set
 * changed its picture or its images.dat row against the copy it was laid over (the stamp's
 * `hdOff`, worked out at install), so the 2x sprite on file is of something else. A data
 * set read through a function in memory draws every image so, since what it changes is
 * not known ahead.
 */
function classicOnly(imageId: number): boolean {
  const source = currentAssetSource();
  if (source?.kind === "reader") return true;
  const off = source?.stored?.hdOff;
  if (!off || off.length === 0) return false;
  if (hdOffSet?.list !== off) hdOffSet = { list: off, set: new Set(off) };
  return hdOffSet.set.has(imageId);
}
let hdOffSet: { list: readonly number[]; set: Set<number> } | null = null;

/** The image whose 2x sprite file `requestAnim` answers with: the image's own, or the GRP-mate's it is drawn from. */
export function animImage(imageId: number): number {
  return hdImages?.has(imageId) ? imageId : sharedAnims.get(imageId) ?? imageId;
}

/**
 * After the game data source changes (Help ▸ Game Data… installed a copy): forget every
 * part that failed so it is fetched again, and tell the canvases. The tables retry on
 * their own — `getUnitAssets` drops its promise when it fails.
 */
export function retryFailedParts(): void {
  grps.forgetFailed();
  los.forgetFailed();
  remaps.forgetFailed();
  palettes.forgetFailed();
  anims.forgetFailed();
  // A data set found to have no 2x sprites may have them now.
  if (hdImages === null) { hdImages = undefined; manifestPromise = null; }
  if (unitIconsListed === false) unitIconsListed = undefined;
  sharedAnims.clear();
  // Likewise the sound list: a copy that lacked it may have been replaced by one that has it.
  if (!stockReady) stockPromise = null;
  for (const l of listeners) l();
}

/**
 * The game data source changed to a *different* set of files (Help ▸ Game Data… switched
 * data sets): every table, GRP, overlay and remap in memory describes the old one, so all
 * of it goes, the names go back to the editor's tables, and the next `getUnitAssets` /
 * `requestGrp` fetches afresh. The canvases are told, as after any part arrives.
 */
export function resetUnitAssets(): void {
  assetsPromise = null;
  assetsReady = null;
  stockPromise = null;
  stockReady = null;
  stockEpoch++;
  installNames(null);
  manifestPromise = null;
  grps.clear();
  los.clear();
  remaps.clear();
  palettes.clear();
  anims.clear();
  hdImages = undefined;
  unitIconsListed = undefined;
  sharedAnims.clear();
  for (const l of listeners) l();
}

/** The decoded GRP for a path under `public/unit/`, per the LazyFiles contract. */
export function requestGrp(path: string): Grp | null | undefined {
  return grps.get(`unit/${path}`);
}

/**
 * Wait for a set of lazily fetched GRPs. `requestGrp` starts the fetch and answers
 * `undefined` until it settles, so the arrival notification is the only signal there is.
 * Used by the startup preload and by image export, both of which want every graphic
 * present before they draw rather than markers where one has not arrived yet.
 */
export function awaitGrps(paths: readonly string[]): Promise<void> {
  // `requestGrp` is what *starts* a fetch, so ask for every path before testing any of
  // them — a short-circuiting `some(...)` would serialise the warm-up one round trip at
  // a time instead of running the handful of GRPs in parallel.
  const anyPending = () => paths.map((p) => requestGrp(p)).some((g) => g === undefined);
  if (!anyPending()) return Promise.resolve();
  return new Promise((resolve) => {
    let off = () => {};
    const check = () => {
      if (anyPending()) return false;
      off();
      resolve();
      return true;
    };
    off = onGrpLoaded(check);
    // A fetch can settle between the first check and the subscription above; without this
    // second look that notification is missed and the wait hangs.
    check();
  });
}

/**
 * Wait for the 2x sprites of a set of images, as `awaitGrps` waits for GRPs: until each
 * has arrived or is known not to exist. Resolves at once with the option off.
 */
export function awaitAnims(imageIds: readonly number[]): Promise<void> {
  if (!hdSpriteMode) return Promise.resolve();
  const anyPending = () => imageIds.map((id) => requestAnim(id)).some((a) => a === undefined);
  if (!anyPending()) return Promise.resolve();
  return new Promise((resolve) => {
    let off = () => {};
    const check = () => {
      if (hdSpriteMode && anyPending()) return false;
      off();
      resolve();
      return true;
    };
    off = onGrpLoaded(check);
    check();
  });
}

/** The decoded `.lo` file for a path under `public/unit/`. */
export function requestLo(path: string): LoFile | null | undefined {
  return los.get(`unit/${path}`);
}

/* ── The game's button pictures ─────────────────────────── */

/** The command card's icons: one frame a unit type (frame = units.dat id), the rest named by upgrades.dat / techdata.dat. */
export const ICON_SHEET = "unit/cmdbtns/cmdicons.grp";
/** Their colours: 96 palette indices, six looks of 16 (normal, disabled, selected, …), an icon pixel picking one of a look's 16. */
export const ICON_COLOURS = "unit/cmdbtns/ticon.pcx";
/**
 * The palette the icons are painted through. Every tileset's palette agrees on the colours
 * `ticon.pcx` names (checked over all eight), so one is fetched rather than following the
 * open map's tileset, and an icon looks the same on any map, or with none open.
 */
const ICON_PALETTE = "tileset/badlands.wpe";
/** Whether the manifest lists `uniticons.grp`: undefined before it was asked, null while it is on its way. */
let unitIconsListed: boolean | null | undefined;
const palettes = new LazyFiles<Uint8Array>(decodePalette, (d) => d.length === 1024);

export interface IconSheet {
  grp: Grp;
  colours: Uint8Array;
  palette: Uint8Array;
  /**
   * `unit\cmdbtns\uniticons.grp`, where the data set has one: a unit type's picture by its
   * id for every type, the game's sheet keeping only the 228 (GPTP's convention). Null
   * without one, and then unit types past 227 have no picture.
   */
  units: Grp | null;
}

/**
 * The icon sheet with its colours and palette, per the `LazyFiles` contract: all three once
 * they have arrived, null when any is missing (a copy made before 2026-10-15 has no icons),
 * undefined while one is on its way. The first call starts the fetches.
 */
export function requestIconSheet(): IconSheet | null | undefined {
  const grp = grps.get(ICON_SHEET);
  const colours = remaps.get(ICON_COLOURS);
  const palette = palettes.get(ICON_PALETTE);
  if (grp === null || colours === null || palette === null) return null;
  if (grp === undefined || colours === undefined || palette === undefined) return undefined;
  // The data set's own sheet of unit pictures, asked for only where the extraction found one.
  if (unitIconsListed === undefined) {
    unitIconsListed = null;
    void unitManifest().then((m) => { unitIconsListed = m?.optional.includes(UNIT_ICONS_FILE) ?? false; for (const l of listeners) l(); });
  }
  if (unitIconsListed === null) return undefined;
  const units = unitIconsListed ? grps.get(UNIT_ICONS_FILE) : null;
  if (units === undefined) return undefined;
  return { grp, colours, palette, units };
}

/**
 * A tileset's colour remap table (`public/tileset/<name>.ofire.pcx` etc., from
 * scripts/extract-tilesets.mjs): 256 columns per source index. `remapping` is the
 * images.dat value; 0 has no table.
 */
export function requestRemap(tilesetName: string, remapping: number): Uint8Array | null | undefined {
  const table = REMAP_TABLES[remapping];
  if (!table) return null;
  return remaps.get(`tileset/${tilesetName}.${table}.pcx`);
}
