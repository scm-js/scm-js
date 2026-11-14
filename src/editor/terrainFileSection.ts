/**
 * A terrain file's section for one tileset (`formats/mod/terrain.ts`), from what the editor knows of it: the pieces as
 * the Pieces view lists them (named sets first, then the cut pieces with their copies folded), the flat ground declared
 * for it, and the borrow tables scanned or given, as exact pairs, so the mod's users skip the scan. Pure.
 */
import type { BorrowTable } from "./borrowTable";
import type { DeclaredTerrain, PieceSection } from "./pieceList";
import { emptyTerrainSection, TERRAIN_LIMITS, type TerrainFileSection } from "../formats/mod/terrain";

export function terrainFileSection(table: string, sections: readonly PieceSection[], declared: readonly DeclaredTerrain[], borrow: readonly { source: string; table: BorrowTable }[]): TerrainFileSection {
  const out = emptyTerrainSection(table);
  const seen = new Set<string>();
  for (const s of sections) {
    for (const item of s.items) {
      const b = item.block;
      if (b.cols > TERRAIN_LIMITS.pieceSide || b.rows > TERRAIN_LIMITS.pieceSide || out.pieces.length >= TERRAIN_LIMITS.pieces) continue;
      const key = `${b.cols}x${b.rows}:${b.ids.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.pieces.push({ ...(item.name ? { name: item.name.slice(0, TERRAIN_LIMITS.nameLength) } : {}), ...(item.category ? { category: item.category.slice(0, TERRAIN_LIMITS.categoryLength) } : {}), cols: b.cols, rows: b.rows, tiles: [...b.ids] });
    }
  }
  for (const d of declared) {
    if (out.terrains.some((t) => t.group === d.group) || out.terrains.length >= TERRAIN_LIMITS.terrains) continue;
    out.terrains.push({ name: d.name.slice(0, TERRAIN_LIMITS.nameLength), group: d.group });
  }
  for (const { source, table: t } of borrow) {
    if (out.borrow.some((b) => b.source === source)) continue;
    const pairs: [number, number][] = [];
    for (const [s, hosts] of [...t.choices].sort((a, b) => a[0] - b[0])) for (const h of hosts) pairs.push([s, h]);
    const standIns = [...t.kinds].filter(([, k]) => k === "standIn").map(([s]) => s).sort((a, b) => a - b);
    if (pairs.length > 0) out.borrow.push({ source, pairs: pairs.slice(0, TERRAIN_LIMITS.pairs), ...(standIns.length ? { standIns } : {}) });
  }
  return out;
}
