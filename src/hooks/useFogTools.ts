import { useCallback, useMemo, useRef } from "react";
import { useSetAtom, useStore } from "jotai";
import { brushSizeAtom, fogModeAtom, fogPlayersAtom, fogViewPlayerAtom, symmetryAtom } from "../atoms/editorAtoms";
import { commitEditAtom, scenarioAtom, terrainRevisionAtom, type HistoryEntry } from "../atoms/documentAtoms";
import { statusMessageAtom } from "../atoms/uiAtoms";
import { brushRect, Stroke, type TileChange } from "../editor/terrain";
import {
  applyFogChanges, copyFog, ensureMask, fillFog, floodFog, fogPlayersAt, invertFog, paintFog, playerBit,
  type FogMode,
} from "../editor/fog";
import { mirrorIndices, mirrorRect } from "../editor/symmetry";
import type { Scenario } from "../formats/chk/scenario";

/** "P1, P2 and P5" for a player bit mask. */
export function fogPlayersLabel(players: number): string {
  const names: string[] = [];
  for (let p = 0; p < 8; p++) if (players & playerBit(p)) names.push(`P${p + 1}`);
  if (names.length === 0) return "no players";
  if (names.length === 8) return "all players";
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

const verb = (mode: FogMode) => (mode === "fog" ? "Fog" : "Clear fog");

/**
 * The fog of war brushes, bound to the editor's live state the same way as
 * `useTerrainTools`: pointer handlers read the store so they never go stale.
 */
export function useFogTools() {
  const store = useStore();
  const commit = useSetAtom(commitEditAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const bumpRevision = useSetAtom(terrainRevisionAtom);
  const setPlayers = useSetAtom(fogPlayersAtom);
  const setViewPlayer = useSetAtom(fogViewPlayerAtom);
  const stroke = useRef<Stroke | null>(null);
  /** The MASK section created for this stroke, if the map had none. */
  const createdMask = useRef<Uint8Array | null>(null);
  const strokeMode = useRef<FogMode>("fog");

  /** Wrap a whole-map operation as one undo step. */
  const commitFog = useCallback((scn: Scenario, label: string, edit: (scn: Scenario) => TileChange[]) => {
    const created = ensureMask(scn);
    const fog = edit(scn);
    applyFogChanges(scn, fog);
    if (fog.length === 0 && !created) {
      setStatus(`${label} — nothing to change`);
      return;
    }
    const entry: HistoryEntry = { label, changes: [], fog };
    if (created) entry.createdMask = created;
    commit(entry);
    setStatus(`${label} — ${fog.length} tile${fog.length === 1 ? "" : "s"}`);
  }, [commit, setStatus]);

  const paintAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    if (!scn || !s) return;
    // The footprint and, under Tools ▸ Symmetry…, its mirror images.
    const cells = mirrorRect(store.get(symmetryAtom), brushRect(x, y, store.get(brushSizeAtom), scn.width, scn.height), scn.width, scn.height);
    const changes = paintFog(scn, cells, store.get(fogPlayersAtom), strokeMode.current);
    if (changes.length === 0) return;
    applyFogChanges(scn, changes);
    s.add(changes);
    bumpRevision((r) => r + 1);
  }, [store, bumpRevision]);

  /** Start a stroke; `invert` (Shift) paints the opposite of the palette's mode. */
  const beginStroke = useCallback((x: number, y: number, invert = false) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    if (store.get(fogPlayersAtom) === 0) {
      setStatus("Select at least one player to paint fog for.");
      return;
    }
    const mode = store.get(fogModeAtom);
    strokeMode.current = invert ? (mode === "fog" ? "clear" : "fog") : mode;
    stroke.current = new Stroke();
    createdMask.current = ensureMask(scn);
    if (createdMask.current) bumpRevision((r) => r + 1);
    paintAt(x, y);
  }, [store, setStatus, bumpRevision, paintAt]);

  const endStroke = useCallback(() => {
    const scn = store.get(scenarioAtom);
    const s = stroke.current;
    const created = createdMask.current;
    stroke.current = null;
    createdMask.current = null;
    if (!s || !scn) return;
    const fog = s.finish();
    if (fog.length === 0 && !created) return;
    const label = `${verb(strokeMode.current)} for ${fogPlayersLabel(store.get(fogPlayersAtom))}`;
    const entry: HistoryEntry = { label, changes: [], fog };
    if (created) entry.createdMask = created;
    commit(entry);
    setStatus(`${label} — ${fog.length} tile${fog.length === 1 ? "" : "s"}`);
  }, [store, commit, setStatus]);

  const isStroking = useCallback(() => stroke.current !== null, []);

  /**
   * Fill the connected area under (x, y) — same fog state as that tile for the viewed
   * player — with the palette's mode for the selected players.
   */
  const fillAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const players = store.get(fogPlayersAtom);
    const mode = store.get(fogModeAtom);
    if (players === 0) { setStatus("Select at least one player to paint fog for."); return; }
    commitFog(scn, `${verb(mode)} area for ${fogPlayersLabel(players)}`, (s) => paintFog(s, mirrorIndices(store.get(symmetryAtom), floodFog(s, x, y, store.get(fogViewPlayerAtom)), s.width, s.height), players, mode));
  }, [store, commitFog, setStatus]);

  /** Fog or clear the whole map for the selected players. */
  const setAll = useCallback((mode: FogMode) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const players = store.get(fogPlayersAtom);
    if (players === 0) { setStatus("Select at least one player first."); return; }
    commitFog(scn, `${mode === "fog" ? "Fog everything" : "Clear all fog"} for ${fogPlayersLabel(players)}`, (s) => fillFog(s, players, mode));
  }, [store, commitFog, setStatus]);

  const invert = useCallback(() => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const players = store.get(fogPlayersAtom);
    if (players === 0) { setStatus("Select at least one player first."); return; }
    commitFog(scn, `Invert fog for ${fogPlayersLabel(players)}`, (s) => invertFog(s, players));
  }, [store, commitFog, setStatus]);

  /** Give the selected players player `from`'s fog. */
  const copyFrom = useCallback((from: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const targets = store.get(fogPlayersAtom) & ~playerBit(from);
    if (targets === 0) { setStatus("Select the players to copy to (other than the source)."); return; }
    commitFog(scn, `Copy P${from + 1} fog to ${fogPlayersLabel(targets)}`, (s) => copyFog(s, from, targets));
  }, [store, commitFog, setStatus]);

  /** Eyedropper: tick exactly the players that have fog on (x, y), and view the first of them. */
  const pickAt = useCallback((x: number, y: number) => {
    const scn = store.get(scenarioAtom);
    if (!scn) return;
    const players = fogPlayersAt(scn, x, y);
    setPlayers(players);
    for (let p = 0; p < 8; p++) if (players & playerBit(p)) { setViewPlayer(p); break; }
    setStatus(players === 0 ? `Tile ${x},${y} is explored for everyone` : `Tile ${x},${y} is fogged for ${fogPlayersLabel(players)}`);
  }, [store, setPlayers, setViewPlayer, setStatus]);

  return useMemo(
    () => ({ beginStroke, paintAt, endStroke, isStroking, fillAt, setAll, invert, copyFrom, pickAt }),
    [beginStroke, paintAt, endStroke, isStroking, fillAt, setAll, invert, copyFrom, pickAt],
  );
}
