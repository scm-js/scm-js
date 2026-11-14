/**
 * Tile palette ▸ Pieces ▸ Learn from Maps…: pick a folder, read every map under it against the
 * tables of the data set in use (`editor/pieceLearn.ts`), keep what was learned under those
 * tables (`pieceStore.ts`) and say what came of it, once, as a finished job does: the status
 * line and a toast. Loaded only when the button is pressed: it brings the folder pick and the
 * map reader with it.
 */
import type { createStore } from "jotai";
import { pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { learnedPiecesAtom, pieceLearningAtom } from "../atoms/pieceAtoms";
import { TILESETS } from "../data/tilesets";
import { isMapName, learnFromMaps, piecesPerTileset } from "../editor/pieceLearn";
import type { PieceEvidence } from "../editor/pieces";
import type { Cv5Group } from "../formats/tileset/decode";
import { loadTilesetGroups, TILESET_FILENAMES } from "../formats/tileset/load";
import { pickFolder } from "../plugins/host";
import { browserPieceStore, forgetLearned, piecesKey, writeLearned } from "./pieceStore";
import { t, translate } from "../i18n";

type Store = ReturnType<typeof createStore>;

/** The data set in use's tables, by ERA index (null where it has none). */
async function tablesInUse(): Promise<(readonly Cv5Group[] | null)[]> {
  return Promise.all(TILESET_FILENAMES.map((name) => loadTilesetGroups(name).catch(() => null)));
}

/** The keys of the tables in use: what a learn replaces and a forget drops. */
const keysOf = (tables: readonly (readonly Cv5Group[] | null)[]) =>
  tables.flatMap((groups, era) => (groups ? [piecesKey(era, groups)] : []));

/** Say a finished job's outcome once: the status line and a toast. */
function tell(store: Store, kind: "ok" | "info" | "warn", title: string, detail?: string) {
  store.set(statusMessageAtom, detail ? `${title} ${detail}` : title);
  store.set(pushToastAtom, { kind, title, ...(detail ? { detail } : {}) });
}

export async function learnPiecesFromFolder(store: Store): Promise<void> {
  if (store.get(pieceLearningAtom)) return;
  const picked = await pickFolder(store);
  if (picked.length === 0) return;
  const maps = picked.filter((f) => isMapName(f.path));
  if (maps.length === 0) {
    tell(store, "warn", t("No maps in that folder: nothing was learned."));
    return;
  }
  const started = performance.now();
  store.set(pieceLearningAtom, { done: 0, total: maps.length });
  try {
    const tables = await tablesInUse();
    const result = await learnFromMaps(
      maps.map((f) => ({ name: f.path, bytes: async () => new Uint8Array(await f.file.arrayBuffer()) })),
      {
        groups: async (era) => tables[era] ?? null,
        progress: (done, total) => store.set(pieceLearningAtom, { done, total }),
        // A turn of the event loop between maps, so the page draws and the progress moves.
        pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
      },
    );
    const learned = new Map<string, PieceEvidence>();
    for (const [era, evidence] of result.evidence) learned.set(piecesKey(era, result.tables.get(era)!), evidence);
    const keys = keysOf(tables);
    await writeLearned(browserPieceStore, keys, learned);
    const next: Record<string, PieceEvidence | null> = { ...store.get(learnedPiecesAtom) };
    for (const key of keys) next[key] = learned.get(key) ?? null;
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
    const detail = [
      skipped.length > 0 ? t("Skipped {list}.", { list: skipped.join(", ") }) : null,
      counts.length > 0 ? counts.join(", ") + "." : t("No map here is on a tileset this data set has."),
    ].filter((s): s is string => s !== null).join(" ");
    tell(store, counts.length > 0 ? "ok" : "warn", t("Read {read, plural, one {# map} other {# maps}} in {seconds} s.", { read: result.read, seconds }), detail);
  } finally {
    store.set(pieceLearningAtom, null);
  }
}

/** Forget what was learned for the tables in use: the map in front's own pieces are what is left. */
export async function forgetPieces(store: Store): Promise<void> {
  const keys = keysOf(await tablesInUse());
  await forgetLearned(browserPieceStore, keys);
  const next: Record<string, PieceEvidence | null> = { ...store.get(learnedPiecesAtom) };
  for (const key of keys) next[key] = null;
  store.set(learnedPiecesAtom, next);
  store.set(statusMessageAtom, t("Forgot the pieces learned from maps"));
}
