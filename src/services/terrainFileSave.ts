/**
 * The Pieces view's **Save as a terrain file…**: `terrain.json` for the tileset in front, from what the editor knows
 * (`editor/terrainFileSection.ts`). A file chosen that already exists and reads keeps its other tilesets' sections and
 * unknown keys; with none (a download), the data set in use's own kept file is the base, else nothing. Loaded only when
 * the button is pressed.
 */
import type { getDefaultStore } from "jotai";
import { borrowHostsAtom } from "../atoms/borrowAtoms";
import { scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { gameDataSourceAtom } from "../atoms/gameDataAtoms";
import { providedTypesAtom } from "../atoms/pieceAtoms";
import { pushToastAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { TILESETS } from "../data/tilesets";
import { tableHash } from "../editor/pieceLearn";
import { terrainFileSection } from "../editor/terrainFileSection";
import { tilesetIndex } from "../formats/chk/scenario";
import { emptyTerrainFile, readTerrainFile, TERRAIN_FILE, withTerrainSection, writeTerrainFile, type TerrainFile } from "../formats/mod/terrain";
import { peekTileset } from "../formats/tileset/load";
import { t, translate } from "../i18n";
import { borrowContext, drawsFromGame, hostKeyOf } from "./borrow";
import { borderTables, prepareBorders } from "./borders";
import type { BorderPairTable } from "../editor/borderTable";
import { keptDataSetTerrainText } from "./dataSetTerrain";
import { saveComposed } from "./mapIo";
import { sectionsFromStore } from "./pieces";

type Store = ReturnType<typeof getDefaultStore>;

const readable = (text: string | null): TerrainFile | null => {
  if (!text) return null;
  const read = readTerrainFile(text);
  return read.dropped.some((d) => d.at === "" || d.at === "format") ? null : read.file;
};

export async function saveTerrainFile(store: Store): Promise<void> {
  const scn = store.get(scenarioAtom), loaded = peekTileset(store.get(tilesetFileNameAtom));
  if (!scn || !loaded) { store.set(statusMessageAtom, t("A terrain file needs a map open and its tileset's graphics.")); return; }
  const era = tilesetIndex(scn), host = loaded.tileset, id = TILESETS[era].id;
  const declared = store.get(providedTypesAtom).filter((r) => r.tileset === id).flatMap((r) => r.types);
  const borrow: { source: string; table: NonNullable<Awaited<ReturnType<typeof borrowContext>>>["table"] }[] = [];
  const borders: { source: string; table: BorderPairTable }[] = [];
  await prepareBorders(store, era, host);
  for (const s of store.get(borrowHostsAtom).get(hostKeyOf(era, host))?.sources ?? []) {
    const ctx = await borrowContext(store, era, host, s.sourceEra);
    if (!ctx) continue;
    borrow.push({ source: TILESETS[s.sourceEra].id, table: ctx.table });
    for (const b of borderTables(store, era, host, ctx).values()) borders.push({ source: TILESETS[s.sourceEra].id, table: b });
  }
  const section = terrainFileSection(tableHash(host.groups), sectionsFromStore(store, host), declared, borrow, borders);
  const source = store.get(gameDataSourceAtom);
  const kept = source && !drawsFromGame(source) ? readable(await keptDataSetTerrainText(source.profile.id)) : null;
  try {
    const saved = await saveComposed(TERRAIN_FILE, async (existing) => {
      const base = (existing ? readable(await existing.text()) : null) ?? kept ?? emptyTerrainFile();
      return new Blob([writeTerrainFile(withTerrainSection(base, id, section))], { type: "application/json" });
    });
    if (!saved) return;
    const tileset = translate(TILESETS[era].name);
    store.set(statusMessageAtom, t("Saved {file} for {tileset}: {pieces, plural, one {# piece} other {# pieces}}, {terrains, plural, one {# terrain} other {# terrains}}, {tables, plural, one {# borrow table} other {# borrow tables}}, {borders, plural, one {# drawn border} other {# drawn borders}}. Put it beside the mod's files, where mod.json goes.", {
      file: saved.fileName, tileset, pieces: section.pieces.length, terrains: section.terrains.length, tables: section.borrow.length, borders: section.borders.length,
    }));
  } catch (err) {
    store.set(pushToastAtom, { kind: "error", title: t("Could not save the terrain file"), detail: err instanceof Error ? err.message : String(err) });
  }
}
