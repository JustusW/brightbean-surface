import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { armAutoReload } from "./autoreload";

/* SELF-HOSTED, NOT LOADED FROM ANYBODY. These come through npm and Vite
   bundles the woff2 files into our own assets, so the page still makes
   exactly one class of external request — to our own media host — and a
   visitor's browser never tells Google, or anyone else, that they looked
   at a model aircraft club's website.
   Variable weights: one file per family covering every weight, which is
   smaller than shipping the three or four static cuts we would need. */
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";

import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Opt-in, via #autoreload on the URL. Does nothing at all without it, so
// no visitor ever polls anything — see autoreload.ts.
armAutoReload();
