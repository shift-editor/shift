/**
 * Builds the Electron app (main, preload, renderer) via Vite for E2E testing.
 *
 * This replicates what `@electron-forge/plugin-vite` does at `electron-forge start`
 * but produces a static renderer build instead of starting a dev server.
 *
 * Run: `pnpm tsx e2e/build.ts` (from apps/desktop)
 */

import { build } from "vite";
import * as path from "path";
import { builtinModules } from "module";

const appRoot = path.resolve(__dirname, "..");

/**
 * Node builtins + electron must be external for main/preload —
 * they run in Node, not the browser.
 */
const nodeExternals = ["electron", ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

async function buildMain() {
  await build({
    configFile: path.join(appRoot, "vite.main.config.ts"),
    build: {
      lib: {
        entry: path.join(appRoot, "src/main/main.ts"),
        formats: ["cjs"],
        fileName: () => "main.js",
      },
      outDir: path.join(appRoot, ".vite/build"),
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        external: nodeExternals,
      },
    },
    define: {
      // Empty string is falsy — the app falls through to loadFile()
      MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(""),
    },
  });
}

async function buildPreload() {
  await build({
    configFile: path.join(appRoot, "vite.preload.config.ts"),
    build: {
      lib: {
        entry: path.join(appRoot, "src/preload/preload.ts"),
        formats: ["cjs"],
        fileName: () => "preload.js",
      },
      outDir: path.join(appRoot, ".vite/build"),
      emptyOutDir: false,
      minify: false,
      rollupOptions: {
        external: nodeExternals,
      },
    },
  });
}

async function buildRenderer() {
  await build({
    configFile: path.join(appRoot, "vite.renderer.config.ts"),
    // Relative base so loadFile() can resolve assets without a server.
    base: "./",
    build: {
      outDir: path.join(appRoot, ".vite/renderer"),
      emptyOutDir: true,
      minify: false,
    },
    define: {
      // Expose editor on window for Playwright perf/interaction tests.
      __PLAYWRIGHT__: JSON.stringify(true),
    },
  });
}

async function main() {
  console.log("Building Electron app for E2E tests...");
  await buildMain();
  await buildPreload();
  await buildRenderer();
  console.log("E2E build complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
