import { useAtomValue } from "jotai";
import { screenAtom } from "./atoms/editorAtoms";
import SplashScreen from "./components/SplashScreen";
import EditorLayout from "./components/EditorLayout";

export default function App() {
  const screen = useAtomValue(screenAtom);

  return screen === "splash" ? <SplashScreen /> : <EditorLayout />;
}
