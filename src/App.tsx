import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { screenAtom } from "./atoms/editorAtoms";
import { panelsAtom } from "./atoms/uiAtoms";
import { pluginPanelsAtom } from "./atoms/pluginAtoms";
import { useHotkeys } from "./hooks/useHotkeys";
import { useApplyPreferences } from "./hooks/useApplyPreferences";
import { useMapFileActions } from "./hooks/useMapFileActions";
import type { PendingAction } from "./hooks/useMapFileActions";
import { useDevDeepLinks } from "./hooks/useDevDeepLinks";
import { usePreload } from "./hooks/usePreload";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useStartupMap } from "./hooks/useStartupMap";
import { usePlugins } from "./hooks/usePlugins";
import { useWindowTitle } from "./hooks/useWindowTitle";
import { useCloseGuard } from "./hooks/useCloseGuard";
import { useDesktopFiles } from "./hooks/useDesktopFiles";
import { droppedHandle } from "./services/mapIo";
import { TooltipProvider } from "./components/ui";
import MenuBar from "./components/chrome/MenuBar";
import ToolBar from "./components/chrome/ToolBar";
import StatusBar from "./components/chrome/StatusBar";
import Toasts from "./components/chrome/Toasts";
import { LeftDock, RightDock } from "./components/panels/Docks";
import MapViewport from "./components/viewport/MapViewport";
import DialogHost from "./components/dialogs/DialogHost";
import SplashScreen from "./components/splash/SplashScreen";
import { removeBootSplash } from "./components/splash/bootSplash";

/**
 * The first file of a drop, opened through the unsaved-changes gate. False when the drop
 * carried no file, so the caller can leave the event alone. `droppedHandle` has to be
 * *called* inside the event — its answer may come later.
 */
function openDropped(data: DataTransfer | null, guard: (p: PendingAction) => boolean): boolean {
  const file = data?.files[0];
  if (!file || !data) return false;
  void droppedHandle(data).then((handle) => guard({ action: "open", file, handle }));
  return true;
}

export default function App() {
  const screen = useAtomValue(screenAtom);
  const panels = useAtomValue(panelsAtom);
  // A plugin's docked panel (`api.ui.panel` with `dock: "right"`) keeps the dock on screen even with every built-in panel hidden.
  const dockedPanels = useAtomValue(pluginPanelsAtom).some((p) => p.spec.dock === "right");
  const { guard } = useMapFileActions();
  const [dropTarget, setDropTarget] = useState(false);
  // Mounting the chrome is one big commit (menu bar, toolbar, both docks, the viewport and
  // the dialog host — well over a thousand renders), and the desktop window is not shown
  // until the renderer's first paint. So the first commit is the splash alone and the chrome
  // follows two frames later: the window appears on the splash instead of behind that work,
  // and the splash is already animating while it happens. Nothing here waits on the chrome —
  // every startup hook lives in App, above.
  const [chrome, setChrome] = useState(false);
  useApplyPreferences();
  useHotkeys();
  useDevDeepLinks();
  usePreload();
  useStartupMap();
  usePlugins();
  useWindowTitle();
  useCloseGuard();
  useDesktopFiles();
  useUpdateCheck();

  useEffect(() => {
    if (chrome) return;
    // Two frames: one to paint the splash, one to be sure it was presented before the
    // commit that blocks the main thread.
    let second = 0;
    const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setChrome(true)); });
    // A page that is not visible gets no frames at all (a hidden desktop window before it is
    // shown, a background tab), and the chrome would wait for ever. It costs nothing to mount
    // it on a timer instead, since nobody is looking at what that commit blocks.
    const late = setTimeout(() => setChrome(true), 500);
    return () => { cancelAnimationFrame(first); cancelAnimationFrame(second); clearTimeout(late); };
  }, [chrome]);

  // `?nosplash` (and anything else that skips straight to the editor) never mounts
  // SplashScreen, so the boot splash in index.html would sit there forever.
  useEffect(() => { if (screen !== "splash") removeBootSplash(); }, [screen]);

  // The handlers above are on `.app`, and two things render *outside* it: the splash, and
  // every dialog (Radix portals them to the body). A file dropped on either would reach no
  // handler, and the browser's default for that is to navigate the window to the file —
  // which in the desktop build replaces the app with the map's bytes. So the document takes
  // whatever the tree did not: `dragover` must be cancelled for the drop event to fire at
  // all, and a drop is cancelled always and opened only when nothing else already claimed
  // it (`defaultPrevented`, set by the handler above or by the Open dialog's drop zone,
  // both of which run first — React attaches its listeners to the root container and to
  // each portal's container, inside the body).
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      // Only a file drop: text dragged into a field cancels its own `dragover`, and
      // cancelling that drop here would swallow the text the field was about to take.
      if (!e.dataTransfer?.types.includes("Files")) return;
      const taken = e.defaultPrevented;
      e.preventDefault();
      setDropTarget(false);
      if (!taken) openDropped(e.dataTransfer, guard);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => { document.removeEventListener("dragover", over); document.removeEventListener("drop", drop); };
  }, [guard]);

  const rightVisible = panels.minimap || panels.layers || panels.properties || dockedPanels;

  // Dropping a map anywhere in the window opens it — the dialog's own drop zone is
  // just the discoverable version of the same thing.
  const onDrop = (e: React.DragEvent) => {
    if (!openDropped(e.dataTransfer, guard)) return;
    e.preventDefault();
    setDropTarget(false);
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropTarget(true);
  };

  return (
    <TooltipProvider>
      <div
        className={`app${dropTarget ? " drop-target" : ""}`}
        aria-hidden={screen === "splash"}
        onDragOver={onDragOver}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropTarget(false); }}
        onDrop={onDrop}
      >
        {chrome && (
          <>
            <MenuBar />
            {panels.toolbar && <ToolBar />}
            <div className="body">
              {panels.palette && <LeftDock />}
              <MapViewport />
              {rightVisible && <RightDock />}
            </div>
            {panels.statusbar && <StatusBar />}
            <Toasts />
          </>
        )}
      </div>
      {chrome && <DialogHost />}
      {screen === "splash" && <SplashScreen solid={!chrome} />}
    </TooltipProvider>
  );
}
