import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { archiveExtrasAtom, loadDocumentAtom, scenarioAtom } from "../atoms/documentAtoms";
import { mapFilePathAtom, mapModifiedAtom, screenAtom } from "../atoms/editorAtoms";
import { openDialogAtom, statusMessageAtom } from "../atoms/uiAtoms";
import { createScenario } from "../formats/chk/create";
import { ensureTileset, peekTileset, TILESET_FILENAMES } from "../formats/tileset/load";
import { baseTerrain, flatTerrain } from "../formats/tileset/terrain";
import { terrainName, TILESETS, TILESET_BY_ID, type TilesetId } from "../data/tilesets";
import { openMapFile, saveBytes, writeMapBytes, type MapFormat } from "../services/mapIo";

export interface NewMapOptions {
  width: number;
  height: number;
  tileset: TilesetId;
  name: string;
  description: string;
  /** ISOM id of the terrain to fill with; the tileset's default when omitted. */
  terrainId?: number;
}

/** What StarEdit starts on, give or take its 64x64: a blank Badlands scenario. */
export const DEFAULT_NEW_MAP: NewMapOptions = {
  width: 128,
  height: 128,
  tileset: "badlands",
  name: "Untitled Scenario",
  description: "",
};

/** New, open and save actions shared by the menu, hotkeys, splash and drag-and-drop. */
export function useMapFileActions() {
  const store = useStore();
  const scenario = useAtomValue(scenarioAtom);
  const extras = useAtomValue(archiveExtrasAtom);
  const path = useAtomValue(mapFilePathAtom);
  const load = useSetAtom(loadDocumentAtom);
  const setStatus = useSetAtom(statusMessageAtom);
  const setModified = useSetAtom(mapModifiedAtom);
  const setPath = useSetAtom(mapFilePathAtom);
  const setScreen = useSetAtom(screenAtom);
  const openDialog = useSetAtom(openDialogAtom);

  /**
   * Build a blank scenario and install it as the open document. The tileset graphics
   * decide which tiles the fill uses, so they are fetched first; without them the map
   * is still made of dirt ids and the viewport falls back to flat colour.
   *
   * `onlyWhenEmpty` is for the startup map: a file opened while the tileset was still
   * loading wins over it.
   */
  const newMap = useCallback(async (options: NewMapOptions = DEFAULT_NEW_MAP, onlyWhenEmpty = false) => {
    const { width, height, name, description } = options;
    const info = TILESET_BY_ID[options.tileset];
    const era = Math.max(0, TILESETS.findIndex((t) => t.id === options.tileset));
    const loaded = peekTileset(TILESET_FILENAMES[era]) ?? await ensureTileset(TILESET_FILENAMES[era]).catch(() => null);
    if (onlyWhenEmpty && store.get(scenarioAtom)) return;

    const terrain = baseTerrain(loaded?.tileset ?? null, options.terrainId ?? info.defaultIsom);
    const { tiles, isom } = flatTerrain(width, height, terrain, loaded?.tileset ?? null, Math.random, era);

    load({
      scenario: createScenario({ width, height, era, name, description, tiles, isom }),
      extras: new Map(),
      fileName: null,
    });
    setStatus(`New ${width}×${height} ${info.name} scenario — ${terrainName(info, terrain.id)}`);
  }, [load, setStatus, store]);

  const openFile = useCallback(async (file: File) => {
    setStatus(`Opening ${file.name}…`);
    try {
      const doc = await openMapFile(file);
      load(doc);
      setScreen("editor");
      const warnings = doc.scenario.warnings.length;
      setStatus(
        `Opened ${file.name} — ${doc.scenario.width}×${doc.scenario.height}, ` +
        `${doc.scenario.units.length} units` +
        (warnings > 0 ? `, ${warnings} warning${warnings === 1 ? "" : "s"}` : ""),
      );
      return true;
    } catch (err) {
      setStatus(`Could not open ${file.name}: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [load, setScreen, setStatus]);

  /** Ctrl+S: write straight back to the current file name, or fall back to Save As. */
  const save = useCallback(async () => {
    if (!scenario) { setStatus("Nothing to save — open or create a map first."); return false; }
    if (!path) { openDialog("saveAs"); return false; }

    const format = (path.split(".").pop()?.toLowerCase() ?? "scx") as MapFormat;
    try {
      const bytes = await writeMapBytes(scenario, { format, extras });
      if (!(await saveBytes(bytes, path))) return false;
      setModified(false);
      setStatus(`Saved ${path} — ${(bytes.length / 1024).toFixed(1)} KB`);
      return true;
    } catch (err) {
      setStatus(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [extras, openDialog, path, scenario, setModified, setStatus]);

  return { newMap, openFile, save, setPath };
}
