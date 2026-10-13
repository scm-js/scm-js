// The Game Data page's entry (`data.html`). The same order as `main.tsx`, for the same
// reasons: the settings kept under the editor's old address first, then everything else.
import "../moveIn";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "jotai";
import GameDataPage from "./GameDataPage";
import { ErrorBoundary, rootErrorHandlers } from "../components/ui/ErrorBoundary";
import { storedPreference } from "../atoms/preferencesAtoms";
import { resolveLocale, setLocale, t } from "../i18n";
import "../index.css";
import "../styles/pages.css";

const locale = resolveLocale(storedPreference("language", "auto"), navigator.language);
setLocale(locale);
document.documentElement.lang = locale;
document.title = `${t("Game data")} — scmJS`;

ReactDOM.createRoot(document.getElementById("root")!, rootErrorHandlers).render(
  <React.StrictMode>
    <Provider>
      <ErrorBoundary surface="page" fallback={(error) => <p className="pg-crash">{error instanceof Error ? error.message : String(error)}</p>}>
        <GameDataPage />
      </ErrorBoundary>
    </Provider>
  </React.StrictMode>,
);
