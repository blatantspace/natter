import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      lib: { entry: resolve(__dirname, "electron/main.ts") },
    },
  },
  preload: {
    build: {
      lib: { entry: resolve(__dirname, "electron/preload.ts") },
      rollupOptions: {
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: ".",
    plugins: [react()],
    server: { port: 5199, strictPort: true },
    build: {
      rollupOptions: { input: resolve(__dirname, "index.html") },
    },
  },
});
