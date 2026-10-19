import { useEffect, useRef, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { screenAtom, viewOnlyAtom } from "./atoms/editorAtoms";
import { panelsAtom } from "./atoms/uiAtoms";
import { pluginPanelsAtom } from "./atoms/pluginAtoms";
import { useHotkeys } from "./hooks/useHotkeys";
import { useApplyPreferences } from "./hooks/useApplyPreferences";
import { useLocale } from "./i18n/react";
import { useMapFileActions } from "./hooks/useMapFileActions";
import type { PendingAction } from "./hooks/useMapFileActions";
import { useDevDeepLinks } from "./hooks/useDevDeepLinks";
import { usePreload } from "./hooks/usePreload";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useWhatsNew } from "./hooks/useWhatsNew";
import { useStartupMap } from "./hooks/useStartupMap";
import { usePlugins } from "./hooks/usePlugins";
import { usePluginLink } from "./hooks/usePluginLink";
import { useWindowTitle } from "./hooks/useWindowTitle";
import { useRecovery } from "./hooks/useRecovery";
import { useCloseGuard } from "./hooks/useCloseGuard";
import { useDesktopFiles } from "./hooks/useDesktopFiles";
import { useErrorCapture } from "./hooks/useErrorCapture";
import { useUsageCounts } from "./hooks/useUsageCounts";
import { droppedHandle } from "./services/mapIo";
import { handFilesToPlugins } from "./plugins/fileTypes";
import { TooltipProvider } from "./components/ui";
import { Guarded } from "./components/ui/ErrorBoundary";
import MenuBar from "./components/chrome/MenuBar";
import ToolBar from "./components/chrome/ToolBar";
import TabStrip from "./components/chrome/TabStrip";
import StatusBar from "./components/chrome/StatusBar";
import DebugConsole from "./components/chrome/DebugConsole";
import Toasts from "./components/chrome/Toasts";
import { LeftDock, RightDock } from "./components/panels/Docks";
import { BottomDockedPluginPanels } from "./components/panels/PluginPanels";
import MapViewport from "./components/viewport/MapViewport";
import PluginMapViews from "./components/viewport/PluginMapViews";
import DialogHost from "./components/dialogs/DialogHost";
import SplashScreen from "./components/splash/SplashScreen";
import { removeBootSplash } from "./components/splash/bootSplash";

type Store = ReturnType<typeof useStore>;

/**
 * A drop: the files a plugin claimed (`api.ui.fileType` — replays, say) go to it, all of them
 * together, and the first of the rest is opened through the unsaved-changes gate. False when
 * the drop carried no file, so the caller can leave the event alone. `droppedHandle` has to
 * be *called* inside the event — its answer may come later — and it is the first file's.
 */
function openDropped(data: DataTransfer | null, guard: (p: PendingAction) => boolean, store: Store): boolean {
  const files = data ? [...data.files] : [];
  if (!files.length || !data) return false;
  const rest = handFilesToPlugins(store, files);
  const file = rest[0];
  if (!file) return true;
  if (file === files[0]) void droppedHandle(data).then((handle) => guard({ action: "open", file, handle }));
  else guard({ action: "open", file, handle: null });
  return true;
}

export default function App() {
  const screen = useAtomValue(screenAtom);
  const panels = useAtomValue(panelsAtom);
  // The palette is all tools; a map open to look at only has nothing for it to do.
  const viewOnly = useAtomValue(viewOnlyAtom) !== null;
  // A plugin's docked panel (`api.ui.panel` with `dock: "right"`) keeps the dock on screen even with every built-in panel hidden.
  const dockedPanels = useAtomValue(pluginPanelsAtom).some((p) => p.spec.dock === "right");
  const { guard } = useMapFileActions();
  const store = useStore();
  const [dropTarget, setDropTarget] = useState(false);
  // Mounting the chrome is one big commit (menu bar, toolbar, both docks, the viewport and
  // the dialog host — well over a thousand renders), and the desktop window is not shown
  // until the renderer's first paint. So the first commit is the splash alone and the chrome
  // follows two frames later: the window appears on the splash instead of behind that work,
  // and the splash is already animating while it happens. Nothing here waits on the chrome —
  // every startup hook lives in App, above.
  const [chrome, setChrome] = useState(false);
  // First, so it is listening before the preload and the plugins are.
  useErrorCapture();
  useApplyPreferences();
  // Every string in the tree is `t()`'d at render; a new key remounts it all when the
  // language changes, which is rare enough that per-component subscriptions are not worth their weight.
  const locale = useLocale();
  useHotkeys();
  useDevDeepLinks();
  usePreload();
  useStartupMap();
  usePlugins();
  usePluginLink();
  useWindowTitle();
  useCloseGuard();
  useRecovery();
  useDesktopFiles();
  useUpdateCheck();
  useWhatsNew();
  useUsageCounts();

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
      if (!taken) openDropped(e.dataTransfer, guard, store);
    };
    document.addEventListener("dragover", over);
    document.addEventListener("drop", drop);
    return () => { document.removeEventListener("dragover", over); document.removeEventListener("drop", drop); };
  }, [guard, store]);

  const rightVisible = panels.minimap || ((panels.layers || panels.properties) && !viewOnly) || dockedPanels;

  // Dropping a map anywhere in the window opens it — the dialog's own drop zone is
  // just the discoverable version of the same thing.
  const onDrop = (e: React.DragEvent) => {
    if (!openDropped(e.dataTransfer, guard, store)) return;
    e.preventDefault();
    setDropTarget(false);
  };
  // The highlight follows the last `dragover`: a drag that leaves the window from inside a
  // child, or is cancelled with Escape, fires no `dragleave` on `.app` and no drop, and the
  // dashed border would stay until the next drag. So it fades on its own a moment after the
  // last `dragover` — a drag in progress renews it many times a second.
  const dropTimer = useRef<number | null>(null);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    setDropTarget(true);
    if (dropTimer.current !== null) window.clearTimeout(dropTimer.current);
    dropTimer.current = window.setTimeout(() => { dropTimer.current = null; setDropTarget(false); }, 600);
  };

  return (
    <TooltipProvider key={locale}>
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
            <TabStrip />
            <div className="body">
              {panels.palette && !viewOnly && <LeftDock />}
              {/* The map, and under it the strip plugins dock along its width (`dock: "bottom"`). */}
              <div className="map-column">
                {/* The map, and laid over it the plugins' other views of it (`ui.mapView`) with the switch between them. */}
                <div className="map-stack">
                  <Guarded surface="map view"><MapViewport /></Guarded>
                  <Guarded surface="plugin map views"><PluginMapViews /></Guarded>
                </div>
                <Guarded surface="plugin panels"><BottomDockedPluginPanels /></Guarded>
              </div>
              {rightVisible && <RightDock />}
            </div>
            <DebugConsole />
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
