// Must come first: it silences React's dev render-profiling track, and the only thing
// that makes that work is being evaluated before react-dom. See the file for why.
import "./devReactTracks";
import React from "react";
import ReactDOM from "react-dom/client";
import { Provider } from "jotai";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Provider>
      <App />
    </Provider>
  </React.StrictMode>,
);
