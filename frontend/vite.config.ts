import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The production build is written into the Python package so the installer
// needs no Node.js on the NAS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: "../backend/talon/web",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:8080" },
  },
});
