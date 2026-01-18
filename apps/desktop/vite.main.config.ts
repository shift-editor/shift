import { defineConfig } from "vite";
import { externalizeDepsPlugin } from "electron-vite";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [externalizeDepsPlugin()],
});
