/**
 * Tile palette ▸ Pieces ▸ Learn from Maps…: pick a folder, read every map under it against the
 * tables of the data set in use (`editor/pieceLearn.ts`), keep what was learned under those
 * tables (`pieceStore.ts`) and say what came of it, once, as a finished job does: the status
 * line and a toast. Loaded only when the button is pressed: it brings the folder pick and the
 * map reader with it.
 */
import { pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { learnedPiecesAtom, pieceLearningAtom } from "../atoms/pieceAtoms";
import { TILESETS, terrainName } from "../data/tilesets";
import { isMapName, learnFromMaps, piecesPerTileset } from "../editor/pieceLearn";
import type { PieceEvidence } from "../editor/pieces";
import type { Cv5Group } from "../formats/tileset/decode";
import { loadTilesetGroups, peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { pickFolder } from "../plugins/host";
import { scenarioAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { cutBorderTables, emptyBorderEvidence, gatherBorderEvidence, type BorderEvidence } from "../editor/borderTable";
import { tilesetIndex } from "../formats/chk/scenario";
import { drawsFromGame } from "./borrow";
import { forgetLearnedBorders, keepLearnedBorders, learningSetup } from "./borders";
import { browserPieceStore, forgetLearned, piecesKey, writeLearned } from "./pieceStore";
import { t, translate } from "../i18n";
import type { Store } from "../atoms/store";

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
        borders: async (era) => {
          const host = peekTileset(TILESET_FILENAMES[era])?.tileset;
          return host ? learningSetup(store, era, host) : null;
        },
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
    const borders = await keepBorders(store, result.borders);
    tell(store, counts.length > 0 ? "ok" : "warn", t("Read {read, plural, one {# map} other {# maps}} in {seconds} s.", { read: result.read, seconds }), [detail, borders].filter(Boolean).join(" "));
  } finally {
    store.set(pieceLearningAtom, null);
  }
}

/**
 * Keep the drawn borders a learn found (the map in front counted in too) for every tileset loaded here, and say what they
 * are: the pairs learned, or why there are none.
 */
async function keepBorders(store: Store, found: ReadonlyMap<number, BorderEvidence>): Promise<string> {
  if (drawsFromGame(store.get(gameDataSourceAtom))) return "";
  const lines: string[] = [];
  let anySetup = false;
  for (let era = 0; era < TILESET_FILENAMES.length; era++) {
    const host = peekTileset(TILESET_FILENAMES[era])?.tileset;
    if (!host) continue;
    const setup = await learningSetup(store, era, host);
    if (!setup) continue;
    anySetup = true;
    const evidence = found.get(era) ?? emptyBorderEvidence();
    const scn = store.get(scenarioAtom);
    if (scn && tilesetIndex(scn) === era && scn.tiles.length === scn.width * scn.height) gatherBorderEvidence(evidence, scn.tiles, scn.width, scn.height, setup.classes, setup.standIns);
    await keepLearnedBorders(store, era, host, evidence.pairs.size > 0 ? evidence : null);
    for (const tb of cutBorderTables(evidence)) {
      lines.push(t("{terrain} from {source} on {ground} ({n, plural, one {# shape} other {# shapes}})", {
        terrain: translate(terrainName(TILESETS[tb.sourceEra], tb.x)), source: translate(TILESETS[tb.sourceEra].name), ground: translate(terrainName(TILESETS[era], tb.y)), n: tb.shapes.size,
      }));
    }
  }
  if (!anySetup) return t("No drawn borders were learned: this tileset's copies of other tilesets are not known yet. Find them first (Isometric tab ▸ From other tilesets).");
  if (lines.length === 0) return t("No drawn borders: no map here draws one between borrowed ground and this tileset's own.");
  const shown = lines.slice(0, 6).join(", ");
  return lines.length > 6
    ? t("Drawn borders for {n} pairs: {list} and {more} more.", { n: lines.length, list: shown, more: lines.length - 6 })
    : t("Drawn borders for {n, plural, one {# pair} other {# pairs}}: {list}.", { n: lines.length, list: shown });
}

/** Forget what was learned for the tables in use: the map in front's own pieces are what is left. */
export async function forgetPieces(store: Store): Promise<void> {
  const keys = keysOf(await tablesInUse());
  await forgetLearned(browserPieceStore, keys);
  for (let era = 0; era < TILESET_FILENAMES.length; era++) {
    const host = peekTileset(TILESET_FILENAMES[era])?.tileset;
    if (host) await forgetLearnedBorders(store, era, host).catch(() => undefined);
  }
  const next: Record<string, PieceEvidence | null> = { ...store.get(learnedPiecesAtom) };
  for (const key of keys) next[key] = null;
  store.set(learnedPiecesAtom, next);
  store.set(statusMessageAtom, t("Forgot the pieces learned from maps"));
}
