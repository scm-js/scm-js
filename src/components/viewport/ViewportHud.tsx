import { useAtomValue } from "jotai";
import {
  activeDoodadAtom,
  activeSpriteAtom,
  activeSpriteKindAtom,
  activeUnitAtom,
  activeUnitSpriteAtom,
  clipboardAtom,
  clipSelectionAtom,
  doodadPlacementAtom,
  fogModeAtom,
  fogViewPlayerAtom,
  locationSnapAtom,
  mapHeightAtom,
  mapWidthAtom,
  spritePlaceOptionsAtom,
  zoomAtom,
} from "../../atoms/editorAtoms";
import { mapPickAtom, mapToolAtom, pluginMapButtonsAtom } from "../../atoms/pluginAtoms";
import { unitLabel } from "../../data/units";
import { clipSummary } from "../../editor/clipboard";
import { logError } from "../../editor/log";
import type { UnitAssets } from "../../formats/units/load";
import { doodadLabel, type useDoodadTools } from "../../hooks/useDoodadTools";
import { spriteName } from "../../hooks/useSpriteTools";
import { t } from "../../i18n";

/** What the pointer would do on the map right now, as the viewport worked it out. */
export interface ViewportMode {
  picking: boolean;
  tooling: boolean;
  unitPlacing: boolean;
  spritePlacing: boolean;
  doodadPlacing: boolean;
  locationsEditing: boolean;
  clipEditing: boolean;
  clipPasting: boolean;
  showFog: boolean;
  fogPainting: boolean;
}

/**
 * The chips in the corner of the map: what map this is, and what the pointer is about to
 * do. Its own component so a palette pick or a moved snap renders this row, not the
 * viewport.
 */
export default function ViewportHud({ tilesetName, tilesetLoading, unitAssets, doodadTools, mode }: {
  tilesetName: string;
  tilesetLoading: boolean;
  unitAssets: UnitAssets | null;
  doodadTools: ReturnType<typeof useDoodadTools>;
  mode: ViewportMode;
}) {
  const mapW = useAtomValue(mapWidthAtom);
  const mapH = useAtomValue(mapHeightAtom);
  const zoom = useAtomValue(zoomAtom);
  const mapPick = useAtomValue(mapPickAtom);
  const mapTool = useAtomValue(mapToolAtom);
  const activeUnit = useAtomValue(activeUnitAtom);
  const activeSpriteKind = useAtomValue(activeSpriteKindAtom);
  const activeSprite = useAtomValue(activeSpriteAtom);
  const activeUnitSprite = useAtomValue(activeUnitSpriteAtom);
  const spritePlaceOptions = useAtomValue(spritePlaceOptionsAtom);
  // Only read so the chip follows the palette: `activeDef()` looks the choice up itself.
  useAtomValue(activeDoodadAtom);
  const doodadPlacement = useAtomValue(doodadPlacementAtom);
  const locationSnap = useAtomValue(locationSnapAtom);
  const clip = useAtomValue(clipboardAtom);
  const clipSelection = useAtomValue(clipSelectionAtom);
  const fogViewPlayer = useAtomValue(fogViewPlayerAtom);
  const fogMode = useAtomValue(fogModeAtom);
  const { picking, tooling, unitPlacing, spritePlacing, doodadPlacing, locationsEditing, clipEditing, clipPasting, showFog, fogPainting } = mode;
  const doodad = doodadPlacing && !tooling ? doodadTools.activeDef() : null;

  return (
    <div className="map-hud">
      <PluginMapButtons />
      <span className="hud-chip"><b>{tilesetName}</b></span>
      <span className="hud-chip">{mapW}×{mapH}</span>
      <span className="hud-chip">{Math.round(zoom * 100)}%</span>
      {tilesetLoading && <span className="hud-chip">{t("loading tileset…")}</span>}
      {picking && mapPick && <span className="hud-chip pick"><b>{mapPick.prompt}</b> · {mapPick.kind === "area" ? t("drag a rectangle") : mapPick.kind === "tile" ? t("click a tile") : t("click a unit or a location")} {" "}{t("· Esc cancels")}</span>}
      {tooling && mapTool && <span className="hud-chip pick"><b>{mapTool.spec.name}</b>{mapTool.spec.hint && <> · {mapTool.spec.hint}</>} {" "}{t("· Esc / right-click to stop")}</span>}
      {unitPlacing && !tooling && <span className="hud-chip">{t("placing")}{" "}<b>{unitLabel(activeUnit)}</b> {" "}{t("· Esc / right-click to stop")}</span>}
      {spritePlacing && !tooling && <span className="hud-chip">{t("placing sprite")}{" "}<b>{spriteName(unitAssets, activeSpriteKind, activeSpriteKind === "pure" ? activeSprite : activeUnitSprite)}</b>{spritePlaceOptions.flipped ? t(" · flipped") : ""} {" "}{t("· Esc / right-click to stop")}</span>}
      {doodad && <span className="hud-chip">{t("placing")}{" "}<b>{doodadLabel(doodad)}</b>{doodadPlacement.placeAnywhere ? t(" · anywhere") : ""} {" "}{t("· Esc / right-click to stop")}</span>}
      {locationsEditing && <span className="hud-chip">{t("locations · drag empty ground to create · snap")}{" "}<b>{locationSnap ? `${locationSnap} px` : "off"}</b></span>}
      {clipEditing && !clipPasting && (
        <span className="hud-chip">
          {t("cut / copy / paste · drag to mark an area")}{clipSelection && <> · <b>{clipSelection.x1 - clipSelection.x0}×{clipSelection.y1 - clipSelection.y0}</b> at {clipSelection.x0}, {clipSelection.y0}</>} {" "}{t("· Ctrl+C copies")}{clip && t(" · Ctrl+V pastes")}
        </span>
      )}
      {clipPasting && clip && !tooling && <span className="hud-chip">{t("pasting")}{" "}<b>{clipSummary(clip)}</b> {" "}{t("· click to stamp · Esc / right-click to stop")}</span>}
      {showFog && <span className="hud-chip">{t("fog of war")}{" "}<b>{t("P{v}", { v: fogViewPlayer + 1 })}</b>{fogPainting && <> · {fogMode === "fog" ? t("painting") : t("clearing")} {" "}{t("· Shift inverts")}</>}</span>}
    </div>
  );
}

/**
 * `ui.mapButton`: the plugins' buttons at the head of the corner row. Its own component so
 * a badge changing does not render the rest of the row.
 */
function PluginMapButtons() {
  const buttons = useAtomValue(pluginMapButtonsAtom);
  return (
    <>
      {buttons.map(({ key, plugin, spec }) => (
        <button
          key={key}
          type="button"
          className={`hud-chip hud-btn${spec.active ? " active" : ""}`}
          title={spec.title ?? `${spec.label} (${plugin.name})`}
          aria-pressed={spec.active ?? undefined}
          onClick={() => { try { spec.onClick(); } catch (err) { logError("plugins", `${plugin.name}: its map button failed`, err); } }}
        >
          {spec.label}
          {spec.badge !== undefined && spec.badge !== null && spec.badge !== 0 && spec.badge !== "" && <span className="hud-badge">{spec.badge}</span>}
        </button>
      ))}
    </>
  );
}
