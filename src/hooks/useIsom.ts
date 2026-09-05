import { useMemo } from "react";
import { useAtomValue } from "jotai";
import { isomRevisionAtom, scenarioAtom } from "../atoms/documentAtoms";
import { hasIsom, isomReport, type IsomStatus } from "../editor/isom";
import { useTileset } from "./useTileset";

export { STALE_ISOM_SHARE } from "../editor/isom";

export type { IsomStatus };

/**
 * Whether the open map can be painted isometrically, how well its ISOM section describes
 * its tiles, and what a rebuild would do about it. Measured when a map opens (and after a
 * lattice is rebuilt — the Repair plugin's job, through `tx.rebuildIsom`), the way SCMDraft
 * checks on load — not after every stroke, since it runs a rebuild of its own to answer
 * whether one is worth offering.
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
    return { kind: "ready", report: isomReport(scenario, loaded.tileset)! };
  }, [scenario, loaded, loading, revision]);
}
