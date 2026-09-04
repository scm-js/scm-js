import { useEffect, useState } from "react";
import { useAtomValue } from "jotai";
import { screenAtom } from "./atoms/editorAtoms";
import { panelsAtom } from "./atoms/uiAtoms";
import { useHotkeys } from "./hooks/useHotkeys";
import { useApplyPreferences } from "./hooks/useApplyPreferences";
import { useMapFileActions } from "./hooks/useMapFileActions";
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

export default function App() {
  const screen = useAtomValue(screenAtom);
  const panels = useAtomValue(panelsAtom);
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

  const rightVisible = panels.minimap || panels.layers || panels.properties;

  // Dropping a map anywhere in the window opens it — the dialog's own drop zone is
  // just the discoverable version of the same thing.
  const onDrop = (e: React.DragEvent) => {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    setDropTarget(false);
    // The handle request has to start inside the event; the answer can come later.
    void droppedHandle(e.dataTransfer).then((handle) => guard({ action: "open", file, handle }));
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
