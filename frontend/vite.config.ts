import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import http from "node:http";

// Keep-alive agent so the dev proxy does not tear down connections to the
// backend mid-request (source of intermittent "ECONNRESET" in the browser).
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "127.0.0.1",
    // Pin the HMR channel so the browser reconnects cleanly on restarts.
    hmr: { protocol: "ws", host: "localhost", clientPort: 5173 },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        ws: true,
        agent: keepAliveAgent,
        // A backend blip must come back as a clean 502, never a raw socket
        // reset that the axios interceptor surfaces as "Network Error".
        configure: (proxy, options) => {
          proxy.on("error", (err, req, res) => {
            console.error("[Vite Proxy]", err.message);
            if (res && res.writeHead && !res.headersSent) {
              res.writeHead(502, { "Content-Type": "application/json" });
              res.end(JSON.stringify({
                success: false,
                message: "Backend temporarily unreachable (ECONNRESET handled)."
              }));
            }
          });
        },
      },
    },
  },
});
