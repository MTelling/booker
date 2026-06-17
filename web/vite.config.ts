import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev, the React app runs on Vite (5173) and proxies API calls to
// `wrangler dev` (8787). In production a single Worker serves both.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
