import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { armAutoReload } from "./autoreload";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Opt-in, via #autoreload on the URL. Does nothing at all without it, so
// no visitor ever polls anything — see autoreload.ts.
armAutoReload();
