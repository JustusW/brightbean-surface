import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The public site.
 *
 *  ONE ORIGIN IN PRODUCTION. nginx serves this bundle and proxies /api
 *  to uvicorn on the same hostname, so the browser never makes a
 *  cross-origin request — which means no CORS configuration to get
 *  wrong, and a session cookie that is simply SameSite=Lax rather than
 *  a cross-site cookie that modern browsers increasingly refuse.
 *
 *  In development the two are separate processes, so /api is proxied
 *  here to reproduce that single origin rather than papering over the
 *  difference with CORS headers that production does not use. A dev
 *  setup that needs configuration production does not is a dev setup
 *  that lies to you. */
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8082",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    // A club website that pulls a megabyte of JavaScript to render a
    // page of text has gone wrong somewhere, and the moment to notice is
    // at build time rather than on somebody's phone at the flying field.
    chunkSizeWarningLimit: 400,
  },
});
