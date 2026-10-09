import { builtinModules } from "node:module";
import path from "node:path";
import { build } from "vite";

const appRoot = __dirname;
const isE2E = process.argv.includes("--e2e");
const isProfile = process.argv.includes("--profile") || process.env.SHIFT_PROFILE_BUILD === "1";
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

async function buildSandbox(): Promise<void> {
  await build({
    configFile: path.join(appRoot, "vite.main.config.ts"),
    build: {
      lib: {
        entry: path.join(appRoot, "src/utility/sandbox.ts"),
        formats: ["cjs"],
        fileName: () => "sandbox.js",
      },
      outDir: path.join(appRoot, ".vite/build"),
      emptyOutDir: false,
      minify: !isE2E,
      rollupOptions: { external: nodeExternals },
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
      // Profiling builds stay minified, like production, but keep source maps so
      // CPU profiles can be mapped back to component and function names.
      sourcemap: isProfile,
      rollupOptions: {
        output: {
          // build.ts runs under tsx, which compiles Vite with esbuild's keepNames.
          // Vite embeds its dynamic-import preload helper as `preload.toString()`,
          // so the helper calls `__name`, which no browser chunk defines, and every
          // lazy `import()` threw. Profiling builds' own keepNames needs it too.
          intro:
            'var __name = (target, value) => Object.defineProperty(target, "name", { value, configurable: true });',
        },
      },
    },
    // Profiling builds also keep function names, so React fibers name their
    // components when render counts are read from the running app.
    ...(isProfile ? { esbuild: { keepNames: true } } : {}),
    define: {
      __PLAYWRIGHT__: JSON.stringify(isE2E),
    },
  });
}

async function main(): Promise<void> {
  process.stdout.write(`Building Electron app${isE2E ? " for E2E tests" : ""}...\n`);
  await buildMain();
  await buildSandbox();
  await buildWorkspace();
  await buildPreload();
  await buildRenderer();
  process.stdout.write("Electron build complete.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
