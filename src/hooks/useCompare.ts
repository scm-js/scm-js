import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { compareBaseAtom, locationsRevisionAtom, scenarioAtom, terrainRevisionAtom, unitsRevisionAtom } from "../atoms/documentAtoms";
import { changedPlaces, diffChanges, type ChangedPlace, type DiffChanges } from "../editor/compare";
import { tilesetIndex } from "../formats/chk/scenario";

export interface Comparison {
  /** What the other map is called. */
  name: string;
  /** From the other map to the open one: a unit only the open map has is "added". */
  changes: DiffChanges;
  /** The ground that differs, joined into places, the largest first; empty when the tilesets differ. */
  places: ChangedPlace[];
  /**
   * Whether the two maps are of one tileset. Tile numbers of two tilesets mean nothing to
   * each other, so the ground is then not compared: `changes.tiles` and the tile counts
   * say nothing, and only units and locations are marked.
   */
  sameTileset: boolean;
}

/**
 * The open map held against the one it is compared with (`compareBaseAtom`), measured
 * again when the ground, the units or the locations of the open map change. Null while
 * `enabled` is false, without a map, or with nothing to compare with.
 */
export function useCompare(enabled: boolean): Comparison | null {
  const scenario = useAtomValue(scenarioAtom);
  const base = useAtomValue(compareBaseAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  const unitsRevision = useAtomValue(unitsRevisionAtom);
  const locationsRevision = useAtomValue(locationsRevisionAtom);
  return useMemo(() => {
    if (!enabled || !scenario || !base) return null;
    const changes = diffChanges(base.scenario, scenario);
    const sameTileset = tilesetIndex(base.scenario) === tilesetIndex(scenario);
    return { name: base.name, changes, places: sameTileset ? changedPlaces(changes) : [], sameTileset };
    // The scenario is mutated in place: the revisions are what say it changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scenario, base, terrainRevision, unitsRevision, locationsRevision]);
}
