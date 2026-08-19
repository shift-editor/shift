import type { ForgeConfig } from "@electron-forge/shared-types";
import { VitePlugin } from "@electron-forge/plugin-vite";

const config: ForgeConfig = {
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload",
        },
        {
          entry: "src/utility/workspace.ts",
          config: "vite.main.config.ts",
          target: "main",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

/** @public Development-only Electron Forge configuration. */
export default config;
