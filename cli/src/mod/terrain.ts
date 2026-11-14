/**
 * A mod's terrain file (`terrain.json`, `src/formats/mod/terrain.ts`) on the command line: read beside the mod's
 * `mod.json` (`readSourceTerrain`), its counts for `mod info`, and what `mod check` says of it — rows the reader
 * dropped, and a tileset section whose `table` is not the hash of the mod's own tile table (or the game's, where the
 * mod has none) for that tileset.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ModFiles } from "@scm-js/mod";
import { readTerrainFile, sectionAgainstTable, TERRAIN_FILE, terrainFileCounts, terrainFileOf, type TerrainDrop, type TerrainDropReason, type TerrainFile } from "../../../src/formats/mod/terrain";
import { decodeCv5 } from "../../../src/formats/tileset/decode";
import { tableHash } from "../../../src/editor/pieceLearn";
import type { GameFiles } from "../gamefiles";
import { t } from "../i18n";

export interface SourceTerrain {
  /** Where it was read, as the mod's tree names it. */
  path: string;
  text: string;
  file: TerrainFile;
  dropped: TerrainDrop[];
}

const read = (path: string, text: string): SourceTerrain => ({ path, text, ...readTerrainFile(text) });

/** The terrain file of a mod's tree (by `mod.json`'s rule: in the folder named or one down), or null. */
export async function readSourceTerrain(tree: ModFiles, top: string): Promise<SourceTerrain | null> {
  const at = terrainFileOf((await tree.list()).map((e) => e.path), top);
  if (!at) return null;
  // (shown as a path in the mod: a folder's tree starts with the folder's own name)
  const shown = top && at.startsWith(`${top}/`) ? at.slice(top.length + 1) : at;
  try { return read(shown, new TextDecoder().decode(await tree.read(at))); } catch { return null; }
}

/** A mod folder's own `terrain.json` (one scmjs unpacked), or null. */
export async function folderTerrain(dir: string): Promise<SourceTerrain | null> {
  try { return read(TERRAIN_FILE, await readFile(join(dir, TERRAIN_FILE), "utf8")); } catch { return null; }
}

/** What `mod info` shows: per tileset, the terrains, pieces and borrow tables (pairs each). */
export function terrainInfo(terrain: SourceTerrain | null) {
  return terrain ? { path: terrain.path, tilesets: terrainFileCounts(terrain.file), dropped: terrain.dropped.length } : null;
}

const WHY: Record<TerrainDropReason, () => string> = {
  "not-json": () => t("not JSON"),
  "not-an-object": () => t("not an object"),
  format: () => t("a later format than this scmjs reads: nothing in the file is used"),
  tileset: () => t("not one of the game's eight tilesets"),
  table: () => t("no table hash: the section is not used"),
  "not-a-list": () => t("not a list"),
  "too-many": () => t("more rows than the editor takes: the rest are left out"),
  name: () => t("a name missing, empty or too long"),
  group: () => t("not the even group of a pair of flat ground with pictures"),
  size: () => t("cols or rows not whole numbers from 1 to 64"),
  tiles: () => t("tiles not cols × rows tile ids (or -1), or a tile the table has no picture for"),
  empty: () => t("nothing in it"),
  source: () => t("not another of the game's tilesets"),
  pair: () => t("not a [source tile, tile] pair of tile ids, or a tile the table has no picture for"),
  duplicate: () => t("given twice: the first stands"),
};

export interface TerrainFinding { level: "warning"; rule: string; where: string; why: string }

/**
 * `mod check`'s findings for the terrain file: each row the reader dropped, each section made for another table than
 * the one the mod's users will have (the mod's own `tileset\<name>.cv5`, else the game copy's), and in a section that
 * fits, each row the table has no pictures for. A section whose table could not be read is a note, not a finding.
 */
export async function terrainFindings(terrain: SourceTerrain | null, modRead: (name: string) => Promise<Uint8Array | null>, base: GameFiles | null): Promise<{ findings: TerrainFinding[]; notes: string[] }> {
  const findings: TerrainFinding[] = [], notes: string[] = [];
  if (!terrain) return { findings, notes };
  const where = (at: string) => `${terrain.path}${at ? `: ${at}` : ""}`;
  for (const d of terrain.dropped) findings.push({ level: "warning", rule: "terrain-file", where: where(d.at), why: WHY[d.reason]() });
  for (const [id, section] of Object.entries(terrain.file.tilesets)) {
    const member = `tileset\\${id}.cv5`;
    const bytes = (await modRead(member)) ?? (base ? await base.read(member) : null);
    if (!bytes) { notes.push(t("{file}: the {tileset} section's table was not checked: neither the mod nor a copy of the game has {member}.", { file: terrain.path, tileset: id, member })); continue; }
    const groups = decodeCv5(bytes);
    if (tableHash(groups) !== section.table) {
      findings.push({ level: "warning", rule: "terrain-table", where: where(`tilesets.${id}.table`), why: t("made for another version of the {tileset} tile table than this mod's: the editor does not use the section (save the terrain file again from the editor)", { tileset: id }) });
      continue;
    }
    // Pictures: a tile of a group with a megatile in its slot (the megatile table itself is not read here).
    const hasPicture = (tile: number) => (groups[tile >> 4]?.megatiles[tile & 15] ?? 0) !== 0;
    for (const d of sectionAgainstTable(section, id, { groups: groups.length, hasPicture })) findings.push({ level: "warning", rule: "terrain-file", where: where(d.at), why: WHY[d.reason]() });
  }
  return { findings, notes };
}
