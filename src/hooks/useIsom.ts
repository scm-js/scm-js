import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { isomRevisionAtom, scenarioAtom } from "../atoms/documentAtoms";
import { hasIsom, isomReport, type IsomCheck } from "../editor/isom";
import { useTileset } from "./useTileset";

export { STALE_ISOM_SHARE } from "../editor/isom";

export type IsomStatus =
  | { kind: "no-map" }
  | { kind: "loading" }
  | { kind: "no-tileset" }
  /** The map has no ISOM section (or a truncated one): the brush has nothing to work on. */
  | { kind: "missing" }
  | { kind: "ready"; check: IsomCheck; stale: boolean };

/**
 * Whether the open map can be painted isometrically, and how well its ISOM section
 * describes its tiles. Measured when a map opens (and after a lattice is rebuilt — the
 * Repair plugin's job, through `tx.rebuildIsom`), the way SCMDraft checks on load — not
 * after every stroke.
 */
export function useIsomStatus(): IsomStatus {
  const scenario = useAtomValue(scenarioAtom);
  const { loaded, loading } = useTileset();
  const revision = useAtomValue(isomRevisionAtom);
  return useMemo<IsomStatus>(() => {
    void revision;
    if (!scenario) return { kind: "no-map" };
    if (!loaded) return { kind: loading ? "loading" : "no-tileset" };
    if (!hasIsom(scenario)) return { kind: "missing" };
    const report = isomReport(scenario, loaded.tileset)!;
    return { kind: "ready", check: { rects: report.rects, mismatched: report.mismatched }, stale: report.stale };
  }, [scenario, loaded, loading, revision]);
}
