import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { scenarioAtom, terrainRevisionAtom, unitsRevisionAtom } from "../atoms/documentAtoms";
import { symmetryAtom } from "../atoms/editorAtoms";
import { fairnessReport, likelySymmetry, symmetryShares, type FairnessReport } from "../editor/fairness";
import type { SymmetryMode } from "../editor/symmetry";
import type { Tileset } from "../formats/tileset/decode";

export interface Fairness {
  /** How alike the map is to its image under each mode that fits its shape, 0..1. */
  shares: Partial<Record<SymmetryMode, number>>;
  /** The mode the map looks to have been made with, or null when it is alike under none. */
  likely: SymmetryMode | null;
  /** The mode the report is for: the one asked for, else the symmetry tool's, else `likely`. */
  mode: SymmetryMode | null;
  report: FairnessReport | null;
}

/**
 * The open map against its own image (editor/fairness.ts), measured again when its ground
 * or its units change. Null while `enabled` is false, without a map or without the
 * tileset's flags. `mode` asks for one mode; omitted or "none", the symmetry tool's mode
 * is used, and when that is off, the one the map is most alike under.
 */
export function useFairness(enabled: boolean, tileset: Tileset | null, mode?: SymmetryMode): Fairness | null {
  const scenario = useAtomValue(scenarioAtom);
  const terrainRevision = useAtomValue(terrainRevisionAtom);
  const unitsRevision = useAtomValue(unitsRevisionAtom);
  const active = useAtomValue(symmetryAtom);
  // Two steps, so that asking about another mode does not measure every mode again.
  const all = useMemo(() => {
    if (!enabled || !scenario || !tileset) return null;
    const shares = symmetryShares(scenario, tileset);
    return { shares, likely: likelySymmetry(shares) };
    // The scenario is mutated in place: the revision is what says its ground changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scenario, tileset, terrainRevision]);
  return useMemo(() => {
    if (!all || !scenario || !tileset) return null;
    const judged = mode && mode !== "none" ? mode : active !== "none" ? active : all.likely;
    return { ...all, mode: judged, report: judged ? fairnessReport(scenario, tileset, judged) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, scenario, tileset, mode, active, terrainRevision, unitsRevision]);
}
