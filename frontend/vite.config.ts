import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  // The layout worker imports these lazily; without pre-bundling, Vite discovers them
  // mid-session and forces a full page reload, wiping app state.
  optimizeDeps: {
    include: ["graphology", "graphology-layout-forceatlas2"],
  },
  worker: {
    format: "es",
  },
  server: {
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});
