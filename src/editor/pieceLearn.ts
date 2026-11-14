/**
 * Learning pieces from a folder of maps: every map is opened, and the tiles of one that the
 * data set in use has all of are counted against its tileset's sheet (`pieces.ts`). A map that
 * does not open, or lays a tile past the data set's tables (made for another mod), is skipped
 * and counted. Pure apart from what it is handed: the files, the tables and the pause between
 * maps, so a test can run it over files on disk.
 */
import { lackedGroups } from "../data/remasteredTiles";
import type { Cv5Group } from "../formats/tileset/decode";
import { openMapBytes } from "./mapFile";
import { cutPieces, emptyEvidence, gatherEvidence, type PieceEvidence } from "./pieces";

/** A map to read: its name for the report and its bytes when asked. */
export interface LearnFile {
  name: string;
  bytes(): Promise<Uint8Array>;
}

export type SkipReason = "unreadable" | "notOurs" | "noTiles";

export interface LearnResult {
  /** Maps counted. */
  read: number;
  /** The tables counted against, by ERA index: what the evidence is about (`tableHash`). */
  tables: Map<number, readonly Cv5Group[]>;
  /** Maps left out, and why. */
  skipped: { name: string; reason: SkipReason }[];
  /** The evidence by ERA index (0–7), for every tileset at least one map was counted on. */
  evidence: Map<number, PieceEvidence>;
}

export interface LearnDeps {
  /** A tileset's CV5 groups as the data set in use has them, or null when it has none. */
  groups(era: number): Promise<readonly Cv5Group[] | null>;
  /** Told after each map: how many are done of how many. */
  progress?(done: number, total: number): void;
  /** Awaited between maps so the page can draw; a test passes nothing. */
  pause?(): Promise<void>;
  /** True to stop early: what was read so far is kept. */
  stopped?(): boolean;
}

/** Whether a file name is a map the editor opens. */
export const isMapName = (name: string) => /\.sc[mx]$/i.test(name);

export async function learnFromMaps(files: readonly LearnFile[], deps: LearnDeps): Promise<LearnResult> {
  const result: LearnResult = { read: 0, tables: new Map(), skipped: [], evidence: new Map() };
  const tables = new Map<number, readonly Cv5Group[] | null>();
  let done = 0;
  for (const file of files) {
    if (deps.stopped?.()) break;
    try {
      const { scenario } = await openMapBytes(await file.bytes(), file.name);
      const era = scenario.era & 7;
      if (!tables.has(era)) tables.set(era, await deps.groups(era));
      const groups = tables.get(era);
      if (!scenario.tiles?.length || !scenario.width || !scenario.height) result.skipped.push({ name: file.name, reason: "noTiles" });
      else if (!groups || lackedGroups(scenario.tiles, era, groups.length) !== null) result.skipped.push({ name: file.name, reason: "notOurs" });
      else {
        let into = result.evidence.get(era);
        if (!into) result.evidence.set(era, (into = emptyEvidence()));
        result.tables.set(era, groups);
        gatherEvidence(into, scenario.tiles, scenario.width, scenario.height, { groups: groups as Cv5Group[] });
        result.read++;
      }
    } catch {
      result.skipped.push({ name: file.name, reason: "unreadable" });
    }
    done++;
    deps.progress?.(done, files.length);
    if (deps.pause) await deps.pause();
  }
  return result;
}

/** How many pieces each learned tileset cuts into, by ERA index. */
export function piecesPerTileset(result: LearnResult): Map<number, number> {
  return new Map([...result.evidence].map(([era, e]) => [era, cutPieces(e).length]));
}

const hashes = new WeakMap<readonly Cv5Group[], string>();

/**
 * A tileset's table as a short key: a hash of its CV5 records, word for word as the file holds
 * them (the decoded groups keep all 26 words of a record). Evidence about pieces is evidence
 * about one table's tile ids, so it is kept under this: the same table reached through any data
 * set shares it, and a table that changed starts afresh.
 */
export function tableHash(groups: readonly Cv5Group[]): string {
  const was = hashes.get(groups);
  if (was) return was;
  let a = 0x811c9dc5, b = 0x9e3779b9 ^ groups.length;
  const word = (v: number) => {
    a = Math.imul(a ^ v, 0x01000193);
    b = Math.imul(b ^ (v + 0x9e37), 0x85ebca6b) ^ (b >>> 13);
  };
  for (const g of groups) {
    word(g.index);
    word(g.flags ?? 0);
    for (const e of [g.edges, g.stack]) { word(e?.left ?? 0); word(e?.top ?? 0); word(e?.right ?? 0); word(e?.bottom ?? 0); }
    for (let m = 0; m < 16; m++) word(g.megatiles[m] ?? 0);
  }
  const out = (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
  hashes.set(groups, out);
  return out;
}
