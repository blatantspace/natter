import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": "http://localhost:3847",
      "/ws": {
        target: "ws://localhost:3847",
        ws: true,
      },
      "/tracker": {
        target: "ws://localhost:3847",
        ws: true,
      },
    },
  },
});
