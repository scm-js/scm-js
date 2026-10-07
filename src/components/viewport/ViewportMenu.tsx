import { useAtomValue, useSetAtom } from "jotai";
import { ContextMenu } from "radix-ui";
import {
  activeLayerAtom,
  activeTerrainAtom,
  centerViewOnAtom,
  clipboardAtom,
  clipSelectionAtom,
  fogModeAtom,
  selectedDoodadsAtom,
  selectedLocationsAtom,
  selectedSpritesAtom,
  selectedUnitsAtom,
  terrainModeAtom,
} from "../../atoms/editorAtoms";
import { scenarioAtom } from "../../atoms/documentAtoms";
import { pluginContextItemsAtom } from "../../atoms/pluginAtoms";
import { openDialogAtom } from "../../atoms/uiAtoms";
import { ANYWHERE_INDEX } from "../../formats/chk/sections/objects";
import type { useClipboardTools } from "../../hooks/useClipboardTools";
import type { useDoodadTools } from "../../hooks/useDoodadTools";
import type { useFogTools } from "../../hooks/useFogTools";
import type { useLocationTools } from "../../hooks/useLocationTools";
import type { useSpriteTools } from "../../hooks/useSpriteTools";
import type { MapPoint, useTerrainTools } from "../../hooks/useTerrainTools";
import type { useUnitTools } from "../../hooks/useUnitTools";
import { pluginContextRows } from "../../plugins/contextMenu";
import { t } from "../../i18n";
import type { Tile } from "./gestures";
import { TILE } from "./paint/view";

/** Where the right-click that opened the menu landed. */
export interface MenuTarget {
  tile: Tile | null;
  point: MapPoint | null;
}

/** The viewport's one instance of each layer's tools: the menu acts through the same ones the pointer does. */
export interface ViewportTools {
  terrain: ReturnType<typeof useTerrainTools>;
  units: ReturnType<typeof useUnitTools>;
  doodads: ReturnType<typeof useDoodadTools>;
  sprites: ReturnType<typeof useSpriteTools>;
  locations: ReturnType<typeof useLocationTools>;
  fog: ReturnType<typeof useFogTools>;
  clip: ReturnType<typeof useClipboardTools>;
}

interface Row {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

/**
 * The rows of the map's context menu: the active layer's own, the clipboard's, the view's,
 * then what plugins registered. Rendered inside the menu's content, so it exists — and a
 * plugin's `visible` / `label` / `enabled` run — only while the menu is open, after the
 * right-click that opened it has been recorded as `target`.
 */
export default function ViewportMenuItems({ target, tools, painting, fogPainting, locationsEditing }: {
  target: MenuTarget;
  tools: ViewportTools;
  /** Whether the terrain brush, the fog brush and the location tools would act on a press. */
  painting: boolean;
  fogPainting: boolean;
  locationsEditing: boolean;
}) {
  const layer = useAtomValue(activeLayerAtom);
  const scenario = useAtomValue(scenarioAtom);
  const terrainMode = useAtomValue(terrainModeAtom);
  const activeTerrain = useAtomValue(activeTerrainAtom);
  const fogMode = useAtomValue(fogModeAtom);
  const selectedUnits = useAtomValue(selectedUnitsAtom);
  const selectedDoodads = useAtomValue(selectedDoodadsAtom);
  const selectedSprites = useAtomValue(selectedSpritesAtom);
  const selectedLocations = useAtomValue(selectedLocationsAtom);
  const clip = useAtomValue(clipboardAtom);
  const clipSelection = useAtomValue(clipSelectionAtom);
  const pluginItems = useAtomValue(pluginContextItemsAtom);
  const open = useSetAtom(openDialogAtom);
  const centerOn = useSetAtom(centerViewOnAtom);

  const { tile, point } = target;
  const atTile = (fn: (x: number, y: number) => void) => () => { if (tile) fn(tile.x, tile.y); };

  const rows: Row[] = [];
  if (layer === "units") {
    rows.push(
      { label: t("Unit Properties…"), disabled: selectedUnits.length === 0, onSelect: () => open("unitProperties", { indices: selectedUnits }) },
      { label: t("Delete {n, plural, one {Unit} other {# Units}}", { n: selectedUnits.length }), disabled: selectedUnits.length === 0, onSelect: () => tools.units.deleteSelected() },
    );
  } else if (layer === "doodads") {
    rows.push(
      { label: t("Delete {n, plural, one {Doodad} other {# Doodads}}", { n: selectedDoodads.length }), disabled: selectedDoodads.length === 0, onSelect: () => tools.doodads.deleteSelected() },
      { label: t("Convert {n, plural, one {Doodad} other {# Doodads}} to Terrain", { n: selectedDoodads.length }), disabled: selectedDoodads.length === 0, onSelect: () => tools.doodads.convertSelected() },
      {
        label: t("Pick Doodad Here"),
        disabled: !scenario || !tile || tools.doodads.pickAt(tile.x, tile.y) < 0,
        onSelect: atTile((x, y) => {
          const hit = tools.doodads.pickAt(x, y);
          const rec = hit >= 0 ? scenario?.doodads[hit] : null;
          if (rec) tools.doodads.startPlacing(rec.doodadId);
        }),
      },
    );
  } else if (layer === "fog") {
    rows.push(
      { label: fogMode === "fog" ? t("Fill Area with Fog") : t("Clear Fog in Area"), onSelect: atTile(tools.fog.fillAt), disabled: !fogPainting },
      { label: t("Pick Fogged Players Here"), onSelect: atTile(tools.fog.pickAt), disabled: !fogPainting },
    );
  } else if (layer === "locations") {
    rows.push(
      { label: t("Location Properties…"), disabled: selectedLocations.length === 0, onSelect: () => open("locationProperties", { index: selectedLocations[0] }) },
      { label: t("Delete {n, plural, one {Location} other {# Locations}}", { n: selectedLocations.length }), disabled: !selectedLocations.some((i) => i !== ANYWHERE_INDEX), onSelect: () => tools.locations.deleteSelected() },
      { label: t("New Location Here"), disabled: !locationsEditing, onSelect: atTile((x, y) => tools.locations.create({ left: x * TILE, top: y * TILE, right: (x + 4) * TILE, bottom: (y + 4) * TILE })) },
    );
  } else if (layer === "sprites") {
    rows.push(
      { label: t("Sprite Properties…"), disabled: selectedSprites.length === 0, onSelect: () => open("spriteProperties", { indices: selectedSprites }) },
      { label: t("Delete {n, plural, one {Sprite} other {# Sprites}}", { n: selectedSprites.length }), disabled: selectedSprites.length === 0, onSelect: () => tools.sprites.deleteSelected() },
    );
  } else if (layer === "terrain") {
    rows.push(
      { label: terrainMode === "rect" || terrainMode === "isom" ? t("Pick Terrain") : terrainMode === "blend" ? t("Blend From Here") : t("Pick Tile"), onSelect: atTile((x, y) => tools.terrain.pickAt(x, y, point ?? undefined)), disabled: !scenario },
      { label: t("Fill Area"), onSelect: atTile(tools.terrain.fillAt), disabled: !painting || terrainMode === "isom" },
    );
  }
  rows.push(
    { label: "", sep: true },
    { label: t("Cut"), disabled: !tools.clip.source(), onSelect: () => { tools.clip.cut(); } },
    { label: t("Copy"), disabled: !tools.clip.source(), onSelect: () => { tools.clip.copy(); } },
    // Paste Here stamps at the clicked tile straight away; Paste arms the layer so the clip follows the pointer.
    { label: t("Paste Here"), disabled: !scenario || !clip, onSelect: atTile((x, y) => { tools.clip.pasteAt(x, y); }) },
    { label: t("Paste"), disabled: !scenario || !clip, onSelect: () => { tools.clip.paste(); } },
    { label: "", sep: true },
    { label: t("Center View Here"), disabled: !scenario, onSelect: atTile((x, y) => centerOn({ x: x + 0.5, y: y + 0.5 })) },
    { label: t("Map Properties…"), onSelect: () => open("mapProperties") },
  );
  // What plugins registered for the map, after their own separator.
  const pluginRows = pluginContextRows(pluginItems, "viewport", { surface: "viewport", tile, point, layer, terrainMode, terrain: activeTerrain, markedArea: clipSelection });
  if (pluginRows.length > 0) rows.push({ label: "", sep: true }, ...pluginRows.map((r) => ({ label: r.label, disabled: r.disabled, onSelect: r.onSelect })));

  return (
    <>
      {rows.map((it, i) =>
        it.sep ? (
          <ContextMenu.Separator key={i} className="menu-separator" />
        ) : (
          <ContextMenu.Item key={i} className="menu-item" disabled={it.disabled} onSelect={it.onSelect}>
            {it.label}
          </ContextMenu.Item>
        ),
      )}
    </>
  );
}
