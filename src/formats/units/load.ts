import {
  decodeFlingyDat, decodeImagesDat, decodeSpritesDat, decodeTechdataDat, decodeUnitsDat, decodeUpgradesDat, decodeWeaponsDat, FLINGY_DAT_SIZE, IMAGES_DAT_SIZE, LO_KINDS, REMAP_TABLES,
  SPRITES_DAT_SIZE, TECHDATA_DAT_SIZE, UNITS_DAT_SIZE, UNITS_DAT_SIZE_LEGACY, UPGRADES_DAT_SIZE, WEAPONS_DAT_SIZE,
  type FlingyDat, type ImagesDat, type SpritesDat, type TechdataDat, type UnitsDat, type UpgradesDat, type WeaponsDat,
} from "../dat/dat";
import { decodeGrp, type Grp } from "../dat/grp";
import { decodeIscript, type IscriptBin } from "../dat/iscript";
import { decodeLo, type LoFile } from "../dat/lo";
import { decodePcx } from "../dat/pcx";
import { decodeTbl } from "../dat/tbl";
import { TEAM_COLOR_ROWS, TEAM_SLOT_COUNT } from "./teamColor";
import { fetchAsset } from "../../gamedata/source";

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
}

export class UnitAssetsMissingError extends Error {
  constructor(cause?: unknown) {
    super("Unit data is not available. Help ▸ Game Data… installs it from a StarCraft installation.", { cause });
    this.name = "UnitAssetsMissingError";
  }
}

/** Like the tileset loader: a dev server answers a missing file with index.html and 200. */
async function fetchPart(path: string, check: (data: Uint8Array) => boolean): Promise<Uint8Array> {
  const res = await fetchAsset(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  if (!check(data)) throw new Error(`${path}: unexpected content (${data.length} bytes)`);
  return data;
}

let assetsPromise: Promise<UnitAssets> | null = null;
let assetsReady: UnitAssets | null = null;

export function getUnitAssets(): Promise<UnitAssets> {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    try {
      const [units, flingy, sprites, images, tbl, pcx, iscript, weapons, upgrades, techs] = await Promise.all([
        fetchPart("arr/units.dat", (d) => d.length === UNITS_DAT_SIZE || d.length === UNITS_DAT_SIZE_LEGACY),
        fetchPart("arr/flingy.dat", (d) => d.length === FLINGY_DAT_SIZE),
        fetchPart("arr/sprites.dat", (d) => d.length === SPRITES_DAT_SIZE),
        fetchPart("arr/images.dat", (d) => d.length === IMAGES_DAT_SIZE),
        fetchPart("arr/images.tbl", (d) => d.length > 2 && d[0] + (d[1] << 8) > 0),
        fetchPart("game/tunit.pcx", (d) => d.length > 128 && d[0] === 0x0a),
        // Optional: an older extraction has no iscript.bin, and that only costs animation.
        fetchPart("scripts/iscript.bin", (d) => d.length > 4 && (d[0] | (d[1] << 8)) < d.length).catch((err: unknown) => {
          console.warn("scripts/iscript.bin is not installed; units will not animate", err);
          return null;
        }),
        fetchPart("arr/weapons.dat", (d) => d.length === WEAPONS_DAT_SIZE).catch((err: unknown) => {
          console.warn("arr/weapons.dat is not installed; Unit Settings will show no weapon defaults", err);
          return null;
        }),
        fetchPart("arr/upgrades.dat", (d) => d.length === UPGRADES_DAT_SIZE).catch((err: unknown) => {
          console.warn("arr/upgrades.dat is not installed; Upgrade Settings will show no defaults", err);
          return null;
        }),
        fetchPart("arr/techdata.dat", (d) => d.length === TECHDATA_DAT_SIZE).catch((err: unknown) => {
          console.warn("arr/techdata.dat is not installed; Technology Settings will show no defaults", err);
          return null;
        }),
      ]);
      const teamColors = decodePcx(pcx).pixels;
      if (teamColors.length < TEAM_COLOR_ROWS * TEAM_SLOT_COUNT) throw new Error("tunit.pcx: too small");
      const assets: UnitAssets = {
        units: decodeUnitsDat(units),
        flingy: decodeFlingyDat(flingy),
        sprites: decodeSpritesDat(sprites),
        images: decodeImagesDat(images),
        imagePaths: decodeTbl(tbl),
        teamColors,
        iscript: iscript ? decodeIscript(iscript) : null,
        weapons: weapons ? decodeWeaponsDat(weapons) : null,
        upgrades: upgrades ? decodeUpgradesDat(upgrades) : null,
        techs: techs ? decodeTechdataDat(techs) : null,
      };
      assetsReady = assets;
      return assets;
    } catch (err) {
      assetsPromise = null; // let a later attempt retry after the files are installed
      throw new UnitAssetsMissingError(err);
    }
  })();
  return assetsPromise;
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

/**
 * After the game data source changes (Help ▸ Game Data… installed a copy): forget every
 * part that failed so it is fetched again, and tell the canvases. The tables retry on
 * their own — `getUnitAssets` drops its promise when it fails.
 */
export function retryFailedParts(): void {
  grps.forgetFailed();
  los.forgetFailed();
  remaps.forgetFailed();
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

/** The decoded `.lo` file for a path under `public/unit/`. */
export function requestLo(path: string): LoFile | null | undefined {
  return los.get(`unit/${path}`);
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
