import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";
import { compression } from "vite-plugin-compression2";
import lightningcss from "vite-plugin-lightningcss";
import http from "node:http";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Keep-alive agent so the dev proxy does not tear down connections to the
// backend mid-request (source of intermittent "ECONNRESET" in the browser).
const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 32 });

// Vendor chunks: stable code stays cached across dep upgrades so a one-line
// change in a page does not invalidate the entire bundle for every user.
const manualChunks = {
  react: ["react", "react-dom", "react-router-dom"],
  i18n: ["i18next", "react-i18next"],
  state: ["zustand", "axios"],
  lucide: ["lucide-react"],
};

export default defineConfig(({ command }) => {
  const isBuild = command === "build";

  return {
    plugins: [
      react(),
      ...(isBuild
        ? [
            visualizer({
              filename: `${__dirname}/stats.html`,
              gzipSize: true,
              brotliSize: true,
              openOnBuild: false,
            }),
            lightningcss({
              browserslist: [">0.5%", "last 2 versions", "not dead"],
              minify: true,
            }),
            compression({ algorithm: "brotliCompress", filename: "[path][base].br", threshold: 0 }),
            compression({ algorithm: "gzip", filename: "[path][base].gz", threshold: 0 }),
          ]
        : []),
    ],
    build: {
      target: "es2018", // modern Android Chrome; less transpilation, smaller output
      chunkSizeWarningLimit: 800,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
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
          configure: (proxy, _options) => {
            proxy.on("error", (err, req, res) => {
              console.error("[Vite Proxy]", err.message);
              if (res && res.writeHead && !res.headersSent) {
                res.writeHead(502, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    success: false,
                    message: "Backend temporarily unreachable (ECONNRESET handled).",
                  }),
                );
              }
            });
          },
        },
      },
    },
  };
});