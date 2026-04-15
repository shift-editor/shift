/**
 * Builds the Electron app (main, preload, renderer) via Vite for E2E testing.
 *
 * This replicates what `@electron-forge/plugin-vite` does at `electron-forge start`
 * but produces a static renderer build instead of starting a dev server.
 *
 * Run: `pnpm tsx e2e/build.ts` (from apps/desktop)
 */

import { build } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

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
    },
  });
}

async function buildRenderer() {
  await build({
    configFile: path.join(appRoot, "vite.renderer.config.ts"),
    build: {
      outDir: path.join(appRoot, ".vite/renderer"),
      emptyOutDir: true,
      minify: false,
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
