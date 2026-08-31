import { useSetAtom } from "jotai";
import { screenAtom } from "../atoms/editorAtoms";
import "./SplashScreen.css";

export default function SplashScreen() {
  const setScreen = useSetAtom(screenAtom);

  return (
    <div className="splash-backdrop">
      <div className="splash-card">
        {/* Title block */}
        <div className="splash-logo">
          <span className="splash-icon">⚔</span>
          <h1 className="splash-title">
            JS&nbsp;<span className="highlight">Edit</span>
          </h1>
          <p className="splash-subtitle">StarCraft&nbsp;/ Brood&nbsp;War Map&nbsp;Editor</p>
        </div>

        {/* Menu buttons */}
        <nav className="splash-menu">
          <button className="splash-btn" onClick={() => setScreen("editor")}>
            New Map
          </button>
          <button className="splash-btn" disabled title="Coming soon">
            Open Map
          </button>
          <button className="splash-btn" disabled title="Coming soon">
            Recent Maps
          </button>
          <button className="splash-btn" disabled title="Coming soon">
            Settings
          </button>
        </nav>

        <footer className="splash-footer">
          <span>v0.1.0</span>
          <span className="splash-dot">·</span>
          <span>TypeScript + React + Jotai</span>
        </footer>
      </div>
    </div>
  );
}
