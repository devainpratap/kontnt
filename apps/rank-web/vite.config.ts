/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    server: {
      host: "0.0.0.0",
      // 5274 so RankOS runs alongside ContentOS (5173) without colliding with
      // the other dev servers already using the 5173-5174 range.
      port: 5274,
      // Fail loudly instead of silently drifting to another port — a moved port
      // would break the CORS allowlist and the Google OAuth redirect URI.
      strictPort: true,
      proxy: {
        "/api": {
          target: env.VITE_RANK_API_PROXY_TARGET || "http://localhost:3102",
          changeOrigin: true
        }
      }
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      css: false
    }
  };
});
