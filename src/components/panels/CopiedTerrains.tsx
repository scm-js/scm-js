/**
 * The Isometric tab's copied terrains: a terrain of the tileset held again at another height (the Rect tab's "Mud (mid
 * ground)") whose edge pieces the tileset also holds, laid by the isometric brush (editor/modTerrain/terrainCopyLattice.ts). The
 * scan runs by itself (services/terrainCopies.ts); this lists what it found, complete terrains first, then those whose
 * tileset lacks some shapes, marked.
 */
import { useAtom, useAtomValue } from "jotai";
import { activeTerrainAtom, mapTilesetAtom } from "../../atoms/editorAtoms";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { copyHostsAtom, copyScanAtom } from "../../atoms/copyAtoms";
import { TILESET_BY_ID } from "../../data/tilesets";
import { tilesetIndex } from "../../formats/chk/scenario";
import { heightLabel, pairTerrain, terrainLabel } from "../../formats/tileset/palette";
import type { LoadedTileset } from "../../formats/tileset/load";
import { copyHostKey } from "../../services/terrainCopies";
import { TileThumb } from "./TileBrowser";
import { t } from "../../i18n";

export function CopiedTerrains({ loaded }: { loaded: LoadedTileset | null }) {
  const scn = useAtomValue(scenarioAtom);
  const hosts = useAtomValue(copyHostsAtom);
  const scan = useAtomValue(copyScanAtom);
  const info = TILESET_BY_ID[useAtomValue(mapTilesetAtom)];
  const [active, setActive] = useAtom(activeTerrainAtom);
  if (!loaded || !scn) return null;
  const key = copyHostKey(tilesetIndex(scn), loaded.tileset);
  const host = hosts.get(key);
  const scanning = scan?.hostKey === key ? scan : null;
  if (!scanning && (!host || host.terrains.length === 0)) return null;
  return (
    <div className="copied-terrains">
      <div className="borrowed-head">{t("Copied terrain")}</div>
      {scanning && <div className="hint" style={{ padding: "4px 10px" }}>{t("Looking through this tileset for its terrains' edges at other heights… ({pct}%)", { pct: Math.round(scanning.share * 100) })}</div>}
      <div className="listbox terrain-list" style={{ border: "none", boxShadow: "none", borderRadius: 0 }}>
        {(host?.terrains ?? []).map((c) => {
          const type = pairTerrain(loaded.tileset, info.terrain, c.flat);
          const name = type ? terrainLabel(type) : t("Group {n}", { n: c.flat });
          const tip = c.complete
            ? t("{name}: this tileset's copy of the terrain at another height, laid with the edge pieces it holds for it. The brush lays it on the ground those pieces were drawn to meet, choosing among the tileset's blocks the one that joins the ground under the stroke best.", { name })
            : t("{name}: this tileset does not draw {n, plural, one {# shape} other {# shapes}} of the terrain's edge. The brush lays the nearest-joining tile there, and the status line counts those cells.", { name, n: c.missing });
          return (
            <div key={c.id} className={`item ${active === c.id ? "selected" : ""}`} onClick={() => setActive(c.id)} title={tip}>
              <TileThumb loaded={loaded} id={c.flat << 4} size={18} className="swatch" />
              <span>{name}</span>
              {!c.complete && <span className="elev" style={{ opacity: 0.8 }}>{t("incomplete")}</span>}
              {c.complete && <span className="elev">{heightLabel(c.height as 0 | 1 | 2)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
