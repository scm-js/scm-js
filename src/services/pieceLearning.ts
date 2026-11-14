/**
 * Tile palette ▸ Pieces ▸ Learn from Maps…: pick a folder, read every map under it against the
 * data set in use (`editor/pieceLearn.ts`), keep what was learned (`pieceStore.ts`) and say what
 * came of it. Loaded only when the button is pressed: it brings the folder pick and the map
 * reader with it.
 */
import type { createStore } from "jotai";
import { statusMessageAtom } from "../atoms/uiAtoms";
import { learnedPiecesAtom, pieceLearningAtom, pieceLearnReportAtom } from "../atoms/pieceAtoms";
import { TILESETS } from "../data/tilesets";
import { isMapName, learnFromMaps, piecesPerTileset } from "../editor/pieceLearn";
import type { PieceEvidence } from "../editor/pieces";
import { loadTilesetGroups, TILESET_FILENAMES } from "../formats/tileset/load";
import { pickFolder } from "../plugins/host";
import { pieceSetId } from "../hooks/usePieces";
import { browserPieceStore, forgetLearned, piecesKey, writeLearned } from "./pieceStore";
import { t, translate } from "../i18n";

type Store = ReturnType<typeof createStore>;

/** Every tileset's key of the data set, as nothing learned. */
function cleared(setId: string): Record<string, null> {
  return Object.fromEntries(TILESET_FILENAMES.map((_, era) => [piecesKey(setId, era), null]));
}

export async function learnPiecesFromFolder(store: Store): Promise<void> {
  if (store.get(pieceLearningAtom)) return;
  const picked = await pickFolder(store);
  if (picked.length === 0) return;
  const maps = picked.filter((f) => isMapName(f.path));
  if (maps.length === 0) {
    store.set(pieceLearnReportAtom, t("No maps in that folder: nothing was learned."));
    return;
  }
  const setId = pieceSetId(store);
  const started = performance.now();
  store.set(pieceLearningAtom, { done: 0, total: maps.length });
  try {
    const result = await learnFromMaps(
      maps.map((f) => ({ name: f.path, bytes: async () => new Uint8Array(await f.file.arrayBuffer()) })),
      {
        groups: (era) => loadTilesetGroups(TILESET_FILENAMES[era]).catch(() => null),
        progress: (done, total) => store.set(pieceLearningAtom, { done, total }),
        // A turn of the event loop between maps, so the page draws and the progress moves.
        pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
      },
    );
    await writeLearned(browserPieceStore, setId, result.evidence);
    const next: Record<string, PieceEvidence | null> = { ...store.get(learnedPiecesAtom), ...cleared(setId) };
    for (const [era, evidence] of result.evidence) next[piecesKey(setId, era)] = evidence;
    store.set(learnedPiecesAtom, next);
    const counts = [...piecesPerTileset(result)].sort((a, b) => a[0] - b[0])
      .map(([era, n]) => t("{tileset} {n, plural, one {# piece} other {# pieces}}", { tileset: translate(TILESETS[era].name), n }));
    const notOurs = result.skipped.filter((s) => s.reason === "notOurs").length;
    const unreadable = result.skipped.length - notOurs;
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    const skipped = [
      notOurs > 0 ? t("{n, plural, one {# made for other tiles} other {# made for other tiles}}", { n: notOurs }) : null,
      unreadable > 0 ? t("{n, plural, one {# that would not open} other {# that would not open}}", { n: unreadable }) : null,
    ].filter((s): s is string => s !== null);
    const report = [
      t("Read {read, plural, one {# map} other {# maps}} in {seconds} s.", { read: result.read, seconds }),
      skipped.length > 0 ? t("Skipped {list}.", { list: skipped.join(", ") }) : null,
      counts.length > 0 ? counts.join(", ") + "." : t("No map here is on a tileset this data set has."),
    ].filter((s): s is string => s !== null).join(" ");
    store.set(pieceLearnReportAtom, report);
    store.set(statusMessageAtom, report);
  } finally {
    store.set(pieceLearningAtom, null);
  }
}

/** Forget the data set's learned pieces: the map in front's own are what is left. */
export async function forgetPieces(store: Store): Promise<void> {
  const setId = pieceSetId(store);
  await forgetLearned(browserPieceStore, setId);
  store.set(learnedPiecesAtom, { ...store.get(learnedPiecesAtom), ...cleared(setId) });
  store.set(pieceLearnReportAtom, null);
  store.set(statusMessageAtom, t("Forgot the pieces learned from maps"));
}
