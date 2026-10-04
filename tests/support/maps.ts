/**
 * The map files the suites open: the ones committed in `tests/maps/` (ours, made by
 * `testMaps.ts`, always there) and whatever is in `fixtures/maps/` (Blizzard's, on a
 * machine that has them and never in the repository).
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const TEST_MAPS_DIR = join(import.meta.dirname, "..", "maps");
export const FIXTURE_MAPS_DIR = join(import.meta.dirname, "..", "..", "fixtures", "maps");

export interface MapFile {
  /** File name, unique across the two folders. */
  name: string;
  path: string;
  /** One of `tests/maps/`, as opposed to a map StarEdit wrote. */
  generated: boolean;
}

const MAP_FILE = /\.(scx|scm)$/i;

function list(dir: string, generated: boolean): MapFile[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => MAP_FILE.test(f)).sort().map((name) => ({ name, path: join(dir, name), generated }));
}

/** The committed maps. */
export const testMapFiles = (): MapFile[] => list(TEST_MAPS_DIR, true);
/** Blizzard's maps, where present. */
export const fixtureMapFiles = (): MapFile[] => list(FIXTURE_MAPS_DIR, false);
/** Both: a suite that holds for any map runs over these, so it runs with or without game data. */
export const mapFiles = (): MapFile[] => [...testMapFiles(), ...fixtureMapFiles()];

/** One committed map by name. */
export const testMap = (name: string): string => join(TEST_MAPS_DIR, name);
