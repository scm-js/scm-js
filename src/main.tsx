// Must come first: it silences React's dev render-profiling track, and the only thing
// that makes that work is being evaluated before react-dom. See the file for why.
import "./devReactTracks";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "jotai";
import App from "./App";
import CrashScreen from "./components/chrome/CrashScreen";
import { ErrorBoundary, rootErrorHandlers } from "./components/ui/ErrorBoundary";
import { storedPreference } from "./atoms/preferencesAtoms";
import { resolveLocale, setLocale } from "./i18n";
import "./index.css";

// Before the first render, so the first paint is already in the user's language: the
// preference straight from storage (`useApplyPreferences` keeps it current afterwards).
setLocale(resolveLocale(storedPreference("language", "auto"), navigator.language));
document.documentElement.lang = resolveLocale(storedPreference("language", "auto"), navigator.language);

ReactDOM.createRoot(document.getElementById("root")!, rootErrorHandlers).render(
  <React.StrictMode>
    <Provider>
      {/* The last boundary: the panels, the map and the dialogs have their own inside. */}
      <ErrorBoundary surface="editor" fallback={(error, retry) => <CrashScreen error={error} retry={retry} />}>
        <App />
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>,
);
