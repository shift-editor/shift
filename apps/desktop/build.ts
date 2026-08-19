import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";

const appRoot = __dirname;
const isE2E = process.argv.includes("--e2e");
const nodeExternals = [
  "electron",
  "shift-bridge",
  ...builtinModules,
  ...builtinModules.map((module) => `node:${module}`),
];

async function buildMain(): Promise<void> {
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
      minify: !isE2E,
      rollupOptions: { external: nodeExternals },
    },
    define: {
      MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify(""),
      MAIN_WINDOW_VITE_NAME: JSON.stringify("main_window"),
    },
  });
}

async function buildWorkspace(): Promise<void> {
  await build({
    configFile: path.join(appRoot, "vite.main.config.ts"),
    build: {
      lib: {
        entry: path.join(appRoot, "src/utility/workspace.ts"),
        formats: ["cjs"],
        fileName: () => "workspace.js",
      },
      outDir: path.join(appRoot, ".vite/build"),
      emptyOutDir: false,
      minify: !isE2E,
      rollupOptions: { external: nodeExternals },
    },
  });
}

async function buildPreload(): Promise<void> {
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
      minify: !isE2E,
      rollupOptions: { external: nodeExternals },
    },
  });
}

async function buildRenderer(): Promise<void> {
  await build({
    configFile: path.join(appRoot, "vite.renderer.config.ts"),
    base: "./",
    build: {
      outDir: path.join(appRoot, ".vite/renderer/main_window"),
      emptyOutDir: true,
      minify: !isE2E,
    },
    define: {
      __PLAYWRIGHT__: JSON.stringify(isE2E),
    },
  });
}

async function main(): Promise<void> {
  console.log(`Building Electron app${isE2E ? " for E2E tests" : ""}...`);
  await buildMain();
  await buildWorkspace();
  await buildPreload();
  await buildRenderer();
  console.log("Electron build complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
