import { useCallback, useMemo } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { commitEditAtom, isomRevisionAtom, scenarioAtom, tilesetFileNameAtom } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import { applyIsomChanges, checkIsom, hasIsom, rebuildIsomFromTiles, type IsomCheck } from "../editor/isom";
import type { TileChange } from "../editor/terrain";
import { markDirty } from "../formats/chk/scenario";
import { peekTileset } from "../formats/tileset/load";
import { useTileset } from "./useTileset";

/** Above this share of rects disagreeing with their tiles, the ISOM is reported as stale. */
export const STALE_ISOM_SHARE = 0.02;

export type IsomStatus =
  | { kind: "no-map" }
  | { kind: "loading" }
  | { kind: "no-tileset" }
  /** The map has no ISOM section (or a truncated one): the brush has nothing to work on. */
  | { kind: "missing" }
  | { kind: "ready"; check: IsomCheck; stale: boolean };

/**
 * Whether the open map can be painted isometrically, and how well its ISOM section
 * describes its tiles. Measured when a map opens (and after Rebuild ISOM), the way
 * SCMDraft checks on load — not after every stroke.
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
    const check = checkIsom(scenario, loaded.tileset);
    return { kind: "ready", check, stale: check.rects > 0 && check.mismatched / check.rects > STALE_ISOM_SHARE };
  }, [scenario, loaded, loading, revision]);
}

/**
 * Reconstruct the ISOM section from the tiles — for maps that arrived without one, or
 * whose ISOM no longer matches after Rect/Tile edits. One undoable step.
 */
export function useIsomRebuild(): () => void {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bump = useSetAtom(isomRevisionAtom);

  return useCallback(() => {
    const scn = store.get(scenarioAtom);
    const loaded = peekTileset(store.get(tilesetFileNameAtom));
    if (!scn) return;
    if (!loaded) {
      setStatus("Rebuilding ISOM needs the tileset graphics — run scripts/extract-tilesets.mjs.");
      return;
    }
    const { isom, diamonds, unresolved } = rebuildIsomFromTiles(scn, loaded.tileset);
    const guessed = unresolved > 0 ? `, ${unresolved} under doodads or off the edge guessed` : "";

    if (hasIsom(scn) && scn.isom.length === isom.length) {
      const changes: TileChange[] = [];
      for (let i = 0; i < isom.length; i++) if (scn.isom[i] !== isom[i]) changes.push({ at: i, before: scn.isom[i], after: isom[i] });
      if (changes.length === 0) {
        setStatus("ISOM already matches the tiles — nothing to rebuild.");
        return;
      }
      applyIsomChanges(scn, changes);
      commit({ label: "Rebuild ISOM", changes: [], isom: changes });
    } else {
      scn.isom = isom;
      markDirty(scn, "ISOM");
      commit({ label: "Rebuild ISOM", changes: [], createdIsom: isom });
    }
    bump((r) => r + 1);
    setStatus(`Rebuilt ISOM from the tiles — ${diamonds} diamonds${guessed}. The isometric brush is ready.`);
  }, [store, commit, setStatus, bump]);
}
