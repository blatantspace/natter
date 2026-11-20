import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiPort = process.env.NATTER_API_PORT || "3847";
const webPort = Number(process.env.NATTER_WEB_PORT || 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: webPort,
    host: true,
    allowedHosts: true,
    proxy: {
      "/api": `http://localhost:${apiPort}`,
      "/ws": {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
      "/tracker": {
        target: `ws://localhost:${apiPort}`,
        ws: true,
      },
    },
  },
});
