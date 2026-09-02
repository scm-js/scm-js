import { TILESETS, type TilesetId } from "../data/tilesets";
import { START_LOCATION } from "../data/units";
import {
  ensureTileset, onTilesetProgress, peekTileset, TILESET_FILENAMES, type TilesetFileName,
} from "../formats/tileset/load";
import {
  awaitGrps, getUnitAssets, imageGrpPath, peekUnitAssets, unitImageId,
} from "../formats/units/load";
import { fetchAsset, resolveAssetSource } from "../gamedata/source";

/**
 * Startup asset preloading.
 *
 * Before this existed the splash ran a fixed 3.3s script of invented log lines while the
 * real fetches happened on their own schedule behind it — the tileset atlas was often
 * still rasterising when the splash lifted (hence the "Loading … terrain" plate) and the
 * unit tables did not even *start* until MapViewport mounted. `runPreload` is the real
 * thing: an ordered list of tasks whose progress the splash reports, so the editor is
 * warm the moment it is shown.
 *
 * Every task is best-effort. Missing game data (nobody has run `npm run extract`) is a
 * normal state everywhere else in the app, so a failed task is reported and stepped over
 * rather than blocking the way in.
 */

export interface PreloadStep {
  /**
   * 0..1 across every task, weighted by cost — what the bar shows. A task that knows its
   * own progress (the tileset download) moves it continuously rather than in jumps, so
   * the bar is not parked at 0% for the whole of the one slow step.
   */
  progress: number;
  /** Tasks finished, including the one named by `label` once `done` is true. */
  completed: number;
  total: number;
  /** The task being run, or the last one when `done`. */
  label: string;
  /**
   * The task that just finished, on the tick it finished. `failed` is set when it could
   * not load — the app degrades rather than stopping, so the way in is never blocked.
   */
  justFinished?: { label: string; failed?: string };
  done: boolean;
}

export interface PreloadTask {
  label: string;
  /** Share of the bar this task gets. Defaults to 1. */
  weight?: number;
  /** `report` takes 0..1 within this task; tasks that cannot measure themselves ignore it. */
  run: (report: (fraction: number) => void) => Promise<unknown>;
}

/** The units a blank map and the palette's first screen draw; small, and always wanted. */
const WARM_UNITS = [176, 177, 178, 188, START_LOCATION];

export function tilesetFileName(id: TilesetId): TilesetFileName {
  const index = TILESETS.findIndex((t) => t.id === id);
  return TILESET_FILENAMES[index < 0 ? 0 : index];
}

/** Pull the graphics for the handful of units above, so nothing pops in as markers first. */
async function warmUnitGrps(): Promise<void> {
  const assets = peekUnitAssets() ?? (await getUnitAssets());
  const paths: string[] = [];
  for (const id of WARM_UNITS) {
    const path = imageGrpPath(assets, unitImageId(assets, id));
    if (path && !paths.includes(path)) paths.push(path);
  }
  await awaitGrps(paths);
}

/**
 * Every task here does work that the editor would otherwise do *after* the splash lifted.
 * Nothing is padding: if a step is not actually awaiting something, it does not belong,
 * because the whole point is that the bar reaching the end means the editor is ready.
 */
function tasks(startup: TilesetFileName): PreloadTask[] {
  const era = startup[0].toUpperCase() + startup.slice(1);
  return [
    {
      // Where the files come from: bundled, a stored copy, the desktop's disk search
      // (which may extract, slowly) or the configured address (which may download).
      // The loaders below all wait on this same resolution, so it is the natural first step.
      label: "Locating game data",
      run: async (report) => {
        const source = await resolveAssetSource((f) => report(f));
        if (source.kind === "none") throw new Error(source.tried[source.tried.length - 1] ?? "none found");
      },
    },
    {
      label: `Loading tileset · ${era}`,
      // A couple of megabytes of tileset against a few hundred KB for everything else.
      weight: 6,
      run: async (report) => {
        // The last tenth is the atlas rasterisation, which has no progress of its own.
        const off = onTilesetProgress((p) => {
          if (p.tileset === startup && p.total > 0) report(Math.min(0.9, (p.loaded / p.total) * 0.9));
        });
        try {
          await ensureTileset(startup);
        } finally {
          off();
        }
      },
    },
    { label: "Reading units.dat · sprites.dat · iscript.bin", weight: 2, run: () => getUnitAssets() },
    { label: "Rasterising unit graphics", weight: 2, run: () => warmUnitGrps() },
  ];
}

/**
 * Run the blocking preload, reporting each task. Resolves when the editor is ready to be
 * shown; the caller decides how long to keep the splash up beyond that.
 */
export async function runPreload(
  startupTileset: TilesetId,
  onStep: (step: PreloadStep) => void,
  extra: PreloadTask[] = [],
): Promise<void> {
  const list = [...tasks(tilesetFileName(startupTileset)), ...extra];
  const weights = list.map((t) => t.weight ?? 1);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  let before = 0;
  for (let i = 0; i < list.length; i++) {
    const task = list[i];
    const share = weights[i] / totalWeight;
    const base = before;
    onStep({ progress: base, completed: i, total: list.length, label: task.label, done: false });

    let failed: string | undefined;
    let peak = base; // never let a task's own report walk the bar backwards
    try {
      await task.run((f) => {
        peak = Math.max(peak, base + Math.max(0, Math.min(1, f)) * share);
        onStep({ progress: peak, completed: i, total: list.length, label: task.label, done: false });
      });
    } catch (err) {
      failed = err instanceof Error ? err.message : String(err);
      console.warn(`preload: ${task.label} failed`, err);
    }
    before = base + share;
    onStep({
      progress: before,
      completed: i + 1,
      total: list.length,
      label: list[i + 1]?.label ?? task.label,
      justFinished: { label: task.label, failed },
      done: false,
    });
  }
  onStep({ progress: 1, completed: list.length, total: list.length, label: "Ready.", done: true });
}

/* ── Background warm-up ─────────────────────────────────── */

let warmed = false;

/**
 * After the splash lifts, pull the *other* tilesets' files into the browser's HTTP cache
 * so that a later File ▸ New or a map of a different era pays only decode + rasterise
 * instead of a couple of megabytes over the wire.
 *
 * Deliberately bytes only: an atlas is ~20 MB of pixels per tileset, so decoding all
 * eight up front would cost more resident memory than the whole rest of the editor.
 * Fetches run one tileset at a time, and start on an idle callback, so they never
 * contend with the open map's own lazy GRP loading or with first paint.
 */
export function warmRemainingTilesets(startupTileset: TilesetId): void {
  if (warmed) return;
  warmed = true;
  const startup = tilesetFileName(startupTileset);
  const rest = TILESET_FILENAMES.filter((n) => n !== startup && peekTileset(n) === null);

  const idle = window.requestIdleCallback?.bind(window) ?? ((cb: () => void) => setTimeout(cb, 500));
  idle(() => void (async () => {
    for (const name of rest) {
      for (const ext of ["cv5", "vf4", "vr4", "vx4ex", "vx4", "wpe", "dddata.bin"]) {
        try {
          // The body has to be drained for the response to land in the cache; it is
          // dropped immediately, so at most one file is held at a time. (A stored copy
          // answers from disk, which costs a read and warms nothing; harmless.)
          await (await fetchAsset(`tileset/${name}.${ext}`, { cache: "force-cache", priority: "low" } as RequestInit)).arrayBuffer();
        } catch {
          // Missing game data, or the tab went away. Either way there is nothing to warm.
        }
      }
    }
  })());
}
