/**
 * A data set made at test time from the game's own tables: units.dat grown past the game's
 * 228 types, the way DatExtend grows it (the expanded `.dat` layout, or GPTP's `.datex`),
 * with names for the new types in `rez\unitnames.tbl`. Nothing of the game's is committed:
 * the inputs are the person's own extracted files, and the outputs live in memory or in the
 * OS temp folder.
 */
import { datRow, decodeDat, emptyDat, encodeDat, setDatRow, type DatFile, type DatLayout } from "../../src/formats/dat/table";
import type { DatTableName } from "../../src/formats/dat/schema";
import { encodeTblFile } from "../../src/formats/dat/tblFile";

/** `file` widened to `count` entries in `layout`: its own rows kept, the new ones copies of `fill(id)`'s row (or zeros). */
export function growDat(file: DatFile, count: number, layout: DatLayout = "expanded", fill?: (id: number) => number): DatFile {
  const grown = emptyDat(file.table as DatTableName, count, layout);
  for (let id = 0; id < count; id++) {
    const from = id < file.count ? id : fill?.(id);
    if (from === undefined) continue;
    // A column the game's layout stores only for a range of ids (the voices, 0–105) reads 0 elsewhere; copy what is there.
    setDatRow(grown, id, datRow(file, from));
  }
  return grown;
}

/** The new unit types of the made data set: 228–235 a Marine each, 236–239 a Supply Depot each. */
export const MADE_UNITS = 240;
export const madeFill = (id: number) => (id < 236 ? 0 : 109);
export const madeName = (id: number) => (id < 236 ? `Test Trooper ${id}` : `Test Depot ${id}`);

/** units.dat of 240 types in DatExtend's expanded layout (or GPTP's `.datex` with `layout`). */
export function madeUnitsDat(gameUnits: Uint8Array, layout: DatLayout = "expanded"): Uint8Array {
  return encodeDat(growDat(decodeDat("units", gameUnits), MADE_UNITS, layout, madeFill), layout);
}

/** `rez\unitnames.tbl` for it: entry N names type N (GPTP's convention), the game's names below 228 left as `*`. */
export function madeUnitNames(): Uint8Array {
  const strings = Array.from({ length: MADE_UNITS }, (_, id) => (id < 228 ? "*\0*\0*" : `${madeName(id)}\0*\0Ground Units`));
  return encodeTblFile({ strings, encoding: "windows-1252" });
}
