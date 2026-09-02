import { useState } from "react";
import { useAtomValue } from "jotai";
import { screenAtom } from "./atoms/editorAtoms";
import { panelsAtom } from "./atoms/uiAtoms";
import { useHotkeys } from "./hooks/useHotkeys";
import { useApplyPreferences } from "./hooks/useApplyPreferences";
import { useMapFileActions } from "./hooks/useMapFileActions";
import { useDevDeepLinks } from "./hooks/useDevDeepLinks";
import { usePreload } from "./hooks/usePreload";
import { useStartupMap } from "./hooks/useStartupMap";
import { usePlugins } from "./hooks/usePlugins";
import { useWindowTitle } from "./hooks/useWindowTitle";
import { useCloseGuard } from "./hooks/useCloseGuard";
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

export default function App() {
  const screen = useAtomValue(screenAtom);
  const panels = useAtomValue(panelsAtom);
  const { guard } = useMapFileActions();
  const [dropTarget, setDropTarget] = useState(false);
  useApplyPreferences();
  useHotkeys();
  useDevDeepLinks();
  usePreload();
  useStartupMap();
  usePlugins();
  useWindowTitle();
  useCloseGuard();

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
        <MenuBar />
        {panels.toolbar && <ToolBar />}
        <div className="body">
          {panels.palette && <LeftDock />}
          <MapViewport />
          {rightVisible && <RightDock />}
        </div>
        {panels.statusbar && <StatusBar />}
        <Toasts />
      </div>
      <DialogHost />
      {screen === "splash" && <SplashScreen />}
    </TooltipProvider>
  );
}
