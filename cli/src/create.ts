/**
 * `scmjs map new ridge.scx`: a map from nothing, the way File ▸ New makes one — flat ground of the tileset's base
 * terrain, eight open slots, and, with `--players`, that many start locations laid out as Tools ▸ Auto-place would
 * and the other slots closed, so the map passes Check Map as it is. Without the game's graphics the terrain is the
 * base-ground ids, which is what the editor writes too when it has no game data; the editor fills the tiles' looks
 * in when it next saves. The variation of the fill is seeded, so the same arguments give the same bytes.
 */
import { writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { createScenario } from "../../src/formats/chk/create";
import { MAP_VERSIONS, mapVersionOf, setMapVersion, type MapVersion } from "../../src/formats/chk/scenario";
import { PlayerType } from "../../src/formats/chk/sections/players";
import { applyPlayerSettings, readPlayerSettings } from "../../src/editor/settings";
import { DEFAULT_START_PLACEMENT, placeStartLocations, type StartLayout } from "../../src/editor/startLocations";
import { DEFAULT_PLACEMENT } from "../../src/editor/placement";
import { baseTerrain, flatTerrain } from "../../src/formats/tileset/terrain";
import { MAP_SIZES, TILESETS, type TilesetId } from "../../src/data/tilesets";
import { writeMapBytes } from "../../src/editor/mapFile";
import { defaultSaveOptions, formatOf, type MapFormat } from "../../src/editor/save";
import { CliError } from "./ui";

export const NEW_VERSIONS = ["broodwar", "remastered"] as const satisfies readonly MapVersion[];
export type NewMapVersion = (typeof NEW_VERSIONS)[number];
export const LAYOUTS = ["ring", "corners"] as const satisfies readonly StartLayout[];

export interface NewMapOptions {
  width: number;
  height: number;
  tileset: TilesetId;
  name: string;
  description: string;
  version: NewMapVersion;
  /** Start locations for players 1..N, the other slots closed; none when 0. */
  players: number;
  layout: StartLayout;
}

/** `--size 128x96` (or `128`, square) as width and height, each one of the editor's sizes. */
export function parseSize(spec: string): { width: number; height: number } {
  const m = /^(\d+)(?:\s*[x×*]\s*(\d+))?$/i.exec(spec.trim());
  const sizes = MAP_SIZES as readonly number[];
  if (!m) throw new CliError(`--size takes WIDTHxHEIGHT, such as 128x96, not "${spec}"`, `Each is one of ${sizes.join(", ")}.`, 2);
  const width = Number(m[1]), height = Number(m[2] ?? m[1]);
  for (const n of [width, height]) if (!sizes.includes(n)) throw new CliError(`${n} is not a map size`, `A side is one of ${sizes.join(", ")}.`, 2);
  return { width, height };
}

export function parseTileset(spec: string): TilesetId {
  const id = spec.trim().toLowerCase().replace(/[\s_-]+/g, "");
  const found = TILESETS.find((t) => t.id === id || t.name.toLowerCase().replace(/[\s_-]+/g, "") === id);
  if (!found) throw new CliError(`"${spec}" is not a tileset`, `One of ${TILESETS.map((t) => t.id).join(", ")}.`, 2);
  return found.id;
}

/** A small seeded generator, so the fill's variation is the same for the same arguments. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface NewMapResult { path: string; bytes: number; starts: number; width: number; height: number; tileset: string; version: string }

/** The scenario the options describe. */
export function newScenario(o: NewMapOptions) {
  const era = Math.max(0, TILESETS.findIndex((t) => t.id === o.tileset));
  const info = TILESETS[era];
  // No tileset here, so the fill is the base ground (`DIRT`, the editor's own choice without game data); a terrain
  // by id would need the tileset's groups to name its tiles, which is why there is no --terrain.
  const { tiles, isom } = flatTerrain(o.width, o.height, baseTerrain(null), null, seeded(1), era);
  const scenario = createScenario({ width: o.width, height: o.height, era, name: o.name, description: o.description, tiles, isom });
  if (mapVersionOf(scenario.fileVersion) !== o.version) setMapVersion(scenario, o.version);
  let starts = 0;
  if (o.players > 0) {
    const players = Math.min(8, Math.floor(o.players));
    const r = placeStartLocations(scenario, null, null, { ...DEFAULT_START_PLACEMENT, players, layout: o.layout, replace: false, placement: DEFAULT_PLACEMENT });
    starts = r.placed.filter((p) => p !== null).length;
    const settings = readPlayerSettings(scenario);
    for (let slot = players; slot < 8; slot++) settings.types[slot] = PlayerType.Inactive;
    applyPlayerSettings(scenario, settings);
  }
  return { scenario, starts, era, info };
}

/** Writes the map; a `.chk` is the bare scenario, anything else an archive compressed as the editor saves a new map. */
export async function writeNewMap(path: string, o: NewMapOptions): Promise<NewMapResult> {
  const { scenario, starts, info } = newScenario(o);
  const format = formatOf(path) ?? (MAP_VERSIONS[o.version].extension as MapFormat);
  const { format: _f, ...options } = defaultSaveOptions(scenario, null, path);
  const bytes = await writeMapBytes(scenario, { format, options });
  try {
    await writeFile(path, bytes);
  } catch (e) {
    throw new CliError(`${path} could not be written (${(e as NodeJS.ErrnoException).code ?? e})`);
  }
  return { path, bytes: bytes.length, starts, width: o.width, height: o.height, tileset: info.name, version: MAP_VERSIONS[o.version].label };
}

/** The map's name when none is given: the file's, without its extension. */
export const nameFromFile = (path: string) => basename(path, extname(path)) || "Untitled Scenario";
