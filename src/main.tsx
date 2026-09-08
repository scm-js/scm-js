// Must come first: it silences React's dev render-profiling track, and the only thing
// that makes that work is being evaluated before react-dom. See the file for why.
import "./devReactTracks";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "jotai";
import App from "./App";
import { storedPreference } from "./atoms/preferencesAtoms";
import { resolveLocale, setLocale } from "./i18n";
import "./index.css";

// Before the first render, so the first paint is already in the user's language: the
// preference straight from storage (`useApplyPreferences` keeps it current afterwards).
setLocale(resolveLocale(storedPreference("language", "auto"), navigator.language));
document.documentElement.lang = resolveLocale(storedPreference("language", "auto"), navigator.language);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider>
      <App />
    </Provider>
  </React.StrictMode>,
);
