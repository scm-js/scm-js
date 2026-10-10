/**
 * StarCraft: Remastered as a source of the game data. A Remastered installation has no MPQ
 * archives: its files sit in CASC storage (the `Data` folder), read here through `kascade`.
 * What comes out is the same extraction every other route produces — the storage only
 * answers `ReadMember` in the archives' place — so the loaders, the stored copy and the
 * manifests do not know the difference.
 *
 * The files do differ in one way that matters. Remastered added tiles to seven of the
 * eight tilesets, so its tile tables are longer than the 1.16 ones (and its megatile table
 * is `.vx4ex`, which the tileset loader already prefers). Everything the 1.16 tables hold
 * is in them unchanged, so a map made for 1.16 draws the same from either.
 *
 * This module is shared by the extraction worker, the desktop app's main process and the
 * tests, so it takes an opened storage rather than opening one: where the bytes come from
 * (a folder handle, a file list, `node:fs`) is the caller's business.
 */
import { slimAnim } from "../formats/dat/anim";
import { memberKey } from "./archives";
import { ExtractError, EXTRA_TABLES, extractGameData, UNIT_TABLES, type ExtractProgress, type GameDataExtraction } from "./extract";
import { REMASTERED_ORIGIN } from "./profiles";

export { BUILD_INFO, installRootOf, pickedFilesSource, type PickedFile } from "./remasteredFolder";

/** The part of an opened `kascade` storage the extraction uses. */
export interface RemasteredStorage {
  readonly build: { version: string };
  readonly hasNames: boolean;
  fileInfo(name: string): { installed: boolean } | null;
  readFile(name: string): Promise<Uint8Array>;
}

export interface RemasteredExtraction {
  result: GameDataExtraction;
  /** Files the build lists that this installation does not hold, if the extraction asked for any. */
  problems: string[];
  /** What the stamp records as the origin. */
  from: string;
}

/** Where the 2x sprite files are, as `memberKey` spells it. */
const HD_SPRITES = "hd2\\anim\\";
/** How many files are read from the storage at once. */
const BATCH = 24;
/** The extraction is run until it asks for nothing new; three passes is what it takes, this is the stop. */
const MAX_PASSES = 6;

/**
 * Run the extraction over a Remastered storage. `ReadMember` is synchronous and a storage
 * is not, so the extraction is run more than once: each pass answers from what has been
 * read so far and notes what it was asked for and did not have, those files are read, and
 * it goes again until a pass asks for nothing new. The first pass wants the tilesets and
 * the tables, the second the graphics the tables lead to. Which files those are stays the
 * extraction's own knowledge that way, with no second list here to fall out of step.
 *
 * `progress` runs 0–1: reading is the first three quarters, the last pass the rest.
 */
export async function extractRemastered(storage: RemasteredStorage, progress?: ExtractProgress): Promise<RemasteredExtraction> {
  if (!storage.hasNames || !storage.fileInfo("arr/units.dat")) {
    throw new ExtractError("This folder is an installation, but not of StarCraft: Remastered.");
  }
  const have = new Map<string, Uint8Array | null>();
  const problems: string[] = [];
  // The unit half stops at the first table it lacks, so the tables are asked for up front.
  let wanted = [...UNIT_TABLES, ...EXTRA_TABLES].map(memberKey);

  for (let pass = 0; pass < MAX_PASSES && wanted.length > 0; pass++) {
    let done = 0;
    const total = wanted.length;
    const base = Math.min(pass, 2) / 3;
    for (let i = 0; i < wanted.length; i += BATCH) {
      const batch = wanted.slice(i, i + BATCH);
      await Promise.all(
        batch.map(async (key) => {
          const info = storage.fileInfo(key);
          if (!info) {
            have.set(key, null);
          } else if (!info.installed) {
            have.set(key, null);
            problems.push(`${key} is not installed`);
          } else {
            const bytes = await storage.readFile(key);
            // A sprite file is cut down to the layers the editor keeps as it is read: whole,
            // the eight hundred of them are half a gigabyte held until the last pass.
            have.set(key, key.startsWith(HD_SPRITES) ? slimAnim(bytes) : bytes);
          }
        }),
      );
      done += batch.length;
      progress?.((base + (done / total) / 3) * 0.75, `Reading StarCraft: Remastered · ${done} of ${total}`);
    }

    const asked = new Set<string>();
    try {
      extractGameData((member) => {
        const key = memberKey(member);
        if (!have.has(key)) asked.add(key);
        return have.get(key) ?? null;
      });
    } catch (err) {
      // A table is missing for good once nothing more can be read; until then it is only not read yet.
      if (!(err instanceof ExtractError) || asked.size === 0) throw err;
    }
    wanted = [...asked];
  }

  const result = extractGameData((member) => have.get(memberKey(member)) ?? null, (f, label) => progress?.(0.75 + f * 0.25, label));
  return { result, problems, from: `${REMASTERED_ORIGIN} ${storage.build.version}`.trim() };
}
