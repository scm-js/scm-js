import { useAtomValue } from "jotai";
import { screenAtom } from "./atoms/editorAtoms";
import { panelsAtom } from "./atoms/uiAtoms";
import { useHotkeys } from "./hooks/useHotkeys";
import { useDevDeepLinks } from "./hooks/useDevDeepLinks";
import { TooltipProvider } from "./components/ui";
import MenuBar from "./components/chrome/MenuBar";
import ToolBar from "./components/chrome/ToolBar";
import StatusBar from "./components/chrome/StatusBar";
import { LeftDock, RightDock } from "./components/panels/Docks";
import MapViewport from "./components/viewport/MapViewport";
import DialogHost from "./components/dialogs/DialogHost";
import SplashScreen from "./components/splash/SplashScreen";

export default function App() {
  const screen = useAtomValue(screenAtom);
  const panels = useAtomValue(panelsAtom);
  useHotkeys();
  useDevDeepLinks();

  const rightVisible = panels.minimap || panels.layers || panels.properties;

  return (
    <TooltipProvider>
      <div className="app" aria-hidden={screen === "splash"}>
        <MenuBar />
        {panels.toolbar && <ToolBar />}
        <div className="body">
          {panels.palette && <LeftDock />}
          <MapViewport />
          {rightVisible && <RightDock />}
        </div>
        {panels.statusbar && <StatusBar />}
      </div>
      <DialogHost />
      {screen === "splash" && <SplashScreen />}
    </TooltipProvider>
  );
}
