/**
 * The Isometric tab's second list: terrains of the game's other tilesets that the tileset in
 * front holds copies of, laid by their own isometric brush (editor/borrow.ts). The scan is asked
 * for once per tileset's files (a button that says what it does), then remembered.
 */
import { useEffect, useState } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { activeTerrainAtom } from "../../atoms/editorAtoms";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { borrowHostsAtom, borrowScanAtom, providedBorrowAtom } from "../../atoms/borrowAtoms";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { TILESETS, terrainName } from "../../data/tilesets";
import { drawnBordersAtom, learnedBordersAtom, providedBordersAtom } from "../../atoms/borderAtoms";
import { bordersKnown, prepareBorders } from "../../services/borders";
import { peekBorrowContext } from "../../services/borrow";
import { takeBackId } from "../../editor/borrow";
import { tilesetIndex } from "../../formats/chk/scenario";
import { borrowContext, drawsFromGame, forgetBorrowed, hostKeyOf, isStopped, readKnownBorrowed, refreshProvided, scanBorrowed, stopBorrowScan } from "../../services/borrow";
import type { LoadedTileset } from "../../formats/tileset/load";
import { Button, Check } from "../ui";
import { isDataSetKey } from "../../editor/pieceList";
import { TileThumb } from "./TileBrowser";
import { t, translate } from "../../i18n";

export function BorrowedTerrains({ loaded }: { loaded: LoadedTileset | null }) {
  const store = useStore();
  const scn = useAtomValue(scenarioAtom);
  const source = useAtomValue(gameDataSourceAtom);
  const hosts = useAtomValue(borrowHostsAtom);
  const scan = useAtomValue(borrowScanAtom);
  const provided = useAtomValue(providedBorrowAtom);
  const [active, setActive] = useAtom(activeTerrainAtom);
  const [drawn, setDrawn] = useAtom(drawnBordersAtom);
  const learned = useAtomValue(learnedBordersAtom);
  const providedBorders = useAtomValue(providedBordersAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const toast = useSetAtom(pushToastAtom);
  const era = scn ? tilesetIndex(scn) : -1;
  const host = loaded?.tileset ?? null;
  const fromGame = drawsFromGame(source);
  const key = host && era >= 0 ? hostKeyOf(era, host) : null;
  const info = key ? hosts.get(key) ?? null : null;

  // What was found before for these files, and what the plugins' tables offer.
  useEffect(() => {
    if (!host || era < 0) return;
    void readKnownBorrowed(store, era, host).then(() => refreshProvided(store, era, host));
  }, [store, host, era, provided]);
  // Drawn borders: the known sources' tables and what was learned for them, once the sources are known; and the
  // sources' contexts read again where they are not at hand (the hovers name the pairs from them).
  const sourcesKey = info?.sources.map((s) => `${s.sourceEra}:${s.sourceHash}`).join(",") ?? "";
  const [, contextsRead] = useState(0);
  useEffect(() => {
    if (!host || era < 0 || !sourcesKey) return;
    let live = true;
    void prepareBorders(store, era, host, undefined, true).then(() => Promise.all((info?.sources ?? []).map((s) => borrowContext(store, era, host, s.sourceEra)))).then(() => { if (live) contextsRead((n) => n + 1); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `info` is re-read per render; `sourcesKey` is its identity
  }, [store, host, era, sourcesKey, provided]);

  if (!host || era < 0 || (fromGame && !info?.sources.some((s) => s.provided))) return null;

  const run = async (again: boolean) => {
    const started = performance.now();
    try {
      if (again) await forgetBorrowed(store, era, host);
      const found = await scanBorrowed(store, era, host);
      const n = found.sources.reduce((sum, s) => sum + s.terrains.length, 0);
      const seconds = ((performance.now() - started) / 1000).toFixed(1);
      const title = n > 0 ? t("{n, plural, one {# terrain} other {# terrains}} from other tilesets can be painted here", { n }) : t("No other tileset's terrain is whole in this tileset");
      setStatus(t("{title} ({seconds} s)", { title, seconds }));
      toast({ kind: n > 0 ? "ok" : "info", title });
    } catch (err) {
      if (isStopped(err)) { setStatus(t("Stopped looking through the other tilesets; what was found so far is kept for next time")); return; }
      toast({ kind: "error", title: t("Could not look through the other tilesets"), detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const scanning = scan && scan.hostKey === key ? scan : null;
  void learned; void providedBorders; // (read so the hovers follow a learn and a provided table)
  /** The host terrains a borrowed terrain has drawn borders against. */
  const known = new Map<number, Map<number, { ground: number; from: string }[]>>();
  for (const s of info?.sources ?? []) {
    const ctx = peekBorrowContext(era, host, s.sourceEra);
    if (ctx) known.set(s.sourceEra, bordersKnown(store, era, host, ctx));
  }
  const anyBorders = [...known.values()].some((m) => m.size > 0);
  const sources = info?.sources.filter((s) => s.terrains.length > 0) ?? [];
  const pick = (id: number, sourceEra: number) => {
    setActive(id);
    // The source's files and the table are read now, so the first stroke does not wait.
    void borrowContext(store, era, host, sourceEra);
  };

  return (
    <div className="borrowed-terrains">
      <div className="borrowed-head">{t("From other tilesets")}</div>
      {!info?.scanned && !scanning && (
        <div className="hint" style={{ padding: "6px 10px", display: "grid", gap: 6, justifyItems: "start" }}>
          <span>{t("This tileset may hold copies of other tilesets' ground. Looking through the game's other seven tilesets finds the terrains whose every tile has a copy here, so the isometric brush can lay them with their own cliffs and edges. It runs in the background while you keep working, once; the result is kept.")}</span>
          <Button size="sm" onClick={() => void run(false)}>{t("Find terrain from other tilesets")}</Button>
        </div>
      )}
      {scanning && (
        <div className="hint" style={{ padding: "6px 10px", display: "grid", gap: 4 }}>
          <span>{t("Looking through {tileset}…", { tileset: translate(TILESETS[scanning.sourceEra].name) })}</span>
          <span className="progress-track"><i style={{ width: `${Math.round(100 * scanning.share)}%` }} /></span>
          <span><Button size="sm" variant="ghost" onClick={() => stopBorrowScan()}>{t("Stop")}</Button></span>
        </div>
      )}
      {info?.scanned && !scanning && sources.length === 0 && (
        <div className="hint" style={{ padding: "6px 10px" }}>{t("No other tileset's terrain is whole in this tileset.")}</div>
      )}
      {sources.length > 0 && (
        <div style={{ padding: "2px 10px" }} title={anyBorders
          ? t("Where borrowed ground meets this tileset's own, lay the border pieces this tileset draws for it, learned from maps or named by the mod or a plugin. Off: the two simply touch.")
          : t("No drawn border is known for these terrains yet. Learn them from maps that use them (Tile palette ▸ Pieces ▸ Learn from Maps…), or add a mod whose terrain file names them.")}>
          <Check label={t("Drawn borders")} checked={drawn && anyBorders} disabled={!anyBorders} onChange={(e) => setDrawn(e.currentTarget.checked)} />
        </div>
      )}
      {sources.map((s) => (
        <div key={s.sourceEra}>
          <div className="borrowed-source">{t("From {tileset}", { tileset: translate(TILESETS[s.sourceEra].name) })}</div>
          <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
            {s.terrains.map((b) => (
              <div
                key={b.id}
                className={`item ${active === b.id ? "selected" : ""}`}
                onClick={() => pick(b.id, b.sourceEra)}
                title={hoverText(TILESETS[b.sourceEra].name, b.standIns, s.provided === undefined ? null : isDataSetKey(s.provided) ? "dataset" : "plugin", source?.profile.name ?? "", (known.get(s.sourceEra)?.get(b.index) ?? []).map((k) => translate(terrainName(TILESETS[era], k.ground))))}
              >
                <TileThumb loaded={loaded} id={b.tile} size={18} className="swatch" />
                <span>{translate(b.name)}</span>
              </div>
            ))}
            <div
              className={`item ${active === takeBackId(s.sourceEra) ? "selected" : ""}`}
              onClick={() => pick(takeBackId(s.sourceEra), s.sourceEra)}
              title={t("Paint over ground borrowed from {tileset} to give it back to this tileset: each cell gets the tile it had before, and the border around what is left is laid again.", { tileset: translate(TILESETS[s.sourceEra].name) })}
            >
              <span className="swatch" style={{ width: 18, height: 18 }} />
              <span>{t("Take back")}</span>
            </div>
          </div>
        </div>
      ))}
      {info?.scanned && !scanning && !fromGame && (
        <div className="borrowed-again">
          <Button size="sm" variant="ghost" title={t("Look through the other tilesets again, as if for the first time")} onClick={() => void run(true)}>{t("Look again")}</Button>
        </div>
      )}
    </div>
  );
}

function hoverText(source: string, standIns: number, provided: "plugin" | "dataset" | null, dataSet: string, borders: readonly string[]): string {
  const lines = [
    provided === "dataset"
      ? t("Laid by {tileset}'s isometric brush, each tile replaced with the tile {name}'s terrain file names for it.", { tileset: translate(source), name: dataSet })
      : provided === "plugin"
      ? t("Laid by {tileset}'s isometric brush, each tile replaced with the tile a plugin named for it.", { tileset: translate(source) })
      : t("Laid by {tileset}'s isometric brush, each tile replaced with this tileset's copy of its picture.", { tileset: translate(source) }),
    t("It walks and builds as this tileset's copies say, which can differ from {tileset}'s own: View ▸ Walkability (from the Walkability plugin), the Elevation Overlay and the Buildability Overlay show where.", { tileset: translate(source) }),
    borders.length > 0
      ? t("Drawn borders are known against {list}: with Drawn borders on, the border pieces this tileset draws are laid where it meets them.", { list: borders.join(", ") })
      : t("No drawn border is known for it: where it meets this map's own ground nothing joins them. Learn from Maps… in the Tile palette's Pieces finds the borders maps draw; Heal softens the seams."),
  ];
  if (standIns > 0) lines.push(t("{n, plural, one {# tile has} other {# tiles have}} no copy here and lay the nearest picture this tileset has.", { n: standIns }));
  return lines.join("\n");
}
