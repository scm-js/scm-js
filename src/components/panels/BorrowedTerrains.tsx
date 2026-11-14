/**
 * The Isometric tab's second list: terrains of the game's other tilesets that the tileset in
 * front holds copies of, laid by their own isometric brush (editor/borrow.ts). The scan is asked
 * for once per tileset's files (a button that says what it does), then remembered.
 */
import { useEffect } from "react";
import { useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { activeTerrainAtom } from "../../atoms/editorAtoms";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { borrowHostsAtom, borrowScanAtom, providedBorrowAtom } from "../../atoms/borrowAtoms";
import { gameDataSourceAtom } from "../../atoms/gameDataAtoms";
import { pushToastAtom, statusMessageAtom } from "../../atoms/uiAtoms";
import { TILESETS } from "../../data/tilesets";
import { tilesetIndex } from "../../formats/chk/scenario";
import { borrowContext, drawsFromGame, forgetBorrowed, hostKeyOf, readKnownBorrowed, refreshProvided, scanBorrowed } from "../../services/borrow";
import type { LoadedTileset } from "../../formats/tileset/load";
import { Button } from "../ui";
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
    void readKnownBorrowed(store, era, host).then(() => (provided.length > 0 ? refreshProvided(store, era, host) : undefined));
  }, [store, host, era, provided]);

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
      toast({ kind: "error", title: t("Could not look through the other tilesets"), detail: err instanceof Error ? err.message : String(err) });
    }
  };

  const scanning = scan && scan.hostKey === key ? scan : null;
  const sources = info?.sources.filter((s) => s.terrains.length > 0) ?? [];
  const pick = (id: number, sourceEra: number) => {
    setActive(id);
    // The source's files and the table are read now, so the first stroke does not wait.
    void borrowContext(store, era, host, sourceEra);
  };

  return (
    <div className="borrowed-terrains">
      <div className="borrowed-head">{t("From other tilesets")}</div>
      {!info && !scanning && (
        <div className="hint" style={{ padding: "6px 10px", display: "grid", gap: 6, justifyItems: "start" }}>
          <span>{t("This tileset may hold copies of other tilesets' ground. Looking through the game's other seven tilesets finds the terrains whose every tile has a copy here, so the isometric brush can lay them with their own cliffs and edges. It takes a few seconds, once; the result is kept.")}</span>
          <Button size="sm" onClick={() => void run(false)}>{t("Find terrain from other tilesets")}</Button>
        </div>
      )}
      {scanning && (
        <div className="hint" style={{ padding: "6px 10px", display: "grid", gap: 4 }}>
          <span>{t("Looking through {tileset}…", { tileset: translate(TILESETS[scanning.sourceEra].name) })}</span>
          <span className="progress-track"><i style={{ width: `${Math.round(100 * scanning.share)}%` }} /></span>
        </div>
      )}
      {info && !scanning && sources.length === 0 && (
        <div className="hint" style={{ padding: "6px 10px" }}>{t("No other tileset's terrain is whole in this tileset.")}</div>
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
                title={hoverText(TILESETS[b.sourceEra].name, b.standIns, s.provided !== undefined)}
              >
                <TileThumb loaded={loaded} id={b.tile} size={18} className="swatch" />
                <span>{translate(b.name)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {info && !scanning && !fromGame && (
        <div className="borrowed-again">
          <Button size="sm" variant="ghost" title={t("Look through the other tilesets again, as if for the first time")} onClick={() => void run(true)}>{t("Look again")}</Button>
        </div>
      )}
    </div>
  );
}

function hoverText(source: string, standIns: number, provided: boolean): string {
  const lines = [
    provided
      ? t("Laid by {tileset}'s isometric brush, each tile replaced with the tile a plugin named for it.", { tileset: translate(source) })
      : t("Laid by {tileset}'s isometric brush, each tile replaced with this tileset's copy of its picture.", { tileset: translate(source) }),
    t("It walks and builds as this tileset's copies say, which can differ from {tileset}'s own: View ▸ Walkability (from the Walkability plugin), the Elevation Overlay and the Buildability Overlay show where.", { tileset: translate(source) }),
    t("Where it meets this map's own ground nothing joins them: Heal softens the seams, and the Tile palette's Pieces show the transitions maps use."),
  ];
  if (standIns > 0) lines.push(t("{n, plural, one {# tile has} other {# tiles have}} no copy here and lay the nearest picture this tileset has.", { n: standIns }));
  return lines.join("\n");
}
