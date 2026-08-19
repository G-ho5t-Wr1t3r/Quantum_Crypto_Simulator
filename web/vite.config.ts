import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The API runs as its own service, so every call is cross-origin. Proxying in
// development means the browser sees a single origin and the client code needs
// no base URL at all: the same relative paths work here and behind the reverse
// proxy that docker-compose will put in front of both.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Bound to localhost unless asked otherwise. `npm run dev:lan` passes
    // --host, which is what makes the demo reachable from another machine on
    // the network — a phone, or the projector laptop.
    //
    // Reaching it by a *name* rather than an address needs the name listed
    // here: Vite refuses unknown Host headers on purpose, because a page served
    // to an attacker-controlled hostname could otherwise read this origin
    // (DNS rebinding). Bare IP addresses are allowed without listing.
    allowedHosts: (process.env.VITE_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET ?? "http://127.0.0.1:8000",
        changeOrigin: true,
        // The backend serves its routes at the root; the /api prefix exists
        // only to separate them from the frontend's own paths.
        rewrite: (path) => path.replace(/^\/api/, ""),
        // Without this the event stream never reaches the browser: a WebSocket
        // upgrade is not an HTTP request and is not proxied by default.
        ws: true,
      },
    },
  },
});
