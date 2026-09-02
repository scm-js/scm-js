import { useEffect } from "react";
import { useAtomValue } from "jotai";
import { mapFilePathAtom, mapModifiedAtom, mapNameAtom } from "../atoms/editorAtoms";
import { scenarioAtom } from "../atoms/documentAtoms";

/** What the tab (and, on the desktop, the window) says when nothing is open. */
export const APP_TITLE = "scmJS — StarCraft Scenario Editor";

/**
 * The title of the document part: the file the map came from when it has one — that is
 * what "which map is this" means once several are open in tabs — otherwise the scenario
 * name. A modified map is marked with a leading `*`, as every editor on Windows does.
 */
export function documentTitle(fileName: string | null, mapName: string, modified: boolean): string {
  const name = (fileName ?? mapName).trim();
  return `${modified ? "*" : ""}${name || "Untitled Scenario"} — scmJS`;
}

/**
 * Keeps `document.title` on the open map. Electron mirrors the page title into the window
 * title by default, so the desktop build's title bar follows this too.
 */
export function useWindowTitle() {
  const scenario = useAtomValue(scenarioAtom);
  const fileName = useAtomValue(mapFilePathAtom);
  const mapName = useAtomValue(mapNameAtom);
  const modified = useAtomValue(mapModifiedAtom);

  useEffect(() => {
    document.title = scenario ? documentTitle(fileName, mapName, modified) : APP_TITLE;
  }, [scenario, fileName, mapName, modified]);
}
